import crypto from "crypto";
import { env } from "../../config/env";
import { ConnectorModel, IConnectorDocument, isConnectorOnline } from "../../models/Connector";

export interface ConnectorDto {
  id: string;
  siteId: string;
  name: string;
  status: string;
  version?: string;
  platform?: string;
  lastHeartbeatAt?: string;
}

export function generatePairingCode(): { code: string; expiresAt: Date } {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + (env.connectorPairingCodeTtlMinutes || 15) * 60 * 1000);
  return { code, expiresAt };
}

export function generateConnectorToken(): { rawToken: string; tokenHash: string } {
  const rawToken = "dbi_conn_" + crypto.randomBytes(24).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  return { rawToken, tokenHash };
}

export { isConnectorOnline };
