"""
CargoSense AI — Production AI Cargo Worker (Dev 2).
Spec Aligned: Package detection, session-scoped tracking, line crossing
with directional debounce (QA-04, QA-05), polygon zone events, snapshot upload,
and idempotent event ingestion.
"""

import os
import sys
import time
import json
import uuid
import threading
import datetime
from typing import Dict, List, Tuple, Optional

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

import urllib.request
import urllib.error
import cv2
import numpy as np

from stream.reader import StreamReader
from reporting.snapshot import encode_jpeg, upload_snapshot
from zones.zone_loader import point_in_polygon

BACKEND_URL = (os.getenv("BACKEND_URL") or os.getenv("BACKEND_BASE_URL", "http://localhost:4000")).rstrip("/")
AI_SERVICE_TOKEN = os.getenv("AI_SERVICE_TOKEN", "")
MIN_TOKEN_LENGTH = 32  # the API answers 503 to every call when its own token is shorter
WORKER_ID = os.getenv("WORKER_ID", "cargo-worker-1")
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "15"))

SESSION_ID = f"sess-{uuid.uuid4().hex[:8]}"

def post_json(endpoint: str, payload: dict, extra_headers: Optional[dict] = None) -> Tuple[int, dict]:
    url = f"{BACKEND_URL}{endpoint}"
    data_bytes = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-service-token": AI_SERVICE_TOKEN,
    }
    if extra_headers:
        headers.update(extra_headers)

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": str(e)}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}

def get_json(endpoint: str) -> Tuple[int, dict]:
    url = f"{BACKEND_URL}{endpoint}"
    headers = {"x-service-token": AI_SERVICE_TOKEN}
    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.getcode(), json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return 0, {"error": str(e)}

def ccw(A: Tuple[float, float], B: Tuple[float, float], C: Tuple[float, float]) -> float:
    return (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])

def segments_intersect(A: Tuple[float, float], B: Tuple[float, float],
                       C: Tuple[float, float], D: Tuple[float, float]) -> bool:
    return (ccw(A, C, D) * ccw(B, C, D) < 0) and (ccw(C, A, B) * ccw(D, A, B) < 0)

def point_line_distance(pt: Tuple[float, float], A: Tuple[float, float], B: Tuple[float, float]) -> float:
    dx, dy = B[0] - A[0], B[1] - A[1]
    mag = (dx * dx + dy * dy) ** 0.5
    if mag < 1e-9:
        return 0.0
    return abs(dy * pt[0] - dx * pt[1] + B[0] * A[1] - B[1] * A[0]) / mag

def is_within_after_hours(after_hours: Optional[dict]) -> bool:
    if not after_hours or not after_hours.get("enabled"):
        return False
    now_hm = datetime.datetime.now().strftime("%H:%M")
    start_hm = after_hours.get("start", "22:00")
    end_hm = after_hours.get("end", "06:00")
    if start_hm <= end_hm:
        return start_hm <= now_hm <= end_hm
    return now_hm >= start_hm or now_hm <= end_hm

class CargoDetector:
    def __init__(self):
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=40, detectShadows=False)
        self.next_id = 1
        self.active_centroids: Dict[str, Tuple[float, float]] = {}

    def detect_and_track(self, frame: np.ndarray) -> List[dict]:
        h, w = frame.shape[:2]
        fg_mask = self.bg_subtractor.apply(frame)
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        detections: List[dict] = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < (w * h * 0.005):
                continue
            x, y, bw, bh = cv2.boundingRect(cnt)
            x1, y1, x2, y2 = x / w, y / h, (x + bw) / w, (y + bh) / h
            cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0

            aspect = bw / float(bh or 1)
            obj_class = "pallet" if area > (w * h * 0.08) else ("box" if 0.7 <= aspect <= 1.4 else "package")
            conf = min(0.98, 0.65 + (area / (w * h)) * 0.5)

            matched_id = None
            best_dist = 0.08
            for tid, (px, py) in self.active_centroids.items():
                dist = ((cx - px) ** 2 + (cy - py) ** 2) ** 0.5
                if dist < best_dist:
                    best_dist = dist
                    matched_id = tid

            if not matched_id:
                matched_id = f"trk-{self.next_id}"
                self.next_id += 1

            self.active_centroids[matched_id] = (cx, cy)
            detections.append({
                "trackId": matched_id,
                "class": obj_class,
                "confidence": round(conf, 2),
                "bbox": [round(x1, 4), round(y1, 4), round(x2, 4), round(y2, 4)],
                "center": (cx, cy),
            })

        return detections

class CargoTracker:
    def __init__(self, debounce_margin: float = 0.015):
        self.tracks: Dict[str, List[Tuple[float, float]]] = {}
        self.counted_tracks: set = set()
        self.zone_presence: Dict[str, set] = {}
        self.debounce_margin = debounce_margin

    def update_track(self, track_id: str, center: Tuple[float, float]):
        pts = self.tracks.setdefault(track_id, [])
        pts.append(center)
        if len(pts) > 30:
            pts.pop(0)

    def check_crossing(self, track_id: str, zone_id: str, line: List[List[float]],
                       expected_direction: str, count_once: bool = True) -> Optional[str]:
        dedupe_key = f"{track_id}:{zone_id}"
        if count_once and dedupe_key in self.counted_tracks:
            return None

        pts = self.tracks.get(track_id, [])
        if len(pts) < 3:
            return None

        p_prev = pts[-3]
        p_curr = pts[-1]
        line_A = (line[0][0], line[0][1])
        line_B = (line[1][0], line[1][1])

        if point_line_distance(p_curr, line_A, line_B) < self.debounce_margin:
            return None

        if segments_intersect(p_prev, p_curr, line_A, line_B):
            side_prev = ccw(line_A, line_B, p_prev)
            side_curr = ccw(line_A, line_B, p_curr)
            detected_dir = "A_TO_B" if (side_prev > 0 and side_curr < 0) else "B_TO_A"

            if expected_direction in ("EITHER", detected_dir):
                if count_once:
                    self.counted_tracks.add(dedupe_key)
                return "OUT" if detected_dir == "A_TO_B" else "IN"

        return None

    def check_polygon_transition(self, track_id: str, zone_id: str, polygon: list) -> Optional[str]:
        pts = self.tracks.get(track_id, [])
        if not pts:
            return None

        curr_pt = pts[-1]
        is_inside = point_in_polygon(curr_pt, polygon)
        zones_inside = self.zone_presence.setdefault(track_id, set())
        was_inside = zone_id in zones_inside

        if is_inside and not was_inside:
            zones_inside.add(zone_id)
            return "zone_entry"
        elif not is_inside and was_inside:
            zones_inside.remove(zone_id)
            return "zone_exit"

        return None

class CameraStreamPipeline(threading.Thread):
    def __init__(self, camera_id: str, site_id: str, zones: list, tracker: CargoTracker):
        super().__init__(daemon=True)
        self.camera_id = camera_id
        self.site_id = site_id
        self.zones = zones
        self.tracker = tracker
        self.detector = CargoDetector()
        self.running = True
        self.fps = 0.0
        self.inference_failures = 0
        self.status = "INIT"
        self.last_frame_at = None
        self.error_code = None

    def get_stream_url(self) -> Optional[str]:
        code, resp = get_json(f"/internal/v1/cameras/{self.camera_id}/stream-config")
        if code == 200 and "data" in resp:
            return resp["data"].get("streamUrl")
        return None

    def capture_and_upload_snapshot(self, frame: np.ndarray, event_key: str) -> Optional[str]:
        try:
            jpeg = encode_jpeg(frame)
            safe_key = event_key.replace(":", "_")
            object_key = f"{self.site_id}/{self.camera_id}/{safe_key}.jpg"
            if upload_snapshot(BACKEND_URL, AI_SERVICE_TOKEN, object_key, jpeg):
                return object_key
        except Exception as e:
            print(f"[Snapshot] upload error: {e}")
        return None

    def emit_event(self, event_type: str, zone_id: str, track_id: str,
                   obj_class: str, confidence: float, bbox: List[float],
                   movement: Optional[dict], frame: Optional[np.ndarray]):
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        bucket = int(time.time() * 10)
        event_key = f"{SESSION_ID}:{track_id}:{zone_id}:{event_type}:{bucket}"

        snapshot_key = None
        if frame is not None:
            snapshot_key = self.capture_and_upload_snapshot(frame, event_key)

        payload = {
            "eventKey": event_key,
            "companyId": "000000000000000000000000",
            "siteId": self.site_id,
            "cameraId": self.camera_id,
            "zoneId": zone_id,
            "eventType": event_type,
            "occurredAt": now_iso,
            "track": {
                "trackId": f"{SESSION_ID}-{track_id}",
                "class": obj_class,
                "confidence": round(confidence, 2),
                "bbox": bbox
            },
            "movement": movement,
            "evidence": {
                "snapshotObjectKey": snapshot_key,
                "clipObjectKey": None
            },
            "model": {
                "name": "cargo-detector-v1",
                "version": "1.0.0"
            }
        }

        code, resp = post_json("/internal/v1/ai/events", payload, extra_headers={"Idempotency-Key": event_key})
        ts = datetime.datetime.now().strftime("%H:%M:%S")
        if code in (200, 202):
            print(f"[{ts}] {event_type} emitted for track {track_id} (HTTP {code})")
        else:
            print(f"[{ts}] Ingest failed ({code}): {resp}")

    def process_frame(self, frame: np.ndarray):
        try:
            detections = self.detector.detect_and_track(frame)
            for det in detections:
                tid = det["trackId"]
                obj_cls = det["class"]
                conf = det["confidence"]
                bbox = det["bbox"]
                center = det["center"]

                self.tracker.update_track(tid, center)

                for z in self.zones:
                    zid = z.get("id") or z.get("zoneId")
                    ztype = z.get("zoneType")
                    rules = z.get("rules") or {}
                    geom = z.get("geometry") or {}

                    allowed_classes = rules.get("objectClasses") or ["package", "box", "pallet"]
                    min_conf = float(rules.get("minimumConfidence", 0.55))
                    if obj_cls not in allowed_classes or conf < min_conf:
                        continue

                    if ztype == "counting_line" and "line" in geom:
                        direction = self.tracker.check_crossing(
                            tid,
                            zid,
                            geom["line"],
                            rules.get("countDirection", "A_TO_B"),
                            rules.get("countOncePerTrackPerRule", True),
                        )
                        if direction:
                            self.emit_event(
                                "package_line_crossing",
                                zid,
                                tid,
                                obj_cls,
                                conf,
                                bbox,
                                {"direction": direction, "countDelta": 1},
                                frame,
                            )
                    elif "polygon" in geom:
                        transition = self.tracker.check_polygon_transition(tid, zid, geom["polygon"])
                        if transition:
                            if ztype == "restricted" and transition == "zone_entry":
                                self.emit_event("restricted_zone_movement", zid, tid, obj_cls, conf, bbox, None, frame)
                            else:
                                self.emit_event(transition, zid, tid, obj_cls, conf, bbox, None, frame)

                        if transition == "zone_entry" and is_within_after_hours(rules.get("afterHours")):
                            self.emit_event("unusual_after_hours_movement", zid, tid, obj_cls, conf, bbox, None, frame)
        except Exception as e:
            self.inference_failures += 1
            print(f"[Inference error on {self.camera_id}]: {e}")

    def run(self):
        stream_url = self.get_stream_url()
        if not stream_url:
            self.status = "ERROR"
            self.error_code = "STREAM_CONFIG_NOT_FOUND"
            return

        reader = StreamReader(stream_url)
        self.status = "STREAMING"
        frame_count = 0
        t_start = time.time()

        for frame in reader.frames(lambda: not self.running):
            self.last_frame_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
            frame_count += 1
            elapsed = time.time() - t_start
            if elapsed >= 2.0:
                self.fps = frame_count / elapsed
                frame_count = 0
                t_start = time.time()

            self.process_frame(frame)
            time.sleep(0.03)

        reader.close()
        self.status = "OFFLINE"

class CargoWorker:
    def __init__(self):
        self.config: dict = {}
        self.tracker = CargoTracker()
        self.pipelines: Dict[str, CameraStreamPipeline] = {}
        self.running = True

    def fetch_config(self):
        code, resp = get_json(f"/internal/v1/monitoring/config?workerId={WORKER_ID}")
        if code == 200 and "data" in resp:
            self.config = resp["data"]
            self.sync_pipelines()
        else:
            print(f"Failed to fetch worker config (HTTP {code}): {resp}")

    def sync_pipelines(self):
        configured_cams = self.config.get("cameras", [])
        active_ids = {c["cameraId"] for c in configured_cams}

        for cam_id in list(self.pipelines.keys()):
            if cam_id not in active_ids:
                p = self.pipelines.pop(cam_id)
                p.running = False

        for cam in configured_cams:
            cam_id = cam["cameraId"]
            if cam_id not in self.pipelines:
                p = CameraStreamPipeline(cam_id, cam["siteId"], cam.get("zones", []), self.tracker)
                self.pipelines[cam_id] = p
                p.start()
                print(f"Started stream pipeline for camera {cam_id}")
            else:
                self.pipelines[cam_id].zones = cam.get("zones", [])

    def send_heartbeat(self):
        cameras_payload = []
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        total_failures = 0
        for cam_id, p in self.pipelines.items():
            total_failures += p.inference_failures
            cameras_payload.append({
                "cameraId": cam_id,
                "streamStatus": p.status,
                "frameRate": round(p.fps, 1),
                "lastFrameAt": p.last_frame_at or now_iso,
                "errorCode": p.error_code
            })

        payload = {
            "workerId": WORKER_ID,
            "status": "ONLINE" if any(p.status == "STREAMING" for p in self.pipelines.values()) else ("ONLINE" if not cameras_payload else "DEGRADED"),
            "sentAt": now_iso,
            "cameras": cameras_payload
        }
        post_json("/internal/v1/monitoring/heartbeat", payload)
        print(f"[Metrics] worker={WORKER_ID} active_streams={len(self.pipelines)} inference_failures={total_failures}")

    def run(self):
        print("=========================================")
        print(f"  CargoSense AI - Cargo AI Worker: {WORKER_ID}")
        print(f"  Backend: {BACKEND_URL}")
        print(f"  Session ID: {SESSION_ID}")
        print("=========================================")

        last_hb = 0
        last_config = 0

        while self.running:
            now = time.time()
            if now - last_config > 30:
                self.fetch_config()
                last_config = now

            if now - last_hb > HEARTBEAT_INTERVAL:
                self.send_heartbeat()
                last_hb = now

            time.sleep(1)

def main():
    if len(AI_SERVICE_TOKEN) < MIN_TOKEN_LENGTH:
        sys.exit(f"AI_SERVICE_TOKEN must be set and at least {MIN_TOKEN_LENGTH} characters (same value as the API).")
    worker = CargoWorker()
    try:
        worker.run()
    except KeyboardInterrupt:
        print("\nStopping worker...")
        worker.running = False
        post_json("/internal/v1/monitoring/heartbeat", {
            "workerId": WORKER_ID,
            "status": "OFFLINE",
            "cameras": []
        })

if __name__ == "__main__":
    main()

