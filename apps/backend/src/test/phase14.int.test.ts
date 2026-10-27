import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer } from "./harness";

// Phase 14: operations and speed.

let server: TestServer;
let api: ReturnType<typeof createClient>;

const PASSWORD = "Test@12345";
let counter = 0;
const unique = (p: string) => `${p}${Date.now()}${counter++}`;
const SERVICE = () => ({ "x-service-token": process.env.AI_SERVICE_TOKEN ?? "dbi-dev-ai-service-token-change-me-0123456789" });

describe("phase 14: operations and speed (integration)", () => {
  let ownerToken: string;
  let adminToken: string;
  let siteId: string;
  let cameraId: string;

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    const reg = await api.post("/api/v1/auth/register", { name: "P14", email: `${unique("o")}@example.test`, password: PASSWORD, companyName: "P14 Co" });
    ownerToken = reg.body.data.token;
    siteId = (await api.post("/api/v1/sites", { name: "S", code: "S1" }, { token: ownerToken })).body.data.site.id;
    cameraId = (await api.post(`/api/v1/sites/${siteId}/cameras`, { name: "C", protocol: "RTSP", host: "192.0.2.81" }, { token: ownerToken })).body.data.camera.id;

    const { UserModel } = await import("../models");
    const { hashPassword } = await import("../utils/auth");
    const email = `${unique("adm")}@example.test`;
    await UserModel.create({ name: "P14 Admin", email, passwordHash: await hashPassword(PASSWORD), role: "PLATFORM_ADMIN", status: "ACTIVE" });
    adminToken = (await api.post("/api/v1/auth/login", { email, password: PASSWORD })).body.data.token;
  });

  after(async () => {
    await server.close();
  });

  it("a list answer is compressed when the client accepts it", async () => {
    const { createCargoEvent } = await import("../services/events/createEvent");
    for (let i = 0; i < 25; i++) {
      await createCargoEvent({ eventKey: unique("ev"), siteId, cameraId, eventType: "restricted_zone_movement", occurredAt: new Date() });
    }
    const res = await fetch(`${server.baseUrl}/api/v1/events?limit=100`, { headers: { Authorization: `Bearer ${ownerToken}`, "Accept-Encoding": "gzip" } });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-encoding"), "gzip");
    const body = (await res.json()) as { data: { items: unknown[] } };
    assert.ok(body.data.items.length >= 25, "and it still reads back as normal JSON");
  });

  it("the platform overview counts online cameras in the database by the same rule as before", async () => {
    const mongoose = (await import("mongoose")).default;
    const { env } = await import("../config/env");
    const kpis = async () => (await api.get("/api/v1/admin/overview", { token: adminToken })).body.data.kpis as { totalCameras: number; onlineCameras: number };
    const before = await kpis();

    const now = Date.now();
    const fresh = new Date(now - 5_000);
    const stale = new Date(now - (env.cameraStaleSeconds + 600) * 1000);
    const base = { companyId: new mongoose.Types.ObjectId(), siteId: new mongoose.Types.ObjectId(), protocol: "RTSP", createdAt: new Date() };
    await mongoose.connection.db!.collection("cameras").insertMany([
      { ...base, name: unique("on"), secretRef: "x", status: "ONLINE", lastHealthAt: fresh, lastFrameAt: fresh }, // online
      { ...base, name: unique("st"), secretRef: "x", status: "ONLINE", lastHealthAt: stale, lastFrameAt: stale }, // stale: not online
      { ...base, name: unique("er"), secretRef: "x", status: "ERROR", lastHealthAt: fresh, lastFrameAt: fresh }, // error: not online
      { ...base, name: unique("nf"), secretRef: "x", status: "ONLINE", lastHealthAt: fresh, lastFrameAt: null }, // answers, no frames: not online
      { ...base, name: unique("pt"), secretRef: "x", status: "PENDING_TEST", lastHealthAt: fresh, lastFrameAt: fresh }, // never tested: not online
    ]);

    const afterInsert = await kpis();
    assert.equal(afterInsert.totalCameras - before.totalCameras, 5);
    assert.equal(afterInsert.onlineCameras - before.onlineCameras, 1, "only the fresh, healthy camera with frames counts as online");
  });

  it("the metrics endpoint serves the request-time histogram", async () => {
    await api.get("/api/v1/sites", { token: ownerToken }); // make sure at least one request is timed
    const res = await fetch(`${server.baseUrl}/internal/v1/metrics`, { headers: SERVICE() });
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.match(text, /# TYPE cargosense_http_request_duration_seconds histogram/);
    assert.match(text, /cargosense_http_request_duration_seconds_bucket\{le="0\.5"\} \d+/);
    assert.match(text, /cargosense_http_request_duration_seconds_bucket\{le="\+Inf"\} \d+/);
    assert.match(text, /cargosense_http_route_duration_seconds_count\{route="GET \/api\/v1\/sites"\} \d+/);
  });
});
