"""Person detection using OpenCV's built-in HOG + SVM people detector.

This ships with opencv-python — no model file to download, no internet needed at
runtime. It is noticeably less accurate than a modern model (YOLOv8n, MobileNet-SSD):
expect it to miss partial/side-on bodies and occasionally false-positive on bins,
mannequins, etc. It is a genuine working starting point, not a stub — swap in a
heavier model here later by keeping the same detect(frame) -> list[Detection] shape.
"""

from dataclasses import dataclass
from typing import List, Tuple

import cv2
import numpy as np

MAX_DETECTION_WIDTH = 640  # downscale for speed; upscale boxes back afterwards


@dataclass
class Detection:
    bbox: Tuple[int, int, int, int]  # x, y, w, h in ORIGINAL frame coordinates
    confidence: float  # heuristically normalized to roughly 0..1


class PersonDetector:
    def __init__(self):
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())

    def detect(self, frame: np.ndarray) -> List[Detection]:
        h, w = frame.shape[:2]
        scale = min(1.0, MAX_DETECTION_WIDTH / w) if w > MAX_DETECTION_WIDTH else 1.0
        small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame

        rects, weights = self.hog.detectMultiScale(
            small, winStride=(8, 8), padding=(8, 8), scale=1.05
        )

        results: List[Detection] = []
        for (x, y, bw, bh), weight in zip(rects, weights):
            # HOG's SVM decision score is unbounded (~0 to 2+ for solid detections);
            # clip into a rough 0..1 confidence band rather than treat it as a probability.
            confidence = float(min(1.0, max(0.0, (weight - 0.3) / 1.3)))
            if scale != 1.0:
                x, y, bw, bh = (int(x / scale), int(y / scale), int(bw / scale), int(bh / scale))
            results.append(Detection(bbox=(x, y, bw, bh), confidence=confidence))
        return results
