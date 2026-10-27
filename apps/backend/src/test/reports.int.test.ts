import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer, uploadFile } from "./harness";

// P6: reports (time zones, shifts, coverage gaps), CSV export, the company audit trail and
// audited support access. Runs on a throw-away database.

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
const SERVICE = () => ({ "x-service-token": process.env.AI_SERVICE_TOKEN ?? "dbi-ai-worker-secret-token" });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

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

describe("reports and audit (integration)", () => {
  let a: Actor;
  let b: Actor;
  let manager: Actor;
  let operator: Actor;
  let auditor: Actor;
  let tokyo: { id: string };
  let london: { id: string };
  let camT: { id: string };
  let camL: { id: string };

  const ingest = (siteId: string, cameraId: string, eventType: string, occurredAt: string, extra: Record<string, unknown> = {}) =>
    api.post("/api/v1/ai/events", { eventKey: unique("e"), siteId, cameraId, eventType, occurredAt, ...extra }, { headers: SERVICE() });

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    a = await register("Rep A");
    b = await register("Rep B");
    tokyo = (await api.post("/api/v1/sites", { name: "Tokyo", code: "TK", timezone: "Asia/Tokyo" }, { token: a.token })).body.data.site;
    london = (await api.post("/api/v1/sites", { name: "London", code: "LD", timezone: "Europe/London" }, { token: a.token })).body.data.site;
    camT = (await api.post(`/api/v1/sites/${tokyo.id}/cameras`, { name: "T1", protocol: "RTSP", host: "192.0.2.1" }, { token: a.token })).body.data.camera;
    camL = (await api.post(`/api/v1/sites/${london.id}/cameras`, { name: "L1", protocol: "RTSP", host: "192.0.2.2" }, { token: a.token })).body.data.camera;
    manager = await addMember(a, "WAREHOUSE_MANAGER", [tokyo.id]);
    operator = await addMember(a, "SECURITY_OPERATOR", [tokyo.id]);
    auditor = await addMember(a, "AUDITOR", [tokyo.id]);

    // 2026-03-10 20:00Z is 05:00 on 11 March in Tokyo and 20:00 on 10 March in London
    await ingest(tokyo.id, camT.id, "restricted_zone_movement", "2026-03-10T20:00:00Z");
    // 2026-03-10 05:00Z is 14:00 in Tokyo (10 March) and 05:00 in London
    await ingest(tokyo.id, camT.id, "count_mismatch", "2026-03-10T05:00:00Z");
    await ingest(london.id, camL.id, "restricted_zone_movement", "2026-03-10T20:00:00Z");
    await ingest(tokyo.id, camT.id, "camera_offline", "2026-03-10T06:00:00Z");
  });

  after(async () => {
    await server.close();
  });

  const RANGE = "from=2026-03-09T00:00:00Z&to=2026-03-12T00:00:00Z";
  const activity = (qs = "", token = a.token) => api.get(`/api/v1/reports/cargo-activity?${RANGE}${qs}`, { token });

  describe("cargo activity", () => {
    it("buckets days in each site's own time zone (QA-11)", async () => {
      const res = await activity(`&siteId=${tokyo.id}`);
      assert.equal(res.status, 200, res.raw);
      const days = Object.fromEntries(res.body.data.days.map((d: any) => [d.date, d.events]));
      // Tokyo: 05:00Z and 06:00Z are on 10 March (14:00, 15:00); 20:00Z is already 11 March
      assert.deepEqual(days, { "2026-03-10": 2, "2026-03-11": 1 });
      const lon = await activity(`&siteId=${london.id}`);
      assert.deepEqual(Object.fromEntries(lon.body.data.days.map((d: any) => [d.date, d.events])), { "2026-03-10": 1 });
    });

    it("totals by type and severity across all sites", async () => {
      const res = await activity();
      assert.equal(res.body.data.totals.events, 4);
      assert.equal(res.body.data.totals.byType.restricted_zone_movement, 2);
      assert.equal(res.body.data.bySite.length, 2);
    });

    it("marks coverage gaps even when an event-type filter would hide the outage (QA-06)", async () => {
      const res = await activity(`&siteId=${tokyo.id}&eventType=restricted_zone_movement`);
      assert.equal(res.body.data.totals.events, 1);
      assert.equal(res.body.data.coverageGaps.length, 1);
      assert.equal(res.body.data.coverageGaps[0].eventType, "camera_offline");
      assert.equal(res.body.data.coverageGaps[0].timezone, "Asia/Tokyo");
      const flagged = res.body.data.days.filter((d: any) => d.coverageGap).map((d: any) => d.date);
      assert.deepEqual(flagged, ["2026-03-10"]);
      assert.equal((await activity(`&siteId=${london.id}`)).body.data.coverageGaps.length, 0);
    });

    it("filters by shift using the site's local time", async () => {
      await api.patch(
        "/api/v1/company/settings",
        { shifts: [{ name: "Day", start: "08:00", end: "18:00" }, { name: "Night", start: "18:00", end: "08:00" }] },
        { token: a.token }
      );
      // Tokyo local times: 14:00 (Day), 15:00 (Day, health), 05:00 (Night)
      const day = await activity(`&siteId=${tokyo.id}&shift=Day`);
      assert.equal(day.body.data.totals.events, 2);
      const night = await activity(`&siteId=${tokyo.id}&shift=night`);
      assert.equal(night.body.data.totals.events, 1);
      assert.equal(night.body.data.totals.byType.restricted_zone_movement, 1);
      assert.equal((await activity(`&shift=Nope`)).status, 400);
    });

    it("validates its inputs", async () => {
      assert.equal((await activity("&siteId=zzz")).status, 400);
      assert.equal((await activity("&eventType=bogus")).status, 400);
      assert.equal((await api.get("/api/v1/reports/cargo-activity?from=2026-03-10&to=2026-03-01", { token: a.token })).status, 400);
      assert.equal((await api.get("/api/v1/reports/cargo-activity?from=2025-01-01&to=2026-03-01", { token: a.token })).status, 400, "range over 92 days");
    });
  });

  describe("access rules", () => {
    it("a member only sees the sites they are assigned to; others look like 404", async () => {
      const res = await activity("", manager.token);
      assert.equal(res.body.data.totals.events, 3, "Tokyo only");
      assert.ok(res.body.data.bySite.every((s: any) => s.siteId === tokyo.id));
      assert.equal((await activity(`&siteId=${london.id}`, manager.token)).status, 404);
    });

    it("another company sees nothing and cannot name our site", async () => {
      assert.equal((await activity("", b.token)).body.data.totals.events, 0);
      assert.equal((await activity(`&siteId=${tokyo.id}`, b.token)).status, 404);
    });

    it("operators can read reports but cannot export; managers, owners and auditors can", async () => {
      const exp = (token: string) => api.get(`/api/v1/reports/events/export?${RANGE}`, { token });
      assert.equal((await activity("", operator.token)).status, 200);
      assert.equal((await exp(operator.token)).status, 403);
      for (const who of [a, manager, auditor]) assert.equal((await exp(who.token)).status, 200);
    });
  });

  describe("mismatch report", () => {
    it("lists closed sessions that need review, with the event status", async () => {
      const { setObservedCountProvider } = await import("../services/counts/observed");
      setObservedCountProvider(async () => ({ inCount: 0, outCount: 94 }));
      try {
        const m = (await api.post("/api/v1/manifests", { reference: "RPT-1", siteId: tokyo.id, expectedPackageCount: 100 }, { token: a.token })).body.data.manifest;
        const s = (await api.post("/api/v1/loading-sessions", { siteId: tokyo.id, manifestId: m.id, direction: "outbound" }, { token: a.token })).body.data.session;
        const closed = await api.post(`/api/v1/loading-sessions/${s.id}/close`, {}, { token: a.token });
        assert.equal(closed.body.data.session.reconciliationStatus, "review_required");

        const now = new Date();
        const q = `from=${new Date(now.getTime() - 3600_000).toISOString()}&to=${new Date(now.getTime() + 3600_000).toISOString()}`;
        const res = await api.get(`/api/v1/reports/mismatches?${q}`, { token: a.token });
        assert.equal(res.status, 200, res.raw);
        assert.equal(res.body.data.items.length, 1);
        const item = res.body.data.items[0];
        assert.equal(item.difference, -6);
        assert.equal(item.eventStatus, "open");
        assert.equal(item.timezone, "Asia/Tokyo");
        assert.ok(item.closedAtLocal);
        // a different company sees none of it
        assert.equal((await api.get(`/api/v1/reports/mismatches?${q}`, { token: b.token })).body.data.items.length, 0);
      } finally {
        setObservedCountProvider(null);
      }
    });
  });

  describe("csv export", () => {
    it("exports with local times, defuses formulas, and is audited", async () => {
      await ingest(tokyo.id, camT.id, "restricted_zone_movement", "2026-03-10T10:00:00Z", { summary: "=HYPERLINK(\"http://evil\")" });
      const res = await fetch(`${server.baseUrl}/api/v1/reports/events/export?${RANGE}&siteId=${tokyo.id}`, {
        headers: { Authorization: `Bearer ${a.token}` },
      });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/csv/);
      assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="events-2026-03-09-to-2026-03-12.csv"/);
      const text = await res.text();
      const lines = text.replace("\uFEFF", "").trim().split("\r\n");
      assert.match(lines[0], /^Event ID,Occurred at \(UTC\),Occurred at \(site local time\)/);
      assert.equal(lines.length, 1 + 4, "3 Tokyo events plus the new one");
      assert.ok(text.includes("2026-03-10 14:00"), "Tokyo local time of the 05:00Z event");
      assert.ok(!/,=HYPERLINK/.test(text) && text.includes("'=HYPERLINK"), "formula is defused");
      assert.ok(!text.includes("London"), "only the requested site");

      const mongoose = (await import("mongoose")).default;
      const log = await mongoose.connection.collection("auditlogs").findOne({ action: "EVENTS_EXPORTED", actorUserId: new mongoose.Types.ObjectId(a.userId) });
      assert.ok(log);
      assert.equal(log!.metadata.rows, 4);
    });

    it("a member's export contains only their sites", async () => {
      const res = await fetch(`${server.baseUrl}/api/v1/reports/events/export?${RANGE}`, { headers: { Authorization: `Bearer ${manager.token}` } });
      const text = await res.text();
      assert.ok(text.includes("Tokyo") && !text.includes("London"));
    });
  });

  describe("audit trail", () => {
    it("owners, admins and auditors can read it; managers and operators cannot", async () => {
      assert.equal((await api.get("/api/v1/audit-logs", { token: a.token })).status, 200);
      assert.equal((await api.get("/api/v1/audit-logs", { token: auditor.token })).status, 200);
      assert.equal((await api.get("/api/v1/audit-logs", { token: manager.token })).status, 403);
      assert.equal((await api.get("/api/v1/audit-logs", { token: operator.token })).status, 403);
    });

    it("shows who did what, newest first, only for this company", async () => {
      const res = await api.get("/api/v1/audit-logs?limit=100", { token: a.token });
      const actions = res.body.data.items.map((i: any) => i.action);
      assert.ok(actions.includes("SITE_CREATED"));
      assert.ok(actions.includes("EVENTS_EXPORTED"));
      assert.ok(actions.includes("COMPANY_SETTINGS_UPDATED"));
      const times = res.body.data.items.map((i: any) => i.createdAt);
      assert.deepEqual(times, [...times].sort().reverse());
      assert.ok(res.body.data.items.every((i: any) => i.actor.name && i.requestId !== undefined));
      // company B's trail has none of A's entries
      const theirs = await api.get("/api/v1/audit-logs?limit=100", { token: b.token });
      assert.ok(!theirs.body.data.items.some((i: any) => i.action === "EVENTS_EXPORTED"));
    });

    it("filters, pages, and rejects odd input", async () => {
      const only = await api.get("/api/v1/audit-logs?action=SITE_CREATED", { token: a.token });
      assert.ok(only.body.data.items.length >= 2 && only.body.data.items.every((i: any) => i.action === "SITE_CREATED"));
      const p1 = await api.get("/api/v1/audit-logs?limit=2", { token: a.token });
      assert.ok(p1.body.data.nextCursor);
      const p2 = await api.get(`/api/v1/audit-logs?limit=2&cursor=${p1.body.data.nextCursor}`, { token: a.token });
      const ids = [...p1.body.data.items, ...p2.body.data.items].map((i: any) => i.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.equal((await api.get("/api/v1/audit-logs?action=.*", { token: a.token })).status, 400);
      assert.equal((await api.get("/api/v1/audit-logs?actorUserId=x", { token: a.token })).status, 400);
      assert.equal((await api.get("/api/v1/audit-logs?from=notadate", { token: a.token })).status, 400);
    });

    it("role changes appear in the trail", async () => {
      const ch = await api.patch(`/api/v1/users/${operator.userId}/role`, { role: "SECURITY_OPERATOR", siteIds: [tokyo.id] }, { token: a.token });
      assert.ok(ch.status < 300, ch.raw);
      const res = await api.get("/api/v1/audit-logs?limit=100", { token: a.token });
      assert.ok(res.body.data.items.some((i: any) => /ROLE|MEMBER/.test(i.action)));
    });
  });

  describe("superadmin: suspension and support access", () => {
    let admin: Actor;

    before(async () => {
      admin = await register("Platform");
      const mongoose = (await import("mongoose")).default;
      await mongoose.connection.collection("users").updateOne({ _id: new mongoose.Types.ObjectId(admin.userId) }, { $set: { role: "PLATFORM_ADMIN" } });
    });

    it("suspending a company needs a reason, blocks its members, is audited, and can be undone", async () => {
      const victim = await register("Suspend Me");
      const noReason = await api.patch(`/api/v1/admin/companies/${victim.companyId}/status`, { status: "SUSPENDED" }, { token: admin.token });
      assert.equal(noReason.status, 400);
      const ok = await api.patch(`/api/v1/admin/companies/${victim.companyId}/status`, { status: "SUSPENDED", reason: "Unpaid invoice" }, { token: admin.token });
      assert.equal(ok.status, 200, ok.raw);
      assert.equal((await api.get("/api/v1/sites", { token: victim.token })).body.error.code, "COMPANY_SUSPENDED");
      assert.equal((await api.patch(`/api/v1/admin/companies/${victim.companyId}/status`, { status: "ACTIVE", reason: "Invoice paid" }, { token: admin.token })).status, 200);
      assert.equal((await api.get("/api/v1/sites", { token: victim.token })).status, 200);

      const mongoose = (await import("mongoose")).default;
      const logs = await mongoose.connection.collection("auditlogs").find({ targetId: victim.companyId, action: { $in: ["COMPANY_SUSPENDED", "COMPANY_ACTIVATED"] } }).toArray();
      assert.equal(logs.length, 2);
      assert.ok(logs.every((l) => l.reason));
    });

    it("support access to evidence needs a reason, issues a short link, and shows in the company's audit trail", async () => {
      const upload = await uploadFile(server.baseUrl, "/internal/v1/evidence/upload", { siteId: tokyo.id, cameraId: camT.id }, { bytes: JPEG, type: "image/jpeg", name: "s" }, SERVICE());
      const key = upload.body.data.objectKey;
      const ev = await ingest(tokyo.id, camT.id, "restricted_zone_movement", "2026-03-10T12:00:00Z", { evidence: { snapshotObjectKey: key } });
      const eventId = ev.body.data.eventId;

      const path = "/api/v1/admin/support/evidence-link";
      assert.equal((await api.post(path, { eventId, kind: "snapshot", reason: "short" }, { token: admin.token })).status, 400);
      assert.equal((await api.post(path, { eventId, kind: "snapshot", reason: "Customer ticket 4411" }, { token: a.token })).status, 403, "a company owner is not support");
      assert.equal((await api.post(path, { eventId, kind: "clip", reason: "Customer ticket 4411" }, { token: admin.token })).status, 404, "no clip recorded");

      const ok = await api.post(path, { eventId, kind: "snapshot", reason: "Customer ticket 4411" }, { token: admin.token });
      assert.equal(ok.status, 200, ok.raw);
      const file = await fetch(server.baseUrl + ok.body.data.url);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get("content-type"), "image/jpeg");

      const trail = await api.get("/api/v1/audit-logs?action=SUPPORT_EVIDENCE_ACCESS_GRANTED", { token: a.token });
      assert.equal(trail.body.data.items.length, 1);
      assert.equal(trail.body.data.items[0].reason, "Customer ticket 4411");
      assert.equal(trail.body.data.items[0].actor.id, admin.userId);
      // another company cannot see it
      assert.equal((await api.get("/api/v1/audit-logs?action=SUPPORT_EVIDENCE_ACCESS_GRANTED", { token: b.token })).body.data.items.length, 0);
    });
  });
});
