import mongoose, { Schema, model, Document, Types } from "mongoose";
import { ShopStatus } from "@dbi/api-types";

export interface IShopDocument extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  name: string;
  timezone: string;
  address?: {
    city?: string;
    state?: string;
    postalCode?: string;
  };
  status: ShopStatus;
  demo?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const shopSchema = new Schema<IShopDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    timezone: { type: String, required: true, default: "Asia/Kolkata" },
    address: {
      city: { type: String },
      state: { type: String },
      postalCode: { type: String },
    },
    status: {
      type: String,
      enum: ["PENDING_SETUP", "ACTIVE", "SUSPENDED"],
      default: "PENDING_SETUP",
    },
    demo: { type: Boolean, default: false },
  },
  {
    timestamps: true,
  }
);

export const ShopModel =
  (mongoose.models.Shop as mongoose.Model<IShopDocument>) ||
  model<IShopDocument>("Shop", shopSchema);

