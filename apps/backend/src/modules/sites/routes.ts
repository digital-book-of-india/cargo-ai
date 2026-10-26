import { Router, Request, Response } from "express";
import { createSiteSchema, updateSiteSchema } from "@dbi/validation";
import { CameraModel, SiteModel, ZoneModel } from "../../models";
import { asyncHandler, guard, requireSiteAccess } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { auditFromRequest } from "../../services/audit/logger";
import { hasAllSiteAccess } from "../../services/authz/permissions";
import { isDuplicateKeyError, isValidTimezone } from "../../utils/validation";

export const sitesRouter = Router();

export function formatSite(s: any) {
  return {
    id: s._id.toString(),
    companyId: s.companyId.toString(),
    name: s.name,
    code: s.code,
    timezone: s.timezone,
    address: s.address,
    status: s.status,
    demo: s.demo,
    createdAt: s.createdAt?.toISOString(),
    updatedAt: s.updatedAt?.toISOString(),
  };
}

const DUPLICATE_CODE = () => new AppError(409, "CONFLICT", "A site with this code already exists in your company.");

// POST /api/v1/sites
sitesRouter.post(
  "/",
  ...guard("sites:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createSiteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid site data");
    }
    const { name, code, timezone, address } = parsed.data;
    if (timezone !== undefined && !isValidTimezone(timezone)) {
      throw new AppError(400, "VALIDATION_ERROR", "Timezone must be a valid IANA timezone.");
    }

    let site;
    try {
      site = await SiteModel.create({
        companyId: req.tenant!.companyId, // from membership, never from the body
        name,
        code,
        timezone: timezone ?? "Asia/Kolkata",
        address,
        status: "ACTIVE",
        createdBy: req.user!.id,
      });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw DUPLICATE_CODE();
      throw err;
    }

    await auditFromRequest(req, "SITE_CREATED", "Site", site._id.toString(), { metadata: { code } });
    res.status(201).json({ data: { site: formatSite(site) } });
  })
);

// GET /api/v1/sites - only the sites this member may access
sitesRouter.get(
  "/",
  ...guard("sites:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { companyId: req.tenant!.companyId };
    if (!hasAllSiteAccess(req.tenant!.role)) filter._id = { $in: req.tenant!.siteIds };
    if (req.query.includeArchived !== "true") filter.status = { $ne: "ARCHIVED" };

    const sites = await SiteModel.find(filter).sort({ createdAt: -1 }).limit(200);
    res.json({ data: { items: sites.map(formatSite) } });
  })
);

// GET /api/v1/sites/:siteId
sitesRouter.get(
  "/:siteId",
  ...requireSiteAccess("sites:read"),
  (req: Request, res: Response) => {
    res.json({ data: { site: formatSite(req.site) } });
  }
);

// PATCH /api/v1/sites/:siteId
sitesRouter.patch(
  "/:siteId",
  ...requireSiteAccess("sites:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateSiteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid site data");
    }
    const site = req.site!;
    if (site.status === "ARCHIVED") {
      throw new AppError(422, "BUSINESS_RULE_FAILED", "An archived site cannot be changed.");
    }

    const { name, code, timezone, address, status } = parsed.data;
    if (timezone !== undefined && !isValidTimezone(timezone)) {
      throw new AppError(400, "VALIDATION_ERROR", "Timezone must be a valid IANA timezone.");
    }

    const changed: Record<string, unknown> = {};
    if (name !== undefined && name !== site.name) {
      changed.name = { from: site.name, to: name };
      site.name = name;
    }
    if (code !== undefined && code !== site.code) {
      changed.code = { from: site.code, to: code };
      site.code = code;
    }
    if (timezone !== undefined && timezone !== site.timezone) {
      changed.timezone = { from: site.timezone, to: timezone };
      site.timezone = timezone;
    }
    if (address !== undefined) {
      const current = site.address
        ? { city: site.address.city, state: site.address.state, postalCode: site.address.postalCode }
        : {};
      site.address = { ...current, ...address };
      changed.address = true;
    }
    if (status !== undefined && status !== site.status) {
      changed.status = { from: site.status, to: status };
      site.status = status;
    }

    if (Object.keys(changed).length > 0) {
      try {
        await site.save();
      } catch (err) {
        if (isDuplicateKeyError(err)) throw DUPLICATE_CODE();
        throw err;
      }
      await auditFromRequest(req, "SITE_UPDATED", "Site", site._id.toString(), { metadata: { changed } });
    }

    res.json({ data: { site: formatSite(site) } });
  })
);

// DELETE /api/v1/sites/:siteId - archives (soft delete) when nothing active depends on it
sitesRouter.delete(
  "/:siteId",
  ...requireSiteAccess("sites:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const site = req.site!;
    if (site.status === "ARCHIVED") {
      throw new AppError(422, "BUSINESS_RULE_FAILED", "This site is already archived.");
    }

    const [cameras, zones] = await Promise.all([
      CameraModel.countDocuments({ siteId: site._id, companyId: site.companyId }),
      ZoneModel.countDocuments({ siteId: site._id, companyId: site.companyId, enabled: true }),
    ]);
    if (cameras > 0 || zones > 0) {
      throw new AppError(
        422,
        "BUSINESS_RULE_FAILED",
        "Move or remove this site's cameras and zones before archiving it."
      );
    }

    site.status = "ARCHIVED";
    await site.save();
    await auditFromRequest(req, "SITE_ARCHIVED", "Site", site._id.toString());
    res.json({ data: { site: formatSite(site) } });
  })
);
