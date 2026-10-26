import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface IPushTokenDocument extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  token: string;
  platform: "WEB" | "ANDROID" | "IOS";
  createdAt: Date;
  updatedAt: Date;
}

const pushTokenSchema = new Schema<IPushTokenDocument>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    token: { type: String, required: true },
    platform: { type: String, enum: ["WEB", "ANDROID", "IOS"], default: "WEB" },
  },
  { timestamps: true }
);

pushTokenSchema.index({ userId: 1, token: 1 }, { unique: true });

export const PushTokenModel =
  (mongoose.models.PushToken as mongoose.Model<IPushTokenDocument>) ||
  model<IPushTokenDocument>("PushToken", pushTokenSchema);
