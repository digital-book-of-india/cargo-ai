import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from detection import decode_yolov8, iou, letterbox, load_detector, nms  # noqa: E402

CLASSES = ["package", "box", "pallet", "person"]


def raw(rows):
    """rows: (cx, cy, w, h, class_index, score) in model pixels -> output shaped (1, 4 + classes, N) like YOLOv8."""
    out = np.zeros((len(rows), 4 + len(CLASSES)), dtype=np.float32)
    for i, (cx, cy, w, h, c, s) in enumerate(rows):
        out[i, :4] = (cx, cy, w, h)
        out[i, 4 + c] = s
    return out.T[None, :, :]


class Decode(unittest.TestCase):
    def test_boxes_come_back_in_frame_coordinates(self):
        # a 1280x720 frame letterboxed into 640: scale 0.5, vertical padding 140
        out = raw([(320, 320, 100, 100, 0, 0.9)])
        d = decode_yolov8(out, CLASSES, 1280, 720, 0.5, 0, 140, 0.35, 0.5)
        self.assertEqual(len(d), 1)
        x1, y1, x2, y2 = d[0].box
        self.assertAlmostEqual(x1, (320 - 50) / 0.5 / 1280, places=4)
        self.assertAlmostEqual(y1, (320 - 50 - 140) / 0.5 / 720, places=4)
        self.assertEqual(d[0].cls, "package")
        self.assertAlmostEqual(d[0].confidence, 0.9, places=3)

    def test_low_confidence_and_unknown_classes_are_dropped(self):
        out = raw([(100, 100, 40, 40, 0, 0.2), (300, 300, 40, 40, 3, 0.95)])  # weak package, a person
        self.assertEqual(decode_yolov8(out, CLASSES, 640, 640, 1.0, 0, 0, 0.35, 0.5), [])

    def test_overlapping_boxes_of_one_class_are_merged(self):
        out = raw([(200, 200, 100, 100, 1, 0.9), (205, 202, 100, 100, 1, 0.8), (500, 500, 60, 60, 1, 0.7)])
        d = decode_yolov8(out, CLASSES, 640, 640, 1.0, 0, 0, 0.35, 0.5)
        self.assertEqual(sorted(round(x.confidence, 1) for x in d), [0.7, 0.9])

    def test_a_wrong_shaped_output_is_an_error_not_a_guess(self):
        with self.assertRaises(ValueError):
            decode_yolov8(np.zeros((1, 9, 5), dtype=np.float32), CLASSES, 640, 640, 1.0, 0, 0, 0.3, 0.5)

    def test_iou_and_nms(self):
        self.assertAlmostEqual(iou((0, 0, 1, 1), (0, 0, 1, 1)), 1.0)
        self.assertEqual(iou((0, 0, 1, 1), (2, 2, 3, 3)), 0.0)
        boxes = np.array([[0, 0, 1, 1], [0.05, 0.05, 1, 1], [2, 2, 3, 3]], dtype=float)
        self.assertEqual(nms(boxes, np.array([0.9, 0.8, 0.7]), 0.5), [0, 2])


class Letterbox(unittest.TestCase):
    def test_keeps_the_shape_and_reports_padding(self):
        frame = np.zeros((720, 1280, 3), dtype=np.uint8)
        image, scale, pad_x, pad_y = letterbox(frame, 640)
        self.assertEqual(image.shape, (640, 640, 3))
        self.assertAlmostEqual(scale, 0.5)
        self.assertEqual((pad_x, pad_y), (0, 140))


class Loading(unittest.TestCase):
    def test_no_model_means_no_detector(self):
        self.assertIsNone(load_detector("", 640, 0.3, 0.5))
        self.assertIsNone(load_detector("does/not/exist.onnx", 640, 0.3, 0.5))

    def test_a_broken_model_file_means_no_detector(self):
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".onnx", delete=False) as f:
            f.write(b"not a model")
        try:
            self.assertIsNone(load_detector(f.name, 640, 0.3, 0.5))
        finally:
            os.unlink(f.name)


if __name__ == "__main__":
    unittest.main()
