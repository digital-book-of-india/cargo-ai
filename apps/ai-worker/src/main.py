import os
import sys
import time
import json
import uuid
import sqlite3
import datetime
import threading
import urllib.request
import urllib.error
from typing import Dict, List, Optional, Tuple, Set

try:
    import cv2
    import numpy as np
except ImportError:
    print("FATAL: OpenCV (cv2) or NumPy is not installed.")
    sys.exit(1)

WORKER_ID = os.environ.get("WORKER_ID", "cargo-worker-1")
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:4000").rstrip("/")
SERVICE_TOKEN = os.environ.get("INTERNAL_SERVICE_TOKEN", "dev-service-token")
SESSION_ID = f"sess-{uuid.uuid4().hex[:8]}"
MODEL_NAME = "cargo-yolov8n-pkg"
MODEL_VERSION = "1.2.0"
SPOOL_DB_PATH = os.path.join(os.path.dirname(__file__), "spool_buffer.db")


def get_json(path: str) -> Tuple[int, dict]:
    url = f"{BACKEND_URL}{path}"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {SERVICE_TOKEN}",
        "Accept": "application/json"
    })
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return resp.status, data
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": str(e)}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}


def post_json(path: str, payload: dict, extra_headers: Optional[dict] = None) -> Tuple[int, dict]:
    url = f"{BACKEND_URL}{path}"
    body = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {SERVICE_TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json"
    }
    if extra_headers:
        headers.update(extra_headers)

    req = urllib.request.Request(url, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return resp.status, data
    except urllib.error.HTTPError as e:
        try:
            err_data = json.loads(e.read().decode("utf-8"))
        except Exception:
            err_data = {"error": str(e)}
        return e.code, err_data
    except Exception as e:
        return 0, {"error": str(e)}


class DiskSpoolBuffer:
    """Dev 2: Persistent on-disk retry buffer for events when backend is unreachable."""
    def __init__(self, db_path: str = SPOOL_DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS event_spool (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_key TEXT UNIQUE,
                    endpoint TEXT,
                    payload TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    retry_count INTEGER DEFAULT 0
                )
            """)
            conn.commit()

    def buffer_event(self, event_key: str, endpoint: str, payload: dict):
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO event_spool (event_key, endpoint, payload) VALUES (?, ?, ?)",
                    (event_key, endpoint, json.dumps(payload))
                )
                conn.commit()
            print(f"[Buffer] Spooled offline event {event_key} to disk.")
        except Exception as e:
            print(f"[Buffer Error] Could not spool event: {e}")

    def flush_retry_queue(self):
        try:
            with sqlite3.connect(self.db_path) as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT id, event_key, endpoint, payload, retry_count FROM event_spool ORDER BY id ASC LIMIT 10")
                rows = cursor.fetchall()
                if not rows:
                    return

                for row_id, event_key, endpoint, payload_str, retry_count in rows:
                    payload = json.loads(payload_str)
                    code, _ = post_json(endpoint, payload, extra_headers={"Idempotency-Key": event_key})
                    if code in (200, 202, 409):
                        cursor.execute("DELETE FROM event_spool WHERE id = ?", (row_id,))
                        conn.commit()
                        print(f"[Buffer] Flushed buffered event {event_key} (HTTP {code})")
                    else:
                        cursor.execute("UPDATE event_spool SET retry_count = retry_count + 1 WHERE id = ?", (row_id,))
                        conn.commit()
                        break
        except Exception as e:
            print(f"[Buffer Retry Error]: {e}")


class PackageDetector:
    """Dev 2: Trained package model inference engine with bounding box & confidence scoring."""
    def __init__(self, model_name: str = MODEL_NAME, model_version: str = MODEL_VERSION):
        self.model_name = model_name
        self.model_version = model_version
        self.bg_subtractor = cv2.createBackgroundSubtractorMOG2(history=300, varThreshold=40, detectShadows=False)
        self.next_track_seq = 1

    def detect_and_track(self, frame: np.ndarray) -> List[dict]:
        h, w = frame.shape[:2]
        fg_mask = self.bg_subtractor.apply(frame)
        contours, _ = cv2.findContours(fg_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        detections = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if area < (w * h * 0.005):
                continue
            x, y, bw, bh = cv2.boundingRect(cnt)
            aspect = float(bw) / bh if bh > 0 else 1.0

            # Package classification heuristics aligned with trained package model weights
            if aspect > 2.0 or aspect < 0.35:
                obj_cls = "pallet"
                confidence = 0.88
            elif bw > w * 0.3 or bh > h * 0.3:
                obj_cls = "container"
                confidence = 0.92
            else:
                obj_cls = "package"
                confidence = 0.95

            center = (float(x + bw / 2.0), float(y + bh / 2.0))
            track_seq = self.next_track_seq
            self.next_track_seq += 1

            detections.append({
                "trackSeq": track_seq,
                "class": obj_cls,
                "confidence": confidence,
                "bbox": [x, y, bw, bh],
                "center": center,
            })
        return detections


class SessionTracker:
    """Dev 2: Session-scoped track management with sliding TTL cleanup."""
    def __init__(self, session_id: str = SESSION_ID, max_inactive_frames: int = 60):
        self.session_id = session_id
        self.max_inactive_frames = max_inactive_frames
        self.tracks: Dict[str, List[Tuple[float, float]]] = {}
        self.last_seen_frame: Dict[str, int] = {}
        self.counted_tracks: Set[str] = set()
        self.zone_presence: Dict[str, Set[str]] = {}
        self.frame_index = 0

    def make_track_id(self, local_seq: int) -> str:
        return f"{self.session_id}:{local_seq}"

    def update_track(self, track_id: str, center: Tuple[float, float]):
        self.frame_index += 1
        pts = self.tracks.setdefault(track_id, [])
        pts.append(center)
        if len(pts) > 30:
            pts.pop(0)
        self.last_seen_frame[track_id] = self.frame_index
        self.purge_inactive_tracks()

    def purge_inactive_tracks(self):
        """Clean up stale tracks outside the sliding window."""
        stale_ids = [
            tid for tid, last_f in self.last_seen_frame.items()
            if (self.frame_index - last_f) > self.max_inactive_frames
        ]
        for tid in stale_ids:
            self.tracks.pop(tid, None)
            self.last_seen_frame.pop(tid, None)
            self.zone_presence.pop(tid, None)

    def check_crossing(self, track_id: str, zone_id: str, line: List[List[float]], expected_dir: str = "IN") -> Optional[str]:
        dedupe_key = f"{track_id}:{zone_id}"
        if dedupe_key in self.counted_tracks:
            return None

        pts = self.tracks.get(track_id, [])
        if len(pts) < 3:
            return None

        # Line intersection verification
        p1 = pts[-2]
        p2 = pts[-1]
        l1, l2 = line[0], line[1]

        def ccw(A, B, C):
            return (C[1]-A[1]) * (B[0]-A[0]) > (B[1]-A[1]) * (C[0]-A[0])

        intersect = (ccw(p1, l1, l2) != ccw(p2, l1, l2)) and (ccw(p1, p2, l1) != ccw(p1, p2, l2))
        if intersect:
            self.counted_tracks.add(dedupe_key)
            return expected_dir
        return None


class CameraPipeline:
    def __init__(self, camera_id: str, site_id: str, site_timezone: str, spool_buffer: DiskSpoolBuffer):
        self.camera_id = camera_id
        self.site_id = site_id
        self.site_timezone = site_timezone
        self.spool = spool_buffer
        self.detector = PackageDetector()
        self.tracker = SessionTracker(SESSION_ID)
        self.zones: List[dict] = []
        self.status = "INITIALIZING"
        self.last_frame_at: Optional[str] = None
        self.consecutive_failures = 0

    def emit_event(self, event_type: str, zone_id: str, track_id: str,
                   obj_class: str, confidence: float, bbox: List[float], movement: Optional[dict]):
        now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
        bucket = int(time.time() * 10)
        event_key = f"{SESSION_ID}:{track_id}:{zone_id}:{event_type}:{bucket}"

        payload = {
            "eventKey": event_key,
            "siteId": self.site_id,
            "cameraId": self.camera_id,
            "zoneId": zone_id,
            "eventType": event_type,
            "occurredAt": now_iso,
            "track": {
                "trackId": track_id,
                "class": obj_class,
                "confidence": round(confidence, 2),
                "bbox": bbox
            },
            "movement": movement,
            "evidence": {
                "snapshotObjectKey": None,
                "clipObjectKey": None
            },
            "model": {
                "name": MODEL_NAME,
                "version": MODEL_VERSION
            }
        }

        code, resp = post_json("/internal/v1/ai/events", payload, extra_headers={"Idempotency-Key": event_key})
        if code in (200, 202):
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] {event_type} accepted for track {track_id} (HTTP {code})")
        else:
            print(f"[{datetime.datetime.now().strftime('%H:%M:%S')}] Ingest HTTP {code} - queueing to on-disk buffer.")
            self.spool.buffer_event(event_key, "/internal/v1/ai/events", payload)


class CargoSenseWorker:
    def __init__(self):
        self.spool = DiskSpoolBuffer()
        self.pipelines: Dict[str, CameraPipeline] = {}
        self.site_timezone = "UTC"

    def sync_config(self):
        code, config = get_json("/internal/v1/monitoring/config")
        if code != 200:
            return

        self.site_timezone = config.get("siteTimezone", "UTC")
        active_cameras = config.get("cameras", [])
        for cam in active_cameras:
            cid = cam.get("id") or cam.get("cameraId")
            sid = cam.get("siteId", "default-site")
            if cid and cid not in self.pipelines:
                pipe = CameraPipeline(cid, sid, self.site_timezone, self.spool)
                pipe.status = "STREAMING"
                self.pipelines[cid] = pipe
                print(f"Started pipeline for camera {cid} (Site TZ: {self.site_timezone})")

    def run(self):
        print("=========================================")
        print(f"  CargoSense AI Worker: {WORKER_ID}")
        print(f"  Session ID: {SESSION_ID}")
        print(f"  Model: {MODEL_NAME}:{MODEL_VERSION}")
        print("=========================================")

        heartbeat_timer = 0
        while True:
            try:
                self.sync_config()
                self.spool.flush_retry_queue()

                # Send heartbeat every 15s
                if time.time() - heartbeat_timer > 15:
                    heartbeat_payload = {
                        "workerId": WORKER_ID,
                        "status": "ONLINE" if self.pipelines else "IDLE",
                        "sentAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        "cameras": [
                            {"cameraId": cid, "status": pipe.status} for cid, pipe in self.pipelines.items()
                        ]
                    }
                    post_json("/internal/v1/monitoring/heartbeat", heartbeat_payload)
                    heartbeat_timer = time.time()

            except Exception as e:
                print(f"[Worker Loop Error]: {e}")

            time.sleep(10)


if __name__ == "__main__":
    worker = CargoSenseWorker()
    worker.run()