import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startTestServer, TestServer } from "./harness";

// Migration 20261101-101: sessions move from the old camera-zone model to vision zones.

let server: TestServer;

describe("migration: sessions on vision zones (integration)", () => {
  before(async () => {
    server = await startTestServer();
  });
  after(async () => {
    await server.close();
  });

  it("parks old zone ids, keeps vision zone ids, runs twice safely and goes back", async () => {
    const mongoose = (await import("mongoose")).default;
    const { sessionsOnVisionZones } = await import("../migrations/20261101-101-sessions-on-vision-zones");
    const db = mongoose.connection.db!;
    const oid = () => new mongoose.Types.ObjectId();

    const visionZoneId = oid();
    const legacyZoneId = oid();
    await db.collection("vision_zones").insertOne({ _id: visionZoneId, name: "Line" });

    const company = oid();
    const site = oid();
    const base = { companyId: company, siteId: site, direction: "outbound", startedAt: new Date(), closedAt: null };
    const withVision = await db.collection("cargo_loading_sessions").insertOne({ ...base, zoneId: visionZoneId });
    const withLegacy = await db.collection("cargo_loading_sessions").insertOne({ ...base, direction: "inbound", zoneId: legacyZoneId });
    const withoutZone = await db.collection("cargo_loading_sessions").insertOne({ ...base, zoneId: null });
    const load = (id: unknown) => db.collection("cargo_loading_sessions").findOne({ _id: id as never });

    await sessionsOnVisionZones.up(db);
    await sessionsOnVisionZones.up(db); // safe to run twice

    assert.equal(String((await load(withVision.insertedId))!.zoneId), String(visionZoneId), "a vision zone id is kept");
    const parked = (await load(withLegacy.insertedId))!;
    assert.equal(parked.zoneId, null, "an old zone id is removed from the session");
    assert.equal(String(parked.legacyZoneId), String(legacyZoneId), "and kept so it can be restored");
    assert.equal((await load(withoutZone.insertedId))!.zoneId, null);

    const index = (await db.collection("cargo_loading_sessions").indexes()).find((i) => i.name === "companyId_1_zoneId_1_direction_1");
    assert.ok(index?.unique, "one open session per line and direction is enforced by the database");

    await sessionsOnVisionZones.down(db);
    const restored = (await load(withLegacy.insertedId))!;
    assert.equal(String(restored.zoneId), String(legacyZoneId), "down puts the old id back");
    assert.equal(restored.legacyZoneId, undefined);
    assert.equal(String((await load(withVision.insertedId))!.zoneId), String(visionZoneId));
  });
});
