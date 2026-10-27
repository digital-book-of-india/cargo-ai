"""Session-scoped tracks and line / zone logic. No OpenCV: plain geometry, so it is easy to test."""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Set, Tuple

from detection import Detection, iou

Point = Tuple[float, float]


@dataclass
class Track:
    track_id: str
    cls: str
    box: Tuple[float, float, float, float]
    confidence: float
    center: Point
    previous_center: Optional[Point] = None
    missed: int = 0
    hits: int = 1


class Tracker:
    """Greedy IoU matching. Track ids contain the session id, so ids from an earlier run can never collide with
    this run's (the API de-duplicates counting by track id). Tracks not seen for max_missed frames are dropped."""

    def __init__(self, session_id: str, camera_id: str, max_missed: int = 30, min_iou: float = 0.2, max_distance: float = 0.2):
        self.prefix = f"{session_id}:{camera_id}"
        self.max_missed = max_missed
        self.min_iou = min_iou
        self.max_distance = max_distance  # a fast object may not overlap its last box: it still matches if it is close
        self.tracks: Dict[str, Track] = {}
        self._next = 1

    def _score(self, track: "Track", d: Detection) -> float:
        """Overlapping boxes match by overlap (1 + IoU); otherwise a near centre still matches, weaker (1 - distance)."""
        overlap = iou(track.box, d.box)
        if overlap >= self.min_iou:
            return 1.0 + overlap
        dist = ((track.center[0] - d.center[0]) ** 2 + (track.center[1] - d.center[1]) ** 2) ** 0.5
        return 1.0 - dist if dist <= self.max_distance else 0.0

    def update(self, detections: Sequence[Detection]) -> List[Track]:
        unmatched = list(range(len(detections)))
        matched: Set[str] = set()
        pairs = sorted(
            (
                (self._score(t, d), tid, di)
                for tid, t in self.tracks.items()
                for di, d in enumerate(detections)
                if d.cls == t.cls
            ),
            reverse=True,
        )
        for score, tid, di in pairs:
            if score <= 0 or tid in matched or di not in unmatched:
                continue
            t, d = self.tracks[tid], detections[di]
            t.previous_center, t.center, t.box, t.confidence = t.center, d.center, d.box, d.confidence
            t.missed, t.hits = 0, t.hits + 1
            matched.add(tid)
            unmatched.remove(di)
        for di in unmatched:
            d = detections[di]
            tid = f"{self.prefix}:{self._next}"
            self._next += 1
            self.tracks[tid] = Track(tid, d.cls, d.box, d.confidence, d.center)
            matched.add(tid)
        for tid in list(self.tracks):
            if tid not in matched:
                self.tracks[tid].missed += 1
                if self.tracks[tid].missed > self.max_missed:
                    del self.tracks[tid]
        return [t for t in self.tracks.values() if t.missed == 0]


def _side(a: Point, b: Point, p: Point) -> float:
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def line_crossing(a: Point, b: Point, previous: Point, current: Point) -> Optional[str]:
    """"IN" when the track moves from the negative side of the directed line A->B to the positive side (A_TO_B),
    "OUT" for the opposite move, None when it did not cross the segment. Coordinates are image coordinates (y down)."""
    s0, s1 = _side(a, b, previous), _side(a, b, current)
    if s0 == 0 or s1 == 0 or (s0 > 0) == (s1 > 0):
        return None
    # the movement must cross the segment A-B itself, not only the infinite line through it
    d0, d1 = _side(previous, current, a), _side(previous, current, b)
    if (d0 > 0) == (d1 > 0):
        return None
    return "IN" if s0 < 0 else "OUT"


def point_in_polygon(point: Point, polygon: Sequence[Point]) -> bool:
    x, y = point
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def counts_for_direction(count_direction: Optional[str], direction: str) -> bool:
    """A_TO_B counts IN crossings, B_TO_A counts OUT crossings, EITHER (the default) counts both."""
    if count_direction == "A_TO_B":
        return direction == "IN"
    if count_direction == "B_TO_A":
        return direction == "OUT"
    return True


def in_window(minutes_now: int, start: str, end: str) -> bool:
    """Is a time of day (minutes since midnight) inside the "HH:mm" window? The window may pass midnight."""

    def mins(v: str) -> int:
        h, m = v.split(":")
        return int(h) * 60 + int(m)

    s, e = mins(start), mins(end)
    if s == e:
        return False
    return s <= minutes_now < e if s < e else (minutes_now >= s or minutes_now < e)


@dataclass
class ZoneState:
    """Per-camera memory of who is inside which polygon zone, with a few frames of confirmation either way."""

    confirm_frames: int = 3
    inside: Dict[Tuple[str, str], bool] = field(default_factory=dict)
    streak: Dict[Tuple[str, str], int] = field(default_factory=dict)

    def observe(self, track_id: str, zone_id: str, is_inside_now: bool) -> Optional[str]:
        """Returns "entry" or "exit" once a change has lasted confirm_frames frames, else None."""
        key = (track_id, zone_id)
        confirmed = self.inside.get(key, False)
        if is_inside_now == confirmed:
            self.streak[key] = 0
            return None
        self.streak[key] = self.streak.get(key, 0) + 1
        if self.streak[key] < self.confirm_frames:
            return None
        self.inside[key] = is_inside_now
        self.streak[key] = 0
        return "entry" if is_inside_now else "exit"

    def forget(self, live_track_ids: Set[str]) -> List[Tuple[str, str]]:
        """Drops memory of tracks that are gone. Returns the (track, zone) pairs that were still inside (their exit)."""
        gone = [k for k in self.inside if k[0] not in live_track_ids]
        left_inside = [k for k in gone if self.inside[k]]
        for k in gone:
            self.inside.pop(k, None)
            self.streak.pop(k, None)
        return left_inside
