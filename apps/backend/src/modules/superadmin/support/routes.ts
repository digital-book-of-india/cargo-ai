import { Router, Request, Response } from "express";
import { requireAdmin, adminRateLimiter, sendSuccess, sendError, AuthenticatedAdminRequest } from "../../../middleware/adminAuth";
import { CargoEventModel } from "../../../models";
import { logAuditEvent } from "../../../services/audit/logger";
import { signEvidenceUrl } from "../../../services/evidence/signer";
import { isValidObjectId, sanitizeString } from "../../../utils/adminHelpers";

export const adminSupportRouter = Router();

adminSupportRouter.use(adminRateLimiter);
adminSupportRouter.use(requireAdmin);

// POST /admin/support/evidence-link { eventId, kind, reason }
// Support staff may look at a company's evidence only with a written reason. Every grant is
// written to the audit trail of the company that owns the evidence, so the company can see it.
// The link is short-lived and bound to that one event and file.
adminSupportRouter.post("/evidence-link", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const eventId = sanitizeString(body.eventId);
    const kind = sanitizeString(body.kind);
    const reason = sanitizeString(body.reason);

    if (!isValidObjectId(eventId)) return sendError(res, "INVALID_ID", "eventId is not valid.", 400, requestId);
    if (kind !== "snapshot" && kind !== "clip") return sendError(res, "INVALID_KIND", "kind must be snapshot or clip.", 400, requestId);
    if (!reason || reason.length < 10) {
      return sendError(res, "INVALID_REASON", "A reason of at least 10 characters is required for support access.", 400, requestId);
    }

    const event = await CargoEventModel.findById(eventId).select("companyId evidence evidencePurgedAt");
    if (!event) return sendError(res, "NOT_FOUND", "Event not found.", 404, requestId);
    if (!event.evidence?.some((x) => x.type === kind)) {
      return sendError(res, "NOT_FOUND", "No evidence file of that kind is recorded for this event.", 404, requestId);
    }

    // short expiry: support looks at it now, not later
    const link = signEvidenceUrl(eventId, kind, { companyId: event.companyId.toString(), userId: adminReq.user!.id }, 120);

    await logAuditEvent({
      actorUserId: adminReq.user!.id,
      companyId: event.companyId.toString(),
      action: "SUPPORT_EVIDENCE_ACCESS_GRANTED",
      targetType: "Event",
      targetId: eventId,
      reason,
      requestId,
      metadata: { kind, via: "platform-admin" },
    });

    return sendSuccess(res, link, undefined, requestId);
  } catch (error) {
    console.error(`[AdminSupportEvidenceError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to issue the support access link.", 500, requestId);
  }
});
