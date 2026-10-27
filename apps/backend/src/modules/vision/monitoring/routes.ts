import { Router } from "express";
import { authenticate, requirePermission, resolveTenant } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { auditFromRequest } from "../../../services/audit/logger";
import { asyncHandler } from "../shared/http";
import { getMonitoringStatus, setCameraMonitoring } from "./service";

// Mounted at /api/v1/monitoring (spec section 7)
export const visionMonitoringRouter = Router();

visionMonitoringRouter.use(authenticate, resolveTenant);

// GET /api/v1/monitoring/status?siteId=...
visionMonitoringRouter.get(
  "/status",
  requirePermission("monitoring:read"),
  asyncHandler(async (req, res) => {
    const siteId = typeof req.query.siteId === "string" ? req.query.siteId : "";
    if (!siteId) throw new AppError(400, "VALIDATION_ERROR", "siteId is required.");
    res.json({ data: await getMonitoringStatus(req, siteId) });
  })
);

// POST /api/v1/monitoring/cameras/:cameraId/start
visionMonitoringRouter.post(
  "/cameras/:cameraId/start",
  requirePermission("monitoring:control"),
  asyncHandler(async (req, res) => {
    const camera = await setCameraMonitoring(req, req.params.cameraId, true);
    await auditFromRequest(req, "MONITORING_STARTED", "Camera", req.params.cameraId);
    res.json({ data: { camera } });
  })
);

// POST /api/v1/monitoring/cameras/:cameraId/stop
visionMonitoringRouter.post(
  "/cameras/:cameraId/stop",
  requirePermission("monitoring:control"),
  asyncHandler(async (req, res) => {
    const camera = await setCameraMonitoring(req, req.params.cameraId, false);
    await auditFromRequest(req, "MONITORING_STOPPED", "Camera", req.params.cameraId);
    res.json({ data: { camera } });
  })
);