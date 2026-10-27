import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer } from "./harness";

// Joint Dev 1 / Dev 2 chain on a throw-away database, with the real count ledger (no provider override):
// zone -> validate -> enable -> monitoring -> worker events -> loading session -> reconciliation -> inbox.

let server: TestServer;
let api: ReturnType<typeof createClient>;

const PASSWORD = "Test@12345";
let counter = 0;
const unique = (p: string) => `${p}${Date.now()}${counter++}`;
const SERVICE = () => ({ "x-service-token": process.env.AI_SERVICE_TOKEN ?? "dbi-dev-ai-service-token-change-me-0123456789" });

describe("cargo chain: worker events to reconciliation (integration)", () => {
  let token: string;
  let companyId: string;
  let siteId: string;
  let cameraId: string;
  let zoneId: string;

  const crossing = (trackId: string, direction: "IN" | "OUT", extra: Record<string, unknown> = {}) => {
    const eventKey = unique("x");
    return api.post(
      "/internal/v1/ai/events",
      {
        eventKey,
        companyId,
        siteId,
        cameraId,
        zoneId,
        eventType: "package_line_crossing",
        occurredAt: new Date().toISOString(),
        track: { trackId, class: "box", confidence: 0.9, bbox: [0.1, 0.1, 0.2, 0.2] },
        movement: { direction, countDelta: 1 },
        ...extra,
      },
      { headers: { ...SERVICE(), "idempotency-key": eventKey } }
    );
  };
  const startSession = (body: Record<string, unknown>) => api.post("/api/v1/loading-sessions", body, { token });
  const closeSession = (id: string) => api.post(`/api/v1/loading-sessions/${id}/close`, {}, { token });
  const manifest = (reference: string, count: number) =>
    api.post("/api/v1/manifests", { reference, siteId, expectedPackageCount: count }, { token });

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    const reg = await api.post("/api/v1/auth/register", {
      name: "Chain owner",
      email: `${unique("c")}@example.test`,
      password: PASSWORD,
      companyName: "Chain Co",
    });
    assert.equal(reg.status, 201, reg.raw);
    token = reg.body.data.token;
    companyId = reg.body.data.memberships[0].companyId;
    siteId = (await api.post("/api/v1/sites", { name: "Dock", code: "D1" }, { token })).body.data.site.id;
    const cam = await api.post(`/api/v1/sites/${siteId}/cameras`, { name: "Bay cam", protocol: "RTSP", host: "192.0.2.10" }, { token });
    assert.equal(cam.status, 201, cam.raw);
    cameraId = cam.body.data.camera.id;
  });

  after(async () => {
    await server.close();
  });

  it("without monitoring, a session closes unverified and no number is invented", async () => {
    const m = (await manifest("CHAIN-0", 5)).body.data.manifest;
    const s = (await startSession({ siteId, manifestId: m.id, direction: "outbound" })).body.data.session;
    const closed = await closeSession(s.id);
    assert.equal(closed.status, 200, closed.raw);
    assert.equal(closed.body.data.session.reconciliationStatus, "closed_unverified");
    assert.equal(closed.body.data.session.observedCount, null);
  });

  it("monitoring cannot start before a zone is validated and enabled", async () => {
    const res = await api.post(`/api/v1/monitoring/cameras/${cameraId}/start`, {}, { token });
    assert.equal(res.status, 422, res.raw);
  });

  it("creates, validates and enables a counting line, then starts monitoring", async () => {
    const created = await api.post(
      "/api/v1/zones",
      {
        siteId,
        cameraId,
        name: "Bay line",
        zoneType: "counting_line",
        geometry: { coordinateSpace: "normalized_0_1", line: [[0.2, 0.5], [0.8, 0.5]] },
        rules: { objectClasses: ["box"], minimumConfidence: 0.5, countDirection: "EITHER", countOncePerTrackPerRule: true },
      },
      { token }
    );
    assert.equal(created.status, 201, created.raw);
    zoneId = created.body.data.zone.id;

    const validated = await api.post(`/api/v1/zones/${zoneId}/validate`, {}, { token });
    assert.equal(validated.body.data.passed, true, validated.raw);
    assert.equal((await api.post(`/api/v1/zones/${zoneId}/enable`, {}, { token })).status, 200);

    const started = await api.post(`/api/v1/monitoring/cameras/${cameraId}/start`, {}, { token });
    assert.equal(started.status, 200, started.raw);
  });

  it("counts worker crossings once per track and reconciles the session (100 vs 94 style mismatch)", async () => {
    const m = (await manifest("CHAIN-1", 10)).body.data.manifest;
    const s = (await startSession({ siteId, manifestId: m.id, direction: "outbound" })).body.data.session;

    // 4 distinct packages go OUT, one goes IN, one OUT track is reported twice, one is below the confidence floor
    for (const t of ["t1", "t2", "t3", "t4"]) {
      const r = await crossing(`${s.id}-${t}`, "OUT");
      assert.equal(r.status, 202, r.raw);
    }
    assert.equal((await crossing(`${s.id}-in1`, "IN")).status, 202);
    assert.equal((await crossing(`${s.id}-t1`, "OUT")).status, 202, "stored, but not counted again");
    const weak = await crossing(`${s.id}-weak`, "OUT", {
      track: { trackId: `${s.id}-weak`, class: "box", confidence: 0.2, bbox: [0.1, 0.1, 0.2, 0.2] },
    });
    assert.equal(weak.status, 202, weak.raw);

    // the same event key and payload again is a duplicate, a different payload is refused
    const key = unique("dup");
    const body = {
      eventKey: key, companyId, siteId, cameraId, zoneId, eventType: "package_line_crossing",
      occurredAt: new Date().toISOString(),
      track: { trackId: `${s.id}-d1`, class: "box", confidence: 0.9, bbox: [0.1, 0.1, 0.2, 0.2] },
      movement: { direction: "OUT", countDelta: 1 },
    };
    assert.equal((await api.post("/internal/v1/ai/events", body, { headers: SERVICE() })).status, 202);
    assert.equal((await api.post("/internal/v1/ai/events", body, { headers: SERVICE() })).status, 200);
    const changed = { ...body, track: { ...body.track, confidence: 0.8 } };
    assert.equal((await api.post("/internal/v1/ai/events", changed, { headers: SERVICE() })).status, 409);

    const closed = await closeSession(s.id);
    assert.equal(closed.status, 200, closed.raw);
    const r = closed.body.data.session;
    assert.equal(r.observedCount, 5, "t1..t4 plus d1; repeats and weak detections are not counted");
    assert.deepEqual(r.countsBreakdown, { in: 1, out: 5 });
    assert.equal(r.difference, -5);
    assert.equal(r.reconciliationStatus, "review_required");
    assert.ok(closed.body.data.mismatchEvent);

    const events = await api.get("/api/v1/events?eventType=count_mismatch", { token });
    assert.equal(events.body.data.items.filter((e: any) => e.id === closed.body.data.mismatchEvent.id).length, 1);
  });

  it("alert-type worker events reach the inbox; counting-only events do not", async () => {
    const before = (await api.get("/api/v1/events", { token })).body.data.items.length;

    const offlineKey = unique("off");
    const off = await api.post(
      "/internal/v1/ai/events",
      { eventKey: offlineKey, companyId, siteId, cameraId, eventType: "camera_offline", occurredAt: new Date().toISOString() },
      { headers: SERVICE() }
    );
    assert.equal(off.status, 202, off.raw);

    const afterAlert = (await api.get("/api/v1/events", { token })).body.data.items;
    assert.equal(afterAlert.length, before + 1);
    assert.ok(afterAlert.some((e: any) => e.eventType === "camera_offline"));

    assert.equal((await crossing(unique("trk"), "OUT")).status, 202);
    const afterCount = (await api.get("/api/v1/events", { token })).body.data.items;
    assert.equal(afterCount.length, afterAlert.length, "a plain crossing is ledger data, not an inbox event");
  });

  it("zones and monitoring follow the role table (QA-02): operators and auditors read, managers change", async () => {
    const member = async (role: string) => {
      const invite = await api.post("/api/v1/users/invitations", { email: `${unique("m")}@example.test`, role, siteIds: [siteId] }, { token });
      const accept = await api.post("/api/v1/auth/accept-invitation", { token: invite.body.data.token, name: role, password: PASSWORD });
      assert.equal(accept.status, 201, accept.raw);
      return accept.body.data.token as string;
    };
    const operator = await member("SECURITY_OPERATOR");
    const auditor = await member("AUDITOR");
    const manager = await member("WAREHOUSE_MANAGER");
    const newZone = {
      siteId, cameraId, name: "Second line", zoneType: "counting_line",
      geometry: { coordinateSpace: "normalized_0_1", line: [[0.1, 0.3], [0.9, 0.3]] },
      rules: { objectClasses: ["box"], minimumConfidence: 0.5, countDirection: "EITHER", countOncePerTrackPerRule: true },
    };
    for (const t of [operator, auditor]) {
      assert.equal((await api.get(`/api/v1/zones?siteId=${siteId}`, { token: t })).status, 200);
      assert.equal((await api.get(`/api/v1/monitoring/status?siteId=${siteId}`, { token: t })).status, 200);
      assert.equal((await api.post("/api/v1/zones", newZone, { token: t })).status, 403);
      assert.equal((await api.patch(`/api/v1/zones/${zoneId}`, { name: "renamed" }, { token: t })).status, 403);
      assert.equal((await api.post(`/api/v1/zones/${zoneId}/enable`, {}, { token: t })).status, 403);
      assert.equal((await api.post(`/api/v1/monitoring/cameras/${cameraId}/stop`, {}, { token: t })).status, 403);
    }
    assert.equal((await api.post("/api/v1/zones", newZone, { token: manager })).status, 201);
  });

  it("another company cannot post into this site or read its counts", async () => {
    const other = await api.post("/api/v1/auth/register", {
      name: "Other",
      email: `${unique("o")}@example.test`,
      password: PASSWORD,
      companyName: "Other Co",
    });
    const otherToken = other.body.data.token;
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + 3600_000).toISOString();
    const counts = await api.get(`/api/v1/counts/summary?siteId=${siteId}&from=${from}&to=${to}&groupBy=zone`, { token: otherToken });
    assert.equal(counts.status, 404);
    assert.equal((await api.post(`/api/v1/monitoring/cameras/${cameraId}/stop`, {}, { token: otherToken })).status, 404);
  });
});
