import mongoose, { Schema, model, Document, Types } from "mongoose";
import { CompanyRole, MemberStatus } from "@dbi/api-types";

export interface ICompanyMemberDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  userId: Types.ObjectId;
  role: CompanyRole;
  status: MemberStatus;
  // Sites this member may access. Ignored for owners/admins (they see every site).
  siteIds: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const companyMemberSchema = new Schema<ICompanyMemberDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: {
      type: String,
      enum: ["COMPANY_OWNER", "COMPANY_ADMIN", "WAREHOUSE_MANAGER", "SECURITY_OPERATOR", "AUDITOR"],
      required: true,
    },
    status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE" },
    siteIds: { type: [{ type: Schema.Types.ObjectId, ref: "Site" }], default: [] },
  },
  { timestamps: true }
);

companyMemberSchema.index({ companyId: 1, userId: 1 }, { unique: true });

export const CompanyMemberModel =
  (mongoose.models.CompanyMember as mongoose.Model<ICompanyMemberDocument>) ||
  model<ICompanyMemberDocument>("CompanyMember", companyMemberSchema);
