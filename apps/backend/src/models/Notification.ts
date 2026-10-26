import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface INotificationDocument extends Document {
  _id: Types.ObjectId;
  eventId?: string;
  recipientUserId: Types.ObjectId;
  channel: "PUSH" | "IN_APP";
  status: "PENDING" | "SENT" | "FAILED";
  attempts: number;
  lastErrorCode?: string;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotificationDocument>(
  {
    eventId: { type: String, index: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    channel: { type: String, enum: ["PUSH", "IN_APP"], default: "IN_APP", required: true },
    status: { type: String, enum: ["PENDING", "SENT", "FAILED"], default: "PENDING", required: true },
    attempts: { type: Number, default: 0 },
    lastErrorCode: { type: String },
  },
  {
    timestamps: true,
  }
);

export const NotificationModel =
  (mongoose.models.Notification as mongoose.Model<INotificationDocument>) ||
  model<INotificationDocument>("Notification", notificationSchema);

