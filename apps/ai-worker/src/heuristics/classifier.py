"""Turns raw per-frame detections into a conservative, deduplicated security event decision.

Kept intentionally simple (time-in-zone + cooldown) rather than pose/hand models — matches
the handoff doc's instruction to "start with person-in-zone and suspicious movement/repeated
interaction heuristics" and to label events conservatively.
"""

import time
from dataclasses import dataclass
from typing import Dict, Optional

SHUTTER_INTERACTION_SECONDS = float(__import__("os").environ.get("SHUTTER_INTERACTION_SECONDS", "3"))
EVENT_COOLDOWN_SECONDS = float(__import__("os").environ.get("EVENT_COOLDOWN_SECONDS", "60"))


# Higher number = more severe. An escalation to a higher severity is never held back by
# cooldown — only repeats of the *same or lower* severity are throttled.
_SEVERITY = {"PERSON_IN_ZONE": 1, "POSSIBLE_SHUTTER_INTERACTION": 2}


@dataclass
class ZoneState:
    entered_at: Optional[float] = None
    last_event_at: Optional[float] = None
    last_severity: int = 0


class EventClassifier:
    """One instance per camera. Call update(in_zone, confidence) every detection cycle."""

    def __init__(self):
        self._state: Dict[str, ZoneState] = {}

    def update(self, camera_id: str, in_zone: bool, confidence: float) -> Optional[dict]:
        now = time.time()
        state = self._state.setdefault(camera_id, ZoneState())

        if not in_zone:
            state.entered_at = None
            state.last_severity = 0
            return None

        if state.entered_at is None:
            state.entered_at = now

        dwell = now - state.entered_at

        if dwell >= SHUTTER_INTERACTION_SECONDS:
            event_type = "POSSIBLE_SHUTTER_INTERACTION"
            event_confidence = min(1.0, confidence + 0.1)
        else:
            event_type = "PERSON_IN_ZONE"
            event_confidence = confidence

        severity = _SEVERITY[event_type]
        is_escalation = severity > state.last_severity
        cooldown_elapsed = state.last_event_at is None or (now - state.last_event_at) >= EVENT_COOLDOWN_SECONDS

        if not is_escalation and not cooldown_elapsed:
            return None  # same-or-lower severity, still cooling down: don't re-fire

        state.last_event_at = now
        state.last_severity = severity
        return {"eventType": event_type, "confidence": round(event_confidence, 2), "dwellSeconds": round(dwell, 1)}
