import mongoose, { Schema, model, Document, Types } from "mongoose";
import { DesiredSecurityState, MonitoringState } from "@dbi/api-types";

export interface ISecurityStateDocument extends Document {
  _id: Types.ObjectId;
  shopId: Types.ObjectId;
  desiredState: DesiredSecurityState;
  actualMonitoringState: MonitoringState;
  cameraState: string;
  aiWorkerState: string;
  reason: string;
  scheduleVersion: number;
  overrideUntil?: Date | null;
  changedAt: Date;
  evaluatedAt: Date;
}

const securityStateSchema = new Schema<ISecurityStateDocument>(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, unique: true, index: true },
    desiredState: {
      type: String,
      enum: ["ARMED", "DISARMED"],
      default: "DISARMED",
      required: true,
    },
    actualMonitoringState: {
      type: String,
      enum: ["MONITORING", "DISARMED", "DEGRADED", "OFFLINE", "SETUP_REQUIRED"],
      default: "SETUP_REQUIRED",
      required: true,
    },
    cameraState: { type: String, default: "UNKNOWN" },
    aiWorkerState: { type: String, default: "UNKNOWN" },
    reason: { type: String, default: "INITIAL_STATE" },
    scheduleVersion: { type: Number, default: 1 },
    overrideUntil: { type: Date, default: null },
    changedAt: { type: Date, default: Date.now },
    evaluatedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

export const SecurityStateModel =
  (mongoose.models.SecurityState as mongoose.Model<ISecurityStateDocument>) ||
  model<ISecurityStateDocument>("SecurityState", securityStateSchema);

