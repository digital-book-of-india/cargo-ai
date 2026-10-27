import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createClient, startTestServer, TestServer } from "./harness";

// P7: readiness, metrics, and the backup / restore round trip. Runs on throw-away databases.

let server: TestServer;
let api: ReturnType<typeof createClient>;
const SERVICE = () => ({ "x-service-token": process.env.AI_SERVICE_TOKEN ?? "dbi-ai-worker-secret-token" });
const PASSWORD = "Test@12345";

describe("operations (integration)", () => {
  let token = "";
  let companyId = "";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cargo-ai-backup-"));

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    const reg = await api.post("/api/v1/auth/register", { name: "Ops Owner", email: `ops${Date.now()}@example.test`, password: PASSWORD, companyName: "Ops Co" });
    token = reg.body.data.token;
    companyId = reg.body.data.memberships[0].companyId;
    const site = (await api.post("/api/v1/sites", { name: "Ops Site", code: "OPS" }, { token })).body.data.site;
    const cam = (await api.post(`/api/v1/sites/${site.id}/cameras`, { name: "C", protocol: "RTSP", host: "192.0.2.9" }, { token })).body.data.camera;
    await api.post(
      "/api/v1/ai/events",
      { eventKey: `ops-${Date.now()}`, siteId: site.id, cameraId: cam.id, eventType: "restricted_zone_movement", occurredAt: new Date(Date.now() - 4000).toISOString() },
      { headers: SERVICE() }
    );
  });

  after(async () => {
    await server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe("health and metrics", () => {
    it("liveness is always ok and readiness reports its checks", async () => {
      assert.equal((await api.get("/health")).status, 200);
      const ready = await api.get("/health/ready");
      assert.equal(ready.status, 200, ready.raw);
      assert.deepEqual(ready.body.data.checks, { database: true, evidenceStorage: true });
    });

    it("metrics need the service token", async () => {
      assert.equal((await api.get("/internal/v1/metrics")).status, 401);
      assert.equal((await api.get("/internal/v1/metrics", { token })).status, 401, "a user token is not a service token");
      const res = await fetch(`${server.baseUrl}/internal/v1/metrics`, { headers: SERVICE() });
      assert.equal(res.status, 200);
      assert.match(res.headers.get("content-type") ?? "", /text\/plain/);
      const text = await res.text();
      assert.match(text, /cargosense_db_connected 1/);
      assert.match(text, /cargosense_events_last_15m [1-9]/);
      assert.match(text, /cargosense_http_requests_total\{method="POST",route="\/api\/v1\/sites",status="2xx"\}/);
    });

    it("event lag reflects how late an event reached the database", async () => {
      const json = await api.get("/internal/v1/metrics?format=json", { headers: SERVICE() });
      assert.equal(json.status, 200);
      const g = json.body.data.gauges;
      assert.ok(g.eventLagMaxSeconds >= 3, `the test event was 4s old, lag was ${g.eventLagMaxSeconds}`);
      assert.equal(typeof g.notificationsPending, "number");
    });
  });

  describe("backup and restore", () => {
    const restoreUri = () => {
      const url = new URL(process.env.MONGODB_URI!);
      url.pathname = "/cargo_ai_restore_test";
      return url.toString();
    };

    it("round-trips every collection into an empty database with types preserved", async () => {
      const mongoose = (await import("mongoose")).default;
      const { backupDatabase, restoreDatabase } = await import("../ops/snapshot");
      const dir = path.join(tmp, "b1");
      const manifest = await backupDatabase(mongoose.connection.db!, dir);
      assert.ok(manifest.collections.length >= 5);
      assert.ok(manifest.collections.every((c) => /^[a-f0-9]{64}$/.test(c.sha256)));

      const other = mongoose.createConnection(restoreUri());
      await other.asPromise();
      try {
        await other.dropDatabase();
        const result = await restoreDatabase(other.db!, dir);
        assert.equal(result.collections, manifest.collections.length);
        for (const c of manifest.collections) {
          assert.equal(await other.db!.collection(c.name).countDocuments(), c.documents, c.name);
        }
        const original = await mongoose.connection.db!.collection("cargo_events").findOne({});
        const restored = await other.db!.collection("cargo_events").findOne({ _id: original!._id });
        assert.ok(restored, "same _id");
        assert.ok(restored!.companyId instanceof mongoose.Types.ObjectId, "ObjectId stays an ObjectId");
        assert.ok(restored!.occurredAt instanceof Date, "Date stays a Date");
        assert.deepEqual(restored!.payload, original!.payload);
        const co = await other.db!.collection("companies").findOne({ _id: new mongoose.Types.ObjectId(companyId) });
        assert.equal(co!.name, "Ops Co");

        // restoring again onto data is refused unless replace is chosen
        await assert.rejects(() => restoreDatabase(other.db!, dir), /already has data/);
        const again = await restoreDatabase(other.db!, dir, { replace: true });
        assert.equal(again.collections, manifest.collections.length);
      } finally {
        await other.dropDatabase();
        await other.close();
      }
    });

    it("refuses a damaged backup before writing anything", async () => {
      const mongoose = (await import("mongoose")).default;
      const { backupDatabase, restoreDatabase } = await import("../ops/snapshot");
      const dir = path.join(tmp, "b2");
      const manifest = await backupDatabase(mongoose.connection.db!, dir);
      const victim = manifest.collections.find((c) => c.documents > 0)!;
      fs.appendFileSync(path.join(dir, `${victim.name}.ejson`), "tampered\n");

      const other = mongoose.createConnection(restoreUri());
      await other.asPromise();
      try {
        await assert.rejects(() => restoreDatabase(other.db!, dir), /damaged/);
        assert.equal((await other.db!.listCollections().toArray()).length, 0, "nothing was written");
      } finally {
        await other.dropDatabase();
        await other.close();
      }
    });

    it("refuses a folder that is not a backup and a backup folder that is not empty", async () => {
      const mongoose = (await import("mongoose")).default;
      const { backupDatabase, restoreDatabase } = await import("../ops/snapshot");
      await assert.rejects(() => restoreDatabase(mongoose.connection.db!, tmp), /not a backup folder/);
      await assert.rejects(() => backupDatabase(mongoose.connection.db!, path.join(tmp, "b1")), /not empty/);
    });
  });
});
