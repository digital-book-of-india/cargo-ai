import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { errorHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { authRouter } from "./modules/auth/routes";
import { shopsRouter } from "./modules/owner/shops/routes";
import { schedulesRouter } from "./modules/owner/schedules/routes";
import { shopCamerasRouter, cameraRouter } from "./modules/owner/cameras/routes";
import { shopConnectorsRouter, connectorRouter } from "./modules/owner/connectors/routes";
import { shopEventsRouter, eventRouter } from "./modules/owner/events/routes";
import { notificationsRouter } from "./modules/owner/notifications/routes";
import { evidenceRouter } from "./modules/evidence/routes";
import { adminOverviewRouter } from "./modules/superadmin/overview/routes";
import { adminOwnersRouter } from "./modules/superadmin/owners/routes";
import { adminShopsRouter } from "./modules/superadmin/shops/routes";
import { adminHealthRouter } from "./modules/superadmin/health/routes";
import { adminAuditLogsRouter } from "./modules/superadmin/audit-logs/routes";
import { aiEventsRouter } from "./modules/internal/ai-events/routes";
import { aiHealthRouter } from "./modules/internal/ai-health/routes";
import { internalCamerasRouter } from "./modules/internal/cameras/routes";
import { evidenceUploadRouter } from "./modules/internal/evidence-upload/routes";
import { connectorPairingRouter, connectorDeviceRouter } from "./modules/internal/connectors/routes";
import { connectorAuth } from "./middleware/connectorAuth";

export const app = express();

// 1. Assign unique UUID requestId to every incoming request
app.use(requestId);

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
  "http://localhost:3000",
  "http://localhost:3001",
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
    if (env.nodeEnv !== "production") {
      if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
    }
    // Reject untrusted external origins
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-request-id", "x-service-token"],
  exposedHeaders: ["x-request-id"],
  optionsSuccessStatus: 204,
};

// Apply CORS globally and handle Preflight OPTIONS
app.use(cors(corsOptions));
app.options("*", cors(corsOptions));

// 3. Body Parser
app.use(express.json());

// 4. Health Check
app.get("/health", (_req, res) => {
  res.json({ data: { status: "ok" } });
});

// 5. Primary v1 API Router
const v1 = express.Router();
v1.use("/auth", authRouter);
v1.use("/shops", shopsRouter);
v1.use("/shops", schedulesRouter);
v1.use("/shops", shopCamerasRouter);
v1.use("/cameras", cameraRouter);
v1.use("/shops", shopConnectorsRouter);
v1.use("/connectors", connectorRouter);
v1.use("/shops", shopEventsRouter);
v1.use("/events", eventRouter);
v1.use("/notifications", notificationsRouter);
v1.use("/evidence", evidenceRouter);

// Dev 2 Super Admin Endpoints
v1.use("/admin/overview", adminOverviewRouter);
v1.use("/admin/owners", adminOwnersRouter);
v1.use("/admin/shops", adminShopsRouter);
v1.use("/admin/cameras/health", adminHealthRouter);
v1.use("/admin/audit-logs", adminAuditLogsRouter);

// 6. Service-auth internal router (AI worker)
import { serviceAuth } from "./middleware/serviceAuth";
const internal = express.Router();
internal.use(serviceAuth);
internal.use("/ai/events", aiEventsRouter);
internal.use("/ai/health", aiHealthRouter);
internal.use("/cameras", internalCamerasRouter);
internal.use("/evidence", evidenceUploadRouter);

// 6b. Per-connector-secret router (Connector desktop app) - deliberately NOT inside the
// `internal` group above, since that group is hardwired to the single shared
// AI_SERVICE_TOKEN. The pairing route has no auth (it's how a connector proves a one-time
// pairing code instead); every other connector route requires its own connector token.
const connectorDevice = express.Router();
connectorDevice.use(connectorAuth);
connectorDevice.use("/", connectorDeviceRouter);

app.use("/api/v1", v1);
// Must be mounted BEFORE the broad "/internal/v1" group below: Express tries routers in
// registration order, and `internal` runs serviceAuth unconditionally for every path under
// "/internal/v1" (including "/internal/v1/connectors/*") before it ever gets a chance to
// find that it has no matching route there - so it would 401 every connector request first.
app.use("/internal/v1/connectors", connectorPairingRouter);
app.use("/internal/v1/connectors", connectorDevice);
app.use("/internal/v1", internal);

// 7. Global Error Handler
app.use(errorHandler);