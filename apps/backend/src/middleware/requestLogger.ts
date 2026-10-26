import type { NextFunction, Request, Response } from "express";
import { recordRequest } from "../services/observability/metrics";
import { logger } from "../utils/logger";

// One log line and one metric per request, written when the response is finished.
// Only the path is logged: never the query string (it can hold signed links), headers or body.
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const started = process.hrtime.bigint();
  res.on("finish", () => {
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    // the route pattern (for example /api/v1/events/:eventId) keeps the metric's labels few
    const route = req.route ? `${req.baseUrl}${req.route.path}`.replace(/(.)\/$/, "$1") : "unmatched";
    recordRequest(req.method, route, res.statusCode, seconds);
    if (req.path === "/health" || req.path === "/health/ready") return; // probes would drown the log
    const fields = {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      durationMs: Math.round(seconds * 1000),
      userId: req.user?.id,
      companyId: req.tenant?.companyId,
    };
    if (res.statusCode >= 500) logger.error("request", fields);
    else if (res.statusCode >= 400) logger.warn("request", fields);
    else logger.info("request", fields);
  });
  next();
}
