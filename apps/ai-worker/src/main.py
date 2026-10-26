"""DBI Intelligence — AI Monitoring Worker.

Discovers registered cameras from the backend, opens each RTSP stream, runs a person
detector against the owner-drawn zone, and submits POSSIBLE_SHUTTER_INTERACTION /
PERSON_IN_ZONE events with an uploaded snapshot. Sends a heartbeat on its own interval
so the dashboard's Security State reflects real worker health.
"""

import os
import sys
import time
import json
import uuid
import threading
import datetime
from typing import Optional

try:
    sys.stdout.reconfigure(encoding="utf-8")  # avoid garbled output on Windows consoles
except Exception:
    pass

try:
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except ImportError:
    pass

try:
    import requests  # type: ignore
except ImportError:
    requests = None

import urllib.request
import urllib.error

from stream.reader import StreamReader
from detection.person_detector import PersonDetector
from zones.zone_loader import is_in_zone
from heuristics.classifier import EventClassifier
from reporting.snapshot import encode_jpeg, upload_snapshot

BACKEND_URL = (os.getenv("BACKEND_URL") or os.getenv("BACKEND_BASE_URL", "http://localhost:4000")).rstrip("/")
AI_SERVICE_TOKEN = os.getenv("AI_SERVICE_TOKEN", "dbi-ai-worker-secret-token")
WORKER_ID = os.getenv("WORKER_ID", "worker-1")
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "30"))
DETECTION_INTERVAL_SECONDS = float(os.getenv("DETECTION_INTERVAL_SECONDS", "1"))
CAMERA_DISCOVERY_INTERVAL = int(os.getenv("CAMERA_DISCOVERY_INTERVAL", "60"))

_stop = threading.Event()
_active_streams_lock = threading.Lock()
_active_streams = 0


def post_json(endpoint: str, payload: dict) -> "tuple[int, dict]":
    """Helper to send HTTP POST requests with x-service-token."""
    url = f"{BACKEND_URL}{endpoint}"
    data_bytes = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "x-service-token": AI_SERVICE_TOKEN,
    }

    if requests is not None:
        try:
            resp = requests.post(url, json=payload, headers=headers, timeout=8)
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text}
            return resp.status_code, body
        except Exception as e:
            return 0, {"error": str(e)}

    req = urllib.request.Request(url, data=data_bytes, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            status = response.getcode()
            body = json.loads(response.read().decode("utf-8"))
            return status, body
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": str(e)}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}


def get_json(endpoint: str) -> "tuple[int, dict]":
    url = f"{BACKEND_URL}{endpoint}"
    headers = {"x-service-token": AI_SERVICE_TOKEN}

    if requests is not None:
        try:
            resp = requests.get(url, headers=headers, timeout=8)
            try:
                body = resp.json()
            except Exception:
                body = {"raw": resp.text}
            return resp.status_code, body
        except Exception as e:
            return 0, {"error": str(e)}

    req = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=8) as response:
            return response.getcode(), json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except Exception:
            body = {"error": str(e)}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}


def send_heartbeat(status: str = "ONLINE") -> bool:
    with _active_streams_lock:
        streams = _active_streams
    payload = {
        "serviceName": WORKER_ID,
        "status": status,
        "activeStreams": streams,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    status_code, resp = post_json("/internal/v1/ai/health", payload)
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    if status_code == 200:
        print(f"[{ts}] Heartbeat sent (status={status}, activeStreams={streams})")
        return True
    print(f"[{ts}] Heartbeat failed (code {status_code}): {resp}")
    return False


def submit_security_event(
    shop_id: str,
    camera_id: str,
    event_type: str,
    confidence: float,
    snapshot_key: Optional[str] = None,
) -> bool:
    event_id = f"evt_{int(time.time())}_{uuid.uuid4().hex[:6]}"
    now_iso = datetime.datetime.now(datetime.timezone.utc).isoformat()
    payload = {
        "eventId": event_id,
        "shopId": shop_id,
        "cameraId": camera_id,
        "eventType": event_type,
        "confidence": confidence,
        "startedAt": now_iso,
        "evidence": {"snapshotObjectKey": snapshot_key} if snapshot_key else {},
        "modelVersion": "hog-detector-v0.1",
    }
    status_code, resp = post_json("/internal/v1/ai/events", payload)
    print(f"Submitted event {event_id} ({event_type}, conf={confidence}): HTTP {status_code} -> {resp}")
    return status_code in (200, 201, 202)


def watch_camera(camera: dict, detector: PersonDetector) -> None:
    """Runs forever (until _stop is set) for a single camera: stream -> detect -> classify -> report."""
    camera_id = camera["cameraId"]
    shop_id = camera["shopId"]

    status_code, config = get_json(f"/internal/v1/cameras/{camera_id}/stream-config")
    if status_code != 200:
        print(f"[camera {camera_id}] could not fetch stream config (HTTP {status_code}): {config}")
        return

    stream_url = config["data"]["streamUrl"]
    zone = config["data"].get("zone")
    if not zone or not zone.get("enabled"):
        print(f"[camera {camera_id}] no enabled zone configured - skipping detection for this camera.")
        return

    reader = StreamReader(stream_url)
    classifier = EventClassifier()
    last_detect_at = 0.0

    global _active_streams
    with _active_streams_lock:
        _active_streams += 1
    print(f"[camera {camera_id}] watching ({camera.get('name', '')})")

    try:
        for frame in reader.frames(lambda: _stop.is_set()):
            now = time.time()
            if now - last_detect_at < DETECTION_INTERVAL_SECONDS:
                continue
            last_detect_at = now

            h, w = frame.shape[:2]
            detections = detector.detect(frame)

            in_zone_detection = None
            for det in detections:
                if is_in_zone(det.bbox, w, h, zone):
                    in_zone_detection = det
                    break

            decision = classifier.update(
                camera_id, in_zone_detection is not None, in_zone_detection.confidence if in_zone_detection else 0.0
            )
            if decision is None:
                continue

            event_id_hint = f"evt_{int(now)}_{uuid.uuid4().hex[:6]}"
            object_key = f"private/{shop_id}/events/{event_id_hint}.jpg"
            try:
                jpeg_bytes = encode_jpeg(frame)
                uploaded = upload_snapshot(BACKEND_URL, AI_SERVICE_TOKEN, object_key, jpeg_bytes)
            except Exception as e:
                print(f"[camera {camera_id}] snapshot encode/upload failed: {e}")
                uploaded = False

            submit_security_event(
                shop_id,
                camera_id,
                decision["eventType"],
                decision["confidence"],
                snapshot_key=object_key if uploaded else None,
            )
    finally:
        reader.close()
        with _active_streams_lock:
            _active_streams -= 1
        print(f"[camera {camera_id}] stopped watching.")


def discover_and_watch() -> None:
    """Starts one watcher thread per camera, re-scanning periodically for newly added cameras."""
    detector = PersonDetector()
    watched: set = set()
    threads = []

    while not _stop.is_set():
        status_code, resp = get_json("/internal/v1/cameras")
        if status_code == 200:
            for cam in resp.get("data", {}).get("items", []):
                if cam["cameraId"] in watched:
                    continue
                watched.add(cam["cameraId"])
                t = threading.Thread(target=watch_camera, args=(cam, detector), daemon=True)
                t.start()
                threads.append(t)
        else:
            print(f"Camera discovery failed (HTTP {status_code}): {resp}")

        for _ in range(CAMERA_DISCOVERY_INTERVAL):
            if _stop.is_set():
                break
            time.sleep(1)


def main() -> None:
    print("=========================================")
    print("  DBI Intelligence - AI Monitoring Worker")
    print(f"  Backend: {BACKEND_URL}")
    print("=========================================")

    send_heartbeat()

    if len(sys.argv) > 1 and sys.argv[1] == "--simulate":
        shop_id = sys.argv[2] if len(sys.argv) > 2 else "shop_demo_01"
        camera_id = sys.argv[3] if len(sys.argv) > 3 else "cam_demo_01"
        print(f"Simulating suspicious shutter interaction for shop={shop_id}, cam={camera_id}...")
        submit_security_event(shop_id, camera_id, "POSSIBLE_SHUTTER_INTERACTION", 0.88)
        return

    discovery_thread = threading.Thread(target=discover_and_watch, daemon=True)
    discovery_thread.start()

    print(f"Starting heartbeat loop (interval: {HEARTBEAT_INTERVAL}s). Press Ctrl+C to stop.")
    try:
        while True:
            time.sleep(HEARTBEAT_INTERVAL)
            send_heartbeat()
    except KeyboardInterrupt:
        print("\nAI Worker shutting down gracefully.")
        _stop.set()
        send_heartbeat(status="OFFLINE")


if __name__ == "__main__":
    main()
