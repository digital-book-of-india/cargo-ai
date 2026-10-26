import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer } from "./harness";

// Integration tests for tenancy, roles and invitations. They run against a throw-away database
// (see harness.ts) and cover QA-01 (cross-company access) and QA-02 (operator cannot edit zones).

let server: TestServer;
let api: ReturnType<typeof createClient>;

interface Actor {
  token: string;
  userId: string;
  companyId: string;
}

const PASSWORD = "Test@12345";
let counter = 0;
const unique = (prefix: string) => `${prefix}${Date.now()}${counter++}@example.test`;

async function register(companyName: string): Promise<Actor> {
  const res = await api.post("/api/v1/auth/register", {
    name: companyName + " owner",
    email: unique("owner"),
    password: PASSWORD,
    companyName,
  });
  assert.equal(res.status, 201, res.raw);
  return {
    token: res.body.data.token,
    userId: res.body.data.user.id,
    companyId: res.body.data.memberships[0].companyId,
  };
}

async function createSite(owner: Actor, name: string, code: string) {
  const res = await api.post("/api/v1/sites", { name, code }, { token: owner.token });
  assert.equal(res.status, 201, res.raw);
  return res.body.data.site as { id: string; companyId: string };
}

// Invites a person with a role, accepts the invitation, and returns their session.
async function addMember(owner: Actor, role: string, siteIds: string[]): Promise<Actor> {
  const email = unique(role.toLowerCase());
  const invite = await api.post("/api/v1/users/invitations", { email, role, siteIds }, { token: owner.token });
  assert.equal(invite.status, 201, invite.raw);
  const accept = await api.post("/api/v1/auth/accept-invitation", {
    token: invite.body.data.token,
    name: role,
    password: PASSWORD,
  });
  assert.equal(accept.status, 201, accept.raw);
  return {
    token: accept.body.data.token,
    userId: accept.body.data.user.id,
    companyId: accept.body.data.memberships[0].companyId,
  };
}

async function addCamera(actor: Actor, siteId: string) {
  const res = await api.post(
    `/api/v1/sites/${siteId}/cameras`,
    { name: "Bay camera", protocol: "RTSP", host: "192.0.2.10", username: "admin", password: "s3cret-pass" },
    { token: actor.token }
  );
  assert.equal(res.status, 201, res.raw);
  return res.body.data.camera as { id: string; siteId: string };
}

const ZONE = {
  zoneType: "CUSTOM",
  polygon: [
    { x: 0.1, y: 0.1 },
    { x: 0.9, y: 0.1 },
    { x: 0.9, y: 0.9 },
  ],
  sensitivity: "MEDIUM",
  enabled: true,
};

describe("tenancy and roles (integration)", () => {
  let a: Actor;
  let b: Actor;
  let a1: { id: string };
  let a2: { id: string };
  let b1: { id: string };
  let manager: Actor;
  let operator: Actor;
  let auditor: Actor;
  let admin: Actor;
  let cameraA1: { id: string };

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);

    a = await register("Company A");
    b = await register("Company B");
    a1 = await createSite(a, "A North", "A-NORTH");
    a2 = await createSite(a, "A South", "A-SOUTH");
    b1 = await createSite(b, "B Main", "B-MAIN");
    cameraA1 = await addCamera(a, a1.id);

    manager = await addMember(a, "WAREHOUSE_MANAGER", [a1.id]);
    operator = await addMember(a, "SECURITY_OPERATOR", [a1.id]);
    auditor = await addMember(a, "AUDITOR", [a1.id]);
    admin = await addMember(a, "COMPANY_ADMIN", []);
  });

  after(async () => {
    await server.close();
  });

  describe("registration and login", () => {
    it("register creates a company with an owner membership", async () => {
      const me = await api.get("/api/v1/me", { token: a.token });
      assert.equal(me.status, 200);
      assert.equal(me.body.data.memberships[0].role, "COMPANY_OWNER");
      assert.equal(me.body.data.memberships[0].companyName, "Company A");
    });

    it("rejects a request with no token", async () => {
      const res = await api.get("/api/v1/sites");
      assert.equal(res.status, 401);
    });
  });

  describe("QA-01: company A cannot reach company B", () => {
    it("returns 404 for another company's site and leaks nothing", async () => {
      const res = await api.get(`/api/v1/sites/${b1.id}`, { token: a.token });
      assert.equal(res.status, 404);
      assert.ok(!res.raw.includes("B Main"), "response must not contain the other company's data");
    });

    it("cannot update, archive or list cameras of another company's site", async () => {
      assert.equal((await api.patch(`/api/v1/sites/${b1.id}`, { name: "hijack" }, { token: a.token })).status, 404);
      assert.equal((await api.delete(`/api/v1/sites/${b1.id}`, { token: a.token })).status, 404);
      assert.equal((await api.get(`/api/v1/sites/${b1.id}/cameras`, { token: a.token })).status, 404);
      assert.equal((await api.get(`/api/v1/sites/${b1.id}/events`, { token: a.token })).status, 404);
    });

    it("the site list only contains the caller's own company", async () => {
      const res = await api.get("/api/v1/sites", { token: b.token });
      assert.equal(res.status, 200);
      const ids = res.body.data.items.map((s: any) => s.id);
      assert.deepEqual(ids, [b1.id]);
    });

    it("cannot reach another company's camera", async () => {
      const cameraB = await addCamera(b, b1.id);
      assert.equal((await api.post(`/api/v1/cameras/${cameraB.id}/test`, {}, { token: a.token })).status, 404);
      assert.equal((await api.get(`/api/v1/cameras/${cameraB.id}/zones`, { token: a.token })).status, 404);
      assert.equal((await api.delete(`/api/v1/cameras/${cameraB.id}`, { token: a.token })).status, 404);
    });

    it("ignores a companyId in the request body", async () => {
      const res = await api.post(
        "/api/v1/sites",
        { name: "Sneaky", code: "SNEAKY", companyId: a.companyId },
        { token: b.token }
      );
      assert.equal(res.status, 201);
      assert.equal(res.body.data.site.companyId, b.companyId);
    });

    it("rejects X-Company-Id for a company the user does not belong to", async () => {
      const res = await api.get("/api/v1/sites", { token: b.token, headers: { "x-company-id": a.companyId } });
      assert.equal(res.status, 403);
    });

    it("cannot move a camera to another company's site", async () => {
      const res = await api.post(`/api/v1/cameras/${cameraA1.id}/assign-site`, { siteId: b1.id }, { token: a.token });
      assert.equal(res.status, 404);
    });
  });

  describe("QA-02: roles", () => {
    it("a security operator cannot edit a zone, add a camera or create a site", async () => {
      assert.equal((await api.put(`/api/v1/cameras/${cameraA1.id}/zones`, ZONE, { token: operator.token })).status, 403);
      const cam = await api.post(
        `/api/v1/sites/${a1.id}/cameras`,
        { name: "x", protocol: "RTSP", host: "192.0.2.11" },
        { token: operator.token }
      );
      assert.equal(cam.status, 403);
      assert.equal((await api.post("/api/v1/sites", { name: "n", code: "N1" }, { token: operator.token })).status, 403);
    });

    it("a warehouse manager can edit a zone of an assigned site", async () => {
      const res = await api.put(`/api/v1/cameras/${cameraA1.id}/zones`, ZONE, { token: manager.token });
      assert.equal(res.status, 200, res.raw);
    });

    it("an auditor can read but not change", async () => {
      assert.equal((await api.get(`/api/v1/cameras/${cameraA1.id}/zones`, { token: auditor.token })).status, 200);
      assert.equal((await api.put(`/api/v1/cameras/${cameraA1.id}/zones`, ZONE, { token: auditor.token })).status, 403);
      assert.equal((await api.patch(`/api/v1/sites/${a1.id}`, { name: "x" }, { token: auditor.token })).status, 403);
    });

    it("only owners and admins can see the user list", async () => {
      assert.equal((await api.get("/api/v1/users", { token: a.token })).status, 200);
      assert.equal((await api.get("/api/v1/users", { token: admin.token })).status, 200);
      assert.equal((await api.get("/api/v1/users", { token: manager.token })).status, 403);
      assert.equal((await api.get("/api/v1/users", { token: operator.token })).status, 403);
    });
  });

  describe("site assignment", () => {
    it("members see only their assigned sites", async () => {
      const res = await api.get("/api/v1/sites", { token: manager.token });
      assert.deepEqual(res.body.data.items.map((s: any) => s.id), [a1.id]);
      assert.equal((await api.get(`/api/v1/sites/${a2.id}`, { token: manager.token })).status, 404);
    });

    it("owners and admins see every site of their company", async () => {
      for (const actor of [a, admin]) {
        const res = await api.get("/api/v1/sites", { token: actor.token });
        assert.equal(res.body.data.items.length, 2);
      }
    });

    it("a manager cannot move a camera to a site they are not assigned to", async () => {
      const res = await api.post(`/api/v1/cameras/${cameraA1.id}/assign-site`, { siteId: a2.id }, { token: manager.token });
      assert.equal(res.status, 404);
    });

    it("an owner can move a camera between sites of the same company", async () => {
      const moved = await api.post(`/api/v1/cameras/${cameraA1.id}/assign-site`, { siteId: a2.id }, { token: a.token });
      assert.equal(moved.status, 200, moved.raw);
      assert.equal(moved.body.data.camera.siteId, a2.id);
      // the manager lost sight of it, because it now sits on a site they are not assigned to
      assert.equal((await api.post(`/api/v1/cameras/${cameraA1.id}/test`, {}, { token: manager.token })).status, 404);
      const back = await api.post(`/api/v1/cameras/${cameraA1.id}/assign-site`, { siteId: a1.id }, { token: a.token });
      assert.equal(back.status, 200);
    });
  });

  describe("users, roles and invitations", () => {
    it("an admin cannot grant ownership or change an owner", async () => {
      const invite = await api.post(
        "/api/v1/users/invitations",
        { email: unique("x"), role: "COMPANY_OWNER" },
        { token: admin.token }
      );
      assert.equal(invite.status, 403);
      const change = await api.patch(`/api/v1/users/${a.userId}/role`, { role: "AUDITOR" }, { token: admin.token });
      assert.equal(change.status, 403);
    });

    it("the last owner cannot be demoted or disabled", async () => {
      const demote = await api.patch(`/api/v1/users/${a.userId}/role`, { role: "COMPANY_ADMIN" }, { token: a.token });
      assert.equal(demote.status, 422);
      assert.equal(demote.body.error.code, "BUSINESS_RULE_FAILED");
      const disable = await api.patch(`/api/v1/users/${a.userId}/status`, { status: "DISABLED" }, { token: a.token });
      assert.equal(disable.status, 422);
    });

    it("an owner can change a role and the change is audited", async () => {
      const res = await api.patch(
        `/api/v1/users/${auditor.userId}/role`,
        { role: "AUDITOR", siteIds: [a1.id, a2.id] },
        { token: a.token }
      );
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.data.member.siteIds.length, 2);
      const mongoose = (await import("mongoose")).default;
      const log = await mongoose.connection
        .collection("auditlogs")
        .findOne({ action: "MEMBER_ROLE_CHANGED", targetId: auditor.userId });
      assert.ok(log, "role change must be written to the audit log");
      assert.equal(String(log!.companyId), a.companyId);
    });

    it("an invitation token works exactly once", async () => {
      const email = unique("once");
      const invite = await api.post("/api/v1/users/invitations", { email, role: "AUDITOR" }, { token: a.token });
      const body = { token: invite.body.data.token, name: "Once", password: PASSWORD };
      assert.equal((await api.post("/api/v1/auth/accept-invitation", body)).status, 201);
      const again = await api.post("/api/v1/auth/accept-invitation", body);
      assert.equal(again.status, 400);
      assert.equal(again.body.error.code, "INVALID_INVITATION");
    });

    it("rejects an unknown or expired invitation token", async () => {
      const bad = await api.post("/api/v1/auth/accept-invitation", { token: "nope", name: "x", password: PASSWORD });
      assert.equal(bad.status, 400);

      const invite = await api.post("/api/v1/users/invitations", { email: unique("late"), role: "AUDITOR" }, { token: a.token });
      const mongoose = (await import("mongoose")).default;
      await mongoose.connection
        .collection("invitations")
        .updateOne({ _id: new mongoose.Types.ObjectId(invite.body.data.id) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
      const expired = await api.post("/api/v1/auth/accept-invitation", {
        token: invite.body.data.token,
        name: "Late",
        password: PASSWORD,
      });
      assert.equal(expired.status, 400);
    });

    it("rejects inviting someone to a site of another company", async () => {
      const res = await api.post(
        "/api/v1/users/invitations",
        { email: unique("x"), role: "WAREHOUSE_MANAGER", siteIds: [b1.id] },
        { token: a.token }
      );
      assert.equal(res.status, 400);
    });

    it("rejects inviting an existing member", async () => {
      const me = await api.get("/api/v1/users", { token: a.token });
      const existing = me.body.data.items.find((m: any) => m.userId === manager.userId);
      const res = await api.post(
        "/api/v1/users/invitations",
        { email: existing.email, role: "AUDITOR" },
        { token: a.token }
      );
      assert.equal(res.status, 409);
    });

    it("a disabled member loses access immediately", async () => {
      const victim = await addMember(a, "AUDITOR", [a1.id]);
      assert.equal((await api.get("/api/v1/sites", { token: victim.token })).status, 200);
      const off = await api.patch(`/api/v1/users/${victim.userId}/status`, { status: "DISABLED" }, { token: a.token });
      assert.equal(off.status, 200, off.raw);
      const after = await api.get("/api/v1/sites", { token: victim.token });
      assert.equal(after.status, 403);
    });
  });

  describe("company and site rules", () => {
    it("a duplicate site code in the same company is rejected, but another company may reuse it", async () => {
      const dup = await api.post("/api/v1/sites", { name: "Dup", code: "A-NORTH" }, { token: a.token });
      assert.equal(dup.status, 409);
      const other = await api.post("/api/v1/sites", { name: "Reuse", code: "A-NORTH" }, { token: b.token });
      assert.equal(other.status, 201);
    });

    it("rejects an invalid timezone", async () => {
      const res = await api.post("/api/v1/sites", { name: "TZ", code: "TZ1", timezone: "Not/AZone" }, { token: a.token });
      assert.equal(res.status, 400);
    });

    it("a site with cameras cannot be archived; an empty one can", async () => {
      assert.equal((await api.delete(`/api/v1/sites/${a1.id}`, { token: a.token })).status, 422);
      const empty = await createSite(a, "Empty", "EMPTY1");
      const archived = await api.delete(`/api/v1/sites/${empty.id}`, { token: a.token });
      assert.equal(archived.status, 200);
      assert.equal(archived.body.data.site.status, "ARCHIVED");
      const patch = await api.patch(`/api/v1/sites/${empty.id}`, { name: "x" }, { token: a.token });
      assert.equal(patch.status, 422);
    });

    it("a suspended company is locked out", async () => {
      const c = await register("Suspend Me");
      const mongoose = (await import("mongoose")).default;
      await mongoose.connection
        .collection("companies")
        .updateOne({ _id: new mongoose.Types.ObjectId(c.companyId) }, { $set: { status: "SUSPENDED" } });
      const res = await api.get("/api/v1/sites", { token: c.token });
      assert.equal(res.status, 403);
      assert.equal(res.body.error.code, "COMPANY_SUSPENDED");
    });

    it("never returns camera credentials", async () => {
      const list = await api.get(`/api/v1/sites/${a1.id}/cameras`, { token: a.token });
      assert.ok(!list.raw.includes("s3cret-pass"));
      assert.ok(!list.raw.includes("secretRef"));
      assert.ok(!list.raw.includes("192.0.2.10"));
    });
  });

  describe("AI event ingestion", () => {
    const token = () => process.env.AI_SERVICE_TOKEN ?? "dbi-ai-worker-secret-token";
    const headers = () => ({ "x-service-token": token() });
    const payload = (key: string, extra: Record<string, unknown> = {}) => ({
      eventKey: key,
      siteId: a1.id,
      cameraId: cameraA1.id,
      eventType: "restricted_zone_movement",
      occurredAt: new Date().toISOString(),
      ...extra,
    });

    it("requires the service token", async () => {
      const res = await api.post("/internal/v1/ai/events", {});
      assert.equal(res.status, 401);
    });

    it("creates an event for the site's own company and notifies only reviewers with access", async () => {
      const body = payload(unique("evt"));
      const created = await api.post("/internal/v1/ai/events", body, { headers: headers() });
      assert.equal(created.status, 202, created.raw);
      const eventId = created.body.data.eventId;

      const seen = await api.get(`/api/v1/events/${eventId}`, { token: operator.token });
      assert.equal(seen.status, 200);
      assert.equal(seen.body.data.event.companyId, a.companyId);

      // company B must not see it
      assert.equal((await api.get(`/api/v1/events/${eventId}`, { token: b.token })).status, 404);

      const ownerNotes = await api.get("/api/v1/notifications", { token: a.token });
      assert.ok(ownerNotes.body.data.items.some((n: any) => n.eventId === eventId));
      const auditorNotes = await api.get("/api/v1/notifications", { token: auditor.token });
      assert.ok(!auditorNotes.body.data.items.some((n: any) => n.eventId === eventId));
      const bNotes = await api.get("/api/v1/notifications", { token: b.token });
      assert.ok(!bNotes.body.data.items.some((n: any) => n.eventId === eventId));

      // the same event again is not duplicated and returns the same id
      const again = await api.post("/internal/v1/ai/events", body, { headers: headers() });
      assert.equal(again.status, 200);
      assert.equal(again.body.data.ingestionStatus, "already_processed");
      assert.equal(again.body.data.eventId, eventId);
    });

    it("rejects a camera that does not belong to the site", async () => {
      const cameraB = await addCamera(b, b1.id);
      const res = await api.post(
        "/internal/v1/ai/events",
        payload(unique("evt"), { cameraId: cameraB.id }),
        { headers: headers() }
      );
      assert.equal(res.status, 400);
    });

    it("operators can review events at their site; auditors cannot", async () => {
      const events = await api.get("/api/v1/events", { token: operator.token });
      const id = events.body.data.items[0].id;
      const ok = await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: operator.token });
      assert.equal(ok.status, 200, ok.raw);
      const denied = await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: auditor.token });
      assert.equal(denied.status, 403);
    });
  });
});
