import mongoose, { Schema, model, Document, Types } from "mongoose";
import { CompanyRole } from "@dbi/api-types";

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";

export interface IInvitationDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  email: string;
  role: CompanyRole;
  siteIds: Types.ObjectId[];
  tokenHash: string; // sha256 of the one-time token; the token itself is never stored
  status: InvitationStatus;
  expiresAt: Date;
  invitedBy: Types.ObjectId;
  acceptedAt?: Date;
  createdAt: Date;
}

const invitationSchema = new Schema<IInvitationDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    role: {
      type: String,
      enum: ["COMPANY_OWNER", "COMPANY_ADMIN", "WAREHOUSE_MANAGER", "SECURITY_OPERATOR", "AUDITOR"],
      required: true,
    },
    siteIds: { type: [{ type: Schema.Types.ObjectId, ref: "Site" }], default: [] },
    tokenHash: { type: String, required: true, unique: true },
    status: { type: String, enum: ["PENDING", "ACCEPTED", "REVOKED"], default: "PENDING" },
    expiresAt: { type: Date, required: true },
    invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    acceptedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const InvitationModel =
  (mongoose.models.Invitation as mongoose.Model<IInvitationDocument>) ||
  model<IInvitationDocument>("Invitation", invitationSchema);
