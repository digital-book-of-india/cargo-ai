import { DEFAULT_SETTINGS, type CompanySettings } from "@dbi/api-types";
import { env } from "../../config/env";
import { CompanySettingsModel } from "../../models";

// Settings with the platform defaults filled in. This is the one place other code (event
// notifications, retention, reconciliation, reports) reads them from.
export async function getCompanySettings(companyId: string): Promise<CompanySettings> {
  const doc = await CompanySettingsModel.findOne({ companyId }).lean();
  return {
    mismatchTolerance: doc?.mismatchTolerance ?? DEFAULT_SETTINGS.mismatchTolerance,
    retentionDays: doc?.retentionDays ?? env.eventRetentionDays,
    defaultConfidence: doc?.defaultConfidence ?? DEFAULT_SETTINGS.defaultConfidence,
    shifts: (doc?.shifts ?? DEFAULT_SETTINGS.shifts).map((s) => ({ name: s.name, start: s.start, end: s.end })),
    notificationRules: {
      inAppMinSeverity: (doc?.notificationRules?.inAppMinSeverity as CompanySettings["notificationRules"]["inAppMinSeverity"]) ??
        DEFAULT_SETTINGS.notificationRules.inAppMinSeverity,
      mutedEventTypes: (doc?.notificationRules?.mutedEventTypes ?? []) as CompanySettings["notificationRules"]["mutedEventTypes"],
    },
    updatedAt: doc?.updatedAt?.toISOString(),
  };
}

// Retention days per company that chose their own value (all others use the platform default).
export async function retentionOverrides(): Promise<Map<string, number>> {
  const rows = await CompanySettingsModel.find({ retentionDays: { $exists: true } })
    .select("companyId retentionDays")
    .lean();
  return new Map(rows.map((r) => [r.companyId.toString(), r.retentionDays as number]));
}
