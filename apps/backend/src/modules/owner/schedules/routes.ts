import { Router, Request, Response, NextFunction } from "express";
import { scheduleSchema, manualOverrideSchema } from "@dbi/validation";
import { MonitoringState } from "@dbi/api-types";
import { ScheduleModel, ShopModel, SecurityStateModel, CameraModel } from "../../../models";
import { authenticate, requireShopAccess } from "../../../middleware/auth";
import { evaluateShopSecurityState } from "../../../services/security-state/evaluator";
import { getAiWorkerHealth } from "../../../services/ai/health";
import { logAuditEvent } from "../../../services/audit/logger";

export const schedulesRouter = Router();

// GET /api/v1/shops/:shopId/schedule
schedulesRouter.get(
  "/:shopId/schedule",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schedule = await ScheduleModel.findOne({ shopId: req.params.shopId });
      if (!schedule) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Schedule not found for this shop.",
            requestId: req.requestId,
          },
        });
        return;
      }

      res.json({
        data: {
          shopId: schedule.shopId.toString(),
          weeklySchedule: schedule.weeklySchedule,
          gracePeriodMinutes: schedule.gracePeriodMinutes,
          exceptions: schedule.exceptions,
          version: schedule.version,
          updatedAt: schedule.updatedAt?.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/shops/:shopId/schedule
schedulesRouter.put(
  "/:shopId/schedule",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = scheduleSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid schedule data",
            requestId: req.requestId,
          },
        });
        return;
      }

      const shop = await ShopModel.findById(req.params.shopId);
      if (!shop) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Shop not found.",
            requestId: req.requestId,
          },
        });
        return;
      }

      const { weeklySchedule, gracePeriodMinutes } = parseResult.data;

      const schedule = await ScheduleModel.findOneAndUpdate(
        { shopId: shop._id },
        {
          shopId: shop._id,
          weeklySchedule,
          gracePeriodMinutes: gracePeriodMinutes ?? 5,
          $inc: { version: 1 },
        },
        { upsert: true, new: true }
      );

      // Re-evaluate security state immediately
      const securityState = await evaluateShopSecurityState(shop._id);

      res.json({
        data: {
          shopId: shop._id.toString(),
          timezone: shop.timezone,
          version: schedule.version,
          nextTransitionAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          securityState,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/shops/:shopId/security-state
schedulesRouter.get(
  "/:shopId/security-state",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const securityState = await evaluateShopSecurityState(req.params.shopId);
      res.json({ data: securityState });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/shops/:shopId/override
schedulesRouter.post(
  "/:shopId/override",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = manualOverrideSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid override parameters",
            requestId: req.requestId,
          },
        });
        return;
      }

      const { action, reason, durationMinutes } = parseResult.data;
      const desiredState = action === "ARM" ? "ARMED" : "DISARMED";
      const duration = durationMinutes ?? 60;
      const overrideUntil = new Date(Date.now() + duration * 60 * 1000);

      await logAuditEvent({
        actorUserId: req.user!.id,
        action: `MANUAL_OVERRIDE_${action}`,
        targetType: "SHOP",
        targetId: req.params.shopId,
        reason: `${reason} (Duration: ${duration}m)`,
        requestId: req.requestId,
      });

      // Health Gating for Manual Override (Truthfulness Engine)
      const [cameras, aiHealth] = await Promise.all([
        CameraModel.find({ shopId: req.params.shopId }),
        getAiWorkerHealth(),
      ]);

      const onlineCameras = cameras.filter((cam) => cam.status === "ONLINE");
      const cameraHealthy = onlineCameras.length > 0;
      const cameraState = cameras.length === 0 ? "NO_CAMERA" : (cameraHealthy ? "ONLINE" : (cameras[0]?.status ?? "OFFLINE"));
      const aiHealthy = aiHealth.status === "ONLINE";

      let actualMonitoringState: MonitoringState = "DISARMED";

      if (desiredState === "ARMED") {
        if (cameras.length === 0) {
          actualMonitoringState = "SETUP_REQUIRED";
        } else if (cameraHealthy && aiHealthy) {
          actualMonitoringState = "MONITORING";
        } else if (!cameraHealthy && !aiHealthy) {
          actualMonitoringState = "OFFLINE";
        } else if (!cameraHealthy) {
          actualMonitoringState = "OFFLINE";
        } else {
          actualMonitoringState = "DEGRADED";
        }
      } else {
        actualMonitoringState = "DISARMED";
      }

      const updated = await SecurityStateModel.findOneAndUpdate(
        { shopId: req.params.shopId },
        {
          shopId: req.params.shopId,
          desiredState,
          actualMonitoringState,
          cameraState,
          aiWorkerState: aiHealth.status,
          reason: `MANUAL_OVERRIDE: ${reason}`,
          overrideUntil,
          evaluatedAt: new Date(),
          changedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      res.json({
        data: {
          shopId: req.params.shopId,
          desiredState: updated.desiredState,
          actualMonitoringState: updated.actualMonitoringState,
          cameraState: updated.cameraState,
          aiWorkerState: updated.aiWorkerState,
          reason: updated.reason,
          overrideUntil: updated.overrideUntil?.toISOString(),
          evaluatedAt: updated.evaluatedAt.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
