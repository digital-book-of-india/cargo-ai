import mongoose, { Schema, model, Document, Types } from "mongoose";
import type {
  CargoEventSeverity,
  CargoEventStatus,
  CargoEventType,
  ResolveOutcome,
} from "@dbi/api-types";

export interface IEvidenceItem {
  type: "snapshot" | "clip";
  objectKey: string;
  contentType?: string;
  checksum?: string;
  sizeBytes?: number;
  capturedAt?: Date;
}

export interface ICargoEventDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  siteId: Types.ObjectId;
  cameraId: Types.ObjectId;
  zoneId?: Types.ObjectId | null;
  loadingSessionId?: Types.ObjectId | null;
  eventKey: string; // idempotency key, unique per company
  eventType: CargoEventType;
  severity: CargoEventSeverity;
  status: CargoEventStatus;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  assignedTo?: Types.ObjectId | null;
  detector?: { name?: string; version?: string } | null;
  evidence: IEvidenceItem[];
  evidencePurgedAt?: Date | null;
  resolution?: {
    outcome: ResolveOutcome;
    note?: string | null;
    resolvedAt: Date;
    resolvedBy?: Types.ObjectId | null;
  } | null;
  demo?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const evidenceSchema = new Schema<IEvidenceItem>(
  {
    type: { type: String, enum: ["snapshot", "clip"], required: true },
    objectKey: { type: String, required: true, maxlength: 1024 },
    contentType: { type: String, maxlength: 100 },
    checksum: { type: String, maxlength: 128 },
    sizeBytes: { type: Number, min: 0 },
    capturedAt: { type: Date },
  },
  { _id: false }
);

const cargoEventSchema = new Schema<ICargoEventDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true },
    cameraId: { type: Schema.Types.ObjectId, ref: "Camera", required: true },
    zoneId: { type: Schema.Types.ObjectId, ref: "VisionZone", default: null },
    loadingSessionId: { type: Schema.Types.ObjectId, default: null },
    eventKey: { type: String, required: true, maxlength: 200 },
    eventType: {
      type: String,
      required: true,
      enum: [
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
      ],
    },
    severity: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
    status: {
      type: String,
      enum: ["open", "acknowledged", "in_review", "resolved", "false_positive", "escalated"],
      default: "open",
    },
    summary: { type: String, required: true, maxlength: 500 },
    payload: { type: Schema.Types.Mixed, default: {} },
    occurredAt: { type: Date, required: true },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User", default: null },
    detector: { type: new Schema({ name: String, version: String }, { _id: false }), default: null },
    evidence: { type: [evidenceSchema], default: [] },
    evidencePurgedAt: { type: Date, default: null },
    resolution: {
      type: new Schema(
        {
          outcome: {
            type: String,
            enum: ["confirmed_operational", "reviewed_no_issue", "false_positive", "escalated", "unresolved_other"],
          },
          note: { type: String, maxlength: 5000 },
          resolvedAt: { type: Date },
          resolvedBy: { type: Schema.Types.ObjectId, ref: "User" },
        },
        { _id: false }
      ),
      default: null,
    },
    demo: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "cargo_events" }
);

cargoEventSchema.index({ companyId: 1, eventKey: 1 }, { unique: true });
cargoEventSchema.index({ companyId: 1, occurredAt: -1 });
cargoEventSchema.index({ companyId: 1, status: 1, occurredAt: -1 });
cargoEventSchema.index({ companyId: 1, siteId: 1, occurredAt: -1 });
// the inbox and the reports filter by camera and by counting line
cargoEventSchema.index({ companyId: 1, cameraId: 1, occurredAt: -1 });
cargoEventSchema.index({ companyId: 1, zoneId: 1, occurredAt: -1 });

export const CargoEventModel =
  (mongoose.models.CargoEvent as mongoose.Model<ICargoEventDocument>) ||
  model<ICargoEventDocument>("CargoEvent", cargoEventSchema);
