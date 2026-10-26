import { AuditLogModel } from "../../models";

export interface LogAuditOptions {
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  requestId?: string;
}

export async function logAuditEvent(options: LogAuditOptions): Promise<void> {
  try {
    await AuditLogModel.create({
      actorUserId: options.actorUserId,
      action: options.action,
      targetType: options.targetType,
      targetId: options.targetId,
      reason: options.reason,
      requestId: options.requestId,
    });
  } catch (err) {
    console.error("Failed to log audit event:", err);
  }
}
