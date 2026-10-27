import type { Request } from "express";
import { AuditLogModel } from "../../models";

export interface LogAuditOptions {
  actorUserId?: string | null; // empty for the system itself
  /** when true a failed audit write is thrown, so the action it describes must not go ahead */
  required?: boolean;
  companyId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

export async function logAuditEvent(options: LogAuditOptions): Promise<void> {
  try {
    await AuditLogModel.create({
      actorUserId: options.actorUserId ?? null,
      companyId: options.companyId ?? null,
      action: options.action,
      targetType: options.targetType,
      targetId: options.targetId,
      reason: options.reason,
      requestId: options.requestId,
      metadata: options.metadata,
    });
  } catch (err) {
    if (options.required) throw err;
    console.error("Failed to log audit event:", err);
  }
}

// Audit entry for an authenticated tenant request: actor, company and request id come from the
// request, so callers cannot forget or spoof them. Never put secrets in metadata.
export function auditFromRequest(
  req: Request,
  action: string,
  targetType: string,
  targetId: string,
  extra: { reason?: string; metadata?: Record<string, unknown> } = {}
): Promise<void> {
  return logAuditEvent({
    actorUserId: req.user!.id,
    companyId: req.tenant?.companyId ?? null,
    action,
    targetType,
    targetId,
    reason: extra.reason,
    requestId: req.requestId,
    metadata: extra.metadata,
  });
}
