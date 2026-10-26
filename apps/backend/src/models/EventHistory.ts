import mongoose, { Schema, model, Document, Types } from "mongoose";

// One row per status change or review action. Append-only: rows are never edited or deleted
// by the API, so the review trail stays trustworthy.
export interface IEventHistoryDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  eventId: Types.ObjectId;
  actorUserId?: Types.ObjectId | null; // null for system actions such as creation by the AI pipeline
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const eventHistorySchema = new Schema<IEventHistoryDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    eventId: { type: Schema.Types.ObjectId, ref: "CargoEvent", required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true, maxlength: 48 },
    fromStatus: { type: String, default: null },
    toStatus: { type: String, default: null },
    note: { type: String, maxlength: 5000, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "cargo_event_history" }
);

eventHistorySchema.index({ companyId: 1, eventId: 1, createdAt: 1 });

export const EventHistoryModel =
  (mongoose.models.EventHistory as mongoose.Model<IEventHistoryDocument>) ||
  model<IEventHistoryDocument>("EventHistory", eventHistorySchema);
