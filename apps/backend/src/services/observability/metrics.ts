import mongoose from "mongoose";
import { CargoEventModel, LoadingSessionModel, NotificationModel } from "../../models";

// Process-level counters (reset on restart) plus gauges read from the database when scraped.
// Exposed in Prometheus text format at GET /internal/v1/metrics (service token required).

const startedAt = Date.now();
const requests = new Map<string, number>(); // "METHOD|route|class" -> count
let errors5xx = 0;

// Request time as a histogram, so a percentile (the spec's "p95 under 500 ms") can be worked out from the numbers
// instead of only an average. Bucket limits are in seconds.
export const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];
interface Histogram {
  perBucket: number[]; // observations that fell into each bucket (made cumulative when rendered)
  sum: number;
  count: number;
}
const newHistogram = (): Histogram => ({ perBucket: DURATION_BUCKETS.map(() => 0), sum: 0, count: 0 });
let overall = newHistogram();
const perRoute = new Map<string, Histogram>();

function observe(h: Histogram, seconds: number): void {
  h.sum += seconds;
  h.count++;
  const i = DURATION_BUCKETS.findIndex((limit) => seconds <= limit);
  if (i >= 0) h.perBucket[i]++; // slower than the last bucket: only counted in +Inf (the total)
}

export function recordRequest(method: string, route: string, status: number, seconds: number): void {
  const key = `${method}|${route}|${Math.floor(status / 100)}xx`;
  requests.set(key, (requests.get(key) ?? 0) + 1);
  observe(overall, seconds);
  const routeKey = `${method} ${route}`;
  let h = perRoute.get(routeKey);
  if (!h) {
    h = newHistogram();
    perRoute.set(routeKey, h);
  }
  observe(h, seconds);
  if (status >= 500) errors5xx++;
}

export function resetMetrics(): void {
  requests.clear();
  overall = newHistogram();
  perRoute.clear();
  errors5xx = 0;
}

// Prometheus histogram lines for one series: cumulative bucket counts, then the sum and the count.
function histogramLines(name: string, h: Histogram, labels = ""): string[] {
  const lines: string[] = [];
  let running = 0;
  DURATION_BUCKETS.forEach((limit, i) => {
    running += h.perBucket[i];
    lines.push(`${name}_bucket{${labels}${labels ? "," : ""}le="${limit}"} ${running}`);
  });
  lines.push(`${name}_bucket{${labels}${labels ? "," : ""}le="+Inf"} ${h.count}`);
  const braces = labels ? `{${labels}}` : "";
  lines.push(`${name}_sum${braces} ${Number(h.sum.toFixed(3))}`, `${name}_count${braces} ${h.count}`);
  return lines;
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
  const metric = (name: string, help: string, type: "counter" | "gauge" | "histogram", lines: string[]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`, ...lines);
  };
  const num = (n: number) => (Number.isFinite(n) ? String(Number(n.toFixed(3))) : "0");

  metric(
    "cargosense_http_requests_total",
    "HTTP requests by method, route pattern and status class.",
    "counter",
    [...requests.entries()].map(([k, v]) => {
      const [method, route, cls] = k.split("|");
      return `cargosense_http_requests_total{method="${method}",route="${route.replace(/"/g, "")}",status="${cls}"} ${v}`;
    })
  );
  metric("cargosense_http_errors_total", "HTTP responses with a 5xx status.", "counter", [`cargosense_http_errors_total ${errors5xx}`]);
  metric(
    "cargosense_http_request_duration_seconds",
    "Time spent answering requests (all routes). 95th percentile: histogram_quantile(0.95, sum(rate(cargosense_http_request_duration_seconds_bucket[5m])) by (le)).",
    "histogram",
    histogramLines("cargosense_http_request_duration_seconds", overall)
  );
  metric(
    "cargosense_http_route_duration_seconds",
    "Time spent answering requests, per route pattern (to find the slow ones).",
    "histogram",
    [...perRoute.entries()].flatMap(([k, h]) => histogramLines("cargosense_http_route_duration_seconds", h, `route="${k.replace(/["\\]/g, "")}"`))
  );
  metric("cargosense_process_uptime_seconds", "Seconds since the API started.", "gauge", [`cargosense_process_uptime_seconds ${num((Date.now() - startedAt) / 1000)}`]);
  metric("cargosense_db_connected", "1 when the database connection is up.", "gauge", [`cargosense_db_connected ${g.dbConnected ? 1 : 0}`]);
  metric("cargosense_notifications_queue_depth", "Notifications waiting (PENDING) or given up on (FAILED).", "gauge", [
    `cargosense_notifications_queue_depth{status="PENDING"} ${g.notificationsPending}`,
    `cargosense_notifications_queue_depth{status="FAILED"} ${g.notificationsFailed}`,
  ]);
  metric("cargosense_notifications_oldest_pending_seconds", "Age of the oldest notification still waiting.", "gauge", [
    `cargosense_notifications_oldest_pending_seconds ${num(g.oldestPendingNotificationSeconds)}`,
  ]);
  metric("cargosense_event_lag_seconds", "Seconds between an event happening and being stored, over the last 15 minutes.", "gauge", [
    `cargosense_event_lag_seconds{stat="avg"} ${num(g.eventLagAvgSeconds)}`,
    `cargosense_event_lag_seconds{stat="max"} ${num(g.eventLagMaxSeconds)}`,
  ]);
  metric("cargosense_events_last_15m", "Events stored in the last 15 minutes.", "gauge", [`cargosense_events_last_15m ${g.eventsLast15m}`]);
  metric("cargosense_loading_sessions_open", "Loading sessions not yet closed.", "gauge", [`cargosense_loading_sessions_open ${g.openLoadingSessions}`]);
  return out.join("\n") + "\n";
}
