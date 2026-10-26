import { Router, Request, Response } from "express";
import { updateCompanySchema, updateCompanySettingsSchema } from "@dbi/validation";
import { CompanyModel, CompanySettingsModel } from "../../models";
import { asyncHandler, guard } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { auditFromRequest } from "../../services/audit/logger";
import { getCompanySettings } from "../../services/settings/companySettings";
import { isValidTimezone } from "../../utils/validation";

export const companyRouter = Router();

export function formatCompany(c: any) {
  return {
    id: c._id.toString(),
    name: c.name,
    status: c.status,
    timezone: c.timezone,
    demo: c.demo,
    createdAt: c.createdAt?.toISOString(),
    updatedAt: c.updatedAt?.toISOString(),
  };
}

// GET /api/v1/company - the caller's active company
companyRouter.get(
  "/",
  ...guard("company:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const company = await CompanyModel.findById(req.tenant!.companyId);
    if (!company) throw new AppError(404, "NOT_FOUND", "Company not found.");
    res.json({ data: { company: formatCompany(company), role: req.tenant!.role } });
  })
);

// PATCH /api/v1/company
companyRouter.patch(
  "/",
  ...guard("company:update"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateCompanySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid company data");
    }
    const { name, timezone } = parsed.data;
    if (timezone !== undefined && !isValidTimezone(timezone)) {
      throw new AppError(400, "VALIDATION_ERROR", "Timezone must be a valid IANA timezone.");
    }

    const company = await CompanyModel.findById(req.tenant!.companyId);
    if (!company) throw new AppError(404, "NOT_FOUND", "Company not found.");

    const changed: Record<string, unknown> = {};
    if (name !== undefined && name !== company.name) {
      changed.name = { from: company.name, to: name };
      company.name = name;
    }
    if (timezone !== undefined && timezone !== company.timezone) {
      changed.timezone = { from: company.timezone, to: timezone };
      company.timezone = timezone;
    }
    if (Object.keys(changed).length > 0) {
      await company.save();
      await auditFromRequest(req, "COMPANY_UPDATED", "Company", company._id.toString(), { metadata: { changed } });
    }

    res.json({ data: { company: formatCompany(company) } });
  })
);

// GET /api/v1/company/settings - every member can read them (they explain how the system behaves)
companyRouter.get(
  "/settings",
  ...guard("company:read"),
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: { settings: await getCompanySettings(req.tenant!.companyId) } });
  })
);

// PATCH /api/v1/company/settings - owners and admins; send only the fields that change
companyRouter.patch(
  "/settings",
  ...guard("settings:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateCompanySettingsSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Invalid settings");
    }
    const changes = parsed.data;
    const keys = Object.keys(changes);
    if (keys.length === 0) throw new AppError(400, "VALIDATION_ERROR", "Nothing to change.");

    const before = await getCompanySettings(req.tenant!.companyId);
    await CompanySettingsModel.findOneAndUpdate(
      { companyId: req.tenant!.companyId },
      { $set: { ...changes, updatedBy: req.user!.id }, $setOnInsert: { companyId: req.tenant!.companyId } },
      { upsert: true, new: true }
    );
    const after = await getCompanySettings(req.tenant!.companyId);

    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of keys) {
      changed[key] = { from: (before as any)[key], to: (after as any)[key] };
    }
    await auditFromRequest(req, "COMPANY_SETTINGS_UPDATED", "Company", req.tenant!.companyId, { metadata: { changed } });
    res.json({ data: { settings: after } });
  })
);
