import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COMPANY_ROLES } from "@dbi/api-types";
import { can, canAccessSite, canGrantRole, canManageMember, hasAllSiteAccess } from "./permissions";

describe("role permissions (deny by default)", () => {
  it("a missing role has no permissions", () => {
    assert.equal(can(null, "sites:read"), false);
    assert.equal(can(undefined, "company:read"), false);
  });

  it("security operators review events but cannot change zones, cameras or settings (QA-02)", () => {
    assert.equal(can("SECURITY_OPERATOR", "events:review"), true);
    assert.equal(can("SECURITY_OPERATOR", "live:view"), true);
    assert.equal(can("SECURITY_OPERATOR", "zones:write"), false);
    assert.equal(can("SECURITY_OPERATOR", "cameras:write"), false);
    assert.equal(can("SECURITY_OPERATOR", "settings:write"), false);
    assert.equal(can("SECURITY_OPERATOR", "users:manage"), false);
  });

  it("auditors are read-only", () => {
    for (const p of ["sites:write", "cameras:write", "zones:write", "events:review", "manifests:write", "users:manage", "live:view"] as const) {
      assert.equal(can("AUDITOR", p), false, p);
    }
    assert.equal(can("AUDITOR", "reports:read"), true);
    assert.equal(can("AUDITOR", "audit:read"), true);
  });

  it("warehouse managers manage zones and manifests but not users or sites", () => {
    assert.equal(can("WAREHOUSE_MANAGER", "zones:write"), true);
    assert.equal(can("WAREHOUSE_MANAGER", "manifests:write"), true);
    assert.equal(can("WAREHOUSE_MANAGER", "users:manage"), false);
    assert.equal(can("WAREHOUSE_MANAGER", "sites:write"), false);
    assert.equal(can("WAREHOUSE_MANAGER", "company:update"), false);
  });

  it("owners and admins can do everything company-scoped", () => {
    for (const role of ["COMPANY_OWNER", "COMPANY_ADMIN"] as const) {
      for (const p of ["company:update", "users:manage", "sites:write", "zones:write", "audit:read"] as const) {
        assert.equal(can(role, p), true, `${role} ${p}`);
      }
    }
  });

  it("every role can read sites, cameras, zones, events and reports", () => {
    for (const role of COMPANY_ROLES) {
      for (const p of ["sites:read", "cameras:read", "zones:read", "events:read", "reports:read"] as const) {
        assert.equal(can(role, p), true, `${role} ${p}`);
      }
    }
  });
});

describe("site assignment", () => {
  it("owners and admins reach every site", () => {
    assert.equal(hasAllSiteAccess("COMPANY_OWNER"), true);
    assert.equal(hasAllSiteAccess("COMPANY_ADMIN"), true);
    assert.equal(canAccessSite("COMPANY_ADMIN", [], "site-1"), true);
  });

  it("other roles reach only assigned sites, and none when nothing is assigned", () => {
    for (const role of ["WAREHOUSE_MANAGER", "SECURITY_OPERATOR", "AUDITOR"] as const) {
      assert.equal(hasAllSiteAccess(role), false);
      assert.equal(canAccessSite(role, ["site-1"], "site-1"), true);
      assert.equal(canAccessSite(role, ["site-1"], "site-2"), false);
      assert.equal(canAccessSite(role, [], "site-1"), false);
    }
  });
});

describe("role changes", () => {
  it("only an owner can grant or change ownership", () => {
    assert.equal(canGrantRole("COMPANY_OWNER", "COMPANY_OWNER"), true);
    assert.equal(canGrantRole("COMPANY_ADMIN", "COMPANY_OWNER"), false);
    assert.equal(canManageMember("COMPANY_ADMIN", "COMPANY_OWNER"), false);
    assert.equal(canManageMember("COMPANY_OWNER", "COMPANY_OWNER"), true);
  });

  it("admins manage everyone except owners", () => {
    assert.equal(canGrantRole("COMPANY_ADMIN", "WAREHOUSE_MANAGER"), true);
    assert.equal(canManageMember("COMPANY_ADMIN", "SECURITY_OPERATOR"), true);
  });

  it("other roles cannot manage members at all", () => {
    for (const role of ["WAREHOUSE_MANAGER", "SECURITY_OPERATOR", "AUDITOR"] as const) {
      assert.equal(canGrantRole(role, "AUDITOR"), false);
      assert.equal(canManageMember(role, "AUDITOR"), false);
    }
  });
});

describe("event reopen permission", () => {
  it("owners, admins and managers may reopen; operators and auditors may not", () => {
    for (const role of ["COMPANY_OWNER", "COMPANY_ADMIN", "WAREHOUSE_MANAGER"] as const) {
      assert.equal(can(role, "events:reopen"), true, role);
    }
    for (const role of ["SECURITY_OPERATOR", "AUDITOR"] as const) {
      assert.equal(can(role, "events:reopen"), false, role);
    }
  });
});
