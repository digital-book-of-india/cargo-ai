import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer, uploadFile } from "./harness";

// Integration tests for the event workflow, evidence, retention, platform standards and
// migrations. They run on a throw-away database (see harness.ts).

let server: TestServer;
let api: ReturnType<typeof createClient>;

interface Actor {
  token: string;
  userId: string;
  companyId: string;
}

const PASSWORD = "Test@12345";
let counter = 0;
const unique = (prefix: string) => `${prefix}${Date.now()}${counter++}`;
const email = (prefix: string) => `${unique(prefix)}@example.test`;
const SERVICE = () => ({ "x-service-token": process.env.AI_SERVICE_TOKEN ?? "dbi-ai-worker-secret-token" });
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

async function register(companyName: string): Promise<Actor> {
  const res = await api.post("/api/v1/auth/register", {
    name: companyName + " owner",
    email: email("owner"),
    password: PASSWORD,
    companyName,
  });
  assert.equal(res.status, 201, res.raw);
  return { token: res.body.data.token, userId: res.body.data.user.id, companyId: res.body.data.memberships[0].companyId };
}

async function addMember(owner: Actor, role: string, siteIds: string[]): Promise<Actor> {
  const invite = await api.post("/api/v1/users/invitations", { email: email(role.toLowerCase()), role, siteIds }, { token: owner.token });
  assert.equal(invite.status, 201, invite.raw);
  const accept = await api.post("/api/v1/auth/accept-invitation", { token: invite.body.data.token, name: role, password: PASSWORD });
  assert.equal(accept.status, 201, accept.raw);
  return { token: accept.body.data.token, userId: accept.body.data.user.id, companyId: accept.body.data.memberships[0].companyId };
}

async function createSite(owner: Actor, name: string, code: string) {
  const res = await api.post("/api/v1/sites", { name, code }, { token: owner.token });
  assert.equal(res.status, 201, res.raw);
  return res.body.data.site as { id: string };
}

async function addCamera(owner: Actor, siteId: string) {
  const res = await api.post(
    `/api/v1/sites/${siteId}/cameras`,
    { name: "Bay camera", protocol: "RTSP", host: "192.0.2.10" },
    { token: owner.token }
  );
  assert.equal(res.status, 201, res.raw);
  return res.body.data.camera as { id: string };
}

describe("events, evidence and platform standards (integration)", () => {
  let a: Actor;
  let b: Actor;
  let manager: Actor;
  let operator: Actor;
  let auditor: Actor;
  let s1: { id: string };
  let s2: { id: string };
  let bs1: { id: string };
  let cam1: { id: string };
  let cam2: { id: string };
  let bCam: { id: string };

  const ingest = (key: string, extra: Record<string, unknown> = {}, siteId = s1.id, cameraId = cam1.id) =>
    api.post(
      "/api/v1/ai/events",
      { eventKey: key, siteId, cameraId, eventType: "restricted_zone_movement", occurredAt: new Date().toISOString(), ...extra },
      { headers: SERVICE() }
    );

  const newEvent = async (extra: Record<string, unknown> = {}) => {
    const res = await ingest(unique("evt"), extra);
    assert.equal(res.status, 202, res.raw);
    return res.body.data.eventId as string;
  };

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    a = await register("Company A");
    b = await register("Company B");
    s1 = await createSite(a, "A North", "A-NORTH");
    s2 = await createSite(a, "A South", "A-SOUTH");
    bs1 = await createSite(b, "B Main", "B-MAIN");
    cam1 = await addCamera(a, s1.id);
    cam2 = await addCamera(a, s2.id);
    bCam = await addCamera(b, bs1.id);
    manager = await addMember(a, "WAREHOUSE_MANAGER", [s1.id]);
    operator = await addMember(a, "SECURITY_OPERATOR", [s1.id]);
    auditor = await addMember(a, "AUDITOR", [s1.id]);
  });

  after(async () => {
    await server.close();
  });

  describe("platform standards", () => {
    it("every success response carries meta.requestId, matching the X-Request-Id header", async () => {
      const res = await fetch(`${server.baseUrl}/api/v1/me`, { headers: { Authorization: `Bearer ${a.token}` } });
      const body: any = await res.json();
      assert.ok(body.meta?.requestId);
      assert.equal(body.meta.requestId, res.headers.get("x-request-id"));
    });

    it("unknown routes answer 404 in the standard error shape", async () => {
      const res = await api.get("/api/v1/nope");
      assert.equal(res.status, 404);
      assert.equal(res.body.error.code, "NOT_FOUND");
      assert.ok(res.body.error.requestId);
    });

    it("malformed JSON is a 400 VALIDATION_ERROR, not a 500", async () => {
      const res = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not json",
      });
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as any).error.code, "VALIDATION_ERROR");
    });

    it("an oversized body is a 413 PAYLOAD_TOO_LARGE", async () => {
      const res = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x@example.test", password: "x".repeat(2 * 1024 * 1024) }),
      });
      assert.equal(res.status, 413);
      assert.equal(((await res.json()) as any).error.code, "PAYLOAD_TOO_LARGE");
    });
  });

  describe("ingestion and idempotency (QA-03)", () => {
    it("rejects unknown fields, bad types and a mismatching Idempotency-Key", async () => {
      assert.equal((await ingest(unique("k"), { surprise: true })).status, 400);
      assert.equal((await ingest(unique("k"), { eventType: "theft_detected" })).status, 400);
      const res = await api.post(
        "/api/v1/ai/events",
        { eventKey: unique("k"), siteId: s1.id, cameraId: cam1.id, eventType: "zone_entry", occurredAt: new Date().toISOString() },
        { headers: { ...SERVICE(), "idempotency-key": "something-else" } }
      );
      assert.equal(res.status, 400);
    });

    it("refuses a stated company that is not the site's company", async () => {
      const res = await ingest(unique("k"), { companyId: b.companyId });
      assert.equal(res.status, 400);
    });

    it("ten simultaneous retries of one eventKey create exactly one event, one history row and one notification per reviewer", async () => {
      const key = unique("race");
      const results = await Promise.all(Array.from({ length: 10 }, () => ingest(key)));
      const ids = new Set(results.map((r) => r.body.data.eventId));
      assert.equal(ids.size, 1, "all retries must return the same event id");
      assert.equal(results.filter((r) => r.status === 202).length, 1);

      const mongoose = (await import("mongoose")).default;
      const eventId = [...ids][0];
      const events = await mongoose.connection.collection("cargo_events").countDocuments({ eventKey: key });
      const history = await mongoose.connection
        .collection("cargo_event_history")
        .countDocuments({ eventId: new mongoose.Types.ObjectId(eventId), action: "CREATED" });
      const notes = await mongoose.connection.collection("notifications").countDocuments({ eventId });
      assert.equal(events, 1);
      assert.equal(history, 1);
      // reviewers with access to site 1: owner, manager, operator (the auditor cannot review)
      assert.equal(notes, 3);
    });

    it("applies the default severity and a conservative summary", async () => {
      const id = await newEvent({ eventType: "count_mismatch" });
      const res = await api.get(`/api/v1/events/${id}`, { token: a.token });
      assert.equal(res.body.data.event.severity, "high");
      assert.ok(!/theft|stolen/i.test(res.body.data.event.summary));
    });
  });

  describe("review workflow (QA-08)", () => {
    it("open -> acknowledged -> resolved writes history with actor and time", async () => {
      const id = await newEvent();
      const ack = await api.post(`/api/v1/events/${id}/acknowledge`, { note: "On it" }, { token: operator.token });
      assert.equal(ack.status, 200, ack.raw);
      assert.equal(ack.body.data.event.status, "acknowledged");

      const res = await api.post(
        `/api/v1/events/${id}/resolve`,
        { outcome: "reviewed_no_issue", note: "Approved loading" },
        { token: operator.token }
      );
      assert.equal(res.status, 200, res.raw);
      const event = res.body.data.event;
      assert.equal(event.status, "resolved");
      assert.equal(event.resolution.outcome, "reviewed_no_issue");
      assert.equal(event.resolution.resolvedBy.id, operator.userId);

      assert.deepEqual(event.history.map((h: any) => h.action), ["CREATED", "ACKNOWLEDGED", "RESOLVED"]);
      assert.equal(event.history[1].actor.id, operator.userId);
      assert.equal(event.history[2].fromStatus, "acknowledged");
      assert.ok(event.history.every((h: any) => !Number.isNaN(Date.parse(h.createdAt))));
    });

    it("refuses moves the transition map does not allow (409)", async () => {
      const open = await newEvent();
      const direct = await api.post(`/api/v1/events/${open}/resolve`, { outcome: "reviewed_no_issue" }, { token: operator.token });
      assert.equal(direct.status, 409, "an open event cannot be resolved without being acknowledged");

      await api.post(`/api/v1/events/${open}/acknowledge`, {}, { token: operator.token });
      const twice = await api.post(`/api/v1/events/${open}/acknowledge`, {}, { token: operator.token });
      assert.equal(twice.status, 409);

      await api.post(`/api/v1/events/${open}/resolve`, { outcome: "confirmed_operational" }, { token: operator.token });
      const afterResolve = await api.post(`/api/v1/events/${open}/acknowledge`, {}, { token: operator.token });
      assert.equal(afterResolve.status, 409);
    });

    it("two people acknowledging at once: one wins, the other gets 409", async () => {
      const id = await newEvent();
      const results = await Promise.all([
        api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: operator.token }),
        api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: manager.token }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    });

    it("the outcomes escalated and false_positive set the matching status", async () => {
      const e1 = await newEvent();
      const escalated = await api.post(`/api/v1/events/${e1}/resolve`, { outcome: "escalated", note: "Needs the shift lead" }, { token: operator.token });
      assert.equal(escalated.body.data.event.status, "escalated");

      const e2 = await newEvent();
      const fp = await api.post(`/api/v1/events/${e2}/false-positive`, { reason: "Pallet shadow" }, { token: operator.token });
      assert.equal(fp.status, 200, fp.raw);
      assert.equal(fp.body.data.event.status, "false_positive");
      assert.equal(fp.body.data.event.resolution.note, "Pallet shadow");

      const noReason = await api.post(`/api/v1/events/${await newEvent()}/false-positive`, {}, { token: operator.token });
      assert.equal(noReason.status, 400);
    });

    it("rejects an unknown outcome name", async () => {
      const id = await newEvent();
      await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: operator.token });
      const res = await api.post(`/api/v1/events/${id}/resolve`, { outcome: "theft_confirmed" }, { token: operator.token });
      assert.equal(res.status, 400);
    });

    it("notes are stored with their author and need the review permission", async () => {
      const id = await newEvent();
      const ok = await api.post(`/api/v1/events/${id}/notes`, { note: "Checked camera 2 as well" }, { token: operator.token });
      assert.equal(ok.status, 201, ok.raw);
      assert.equal(ok.body.data.event.notes[0].note, "Checked camera 2 as well");
      assert.equal(ok.body.data.event.notes[0].author.id, operator.userId);
      assert.equal((await api.post(`/api/v1/events/${id}/notes`, { note: "x" }, { token: auditor.token })).status, 403);
      assert.equal((await api.post(`/api/v1/events/${id}/notes`, { note: "" }, { token: operator.token })).status, 400);
    });

    it("assignment: only reviewers with access to the site, and an acknowledged event moves into review", async () => {
      const id = await newEvent();
      await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: operator.token });

      assert.equal((await api.post(`/api/v1/events/${id}/assign`, { userId: auditor.userId }, { token: a.token })).status, 400);
      assert.equal((await api.post(`/api/v1/events/${id}/assign`, { userId: b.userId }, { token: a.token })).status, 400);

      const ok = await api.post(`/api/v1/events/${id}/assign`, { userId: manager.userId }, { token: a.token });
      assert.equal(ok.status, 200, ok.raw);
      assert.equal(ok.body.data.event.status, "in_review");
      assert.equal(ok.body.data.event.assignedTo.id, manager.userId);

      const cleared = await api.post(`/api/v1/events/${id}/assign`, { userId: null }, { token: a.token });
      assert.equal(cleared.body.data.event.assignedTo, null);
    });

    it("reopening needs the permission, a resolved event and a reason", async () => {
      const id = await newEvent();
      await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: operator.token });
      assert.equal((await api.post(`/api/v1/events/${id}/reopen`, { note: "mistake" }, { token: manager.token })).status, 409, "not resolved yet");
      await api.post(`/api/v1/events/${id}/resolve`, { outcome: "unresolved_other" }, { token: operator.token });

      assert.equal((await api.post(`/api/v1/events/${id}/reopen`, { note: "more info" }, { token: operator.token })).status, 403);
      assert.equal((await api.post(`/api/v1/events/${id}/reopen`, {}, { token: manager.token })).status, 400);
      const ok = await api.post(`/api/v1/events/${id}/reopen`, { note: "New footage arrived" }, { token: manager.token });
      assert.equal(ok.status, 200, ok.raw);
      assert.equal(ok.body.data.event.status, "open");
      assert.equal(ok.body.data.event.resolution, null);
      assert.ok(ok.body.data.event.history.some((h: any) => h.action === "REOPENED"));
    });

    it("another company cannot touch the event", async () => {
      const id = await newEvent();
      for (const action of ["acknowledge", "resolve", "notes", "assign", "reopen", "false-positive"]) {
        const res = await api.post(`/api/v1/events/${id}/${action}`, { outcome: "reviewed_no_issue", note: "valid note", userId: null, reason: "valid reason" }, { token: b.token });
        assert.equal(res.status, 404, action);
      }
      assert.equal((await api.get(`/api/v1/events/${id}`, { token: b.token })).status, 404);
    });

    it("status changes are written to the audit log with the company", async () => {
      const id = await newEvent();
      await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: operator.token });
      const mongoose = (await import("mongoose")).default;
      const log = await mongoose.connection.collection("auditlogs").findOne({ action: "EVENT_ACKNOWLEDGED", targetId: id });
      assert.ok(log);
      assert.equal(String(log!.companyId), a.companyId);
      assert.equal(String(log!.actorUserId), operator.userId);
    });
  });

  describe("listing, filters and paging", () => {
    it("filters by status, type, severity and time; rejects bad filters", async () => {
      const t0 = new Date().toISOString();
      const id = await newEvent({ eventType: "package_line_crossing" });
      const byType = await api.get("/api/v1/events?eventType=package_line_crossing&limit=100", { token: a.token });
      assert.ok(byType.body.data.items.some((e: any) => e.id === id));
      assert.ok(byType.body.data.items.every((e: any) => e.eventType === "package_line_crossing"));

      const bySeverity = await api.get("/api/v1/events?severity=low&limit=100", { token: a.token });
      assert.ok(bySeverity.body.data.items.every((e: any) => e.severity === "low"));

      const future = await api.get(`/api/v1/events?from=${encodeURIComponent(new Date(Date.now() + 3600_000).toISOString())}`, { token: a.token });
      assert.equal(future.body.data.items.length, 0);
      const since = await api.get(`/api/v1/events?from=${encodeURIComponent(t0)}&limit=100`, { token: a.token });
      assert.ok(since.body.data.items.some((e: any) => e.id === id));

      assert.equal((await api.get("/api/v1/events?status=banana", { token: a.token })).status, 400);
      assert.equal((await api.get("/api/v1/events?from=yesterday", { token: a.token })).status, 400);
      assert.equal((await api.get("/api/v1/events?cursor=garbage", { token: a.token })).status, 400);
    });

    it("pages with a cursor: no gaps, no duplicates, and the page size is capped", async () => {
      await newEvent();
      await newEvent();
      await newEvent();
      const seen: string[] = [];
      let cursor: string | null = null;
      for (let i = 0; i < 100; i++) {
        const res: any = await api.get(`/api/v1/events?limit=2${cursor ? `&cursor=${cursor}` : ""}`, { token: a.token });
        assert.equal(res.status, 200);
        assert.ok(res.body.data.items.length <= 2);
        seen.push(...res.body.data.items.map((e: any) => e.id));
        cursor = res.body.data.nextCursor;
        assert.equal(res.body.meta.nextCursor, cursor);
        if (!cursor) break;
      }
      assert.equal(new Set(seen).size, seen.length, "a page must never repeat an event");
      const all = await api.get("/api/v1/events?limit=100000", { token: a.token });
      assert.ok(all.body.data.items.length <= 100, "page size is capped at 100");
      assert.equal(seen.length, all.body.data.total);
    });

    it("members only see events of the sites they are assigned to", async () => {
      const hidden = (await ingest(unique("s2"), {}, s2.id, cam2.id)).body.data.eventId;
      const mine = await api.get("/api/v1/events?limit=100", { token: operator.token });
      assert.ok(!mine.body.data.items.some((e: any) => e.id === hidden));
      assert.equal((await api.get(`/api/v1/events/${hidden}`, { token: operator.token })).status, 404);
      assert.equal((await api.get(`/api/v1/sites/${s2.id}/events`, { token: operator.token })).status, 404);

      const owner = await api.get("/api/v1/events?limit=100", { token: a.token });
      assert.ok(owner.body.data.items.some((e: any) => e.id === hidden));
    });

    it("company B never sees company A events", async () => {
      const res = await api.get("/api/v1/events?limit=100", { token: b.token });
      assert.equal(res.body.data.items.length, 0);
    });
  });

  describe("evidence (QA-09)", () => {
    const upload = (siteId: string, cameraId: string, bytes = JPEG, type = "image/jpeg") =>
      uploadFile(server.baseUrl, "/internal/v1/evidence/upload", { siteId, cameraId }, { bytes, type, name: "snap" }, SERVICE());

    it("the server chooses the storage key and it starts with the company id", async () => {
      const res = await upload(s1.id, cam1.id);
      assert.equal(res.status, 201, res.raw);
      assert.ok(res.body.data.objectKey.startsWith(`${a.companyId}/${s1.id}/`));
      assert.equal(res.body.data.kind, "snapshot");
      assert.equal(res.body.data.checksum.length, 64);
    });

    it("rejects missing credentials, wrong content, unsupported types and a foreign camera", async () => {
      const noToken = await uploadFile(server.baseUrl, "/internal/v1/evidence/upload", { siteId: s1.id, cameraId: cam1.id }, { bytes: JPEG, type: "image/jpeg", name: "x" });
      assert.equal(noToken.status, 401);
      assert.equal((await upload(s1.id, cam1.id, Buffer.from("not a jpeg at all"), "image/jpeg")).status, 400);
      assert.equal((await upload(s1.id, cam1.id, Buffer.from("hello"), "text/plain")).status, 400);
      assert.equal((await upload(s1.id, bCam.id)).status, 400);
    });

    it("an event cannot reference a missing file or another company's file", async () => {
      assert.equal((await ingest(unique("k"), { evidence: { snapshotObjectKey: `${a.companyId}/${s1.id}/2026/10/missing.jpg` } })).status, 400);
      assert.equal((await ingest(unique("k"), { evidence: { snapshotObjectKey: "../../etc/passwd" } })).status, 400);
      const foreign = (await upload(bs1.id, bCam.id)).body.data.objectKey;
      assert.equal((await ingest(unique("k"), { evidence: { snapshotObjectKey: foreign } })).status, 400);
    });

    it("an authorised user gets a signed link that serves the picture privately, and the access is audited", async () => {
      const key = (await upload(s1.id, cam1.id)).body.data.objectKey;
      const id = await newEvent({ evidence: { snapshotObjectKey: key } });

      const detail = await api.get(`/api/v1/events/${id}`, { token: operator.token });
      assert.equal(detail.body.data.event.evidence.snapshotAvailable, true);
      const url = detail.body.data.event.evidence.snapshotUrl as string;
      assert.ok(url.includes("token="));
      assert.ok(!JSON.stringify(detail.body).includes(key), "the storage key is never sent to the browser");

      // the list view never carries links
      const list = await api.get("/api/v1/events?limit=100", { token: operator.token });
      assert.equal(list.body.data.items.find((e: any) => e.id === id).evidence.snapshotUrl, undefined);

      const file = await fetch(server.baseUrl + url);
      assert.equal(file.status, 200);
      assert.equal(file.headers.get("content-type"), "image/jpeg");
      assert.equal(file.headers.get("cache-control"), "private, no-store");
      assert.equal(Buffer.from(await file.arrayBuffer()).length, JPEG.length);

      const mongoose = (await import("mongoose")).default;
      const log = await mongoose.connection.collection("auditlogs").findOne({ action: "EVIDENCE_ACCESSED", targetId: id });
      assert.ok(log, "evidence access must be audited");
      assert.equal(String(log!.actorUserId), operator.userId);
    });

    it("an expired, tampered, wrong-kind or wrong-event link is refused; other companies get nothing", async () => {
      const { signEvidenceUrl } = await import("../services/evidence/signer");
      const key = (await upload(s1.id, cam1.id)).body.data.objectKey;
      const id = await newEvent({ evidence: { snapshotObjectKey: key } });
      const other = await newEvent({ evidence: { snapshotObjectKey: (await upload(s1.id, cam1.id)).body.data.objectKey } });

      const expired = signEvidenceUrl(id, "snapshot", { companyId: a.companyId, userId: operator.userId }, -10);
      assert.equal((await fetch(server.baseUrl + expired.url)).status, 401);

      const good = signEvidenceUrl(id, "snapshot", { companyId: a.companyId, userId: operator.userId }).url;
      assert.equal((await fetch(server.baseUrl + good + "x")).status, 401, "tampered token");
      assert.equal((await fetch(server.baseUrl + good.replace("/snapshot?", "/clip?"))).status, 401, "wrong kind");
      assert.equal((await fetch(server.baseUrl + good.replace(id, other))).status, 401, "token belongs to another event");
      assert.equal((await fetch(`${server.baseUrl}/api/v1/evidence/${id}/snapshot`)).status, 401, "no token at all");

      // a link claiming another company finds no event there
      const wrongCompany = signEvidenceUrl(id, "snapshot", { companyId: b.companyId }).url;
      assert.equal((await fetch(server.baseUrl + wrongCompany)).status, 404);

      // the other company cannot even obtain a link
      assert.equal((await api.get(`/api/v1/events/${id}`, { token: b.token })).status, 404);
    });
  });

  describe("retention", () => {
    it("deletes old evidence files, keeps the event and its history, and ignores recent events", async () => {
      const { runEvidenceRetention } = await import("../services/events/retention");
      const { getEvidenceStorage } = await import("../services/evidence/storage");
      const upload = (siteId: string, cameraId: string) =>
        uploadFile(server.baseUrl, "/internal/v1/evidence/upload", { siteId, cameraId }, { bytes: JPEG, type: "image/jpeg", name: "s" }, SERVICE());

      const oldKey = (await upload(s1.id, cam1.id)).body.data.objectKey;
      const oldId = await newEvent({ evidence: { snapshotObjectKey: oldKey }, occurredAt: new Date(Date.now() - 100 * 86400_000).toISOString() });
      const newKey = (await upload(s1.id, cam1.id)).body.data.objectKey;
      const newId = await newEvent({ evidence: { snapshotObjectKey: newKey } });

      assert.equal(await getEvidenceStorage().exists(oldKey), true);
      const first = await runEvidenceRetention(new Date(), 90);
      assert.equal(first.eventsPurged, 1);
      assert.equal(first.filesDeleted, 1);
      assert.equal(await getEvidenceStorage().exists(oldKey), false, "the old file is gone");
      assert.equal(await getEvidenceStorage().exists(newKey), true, "a recent file is kept");

      const oldEvent = await api.get(`/api/v1/events/${oldId}`, { token: a.token });
      assert.equal(oldEvent.status, 200, "the event itself is kept");
      assert.equal(oldEvent.body.data.event.evidence.snapshotAvailable, false);
      assert.ok(oldEvent.body.data.event.history.some((h: any) => h.action === "EVIDENCE_PURGED"));
      assert.equal((await api.get(`/api/v1/events/${newId}`, { token: a.token })).body.data.event.evidence.snapshotAvailable, true);

      const second = await runEvidenceRetention(new Date(), 90);
      assert.equal(second.eventsPurged, 0, "running it again changes nothing");
    });
  });

  describe("migrations", () => {
    it("apply in order, roll back, and the legacy rename is reversible", async () => {
      const mongoose = (await import("mongoose")).default;
      const { migrations } = await import("../migrations/list");
      const { migrateDown, migrateUp, status } = await import("../migrations/runner");
      const db = mongoose.connection.db!;

      await db.collection("shops").insertOne({ name: "old shop" });
      const names = async () => (await db.listCollections().toArray()).map((c) => c.name);

      const applied = await migrateUp(db, migrations);
      assert.deepEqual(applied, migrations.map((m) => m.id));
      assert.ok((await names()).includes("legacy_shops"));
      assert.ok(!(await names()).includes("shops"));
      assert.deepEqual(await migrateUp(db, migrations), [], "running again applies nothing");
      assert.ok((await status(db, migrations)).every((s) => s.applied));

      // the newest migrations only create indexes; the legacy rename is the one before them
      const reverted = await migrateDown(db, migrations, 3);
      assert.deepEqual(reverted, migrations.slice(-3).reverse().map((m) => m.id));
      assert.ok((await names()).includes("shops"), "rolled back: the old collection is back");
      assert.equal(await db.collection("shops").countDocuments(), 1);

      await migrateDown(db, migrations, 10);
      assert.ok((await status(db, migrations)).every((s) => !s.applied));
      await db.collection("shops").drop();
    });
  });
});
