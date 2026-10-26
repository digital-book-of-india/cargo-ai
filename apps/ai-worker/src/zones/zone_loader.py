"""Fetches a camera's owner-drawn zone polygon and checks points against it."""

from typing import List, Optional, Tuple

Point = Tuple[float, float]


def point_in_polygon(point: Point, polygon: List[dict]) -> bool:
    """Ray-casting point-in-polygon test. Polygon points are {"x": 0..1, "y": 0..1}."""
    if len(polygon) < 3:
        return False
    x, y = point
    inside = False
    n = len(polygon)
    j = n - 1
    for i in range(n):
        xi, yi = polygon[i]["x"], polygon[i]["y"]
        xj, yj = polygon[j]["x"], polygon[j]["y"]
        intersects = ((yi > y) != (yj > y)) and (
            x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi
        )
        if intersects:
            inside = not inside
        j = i
    return inside


def bbox_center_normalized(bbox: Tuple[int, int, int, int], frame_w: int, frame_h: int) -> Point:
    x, y, w, h = bbox
    cx = (x + w / 2) / frame_w
    cy = (y + h / 2) / frame_h
    return (cx, cy)


def is_in_zone(bbox: Tuple[int, int, int, int], frame_w: int, frame_h: int, zone: Optional[dict]) -> bool:
    if not zone or not zone.get("enabled", False):
        return False
    polygon = zone.get("polygon") or []
    center = bbox_center_normalized(bbox, frame_w, frame_h)
    return point_in_polygon(center, polygon)
