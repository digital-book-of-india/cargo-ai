import mongoose, { Schema, model, Document, Types } from "mongoose";
import { Role, UserStatus } from "@dbi/api-types";

export interface IUserDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUserDocument>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, unique: true, index: true },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["PLATFORM_ADMIN", "USER"],
      required: true,
      default: "USER",
    },
    status: {
      type: String,
      enum: ["ACTIVE", "SUSPENDED", "PENDING_VERIFICATION"],
      default: "ACTIVE",
    },
  },
  {
    timestamps: true,
  }
);

export const UserModel =
  (mongoose.models.User as mongoose.Model<IUserDocument>) ||
  model<IUserDocument>("User", userSchema);

