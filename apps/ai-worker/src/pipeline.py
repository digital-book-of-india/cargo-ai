"""One camera: frames -> detections -> tracks -> events (line crossings, zone entries and exits)."""

import datetime
import threading
import time
from typing import Callable, Dict, List, Optional, Set, Tuple

import config
from detection import OnnxDetector
from reporting.spool import DiskSpool
from tracking import Tracker, Track, ZoneState, counts_for_direction, in_window, line_crossing, point_in_polygon

INGEST_PATH = "/internal/v1/ai/cargo-events"
POLYGON_TYPES = {"polygon", "loading_bay", "storage", "restricted"}


def local_minutes(now_utc: datetime.datetime, timezone: str) -> int:
    """Minutes since midnight in the site's own time zone (UTC when the zone is unknown)."""
    try:
        from zoneinfo import ZoneInfo

        local = now_utc.astimezone(ZoneInfo(timezone))
    except Exception:  # noqa: BLE001 - unknown zone name or no tz database
        local = now_utc
    return local.hour * 60 + local.minute


class CameraPipeline:
    def __init__(
        self,
        camera: dict,
        session_id: str,
        model: Tuple[str, str],
        deliver: Callable[[str, dict], int],
        spool: DiskSpool,
        snapshot: Optional[Callable[[str, str, object, Track], Optional[str]]] = None,
        clock: Callable[[], datetime.datetime] = lambda: datetime.datetime.now(datetime.timezone.utc),
    ):
        self.camera_id: str = camera["cameraId"]
        self.company_id: str = camera["companyId"]
        self.site_id: str = camera["siteId"]
        self.timezone: str = camera.get("timezone") or "UTC"
        self.zones: List[dict] = camera.get("zones", [])
        self.session_id = session_id
        self.model_name, self.model_version = model
        self.deliver = deliver  # (path, payload) -> HTTP status; 0 when the API cannot be reached
        self.spool = spool
        self.snapshot = snapshot
        self.clock = clock
        self.tracker = Tracker(session_id, self.camera_id, max_missed=config.TRACK_MAX_MISSED_FRAMES)
        self.zone_state = ZoneState(confirm_frames=config.ZONE_CONFIRM_FRAMES)
        self.counted: Set[Tuple[str, str]] = set()
        self.occurrence: Dict[Tuple[str, str, str], int] = {}
        self.inside_tracks: Dict[Tuple[str, str], Track] = {}
        # reported to the API in the heartbeat
        self.stream_status = "RECONNECTING"
        self.error_code: Optional[str] = None
        self.last_frame_at: Optional[datetime.datetime] = None
        self.frame_rate: Optional[float] = None
        self.stop = threading.Event()

    # ---- events ----------------------------------------------------------------------------------------------
    def _payload(self, event_type: str, zone_id: str, track: Track, movement: Optional[dict], snapshot_key: Optional[str]) -> dict:
        n = self.occurrence.get((track.track_id, zone_id, event_type), 0) + 1
        self.occurrence[(track.track_id, zone_id, event_type)] = n
        # The same track, zone, type and occurrence always give the same key, so a retry can never double count.
        event_key = f"{track.track_id}:{zone_id}:{event_type}:{n}"
        payload = {
            "eventKey": event_key,
            "companyId": self.company_id,
            "siteId": self.site_id,
            "cameraId": self.camera_id,
            "zoneId": zone_id,
            "eventType": event_type,
            "occurredAt": self.clock().isoformat(),
            "track": {"trackId": track.track_id, "class": track.cls, "confidence": round(track.confidence, 3), "bbox": [round(v, 4) for v in track.box]},
            "model": {"name": self.model_name, "version": self.model_version},
        }
        if movement:
            payload["movement"] = movement
        if snapshot_key:
            payload["evidence"] = {"snapshotObjectKey": snapshot_key}
        return payload

    def _send(self, payload: dict) -> None:
        status = self.deliver(INGEST_PATH, payload)
        if status in (200, 202):
            return
        if status == 0 or status >= 500 or status == 429:
            self.spool.add(payload["eventKey"], INGEST_PATH, payload)  # kept on disk and retried later
        else:
            print(f"[{self.camera_id}] API refused {payload['eventType']} with HTTP {status}; not retried")

    def _emit(self, event_type: str, zone: dict, track: Track, frame, movement: Optional[dict] = None, with_picture: bool = False) -> dict:
        key = self.snapshot(self.site_id, self.camera_id, frame, track) if (with_picture and self.snapshot and frame is not None) else None
        payload = self._payload(event_type, zone["id"], track, movement, key)
        self._send(payload)
        return payload

    # ---- one analysed frame ------------------------------------------------------------------------------------
    def handle_tracks(self, tracks: List[Track], frame=None) -> List[dict]:
        sent: List[dict] = []
        now = self.clock()
        for zone in self.zones:
            rules = zone.get("rules", {})
            allowed = set(rules.get("objectClasses", ["package", "box", "pallet"]))
            min_conf = rules.get("minimumConfidence", 0.5)
            geometry = zone.get("geometry", {})
            for track in tracks:
                if track.cls not in allowed or track.confidence < min_conf:
                    continue
                if zone["zoneType"] == "counting_line" and "line" in geometry:
                    sent.extend(self._line(zone, rules, geometry["line"], track, frame))
                elif zone["zoneType"] in POLYGON_TYPES and "polygon" in geometry:
                    sent.extend(self._polygon(zone, rules, geometry["polygon"], track, frame, now))

        live = {t.track_id for t in self.tracker.tracks.values()}
        for (track_id, zone_id) in self.zone_state.forget(live):  # a track that vanished inside a zone has left it
            track = self.inside_tracks.pop((track_id, zone_id), None)
            zone = next((z for z in self.zones if z["id"] == zone_id), None)
            if track and zone and zone["zoneType"] != "restricted":
                sent.append(self._emit("zone_exit", zone, track, None))
        return sent

    def _line(self, zone: dict, rules: dict, line, track: Track, frame) -> List[dict]:
        if track.previous_center is None:
            return []
        direction = line_crossing(tuple(line[0]), tuple(line[1]), track.previous_center, track.center)
        if direction is None:
            return []
        counted_key = (track.track_id, zone["id"])
        counts = counts_for_direction(rules.get("countDirection"), direction)
        if counts and rules.get("countOncePerTrackPerRule", True):
            if counted_key in self.counted:
                counts = False
            else:
                self.counted.add(counted_key)
        movement = {"direction": direction, "countDelta": 1 if counts else 0}
        return [self._emit("package_line_crossing", zone, track, frame, movement, with_picture=counts)]

    def _polygon(self, zone: dict, rules: dict, polygon, track: Track, frame, now: datetime.datetime) -> List[dict]:
        change = self.zone_state.observe(track.track_id, zone["id"], point_in_polygon(track.center, [tuple(p) for p in polygon]))
        if change is None:
            return []
        sent: List[dict] = []
        if change == "entry":
            self.inside_tracks[(track.track_id, zone["id"])] = track
            if zone["zoneType"] == "restricted":
                sent.append(self._emit("restricted_zone_movement", zone, track, frame, with_picture=True))
            else:
                sent.append(self._emit("zone_entry", zone, track, frame))
            after = rules.get("afterHours")
            if after and after.get("enabled") and in_window(local_minutes(now, self.timezone), after["start"], after["end"]):
                sent.append(self._emit("unusual_after_hours_movement", zone, track, frame, with_picture=True))
        else:
            self.inside_tracks.pop((track.track_id, zone["id"]), None)
            if zone["zoneType"] != "restricted":
                sent.append(self._emit("zone_exit", zone, track, None))
        return sent

    def process(self, frame, detector: OnnxDetector) -> List[dict]:
        return self.handle_tracks(self.tracker.update(detector.detect(frame)), frame)

    # ---- the camera thread -------------------------------------------------------------------------------------
    def run(self, detector: OnnxDetector, stream_url_for: Callable[[str], Optional[str]]) -> None:
        from stream.reader import StreamReader

        interval = 1.0 / max(config.PROCESS_FPS, 0.1)
        while not self.stop.is_set():
            url = stream_url_for(self.camera_id)
            if not url:
                self.stream_status, self.error_code = "ERROR", "NO_STREAM_URL"
                self.stop.wait(10)
                continue
            reader = StreamReader(url)
            last, frames_in_window, window_start = 0.0, 0, time.time()
            try:
                for frame in reader.frames(self.stop.is_set):
                    self.stream_status, self.error_code = "STREAMING", None
                    self.last_frame_at = self.clock()
                    now = time.time()
                    if now - last < interval:
                        continue
                    last = now
                    frames_in_window += 1
                    if now - window_start >= 5:
                        self.frame_rate = round(frames_in_window / (now - window_start), 2)
                        frames_in_window, window_start = 0, now
                    try:
                        self.process(frame, detector)
                    except Exception as e:  # noqa: BLE001 - one bad frame must not stop the camera
                        print(f"[{self.camera_id}] frame error: {e}")
            except Exception as e:  # noqa: BLE001
                self.stream_status, self.error_code = "ERROR", "STREAM_FAILED"
                print(f"[{self.camera_id}] stream error: {e}")
            finally:
                reader.close()
            if not self.stop.is_set():
                self.stream_status = "RECONNECTING"
                self.stop.wait(5)

    def report(self) -> dict:
        return {
            "cameraId": self.camera_id,
            "streamStatus": self.stream_status,
            "lastFrameAt": self.last_frame_at.isoformat() if self.last_frame_at else None,
            "frameRate": self.frame_rate,
            "errorCode": self.error_code,
        }
