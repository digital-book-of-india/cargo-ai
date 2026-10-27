import { Router, Request, Response, NextFunction } from "express";
import { CameraModel, VisionZoneModel } from "../../../models";
import { logAuditEvent } from "../../../services/audit/logger";
import { decryptSecret } from "../../../services/secrets/manager";

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

// GET /internal/v1/cameras/:cameraId/stream-config
// The ONLY place the decrypted RTSP URL is ever handed out - service-auth only, never to a browser.
internalCamerasRouter.get(
  "/:cameraId/stream-config",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await CameraModel.findById(req.params.cameraId);
      if (!camera) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Camera not found.", requestId: req.requestId },
        });
        return;
      }

      const zones = await VisionZoneModel.find({ cameraId: camera._id, status: "active" }).lean();
      const streamUrl = decryptSecret(camera.secretRef);
      await noteCredentialRead(camera, req.requestId);

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

