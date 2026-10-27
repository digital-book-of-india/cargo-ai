"""Evidence pictures: the frame with the tracked object outlined, as a JPEG."""

import cv2
import numpy as np


def encode_jpeg(frame: np.ndarray, box=None, quality: int = 85) -> bytes:
    """box is (x1, y1, x2, y2) normalised 0..1; when given, it is drawn on a copy of the frame."""
    image = frame
    if box is not None:
        image = frame.copy()
        h, w = image.shape[:2]
        p1, p2 = (int(box[0] * w), int(box[1] * h)), (int(box[2] * w), int(box[3] * h))
        cv2.rectangle(image, p1, p2, (37, 99, 235), 3)
    ok, buf = cv2.imencode(".jpg", image, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise ValueError("could not encode the frame")
    return buf.tobytes()
