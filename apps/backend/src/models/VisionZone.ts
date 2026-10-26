import mongoose, { Schema, model, Document, Types } from "mongoose";
import type {
  VisionGeometry,
  VisionZoneRules,
  VisionZoneStatus,
  VisionZoneType,
  VisionZoneValidationStatus,
} from "@dbi/api-types";

export interface IVisionZoneDocument extends Document {
  _id: Types.ObjectId;
  siteId: Types.ObjectId; // site this zone belongs to; the tenant key
  cameraId: Types.ObjectId;
  name: string;
  zoneType: VisionZoneType;
  geometry: VisionGeometry;
  rules: VisionZoneRules;
  status: VisionZoneStatus;
  validationStatus: VisionZoneValidationStatus;
  validationIssues: string[];
  validatedHash: string | null; // hash of the config that last passed validation
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const visionZoneSchema = new Schema<IVisionZoneDocument>(
  {
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true, index: true },
    cameraId: { type: Schema.Types.ObjectId, ref: "Camera", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    zoneType: {
      type: String,
      enum: ["polygon", "counting_line", "loading_bay", "restricted", "storage"],
      required: true,
    },
    // Shape is validated by @dbi/validation before every write.
    geometry: { type: Schema.Types.Mixed, required: true },
    rules: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["draft", "active", "disabled", "archived"],
      default: "draft",
      index: true,
    },
    validationStatus: {
      type: String,
      enum: ["pending", "valid", "invalid"],
      default: "pending",
    },
    validationIssues: { type: [String], default: [] },
    validatedHash: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { collection: "vision_zones", timestamps: true }
);

visionZoneSchema.index({ siteId: 1, _id: 1 });
visionZoneSchema.index({ cameraId: 1, status: 1 });

export const VisionZoneModel =
  (mongoose.models.VisionZone as mongoose.Model<IVisionZoneDocument>) ||
  model<IVisionZoneDocument>("VisionZone", visionZoneSchema);