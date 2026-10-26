import mongoose, { Schema, model, Document, Types } from "mongoose";
import type { VisionStreamStatus } from "@dbi/api-types";

// One row per camera. "enabled" is the flag the worker reads (via worker config).
export interface IVisionCameraMonitorDocument extends Document {
  _id: Types.ObjectId;
  siteId: Types.ObjectId;
  cameraId: Types.ObjectId;
  enabled: boolean;
  enabledAt: Date | null;
  disabledAt: Date | null;
  streamStatus: VisionStreamStatus;
  streamErrorCode: string | null;
  lastFrameAt: Date | null;
  frameRate: number | null;
  workerId: string | null;
  lastReportedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const visionCameraMonitorSchema = new Schema<IVisionCameraMonitorDocument>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true, index: true },
    cameraId: { type: Schema.Types.ObjectId, ref: "Camera", required: true, unique: true },
    enabled: { type: Boolean, default: false, index: true },
    enabledAt: { type: Date, default: null },
    disabledAt: { type: Date, default: null },
    streamStatus: {
      type: String,
      enum: ["UNKNOWN", "STREAMING", "RECONNECTING", "ERROR"],
      default: "UNKNOWN",
    },
    streamErrorCode: { type: String, default: null },
    lastFrameAt: { type: Date, default: null },
    frameRate: { type: Number, default: null },
    workerId: { type: String, default: null },
    lastReportedAt: { type: Date, default: null },
  },
  { collection: "vision_camera_monitors", timestamps: true }
);

export const VisionCameraMonitorModel =
  (mongoose.models.VisionCameraMonitor as mongoose.Model<IVisionCameraMonitorDocument>) ||
  model<IVisionCameraMonitorDocument>("VisionCameraMonitor", visionCameraMonitorSchema);