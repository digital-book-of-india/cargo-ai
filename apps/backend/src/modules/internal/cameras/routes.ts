import express, { Router, Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { CameraModel, VisionZoneModel } from "../../../models";
import { logAuditEvent } from "../../../services/audit/logger";
import { decryptSecret } from "../../../services/secrets/manager";
import { wantedLive, storeFrame } from "../../../services/camera/live";

// Handing out a decrypted camera address is the most sensitive thing the API does for the AI worker, so it leaves a
// trace in the owning company's audit trail. One entry per camera and hour: the worker asks every few seconds.
const CREDENTIAL_AUDIT_INTERVAL_MS = 60 * 60_000;
const lastCredentialAudit = new Map<string, number>();
async function noteCredentialRead(camera: { _id: { toString(): string }; companyId?: { toString(): string } | null }, requestId?: string): Promise<void> {
  const id = camera._id.toString();
  const last = lastCredentialAudit.get(id) ?? 0;
  if (Date.now() - last < CREDENTIAL_AUDIT_INTERVAL_MS) return;
  lastCredentialAudit.set(id, Date.now());
  await logAuditEvent({
    actorUserId: null,
    companyId: camera.companyId ? camera.companyId.toString() : null,
    action: "CAMERA_CREDENTIALS_READ",
    targetType: "Camera",
    targetId: id,
    requestId,
    metadata: { by: "ai-worker (service token)" },
  });
}

export const internalCamerasRouter = Router();

// GET /internal/v1/cameras
// Lets the AI worker discover which cameras exist (no secrets here).
internalCamerasRouter.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cameras = await CameraModel.find({}).select("_id companyId siteId name protocol status");
    res.json({
      data: {
        items: cameras.map((c) => ({
          cameraId: c._id.toString(),
          companyId: c.companyId.toString(),
          siteId: c.siteId.toString(),
          name: c.name,
          protocol: c.protocol,
          status: c.status,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /internal/v1/cameras/live-wanted
// Informs the AI worker which cameras currently have an active viewer
internalCamerasRouter.get("/live-wanted", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const cameras = await CameraModel.find({}).select("_id");
    res.json({ data: { cameraIds: wantedLive(cameras.map((c) => c._id.toString())) } });
  } catch (err) {
    next(err);
  }
});

// POST /internal/v1/cameras/:cameraId/live-frame (body: raw image/jpeg)
// AI worker streams latest frame directly into memory buffer
internalCamerasRouter.post(
  "/:cameraId/live-frame",
  express.raw({ type: "image/jpeg", limit: "2mb" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { cameraId } = req.params;
      if (!Types.ObjectId.isValid(cameraId) || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({
          error: { code: "VALIDATION_ERROR", message: "A JPEG body and a valid cameraId are required.", requestId: (req as any).requestId },
        });
        return;
      }
      const camera = await CameraModel.findById(cameraId);
      if (!camera) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Camera not found.", requestId: (req as any).requestId },
        });
        return;
      }
      storeFrame(cameraId, req.body);
      const now = new Date();
      camera.lastFrameAt = now;
      camera.lastHealthAt = now;
      if (camera.status !== "ONLINE") {
        camera.status = "ONLINE";
        camera.lastErrorCode = null;
      }
      await camera.save();
      res.json({ data: { status: "OK" } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /internal/v1/cameras/:cameraId/status
// AI worker updates real reachability status based on RTSP decoder success
internalCamerasRouter.post("/:cameraId/status", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cameraId } = req.params;
    const { online, errorCode } = req.body ?? {};
    if (!Types.ObjectId.isValid(cameraId) || typeof online !== "boolean") {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "cameraId and boolean 'online' status are required.", requestId: (req as any).requestId },
      });
      return;
    }
    const update: Record<string, unknown> = {
      status: online ? "ONLINE" : "ERROR",
      lastHealthAt: new Date(),
      lastErrorCode: online ? null : errorCode ?? "STREAM_ERROR",
    };
    if (online) update.lastFrameAt = new Date();
    await CameraModel.updateOne({ _id: cameraId }, { $set: update });
    res.json({ data: { status: "OK" } });
  } catch (err) {
    next(err);
  }
});

// GET /internal/v1/cameras/:cameraId/stream-config
// The ONLY place the decrypted RTSP URL is ever handed out - service-auth only, never to a browser.
internalCamerasRouter.get(
  "/:cameraId/stream-config",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await CameraModel.findById(req.params.cameraId);
      if (!camera) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Camera not found.", requestId: (req as any).requestId },
        });
        return;
      }

      const zones = await VisionZoneModel.find({ cameraId: camera._id, status: "active" }).lean();
      const streamUrl = decryptSecret(camera.secretRef);
      await noteCredentialRead(camera, (req as any).requestId);

      res.json({
        data: {
          cameraId: camera._id.toString(),
          companyId: (camera.companyId || (camera as any).shopId || camera._id).toString(),
          siteId: (camera.siteId || (camera as any).shopId || camera._id).toString(),
          streamUrl,
          zones: zones.map((z) => ({ id: String(z._id), zoneType: z.zoneType, geometry: z.geometry, rules: z.rules })),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
