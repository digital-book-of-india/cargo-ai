import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface IAuditLogDocument extends Document {
  _id: Types.ObjectId;
  companyId?: Types.ObjectId | null;
  actorUserId?: Types.ObjectId | null; // empty for actions of the system itself (for example the AI worker)
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLogDocument>(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", default: null, index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    reason: { type: String },
    requestId: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

// the audit trail is always read for one company, newest first
auditLogSchema.index({ companyId: 1, createdAt: -1 });

export const AuditLogModel =
  (mongoose.models.AuditLog as mongoose.Model<IAuditLogDocument>) ||
  model<IAuditLogDocument>("AuditLog", auditLogSchema);

