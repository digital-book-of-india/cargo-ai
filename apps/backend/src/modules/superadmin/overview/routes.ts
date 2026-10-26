import { Router, Request, Response } from "express";
import { requireAdmin, adminRateLimiter, sendSuccess, sendError, AuthenticatedAdminRequest } from "../../../middleware/adminAuth";
import { CompanyModel, SiteModel, CameraModel, CargoEventModel, AuditLogModel, AiWorkerHealthModel } from "../../../models";
import { computeEffectiveCameraStatus, getAiWorkerHealthSnapshot } from "../../../utils/adminHelpers";

export const adminOverviewRouter = Router();

adminOverviewRouter.use(adminRateLimiter);
adminOverviewRouter.use(requireAdmin);

adminOverviewRouter.get("/", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const staleThreshold = Number(process.env.CAMERA_STALE_SECONDS ?? 120);
    const workerStaleThreshold = Number(process.env.WORKER_STALE_SECONDS ?? 60);

    // 1. KPI Counts
    const [totalCompanies, suspendedCompanies, totalSites, activeSites, inactiveSites] = await Promise.all([
      CompanyModel.countDocuments().catch(() => 0),
      CompanyModel.countDocuments({ status: "SUSPENDED" }).catch(() => 0),
      SiteModel.countDocuments({ status: { $ne: "ARCHIVED" } }).catch(() => 0),
      SiteModel.countDocuments({ status: "ACTIVE" }).catch(() => 0),
      SiteModel.countDocuments({ status: "INACTIVE" }).catch(() => 0),
    ]);

    // 2. Truthful Platform Camera Online Calculation
    const allCameras = await CameraModel.find({}, "status lastHealthAt lastFrameAt").lean().catch(() => []);
    const totalCameras = allCameras.length;
    let onlineCameras = 0;

    for (const cam of allCameras) {
      const { effectiveStatus } = computeEffectiveCameraStatus(
        cam.status,
        cam.lastHealthAt,
        cam.lastFrameAt,
        staleThreshold
      );
      if (effectiveStatus === "ONLINE") onlineCameras++;
    }

    const cameraOnlineRate = totalCameras > 0 ? Math.round((onlineCameras / totalCameras) * 100) : null;

    // 4. Unreviewed Alerts
    const unreviewedAlerts = await CargoEventModel.countDocuments({ status: "open" }).catch(() => 0);

    // 5. Worker Status
    const aiWorker = await getAiWorkerHealthSnapshot(AiWorkerHealthModel, workerStaleThreshold);

    // 6. Recent 5 Events (Populate with safe fallback)
    let recentEvents: any[] = [];
    try {
      const recentEventsRaw = await CargoEventModel.find()
        .sort({ occurredAt: -1 })
        .limit(5)
        .populate("siteId", "name")
        .lean();

      recentEvents = (recentEventsRaw || []).map((ev: any) => ({
        eventId: String(ev._id),
        siteName: ev.siteId?.name || "Unknown Site",
        eventType: ev.eventType,
        occurredAt: ev.occurredAt ? new Date(ev.occurredAt).toISOString() : null,
        severity: ev.severity,
        status: ev.status,
        summary: ev.summary,
        demoFlag: Boolean(ev.demo),
      }));
    } catch {
      recentEvents = [];
    }

    // 7. Recent 5 Audit Logs (Populate with safe fallback)
    let recentAuditActivity: any[] = [];
    try {
      const recentAuditRaw = await AuditLogModel.find()
        .sort({ createdAt: -1 })
        .limit(5)
        .populate("actorUserId", "name email")
        .lean();

      recentAuditActivity = (recentAuditRaw || []).map((log: any) => ({
        actor: log.actorUserId
          ? { name: log.actorUserId.name || "Super Admin", email: log.actorUserId.email || "admin@dbi-intelligence.com" }
          : { name: "Unknown Actor", email: "N/A" },
        action: log.action,
        targetType: log.targetType,
        targetId: log.targetId,
        reason: log.reason,
        createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : null,
      }));
    } catch {
      recentAuditActivity = [];
    }

    return sendSuccess(
      res,
      {
        kpis: {
          totalCompanies,
          suspendedCompanies,
          totalSites,
          activeSites,
          inactiveSites,
          totalCameras,
          onlineCameras,
          cameraOnlineRate,
          unreviewedAlerts,
        },
        aiWorker,
        recentEvents,
        recentAuditActivity,
      },
      undefined,
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminOverviewError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to retrieve platform overview.", 500, requestId);
  }
});