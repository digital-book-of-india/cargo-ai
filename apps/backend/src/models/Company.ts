import mongoose, { Schema, model, Document, Types } from "mongoose";
import { CompanyStatus } from "@dbi/api-types";

export interface ICompanyDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  status: CompanyStatus;
  timezone: string;
  demo?: boolean;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const companySchema = new Schema<ICompanyDocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE", index: true },
    timezone: { type: String, required: true, default: "Asia/Kolkata" },
    demo: { type: Boolean, default: false },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export const CompanyModel =
  (mongoose.models.Company as mongoose.Model<ICompanyDocument>) ||
  model<ICompanyDocument>("Company", companySchema);
