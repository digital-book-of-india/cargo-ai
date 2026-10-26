import { Router } from "express";
import { authenticate } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { asyncHandler } from "../shared/http";
import { getMonitoringStatus, setCameraMonitoring } from "./service";

// Mounted at /api/v1/monitoring (spec section 7)
export const visionMonitoringRouter = Router();

visionMonitoringRouter.use(authenticate);

// GET /api/v1/monitoring/status?siteId=...
visionMonitoringRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const siteId = typeof req.query.siteId === "string" ? req.query.siteId : "";
    if (!siteId) throw new AppError(400, "VALIDATION_ERROR", "siteId is required.");
    res.json({ data: await getMonitoringStatus(req, siteId) });
  })
);

// POST /api/v1/monitoring/cameras/:cameraId/start
visionMonitoringRouter.post(
  "/cameras/:cameraId/start",
  asyncHandler(async (req, res) => {
    res.json({ data: { camera: await setCameraMonitoring(req, req.params.cameraId, true) } });
  })
);

// POST /api/v1/monitoring/cameras/:cameraId/stop
visionMonitoringRouter.post(
  "/cameras/:cameraId/stop",
  asyncHandler(async (req, res) => {
    res.json({ data: { camera: await setCameraMonitoring(req, req.params.cameraId, false) } });
  })
);