import mongoose, { Schema, model, Document, Types } from "mongoose";

// Only counted rows are stored here. The unique (zoneId, trackId) index enforces
// "counted once per track per zone" at the database level, even under concurrent retries.
export interface IVisionCountLedgerDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  eventKey: string;
  siteId: Types.ObjectId;
  cameraId: Types.ObjectId;
  zoneId: Types.ObjectId;
  trackId: string;
  direction: "IN" | "OUT" | "UNKNOWN";
  countDelta: number;
  confidence: number | null;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const visionCountLedgerSchema = new Schema<IVisionCountLedgerDocument>(
  {
    eventKey: { type: String, required: true, maxlength: 200 },
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true, index: true },
    cameraId: { type: Schema.Types.ObjectId, ref: "Camera", required: true, index: true },
    zoneId: { type: Schema.Types.ObjectId, ref: "VisionZone", required: true },
    trackId: { type: String, required: true, maxlength: 160 },
    direction: { type: String, enum: ["IN", "OUT", "UNKNOWN"], required: true },
    countDelta: { type: Number, required: true, min: 1, max: 1, default: 1 },
    confidence: { type: Number, min: 0, max: 1, default: null },
    occurredAt: { type: Date, required: true },
  },
  { collection: "vision_count_ledger", timestamps: true }
);

visionCountLedgerSchema.index({ companyId: 1, eventKey: 1 }, { unique: true });
visionCountLedgerSchema.index({ zoneId: 1, trackId: 1 }, { unique: true });
visionCountLedgerSchema.index({ siteId: 1, occurredAt: -1 });
visionCountLedgerSchema.index({ zoneId: 1, occurredAt: -1 });

export const VisionCountLedgerModel =
  (mongoose.models.VisionCountLedger as mongoose.Model<IVisionCountLedgerDocument>) ||
  model<IVisionCountLedgerDocument>("VisionCountLedger", visionCountLedgerSchema);