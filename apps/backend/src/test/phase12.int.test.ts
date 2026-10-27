import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer } from "./harness";

// Phase 12: tenant references, small data bugs, retention, camera lifecycle, indexes.

let server: TestServer;
let api: ReturnType<typeof createClient>;

const PASSWORD = "Test@12345";
let counter = 0;
const unique = (p: string) => `${p}${Date.now()}${counter++}`;
const SERVICE = () => ({ "x-service-token": process.env.AI_SERVICE_TOKEN ?? "dbi-dev-ai-service-token-change-me-0123456789" });
const HOUR = 3600_000;
const DAY = 24 * HOUR;

interface Actor {
  token: string;
  userId: string;
  companyId: string;
}

async function register(name: string): Promise<Actor> {
  const res = await api.post("/api/v1/auth/register", {
    name: `${name} owner`,
    email: `${unique("o")}@example.test`,
    password: PASSWORD,
    companyName: name,
  });
  assert.equal(res.status, 201, res.raw);
  return { token: res.body.data.token, userId: res.body.data.user.id, companyId: res.body.data.memberships[0].companyId };
}

describe("phase 12: data safety and tenancy (integration)", () => {
  let a: Actor;
  let b: Actor;
  let siteA: string;
  let siteA2: string;
  let siteB: string;
  let cameraA: string;
  let cameraB: string;

  const newCamera = async (actor: Actor, siteId: string, name: string, host: string) => {
    const res = await api.post(`/api/v1/sites/${siteId}/cameras`, { name, protocol: "RTSP", host }, { token: actor.token });
    assert.equal(res.status, 201, res.raw);
    return res.body.data.camera.id as string;
  };
  const eventBody = (extra: Record<string, unknown> = {}) => ({
    eventKey: unique("evt"),
    siteId: siteA,
    cameraId: cameraA,
    eventType: "camera_offline",
    occurredAt: new Date().toISOString(),
    ...extra,
  });
  const postEvent = (extra: Record<string, unknown> = {}) =>
    api.post("/internal/v1/ai/cargo-events", eventBody(extra), { headers: SERVICE() });
  const lineBody = (sId: string, cId: string, name: string) => ({
    siteId: sId,
    cameraId: cId,
    name,
    zoneType: "counting_line",
    geometry: { coordinateSpace: "normalized_0_1", line: [[0.2, 0.5], [0.8, 0.5]] },
    rules: { objectClasses: ["box"], minimumConfidence: 0.5, countDirection: "EITHER", countOncePerTrackPerRule: true },
  });
  const activeLine = async (actor: Actor, sId: string, cId: string, name: string) => {
    const created = await api.post("/api/v1/zones", lineBody(sId, cId, name), { token: actor.token });
    assert.equal(created.status, 201, created.raw);
    const id = created.body.data.zone.id as string;
    await api.post(`/api/v1/zones/${id}/validate`, {}, { token: actor.token });
    assert.equal((await api.post(`/api/v1/zones/${id}/enable`, {}, { token: actor.token })).status, 200);
    return id;
  };

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    a = await register("P12 A");
    b = await register("P12 B");
    siteA = (await api.post("/api/v1/sites", { name: "A1", code: "A1" }, { token: a.token })).body.data.site.id;
    siteA2 = (await api.post("/api/v1/sites", { name: "A2", code: "A2" }, { token: a.token })).body.data.site.id;
    siteB = (await api.post("/api/v1/sites", { name: "B1", code: "B1" }, { token: b.token })).body.data.site.id;
    cameraA = await newCamera(a, siteA, "Cam A", "192.0.2.31");
    cameraB = await newCamera(b, siteB, "Cam B", "192.0.2.32");
  });

  after(async () => {
    const { setObservedCountProvider } = await import("../services/counts/observed");
    setObservedCountProvider(null);
    await server.close();
  });

  describe("12.3 references to another company's records are refused", () => {
    it("every write that takes a foreign id refuses ids of another company", async () => {
      // records that belong to company B
      const manifestB = (await api.post("/api/v1/manifests", { reference: "B-MAN", siteId: siteB, expectedPackageCount: 5 }, { token: b.token })).body.data.manifest.id;
      const vehicleB = (await api.post("/api/v1/vehicles", { registrationNumber: "MH01 B 0001" }, { token: b.token })).body.data.vehicle.id;
      const sessionB = (await api.post("/api/v1/loading-sessions", { siteId: siteB, direction: "outbound" }, { token: b.token })).body.data.session.id;
      const zoneB = (await api.post("/api/v1/zones", lineBody(siteB, cameraB, "B draft line"), { token: b.token })).body.data.zone.id;
      assert.ok(manifestB && vehicleB && sessionB && zoneB);

      const refused = [400, 403, 404, 422];
      const cases: Array<[string, () => Promise<{ status: number; raw: string }>]> = [
        ["event with a camera of another company", () => postEvent({ cameraId: cameraB })],
        ["event with a zone of another company", () => postEvent({ zoneId: zoneB })],
        ["event with a loading session of another company", () => postEvent({ loadingSessionId: sessionB })],
        ["event on a site of another company", () => postEvent({ siteId: siteB })],
        ["session with a manifest of another company", () => api.post("/api/v1/loading-sessions", { siteId: siteA, manifestId: manifestB, direction: "outbound" }, { token: a.token })],
        ["session with a vehicle of another company", () => api.post("/api/v1/loading-sessions", { siteId: siteA, vehicleId: vehicleB, direction: "outbound" }, { token: a.token })],
        ["session with a zone of another company", () => api.post("/api/v1/loading-sessions", { siteId: siteA, zoneId: zoneB, direction: "outbound" }, { token: a.token })],
        ["session on a site of another company", () => api.post("/api/v1/loading-sessions", { siteId: siteB, direction: "outbound" }, { token: a.token })],
        ["manifest on a site of another company", () => api.post("/api/v1/manifests", { reference: "X-MAN", siteId: siteB, expectedPackageCount: 1 }, { token: a.token })],
        ["camera moved to a site of another company", () => api.post(`/api/v1/cameras/${cameraA}/assign-site`, { siteId: siteB }, { token: a.token })],
        ["invitation with a site of another company", () => api.post("/api/v1/users/invitations", { email: `${unique("i")}@example.test`, role: "SECURITY_OPERATOR", siteIds: [siteB] }, { token: a.token })],
        ["zone on a camera of another company", () => api.post("/api/v1/zones", lineBody(siteA, cameraB, "stolen"), { token: a.token })],
      ];
      for (const [label, run] of cases) {
        const res = await run();
        assert.ok(refused.includes(res.status), `${label}: expected a refusal, got ${res.status} ${res.raw}`);
      }

    });

    it("an event cannot be linked to a loading session of another company or site (internal path)", async () => {
      // the ingestion route never accepts a session id; the session close does, through createCargoEvent
      const { createCargoEvent } = await import("../services/events/createEvent");
      const sessionB = (await api.post("/api/v1/loading-sessions", { siteId: siteB, direction: "inbound" }, { token: b.token })).body.data.session.id as string;
      const sessionOtherSite = (await api.post("/api/v1/loading-sessions", { siteId: siteA2, direction: "inbound" }, { token: a.token })).body.data.session.id as string;
      const ownSession = (await api.post("/api/v1/loading-sessions", { siteId: siteA, direction: "inbound" }, { token: a.token })).body.data.session.id as string;
      const base = { siteId: siteA, cameraId: cameraA, eventType: "camera_offline" as const, occurredAt: new Date() };

      await assert.rejects(() => createCargoEvent({ ...base, eventKey: unique("x"), loadingSessionId: sessionB }), /loadingSessionId/);
      await assert.rejects(() => createCargoEvent({ ...base, eventKey: unique("x"), loadingSessionId: sessionOtherSite }), /loadingSessionId/);
      await assert.rejects(() => createCargoEvent({ ...base, eventKey: unique("x"), loadingSessionId: "a".repeat(24) }), /loadingSessionId/);
      const ok = await createCargoEvent({ ...base, eventKey: unique("x"), loadingSessionId: ownSession });
      assert.equal(ok.created, true);
      assert.equal(String(ok.event.loadingSessionId), ownSession);
    });

    it("an event cannot be assigned to a person of another company", async () => {
      const created = await postEvent();
      assert.equal(created.status, 202, created.raw);
      const res = await api.post(`/api/v1/events/${created.body.data.eventId}/assign`, { userId: b.userId }, { token: a.token });
      assert.ok([400, 403, 404, 422].includes(res.status), `got ${res.status} ${res.raw}`);
    });
  });

  describe("12.5 small data bugs", () => {
    it("a false-positive event can be reopened (with a reason)", async () => {
      const created = await postEvent({ eventType: "restricted_zone_movement" });
      const id = created.body.data.eventId as string;
      const fp = await api.post(`/api/v1/events/${id}/false-positive`, { reason: "A forklift, not a package" }, { token: a.token });
      assert.equal(fp.status, 200, fp.raw);
      const reopened = await api.post(`/api/v1/events/${id}/reopen`, { note: "Looked again: it needs a check" }, { token: a.token });
      assert.equal(reopened.status, 200, reopened.raw);
      assert.equal(reopened.body.data.event.status, "open");
      const history = reopened.body.data.event.history.map((h: any) => h.action);
      assert.ok(history.includes("REOPENED"));
    });

    it("a failed history write does not leave a moved event behind", async () => {
      const created = await postEvent();
      const id = created.body.data.eventId as string;
      const { EventHistoryModel, CargoEventModel } = await import("../models");
      const original = EventHistoryModel.create.bind(EventHistoryModel);
      (EventHistoryModel as any).create = async () => {
        throw new Error("history store is down");
      };
      try {
        const res = await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: a.token });
        assert.equal(res.status, 500, res.raw);
      } finally {
        (EventHistoryModel as any).create = original;
      }
      assert.equal((await CargoEventModel.findById(id))!.status, "open", "the status was put back");
      assert.equal((await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: a.token })).status, 200, "and the action works again afterwards");
    });

    it("a tampered cursor answers 400, not 500", async () => {
      const badId = Buffer.from("2026-01-01T00:00:00.000Z|not-an-object-id", "utf8").toString("base64url");
      for (const path of ["/api/v1/events", "/api/v1/audit-logs", "/api/v1/loading-sessions", "/api/v1/manifests"]) {
        for (const cursor of ["garbage", badId]) {
          const res = await api.get(`${path}?cursor=${cursor}`, { token: a.token });
          assert.equal(res.status, 400, `${path} with cursor ${cursor}: ${res.status} ${res.raw}`);
        }
      }
    });

    it("a CSV import that failed can be sent again once the cause is fixed", async () => {
      const csv = "reference,siteCode,expectedPackageCount\nRETRY-1,LATE,5\n";
      const first = await api.post("/api/v1/manifests/import", { fileName: "m.csv", content: csv }, { token: a.token });
      assert.equal(first.body.data.job.status, "FAILED", first.raw);
      // the missing site is created, then the very same file is sent again
      assert.equal((await api.post("/api/v1/sites", { name: "Late site", code: "LATE" }, { token: a.token })).status, 201);
      const again = await api.post("/api/v1/manifests/import", { fileName: "m.csv", content: csv }, { token: a.token });
      assert.equal(again.body.data.job.status, "COMPLETED", again.raw);
      assert.equal(again.body.data.job.createdCount, 1);
      assert.notEqual(again.body.data.job.duplicate, true);
      // and a completed file is still remembered
      const third = await api.post("/api/v1/manifests/import", { fileName: "m.csv", content: csv }, { token: a.token });
      assert.equal(third.body.data.job.duplicate, true);
    });

    it("a session cannot be backdated by days, and its times are audited", async () => {
      const tooOld = await api.post("/api/v1/loading-sessions", { siteId: siteA, direction: "outbound", startedAt: new Date(Date.now() - 3 * DAY).toISOString() }, { token: a.token });
      assert.equal(tooOld.status, 400, tooOld.raw);

      const startedAt = new Date(Date.now() - HOUR).toISOString();
      const started = await api.post("/api/v1/loading-sessions", { siteId: siteA2, direction: "outbound", startedAt }, { token: a.token });
      assert.equal(started.status, 201, started.raw);
      const sessionId = started.body.data.session.id as string;
      const { AuditLogModel } = await import("../models");
      const startAudit = await AuditLogModel.findOne({ action: "LOADING_SESSION_STARTED", targetId: sessionId }).lean();
      assert.equal((startAudit?.metadata as any)?.startedAt, startedAt, "the start time is in the audit trail");

      const closedAt = new Date(Date.now() - 30 * 60_000).toISOString();
      const closed = await api.post(`/api/v1/loading-sessions/${sessionId}/close`, { closedAt }, { token: a.token });
      assert.equal(closed.status, 200, closed.raw);
      const closeAudit = await AuditLogModel.findOne({ action: "LOADING_SESSION_CLOSED", targetId: sessionId }).lean();
      assert.equal((closeAudit?.metadata as any)?.closedAt, closedAt, "the close time is in the audit trail");
      assert.equal((closeAudit?.metadata as any)?.startedAt, startedAt);
    });

    it("a mismatch event that was not created at close time is created by the repair step, once", async () => {
      const { setObservedCountProvider } = await import("../services/counts/observed");
      setObservedCountProvider(async () => ({ inCount: 0, outCount: 3 }));
      const manifest = (await api.post("/api/v1/manifests", { reference: "REPAIR-1", siteId: siteA, expectedPackageCount: 10 }, { token: a.token })).body.data.manifest.id;
      const s = (await api.post("/api/v1/loading-sessions", { siteId: siteA, manifestId: manifest, direction: "outbound" }, { token: a.token })).body.data.session.id as string;
      const closed = await api.post(`/api/v1/loading-sessions/${s}/close`, {}, { token: a.token });
      assert.equal(closed.body.data.session.reconciliationStatus, "review_required", closed.raw);
      assert.ok(closed.body.data.mismatchEvent);
      setObservedCountProvider(null);

      // simulate the failure: the event was never stored
      const { CargoEventModel, LoadingSessionModel } = await import("../models");
      await CargoEventModel.deleteOne({ companyId: a.companyId, eventKey: `count-mismatch:${s}` });
      await LoadingSessionModel.updateOne({ _id: s }, { $set: { mismatchEventId: null } });

      const { repairMismatchEvents } = await import("../services/loading/mismatchEvent");
      const first = await repairMismatchEvents();
      assert.ok(first.created >= 1, "the missing event is created");
      const again = await repairMismatchEvents();
      assert.equal(again.created, 0, "a second run creates nothing");
      assert.equal(await CargoEventModel.countDocuments({ companyId: a.companyId, eventKey: `count-mismatch:${s}` }), 1);
      assert.ok((await LoadingSessionModel.findById(s))!.mismatchEventId, "the session points at its event again");
    });
  });

  describe("12.4 retention for notifications and audit logs", () => {
    it("deletes old delivered notifications and old audit entries, keeps the rest", async () => {
      const { NotificationModel, AuditLogModel } = await import("../models");
      const oid = () => new (require("mongoose").Types.ObjectId)();
      const now = Date.now();
      const company = oid();
      const user = oid();
      const notif = (days: number, status: string) => ({
        companyId: company, recipientUserId: user, channel: "IN_APP", status, title: "t", message: "m", severity: "low",
        eventId: String(oid()), attempts: 0, createdAt: new Date(now - days * DAY), updatedAt: new Date(now - days * DAY),
      });
      await NotificationModel.collection.insertMany([notif(200, "SENT"), notif(200, "FAILED"), notif(200, "PENDING"), notif(10, "SENT")]);
      const audit = (days: number) => ({ companyId: company, actorUserId: user, action: "TEST", targetType: "Test", targetId: "t", createdAt: new Date(now - days * DAY) });
      await AuditLogModel.collection.insertMany([audit(800), audit(30)]);

      const { runHousekeepingRetention } = await import("../services/events/retention");
      const result = await runHousekeepingRetention(new Date(now));
      assert.equal(result.notificationsDeleted >= 2, true, "the old sent and failed notifications go");
      assert.equal(await NotificationModel.countDocuments({ companyId: company, status: "PENDING" }), 1, "an undelivered notification is never deleted");
      assert.equal(await NotificationModel.countDocuments({ companyId: company }), 2, "pending (old) and the recent one remain");
      assert.equal(result.auditLogsDeleted >= 1, true);
      assert.equal(await AuditLogModel.countDocuments({ companyId: company }), 1, "only the recent audit entry remains");
    });
  });

  describe("12.6 moving or deleting a camera looks after its counting data", () => {
    it("moves the line and monitor with the camera, and refuses while a session is open", async () => {
      const cam = await newCamera(a, siteA, "Dock cam", "192.0.2.41");
      const line = await activeLine(a, siteA, cam, "Dock line");
      assert.equal((await api.post(`/api/v1/monitoring/cameras/${cam}/start`, {}, { token: a.token })).status, 200);

      const session = await api.post("/api/v1/loading-sessions", { siteId: siteA, zoneId: line, direction: "outbound" }, { token: a.token });
      assert.equal(session.status, 201, session.raw);
      const moveWhileOpen = await api.post(`/api/v1/cameras/${cam}/assign-site`, { siteId: siteA2 }, { token: a.token });
      assert.equal(moveWhileOpen.status, 409, moveWhileOpen.raw);
      assert.equal((await api.post(`/api/v1/loading-sessions/${session.body.data.session.id}/close`, {}, { token: a.token })).status, 200);

      const moved = await api.post(`/api/v1/cameras/${cam}/assign-site`, { siteId: siteA2 }, { token: a.token });
      assert.equal(moved.status, 200, moved.raw);
      const { VisionZoneModel, VisionCameraMonitorModel } = await import("../models");
      assert.equal(String((await VisionZoneModel.findById(line))!.siteId), siteA2, "the counting line follows the camera");
      assert.equal(String((await VisionCameraMonitorModel.findOne({ cameraId: cam }))!.siteId), siteA2, "so does the monitor");
    });

    it("deleting a camera is refused while a session is open, then archives its lines and stops monitoring", async () => {
      const cam = await newCamera(a, siteA, "Gate cam", "192.0.2.42");
      const line = await activeLine(a, siteA, cam, "Gate line");
      await api.post(`/api/v1/monitoring/cameras/${cam}/start`, {}, { token: a.token });
      const session = (await api.post("/api/v1/loading-sessions", { siteId: siteA, zoneId: line, direction: "inbound" }, { token: a.token })).body.data.session.id as string;

      const blocked = await api.delete(`/api/v1/cameras/${cam}`, { token: a.token });
      assert.equal(blocked.status, 409, blocked.raw);

      assert.equal((await api.post(`/api/v1/loading-sessions/${session}/close`, {}, { token: a.token })).status, 200);
      const deleted = await api.delete(`/api/v1/cameras/${cam}`, { token: a.token });
      assert.equal(deleted.status, 200, deleted.raw);
      const { VisionZoneModel, VisionCameraMonitorModel } = await import("../models");
      assert.equal((await VisionZoneModel.findById(line))!.status, "archived", "the line is archived, its counts stay");
      assert.equal((await VisionCameraMonitorModel.findOne({ cameraId: cam }))!.enabled, false, "monitoring is switched off");
    });
  });

  describe("12.7 notifications keep the event id as an id", () => {
    it("new notifications store an ObjectId, and the API still shows a string with the event", async () => {
      const created = await postEvent({ eventType: "restricted_zone_movement" });
      const eventId = created.body.data.eventId as string;
      const mongoose = (await import("mongoose")).default;
      const { NotificationModel } = await import("../models");
      const raw = await NotificationModel.collection.findOne({ eventId: new mongoose.Types.ObjectId(eventId) });
      assert.ok(raw, "the notification is stored with an ObjectId event id");

      const list = await api.get("/api/v1/notifications", { token: a.token });
      const item = list.body.data.items.find((n: any) => n.eventId === eventId);
      assert.ok(item, "the API returns the id as a string");
      assert.equal(item.event?.id, eventId, "and still joins the event details");
    });

    it("migration 20261101-103 converts stored string ids, leaves odd values alone, runs twice and goes back", async () => {
      const mongoose = (await import("mongoose")).default;
      const { notificationEventIdAsObjectId } = await import("../migrations/20261101-103-notification-event-id");
      const db = mongoose.connection.db!;
      const oid = () => new mongoose.Types.ObjectId();
      const eventA = oid();
      const base = { companyId: oid(), recipientUserId: oid(), channel: "IN_APP", status: "SENT", createdAt: new Date() };
      const good = await db.collection("notifications").insertOne({ ...base, eventId: String(eventA) });
      const odd = await db.collection("notifications").insertOne({ ...base, recipientUserId: oid(), eventId: "not-an-id" });
      const none = await db.collection("notifications").insertOne({ ...base, recipientUserId: oid() });
      const load = (id: unknown) => db.collection("notifications").findOne({ _id: id as never });

      await notificationEventIdAsObjectId.up(db);
      await notificationEventIdAsObjectId.up(db);
      const converted = (await load(good.insertedId))!;
      assert.equal(typeof converted.eventId, "object");
      assert.equal(String(converted.eventId), String(eventA));
      assert.equal((await load(odd.insertedId))!.eventId, "not-an-id", "a value that is not an id is left untouched");
      assert.equal((await load(none.insertedId))!.eventId, undefined);

      await notificationEventIdAsObjectId.down(db);
      assert.equal((await load(good.insertedId))!.eventId, String(eventA), "down turns it back into text");
    });
  });

  describe("12.8 a camera name is unique within a site", () => {
    it("refuses a second camera with the same name (any capitals), allows it at another site, refuses a rename or move onto a taken name", async () => {
      const first = await api.post(`/api/v1/sites/${siteA}/cameras`, { name: "Gate Cam", protocol: "RTSP", host: "192.0.2.51" }, { token: a.token });
      assert.equal(first.status, 201, first.raw);
      const same = await api.post(`/api/v1/sites/${siteA}/cameras`, { name: "Gate Cam", protocol: "RTSP", host: "192.0.2.52" }, { token: a.token });
      assert.equal(same.status, 409, same.raw);
      assert.match(same.body.error.message, /name/i);
      const capitals = await api.post(`/api/v1/sites/${siteA}/cameras`, { name: "  gate CAM ", protocol: "RTSP", host: "192.0.2.53" }, { token: a.token });
      assert.equal(capitals.status, 409, capitals.raw);

      const elsewhere = await api.post(`/api/v1/sites/${siteA2}/cameras`, { name: "Gate Cam", protocol: "RTSP", host: "192.0.2.54" }, { token: a.token });
      assert.equal(elsewhere.status, 201, "the same name at another site is fine");

      const other = await api.post(`/api/v1/sites/${siteA}/cameras`, { name: "Yard Cam", protocol: "RTSP", host: "192.0.2.55" }, { token: a.token });
      const otherId = other.body.data.camera.id as string;
      const rename = await api.patch(`/api/v1/cameras/${otherId}`, { name: "gate cam" }, { token: a.token });
      assert.equal(rename.status, 409, rename.raw);
      assert.equal((await api.patch(`/api/v1/cameras/${otherId}`, { name: "Yard Cam 2" }, { token: a.token })).status, 200);

      // moving the camera named "Gate Cam" of site A2 into site A would collide with the one already there
      const move = await api.post(`/api/v1/cameras/${elsewhere.body.data.camera.id}/assign-site`, { siteId: siteA }, { token: a.token });
      assert.equal(move.status, 409, move.raw);
    });

    it("migration 20261101-104 renames existing duplicates (oldest keeps its name), then enforces uniqueness, and runs twice", async () => {
      const mongoose = (await import("mongoose")).default;
      const { uniqueCameraNames } = await import("../migrations/20261101-104-unique-camera-names");
      const db = mongoose.connection.db!;
      const cams = db.collection("cameras");
      const oid = () => new mongoose.Types.ObjectId();
      const company = oid();
      const site = oid();
      // simulate old data: the unique index is not there yet
      await cams.dropIndex("siteId_1_name_1").catch(() => undefined);
      const mk = (name: string, minutesAgo: number) => ({ companyId: company, siteId: site, name, protocol: "RTSP", secretRef: "x", status: "PENDING_TEST", createdAt: new Date(Date.now() - minutesAgo * 60_000) });
      await cams.insertMany([mk("Dock", 30), mk("dock", 20), mk("DOCK ", 10), mk("Other", 5)]);

      await uniqueCameraNames.up(db);
      await uniqueCameraNames.up(db);
      const names = (await cams.find({ siteId: site }).sort({ createdAt: 1 }).toArray()).map((c) => c.name);
      assert.deepEqual(names, ["Dock", "dock (2)", "DOCK (3)", "Other"], "the oldest keeps its name, later ones get a number");
      const index = (await cams.indexes()).find((i) => i.name === "siteId_1_name_1");
      assert.ok(index?.unique, "uniqueness is enforced by the database");
    });
  });

  describe("12.9 evidence of unresolved events is kept, but not forever", () => {
    it("keeps evidence while an event is unresolved (up to twice the period); purges resolved and dismissed events at the period", async () => {
      const { createCargoEvent } = await import("../services/events/createEvent");
      const { getEvidenceStorage } = await import("../services/evidence/storage");
      const { runEvidenceRetention } = await import("../services/events/retention");
      const now = new Date();
      const make = async (label: string, daysOld: number) => {
        const key = `${a.companyId}/${siteA}/2026/10/${unique(label)}.jpg`;
        await getEvidenceStorage().put(key, Buffer.from("fake jpeg bytes"));
        const { event } = await createCargoEvent({
          eventKey: unique(label),
          siteId: siteA,
          cameraId: cameraA,
          eventType: "restricted_zone_movement",
          occurredAt: new Date(now.getTime() - daysOld * DAY),
          evidence: { snapshotObjectKey: key },
        });
        return { id: event._id.toString(), key };
      };
      const openOld = await make("open", 100);
      const openVeryOld = await make("openvery", 200);
      const resolvedOld = await make("resolved", 100);
      const dismissedOld = await make("dismissed", 100);
      const recent = await make("recent", 5);

      assert.equal((await api.post(`/api/v1/events/${resolvedOld.id}/acknowledge`, {}, { token: a.token })).status, 200);
      assert.equal((await api.post(`/api/v1/events/${resolvedOld.id}/resolve`, { outcome: "reviewed_no_issue", note: "checked" }, { token: a.token })).status, 200);
      assert.equal((await api.post(`/api/v1/events/${dismissedOld.id}/false-positive`, { reason: "a forklift" }, { token: a.token })).status, 200);

      await runEvidenceRetention(now, 90);
      const storage = getEvidenceStorage();
      assert.equal(await storage.exists(openOld.key), true, "open and 100 days old: kept (limit is 180)");
      assert.equal(await storage.exists(openVeryOld.key), false, "open but 200 days old: deleted, nothing is kept forever");
      assert.equal(await storage.exists(resolvedOld.key), false, "resolved and 100 days old: deleted");
      assert.equal(await storage.exists(dismissedOld.key), false, "dismissed and 100 days old: deleted");
      assert.equal(await storage.exists(recent.key), true, "recent: kept");
    });
  });

  describe("12.1 indexes", () => {
    it("migration 20261101-102 creates the audit and event indexes, and can run twice", async () => {
      const mongoose = (await import("mongoose")).default;
      const { addQueryIndexes } = await import("../migrations/20261101-102-query-indexes");
      const db = mongoose.connection.db!;
      await addQueryIndexes.up(db);
      await addQueryIndexes.up(db);
      const keysOf = async (c: string) => (await db.collection(c).indexes()).map((i) => JSON.stringify(i.key));
      assert.ok((await keysOf("auditlogs")).includes(JSON.stringify({ companyId: 1, createdAt: -1 })));
      assert.ok((await keysOf("cargo_events")).includes(JSON.stringify({ companyId: 1, cameraId: 1, occurredAt: -1 })));
      assert.ok((await keysOf("cargo_events")).includes(JSON.stringify({ companyId: 1, zoneId: 1, occurredAt: -1 })));
    });
  });
});
