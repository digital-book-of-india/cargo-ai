import mongoose, { Schema, model, Document, Types } from "mongoose";
import { SiteStatus } from "@dbi/api-types";

export interface ISiteDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  code: string;
  timezone: string;
  address?: {
    city?: string;
    state?: string;
    postalCode?: string;
  };
  status: SiteStatus;
  demo?: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const siteSchema = new Schema<ISiteDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    code: { type: String, required: true, trim: true, maxlength: 60 },
    timezone: { type: String, required: true, default: "Asia/Kolkata" },
    address: {
      city: { type: String },
      state: { type: String },
      postalCode: { type: String },
    },
    status: { type: String, enum: ["ACTIVE", "INACTIVE", "ARCHIVED"], default: "ACTIVE" },
    demo: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

siteSchema.index({ companyId: 1, code: 1 }, { unique: true });

export const SiteModel =
  (mongoose.models.Site as mongoose.Model<ISiteDocument>) ||
  model<ISiteDocument>("Site", siteSchema);
