import { Router, Request, Response, NextFunction } from "express";
import { authenticate, requireSiteAccess } from "../../../middleware/auth";
import { ConnectorModel } from "../../../models/Connector";
import { generatePairingCode } from "../../../services/connectors/manager";

export const siteConnectorsRouter = Router({ mergeParams: true });

siteConnectorsRouter.use(authenticate);

siteConnectorsRouter.get("/", ...requireSiteAccess("cameras:read"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const connectors = await ConnectorModel.find({ siteId: req.params.siteId }).sort({ createdAt: -1 });
    res.json({ data: { items: connectors } });
  } catch (err) {
    next(err);
  }
});

siteConnectorsRouter.post("/", ...requireSiteAccess("cameras:write"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body ?? {};
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Connector name is required." } });
      return;
    }

    const { code, expiresAt } = generatePairingCode();
    const connector = await ConnectorModel.create({
      siteId: req.params.siteId,
      name: name.trim(),
      tokenHash: "pending_pairing",
      pairingCode: code,
      pairingCodeExpiresAt: expiresAt,
      status: "OFFLINE",
    });

    res.status(201).json({
      data: {
        connector: {
          id: connector._id.toString(),
          name: connector.name,
          pairingCode: code,
          pairingCodeExpiresAt: expiresAt.toISOString(),
          status: connector.status,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});
