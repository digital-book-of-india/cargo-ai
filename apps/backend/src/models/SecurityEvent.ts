import mongoose, { Schema, model, Document, Types } from "mongoose";
import { EventType, ReviewStatus } from "@dbi/api-types";

export interface ISecurityEventDocument extends Document {
  _id: Types.ObjectId;
  eventId: string; // Idempotency key
  shopId: Types.ObjectId;
  cameraId: Types.ObjectId;
  eventType: EventType;
  confidence: number;
  startedAt: Date;
  endedAt?: Date;
  evidence?: {
    snapshotObjectKey?: string;
    clipObjectKey?: string;
  };
  reviewStatus: ReviewStatus;
  demoFlag: boolean;
  modelVersion?: string;
  createdAt: Date;
  updatedAt: Date;
}

const evidenceSchema = new Schema(
  {
    snapshotObjectKey: { type: String },
    clipObjectKey: { type: String },
  },
  { _id: false }
);

const securityEventSchema = new Schema<ISecurityEventDocument>(
  {
    eventId: { type: String, required: true, unique: true, index: true },
    shopId: { type: Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    cameraId: { type: Schema.Types.ObjectId, ref: "Camera", required: true, index: true },
    eventType: {
      type: String,
      enum: [
        "PERSON_IN_ZONE",
        "POSSIBLE_SHUTTER_INTERACTION",
        "POSSIBLE_TAMPERING",
        "CAMERA_OFFLINE",
        "AI_OFFLINE",
      ],
      required: true,
    },
    confidence: { type: Number, min: 0, max: 1, default: 0.8 },
    startedAt: { type: Date, required: true, index: true },
    endedAt: { type: Date },
    evidence: { type: evidenceSchema },
    reviewStatus: {
      type: String,
      enum: ["NEW", "REVIEWED", "FALSE_ALARM", "CONFIRMED"],
      default: "NEW",
    },
    demoFlag: { type: Boolean, default: false },
    modelVersion: { type: String, default: "detector-v0.1" },
  },
  {
    collection: "events",
    timestamps: true,
  }
);

export const SecurityEventModel =
  (mongoose.models.SecurityEvent as mongoose.Model<ISecurityEventDocument>) ||
  (mongoose.models.Event as mongoose.Model<ISecurityEventDocument>) ||
  model<ISecurityEventDocument>("Event", securityEventSchema, "events");

export const EventModel = SecurityEventModel;


