"""CargoSense AI worker: reads the enabled cameras' streams, detects packages with the trained model, and reports
line crossings and zone events to the API. Without a model it reports DEGRADED and sends no events."""

import datetime
import sys
import threading
import uuid
from typing import Dict, Optional

import config
from api_client import ApiClient
from detection import OnnxDetector, load_detector
from pipeline import CameraPipeline, INGEST_PATH
from reporting.snapshot import encode_jpeg
from reporting.spool import DiskSpool

SESSION_ID = f"sess-{uuid.uuid4().hex[:8]}"


class Worker:
    def __init__(self, api: ApiClient, detector: Optional[OnnxDetector], spool: DiskSpool):
        self.api = api
        self.detector = detector
        self.spool = spool
        self.pipelines: Dict[str, CameraPipeline] = {}
        self.threads: Dict[str, threading.Thread] = {}
        self.heartbeat_seconds = 15
        self.stop = threading.Event()

    # ---- helpers handed to the pipelines -------------------------------------------------------------------------
    def deliver(self, path: str, payload: dict) -> int:
        status, _ = self.api.post_json(path, payload, {"Idempotency-Key": payload["eventKey"]})
        return status

    def snapshot(self, site_id: str, camera_id: str, frame, track) -> Optional[str]:
        try:
            return self.api.upload_snapshot(site_id, camera_id, encode_jpeg(frame, track.box))
        except Exception as e:  # noqa: BLE001 - an event without a picture is better than no event
            print(f"[snapshot] {e}")
            return None

    def stream_url_for(self, camera_id: str) -> Optional[str]:
        status, body = self.api.get_json(f"/internal/v1/cameras/{camera_id}/stream-config")
        return body.get("data", {}).get("streamUrl") if status == 200 else None

    # ---- configuration -------------------------------------------------------------------------------------------
    def sync_config(self) -> None:
        status, body = self.api.get_json("/internal/v1/monitoring/config", {"workerId": config.WORKER_ID})
        if status != 200:
            return
        data = body.get("data", {})
        self.heartbeat_seconds = int(data.get("heartbeatIntervalSeconds") or 15)
        wanted = {c["cameraId"]: c for c in data.get("cameras", [])}
        for camera_id, cam in wanted.items():
            pipe = self.pipelines.get(camera_id)
            if pipe:
                pipe.zones = cam.get("zones", [])  # zones can change while the camera runs
                pipe.timezone = cam.get("timezone") or pipe.timezone
            elif self.detector:
                pipe = CameraPipeline(cam, SESSION_ID, (self.detector.name, self.detector.version), self.deliver, self.spool, self.snapshot)
                self.pipelines[camera_id] = pipe
                t = threading.Thread(target=pipe.run, args=(self.detector, self.stream_url_for), daemon=True, name=f"cam-{camera_id}")
                self.threads[camera_id] = t
                t.start()
                print(f"started camera {camera_id}")
        for camera_id in [c for c in self.pipelines if c not in wanted]:  # monitoring was switched off or the camera removed
            self.pipelines.pop(camera_id).stop.set()
            self.threads.pop(camera_id, None)
            print(f"stopped camera {camera_id}")

    def heartbeat(self) -> None:
        reports = [p.report() for p in self.pipelines.values()]
        if not self.detector:
            status = "DEGRADED"  # no model: nothing can be detected
        elif reports and any(r["streamStatus"] != "STREAMING" for r in reports):
            status = "DEGRADED"
        else:
            status = "ONLINE"
        payload = {
            "workerId": config.WORKER_ID,
            "status": status,
            "sentAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "cameras": reports,
        }
        code, _ = self.api.post_json("/internal/v1/monitoring/heartbeat", payload)
        if code != 200:
            print(f"[heartbeat] API answered {code}")

    def resend(self) -> None:
        self.spool.flush(lambda path, payload, key: self.deliver(path, payload))

    def run(self) -> None:
        name = f"{self.detector.name}:{self.detector.version}" if self.detector else "NONE (no model loaded)"
        print(f"CargoSense AI worker {config.WORKER_ID} | session {SESSION_ID} | model {name}")
        if not self.detector:
            print("WARNING: set MODEL_PATH to a trained ONNX package model. Until then the worker reports DEGRADED and sends no events.")
        ticks = 0
        while not self.stop.is_set():
            try:
                self.sync_config()
                self.resend()
                if ticks % max(1, self.heartbeat_seconds // config.CONFIG_POLL_SECONDS) == 0:
                    self.heartbeat()
            except Exception as e:  # noqa: BLE001 - the loop must survive anything
                print(f"[worker loop] {e}")
            ticks += 1
            self.stop.wait(config.CONFIG_POLL_SECONDS)
        self.shutdown()

    def shutdown(self) -> None:
        for pipe in self.pipelines.values():
            pipe.stop.set()
        self.pipelines.clear()
        try:  # tell the API this worker is going away
            self.api.post_json("/internal/v1/monitoring/heartbeat", {
                "workerId": config.WORKER_ID, "status": "OFFLINE", "cameras": [],
                "sentAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            })
        except Exception:  # noqa: BLE001
            pass


def main() -> None:
    if len(config.SERVICE_TOKEN) < config.MIN_TOKEN_LENGTH:
        sys.exit(f"AI_SERVICE_TOKEN must be set and at least {config.MIN_TOKEN_LENGTH} characters (same value as the API).")
    detector = load_detector(config.MODEL_PATH, config.MODEL_INPUT_SIZE, config.DETECT_CONFIDENCE, config.NMS_IOU)
    worker = Worker(ApiClient(), detector, DiskSpool())
    try:
        worker.run()
    except KeyboardInterrupt:
        print("Stopping worker...")
        worker.stop.set()
        worker.shutdown()


if __name__ == "__main__":
    main()
