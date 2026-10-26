import mongoose, { Schema, model, Document, Types } from "mongoose";
import type { ImportJobStatus, ImportRowError } from "@dbi/api-types";

export interface IImportJobDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  kind: "manifests";
  fileName: string;
  contentHash: string; // sha256 of the file: the same file is never imported twice
  status: ImportJobStatus;
  totalRows: number;
  createdCount: number;
  rowErrors: ImportRowError[];
  createdBy?: Types.ObjectId;
  createdAt: Date;
}

const importJobSchema = new Schema<IImportJobDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true },
    kind: { type: String, enum: ["manifests"], default: "manifests" },
    fileName: { type: String, required: true, maxlength: 200 },
    contentHash: { type: String, required: true },
    status: { type: String, enum: ["COMPLETED", "PARTIAL", "FAILED"], required: true },
    totalRows: { type: Number, default: 0 },
    createdCount: { type: Number, default: 0 },
    rowErrors: { type: [new Schema({ row: Number, field: String, message: String }, { _id: false })], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: "cargo_import_jobs" }
);

importJobSchema.index({ companyId: 1, kind: 1, contentHash: 1 }, { unique: true });

export const ImportJobModel =
  (mongoose.models.ImportJob as mongoose.Model<IImportJobDocument>) || model<IImportJobDocument>("ImportJob", importJobSchema);
