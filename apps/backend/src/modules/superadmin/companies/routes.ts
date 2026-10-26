import { Router, Request, Response } from "express";
import {
  requireAdmin,
  adminRateLimiter,
  sendSuccess,
  sendError,
  AuthenticatedAdminRequest,
} from "../../../middleware/adminAuth";
import { CompanyMemberModel, CompanyModel, SiteModel, UserModel } from "../../../models";
import { parsePagination, escapeRegex, isValidObjectId, sanitizeString } from "../../../utils/adminHelpers";
import { changeStatusWithAudit } from "../../../utils/statusChange";

export const adminCompaniesRouter = Router();

adminCompaniesRouter.use(adminRateLimiter);
adminCompaniesRouter.use(requireAdmin);

const VALID_STATUSES = ["ACTIVE", "SUSPENDED"];

// GET /api/v1/admin/companies
adminCompaniesRouter.get("/", async (req: Request, res: Response) => {
  const requestId = (req as AuthenticatedAdminRequest).requestId;
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const search = sanitizeString(req.query.search);
    const status = sanitizeString(req.query.status);

    const filter: any = {};
    if (search) filter.name = new RegExp(escapeRegex(search), "i");
    if (status && status !== "ALL") {
      if (!VALID_STATUSES.includes(status)) {
        return sendError(res, "INVALID_QUERY", "Invalid status query filter.", 400, requestId);
      }
      filter.status = status;
    }

    const [companies, total] = await Promise.all([
      CompanyModel.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
      CompanyModel.countDocuments(filter),
    ]);

    const ids = companies.map((c) => c._id);
    const [siteCounts, memberCounts, owners] = await Promise.all([
      SiteModel.aggregate([{ $match: { companyId: { $in: ids } } }, { $group: { _id: "$companyId", n: { $sum: 1 } } }]),
      CompanyMemberModel.aggregate([
        { $match: { companyId: { $in: ids }, status: "ACTIVE" } },
        { $group: { _id: "$companyId", n: { $sum: 1 } } },
      ]),
      CompanyMemberModel.find({ companyId: { $in: ids }, role: "COMPANY_OWNER", status: "ACTIVE" }).lean(),
    ]);
    const users = await UserModel.find({ _id: { $in: owners.map((o) => o.userId) } })
      .select("name email")
      .lean();
    const userById = new Map(users.map((u) => [u._id.toString(), u]));
    const sitesBy = new Map(siteCounts.map((r: any) => [r._id.toString(), r.n]));
    const membersBy = new Map(memberCounts.map((r: any) => [r._id.toString(), r.n]));

    const items = companies.map((c) => {
      const owner = owners.find((o) => o.companyId.toString() === c._id.toString());
      const ownerUser = owner ? userById.get(owner.userId.toString()) : undefined;
      return {
        id: c._id,
        name: c.name,
        status: c.status,
        timezone: c.timezone,
        demoFlag: Boolean(c.demo),
        siteCount: sitesBy.get(c._id.toString()) ?? 0,
        memberCount: membersBy.get(c._id.toString()) ?? 0,
        owner: ownerUser ? { id: ownerUser._id, name: ownerUser.name, email: ownerUser.email } : null,
        createdAt: c.createdAt,
      };
    });

    return sendSuccess(
      res,
      { companies: items },
      { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminCompaniesError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to retrieve companies.", 500, requestId);
  }
});

// PATCH /api/v1/admin/companies/:companyId/status - suspend or reactivate with a mandatory reason
adminCompaniesRouter.patch("/:companyId/status", async (req: Request, res: Response) => {
  const adminReq = req as AuthenticatedAdminRequest;
  const requestId = adminReq.requestId;
  try {
    const { companyId } = req.params;
    const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
    const status = sanitizeString(body.status);
    const reason = sanitizeString(body.reason);

    if (!isValidObjectId(companyId)) {
      return sendError(res, "INVALID_ID", "Invalid company ID parameter.", 400, requestId);
    }
    if (!VALID_STATUSES.includes(status)) {
      return sendError(res, "INVALID_STATUS", "Status must be either ACTIVE or SUSPENDED.", 400, requestId);
    }
    if (!reason || reason.length < 5) {
      return sendError(res, "INVALID_REASON", "A mandatory reason (minimum 5 characters) is required.", 400, requestId);
    }

    const company = await CompanyModel.findById(companyId);
    if (!company) return sendError(res, "NOT_FOUND", "Company not found.", 404, requestId);
    if (company.status === status) {
      return sendError(res, "CONFLICT", `Company is already in the requested status: ${status}`, 409, requestId);
    }

    const applied = await changeStatusWithAudit(CompanyModel, companyId, company.status, status, {
      actorUserId: adminReq.user!.id,
      companyId,
      action: status === "SUSPENDED" ? "COMPANY_SUSPENDED" : "COMPANY_ACTIVATED",
      targetType: "Company",
      targetId: companyId,
      reason,
      requestId,
    });
    if (!applied) {
      return sendError(res, "CONFLICT", "Status was modified concurrently.", 409, requestId);
    }

    return sendSuccess(
      res,
      { companyId: company._id, appliedStatus: status, updatedAt: new Date() },
      undefined,
      requestId
    );
  } catch (error: any) {
    console.error(`[AdminCompanyStatusError] reqId: ${requestId}`, error);
    return sendError(res, "INTERNAL_ERROR", "Failed to update company status.", 500, requestId);
  }
});
