import mongoose, { Schema, model, Document, Types } from "mongoose";
import { ZoneType, ZoneSensitivity, Point } from "@dbi/api-types";

export interface IZoneDocument extends Document {
  _id: Types.ObjectId;
  cameraId: Types.ObjectId;
  companyId: Types.ObjectId;
  siteId: Types.ObjectId;
  zoneType: ZoneType;
  polygon: Point[];
  sensitivity: ZoneSensitivity;
  enabled: boolean;
  updatedAt: Date;
}

const pointSchema = new Schema(
  {
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false }
);

const zoneSchema = new Schema<IZoneDocument>(
  {
    cameraId: { type: Schema.Types.ObjectId, ref: "Camera", required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true, index: true },
    zoneType: {
      type: String,
      enum: ["SHUTTER", "GATE", "ENTRANCE", "CUSTOM"],
      default: "SHUTTER",
      required: true,
    },
    polygon: { type: [pointSchema], required: true },
    sensitivity: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH"],
      default: "MEDIUM",
      required: true,
    },
    enabled: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

export const ZoneModel =
  (mongoose.models.Zone as mongoose.Model<IZoneDocument>) ||
  model<IZoneDocument>("Zone", zoneSchema);

