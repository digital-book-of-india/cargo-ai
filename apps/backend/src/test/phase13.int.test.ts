import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import net from "net";
import jwt from "jsonwebtoken";
import { createClient, startTestServer, TestServer } from "./harness";

// Phase 13: sessions, camera addresses, encrypted camera secrets, evidence links, audit.

let server: TestServer;
let api: ReturnType<typeof createClient>;

const PASSWORD = "Test@12345";
let counter = 0;
const unique = (p: string) => `${p}${Date.now()}${counter++}`;
const SERVICE = () => ({ "x-service-token": process.env.AI_SERVICE_TOKEN ?? "dbi-dev-ai-service-token-change-me-0123456789" });

interface Actor {
  token: string;
  userId: string;
  companyId: string;
  email: string;
}

async function register(name: string): Promise<Actor> {
  const email = `${unique("o")}@example.test`;
  const res = await api.post("/api/v1/auth/register", { name: `${name} owner`, email, password: PASSWORD, companyName: name });
  assert.equal(res.status, 201, res.raw);
  return { token: res.body.data.token, userId: res.body.data.user.id, companyId: res.body.data.memberships[0].companyId, email };
}

describe("phase 13: security hardening (integration)", () => {
  let a: Actor;
  let siteA: string;
  let cameraA: string;

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    a = await register("P13 A");
    siteA = (await api.post("/api/v1/sites", { name: "A1", code: "A1" }, { token: a.token })).body.data.site.id;
    cameraA = (await api.post(`/api/v1/sites/${siteA}/cameras`, { name: "Cam A", protocol: "RTSP", host: "192.0.2.71" }, { token: a.token })).body.data.camera.id;
  });

  after(async () => {
    await server.close();
  });

  describe("13.1 camera addresses", () => {
    it("the host policy refuses the addresses it must (unit)", async () => {
      const { addressBlockReason, isValidHostFormat } = await import("../services/cameras/hostPolicy");
      const production = { allowPrivate: false, allowLoopback: false };
      const development = { allowPrivate: true, allowLoopback: true };
      const always = ["169.254.169.254", "169.254.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "fe80::1", "ff02::1", "::", "::ffff:169.254.169.254"];
      for (const ip of always) {
        assert.ok(addressBlockReason(ip, production), `${ip} refused in production`);
        assert.ok(addressBlockReason(ip, development), `${ip} refused even in development`);
      }
      const inside = ["127.0.0.1", "127.5.5.5", "::1", "10.0.0.5", "172.16.0.1", "172.31.255.1", "192.168.1.20", "100.64.0.1", "fd00::1", "::ffff:10.0.0.1", "::ffff:7f00:1"];
      for (const ip of inside) {
        assert.ok(addressBlockReason(ip, production), `${ip} refused in production`);
        assert.equal(addressBlockReason(ip, development), null, `${ip} allowed in development`);
      }
      assert.equal(addressBlockReason("127.0.0.1", { allowPrivate: true, allowLoopback: false }), "loopback address", "private allowed does not allow loopback");
      assert.equal(addressBlockReason("192.168.1.20", { allowPrivate: true, allowLoopback: false }), null, "an on-site install can allow private cameras");
      for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.1", "192.0.2.10", "100.63.0.1", "2001:4860:4860::8888"]) {
        assert.equal(addressBlockReason(ip, production), null, `${ip} is a public address`);
      }
      assert.equal(isValidHostFormat("camera-1.example.com"), true);
      for (const bad of ["http://evil.example", "a b", "cam/../x", "user@host", "host:554", "", "-bad.example", "a".repeat(260)]) {
        assert.equal(isValidHostFormat(bad), false, `${JSON.stringify(bad.slice(0, 20))} is not a host`);
      }
    });

    it("registering or changing a camera with a refused address answers 400", async () => {
      for (const host of ["169.254.169.254", "http://evil.example", "user@10.0.0.1"]) {
        const res = await api.post(`/api/v1/sites/${siteA}/cameras`, { name: unique("bad"), protocol: "RTSP", host }, { token: a.token });
        assert.equal(res.status, 400, `${host}: ${res.raw}`);
      }
      const patch = await api.patch(`/api/v1/cameras/${cameraA}`, { host: "169.254.169.254" }, { token: a.token });
      assert.equal(patch.status, 400, patch.raw);
      const tooLong = await api.post(`/api/v1/sites/${siteA}/cameras`, { name: "x".repeat(200), protocol: "RTSP", host: "192.0.2.72" }, { token: a.token });
      assert.equal(tooLong.status, 400, "a camera name has a maximum length");
    });

    it("a camera test is checked again at connect time, and a TCP answer is not 'online'", async () => {
      // the test server only accepts the connection: it sends no video
      const listener = net.createServer((s) => s.destroy());
      await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
      const port = (listener.address() as net.AddressInfo).port;
      try {
        const created = await api.post(`/api/v1/sites/${siteA}/cameras`, { name: unique("tcp"), protocol: "RTSP", host: "127.0.0.1", port }, { token: a.token });
        assert.equal(created.status, 201, created.raw);
        const id = created.body.data.camera.id as string;
        const tested = await api.post(`/api/v1/cameras/${id}/test`, {}, { token: a.token });
        assert.equal(tested.status, 200, tested.raw);
        const cam = tested.body.data.camera;
        assert.equal(cam.lastFrameAt, null, "a connection is not a video frame");
        assert.notEqual(cam.effectiveStatus, "ONLINE", "reachable but no video: never shown as online");

        // the stored address is changed behind the API's back to a refused one: the test must not connect
        const { CameraModel } = await import("../models");
        const { encryptSecret } = await import("../services/secrets/manager");
        await CameraModel.updateOne({ _id: id }, { $set: { secretRef: encryptSecret("rtsp://169.254.169.254:554/stream1") } });
        const blocked = await api.post(`/api/v1/cameras/${id}/test`, {}, { token: a.token });
        assert.equal(blocked.status, 200, blocked.raw);
        assert.equal(blocked.body.data.camera.lastErrorCode, "ADDRESS_NOT_ALLOWED");
        assert.equal(blocked.body.data.camera.status, "ERROR");
      } finally {
        listener.close();
      }
    });
  });

  describe("13.3 sessions and sign-in", () => {
    it("a sign-in lasts 12 hours, not a week", async () => {
      const decoded = jwt.decode(a.token) as { iat: number; exp: number };
      assert.equal(decoded.exp - decoded.iat, 12 * 3600);
    });

    it("signing out ends the session at once, even for a copy of the token", async () => {
      const u = await register("P13 logout");
      assert.equal((await api.get("/api/v1/auth/me", { token: u.token })).status, 200);
      assert.equal((await api.post("/api/v1/auth/logout", {}, { token: u.token })).status, 200);
      const after = await api.get("/api/v1/auth/me", { token: u.token });
      assert.equal(after.status, 401, after.raw);
      // signing in again works and gives a token that is valid
      const login = await api.post("/api/v1/auth/login", { email: u.email, password: PASSWORD });
      assert.equal(login.status, 200, login.raw);
      assert.equal((await api.get("/api/v1/auth/me", { token: login.body.data.token })).status, 200);
    });

    it("a token from before versions existed keeps working until it expires", async () => {
      const u = await register("P13 old token");
      const { signAccessToken } = await import("../utils/auth");
      const old = signAccessToken({ id: u.userId, email: u.email, role: "USER" }); // no version field, like a token issued earlier
      assert.equal((await api.get("/api/v1/auth/me", { token: old })).status, 200);
    });

    it("a suspended account stops working at once, with the same token", async () => {
      const u = await register("P13 suspend");
      assert.equal((await api.get("/api/v1/auth/me", { token: u.token })).status, 200);
      const { UserModel } = await import("../models");
      await UserModel.updateOne({ _id: u.userId }, { $set: { status: "SUSPENDED" } });
      const res = await api.get("/api/v1/auth/me", { token: u.token });
      assert.equal(res.status, 403, res.raw);
      assert.equal(res.body.error.code, "ACCOUNT_SUSPENDED");
    });

    it("an account locks after five wrong passwords, and unlocks when the lock ends", async () => {
      const u = await register("P13 lock");
      for (let i = 0; i < 5; i++) {
        const bad = await api.post("/api/v1/auth/login", { email: u.email, password: "Wrong-password-1" });
        assert.equal(bad.status, 401, `attempt ${i + 1}: ${bad.raw}`);
      }
      const locked = await api.post("/api/v1/auth/login", { email: u.email, password: PASSWORD });
      assert.equal(locked.status, 429, "even the right password is refused while locked: " + locked.raw);

      const { UserModel } = await import("../models");
      await UserModel.updateOne({ _id: u.userId }, { $set: { lockedUntil: new Date(Date.now() - 1000) } });
      const ok = await api.post("/api/v1/auth/login", { email: u.email, password: PASSWORD });
      assert.equal(ok.status, 200, ok.raw);
      const row = await UserModel.findById(u.userId).lean();
      assert.equal(row?.failedLogins, 0, "a good sign-in resets the counter");
      assert.equal(row?.lockedUntil, null);
    });

    it("a wrong password never reveals that an account is suspended, and an unknown email looks the same", async () => {
      const u = await register("P13 suspended login");
      const { UserModel } = await import("../models");
      await UserModel.updateOne({ _id: u.userId }, { $set: { status: "SUSPENDED" } });
      const wrong = await api.post("/api/v1/auth/login", { email: u.email, password: "Wrong-password-1" });
      assert.equal(wrong.status, 401, "wrong password: nothing about the account is revealed");
      assert.equal(wrong.body.error.message, "Invalid email or password.");
      const unknown = await api.post("/api/v1/auth/login", { email: `${unique("nobody")}@example.test`, password: "Wrong-password-1" });
      assert.equal(unknown.status, 401);
      assert.equal(unknown.body.error.message, wrong.body.error.message);
      const right = await api.post("/api/v1/auth/login", { email: u.email, password: PASSWORD });
      assert.equal(right.status, 403, "only with the right password is the suspension shown");
    });

    it("two registrations of one email at the same moment give 201 and 409, never 500", async () => {
      const email = `${unique("race")}@example.test`;
      const body = { name: "Racer", email, password: PASSWORD, companyName: "Race Co" };
      const results = await Promise.all([api.post("/api/v1/auth/register", body), api.post("/api/v1/auth/register", { ...body, companyName: "Race Co 2" })]);
      assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], results.map((r) => r.raw).join(" | "));
    });

    it("the platform admin routes use the same session check: the cookie works, and the role comes from the database", async () => {
      const { UserModel } = await import("../models");
      const { hashPassword } = await import("../utils/auth");
      const email = `${unique("admin")}@example.test`;
      const admin = await UserModel.create({ name: "P13 Admin", email, passwordHash: await hashPassword(PASSWORD), role: "PLATFORM_ADMIN", status: "ACTIVE" });
      const login = await api.post("/api/v1/auth/login", { email, password: PASSWORD });
      assert.equal(login.status, 200, login.raw);
      const token = login.body.data.token as string;

      assert.equal((await api.get("/api/v1/admin/overview", { token })).status, 200, "Bearer header");
      const viaCookie = await api.get("/api/v1/admin/overview", { headers: { Cookie: `cargosense_admin=${token}` } });
      assert.equal(viaCookie.status, 200, "the httpOnly admin cookie, which the admin panel uses: " + viaCookie.raw);

      await UserModel.updateOne({ _id: admin._id }, { $set: { role: "USER" } });
      assert.equal((await api.get("/api/v1/admin/overview", { token })).status, 403, "the role in the token no longer counts once the database says otherwise");

      await UserModel.updateOne({ _id: admin._id }, { $set: { role: "PLATFORM_ADMIN" }, $inc: { tokenVersion: 1 } });
      assert.equal((await api.get("/api/v1/admin/overview", { token })).status, 401, "a signed-out token is refused by the admin routes too");
    });

    it("a request id from a client is kept only when it is short and plain", async () => {
      const send = async (id: string) => (await fetch(`${server.baseUrl}/health`, { headers: { "x-request-id": id } })).headers.get("x-request-id");
      assert.equal(await send("client-trace-1234"), "client-trace-1234");
      for (const bad of ["x".repeat(200), "has spaces in it", "short", 'quote"inside-it-here', "<script>alert(1)</script>"]) {
        const got = await send(bad);
        assert.notEqual(got, bad);
        assert.match(String(got), /^req_[0-9a-f-]{36}$/);
      }
    });
  });

  describe("13.4 camera secrets", () => {
    it("new secrets are authenticated (AES-GCM); a changed value is refused; old values can still be read; plain text is not trusted", async () => {
      const { encryptSecret, decryptSecret, isLegacySecret } = await import("../services/secrets/manager");
      const { env } = await import("../config/env");
      const plain = "rtsp://admin:s3cret@192.0.2.9:554/stream1";
      const sealed = encryptSecret(plain);
      assert.ok(sealed.startsWith("v2:"));
      assert.equal(decryptSecret(sealed), plain);
      assert.notEqual(encryptSecret(plain), sealed, "a fresh random IV every time");

      const last = sealed.slice(-1);
      assert.equal(decryptSecret(sealed.slice(0, -1) + (last === "0" ? "1" : "0")), "", "a flipped bit is detected");
      assert.equal(decryptSecret(sealed.slice(0, -4)), "", "a truncated value is refused");

      // an old CBC value, built the way the old code did it
      const key = crypto.createHash("sha256").update(env.cameraSecretEncryptionKey).digest();
      const iv = crypto.randomBytes(16);
      const c = crypto.createCipheriv("aes-256-cbc", key, iv);
      const legacy = `${iv.toString("hex")}:${c.update(plain, "utf8", "hex") + c.final("hex")}`;
      assert.equal(isLegacySecret(legacy), true);
      assert.equal(decryptSecret(legacy), plain);

      assert.equal(decryptSecret("rtsp://admin:pw@192.0.2.9/stream"), "", "plain text is never passed through as if it were decrypted");
      assert.equal(decryptSecret("no-colon-at-all"), "");
      assert.equal(decryptSecret(""), "");
    });

    it("migration 20261101-105 re-encrypts old secrets, leaves unreadable ones alone, and runs twice", async () => {
      const mongoose = (await import("mongoose")).default;
      const { cameraSecretsGcm } = await import("../migrations/20261101-105-camera-secrets-gcm");
      const { decryptSecret } = await import("../services/secrets/manager");
      const { env } = await import("../config/env");
      const db = mongoose.connection.db!;
      const plain = "rtsp://u:p@192.0.2.10:554/s";
      const key = crypto.createHash("sha256").update(env.cameraSecretEncryptionKey).digest();
      const iv = crypto.randomBytes(16);
      const c = crypto.createCipheriv("aes-256-cbc", key, iv);
      const legacy = `${iv.toString("hex")}:${c.update(plain, "utf8", "hex") + c.final("hex")}`;
      const junk = `${"ab".repeat(16)}:${"cd".repeat(16)}`; // looks like the old format but is not ours
      const base = { companyId: new mongoose.Types.ObjectId(), siteId: new mongoose.Types.ObjectId(), protocol: "RTSP", status: "PENDING_TEST", createdAt: new Date() };
      const good = await db.collection("cameras").insertOne({ ...base, name: unique("g"), secretRef: legacy });
      const bad = await db.collection("cameras").insertOne({ ...base, name: unique("b"), secretRef: junk });

      await cameraSecretsGcm.up(db);
      await cameraSecretsGcm.up(db);
      const converted = (await db.collection("cameras").findOne({ _id: good.insertedId }))!.secretRef as string;
      assert.ok(converted.startsWith("v2:"));
      assert.equal(decryptSecret(converted), plain);
      assert.equal((await db.collection("cameras").findOne({ _id: bad.insertedId }))!.secretRef, junk, "an unreadable value is never overwritten");
    });
  });

  describe("13.5 evidence links", () => {
    // an event of company A with a stored picture
    const eventWithPicture = async (): Promise<string> => {
      const { createCargoEvent } = await import("../services/events/createEvent");
      const { getEvidenceStorage } = await import("../services/evidence/storage");
      const key = `${a.companyId}/${siteA}/2026/10/${unique("p")}.jpg`;
      await getEvidenceStorage().put(key, Buffer.from("fake jpeg bytes"));
      const { event } = await createCargoEvent({
        eventKey: unique("ev"),
        siteId: siteA,
        cameraId: cameraA,
        eventType: "restricted_zone_movement",
        occurredAt: new Date(),
        evidence: { snapshotObjectKey: key },
      });
      return event._id.toString();
    };

    it("a link stops working when the person it was issued to loses access", async () => {
      const eventId = await eventWithPicture();
      // an operator for site A
      const invite = await api.post("/api/v1/users/invitations", { email: `${unique("op")}@example.test`, role: "SECURITY_OPERATOR", siteIds: [siteA] }, { token: a.token });
      assert.equal(invite.status, 201, invite.raw);
      const accepted = await api.post("/api/v1/auth/accept-invitation", { token: invite.body.data.token, name: "Op", password: PASSWORD });
      assert.equal(accepted.status, 201, accepted.raw);
      const operator = { token: accepted.body.data.token as string, userId: accepted.body.data.user.id as string };

      const detail = await api.get(`/api/v1/events/${eventId}`, { token: operator.token });
      assert.equal(detail.status, 200, detail.raw);
      const path = detail.body.data.event.evidence.snapshotUrl as string;
      assert.ok(path, "the operator gets a signed link");
      assert.equal((await fetch(server.baseUrl + path)).status, 200, "the link works while the operator has access");

      assert.equal((await api.patch(`/api/v1/users/${operator.userId}/status`, { status: "DISABLED" }, { token: a.token })).status, 200);
      assert.equal((await fetch(server.baseUrl + path)).status, 401, "the same link is refused once the operator is disabled");
    });

    it("a sign-in token cannot be used as an evidence link, and a link has its own audience", async () => {
      const eventId = await eventWithPicture();
      const { env } = await import("../config/env");
      const asSignIn = jwt.sign({ eventId, kind: "snapshot", cid: a.companyId, uid: a.userId }, env.jwtAccessSecret, { expiresIn: 60 });
      assert.equal((await fetch(`${server.baseUrl}/api/v1/evidence/${eventId}/snapshot?token=${asSignIn}`)).status, 401);
      const detail = await api.get(`/api/v1/events/${eventId}`, { token: a.token });
      const real = detail.body.data.event.evidence.snapshotUrl as string;
      assert.equal((await fetch(server.baseUrl + real)).status, 200, "the real link works");
      const token = new URL(server.baseUrl + real).searchParams.get("token")!;
      // and the evidence token is useless as a sign-in token
      assert.equal((await api.get("/api/v1/auth/me", { token })).status, 401);
    });

    it("a support link is audited first, works while the administrator is one, and fails if the audit cannot be written", async () => {
      const eventId = await eventWithPicture();
      const { UserModel, AuditLogModel } = await import("../models");
      const { hashPassword } = await import("../utils/auth");
      const email = `${unique("sup")}@example.test`;
      const admin = await UserModel.create({ name: "P13 Support", email, passwordHash: await hashPassword(PASSWORD), role: "PLATFORM_ADMIN", status: "ACTIVE" });
      const token = (await api.post("/api/v1/auth/login", { email, password: PASSWORD })).body.data.token as string;
      const grant = (reason = "Checking a customer ticket about a missing picture") =>
        api.post("/api/v1/admin/support/evidence-link", { eventId, kind: "snapshot", reason }, { token });

      const ok = await grant();
      assert.equal(ok.status, 200, ok.raw);
      const link = ok.body.data.url as string;
      assert.equal((await fetch(server.baseUrl + link)).status, 200);
      assert.ok(await AuditLogModel.findOne({ action: "SUPPORT_EVIDENCE_ACCESS_GRANTED", targetId: eventId, actorUserId: admin._id }), "the grant is in the audit trail");

      // if the audit entry cannot be written, no link is issued
      const original = AuditLogModel.create.bind(AuditLogModel);
      (AuditLogModel as any).create = async () => {
        throw new Error("audit store is down");
      };
      let failed;
      try {
        failed = await grant("Second request while the audit store is down");
      } finally {
        (AuditLogModel as any).create = original;
      }
      assert.equal(failed.status, 500, failed.raw);
      assert.equal(failed.body.data, undefined, "no link was issued");

      // once the administrator is demoted, the link already handed out stops working
      await UserModel.updateOne({ _id: admin._id }, { $set: { role: "USER" } });
      assert.equal((await fetch(server.baseUrl + link)).status, 401);
    });
  });

  describe("13.6 and 13.7 audit", () => {
    it("the AI worker reading a camera's credentials is audited once per hour per camera", async () => {
      const { AuditLogModel } = await import("../models");
      const read = () => fetch(`${server.baseUrl}/internal/v1/cameras/${cameraA}/stream-config`, { headers: SERVICE() });
      assert.equal((await read()).status, 200);
      assert.equal((await read()).status, 200);
      const entries = await AuditLogModel.find({ action: "CAMERA_CREDENTIALS_READ", targetId: cameraA }).lean();
      assert.equal(entries.length, 1, "one entry, not one per request");
      assert.equal(entries[0].actorUserId, null, "the actor is the system, not a person");
      assert.equal(String(entries[0].companyId), a.companyId, "the entry is in the owning company's own trail");

      // the company's audit screen shows it as a system action
      const list = await api.get("/api/v1/audit-logs?limit=100", { token: a.token });
      assert.equal(list.status, 200, list.raw);
      const row = list.body.data.items.find((i: any) => i.action === "CAMERA_CREDENTIALS_READ");
      assert.equal(row?.actor.name, "System");
    });

    it("zone, monitoring and camera-test actions are in the audit trail", async () => {
      const { AuditLogModel } = await import("../models");
      const cam = (await api.post(`/api/v1/sites/${siteA}/cameras`, { name: unique("aud"), protocol: "RTSP", host: "192.0.2.73" }, { token: a.token })).body.data.camera.id as string;
      const zone = await api.post(
        "/api/v1/zones",
        {
          siteId: siteA, cameraId: cam, name: "Audit line", zoneType: "counting_line",
          geometry: { coordinateSpace: "normalized_0_1", line: [[0.2, 0.5], [0.8, 0.5]] },
          rules: { objectClasses: ["box"], minimumConfidence: 0.5, countDirection: "EITHER", countOncePerTrackPerRule: true },
        },
        { token: a.token }
      );
      const zoneId = zone.body.data.zone.id as string;
      await api.patch(`/api/v1/zones/${zoneId}`, { name: "Audit line 2" }, { token: a.token });
      await api.post(`/api/v1/zones/${zoneId}/validate`, {}, { token: a.token });
      await api.post(`/api/v1/zones/${zoneId}/enable`, {}, { token: a.token });
      await api.post(`/api/v1/monitoring/cameras/${cam}/start`, {}, { token: a.token });
      await api.post(`/api/v1/monitoring/cameras/${cam}/stop`, {}, { token: a.token });
      const listener = net.createServer((s) => s.destroy());
      await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
      try {
        const port = (listener.address() as net.AddressInfo).port;
        const c2 = (await api.post(`/api/v1/sites/${siteA}/cameras`, { name: unique("t"), protocol: "RTSP", host: "127.0.0.1", port }, { token: a.token })).body.data.camera.id as string;
        await api.post(`/api/v1/cameras/${c2}/test`, {}, { token: a.token });
        assert.ok(await AuditLogModel.findOne({ action: "CAMERA_TESTED", targetId: c2 }));
      } finally {
        listener.close();
      }
      for (const [action, target] of [["ZONE_CREATED", zoneId], ["ZONE_UPDATED", zoneId], ["ZONE_VALIDATED", zoneId], ["ZONE_ENABLED", zoneId], ["MONITORING_STARTED", cam], ["MONITORING_STOPPED", cam]]) {
        assert.ok(await AuditLogModel.findOne({ action, targetId: target }), `${action} is audited`);
      }
    });
  });

  describe("13.8 smaller items", () => {
    it("the seed refuses to run outside development and test", async () => {
      const { env } = await import("../config/env");
      assert.equal(env.isProduction, false, "this test process runs as NODE_ENV=test");
      const source = (await import("fs")).readFileSync(require("path").join(__dirname, "../seeds/seed.ts"), "utf8");
      assert.match(source, /if \(env\.isProduction\)[\s\S]{0,200}process\.exit\(1\)/, "the seed checks the environment before touching the database");
    });
  });
});
