import { Request, Response, NextFunction } from "express";
import { ConnectorModel } from "../models";
import { hashConnectorToken } from "../services/connectors/manager";

// Per-connector auth: unlike serviceAuth (one shared AI_SERVICE_TOKEN for the whole
// ai-worker), every paired Connector has its own secret. The raw token only ever exists
// on the connector's disk and in the pairing response; the DB holds just its SHA-256 hash.
export async function connectorAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const tokenHeader = req.headers["x-connector-token"];
  const authHeader = req.headers.authorization;

  let token: string | undefined;
  if (typeof tokenHeader === "string") {
    token = tokenHeader;
  } else if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7);
  }

  if (!token) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Missing connector token.",
        requestId: req.requestId,
      },
    });
    return;
  }

  try {
    const connector = await ConnectorModel.findOne({
      tokenHash: hashConnectorToken(token),
      status: "PAIRED",
    });

    if (!connector) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or revoked connector token.",
          requestId: req.requestId,
        },
      });
      return;
    }

    req.connector = { id: connector._id.toString(), shopId: connector.shopId.toString() };
    next();
  } catch (err) {
    next(err);
  }
}
