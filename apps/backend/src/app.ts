import cors from "cors";
import express from "express";
import compression from "compression";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { serviceAuth } from "./middleware/serviceAuth";
import { ingestRateLimiter } from "./middleware/rateLimiter";
import { authRouter, meRouter } from "./modules/auth/routes";
import { companyRouter } from "./modules/company/routes";
import { sitesRouter } from "./modules/sites/routes";
import { usersRouter } from "./modules/users/routes";
import { siteCamerasRouter, cameraRouter } from "./modules/owner/cameras/routes";
import { siteEventsRouter, eventRouter } from "./modules/owner/events/routes";
import { notificationsRouter } from "./modules/owner/notifications/routes";
import mongoose from "mongoose";
import { requestLogger } from "./middleware/requestLogger";
import { serviceAuth as internalServiceAuth } from "./middleware/serviceAuth";
import { collectGauges, renderPrometheus } from "./services/observability/metrics";
import { getEvidenceStorage } from "./services/evidence/storage";
import { reportsRouter } from "./modules/reports/routes";
import { auditRouter } from "./modules/audit/routes";
import { adminSupportRouter } from "./modules/superadmin/support/routes";
import { aiEventsRouter } from "./modules/internal/ai-events/routes";
import { vehiclesRouter, manifestsRouter, loadingSessionsRouter } from "./modules/shipments/routes";
import { evidenceRouter } from "./modules/evidence/routes";
import { adminOverviewRouter } from "./modules/superadmin/overview/routes";
import { adminMeRouter } from "./modules/superadmin/me/routes";
import { adminCompaniesRouter } from "./modules/superadmin/companies/routes";
import { adminSitesRouter } from "./modules/superadmin/sites/routes";
import { adminHealthRouter } from "./modules/superadmin/health/routes";
import { adminAuditLogsRouter } from "./modules/superadmin/audit-logs/routes";
import { aiHealthRouter } from "./modules/internal/ai-health/routes";
import { internalCamerasRouter } from "./modules/internal/cameras/routes";
import { evidenceUploadRouter } from "./modules/internal/evidence-upload/routes";
// Dev 2 (Vision) modules
import { visionZonesRouter } from "./modules/vision/zones/routes";
import { visionCountsRouter } from "./modules/vision/counts/routes";
import { visionMonitoringRouter } from "./modules/vision/monitoring/routes";
import { visionWorkerRouter } from "./modules/vision/monitoring/worker-routes";
export const app = express();

// 1. Assign unique UUID requestId to every incoming request
app.set("trust proxy", env.trustProxy);
app.use(requestId);
app.use(requestLogger);
app.use(compression()); // JSON lists shrink a lot; images and video are already compressed and are skipped

// Security headers + a conservative CSP (evidence images/clips are same-origin signed links).
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'", "blob:"],
        connectSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// 2. Multi-origin CORS configuration (Port 3000 & Port 3001)
const allowedOrigins = [
  // the local panels are only trusted outside production
  ...(env.isProduction ? [] : ["http://localhost:3000", "http://localhost:3001"]),
  ...(Array.isArray(env.corsOrigins)
    ? env.corsOrigins
    : env.corsOrigins
    ? String(env.corsOrigins).split(",").map((s) => s.trim())
    : []),
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Mobile apps, server-to-server, curl requests don't send origin
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // In dev, permit local loopback origins (localhost / 127.0.0.1)
    if (!env.isProduction) {
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
    }
    // Reject untrusted external origins
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-request-id", "x-service-token", "x-company-id", "Idempotency-Key"],
  exposedHeaders: ["x-request-id"],
  optionsSuccessStatus: 204,
};

// Apply CORS globally and handle Preflight OPTIONS
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// 3. Body Parser
app.use(express.json({ limit: env.bodyLimit }));

// 4. Health Check
// Liveness: the process answers. Readiness: it can also do its job (database up, evidence storage usable).
app.get("/health", (_req, res) => {
  res.json({ data: { status: "ok" } });
});
app.get("/health/ready", async (_req, res) => {
  const database = mongoose.connection.readyState === 1;
  let storage = true;
  try {
    await getEvidenceStorage().exists("health-check-probe");
  } catch {
    storage = false;
  }
  const ready = database && storage;
  res.status(ready ? 200 : 503).json({ data: { status: ready ? "ready" : "not_ready", checks: { database, evidenceStorage: storage } } });
});

// 5. Primary v1 API Router
const v1 = express.Router();
v1.use("/auth", authRouter);
v1.use("/me", meRouter);
v1.use("/company", companyRouter);
v1.use("/sites", sitesRouter);
v1.use("/sites", siteCamerasRouter);
v1.use("/sites", siteEventsRouter);
v1.use("/users", usersRouter);
v1.use("/cameras", cameraRouter);
v1.use("/events", eventRouter);
v1.use("/notifications", notificationsRouter);
v1.use("/evidence", evidenceRouter);
v1.use("/zones", visionZonesRouter); // zones (AI pipeline work)
v1.use("/counts", visionCountsRouter); // counting ledger summaries
v1.use("/monitoring", visionMonitoringRouter); // per-camera monitoring status
v1.use("/reports", reportsRouter);
v1.use("/audit-logs", auditRouter);
v1.use("/vehicles", vehiclesRouter);
v1.use("/manifests", manifestsRouter);
v1.use("/loading-sessions", loadingSessionsRouter);
// The AI pipeline posts events here with the service token (same handler as /internal/v1/ai/events).
v1.use("/ai/events", serviceAuth, ingestRateLimiter, aiEventsRouter);

// Dev 2 Super Admin Endpoints
v1.use("/admin/me", adminMeRouter);
v1.use("/admin/overview", adminOverviewRouter);
v1.use("/admin/companies", adminCompaniesRouter);
v1.use("/admin/sites", adminSitesRouter);
v1.use("/admin/cameras/health", adminHealthRouter);
v1.use("/admin/audit-logs", adminAuditLogsRouter);
v1.use("/admin/support", adminSupportRouter);

// 6. Service-auth internal router (AI worker)
const internal = express.Router();
internal.use(serviceAuth);
// The AI worker's gateway: Appendix A events, counting ledger, alert events forwarded to the inbox.
internal.use("/ai/events", ingestRateLimiter, aiEventsRouter);
internal.use("/monitoring", visionWorkerRouter); // worker heartbeat and config
// Same handler under its older name.
internal.use("/ai/cargo-events", ingestRateLimiter, aiEventsRouter);
// Metrics for the monitoring system (service token required). ?format=json for people.
internal.get("/metrics", internalServiceAuth, async (req, res, next) => {
  try {
    const gauges = await collectGauges();
    if (req.query.format === "json") return void res.json({ data: { gauges } });
    res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    res.send(renderPrometheus(gauges));
  } catch (err) {
    next(err);
  }
});
internal.use("/ai/health", aiHealthRouter);
internal.use("/cameras", internalCamerasRouter);
internal.use("/evidence", evidenceUploadRouter);

app.use("/api/v1", v1);
app.use("/internal/v1", internal);

// 7. Unknown routes, then the global error handler
app.use(notFoundHandler);
app.use(errorHandler);
