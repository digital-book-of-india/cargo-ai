import { Router, Request, Response } from "express";
import crypto from "crypto";
import { ConnectorModel } from "../../../models/Connector";
import { CameraModel } from "../../../models/Camera";
import { takePendingJobs, completeJob } from "../../../services/connectors/jobs";

export const connectorPairingRouter = Router();
export const connectorDeviceRouter = Router();

connectorPairingRouter.post("/", async (req: Request, res: Response) => {
  const { code, name, platform, version } = req.body ?? {};
  if (!code || typeof code !== "string") {
    res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Pairing code is required." } });
    return;
  }

  const connector = await ConnectorModel.findOne({
    pairingCode: code.trim(),
    pairingCodeExpiresAt: { $gt: new Date() },
  });

  if (!connector) {
    res.status(404).json({ error: { code: "INVALID_CODE", message: "Invalid or expired pairing code." } });
    return;
  }

  const rawToken = "dbi_conn_" + crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  connector.tokenHash = tokenHash;
  connector.pairingCode = undefined;
  connector.pairingCodeExpiresAt = undefined;
  connector.status = "ONLINE";
  connector.lastHeartbeatAt = new Date();
  if (name) connector.name = name;
  if (platform) connector.platform = platform;
  if (version) connector.version = version;
  await connector.save();

  res.json({ data: { token: rawToken, connectorId: connector._id.toString() } });
});

connectorDeviceRouter.post("/heartbeat", async (req: Request, res: Response) => {
  if (!req.connector) {
    res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    return;
  }

  await ConnectorModel.findByIdAndUpdate(req.connector.id, {
    status: "ONLINE",
    lastHeartbeatAt: new Date(),
    ...req.body,
  });

  res.json({ data: { ok: true } });
});

connectorDeviceRouter.get("/jobs", (req: Request, res: Response) => {
  if (!req.connector) {
    res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    return;
  }
  res.json({ data: { items: takePendingJobs(req.connector.id) } });
});

connectorDeviceRouter.post("/jobs/:jobId/result", (req: Request, res: Response) => {
  if (!req.connector) {
    res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    return;
  }
  const ok = completeJob(req.connector.id, req.params.jobId, req.body ?? {});
  res.json({ data: { ok } });
});

connectorDeviceRouter.get("/cameras", async (req: Request, res: Response) => {
  if (!req.connector) {
    res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    return;
  }
  const cameras = await CameraModel.find({ connectorId: req.connector.id });
  res.json({ data: { items: cameras } });
});
