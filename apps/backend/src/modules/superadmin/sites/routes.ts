import { Router, Request, Response } from "express";
import {
  requireAdmin,
  adminRateLimiter,
  sendSuccess,
  sendError,
  AuthenticatedAdminRequest,
} from "../../../middleware/adminAuth";
import { SiteModel } from "../../../models";
import { parsePagination, escapeRegex, isValidObjectId, sanitizeString } from "../../../utils/adminHelpers";
import { changeStatusWithAudit } from "../../../utils/statusChange";

export const adminSitesRouter = Router();

adminSitesRouter.use(adminRateLimiter);
adminSitesRouter.use(requireAdmin);

const VALID_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"];

// GET /api/v1/admin/sites
adminSitesRouter.get("/", async (req: Request, res: Response) => {
  const requestId = (req as AuthenticatedAdminRequest).requestId;
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = sanitizeString(req.query.search);
    const status = sanitizeString(req.query.status);
    const companyId = sanitizeString(req.query.companyId);

    const filter: any = {};
    if (search) {
      const safeRegex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: safeRegex }, { code: safeRegex }, { "address.city": safeRegex }];
    }
    if (status && status !== "ALL") {
      if (!VALID_STATUSES.includes(status)) {
        return sendError(res, "INVALID_QUERY", "Invalid status query filter.", 400, requestId);
      }
      filter.status = status;
    }
    if (companyId) {
      if (!isValidObjectId(companyId)) {
        return sendError(res, "INVALID_QUERY", "Invalid companyId format.", 400, requestId);
      }
      filter.companyId = companyId;
    }

    const [sitesRaw, total] = await Promise.all([
      SiteModel.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate("companyId", "name")
        .lean(),
      SiteModel.countDocuments(filter),
    ]);

    const sites = sitesRaw.map((s: any) => ({
      _id: s._id,
      name: s.name,
      code: s.code,
      timezone: s.timezone,
      address: s.address,
      status: s.status,
      demoFlag: Boolean(s.demo),
      company: s.companyId ? { id: s.companyId._id, name: s.companyId.name } : null,
      createdAt: s.createdAt,
    }));

    return sendSuccess(
      res,
      { sites },
      { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminSitesError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to retrieve sites.", 500, requestId);
  }
});

// PATCH /api/v1/admin/sites/:siteId/status - deactivate or reactivate with a mandatory reason
adminSitesRouter.patch("/:siteId/status", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const { siteId } = req.params;
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const status = sanitizeString(body.status);
    const reason = sanitizeString(body.reason);

    if (!isValidObjectId(siteId)) {
      return sendError(res, "INVALID_ID", "Invalid site ID parameter.", 400, requestId);
    }
    if (!["ACTIVE", "INACTIVE"].includes(status)) {
      return sendError(res, "INVALID_STATUS", "Status must be either ACTIVE or INACTIVE.", 400, requestId);
    }
    if (!reason || reason.length < 5) {
      return sendError(res, "INVALID_REASON", "A mandatory reason (minimum 5 characters) is required.", 400, requestId);
    }

    const site = await SiteModel.findById(siteId);
    if (!site) return sendError(res, "NOT_FOUND", "Site not found.", 404, requestId);
    if (site.status === "ARCHIVED") {
      return sendError(res, "CONFLICT", "An archived site cannot be changed.", 409, requestId);
    }
    if (site.status === status) {
      return sendError(res, "CONFLICT", `Site is already in the requested status: ${status}`, 409, requestId);
    }

    const applied = await changeStatusWithAudit(SiteModel, siteId, site.status, status, {
      actorUserId: adminReq.user!.id,
      companyId: site.companyId.toString(),
      action: status === "INACTIVE" ? "SITE_DEACTIVATED" : "SITE_ACTIVATED",
      targetType: "Site",
      targetId: siteId,
      reason,
      requestId,
    });
    if (!applied) {
      return sendError(res, "CONFLICT", "Status was modified concurrently.", 409, requestId);
    }

    return sendSuccess(
      res,
      { siteId: site._id, appliedStatus: status, updatedAt: new Date() },
      undefined,
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminSiteStatusError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to update site status.", 500, requestId);
  }
});
