import type { CompanyRole } from "./index";

// Roles and permissions: the single source of truth, used by the API (to enforce) and by the
// panels (to hide controls the API would refuse). Deny by default: a role has a permission only
// if it is listed here.
export type Permission =
  | "company:read"
  | "company:update"
  | "users:read"
  | "users:manage"
  | "sites:read"
  | "sites:write"
  | "cameras:read"
  | "cameras:write"
  | "zones:read"
  | "zones:write"
  | "monitoring:read"
  | "monitoring:control"
  | "live:view"
  | "events:read"
  | "events:review"
  | "events:reopen"
  | "manifests:read"
  | "manifests:write"
  | "reports:read"
  | "reports:export"
  | "audit:read"
  | "settings:write";

const READ_ONLY: Permission[] = [
  "company:read",
  "sites:read",
  "cameras:read",
  "zones:read",
  "monitoring:read",
  "events:read",
  "manifests:read",
  "reports:read",
];

const ROLE_PERMISSIONS: Record<CompanyRole, readonly Permission[]> = {
  COMPANY_OWNER: [
    ...READ_ONLY,
    "company:update",
    "users:read",
    "users:manage",
    "sites:write",
    "cameras:write",
    "zones:write",
    "monitoring:control",
    "live:view",
    "events:review",
    "events:reopen",
    "manifests:write",
    "reports:export",
    "audit:read",
    "settings:write",
  ],
  COMPANY_ADMIN: [
    ...READ_ONLY,
    "company:update",
    "users:read",
    "users:manage",
    "sites:write",
    "cameras:write",
    "zones:write",
    "monitoring:control",
    "live:view",
    "events:review",
    "events:reopen",
    "manifests:write",
    "reports:export",
    "audit:read",
    "settings:write",
  ],
  WAREHOUSE_MANAGER: [
    ...READ_ONLY,
    "cameras:write",
    "zones:write",
    "monitoring:control",
    "live:view",
    "events:review",
    "events:reopen",
    "manifests:write",
    "reports:export",
  ],
  // Operators review events and watch live cameras; they cannot change security settings.
  SECURITY_OPERATOR: [...READ_ONLY, "live:view", "events:review"],
  // Auditors are read-only: reports and history, no live view and no changes.
  AUDITOR: [...READ_ONLY, "reports:export", "audit:read"],
};

export function can(role: CompanyRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// Owners and admins see every site of their company; other roles only their assigned sites.
export function hasAllSiteAccess(role: CompanyRole): boolean {
  return role === "COMPANY_OWNER" || role === "COMPANY_ADMIN";
}

export function canAccessSite(role: CompanyRole, assignedSiteIds: readonly string[], siteId: string): boolean {
  if (hasAllSiteAccess(role)) return true;
  return assignedSiteIds.includes(siteId);
}

// Only an owner can grant or revoke ownership; admins manage everyone else.
export function canGrantRole(actor: CompanyRole, target: CompanyRole): boolean {
  if (actor === "COMPANY_OWNER") return true;
  if (actor === "COMPANY_ADMIN") return target !== "COMPANY_OWNER";
  return false;
}

// Whether the actor may change an existing member who currently has `current`.
export function canManageMember(actor: CompanyRole, current: CompanyRole): boolean {
  if (actor === "COMPANY_OWNER") return true;
  if (actor === "COMPANY_ADMIN") return current !== "COMPANY_OWNER";
  return false;
}
