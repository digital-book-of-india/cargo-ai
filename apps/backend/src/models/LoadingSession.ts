import mongoose, { Schema, model, Document, Types } from "mongoose";
import type { ReconciliationStatus, SessionDirection } from "@dbi/api-types";

export interface ILoadingSessionDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  siteId: Types.ObjectId;
  zoneId?: Types.ObjectId | null;
  manifestId?: Types.ObjectId | null;
  vehicleId?: Types.ObjectId | null;
  direction: SessionDirection;
  startedAt: Date;
  closedAt?: Date | null;
  expectedCountSnapshot?: number | null;
  observedCount?: number | null;
  difference?: number | null;
  countsBreakdown?: { in: number; out: number } | null;
  reconciliationStatus: ReconciliationStatus;
  toleranceUsed?: number | null;
  closeNote?: string | null;
  coverageGap: boolean;
  mismatchEventId?: Types.ObjectId | null;
  createdBy?: Types.ObjectId;
  closedBy?: Types.ObjectId | null;
  createdAt: Date;
}

const loadingSessionSchema = new Schema<ILoadingSessionDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true },
    zoneId: { type: Schema.Types.ObjectId, ref: "VisionZone", default: null },
    manifestId: { type: Schema.Types.ObjectId, ref: "Manifest", default: null },
    vehicleId: { type: Schema.Types.ObjectId, ref: "Vehicle", default: null },
    direction: { type: String, enum: ["inbound", "outbound"], required: true },
    startedAt: { type: Date, required: true },
    closedAt: { type: Date, default: null },
    expectedCountSnapshot: { type: Number, min: 0, default: null },
    observedCount: { type: Number, min: 0, default: null },
    difference: { type: Number, default: null },
    countsBreakdown: { type: new Schema({ in: Number, out: Number }, { _id: false }), default: null },
    reconciliationStatus: {
      type: String,
      enum: ["not_started", "in_progress", "matched", "review_required", "closed_unverified"],
      default: "in_progress",
    },
    toleranceUsed: { type: Number, default: null },
    closeNote: { type: String, maxlength: 1000, default: null },
    coverageGap: { type: Boolean, default: false },
    mismatchEventId: { type: Schema.Types.ObjectId, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    closedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "cargo_loading_sessions" }
);

loadingSessionSchema.index({ companyId: 1, siteId: 1, startedAt: -1 });
loadingSessionSchema.index({ companyId: 1, startedAt: -1 });
// a manifest can be in only one open session at a time
loadingSessionSchema.index(
  { companyId: 1, manifestId: 1 },
  { unique: true, partialFilterExpression: { closedAt: null, manifestId: { $type: "objectId" } } }
);

// A counting line can have only one open session per direction. Two open outbound sessions on the same line
// would each count the other's packages.
loadingSessionSchema.index(
  { companyId: 1, zoneId: 1, direction: 1 },
  { unique: true, partialFilterExpression: { closedAt: null, zoneId: { $type: "objectId" } } }
);

export const LoadingSessionModel =
  (mongoose.models.LoadingSession as mongoose.Model<ILoadingSessionDocument>) ||
  model<ILoadingSessionDocument>("LoadingSession", loadingSessionSchema);
