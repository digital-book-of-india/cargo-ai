"""Package detection with a trained model.

The model is an ONNX file with YOLOv8-style output (1, 4 + classes, N). There is no heuristic fallback: without a
model the worker has nothing to detect with, and says so (see main.py), instead of inventing detections.
A "<model>.json" file next to the model can give {"name", "version", "classes"}; otherwise the name is the file name
and the version is the first 12 characters of the file's SHA-256, so every event names the exact weights that made it.
"""

import hashlib
import json
import os
from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

import numpy as np

# class names the API accepts (VisionObjectClass); anything else the model knows is ignored
API_CLASSES = {"package", "box", "pallet"}


@dataclass
class Detection:
    cls: str
    confidence: float
    box: Tuple[float, float, float, float]  # x1, y1, x2, y2, normalised 0..1 in the frame

    @property
    def center(self) -> Tuple[float, float]:
        return ((self.box[0] + self.box[2]) / 2.0, (self.box[1] + self.box[3]) / 2.0)


def iou(a: Sequence[float], b: Sequence[float]) -> float:
    ix1, iy1, ix2, iy2 = max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> List[int]:
    order = [int(i) for i in np.argsort(-scores)]
    keep: List[int] = []
    while order:
        i = order.pop(0)
        keep.append(i)
        order = [j for j in order if iou(boxes[i], boxes[j]) < iou_threshold]
    return keep


def letterbox(frame: np.ndarray, size: int) -> Tuple[np.ndarray, float, int, int]:
    """Scales the frame to fit size x size without distorting it. Returns image, scale, pad_x, pad_y."""
    import cv2

    h, w = frame.shape[:2]
    scale = min(size / w, size / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = cv2.resize(frame, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), 114, dtype=np.uint8)
    pad_x, pad_y = (size - nw) // 2, (size - nh) // 2
    canvas[pad_y:pad_y + nh, pad_x:pad_x + nw] = resized
    return canvas, scale, pad_x, pad_y


def decode_yolov8(
    output: np.ndarray,
    classes: Sequence[str],
    frame_w: int,
    frame_h: int,
    scale: float,
    pad_x: int,
    pad_y: int,
    conf_threshold: float,
    iou_threshold: float,
) -> List[Detection]:
    """Turns the raw model output into detections in normalised frame coordinates."""
    pred = output[0] if output.ndim == 3 else output  # drop the batch axis (a plain squeeze would also drop a single detection)
    if pred.ndim != 2:
        raise ValueError(f"unexpected model output shape {output.shape}")
    if pred.shape[0] == 4 + len(classes):  # (4 + classes, N) -> (N, 4 + classes)
        pred = pred.T
    if pred.shape[1] != 4 + len(classes):
        raise ValueError(f"model output has {pred.shape[1]} columns, expected {4 + len(classes)} for {len(classes)} classes")

    class_scores = pred[:, 4:]
    class_ids = np.argmax(class_scores, axis=1)
    scores = class_scores[np.arange(len(pred)), class_ids]
    mask = scores >= conf_threshold
    if not mask.any():
        return []
    pred, class_ids, scores = pred[mask], class_ids[mask], scores[mask]

    cx, cy, bw, bh = pred[:, 0], pred[:, 1], pred[:, 2], pred[:, 3]
    x1 = (cx - bw / 2 - pad_x) / scale
    y1 = (cy - bh / 2 - pad_y) / scale
    x2 = (cx + bw / 2 - pad_x) / scale
    y2 = (cy + bh / 2 - pad_y) / scale
    boxes = np.stack(
        [np.clip(x1 / frame_w, 0, 1), np.clip(y1 / frame_h, 0, 1), np.clip(x2 / frame_w, 0, 1), np.clip(y2 / frame_h, 0, 1)],
        axis=1,
    )

    result: List[Detection] = []
    for cid in sorted(set(class_ids.tolist())):  # NMS per class
        name = classes[cid]
        if name not in API_CLASSES:
            continue
        idx = np.where(class_ids == cid)[0]
        for k in nms(boxes[idx], scores[idx], iou_threshold):
            b = boxes[idx[k]]
            if b[2] <= b[0] or b[3] <= b[1]:
                continue
            result.append(Detection(name, float(scores[idx[k]]), (float(b[0]), float(b[1]), float(b[2]), float(b[3]))))
    return result


class OnnxDetector:
    def __init__(self, model_path: str, input_size: int, conf_threshold: float, iou_threshold: float):
        import cv2

        self.input_size = input_size
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold
        self.net = cv2.dnn.readNetFromONNX(model_path)
        meta = {}
        sidecar = os.path.splitext(model_path)[0] + ".json"
        if os.path.exists(sidecar):
            with open(sidecar, encoding="utf-8") as f:
                meta = json.load(f)
        with open(model_path, "rb") as f:
            digest = hashlib.sha256(f.read()).hexdigest()[:12]
        self.name = str(meta.get("name") or os.path.splitext(os.path.basename(model_path))[0])[:80]
        self.version = str(meta.get("version") or digest)[:40]
        self.classes: List[str] = list(meta.get("classes") or ["package", "box", "pallet"])

    def detect(self, frame: np.ndarray) -> List[Detection]:
        import cv2

        h, w = frame.shape[:2]
        image, scale, pad_x, pad_y = letterbox(frame, self.input_size)
        blob = cv2.dnn.blobFromImage(image, 1 / 255.0, (self.input_size, self.input_size), swapRB=True)
        self.net.setInput(blob)
        output = self.net.forward()
        return decode_yolov8(output, self.classes, w, h, scale, pad_x, pad_y, self.conf_threshold, self.iou_threshold)


def load_detector(model_path: str, input_size: int, conf_threshold: float, iou_threshold: float) -> Optional[OnnxDetector]:
    """The detector, or None when there is no usable model (the worker then reports it and sends no events)."""
    if not model_path or not os.path.isfile(model_path):
        return None
    try:
        return OnnxDetector(model_path, input_size, conf_threshold, iou_threshold)
    except Exception as e:  # noqa: BLE001
        print(f"[model] could not load {model_path}: {e}")
        return None
