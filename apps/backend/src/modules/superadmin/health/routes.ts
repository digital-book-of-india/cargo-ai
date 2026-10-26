import { Router, Request, Response } from "express";
import {
  requireAdmin,
  adminRateLimiter,
  sendSuccess,
  sendError,
  AuthenticatedAdminRequest,
} from "../../../middleware/adminAuth";
import { CameraModel, AiWorkerHealthModel } from "../../../models";
import {
  parsePagination,
  sanitizeString,
  computeEffectiveCameraStatus,
  getAiWorkerHealthSnapshot,
} from "../../../utils/adminHelpers";

export const adminHealthRouter = Router();

adminHealthRouter.use(adminRateLimiter);
adminHealthRouter.use(requireAdmin);

const VALID_STATUSES = ["ONLINE", "DEGRADED", "OFFLINE", "ERROR", "PENDING_TEST"];

adminHealthRouter.get("/", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const status = sanitizeString(req.query.status);
    const staleThreshold = Number(process.env.CAMERA_STALE_SECONDS ?? 120);
    const workerStaleThreshold = Number(process.env.WORKER_STALE_SECONDS ?? 60);

    if (status && status !== "ALL" && !VALID_STATUSES.includes(status)) {
      return sendError(res, "INVALID_QUERY", "Invalid status query filter.", 400, requestId);
    }

    const aiWorker = await getAiWorkerHealthSnapshot(AiWorkerHealthModel, workerStaleThreshold);

    // Scan cameras and evaluate truthful status in-memory for pagination and effective filtering
    const allCameras = await CameraModel.find({})
      .sort({ updatedAt: -1, _id: -1 })
      .populate("shopId", "name demo demoFlag")
      .lean();

    const mapped = allCameras.map((cam: any) => {
      const { effectiveStatus, isStale } = computeEffectiveCameraStatus(
        cam.status,
        cam.lastHealthAt,
        cam.lastFrameAt,
        staleThreshold
      );

      return {
        cameraId: cam._id,
        shopId: cam.shopId?._id || cam.shopId,
        shopName: cam.shopId?.name || "Unknown Shop",
        demoFlag: Boolean((cam.shopId as any)?.demo ?? (cam.shopId as any)?.demoFlag),
        name: cam.name,
        protocol: cam.protocol,
        rawStatus: cam.status,
        effectiveStatus,
        isStale,
        lastFrameAt: cam.lastFrameAt,
        lastHealthAt: cam.lastHealthAt,
        lastErrorCode: cam.lastErrorCode,
      };
    });

    const filtered =
      status && status !== "ALL"
        ? mapped.filter((c: any) => c.effectiveStatus === status)
        : mapped;

    const total = filtered.length;
    const paginatedCameras = filtered.slice(skip, skip + limit);

    return sendSuccess(
      res,
      { aiWorker, cameras: paginatedCameras },
      { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminHealthError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to retrieve camera health metrics.", 500, requestId);
  }
});