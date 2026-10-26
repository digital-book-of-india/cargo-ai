"""Opens an RTSP/ONVIF camera stream and yields frames, reconnecting on failure."""

import time
from typing import Iterator, Optional

import cv2
import numpy as np


class StreamReader:
    def __init__(self, stream_url: str, reconnect_delay: float = 5.0, connect_timeout_ms: int = 5000):
        self.stream_url = stream_url
        self.reconnect_delay = reconnect_delay
        self.connect_timeout_ms = connect_timeout_ms
        self._cap: Optional[cv2.VideoCapture] = None
        self.last_frame_at: Optional[float] = None

    def _open(self) -> bool:
        cap = cv2.VideoCapture(self.stream_url)
        try:
            cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, self.connect_timeout_ms)
            cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, self.connect_timeout_ms)
        except Exception:
            pass  # not every OpenCV build supports these flags
        if not cap.isOpened():
            cap.release()
            return False
        self._cap = cap
        return True

    def close(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def frames(self, stop_flag) -> Iterator[np.ndarray]:
        """Yields frames until stop_flag() returns True. Reconnects automatically on drop."""
        while not stop_flag():
            if self._cap is None and not self._open():
                time.sleep(self.reconnect_delay)
                continue

            ok, frame = self._cap.read()  # type: ignore[union-attr]
            if not ok or frame is None:
                self.close()
                time.sleep(self.reconnect_delay)
                continue

            self.last_frame_at = time.time()
            yield frame
