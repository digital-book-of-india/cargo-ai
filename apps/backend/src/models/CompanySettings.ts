import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface ICompanySettingsDocument extends Document {
  _id: Types.ObjectId;
  companyId: Types.ObjectId;
  mismatchTolerance?: number;
  retentionDays?: number;
  defaultConfidence?: number;
  shifts?: Array<{ name: string; start: string; end: string }>;
  notificationRules?: { inAppMinSeverity: string; mutedEventTypes: string[] };
  updatedBy?: Types.ObjectId;
  updatedAt: Date;
}

// One document per company. A field that was never set is simply absent, and the service fills
// in the platform default, so changing a default later reaches companies that never customised it.
const companySettingsSchema = new Schema<ICompanySettingsDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    mismatchTolerance: { type: Number, min: 0, max: 100000 },
    retentionDays: { type: Number, min: 7, max: 3650 },
    defaultConfidence: { type: Number, min: 0, max: 1 },
    shifts: {
      type: [new Schema({ name: String, start: String, end: String }, { _id: false })],
      default: undefined,
    },
    notificationRules: {
      type: new Schema(
        {
          inAppMinSeverity: { type: String, enum: ["low", "medium", "high", "critical"] },
          mutedEventTypes: { type: [String], default: [] },
        },
        { _id: false }
      ),
      default: undefined,
    },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true, collection: "company_settings" }
);

export const CompanySettingsModel =
  (mongoose.models.CompanySettings as mongoose.Model<ICompanySettingsDocument>) ||
  model<ICompanySettingsDocument>("CompanySettings", companySettingsSchema);
