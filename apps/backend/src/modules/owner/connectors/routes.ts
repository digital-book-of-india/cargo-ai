import { Router, Request, Response, NextFunction } from "express";
import { createConnectorSchema } from "@dbi/validation";
import { ConnectorModel, ShopModel } from "../../../models";
import { authenticate, requireShopAccess, requireConnectorAccess } from "../../../middleware/auth";
import {
  generatePairingCode,
  pairingCodeExpiry,
  sanitizeConnector,
  sanitizeConnectorWithPairingCode,
} from "../../../services/connectors/manager";

// Mounted at /api/v1/shops -> /:shopId/connectors
export const shopConnectorsRouter = Router();
// Mounted at /api/v1/connectors -> /:connectorId, /:connectorId/pairing-code
export const connectorRouter = Router();

// POST /api/v1/shops/:shopId/connectors
// Creates a new Connector record in PENDING state and returns its pairing code.
// The web admin's "New Connector" button calls this.
shopConnectorsRouter.post(
  "/:shopId/connectors",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = createConnectorSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid connector",
            requestId: req.requestId,
          },
        });
        return;
      }

      const shop = await ShopModel.findById(req.params.shopId);
      if (!shop) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Shop not found.", requestId: req.requestId },
        });
        return;
      }

      const connector = await ConnectorModel.create({
        shopId: shop._id,
        name: parseResult.data.name,
        status: "PENDING",
        pairingCode: generatePairingCode(),
        pairingCodeExpiresAt: pairingCodeExpiry(),
      });

      res.status(201).json({ data: { connector: sanitizeConnectorWithPairingCode(connector) } });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/shops/:shopId/connectors
shopConnectorsRouter.get(
  "/:shopId/connectors",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connectors = await ConnectorModel.find({ shopId: req.params.shopId }).sort({ createdAt: -1 });
      res.json({ data: { items: connectors.map(sanitizeConnector) } });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/connectors/:connectorId/pairing-code
// Issues a fresh pairing code (e.g. the old one expired, or the PC needs re-pairing).
connectorRouter.post(
  "/:connectorId/pairing-code",
  authenticate,
  requireConnectorAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connector = await ConnectorModel.findById(req.params.connectorId);
      if (!connector) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Connector not found.", requestId: req.requestId },
        });
        return;
      }

      connector.status = "PENDING";
      connector.pairingCode = generatePairingCode();
      connector.pairingCodeExpiresAt = pairingCodeExpiry();
      connector.tokenHash = null;
      await connector.save();

      res.json({ data: { connector: sanitizeConnectorWithPairingCode(connector) } });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/connectors/:connectorId
// Revokes the connector's token - it will stop being able to heartbeat or fetch cameras.
connectorRouter.delete(
  "/:connectorId",
  authenticate,
  requireConnectorAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connector = await ConnectorModel.findByIdAndUpdate(req.params.connectorId, {
        status: "REVOKED",
        tokenHash: null,
        pairingCode: null,
        pairingCodeExpiresAt: null,
      });
      if (!connector) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Connector not found.", requestId: req.requestId },
        });
        return;
      }
      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
);
