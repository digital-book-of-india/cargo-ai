import { Router, Request, Response } from "express";
import { requireAdmin, adminRateLimiter, sendSuccess, sendError, AuthenticatedAdminRequest } from "../../../middleware/adminAuth";
import { AuditLogModel } from "../../../models";
import { parsePagination, escapeRegex, isValidObjectId, isValidIsoDate, sanitizeString } from "../../../utils/adminHelpers";

export const adminAuditLogsRouter = Router();

adminAuditLogsRouter.use(adminRateLimiter);
adminAuditLogsRouter.use(requireAdmin);

adminAuditLogsRouter.get("/", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const actorUserId = sanitizeString(req.query.actorUserId);
    const action = sanitizeString(req.query.action);
    const targetType = sanitizeString(req.query.targetType);
    const targetId = sanitizeString(req.query.targetId);
    const startDate = sanitizeString(req.query.startDate);
    const endDate = sanitizeString(req.query.endDate);

    const filter: any = {};

    if (actorUserId) {
      if (!isValidObjectId(actorUserId)) {
        return sendError(res, "INVALID_QUERY", "Invalid actorUserId format.", 400, requestId);
      }
      filter.actorUserId = actorUserId;
    }

    if (action) {
      filter.action = new RegExp(escapeRegex(action), "i");
    }

    if (targetType) {
      filter.targetType = new RegExp(escapeRegex(targetType), "i");
    }

    if (targetId) {
      filter.targetId = targetId;
    }

    if (startDate || endDate) {
      if (startDate && !isValidIsoDate(startDate)) {
        return sendError(res, "INVALID_DATE", "startDate must be a valid ISO date.", 400, requestId);
      }
      if (endDate && !isValidIsoDate(endDate)) {
        return sendError(res, "INVALID_DATE", "endDate must be a valid ISO date.", 400, requestId);
      }

      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;

      if (start && end && start > end) {
        return sendError(res, "INVALID_DATE_RANGE", "startDate cannot be after endDate.", 400, requestId);
      }

      filter.createdAt = {};
      if (start) filter.createdAt.$gte = start;
      if (end) {
        end.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const [logsRaw, total] = await Promise.all([
      AuditLogModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("actorUserId", "name email")
        .lean(),
      AuditLogModel.countDocuments(filter),
    ]);

    const auditLogs = logsRaw.map((log: any) => ({
      _id: log._id,
      actor: log.actorUserId
        ? { id: log.actorUserId._id, name: log.actorUserId.name, email: log.actorUserId.email }
        : { id: "unknown", name: "Unknown Actor", email: "N/A" },
      action: log.action,
      targetType: log.targetType,
      targetId: log.targetId,
      reason: log.reason,
      requestId: log.requestId,
      createdAt: log.createdAt ? new Date(log.createdAt).toISOString() : null,
    }));

    return sendSuccess(
      res,
      { auditLogs },
      { page, limit, total, totalPages: Math.ceil(total / limit) },
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminAuditLogsError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to retrieve audit trail.", 500, requestId);
  }
});