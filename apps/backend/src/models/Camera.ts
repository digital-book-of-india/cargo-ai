import mongoose, { Schema, model, Document, Types } from "mongoose";
import { CameraStatus } from "@dbi/api-types";

export interface ICameraDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  siteId: Types.ObjectId;
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
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true, index: true },
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

// A camera name is unique within a site, whatever the capitals: two "Gate cam" at one site cannot be told apart in
// alerts and reports. The same name at another site is fine.
cameraSchema.index({ siteId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });

export const CameraModel =
  (mongoose.models.Camera as mongoose.Model<ICameraDocument>) ||
  model<ICameraDocument>("Camera", cameraSchema);

