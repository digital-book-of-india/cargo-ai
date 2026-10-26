import mongoose, { Schema, model, Document, Types } from "mongoose";
import { CameraStatus } from "@dbi/api-types";

export interface ICameraDocument extends Document {
  _id: Types.ObjectId;
  shopId: Types.ObjectId;
  connectorId: Types.ObjectId | null;
  name: string;
  protocol: "RTSP" | "ONVIF";
  secretRef: string;
  status: CameraStatus;
  lastFrameAt?: Date | null;
  lastHealthAt?: Date | null;
  lastErrorCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const cameraSchema = new Schema<ICameraDocument>(
  {
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    connectorId: { type: Schema.Types.ObjectId, ref: "Connector", default: null, index: true },
    name: { type: String, required: true, trim: true },
    protocol: { type: String, enum: ["RTSP", "ONVIF"], required: true },
    secretRef: { type: String, required: true },
    status: {
      type: String,
      enum: ["PENDING_TEST", "ONLINE", "OFFLINE", "ERROR"],
      default: "PENDING_TEST",
    },
    lastFrameAt: { type: Date, default: null },
    lastHealthAt: { type: Date, default: null },
    lastErrorCode: { type: String, default: null },
  },
  {
    timestamps: true,
  }
);

export const CameraModel =
  (mongoose.models.Camera as mongoose.Model<ICameraDocument>) ||
  model<ICameraDocument>("Camera", cameraSchema);

