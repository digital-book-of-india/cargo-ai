import { Router, Request, Response, NextFunction } from "express";
import { pairConnectorSchema, connectorHeartbeatSchema } from "@dbi/validation";
import { ConnectorModel, CameraModel, ShopModel } from "../../../models";
import { decryptSecret } from "../../../services/secrets/manager";
import {
  generateConnectorToken,
  hashConnectorToken,
} from "../../../services/connectors/manager";

// Mounted at /internal/v1/connectors with NO auth - this is how an unpaired Connector
// first proves it holds a valid, unexpired pairing code generated in the web admin.
export const connectorPairingRouter = Router();

// POST /internal/v1/connectors/pair
connectorPairingRouter.post("/pair", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = pairConnectorSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message ?? "Invalid pairing request",
          requestId: req.requestId,
        },
      });
      return;
    }

    const pairingCode = parseResult.data.pairingCode.trim().toUpperCase();
    const connector = await ConnectorModel.findOne({ pairingCode, status: "PENDING" });

    if (!connector || !connector.pairingCodeExpiresAt || connector.pairingCodeExpiresAt < new Date()) {
      res.status(400).json({
        error: {
          code: "INVALID_PAIRING_CODE",
          message: "This pairing code is invalid or has expired. Generate a new one in the web admin.",
          requestId: req.requestId,
        },
      });
      return;
    }

    const shop = await ShopModel.findById(connector.shopId).select("name");

    const connectorToken = generateConnectorToken();
    connector.tokenHash = hashConnectorToken(connectorToken);
    connector.status = "PAIRED";
    connector.pairingCode = null;
    connector.pairingCodeExpiresAt = null;
    await connector.save();

    res.json({
      data: {
        connectorId: connector._id.toString(),
        connectorToken,
        shopId: connector.shopId.toString(),
        shopName: shop?.name ?? "",
      },
    });
  } catch (err) {
    next(err);
  }
});

// Mounted at /internal/v1/connectors behind connectorAuth - everything a paired Connector
// calls for the rest of its life (heartbeat, camera sync).
export const connectorDeviceRouter = Router();

// POST /internal/v1/connectors/heartbeat
connectorDeviceRouter.post("/heartbeat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = connectorHeartbeatSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message ?? "Invalid heartbeat",
          requestId: req.requestId,
        },
      });
      return;
    }

    const { version, activeCameraCount } = parseResult.data;
    await ConnectorModel.findByIdAndUpdate(req.connector!.id, {
      lastHeartbeatAt: new Date(),
      lastSeenVersion: version,
      ...(activeCameraCount !== undefined ? { activeCameraCount } : {}),
    });

    res.json({ data: { status: "OK" } });
  } catch (err) {
    next(err);
  }
});

// GET /internal/v1/connectors/cameras
// The only place a Connector gets decrypted RTSP URLs - scoped to just its own cameras.
connectorDeviceRouter.get("/cameras", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const cameras = await CameraModel.find({ connectorId: req.connector!.id });

    res.json({
      data: {
        items: cameras.map((cam) => ({
          cameraId: cam._id.toString(),
          shopId: cam.shopId.toString(),
          name: cam.name,
          protocol: cam.protocol,
          streamUrl: decryptSecret(cam.secretRef),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
});
