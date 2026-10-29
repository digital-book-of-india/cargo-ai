import { Schema, model, Document, Types } from "mongoose";

export type ConnectorStatus = "ONLINE" | "OFFLINE" | "DEGRADED";

export interface IConnectorDocument extends Document {
  siteId: Types.ObjectId;
  name: string;
  tokenHash: string;
  pairingCode?: string;
  pairingCodeExpiresAt?: Date;
  status: ConnectorStatus;
  lastHeartbeatAt?: Date;
  version?: string;
  platform?: string;
  localIp?: string;
  publicIp?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ConnectorSchema = new Schema<IConnectorDocument>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true, index: true },
    name: { type: String, required: true },
    tokenHash: { type: String, required: true },
    pairingCode: { type: String, sparse: true },
    pairingCodeExpiresAt: { type: Date },
    status: { type: String, enum: ["ONLINE", "OFFLINE", "DEGRADED"], default: "OFFLINE" },
    lastHeartbeatAt: { type: Date },
    version: { type: String },
    platform: { type: String },
    localIp: { type: String },
    publicIp: { type: String },
  },
  { timestamps: true }
);

export function isConnectorOnline(connector: { status?: string; lastHeartbeatAt?: Date } | null): boolean {
  if (!connector || connector.status !== "ONLINE") return false;
  if (!connector.lastHeartbeatAt) return false;
  return Date.now() - new Date(connector.lastHeartbeatAt).getTime() < 60000;
}

export const ConnectorModel = model<IConnectorDocument>("Connector", ConnectorSchema);
