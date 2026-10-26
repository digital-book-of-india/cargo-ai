import { Types } from "mongoose";
import { AppError } from "../middleware/errorHandler";
import { SiteModel } from "../models";

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
}

// Every id must be a site of this company; anything else is rejected, so a member can never be
// assigned a site from another tenant.
export async function resolveCompanySiteIds(companyId: string, ids: string[] | undefined): Promise<Types.ObjectId[]> {
  const unique = Array.from(new Set(ids ?? []));
  if (unique.length === 0) return [];
  if (!unique.every((id) => Types.ObjectId.isValid(id))) {
    throw new AppError(400, "VALIDATION_ERROR", "siteIds contains an invalid id.");
  }
  const found = await SiteModel.find({ _id: { $in: unique }, companyId }).select("_id").lean();
  if (found.length !== unique.length) {
    throw new AppError(400, "VALIDATION_ERROR", "siteIds contains a site that does not exist in your company.");
  }
  return found.map((s) => s._id as Types.ObjectId);
}
