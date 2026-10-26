import { Router, Request, Response, NextFunction } from "express";
import { CameraModel, ZoneModel } from "../../../models";
import { decryptSecret } from "../../../services/secrets/manager";

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
// The ONLY place the decrypted RTSP URL is ever handed out — service-auth only, never to a browser.
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

      const zone = await ZoneModel.findOne({ cameraId: camera._id });
      const streamUrl = decryptSecret(camera.secretRef);

      res.json({
        data: {
          cameraId: camera._id.toString(),
          companyId: camera.companyId.toString(),
          siteId: camera.siteId.toString(),
          streamUrl,
          zone: zone
            ? {
                zoneType: zone.zoneType,
                polygon: zone.polygon,
                sensitivity: zone.sensitivity,
                enabled: zone.enabled,
              }
            : null,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
