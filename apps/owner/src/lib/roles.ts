import { COMPANY_ROLES, canGrantRole, hasAllSiteAccess } from "@/types";
import type { CompanyRole } from "@/types";

export const ROLE_LABEL: Record<CompanyRole, string> = {
  COMPANY_OWNER: "Company owner",
  COMPANY_ADMIN: "Company admin",
  WAREHOUSE_MANAGER: "Warehouse manager",
  SECURITY_OPERATOR: "Security operator",
  AUDITOR: "Auditor",
};

export const ROLE_HINT: Record<CompanyRole, string> = {
  COMPANY_OWNER: "Full control of the company, including who owns it.",
  COMPANY_ADMIN: "Manages sites, cameras, settings and people, except ownership.",
  WAREHOUSE_MANAGER: "Manages cameras, zones and reviews for the sites they are assigned to.",
  SECURITY_OPERATOR: "Watches live cameras and reviews alerts at their sites. Cannot change settings.",
  AUDITOR: "Read-only access to reports and history at their sites.",
};

/** Roles the signed-in person is allowed to hand out. */
export function grantableRoles(actor: CompanyRole | null): CompanyRole[] {
  if (!actor) return [];
  return COMPANY_ROLES.filter((r) => canGrantRole(actor, r));
}

/** Owners and admins see every site; every other role needs sites assigned to it. */
export function needsSiteAssignment(role: CompanyRole): boolean {
  return !hasAllSiteAccess(role);
}
