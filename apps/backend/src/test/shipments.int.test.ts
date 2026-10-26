import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer } from "./harness";

// P5: vehicles, manifests, CSV import, loading sessions and reconciliation.
// Runs on a throw-away database. Observed counts come from a test provider (contract 3).

let server: TestServer;
let api: ReturnType<typeof createClient>;

interface Actor {
  token: string;
  userId: string;
  companyId: string;
}

const PASSWORD = "Test@12345";
let counter = 0;
const unique = (p: string) => `${p}${Date.now()}${counter++}`;

async function register(name: string): Promise<Actor> {
  const res = await api.post("/api/v1/auth/register", {
    name: name + " owner",
    email: `${unique("o")}@example.test`,
    password: PASSWORD,
    companyName: name,
  });
  assert.equal(res.status, 201, res.raw);
  return { token: res.body.data.token, userId: res.body.data.user.id, companyId: res.body.data.memberships[0].companyId };
}

async function addMember(owner: Actor, role: string, siteIds: string[]): Promise<Actor> {
  const invite = await api.post("/api/v1/users/invitations", { email: `${unique("m")}@example.test`, role, siteIds }, { token: owner.token });
  const accept = await api.post("/api/v1/auth/accept-invitation", { token: invite.body.data.token, name: role, password: PASSWORD });
  assert.equal(accept.status, 201, accept.raw);
  return { token: accept.body.data.token, userId: accept.body.data.user.id, companyId: accept.body.data.memberships[0].companyId };
}

describe("shipments (integration)", () => {
  let a: Actor;
  let b: Actor;
  let manager: Actor;
  let operator: Actor;
  let s1: { id: string };
  let s2: { id: string };

  // what the counting service "saw", per test
  let counts: { inCount: number; outCount: number } | null = null;

  const manifest = async (reference: string, count: number, siteId = s1.id, token = a.token) =>
    api.post("/api/v1/manifests", { reference, siteId, expectedPackageCount: count }, { token });
  const startSession = (body: Record<string, unknown>, token = a.token) => api.post("/api/v1/loading-sessions", body, { token });
  const closeSession = (id: string, body: Record<string, unknown> = {}, token = a.token) =>
    api.post(`/api/v1/loading-sessions/${id}/close`, body, { token });

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    const { setObservedCountProvider } = await import("../services/counts/observed");
    setObservedCountProvider(async () => counts);

    a = await register("Ship A");
    b = await register("Ship B");
    s1 = (await api.post("/api/v1/sites", { name: "North", code: "N1" }, { token: a.token })).body.data.site;
    s2 = (await api.post("/api/v1/sites", { name: "South", code: "S1" }, { token: a.token })).body.data.site;
    await api.post(`/api/v1/sites/${s1.id}/cameras`, { name: "C1", protocol: "RTSP", host: "192.0.2.1" }, { token: a.token });
    manager = await addMember(a, "WAREHOUSE_MANAGER", [s1.id]);
    operator = await addMember(a, "SECURITY_OPERATOR", [s1.id]);
  });

  after(async () => {
    const { setObservedCountProvider } = await import("../services/counts/observed");
    setObservedCountProvider(null);
    await server.close();
  });

  describe("vehicles", () => {
    it("registers a vehicle, normalises the plate, and refuses a duplicate", async () => {
      const res = await api.post("/api/v1/vehicles", { registrationNumber: " mh12 ab 1234 ", label: "Truck 1" }, { token: manager.token });
      assert.equal(res.status, 201, res.raw);
      assert.equal(res.body.data.vehicle.registrationNumber, "MH12 AB 1234");
      const dup = await api.post("/api/v1/vehicles", { registrationNumber: "MH12 AB 1234" }, { token: a.token });
      assert.equal(dup.status, 409);
    });

    it("is private to the company and read-only for operators", async () => {
      assert.equal((await api.post("/api/v1/vehicles", { registrationNumber: "KA01 XX 9" }, { token: operator.token })).status, 403);
      const mine = await api.get("/api/v1/vehicles", { token: operator.token });
      assert.equal(mine.status, 200);
      assert.ok(mine.body.data.items.length >= 1);
      const other = await api.get("/api/v1/vehicles", { token: b.token });
      assert.equal(other.body.data.items.length, 0);
      const id = mine.body.data.items[0].id;
      assert.equal((await api.patch(`/api/v1/vehicles/${id}`, { active: false }, { token: b.token })).status, 404);
    });
  });

  describe("manifests", () => {
    it("creates, reads, updates and audits a manifest", async () => {
      const res = await manifest("MAN-100", 100);
      assert.equal(res.status, 201, res.raw);
      const m = res.body.data.manifest;
      assert.equal(m.status, "active");
      assert.equal(m.source, "manual");
      assert.equal(m.site.code, "N1");
      const upd = await api.patch(`/api/v1/manifests/${m.id}`, { expectedPackageCount: 120, notes: "Updated" }, { token: manager.token });
      assert.equal(upd.status, 200, upd.raw);
      assert.equal(upd.body.data.manifest.expectedPackageCount, 120);
      const { AuditLogModel } = await import("../models");
      const logged = await AuditLogModel.find({ companyId: a.companyId, targetId: m.id }).lean();
      assert.deepEqual(logged.map((x) => x.action).sort(), ["MANIFEST_CREATED", "MANIFEST_UPDATED"]);
    });

    it("refuses a duplicate reference, bad counts and unknown sites", async () => {
      assert.equal((await manifest("MAN-100", 5)).status, 409);
      assert.equal((await manifest("NEG", -1)).status, 400);
      assert.equal((await manifest("FRAC", 1.5)).status, 400);
      assert.equal((await manifest("=CMD()", 1)).status, 400);
      assert.equal((await manifest("NOSITE", 1, "64b64b64b64b64b64b64b64b")).status, 404);
    });

    it("keeps companies apart: another company gets 404 and an empty list", async () => {
      const list = await api.get("/api/v1/manifests", { token: b.token });
      assert.equal(list.body.data.items.length, 0);
      const mine = await api.get("/api/v1/manifests", { token: a.token });
      const id = mine.body.data.items[0].id;
      assert.equal((await api.get(`/api/v1/manifests/${id}`, { token: b.token })).status, 404);
      assert.equal((await api.patch(`/api/v1/manifests/${id}`, { notes: "x" }, { token: b.token })).status, 404);
      // the same reference is free in another company
      assert.equal((await manifest("MAN-100", 1, (await api.post("/api/v1/sites", { name: "X", code: "X1" }, { token: b.token })).body.data.site.id, b.token)).status, 201);
    });

    it("respects site assignment: an operator-scope member cannot use another site", async () => {
      const m = await manifest("MAN-S2", 10, s2.id);
      assert.equal(m.status, 201);
      assert.equal((await api.get(`/api/v1/manifests/${m.body.data.manifest.id}`, { token: manager.token })).status, 404);
      assert.equal((await manifest("MAN-S2-MGR", 1, s2.id, manager.token)).status, 404);
      const list = await api.get("/api/v1/manifests", { token: manager.token });
      assert.ok(list.body.data.items.every((x: any) => x.siteId === s1.id));
    });

    it("operators can read but not write", async () => {
      assert.equal((await manifest("OP-1", 1, s1.id, operator.token)).status, 403);
      assert.equal((await api.get("/api/v1/manifests", { token: operator.token })).status, 200);
    });

    it("pages with a cursor", async () => {
      for (let i = 0; i < 3; i++) await manifest(`PAGE-${i}`, i);
      const first = await api.get("/api/v1/manifests?limit=2", { token: a.token });
      assert.equal(first.body.data.items.length, 2);
      assert.ok(first.body.data.nextCursor);
      const next = await api.get(`/api/v1/manifests?limit=2&cursor=${first.body.data.nextCursor}`, { token: a.token });
      const ids = new Set([...first.body.data.items, ...next.body.data.items].map((x: any) => x.id));
      assert.equal(ids.size, first.body.data.items.length + next.body.data.items.length, "no repeats across pages");
    });
  });

  describe("csv import", () => {
    const imp = (content: string, extra: Record<string, unknown> = {}, token = a.token) =>
      api.post("/api/v1/manifests/import", { fileName: "m.csv", content, ...extra }, { token });

    it("imports a good file and creates real manifests", async () => {
      const res = await imp("reference,siteCode,expectedPackageCount,notes\nIMP-1,N1,10,first\nIMP-2,S1,20,\n");
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.data.job.status, "COMPLETED");
      assert.equal(res.body.data.job.createdCount, 2);
      const list = await api.get("/api/v1/manifests?q=IMP-", { token: a.token });
      assert.equal(list.body.data.items.length, 2);
      assert.ok(list.body.data.items.every((x: any) => x.source === "csv_import"));
    });

    it("sending the same file again writes nothing and says so", async () => {
      const content = "reference,siteCode,expectedPackageCount\nIDEM-1,N1,5\n";
      const first = await imp(content);
      assert.equal(first.body.data.job.status, "COMPLETED");
      const again = await imp(content);
      assert.equal(again.body.data.job.duplicate, true);
      assert.equal(again.body.data.job.id, first.body.data.job.id);
      assert.equal((await api.get("/api/v1/manifests?q=IDEM-", { token: a.token })).body.data.items.length, 1);
    });

    it("is all-or-nothing by default and lists every bad row", async () => {
      const res = await imp("reference,siteCode,expectedPackageCount\nATOM-1,N1,5\nATOM-2,NOPE,5\nMAN-100,N1,5\nATOM-4,N1,abc\n");
      const job = res.body.data.job;
      assert.equal(job.status, "FAILED");
      assert.equal(job.createdCount, 0);
      assert.deepEqual(job.errors.map((e: any) => e.row), [3, 4, 5]);
      assert.equal((await api.get("/api/v1/manifests?q=ATOM-", { token: a.token })).body.data.items.length, 0, "the good row was not written either");
    });

    it("allowPartial keeps the good rows and reports the rest", async () => {
      const res = await imp("reference,siteCode,expectedPackageCount\nPART-1,N1,5\nPART-2,NOPE,5\n", { allowPartial: true });
      assert.equal(res.body.data.job.status, "PARTIAL");
      assert.equal(res.body.data.job.createdCount, 1);
      assert.equal(res.body.data.job.errors.length, 1);
      assert.equal((await api.get("/api/v1/manifests?q=PART-", { token: a.token })).body.data.items.length, 1);
    });

    it("only accepts site codes the member may use, and only their own company's", async () => {
      const res = await imp("reference,siteCode,expectedPackageCount\nSCOPE-1,S1,5\n", {}, manager.token);
      assert.equal(res.body.data.job.status, "FAILED", "the manager is not assigned to S1");
      const other = await imp("reference,siteCode,expectedPackageCount\nSCOPE-2,N1,5\n", {}, b.token);
      assert.equal(other.body.data.job.status, "FAILED", "company B has no site N1");
    });

    it("refuses an empty file, a bad header, a huge file, and operators", async () => {
      assert.equal((await imp("")).status, 400);
      assert.equal((await imp("a,b\n1,2\n")).body.data.job.status, "FAILED");
      assert.equal((await imp("x".repeat(1024 * 1024 + 10))).status, 413);
      assert.equal((await imp("reference,siteCode,expectedPackageCount\nOPX,N1,1\n", {}, operator.token)).status, 403);
    });
  });

  describe("loading sessions and reconciliation", () => {
    it("manifest 100, observed 94: difference -6, review required, one mismatch event (QA-07)", async () => {
      const m = (await manifest("REC-100", 100)).body.data.manifest;
      const v = (await api.get("/api/v1/vehicles", { token: a.token })).body.data.items[0];
      const s = await startSession({ siteId: s1.id, manifestId: m.id, vehicleId: v.id, direction: "outbound" });
      assert.equal(s.status, 201, s.raw);
      assert.equal(s.body.data.session.expectedCountSnapshot, 100);
      assert.equal(s.body.data.session.reconciliationStatus, "in_progress");
      assert.ok(s.body.data.session.disclaimer);

      counts = { inCount: 0, outCount: 94 };
      const closed = await closeSession(s.body.data.session.id, { closeNote: "Truck left" });
      assert.equal(closed.status, 200, closed.raw);
      const r = closed.body.data.session;
      assert.equal(r.observedCount, 94);
      assert.equal(r.difference, -6);
      assert.equal(r.reconciliationStatus, "review_required");
      assert.ok(closed.body.data.mismatchEvent);
      assert.equal(closed.body.data.mismatchEvent.severity, "high");

      const events = await api.get(`/api/v1/events?eventType=count_mismatch`, { token: a.token });
      assert.equal(events.body.data.items.filter((e: any) => e.id === closed.body.data.mismatchEvent.id).length, 1);

      // closing again is refused and creates nothing more
      assert.equal((await closeSession(s.body.data.session.id)).status, 409);
      const after = await api.get(`/api/v1/events?eventType=count_mismatch`, { token: a.token });
      assert.equal(after.body.data.items.length, events.body.data.items.length);

      // the manifest is closed and cannot start another session
      assert.equal((await api.get(`/api/v1/manifests/${m.id}`, { token: a.token })).body.data.manifest.status, "closed");
      assert.equal((await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).status, 422);
    });

    it("a matching count is matched and raises no event", async () => {
      const m = (await manifest("REC-OK", 50)).body.data.manifest;
      const s = (await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).body.data.session;
      counts = { inCount: 0, outCount: 50 };
      const closed = await closeSession(s.id);
      assert.equal(closed.body.data.session.reconciliationStatus, "matched");
      assert.equal(closed.body.data.session.difference, 0);
      assert.equal(closed.body.data.mismatchEvent, null);
    });

    it("the company tolerance decides what counts as a match", async () => {
      const set = await api.patch("/api/v1/company/settings", { mismatchTolerance: 6 }, { token: a.token });
      assert.equal(set.status, 200, set.raw);
      const m = (await manifest("REC-TOL", 100)).body.data.manifest;
      const s = (await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).body.data.session;
      counts = { inCount: 0, outCount: 94 };
      const closed = await closeSession(s.id);
      assert.equal(closed.body.data.session.reconciliationStatus, "matched");
      assert.equal(closed.body.data.session.toleranceUsed, 6);
      await api.patch("/api/v1/company/settings", { mismatchTolerance: 0 }, { token: a.token });
    });

    it("the other direction is stored but never subtracted from the count", async () => {
      const m = (await manifest("REC-NET", 10)).body.data.manifest;
      const s = (await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).body.data.session;
      counts = { inCount: 2, outCount: 12 };
      const closed = await closeSession(s.id);
      assert.equal(closed.body.data.session.observedCount, 12, "only the OUT crossings are the observed count");
      assert.deepEqual(closed.body.data.session.countsBreakdown, { in: 2, out: 12 });
      assert.equal(closed.body.data.session.difference, 2);
      assert.equal(closed.body.data.session.reconciliationStatus, "review_required", "12 seen against 10 expected is outside a tolerance of 0");
    });

    it("never guesses: no counting service means closed_unverified and no event", async () => {
      const m = (await manifest("REC-NONE", 10)).body.data.manifest;
      const s = (await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).body.data.session;
      counts = null;
      const closed = await closeSession(s.id);
      assert.equal(closed.body.data.session.reconciliationStatus, "closed_unverified");
      assert.equal(closed.body.data.session.observedCount, null);
      assert.equal(closed.body.data.mismatchEvent, null);
    });

    it("a session without a manifest closes as unverified", async () => {
      const s = (await startSession({ siteId: s1.id, direction: "inbound" })).body.data.session;
      counts = { inCount: 7, outCount: 0 };
      const closed = await closeSession(s.id);
      assert.equal(closed.body.data.session.reconciliationStatus, "closed_unverified");
      assert.equal(closed.body.data.session.observedCount, 7, "the count is still recorded");
    });

    it("flags a coverage gap when a camera went offline during the session", async () => {
      const m = (await manifest("REC-GAP", 10)).body.data.manifest;
      const s = (await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).body.data.session;
      const cams = await api.get(`/api/v1/sites/${s1.id}/cameras`, { token: a.token });
      const ev = await api.post(
        "/api/v1/ai/events",
        { eventKey: unique("gap"), siteId: s1.id, cameraId: cams.body.data.items[0].id, eventType: "camera_offline", occurredAt: new Date().toISOString() },
        { headers: { "x-service-token": process.env.AI_SERVICE_TOKEN ?? "dbi-ai-worker-secret-token" } }
      );
      assert.ok(ev.status < 300, ev.raw);
      counts = { inCount: 0, outCount: 10 };
      const closed = await closeSession(s.id);
      assert.equal(closed.body.data.session.coverageGap, true);
    });

    it("allows one open session per manifest", async () => {
      const m = (await manifest("ONE-OPEN", 10)).body.data.manifest;
      assert.equal((await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).status, 201);
      assert.equal((await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).status, 409);
      assert.equal((await api.patch(`/api/v1/manifests/${m.id}`, { expectedPackageCount: 99 }, { token: a.token })).status, 409);
    });

    it("rejects a manifest from another site, a bad time, and strangers", async () => {
      const other = (await manifest("OTHER-SITE", 5, s2.id)).body.data.manifest;
      assert.equal((await startSession({ siteId: s1.id, manifestId: other.id, direction: "outbound" })).status, 400);
      assert.equal((await startSession({ siteId: s1.id, direction: "outbound", startedAt: new Date(Date.now() + 86400_000).toISOString() })).status, 400);
      assert.equal((await startSession({ siteId: s1.id, direction: "sideways" })).status, 400);
      assert.equal((await startSession({ siteId: s1.id, direction: "outbound" }, b.token)).status, 404);
      assert.equal((await startSession({ siteId: s2.id, direction: "outbound" }, manager.token)).status, 404, "manager is not on S1... S2");
      assert.equal((await startSession({ siteId: s1.id, direction: "outbound" }, operator.token)).status, 403);
    });

    it("hides sessions from other companies and from members without the site", async () => {
      const s = (await startSession({ siteId: s2.id, direction: "outbound" })).body.data.session;
      assert.equal((await api.get(`/api/v1/loading-sessions/${s.id}`, { token: b.token })).status, 404);
      assert.equal((await api.get(`/api/v1/loading-sessions/${s.id}`, { token: manager.token })).status, 404);
      assert.equal((await closeSession(s.id, {}, b.token)).status, 404);
      const list = await api.get("/api/v1/loading-sessions?open=true", { token: manager.token });
      assert.ok(list.body.data.items.every((x: any) => x.siteId === s1.id));
    });

    it("a repeated close request cannot create two mismatch events", async () => {
      const m = (await manifest("RACE", 100)).body.data.manifest;
      const s = (await startSession({ siteId: s1.id, manifestId: m.id, direction: "outbound" })).body.data.session;
      counts = { inCount: 0, outCount: 80 };
      const [x, y] = await Promise.all([closeSession(s.id), closeSession(s.id)]);
      assert.deepEqual([x.status, y.status].sort(), [200, 409]);
      const events = await api.get(`/api/v1/events?eventType=count_mismatch`, { token: a.token });
      assert.equal(events.body.data.items.filter((e: any) => e.summary.includes("observed 80")).length, 1);
    });
  });
});
