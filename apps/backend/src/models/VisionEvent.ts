import mongoose, { Schema, model, Document, Types } from "mongoose";
import type { VisionEventType } from "@dbi/api-types";

export const VISION_EVENT_TYPE_VALUES: VisionEventType[] = [
  "package_detected",
  "package_line_crossing",
  "zone_entry",
  "zone_exit",
  "restricted_zone_movement",
  "unusual_after_hours_movement",
  "count_mismatch",
  "possible_package_damage",
  "possible_seal_appearance_change",
  "camera_offline",
  "ai_service_unavailable",
];

export interface IVisionEventDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  eventKey: string; // idempotency key, globally unique
  payloadHash: string; // sha256 of the normalised payload, to detect key reuse
  siteId: Types.ObjectId; // site (tenant key)
  cameraId: Types.ObjectId;
  zoneId: Types.ObjectId | null;
  eventType: VisionEventType;
  occurredAt: Date;
  track: unknown;
  movement: unknown; // includes requestedCountDelta, countDelta, suppressedReason
  evidence: unknown;
  detector: unknown; // { name, version }
  createdAt: Date;
  updatedAt: Date;
}

const visionEventSchema = new Schema<IVisionEventDocument>(
  {
    eventKey: { type: String, required: true, maxlength: 200 },
    payloadHash: { type: String, required: true },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true, index: true },
    cameraId: { type: Schema.Types.ObjectId, ref: "Camera", required: true, index: true },
    zoneId: { type: Schema.Types.ObjectId, ref: "VisionZone", default: null, index: true },
    eventType: { type: String, enum: VISION_EVENT_TYPE_VALUES, required: true, index: true },
    occurredAt: { type: Date, required: true },
    track: { type: Schema.Types.Mixed, default: null },
    movement: { type: Schema.Types.Mixed, default: null },
    evidence: { type: Schema.Types.Mixed, default: null },
    detector: { type: Schema.Types.Mixed, default: null },
  },
  { collection: "vision_events", timestamps: true }
);

visionEventSchema.index({ companyId: 1, eventKey: 1 }, { unique: true });
visionEventSchema.index({ siteId: 1, occurredAt: -1 });

export const VisionEventModel =
  (mongoose.models.VisionEvent as mongoose.Model<IVisionEventDocument>) ||
  model<IVisionEventDocument>("VisionEvent", visionEventSchema);