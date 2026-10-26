import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer } from "./harness";

// P4: notification delivery (retry, backoff, dead letter), read state, event summary, the
// "assigned to me" filter and the assignee list. Runs on a throw-away database.

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

describe("inbox and notifications (integration)", () => {
  let a: Actor;
  let b: Actor;
  let manager: Actor;
  let operator: Actor;
  let auditor: Actor;
  let s1: { id: string };
  let s2: { id: string };
  let cam1: { id: string };
  let cam2: { id: string };

  const ingest = (siteId: string, cameraId: string, eventType = "restricted_zone_movement", extra: Record<string, unknown> = {}) =>
    api.post(
      "/api/v1/ai/events",
      { eventKey: unique("evt"), siteId, cameraId, eventType, occurredAt: new Date().toISOString(), ...extra },
      { headers: SERVICE() }
    );
  const newEvent = async (siteId = s1.id, cameraId = cam1.id, eventType = "restricted_zone_movement") =>
    (await ingest(siteId, cameraId, eventType)).body.data.eventId as string;

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    a = await register("Inbox A");
    b = await register("Inbox B");
    s1 = (await api.post("/api/v1/sites", { name: "North", code: "N1" }, { token: a.token })).body.data.site;
    s2 = (await api.post("/api/v1/sites", { name: "South", code: "S1" }, { token: a.token })).body.data.site;
    cam1 = (await api.post(`/api/v1/sites/${s1.id}/cameras`, { name: "C1", protocol: "RTSP", host: "192.0.2.1" }, { token: a.token })).body.data.camera;
    cam2 = (await api.post(`/api/v1/sites/${s2.id}/cameras`, { name: "C2", protocol: "RTSP", host: "192.0.2.2" }, { token: a.token })).body.data.camera;
    manager = await addMember(a, "WAREHOUSE_MANAGER", [s1.id]);
    operator = await addMember(a, "SECURITY_OPERATOR", [s1.id]);
    auditor = await addMember(a, "AUDITOR", [s1.id]);
  });

  after(async () => {
    await server.close();
  });

  describe("delivery with retry, backoff and dead letter", () => {
    it("retries a failing delivery with growing delays, then dead-letters it; a later event still delivers", async () => {
      const { setChannelHandler, dispatchDue, MAX_ATTEMPTS, BACKOFF_SECONDS } = await import("../services/notifications/dispatcher");
      const mongoose = (await import("mongoose")).default;
      const coll = mongoose.connection.collection("notifications");

      let calls = 0;
      setChannelHandler("IN_APP", async () => {
        calls++;
        throw new Error("CHANNEL_DOWN");
      });
      try {
        const eventId = await newEvent();
        const rows = await coll.find({ eventId }).toArray();
        assert.equal(rows.length, 3, "owner, manager and operator are notified");
        for (const r of rows) {
          assert.equal(r.status, "PENDING", "the first attempt failed, so it waits for a retry");
          assert.equal(r.attempts, 1);
          assert.equal(r.lastErrorCode, "CHANNEL_DOWN");
          assert.ok(r.nextAttemptAt > new Date(), "the next attempt is in the future");
        }
        const firstDelay = rows[0].nextAttemptAt.getTime() - Date.now();
        assert.ok(firstDelay > (BACKOFF_SECONDS[0] - 5) * 1000 && firstDelay <= BACKOFF_SECONDS[0] * 1000 + 1000);

        // before the retry is due nothing happens
        const early = await dispatchDue(new Date());
        assert.deepEqual(early, { delivered: 0, retryScheduled: 0, deadLettered: 0 });

        // walk forward in time through every retry until the last attempt
        let clock = Date.now();
        for (let attempt = 2; attempt <= MAX_ATTEMPTS; attempt++) {
          clock += (BACKOFF_SECONDS[Math.min(attempt - 2, BACKOFF_SECONDS.length - 1)] + 1) * 1000;
          const r = await dispatchDue(new Date(clock));
          if (attempt < MAX_ATTEMPTS) assert.equal(r.retryScheduled, 3, `attempt ${attempt}`);
          else assert.equal(r.deadLettered, 3, "the last failed attempt dead-letters");
        }
        const dead = await coll.find({ eventId }).toArray();
        for (const r of dead) {
          assert.equal(r.status, "FAILED");
          assert.equal(r.attempts, MAX_ATTEMPTS);
          assert.equal(r.nextAttemptAt, null);
          assert.equal(r.lastErrorCode, "CHANNEL_DOWN");
        }
        // a dead-lettered notification is never picked up again
        assert.deepEqual(await dispatchDue(new Date(clock + 7 * 86400_000)), { delivered: 0, retryScheduled: 0, deadLettered: 0 });
        assert.equal(calls, 3 * MAX_ATTEMPTS);
      } finally {
        setChannelHandler("IN_APP", null);
      }

      const healthy = await newEvent();
      const ok = await mongoose.connection.collection("notifications").find({ eventId: healthy }).toArray();
      assert.ok(ok.length > 0 && ok.every((r) => r.status === "SENT" && r.sentAt), "delivery works again once the channel recovers");
    });

    it("a retry that succeeds marks the notification sent", async () => {
      const { setChannelHandler, dispatchDue } = await import("../services/notifications/dispatcher");
      const mongoose = (await import("mongoose")).default;
      let fail = true;
      setChannelHandler("IN_APP", async () => {
        if (fail) throw new Error("TEMPORARY");
      });
      try {
        const eventId = await newEvent();
        fail = false;
        const result = await dispatchDue(new Date(Date.now() + 120_000));
        assert.equal(result.delivered, 3);
        const rows = await mongoose.connection.collection("notifications").find({ eventId }).toArray();
        assert.ok(rows.every((r) => r.status === "SENT" && r.attempts === 2));
      } finally {
        setChannelHandler("IN_APP", null);
      }
    });

    it("delivery is idempotent: two sweepers racing deliver each notification once", async () => {
      const { setChannelHandler, dispatchDue } = await import("../services/notifications/dispatcher");
      let fail = true;
      const delivered = new Map<string, number>();
      setChannelHandler("IN_APP", async (n) => {
        if (fail) throw new Error("WAIT");
        delivered.set(String(n._id), (delivered.get(String(n._id)) ?? 0) + 1);
      });
      try {
        const eventId = await newEvent();
        fail = false;
        const later = new Date(Date.now() + 120_000);
        await Promise.all([dispatchDue(later), dispatchDue(later), dispatchDue(later)]);
        const mongoose = (await import("mongoose")).default;
        const ids = (await mongoose.connection.collection("notifications").find({ eventId }).toArray()).map((r) => String(r._id));
        assert.equal(ids.length, 3);
        for (const id of ids) assert.equal(delivered.get(id), 1, "each notification is delivered exactly once");
      } finally {
        setChannelHandler("IN_APP", null);
      }
    });

    it("notifying twice for one event never creates a second notification", async () => {
      const eventId = await newEvent();
      const { notifyReviewers } = await import("../services/events/createEvent");
      const { CargoEventModel } = await import("../models");
      const event = await CargoEventModel.findById(eventId);
      const again = await notifyReviewers(event!);
      assert.equal(again, 0);
      const mongoose = (await import("mongoose")).default;
      assert.equal(await mongoose.connection.collection("notifications").countDocuments({ eventId }), 3);
    });
  });

  describe("reading notifications", () => {
    it("lists the person's own notifications with the event summary and an unread count", async () => {
      const eventId = await newEvent();
      const res = await api.get("/api/v1/notifications", { token: operator.token });
      assert.equal(res.status, 200);
      const mine = res.body.data.items.find((n: any) => n.eventId === eventId);
      assert.ok(mine);
      assert.equal(mine.readAt, null);
      assert.equal(mine.event.siteName, "North");
      assert.equal(mine.event.eventType, "restricted_zone_movement");
      assert.ok(res.body.data.unreadCount >= 1);
      // the auditor cannot review events, so was not notified
      const aud = await api.get("/api/v1/notifications", { token: auditor.token });
      assert.ok(!aud.body.data.items.some((n: any) => n.eventId === eventId));
    });

    it("marks one or all as read, and only the caller's own", async () => {
      const eventId = await newEvent();
      const list = await api.get("/api/v1/notifications?unread=true", { token: manager.token });
      const target = list.body.data.items.find((n: any) => n.eventId === eventId);
      const before = (await api.get("/api/v1/notifications/unread-count", { token: manager.token })).body.data.unreadCount;

      // someone else cannot mark it
      assert.equal((await api.post(`/api/v1/notifications/${target.id}/read`, {}, { token: operator.token })).status, 404);
      assert.equal((await api.post(`/api/v1/notifications/${target.id}/read`, {}, { token: b.token })).status, 404);

      const ok = await api.post(`/api/v1/notifications/${target.id}/read`, {}, { token: manager.token });
      assert.equal(ok.status, 200);
      assert.equal((await api.get("/api/v1/notifications/unread-count", { token: manager.token })).body.data.unreadCount, before - 1);

      const all = await api.post("/api/v1/notifications/read-all", {}, { token: manager.token });
      assert.equal(all.status, 200);
      assert.equal((await api.get("/api/v1/notifications/unread-count", { token: manager.token })).body.data.unreadCount, 0);
      // the operator's own notifications were not touched
      assert.ok((await api.get("/api/v1/notifications/unread-count", { token: operator.token })).body.data.unreadCount > 0);
    });

    it("hides event details once the person loses access to that site", async () => {
      const eventId = await newEvent();
      assert.ok((await api.get("/api/v1/notifications", { token: operator.token })).body.data.items.find((n: any) => n.eventId === eventId).event);
      // move the operator to the other site only
      await api.patch(`/api/v1/users/${operator.userId}/role`, { role: "SECURITY_OPERATOR", siteIds: [s2.id] }, { token: a.token });
      const after = (await api.get("/api/v1/notifications", { token: operator.token })).body.data.items.find((n: any) => n.eventId === eventId);
      assert.equal(after.event, null);
      await api.patch(`/api/v1/users/${operator.userId}/role`, { role: "SECURITY_OPERATOR", siteIds: [s1.id] }, { token: a.token });
    });

    it("another company has no notifications from this one", async () => {
      const res = await api.get("/api/v1/notifications", { token: b.token });
      assert.equal(res.body.data.items.length, 0);
      assert.equal(res.body.data.unreadCount, 0);
    });
  });

  describe("event summary, assignment filter and assignees", () => {
    it("counts by status and severity for the sites the person can see", async () => {
      const id = await newEvent(s1.id, cam1.id, "count_mismatch"); // high
      await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: operator.token });
      await newEvent(s2.id, cam2.id, "package_line_crossing"); // low, other site

      const owner = (await api.get("/api/v1/events/summary", { token: a.token })).body.data;
      const op = (await api.get("/api/v1/events/summary", { token: operator.token })).body.data;
      assert.ok(owner.total > op.total, "the operator cannot see site 2 events");
      assert.ok(owner.byStatus.acknowledged >= 1);
      assert.ok(owner.bySeverity.high >= 1 && owner.bySeverity.low >= 1);
      assert.equal(Object.values(owner.byStatus).reduce((x: number, y: any) => x + y, 0), owner.total);

      const site2 = (await api.get(`/api/v1/events/summary?siteId=${s2.id}`, { token: a.token })).body.data;
      assert.ok(site2.total >= 1);
      assert.equal((await api.get(`/api/v1/events/summary?siteId=${s2.id}`, { token: operator.token })).status, 404);
      assert.equal((await api.get("/api/v1/events/summary", { token: b.token })).body.data.total, 0);
    });

    it("lists the people an event can be assigned to, and lets operators and managers see them", async () => {
      const id = await newEvent();
      const res = await api.get(`/api/v1/events/${id}/assignees`, { token: operator.token });
      assert.equal(res.status, 200, res.raw);
      const ids = res.body.data.items.map((p: any) => p.id);
      assert.ok(ids.includes(a.userId) && ids.includes(manager.userId) && ids.includes(operator.userId));
      assert.ok(!ids.includes(auditor.userId), "auditors cannot review events");
      assert.equal((await api.get(`/api/v1/events/${id}/assignees`, { token: auditor.token })).status, 403);
      assert.equal((await api.get(`/api/v1/events/${id}/assignees`, { token: b.token })).status, 404);
    });

    it("the assigned-to-me filter returns only my events", async () => {
      const id = await newEvent();
      await api.post(`/api/v1/events/${id}/acknowledge`, {}, { token: operator.token });
      await api.post(`/api/v1/events/${id}/assign`, { userId: manager.userId }, { token: a.token });

      const mine = await api.get("/api/v1/events?assignedTo=me&limit=100", { token: manager.token });
      assert.ok(mine.body.data.items.some((e: any) => e.id === id));
      assert.ok(mine.body.data.items.every((e: any) => e.assignedTo?.id === manager.userId));
      const other = await api.get("/api/v1/events?assignedTo=me&limit=100", { token: operator.token });
      assert.ok(!other.body.data.items.some((e: any) => e.id === id));
      assert.equal((await api.get("/api/v1/events?assignedTo=nobody", { token: a.token })).status, 400);
      assert.ok((await api.get("/api/v1/events/summary?assignedTo=me", { token: manager.token })).body.data.total >= 1);
    });
  });
});
