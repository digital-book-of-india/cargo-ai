import type { Request } from "express";
import { Types } from "mongoose";
import { SiteModel } from "../../../models";
import { AppError } from "../../../middleware/errorHandler";
import { canAccessSite } from "../../../services/authz/permissions";

// Tenant check for the vision routes (zones, counts, monitoring). Needs `authenticate` and
// `resolveTenant` to have run first. It resolves if the signed-in member may use this site:
// the site belongs to their company AND, for roles limited to assigned sites, is one of them.
// Every denial is a 404 so other companies' site ids are not revealed (QA-01).
export async function assertSiteAccess(req: Request, siteId: string): Promise<void> {
  if (!req.user || !req.tenant) throw new AppError(401, "UNAUTHORIZED", "Authentication required.");
  if (!Types.ObjectId.isValid(siteId)) throw new AppError(404, "NOT_FOUND", "Site not found.");

  const site = await SiteModel.findOne({ _id: siteId, companyId: req.tenant.companyId }).select("_id").lean();
  if (!site || !canAccessSite(req.tenant.role, req.tenant.siteIds, siteId)) {
    throw new AppError(404, "NOT_FOUND", "Site not found.");
  }
}
