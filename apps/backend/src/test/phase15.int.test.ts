import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer } from "./harness";

// Phase 15 (backend side): the platform-admin panel has its own session.

let server: TestServer;
let api: ReturnType<typeof createClient>;

const PASSWORD = "Test@12345";
let counter = 0;
const unique = (p: string) => `${p}${Date.now()}${counter++}`;

const post = (path: string, body: unknown, cookie?: string) =>
  fetch(server.baseUrl + path, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const get = (path: string, cookie?: string) => fetch(server.baseUrl + path, { headers: cookie ? { Cookie: cookie } : {} });
const cookieValue = (res: Response, name: string): string | undefined => {
  const line = res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line?.split(";")[0].slice(name.length + 1);
};

describe("phase 15: the platform-admin panel has its own session (integration)", () => {
  let adminEmail: string;
  let ownerEmail: string;
  let ownerToken: string;

  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
    const { UserModel } = await import("../models");
    const { hashPassword } = await import("../utils/auth");
    adminEmail = `${unique("adm")}@example.test`;
    await UserModel.create({ name: "P15 Admin", email: adminEmail, passwordHash: await hashPassword(PASSWORD), role: "PLATFORM_ADMIN", status: "ACTIVE" });
    ownerEmail = `${unique("own")}@example.test`;
    const reg = await api.post("/api/v1/auth/register", { name: "P15 Owner", email: ownerEmail, password: PASSWORD, companyName: "P15 Co" });
    ownerToken = reg.body.data.token;
  });

  after(async () => {
    await server.close();
  });

  it("signing in to the admin panel sets the admin cookie only, and puts no token in the answer", async () => {
    const res = await post("/api/v1/auth/login", { email: adminEmail, password: PASSWORD, panel: "admin" });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { user: { email: string }; token?: string } };
    assert.equal(body.data.user.email, adminEmail);
    assert.equal(body.data.token, undefined, "nothing in the answer for a script to steal");
    const raw = res.headers.getSetCookie().find((c) => c.startsWith("cargosense_admin="));
    assert.ok(raw, "the admin cookie is set");
    assert.match(raw!, /HttpOnly/i);
    assert.match(raw!, /SameSite=Lax/i);
    assert.equal(cookieValue(res, "cargosense_token"), undefined, "the company-panel cookie is not touched");
  });

  it("a person who is not a platform administrator is refused, and keeps their own session", async () => {
    const res = await post("/api/v1/auth/login", { email: ownerEmail, password: PASSWORD, panel: "admin" });
    assert.equal(res.status, 403);
    assert.equal(res.headers.getSetCookie().length, 0, "no cookie of any kind");
    assert.equal((await api.get("/api/v1/auth/me", { token: ownerToken })).status, 200, "their company session was not ended by the attempt");
  });

  it("/admin/me answers from the admin cookie only: not from the company cookie, not from a company user", async () => {
    const login = await post("/api/v1/auth/login", { email: adminEmail, password: PASSWORD, panel: "admin" });
    const adminTok = cookieValue(login, "cargosense_admin")!;
    const me = await get("/api/v1/admin/me", `cargosense_admin=${adminTok}`);
    assert.equal(me.status, 200);
    const meBody = (await me.json()) as { data: { user: { role: string; email: string } } };
    assert.equal(meBody.data.user.role, "PLATFORM_ADMIN");
    assert.equal(meBody.data.user.email, adminEmail);

    assert.equal((await get("/api/v1/admin/me")).status, 401, "no cookie");
    assert.equal((await get("/api/v1/admin/me", `cargosense_token=${adminTok}`)).status, 401, "the company cookie does not open the admin routes");
    assert.equal((await api.get("/api/v1/admin/me", { token: ownerToken })).status, 403, "a company user is not an administrator");
  });

  it("one browser can hold both sessions: each panel's routes use their own cookie", async () => {
    const adminTok = cookieValue(await post("/api/v1/auth/login", { email: adminEmail, password: PASSWORD, panel: "admin" }), "cargosense_admin")!;
    const both = `cargosense_token=${ownerToken}; cargosense_admin=${adminTok}`;
    const company = (await (await get("/api/v1/auth/me", both)).json()) as { data: { user: { email: string } } };
    const admin = (await (await get("/api/v1/admin/me", both)).json()) as { data: { user: { email: string } } };
    assert.equal(company.data.user.email, ownerEmail, "company routes see the company user");
    assert.equal(admin.data.user.email, adminEmail, "admin routes see the administrator");
  });

  it("signing out of the admin panel ends the admin session and does not touch other people's sessions", async () => {
    const adminTok = cookieValue(await post("/api/v1/auth/login", { email: adminEmail, password: PASSWORD, panel: "admin" }), "cargosense_admin")!;
    const cookie = `cargosense_admin=${adminTok}`;
    assert.equal((await get("/api/v1/admin/me", cookie)).status, 200);

    const out = await post("/api/v1/auth/logout", { panel: "admin" }, cookie);
    assert.equal(out.status, 200);
    assert.ok(out.headers.getSetCookie().some((c) => c.startsWith("cargosense_admin=") && /expires=|max-age=0/i.test(c)), "the admin cookie is cleared");
    assert.equal((await get("/api/v1/admin/me", cookie)).status, 401, "a copy of the old cookie no longer works");
    assert.equal((await api.get("/api/v1/auth/me", { token: ownerToken })).status, 200, "someone else's session is untouched");
  });
});
