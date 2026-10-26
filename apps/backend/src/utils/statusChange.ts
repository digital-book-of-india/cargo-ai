import mongoose, { Model } from "mongoose";
import { AuditLogModel } from "../models";
import { supportsTransactions } from "./adminHelpers";

export interface StatusChangeAudit {
  actorUserId: string;
  companyId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  requestId?: string;
}

// Changes a document's status only if it still has `from`, and writes the audit entry with it.
// Uses a transaction when the database supports one; on a standalone server it writes the audit
// entry first and removes it again if the conditional update loses a race.
// Returns false when another request changed the status first (nothing is changed then).
export async function changeStatusWithAudit(
  model: Model<any>,
  id: string,
  from: string,
  to: string,
  audit: StatusChangeAudit
): Promise<boolean> {
  const entry = {
    actorUserId: new mongoose.Types.ObjectId(audit.actorUserId),
    companyId: audit.companyId ? new mongoose.Types.ObjectId(audit.companyId) : null,
    action: audit.action,
    targetType: audit.targetType,
    targetId: audit.targetId,
    reason: audit.reason,
    requestId: audit.requestId,
    metadata: { from, to },
  };

  if (await supportsTransactions()) {
    const session = await mongoose.startSession();
    try {
      let applied = true;
      await session.withTransaction(async () => {
        const updated = await model.findOneAndUpdate({ _id: id, status: from }, { $set: { status: to } }, { session, new: true });
        if (!updated) {
          applied = false;
          return;
        }
        await new AuditLogModel(entry).save({ session });
      });
      return applied;
    } finally {
      await session.endSession();
    }
  }

  const log = await new AuditLogModel(entry).save();
  const updated = await model.findOneAndUpdate({ _id: id, status: from }, { $set: { status: to } }, { new: true });
  if (!updated) {
    await AuditLogModel.deleteOne({ _id: log._id }).catch(() => undefined);
    return false;
  }
  return true;
}
