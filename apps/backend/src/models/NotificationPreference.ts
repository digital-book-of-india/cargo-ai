import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface INotificationPreferenceDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  push: boolean;
  inApp: boolean;
  types: {
    PERSON_IN_ZONE: boolean;
    POSSIBLE_SHUTTER_INTERACTION: boolean;
    POSSIBLE_TAMPERING: boolean;
    CAMERA_OFFLINE: boolean;
    AI_OFFLINE: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
}

const notificationPreferenceSchema = new Schema<INotificationPreferenceDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    push: { type: Boolean, default: true },
    inApp: { type: Boolean, default: true },
    types: {
      PERSON_IN_ZONE: { type: Boolean, default: true },
      POSSIBLE_SHUTTER_INTERACTION: { type: Boolean, default: true },
      POSSIBLE_TAMPERING: { type: Boolean, default: true },
      CAMERA_OFFLINE: { type: Boolean, default: true },
      AI_OFFLINE: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

export const NotificationPreferenceModel =
  (mongoose.models.NotificationPreference as mongoose.Model<INotificationPreferenceDocument>) ||
  model<INotificationPreferenceDocument>("NotificationPreference", notificationPreferenceSchema);
