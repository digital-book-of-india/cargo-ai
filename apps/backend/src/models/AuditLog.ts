import mongoose, { Schema, model, Document, Types } from "mongoose";

export interface IAuditLogDocument extends Document {
  _id: Types.ObjectId;
  actorUserId: Types.ObjectId;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  requestId?: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLogDocument>(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    action: { type: String, required: true },
    targetType: { type: String, required: true },
    targetId: { type: String, required: true },
    reason: { type: String },
    requestId: { type: String },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

export const AuditLogModel =
  (mongoose.models.AuditLog as mongoose.Model<IAuditLogDocument>) ||
  model<IAuditLogDocument>("AuditLog", auditLogSchema);

