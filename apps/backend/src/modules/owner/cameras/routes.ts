import { Router, Request, Response, NextFunction } from "express";
import net from "net";
import { cameraRegisterSchema, cameraUpdateSchema, zoneSchema } from "@dbi/validation";
import { CameraModel, ZoneModel, ShopModel } from "../../../models";
import { authenticate, requireShopAccess, requireCameraAccess } from "../../../middleware/auth";
import { encryptSecret, decryptSecret, sanitizeCamera, buildRtspUrl } from "../../../services/secrets/manager";
import { evaluateShopSecurityState } from "../../../services/security-state/evaluator";

// Mounted at /api/v1/shops -> /:shopId/cameras
export const shopCamerasRouter = Router();
// Mounted at /api/v1/cameras -> /:cameraId/test, /:cameraId, /:cameraId/zones
export const cameraRouter = Router();

// POST /api/v1/shops/:shopId/cameras
shopCamerasRouter.post(
  "/:shopId/cameras",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = cameraRegisterSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid camera registration",
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

      const { name, protocol, host, port, username, password, path } = parseResult.data;
      const streamUrl = buildRtspUrl({ protocol, host, port, username, password, path });

      const camera = await CameraModel.create({
        shopId: shop._id,
        name,
        protocol,
        secretRef: encryptSecret(streamUrl),
        status: "PENDING_TEST",
        lastFrameAt: null,
      });

      // Recalculate security state for shop
      await evaluateShopSecurityState(shop._id);

      res.status(201).json({
        data: {
          camera: sanitizeCamera(camera),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/shops/:shopId/cameras
shopCamerasRouter.get(
  "/:shopId/cameras",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cameras = await CameraModel.find({ shopId: req.params.shopId }).sort({ createdAt: -1 });
      res.json({
        data: {
          items: cameras.map(sanitizeCamera),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// Attempts a real TCP connection to the camera's RTSP host:port.
// Does not pull video frames (needs the Python/OpenCV worker for that) but proves the
// stream endpoint is reachable instead of always claiming ONLINE.
async function probeStreamReachability(streamUrl: string): Promise<{ reachable: boolean; errorCode?: string }> {
  let host: string;
  let port: number;
  try {
    const parsed = new URL(streamUrl);
    host = parsed.hostname;
    port = Number(parsed.port) || (parsed.protocol === "rtsp:" ? 554 : 80);
  } catch {
    return { reachable: false, errorCode: "INVALID_STREAM_URL" };
  }

  if (!host) return { reachable: false, errorCode: "INVALID_STREAM_URL" };

  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeoutMs = 4000;
    let settled = false;

    const finish = (result: { reachable: boolean; errorCode?: string }) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish({ reachable: true }));
    socket.once("timeout", () => finish({ reachable: false, errorCode: "CONNECTION_TIMEOUT" }));
    socket.once("error", () => finish({ reachable: false, errorCode: "CONNECTION_REFUSED" }));

    socket.connect(port, host);
  });
}

// POST /api/v1/cameras/:cameraId/test
cameraRouter.post(
  "/:cameraId/test",
  authenticate,
  requireCameraAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await CameraModel.findById(req.params.cameraId);
      if (!camera) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Camera not found.",
            requestId: req.requestId,
          },
        });
        return;
      }

      const streamUrl = decryptSecret(camera.secretRef);
      const { reachable, errorCode } = streamUrl
        ? await probeStreamReachability(streamUrl)
        : { reachable: false, errorCode: "NO_STREAM_URL" };

      const now = new Date();
      camera.status = reachable ? "ONLINE" : "ERROR";
      camera.lastHealthAt = now;
      camera.lastErrorCode = reachable ? null : errorCode ?? "UNREACHABLE";
      if (reachable) camera.lastFrameAt = now;
      await camera.save();

      // Recalculate shop security state
      await evaluateShopSecurityState(camera.shopId);

      res.json({
        data: {
          camera: sanitizeCamera(camera),
          message: reachable
            ? "Stream endpoint reachable. Feed marked online."
            : `Could not reach the camera stream (${camera.lastErrorCode}).`,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/cameras/:cameraId
cameraRouter.patch(
  "/:cameraId",
  authenticate,
  requireCameraAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = cameraUpdateSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid update payload",
            requestId: req.requestId,
          },
        });
        return;
      }

      const camera = await CameraModel.findById(req.params.cameraId);
      if (!camera) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Camera not found.",
            requestId: req.requestId,
          },
        });
        return;
      }

      const { name, protocol, host, port, username, password, path } = parseResult.data;
      if (name) camera.name = name;
      if (protocol) camera.protocol = protocol;
      if (host) {
        const streamUrl = buildRtspUrl({
          protocol: protocol ?? camera.protocol,
          host,
          port,
          username,
          password,
          path,
        });
        camera.secretRef = encryptSecret(streamUrl);
        camera.status = "PENDING_TEST";
      }

      await camera.save();

      res.json({
        data: {
          camera: sanitizeCamera(camera),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/cameras/:cameraId/zones
cameraRouter.put(
  "/:cameraId/zones",
  authenticate,
  requireCameraAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = zoneSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid zone definition",
            requestId: req.requestId,
          },
        });
        return;
      }

      const camera = await CameraModel.findById(req.params.cameraId);
      if (!camera) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Camera not found.",
            requestId: req.requestId,
          },
        });
        return;
      }

      const { zoneType, polygon, sensitivity, enabled } = parseResult.data;

      const zone = await ZoneModel.findOneAndUpdate(
        { cameraId: camera._id },
        {
          cameraId: camera._id,
          shopId: camera.shopId,
          zoneType,
          polygon,
          sensitivity,
          enabled,
        },
        { upsert: true, new: true }
      );

      res.json({
        data: {
          zone: {
            id: zone._id.toString(),
            cameraId: zone.cameraId.toString(),
            shopId: zone.shopId.toString(),
            zoneType: zone.zoneType,
            polygon: zone.polygon,
            sensitivity: zone.sensitivity,
            enabled: zone.enabled,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/cameras/:cameraId/zones
cameraRouter.get(
  "/:cameraId/zones",
  authenticate,
  requireCameraAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const zone = await ZoneModel.findOne({ cameraId: req.params.cameraId });
      if (!zone) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "No zone defined for this camera.",
            requestId: req.requestId,
          },
        });
        return;
      }

      res.json({
        data: {
          zone: {
            id: zone._id.toString(),
            cameraId: zone.cameraId.toString(),
            shopId: zone.shopId.toString(),
            zoneType: zone.zoneType,
            polygon: zone.polygon,
            sensitivity: zone.sensitivity,
            enabled: zone.enabled,
          },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/cameras/:cameraId
cameraRouter.delete(
  "/:cameraId",
  authenticate,
  requireCameraAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const camera = await CameraModel.findById(req.params.cameraId);
      if (!camera) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Camera not found.",
            requestId: req.requestId,
          },
        });
        return;
      }

      await CameraModel.findByIdAndDelete(camera._id);
      await ZoneModel.deleteMany({ cameraId: camera._id });

      // Recalculate security state for shop
      await evaluateShopSecurityState(camera.shopId);

      res.json({
        data: {
          id: camera._id.toString(),
          message: "Camera deleted successfully.",
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
