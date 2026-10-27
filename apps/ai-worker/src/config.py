"""Worker settings, all from the environment. Nothing here has a secret default."""

import os


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


BACKEND_URL = (os.environ.get("BACKEND_URL") or os.environ.get("BACKEND_BASE_URL") or "http://localhost:4000").rstrip("/")
# Same value as the API's AI_SERVICE_TOKEN (32+ characters). There is no default.
SERVICE_TOKEN = os.environ.get("AI_SERVICE_TOKEN", "")
MIN_TOKEN_LENGTH = 32
WORKER_ID = os.environ.get("WORKER_ID", "cargo-worker-1")

# The trained package model (ONNX, YOLO-style output). Without it the worker reports DEGRADED and sends no events.
MODEL_PATH = os.environ.get("MODEL_PATH", "")
MODEL_INPUT_SIZE = _int("MODEL_INPUT_SIZE", 640)
DETECT_CONFIDENCE = _float("DETECT_CONFIDENCE", 0.35)  # the zone's own minimumConfidence is applied later
NMS_IOU = _float("NMS_IOU", 0.5)

PROCESS_FPS = _float("PROCESS_FPS", 5.0)  # frames analysed per second and camera
CONFIG_POLL_SECONDS = _int("CONFIG_POLL_SECONDS", 10)
TRACK_MAX_MISSED_FRAMES = _int("TRACK_MAX_MISSED_FRAMES", 30)
ZONE_CONFIRM_FRAMES = _int("ZONE_CONFIRM_FRAMES", 3)  # frames inside (or outside) before an entry (or exit) is reported

SPOOL_PATH = os.environ.get("SPOOL_PATH", os.path.join(os.path.dirname(__file__), "spool_buffer.db"))
SPOOL_MAX_ROWS = _int("SPOOL_MAX_ROWS", 10000)
SPOOL_MAX_ATTEMPTS = _int("SPOOL_MAX_ATTEMPTS", 20)
