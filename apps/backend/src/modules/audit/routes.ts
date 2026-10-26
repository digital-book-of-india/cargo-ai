import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import { AuditLogModel, UserModel } from "../../models";
import { asyncHandler, guard } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { decodeCursor, encodeCursor, parseLimit } from "../../utils/pagination";

export const auditRouter = Router();

// GET /audit-logs - the company's own audit trail (owners, admins and auditors).
// Always limited to the caller's company; metadata never holds secrets (see auditFromRequest).
auditRouter.get(
  "/",
  ...guard("audit:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const q = req.query;
    const filter: Record<string, unknown> = { companyId: new Types.ObjectId(req.tenant!.companyId) };

    if (typeof q.action === "string" && q.action) {
      // exact action names only, no free-form regex from the client
      if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(q.action)) throw new AppError(400, "VALIDATION_ERROR", "action is not valid.");
      filter.action = q.action;
    }
    if (typeof q.targetType === "string" && q.targetType) {
      if (!/^[A-Za-z]{1,40}$/.test(q.targetType)) throw new AppError(400, "VALIDATION_ERROR", "targetType is not valid.");
      filter.targetType = q.targetType;
    }
    if (typeof q.actorUserId === "string" && q.actorUserId) {
      if (!Types.ObjectId.isValid(q.actorUserId)) throw new AppError(400, "VALIDATION_ERROR", "actorUserId is not valid.");
      filter.actorUserId = new Types.ObjectId(q.actorUserId);
    }
    const from = q.from ? new Date(String(q.from)) : null;
    const to = q.to ? new Date(String(q.to)) : null;
    if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
      throw new AppError(400, "VALIDATION_ERROR", "from and to must be valid dates.");
    }
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

    const limit = parseLimit(q.limit, 25, 100);
    const cursor = decodeCursor(q.cursor);
    if (q.cursor && !cursor) throw new AppError(400, "VALIDATION_ERROR", "cursor is not valid.");
    const query: Record<string, unknown> = { ...filter };
    if (cursor) {
      query.$or = [
        { createdAt: { $lt: cursor.at } },
        { createdAt: cursor.at, _id: { $lt: new Types.ObjectId(cursor.id) } },
      ];
    }

    const rows = await AuditLogModel.find(query).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const page = rows.slice(0, limit);
    const users = await UserModel.find({ _id: { $in: [...new Set(page.map((r) => r.actorUserId.toString()))] } }).select("name email").lean();
    const userBy = new Map(users.map((u) => [u._id.toString(), u]));
    const last = page[page.length - 1];

    res.json({
      data: {
        items: page.map((r) => ({
          id: r._id.toString(),
          action: r.action,
          actor: { id: r.actorUserId.toString(), name: userBy.get(r.actorUserId.toString())?.name ?? "Unknown user" },
          targetType: r.targetType,
          targetId: r.targetId,
          reason: r.reason ?? null,
          requestId: r.requestId ?? null,
          metadata: r.metadata ?? null,
          createdAt: r.createdAt.toISOString(),
        })),
        nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last._id.toString()) : null,
      },
    });
  })
);
