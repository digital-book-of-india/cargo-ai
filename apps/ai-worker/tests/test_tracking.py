import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from detection import Detection  # noqa: E402
from tracking import Tracker, ZoneState, counts_for_direction, in_window, line_crossing, point_in_polygon  # noqa: E402

A, B = (0.0, 0.5), (1.0, 0.5)  # a horizontal counting line, drawn left to right


def det(x, y, cls="package", conf=0.9, size=0.1):
    return Detection(cls, conf, (x - size / 2, y - size / 2, x + size / 2, y + size / 2))


class LineCrossing(unittest.TestCase):
    def test_direction_follows_the_line(self):
        # y grows downwards: moving down crosses from the negative side of A->B to the positive side
        self.assertEqual(line_crossing(A, B, (0.5, 0.4), (0.5, 0.6)), "IN")
        self.assertEqual(line_crossing(A, B, (0.5, 0.6), (0.5, 0.4)), "OUT")

    def test_no_crossing_when_staying_on_one_side(self):
        self.assertIsNone(line_crossing(A, B, (0.5, 0.2), (0.5, 0.4)))

    def test_crossing_the_extension_of_the_line_does_not_count(self):
        short = ((0.4, 0.5), (0.6, 0.5))
        self.assertIsNone(line_crossing(short[0], short[1], (0.9, 0.4), (0.9, 0.6)))

    def test_count_direction_rule(self):
        self.assertTrue(counts_for_direction("A_TO_B", "IN"))
        self.assertFalse(counts_for_direction("A_TO_B", "OUT"))
        self.assertTrue(counts_for_direction("B_TO_A", "OUT"))
        self.assertFalse(counts_for_direction("B_TO_A", "IN"))
        self.assertTrue(counts_for_direction("EITHER", "IN") and counts_for_direction(None, "OUT"))


class Geometry(unittest.TestCase):
    def test_point_in_polygon(self):
        square = [(0.2, 0.2), (0.8, 0.2), (0.8, 0.8), (0.2, 0.8)]
        self.assertTrue(point_in_polygon((0.5, 0.5), square))
        self.assertFalse(point_in_polygon((0.9, 0.5), square))

    def test_time_window_may_pass_midnight(self):
        self.assertTrue(in_window(23 * 60, "22:00", "06:00"))
        self.assertTrue(in_window(2 * 60, "22:00", "06:00"))
        self.assertFalse(in_window(12 * 60, "22:00", "06:00"))
        self.assertTrue(in_window(10 * 60, "09:00", "17:00"))
        self.assertFalse(in_window(17 * 60, "09:00", "17:00"))
        self.assertFalse(in_window(60, "08:00", "08:00"))


class TrackerBehaviour(unittest.TestCase):
    def test_same_object_keeps_its_id_and_ids_carry_the_session(self):
        t = Tracker("sess-1", "cam1")
        first = t.update([det(0.30, 0.3)])[0]
        second = t.update([det(0.32, 0.31)])[0]
        self.assertEqual(first.track_id, second.track_id)
        self.assertTrue(first.track_id.startswith("sess-1:cam1:"))
        self.assertIsNotNone(second.previous_center)

    def test_another_session_gets_other_ids(self):
        a = Tracker("sess-1", "cam1").update([det(0.3, 0.3)])[0].track_id
        b = Tracker("sess-2", "cam1").update([det(0.3, 0.3)])[0].track_id
        self.assertNotEqual(a, b)

    def test_two_objects_get_two_tracks(self):
        t = Tracker("s", "c")
        self.assertEqual(len(t.update([det(0.2, 0.2), det(0.8, 0.8)])), 2)

    def test_lost_tracks_are_removed_after_the_limit(self):
        t = Tracker("s", "c", max_missed=3)
        t.update([det(0.3, 0.3)])
        for _ in range(3):
            t.update([])
        self.assertEqual(len(t.tracks), 1)
        t.update([])
        self.assertEqual(len(t.tracks), 0)

    def test_different_classes_are_not_matched(self):
        t = Tracker("s", "c")
        t.update([det(0.3, 0.3, "package")])
        tracks = t.update([det(0.3, 0.3, "pallet")])
        self.assertEqual(tracks[0].cls, "pallet")
        self.assertEqual(len(t.tracks), 2)


class ZoneMemory(unittest.TestCase):
    def test_entry_and_exit_need_consecutive_frames(self):
        z = ZoneState(confirm_frames=3)
        self.assertIsNone(z.observe("t", "z", True))
        self.assertIsNone(z.observe("t", "z", True))
        self.assertEqual(z.observe("t", "z", True), "entry")
        self.assertIsNone(z.observe("t", "z", True))
        self.assertIsNone(z.observe("t", "z", False))
        self.assertIsNone(z.observe("t", "z", True))  # a flicker resets the count
        self.assertIsNone(z.observe("t", "z", False))
        self.assertIsNone(z.observe("t", "z", False))
        self.assertEqual(z.observe("t", "z", False), "exit")

    def test_forget_reports_tracks_that_vanished_inside(self):
        z = ZoneState(confirm_frames=1)
        z.observe("t1", "z", True)
        z.observe("t2", "z", True)
        self.assertEqual(z.forget({"t2"}), [("t1", "z")])


if __name__ == "__main__":
    unittest.main()
