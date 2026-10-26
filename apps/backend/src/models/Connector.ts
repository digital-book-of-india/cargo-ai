import mongoose, { Schema, model, Document, Types } from "mongoose";
import { ConnectorStatus } from "@dbi/api-types";

export interface IConnectorDocument extends Document {
  _id: Types.ObjectId;
  shopId: Types.ObjectId;
  name: string;
  status: ConnectorStatus;
  pairingCode: string | null;
  pairingCodeExpiresAt: Date | null;
  tokenHash: string | null;
  lastHeartbeatAt: Date | null;
  lastSeenVersion: string | null;
  activeCameraCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const connectorSchema = new Schema<IConnectorDocument>(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["PENDING", "PAIRED", "REVOKED"],
      default: "PENDING",
    },
    pairingCode: { type: String, default: null, index: true },
    pairingCodeExpiresAt: { type: Date, default: null },
    tokenHash: { type: String, default: null, index: true },
    lastHeartbeatAt: { type: Date, default: null },
    lastSeenVersion: { type: String, default: null },
    activeCameraCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

export const ConnectorModel =
  (mongoose.models.Connector as mongoose.Model<IConnectorDocument>) ||
  model<IConnectorDocument>("Connector", connectorSchema);
