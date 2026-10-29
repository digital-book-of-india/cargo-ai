import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { ConnectorModel } from "../models/Connector";

declare global {
  namespace Express {
    interface Request {
      connector?: {
        id: string;
        siteId: string;
      };
    }
  }
}

const lastTouch = new Map<string, number>();
const TOUCH_EVERY_MS = 15000;

export async function connectorAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing connector token." } });
    return;
  }

  const token = header.slice(7).trim();
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const connector = await ConnectorModel.findOne({ tokenHash });
  if (!connector) {
    res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid connector token." } });
    return;
  }

  req.connector = {
    id: connector._id.toString(),
    siteId: connector.siteId.toString(),
  };

  const now = Date.now();
  if (now - (lastTouch.get(req.connector.id) ?? 0) > TOUCH_EVERY_MS) {
    lastTouch.set(req.connector.id, now);
    void ConnectorModel.findByIdAndUpdate(connector._id, {
      status: "ONLINE",
      lastHeartbeatAt: new Date(now),
    }).catch(() => undefined);
  }

  next();
}
