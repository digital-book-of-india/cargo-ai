import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import { CargoEventModel, CompanyMemberModel, CompanyModel, UserModel } from "../../models";
import { asyncHandler } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { logAuditEvent } from "../../services/audit/logger";
import { canAccessSite } from "../../services/authz/permissions";
import { verifyEvidenceToken } from "../../services/evidence/signer";
import type { EvidenceTokenPayload } from "../../services/evidence/signer";
import { getEvidenceStorage } from "../../services/evidence/storage";

export const evidenceRouter = Router();

// A link is only as good as the person it was issued to. When it is used, that person must still be allowed to see this
// event: not suspended, still an active member of an active company with access to the site (a platform administrator
// who got the link through the support workflow must still be a platform administrator).
async function holderStillAllowed(payload: EvidenceTokenPayload, siteId: Types.ObjectId): Promise<boolean> {
  if (!payload.uid) return true;
  if (!Types.ObjectId.isValid(payload.uid)) return false;
  const user = await UserModel.findById(payload.uid).select("role status").lean();
  if (!user || user.status === "SUSPENDED") return false;
  if (payload.sup) return user.role === "PLATFORM_ADMIN";
  const [company, member] = await Promise.all([
    CompanyModel.findOne({ _id: payload.cid, status: "ACTIVE" }).select("_id").lean(),
    CompanyMemberModel.findOne({ userId: payload.uid, companyId: payload.cid, status: "ACTIVE" }).lean(),
  ]);
  if (!company || !member) return false;
  return canAccessSite(member.role as never, (member.siteIds ?? []).map((id) => id.toString()), siteId.toString());
}

// GET /api/v1/evidence/:eventId/:kind?token=...
// The link is a short-lived signed token issued only after the caller was authorised for the
// event, so <img> and <video> tags can load it without a session. It is bound to one event, one
// kind of file and one company. Evidence is never served from a public location.
evidenceRouter.get(
  "/:eventId/:kind",
  asyncHandler(async (req: Request, res: Response) => {
    const kind = req.params.kind;
    if (kind !== "snapshot" && kind !== "clip") {
      throw new AppError(400, "VALIDATION_ERROR", "kind must be snapshot or clip.");
    }

    const token = String(req.query.token ?? "");
    const payload = token ? verifyEvidenceToken(token) : null;
    if (!payload || payload.eventId !== req.params.eventId || payload.kind !== kind) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or expired evidence link.");
    }

    const event = Types.ObjectId.isValid(payload.eventId)
      ? await CargoEventModel.findOne({ _id: payload.eventId, companyId: payload.cid })
      : null;
    if (!event) throw new AppError(404, "NOT_FOUND", "Event not found.");
    if (!(await holderStillAllowed(payload, event.siteId))) {
      throw new AppError(401, "UNAUTHORIZED", "Invalid or expired evidence link.");
    }

    const item = event.evidence?.find((x) => x.type === kind);
    if (!item) throw new AppError(404, "NOT_FOUND", "No evidence file recorded for this event.");

    const file = await getEvidenceStorage().stream(item.objectKey);
    if (!file) throw new AppError(404, "NOT_FOUND", "Evidence file is not available.");

    if (payload.uid) {
      await logAuditEvent({
        actorUserId: payload.uid,
        companyId: payload.cid,
        action: "EVIDENCE_ACCESSED",
        targetType: "Event",
        targetId: event._id.toString(),
        requestId: req.requestId,
        metadata: { kind },
      });
    }

    res.setHeader("Content-Type", item.contentType ?? "application/octet-stream");
    res.setHeader("Content-Length", String(file.size));
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    file.stream.on("error", () => res.destroy());
    file.stream.pipe(res);
  })
);
