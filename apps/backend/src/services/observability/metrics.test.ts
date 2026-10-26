import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { recordRequest, renderPrometheus, resetMetrics, type Gauges } from "./metrics";

const gauges: Gauges = {
  dbConnected: true,
  notificationsPending: 3,
  notificationsFailed: 1,
  oldestPendingNotificationSeconds: 42.5,
  eventLagAvgSeconds: 1.25,
  eventLagMaxSeconds: 9,
  eventsLast15m: 12,
  openLoadingSessions: 2,
};

describe("metrics", () => {
  beforeEach(resetMetrics);

  it("counts requests by route and status class, and 5xx separately", () => {
    recordRequest("GET", "/api/v1/events/:eventId", 200, 0.1);
    recordRequest("GET", "/api/v1/events/:eventId", 404, 0.05);
    recordRequest("POST", "/api/v1/manifests", 500, 0.2);
    const text = renderPrometheus(gauges);
    assert.match(text, /dbi_http_requests_total\{method="GET",route="\/api\/v1\/events\/:eventId",status="2xx"\} 1/);
    assert.match(text, /status="4xx"\} 1/);
    assert.match(text, /dbi_http_errors_total 1/);
    assert.match(text, /dbi_http_request_duration_seconds_count 3/);
    assert.match(text, /dbi_http_request_duration_seconds_sum 0\.35/);
  });

  it("reports queue depth, event lag and the database state", () => {
    const text = renderPrometheus(gauges);
    assert.match(text, /dbi_notifications_queue_depth\{status="PENDING"\} 3/);
    assert.match(text, /dbi_notifications_queue_depth\{status="FAILED"\} 1/);
    assert.match(text, /dbi_event_lag_seconds\{stat="max"\} 9/);
    assert.match(text, /dbi_db_connected 1/);
    assert.match(renderPrometheus({ ...gauges, dbConnected: false }), /dbi_db_connected 0/);
  });

  it("every metric has HELP and TYPE lines", () => {
    const text = renderPrometheus(gauges);
    const names = [...text.matchAll(/^# TYPE (\S+)/gm)].map((m) => m[1]);
    assert.ok(names.length >= 10);
    for (const n of names) assert.ok(text.includes(`# HELP ${n} `));
  });
});
