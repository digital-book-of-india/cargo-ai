import mongoose, { Schema, model, Document, Types } from "mongoose";
import type { ManifestSource, ManifestStatus } from "@dbi/api-types";

export interface IManifestDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  siteId: Types.ObjectId;
  reference: string;
  expectedPackageCount: number;
  source: ManifestSource;
  status: ManifestStatus;
  notes?: string | null;
  importJobId?: Types.ObjectId | null;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const manifestSchema = new Schema<IManifestDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    siteId: { type: Schema.Types.ObjectId, ref: "Site", required: true },
    reference: { type: String, required: true, trim: true, maxlength: 100 },
    expectedPackageCount: { type: Number, required: true, min: 0, max: 1_000_000, validate: Number.isInteger },
    source: { type: String, enum: ["manual", "csv_import", "integration"], default: "manual" },
    status: { type: String, enum: ["draft", "active", "closed", "cancelled"], default: "active" },
    notes: { type: String, maxlength: 1000, default: null },
    importJobId: { type: Schema.Types.ObjectId, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "cargo_manifests" }
);

manifestSchema.index({ companyId: 1, reference: 1 }, { unique: true });
manifestSchema.index({ companyId: 1, siteId: 1, createdAt: -1 });

export const ManifestModel =
  (mongoose.models.Manifest as mongoose.Model<IManifestDocument>) || model<IManifestDocument>("Manifest", manifestSchema);
