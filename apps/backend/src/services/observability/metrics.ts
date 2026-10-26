import mongoose from "mongoose";
import { CargoEventModel, LoadingSessionModel, NotificationModel } from "../../models";

// Process-level counters (reset on restart) plus gauges read from the database when scraped.
// Exposed in Prometheus text format at GET /internal/v1/metrics (service token required).

const startedAt = Date.now();
const requests = new Map<string, number>(); // "METHOD|route|class" -> count
let durationSumSeconds = 0;
let durationCount = 0;
let errors5xx = 0;

export function recordRequest(method: string, route: string, status: number, seconds: number): void {
  const key = `${method}|${route}|${Math.floor(status / 100)}xx`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  durationSumSeconds += seconds;
  durationCount++;
  if (status >= 500) errors5xx++;
}

export function resetMetrics(): void {
  requests.clear();
  durationSumSeconds = 0;
  durationCount = 0;
  errors5xx = 0;
}

export interface Gauges {
  dbConnected: boolean;
  notificationsPending: number;
  notificationsFailed: number;
  oldestPendingNotificationSeconds: number;
  eventLagAvgSeconds: number;
  eventLagMaxSeconds: number;
  eventsLast15m: number;
  openLoadingSessions: number;
}

const LAG_WINDOW_MS = 15 * 60 * 1000;

// Event lag = how long after an event happened it reached the database. A growing lag means the
// pipeline is falling behind or the API is struggling.
export async function collectGauges(now = new Date()): Promise<Gauges> {
  const dbConnected = mongoose.connection.readyState === 1;
  const empty: Gauges = {
    dbConnected,
    notificationsPending: 0,
    notificationsFailed: 0,
    oldestPendingNotificationSeconds: 0,
    eventLagAvgSeconds: 0,
    eventLagMaxSeconds: 0,
    eventsLast15m: 0,
    openLoadingSessions: 0,
  };
  if (!dbConnected) return empty;

  const [pending, failed, oldest, lag, open] = await Promise.all([
    NotificationModel.countDocuments({ status: "PENDING" }),
    NotificationModel.countDocuments({ status: "FAILED" }),
    NotificationModel.findOne({ status: "PENDING" }).sort({ createdAt: 1 }).select("createdAt").lean(),
    CargoEventModel.aggregate([
      { $match: { createdAt: { $gte: new Date(now.getTime() - LAG_WINDOW_MS) } } },
      { $project: { lag: { $max: [0, { $subtract: ["$createdAt", "$occurredAt"] }] } } },
      { $group: { _id: null, avg: { $avg: "$lag" }, max: { $max: "$lag" }, n: { $sum: 1 } } },
    ]),
    LoadingSessionModel.countDocuments({ closedAt: null }),
  ]);

  return {
    dbConnected,
    notificationsPending: pending,
    notificationsFailed: failed,
    oldestPendingNotificationSeconds: oldest?.createdAt ? Math.max(0, (now.getTime() - oldest.createdAt.getTime()) / 1000) : 0,
    eventLagAvgSeconds: lag[0] ? lag[0].avg / 1000 : 0,
    eventLagMaxSeconds: lag[0] ? lag[0].max / 1000 : 0,
    eventsLast15m: lag[0]?.n ?? 0,
    openLoadingSessions: open,
  };
}

export function renderPrometheus(g: Gauges): string {
  const out: string[] = [];
  const metric = (name: string, help: string, type: "counter" | "gauge", lines: string[]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines);
  };
  const num = (n: number) => (Number.isFinite(n) ? String(Number(n.toFixed(3))) : "0");

  metric(
    "dbi_http_requests_total",
    "HTTP requests by method, route pattern and status class.",
    "counter",
    [...requests.entries()].map(([k, v]) => {
      const [method, route, cls] = k.split("|");
      return `dbi_http_requests_total{method="${method}",route="${route.replace(/"/g, "")}",status="${cls}"} ${v}`;
    })
  );
  metric("dbi_http_errors_total", "HTTP responses with a 5xx status.", "counter", [`dbi_http_errors_total ${errors5xx}`]);
  metric("dbi_http_request_duration_seconds_sum", "Total time spent answering requests.", "counter", [`dbi_http_request_duration_seconds_sum ${num(durationSumSeconds)}`]);
  metric("dbi_http_request_duration_seconds_count", "Requests timed.", "counter", [`dbi_http_request_duration_seconds_count ${durationCount}`]);
  metric("dbi_process_uptime_seconds", "Seconds since the API started.", "gauge", [`dbi_process_uptime_seconds ${num((Date.now() - startedAt) / 1000)}`]);
  metric("dbi_db_connected", "1 when the database connection is up.", "gauge", [`dbi_db_connected ${g.dbConnected ? 1 : 0}`]);
  metric("dbi_notifications_queue_depth", "Notifications waiting (PENDING) or given up on (FAILED).", "gauge", [
    `dbi_notifications_queue_depth{status="PENDING"} ${g.notificationsPending}`,
    `dbi_notifications_queue_depth{status="FAILED"} ${g.notificationsFailed}`,
  ]);
  metric("dbi_notifications_oldest_pending_seconds", "Age of the oldest notification still waiting.", "gauge", [
    `dbi_notifications_oldest_pending_seconds ${num(g.oldestPendingNotificationSeconds)}`,
  ]);
  metric("dbi_event_lag_seconds", "Seconds between an event happening and being stored, over the last 15 minutes.", "gauge", [
    `dbi_event_lag_seconds{stat="avg"} ${num(g.eventLagAvgSeconds)}`,
    `dbi_event_lag_seconds{stat="max"} ${num(g.eventLagMaxSeconds)}`,
  ]);
  metric("dbi_events_last_15m", "Events stored in the last 15 minutes.", "gauge", [`dbi_events_last_15m ${g.eventsLast15m}`]);
  metric("dbi_loading_sessions_open", "Loading sessions not yet closed.", "gauge", [`dbi_loading_sessions_open ${g.openLoadingSessions}`]);
  return out.join("\n") + "\n";
}
