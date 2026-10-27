import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface INotificationDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  eventId?: Types.ObjectId; // the cargo event's id
  recipientUserId: Types.ObjectId;
  channel: "PUSH" | "IN_APP";
  // PENDING: waiting for delivery (or for the next retry). SENT: delivered.
  // FAILED: gave up after the last retry (the dead-letter state, kept for inspection).
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  nextAttemptAt?: Date | null;
  sentAt?: Date | null;
  readAt?: Date | null;
  lastErrorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotificationDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    eventId: { type: Schema.Types.ObjectId, ref: "CargoEvent", index: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    channel: { type: String, enum: ["PUSH", "IN_APP"], default: "IN_APP", required: true },
    status: { type: String, enum: ["PENDING", "SENT", "FAILED"], default: "PENDING", required: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    sentAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    lastErrorCode: { type: String },
  },
  { timestamps: true }
);

notificationSchema.index({ companyId: 1, recipientUserId: 1, createdAt: -1 });
notificationSchema.index({ status: 1, nextAttemptAt: 1 });
// one notification per person per event per channel: a retried creation cannot notify twice
notificationSchema.index({ companyId: 1, eventId: 1, recipientUserId: 1, channel: 1 }, { unique: true, sparse: true });

export const NotificationModel =
  (mongoose.models.Notification as mongoose.Model<INotificationDocument>) ||
  model<INotificationDocument>("Notification", notificationSchema);
