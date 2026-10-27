import datetime
import json
import os
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from api_client import ApiClient  # noqa: E402
from detection import Detection  # noqa: E402
from pipeline import CameraPipeline, INGEST_PATH  # noqa: E402
from reporting.spool import DiskSpool  # noqa: E402

LINE = {
    "id": "a" * 24, "zoneType": "counting_line",
    "geometry": {"coordinateSpace": "normalized_0_1", "line": [[0.0, 0.5], [1.0, 0.5]]},
    "rules": {"objectClasses": ["package", "box"], "minimumConfidence": 0.5, "countDirection": "A_TO_B", "countOncePerTrackPerRule": True},
}
SQUARE = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]]


def poly(zone_type, zone_id="b" * 24, after_hours=None):
    rules = {"objectClasses": ["package"], "minimumConfidence": 0.5, "countOncePerTrackPerRule": True}
    if after_hours:
        rules["afterHours"] = after_hours
    return {"id": zone_id, "zoneType": zone_type, "geometry": {"coordinateSpace": "normalized_0_1", "polygon": SQUARE}, "rules": rules}


def det(x, y, cls="package", conf=0.9):
    return Detection(cls, conf, (x - 0.05, y - 0.05, x + 0.05, y + 0.05))


class Fixture(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.spool = DiskSpool(os.path.join(self.dir, "spool.db"))
        self.sent = []
        self.status = 202
        self.now = datetime.datetime(2026, 10, 27, 12, 0, tzinfo=datetime.timezone.utc)

    def make(self, zones, timezone="UTC"):
        def deliver(path, payload):
            self.sent.append((path, payload))
            return self.status

        cam = {"cameraId": "c" * 24, "companyId": "d" * 24, "siteId": "e" * 24, "timezone": timezone, "zones": zones}
        return CameraPipeline(cam, "sess-1", ("package-model", "v7"), deliver, self.spool, snapshot=lambda *a: "private/key/pic.jpg", clock=lambda: self.now)

    def step(self, pipe, *detections):
        return pipe.handle_tracks(pipe.tracker.update(list(detections)), frame=object())


class LineEvents(Fixture):
    def test_a_crossing_is_counted_once_and_carries_company_model_picture(self):
        pipe = self.make([LINE])
        self.step(pipe, det(0.5, 0.45))
        events = self.step(pipe, det(0.5, 0.55))  # moving down = IN = A_TO_B
        self.assertEqual(len(events), 1)
        e = events[0]
        self.assertEqual(self.sent[0][0], INGEST_PATH)
        self.assertEqual(e["eventType"], "package_line_crossing")
        self.assertEqual(e["movement"], {"direction": "IN", "countDelta": 1})
        self.assertEqual((e["companyId"], e["siteId"], e["cameraId"], e["zoneId"]), ("d" * 24, "e" * 24, "c" * 24, LINE["id"]))
        self.assertEqual(e["model"], {"name": "package-model", "version": "v7"})
        self.assertEqual(e["evidence"]["snapshotObjectKey"], "private/key/pic.jpg")
        self.assertTrue(all(0 <= v <= 1 for v in e["track"]["bbox"]))
        # going back and forth over the same line does not count the same package again
        self.step(pipe, det(0.5, 0.45))
        again = self.step(pipe, det(0.5, 0.55))
        self.assertEqual(again[0]["movement"]["countDelta"], 0)

    def test_a_crossing_against_the_counted_direction_is_reported_but_not_counted(self):
        pipe = self.make([LINE])
        self.step(pipe, det(0.5, 0.55))
        events = self.step(pipe, det(0.5, 0.45))
        self.assertEqual(events[0]["movement"], {"direction": "OUT", "countDelta": 0})
        self.assertNotIn("evidence", events[0])

    def test_wrong_class_or_weak_detection_is_ignored(self):
        pipe = self.make([LINE])
        self.step(pipe, det(0.5, 0.45, "pallet"))
        self.assertEqual(self.step(pipe, det(0.5, 0.55, "pallet")), [])
        pipe = self.make([LINE])
        self.step(pipe, det(0.5, 0.45, conf=0.3))
        self.assertEqual(self.step(pipe, det(0.5, 0.55, conf=0.3)), [])

    def test_event_keys_are_stable_and_unique(self):
        pipe = self.make([LINE])
        self.step(pipe, det(0.5, 0.45))
        e1 = self.step(pipe, det(0.5, 0.55))[0]
        self.step(pipe, det(0.5, 0.45))
        e2 = self.step(pipe, det(0.5, 0.55))[0]
        self.assertNotEqual(e1["eventKey"], e2["eventKey"])
        self.assertTrue(e1["eventKey"].startswith("sess-1:"))  # session in the key and in the track id


class Delivery(Fixture):
    def cross(self, pipe):
        self.step(pipe, det(0.5, 0.45))
        return self.step(pipe, det(0.5, 0.55))[0]

    def test_an_unreachable_or_failing_api_puts_the_event_on_disk(self):
        for status in (0, 503, 429):
            self.status = status
            e = self.cross(self.make([LINE]))
            self.assertEqual(self.spool.count(), 1, f"HTTP {status} must keep the event")
            self.cross(self.make([LINE]))  # the same event again (same key) is not stored twice
            self.assertEqual(self.spool.count(), 1)
            self.assertEqual(e["eventType"], "package_line_crossing")
            with self.spool._conn() as c:
                c.execute("DELETE FROM spool")

    def test_a_refused_event_is_not_kept(self):
        self.status = 400
        self.cross(self.make([LINE]))
        self.assertEqual(self.spool.count(), 0)

    def test_a_duplicate_answer_is_success(self):
        self.status = 200
        self.cross(self.make([LINE]))
        self.assertEqual(self.spool.count(), 0)


class PolygonEvents(Fixture):
    def walk_in(self, pipe, n=3):
        out = []
        for _ in range(n):
            out += self.step(pipe, det(0.5, 0.5))
        return out

    def test_entry_is_reported_after_three_frames_and_exit_when_it_leaves(self):
        pipe = self.make([poly("loading_bay")])
        self.assertEqual([e["eventType"] for e in self.walk_in(pipe)], ["zone_entry"])
        out = []
        for x in (0.65, 0.8, 0.9, 0.95, 0.95, 0.95, 0.95):  # walks out to the right, a step at a time
            out += self.step(pipe, det(x, 0.5))
        self.assertEqual([e["eventType"] for e in out], ["zone_exit"])

    def test_restricted_zone_gives_a_picture_and_no_exit(self):
        pipe = self.make([poly("restricted")])
        events = self.walk_in(pipe)
        self.assertEqual(events[0]["eventType"], "restricted_zone_movement")
        self.assertIn("evidence", events[0])

    def test_after_hours_uses_the_site_time_zone(self):
        night = {"enabled": True, "start": "22:00", "end": "06:00"}
        # 12:00 UTC is 17:30 in Kolkata: outside the window. 12:00 UTC is 21:00 in Tokyo; move the clock to 14:00 UTC = 23:00 Tokyo
        pipe = self.make([poly("storage", after_hours=night)], timezone="Asia/Kolkata")
        self.assertEqual([e["eventType"] for e in self.walk_in(pipe)], ["zone_entry"])
        self.now = datetime.datetime(2026, 10, 27, 14, 0, tzinfo=datetime.timezone.utc)
        pipe = self.make([poly("storage", after_hours=night)], timezone="Asia/Tokyo")
        self.assertEqual([e["eventType"] for e in self.walk_in(pipe)], ["zone_entry", "unusual_after_hours_movement"])

    def test_a_package_that_vanishes_inside_a_zone_gets_an_exit(self):
        pipe = self.make([poly("loading_bay")])
        self.walk_in(pipe)
        out = []
        for _ in range(40):  # the tracker gives up on it after 30 missed frames
            out += pipe.handle_tracks(pipe.tracker.update([]), frame=None)
        self.assertEqual([e["eventType"] for e in out], ["zone_exit"])


class ContractWithApi(Fixture):
    """The payloads the worker sends are checked against the API's own schema by a backend test
    (apps/backend/src/services/vision/workerContract.test.ts), which reads tests/fixtures/events.json.
    Run with UPDATE_FIXTURES=1 to rewrite the file after a deliberate change."""

    def test_events_match_the_fixture_the_api_validates(self):
        out = {}
        pipe = self.make([LINE])
        self.step(pipe, det(0.5, 0.45))
        out["line_crossing_counted"] = self.step(pipe, det(0.5, 0.55))[0]
        pipe = self.make([LINE])
        self.step(pipe, det(0.5, 0.55))
        out["line_crossing_not_counted"] = self.step(pipe, det(0.5, 0.45))[0]
        for zone_type in ("loading_bay", "restricted"):
            pipe = self.make([poly(zone_type)])
            events = []
            for _ in range(3):
                events += self.step(pipe, det(0.5, 0.5))
            out[f"{zone_type}_entry"] = events[0]
        night = {"enabled": True, "start": "11:00", "end": "13:00"}
        pipe = self.make([poly("storage", after_hours=night)])
        events = []
        for _ in range(3):
            events += self.step(pipe, det(0.5, 0.5))
        out["after_hours"] = events[1]
        path = os.path.join(os.path.dirname(__file__), "fixtures", "events.json")
        if os.environ.get("UPDATE_FIXTURES") == "1":
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(out, f, indent=2, sort_keys=True)
                f.write("\n")
        with open(path, encoding="utf-8") as f:
            self.assertEqual(json.load(f), json.loads(json.dumps(out)))


class ApiClientAndSpool(unittest.TestCase):
    def test_client_sends_the_service_token_and_reports_unreachable_as_zero(self):
        seen = {}

        class H(BaseHTTPRequestHandler):
            def _answer(self):
                seen["token"] = self.headers.get("x-service-token")
                seen["key"] = self.headers.get("Idempotency-Key")
                body = json.dumps({"data": {"ok": True}}).encode()
                self.send_response(202)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            do_GET = do_POST = _answer

            def log_message(self, *a):
                pass

        server = HTTPServer(("127.0.0.1", 0), H)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            client = ApiClient(f"http://127.0.0.1:{server.server_port}", "t" * 40)
            code, body = client.post_json("/x", {"a": 1}, {"Idempotency-Key": "k1"})
            self.assertEqual((code, body["data"]["ok"]), (202, True))
            self.assertEqual((seen["token"], seen["key"]), ("t" * 40, "k1"))
        finally:
            server.shutdown()
        self.assertEqual(ApiClient("http://127.0.0.1:1", "t" * 40).get_json("/x")[0], 0)

    def test_spool_retries_with_backoff_gives_up_and_drops_refusals(self):
        spool = DiskSpool(os.path.join(tempfile.mkdtemp(), "s.db"), max_rows=3, max_attempts=2)
        for i in range(5):
            spool.add(f"k{i}", "/p", {"i": i})
        self.assertEqual(spool.count(), 3, "the oldest events are dropped when the cap is reached")
        self.assertEqual(spool.flush(lambda *a: 0), (0, 0), "an unreachable API stops the round")
        self.assertEqual(spool.flush(lambda *a: 202), (2, 0), "the one that was tried has to wait; the others are due")
        self.assertEqual(DiskSpool.delay_for(1), 2.0)
        self.assertEqual(DiskSpool.delay_for(20), 300.0)
        with spool._conn() as c:
            c.execute("UPDATE spool SET next_at = 0")
        self.assertEqual(spool.flush(lambda *a: 202), (1, 0))
        self.assertEqual(spool.count(), 0)
        spool.add("bad", "/p", {})
        self.assertEqual(spool.flush(lambda *a: 400), (0, 1))
        self.assertEqual(spool.count(), 0)


if __name__ == "__main__":
    unittest.main()
