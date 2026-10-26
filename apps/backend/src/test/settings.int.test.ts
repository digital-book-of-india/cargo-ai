import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer, uploadFile } from "./harness";

// Company settings: access, validation, audit, their effect on notifications and retention,
// and honest camera status. Runs on a throw-away database (see harness.ts).

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
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 3)]);

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

describe("company settings and honest camera status (integration)", () => {
  let a: Actor;
  let b: Actor;
  let admin: Actor;
  let manager: Actor;
  let operator: Actor;
  let site: { id: string };
  let cam: { id: string };
  let bSite: { id: string };
  let bCam: { id: string };

  const settings = (actor: Actor) => api.get("/api/v1/company/settings", { token: actor.token });
  const patch = (actor: Actor, body: unknown) => api.patch("/api/v1/company/settings", body, { token: actor.token });
  const ingest = (siteId: string, cameraId: string, eventType: string, extra: Record<string, unknown> = {}) =>
    api.post(
      "/api/v1/ai/events",
      { eventKey: unique("evt"), siteId, cameraId, eventType, occurredAt: new Date().toISOString(), ...extra },
      { headers: SERVICE() }
    );
  const notificationsFor = async (actor: Actor, eventId: string) =>
    (await api.get("/api/v1/notifications", { token: actor.token })).body.data.items.filter((n: any) => n.eventId === eventId).length;

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    a = await register("Settings A");
    b = await register("Settings B");
    site = (await api.post("/api/v1/sites", { name: "A Site", code: "A1" }, { token: a.token })).body.data.site;
    bSite = (await api.post("/api/v1/sites", { name: "B Site", code: "B1" }, { token: b.token })).body.data.site;
    cam = (await api.post(`/api/v1/sites/${site.id}/cameras`, { name: "Cam", protocol: "RTSP", host: "192.0.2.10" }, { token: a.token })).body.data.camera;
    bCam = (await api.post(`/api/v1/sites/${bSite.id}/cameras`, { name: "Cam", protocol: "RTSP", host: "192.0.2.11" }, { token: b.token })).body.data.camera;
    admin = await addMember(a, "COMPANY_ADMIN", []);
    manager = await addMember(a, "WAREHOUSE_MANAGER", [site.id]);
    operator = await addMember(a, "SECURITY_OPERATOR", [site.id]);
  });

  after(async () => {
    await server.close();
  });

  describe("reading and changing settings", () => {
    it("a company that never changed anything gets the platform defaults", async () => {
      const res = await settings(a);
      assert.equal(res.status, 200);
      const s = res.body.data.settings;
      assert.equal(s.mismatchTolerance, 0);
      assert.equal(s.retentionDays, 90);
      assert.equal(s.defaultConfidence, 0.55);
      assert.deepEqual(s.shifts, []);
      assert.deepEqual(s.notificationRules, { inAppMinSeverity: "low", mutedEventTypes: [] });
    });

    it("every member can read the settings, but only owners and admins can change them", async () => {
      for (const actor of [a, admin, manager, operator]) assert.equal((await settings(actor)).status, 200);
      for (const actor of [manager, operator]) {
        assert.equal((await patch(actor, { mismatchTolerance: 5 })).status, 403);
      }
      assert.equal((await patch(admin, { mismatchTolerance: 2 })).status, 200);
    });

    it("changes one field without touching the others, and writes an audit entry with before and after", async () => {
      const res = await patch(a, { mismatchTolerance: 3, defaultConfidence: 0.7 });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.data.settings.mismatchTolerance, 3);
      assert.equal(res.body.data.settings.defaultConfidence, 0.7);
      assert.equal(res.body.data.settings.retentionDays, 90, "untouched fields keep their value");

      const mongoose = (await import("mongoose")).default;
      const log = await mongoose.connection
        .collection("auditlogs")
        .findOne({ action: "COMPANY_SETTINGS_UPDATED", actorUserId: new mongoose.Types.ObjectId(a.userId) });
      assert.ok(log);
      assert.equal(String(log!.companyId), a.companyId);
      assert.deepEqual((log!.metadata as any).changed.mismatchTolerance, { from: 2, to: 3 });
    });

    it("rejects invalid values and unknown fields", async () => {
      for (const body of [
        {},
        { mismatchTolerance: -1 },
        { mismatchTolerance: 1.5 },
        { retentionDays: 3 },
        { retentionDays: 99999 },
        { defaultConfidence: 2 },
        { surprise: true },
        { shifts: [{ name: "X", start: "8am", end: "14:00" }] },
        { notificationRules: { inAppMinSeverity: "urgent", mutedEventTypes: [] } },
      ]) {
        assert.equal((await patch(a, body)).status, 400, JSON.stringify(body));
      }
    });

    it("accepts three shifts including one that crosses midnight and refuses overlapping ones (QA-11)", async () => {
      const ok = await patch(a, {
        shifts: [
          { name: "Morning", start: "06:00", end: "14:00" },
          { name: "Evening", start: "14:00", end: "22:00" },
          { name: "Night", start: "22:00", end: "06:00" },
        ],
      });
      assert.equal(ok.status, 200, ok.raw);
      assert.equal(ok.body.data.settings.shifts.length, 3);

      const overlap = await patch(a, {
        shifts: [
          { name: "Night", start: "22:00", end: "06:00" },
          { name: "Dawn", start: "05:00", end: "08:00" },
        ],
      });
      assert.equal(overlap.status, 400);
      assert.match(overlap.body.error.message, /overlap/);
      const dup = await patch(a, { shifts: [{ name: "A", start: "01:00", end: "02:00" }, { name: "a", start: "03:00", end: "04:00" }] });
      assert.equal(dup.status, 400);
    });

    it("health notices cannot be muted", async () => {
      const res = await patch(a, { notificationRules: { inAppMinSeverity: "low", mutedEventTypes: ["camera_offline"] } });
      assert.equal(res.status, 400);
      assert.match(res.body.error.message, /cannot be muted/);
    });

    it("settings of one company never leak into another", async () => {
      const mine = (await settings(a)).body.data.settings;
      const theirs = (await settings(b)).body.data.settings;
      assert.equal(mine.mismatchTolerance, 3);
      assert.equal(theirs.mismatchTolerance, 0);
      assert.deepEqual(theirs.shifts, []);
    });
  });

  describe("notification rules take effect", () => {
    it("a minimum severity and muted types decide who is told; health notices always get through", async () => {
      assert.equal((await patch(a, { notificationRules: { inAppMinSeverity: "high", mutedEventTypes: ["zone_entry"] } })).status, 200);

      const low = (await ingest(site.id, cam.id, "package_line_crossing")).body.data.eventId; // severity low
      const high = (await ingest(site.id, cam.id, "restricted_zone_movement")).body.data.eventId; // severity high
      const muted = (await ingest(site.id, cam.id, "zone_entry", { severity: "critical" })).body.data.eventId;
      const health = (await ingest(site.id, cam.id, "camera_offline")).body.data.eventId; // severity medium

      assert.equal(await notificationsFor(a, low), 0, "below the minimum severity");
      assert.equal(await notificationsFor(a, high), 1);
      assert.equal(await notificationsFor(operator, high), 1);
      assert.equal(await notificationsFor(a, muted), 0, "muted type");
      assert.equal(await notificationsFor(a, health), 1, "health notices ignore the minimum severity");

      // the events themselves are still recorded and reviewable
      assert.equal((await api.get(`/api/v1/events/${low}`, { token: a.token })).status, 200);
      assert.equal((await patch(a, { notificationRules: { inAppMinSeverity: "low", mutedEventTypes: [] } })).status, 200);
    });
  });

  describe("per-company retention", () => {
    it("uses the company's own retention days, and the platform default for everyone else", async () => {
      const { runEvidenceRetention } = await import("../services/events/retention");
      const { getEvidenceStorage } = await import("../services/evidence/storage");
      const upload = async (siteId: string, cameraId: string) =>
        (
          await uploadFile(server.baseUrl, "/internal/v1/evidence/upload", { siteId, cameraId }, { bytes: JPEG, type: "image/jpeg", name: "s" }, SERVICE())
        ).body.data.objectKey as string;

      assert.equal((await patch(a, { retentionDays: 30 })).status, 200);

      const fortyDaysAgo = new Date(Date.now() - 40 * 86400_000).toISOString();
      const keyA = await upload(site.id, cam.id);
      const keyB = await upload(bSite.id, bCam.id);
      await ingest(site.id, cam.id, "restricted_zone_movement", { occurredAt: fortyDaysAgo, evidence: { snapshotObjectKey: keyA } });
      await ingest(bSite.id, bCam.id, "restricted_zone_movement", { occurredAt: fortyDaysAgo, evidence: { snapshotObjectKey: keyB } });

      const result = await runEvidenceRetention(new Date(), 90);
      assert.equal(result.eventsPurged, 1);
      assert.equal(await getEvidenceStorage().exists(keyA), false, "company A keeps evidence for 30 days: 40-day-old evidence is deleted");
      assert.equal(await getEvidenceStorage().exists(keyB), true, "company B uses the 90-day default: it is kept");
    });
  });

  describe("honest camera status", () => {
    const camerasOf = async (actor: Actor) => (await api.get("/api/v1/cameras", { token: actor.token })).body.data.items as any[];

    it("a camera that was never tested is not online", async () => {
      const found = (await camerasOf(a)).find((c) => c.id === cam.id);
      assert.equal(found.status, "PENDING_TEST");
      assert.equal(found.effectiveStatus, "PENDING_TEST");
    });

    it("a fresh online camera is online; a stale one is not", async () => {
      const mongoose = (await import("mongoose")).default;
      const id = new mongoose.Types.ObjectId(cam.id);
      await mongoose.connection.collection("cameras").updateOne({ _id: id }, { $set: { status: "ONLINE", lastHealthAt: new Date(), lastFrameAt: new Date() } });
      let found = (await camerasOf(a)).find((c) => c.id === cam.id);
      assert.equal(found.effectiveStatus, "ONLINE");
      assert.equal(found.isStale, false);

      const old = new Date(Date.now() - 10 * 60_000);
      await mongoose.connection.collection("cameras").updateOne({ _id: id }, { $set: { lastHealthAt: old, lastFrameAt: old } });
      found = (await camerasOf(a)).find((c) => c.id === cam.id);
      assert.equal(found.status, "ONLINE", "the raw status is what was last reported");
      assert.notEqual(found.effectiveStatus, "ONLINE", "but it is no longer shown as online");
      assert.equal(found.isStale, true);
    });
  });
});
