"""Encodes a frame as JPEG and uploads it to the backend's evidence store."""

import cv2
import numpy as np


def encode_jpeg(frame: np.ndarray, quality: int = 85) -> bytes:
    ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, quality])
    if not ok:
        raise RuntimeError("Failed to encode snapshot as JPEG")
    return buf.tobytes()


def upload_snapshot(backend_url: str, service_token: str, object_key: str, jpeg_bytes: bytes) -> bool:
    """POSTs the JPEG to /internal/v1/evidence/upload. Returns True on success."""
    try:
        import requests  # type: ignore

        resp = requests.post(
            f"{backend_url}/internal/v1/evidence/upload",
            headers={"x-service-token": service_token},
            data={"objectKey": object_key},
            files={"file": ("snapshot.jpg", jpeg_bytes, "image/jpeg")},
            timeout=8,
        )
        return resp.status_code in (200, 201)
    except Exception as e:  # noqa: BLE001 - never let a snapshot failure crash the worker
        print(f"[snapshot upload failed] {e}")
        return False
