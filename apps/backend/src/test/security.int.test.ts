import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClient, startTestServer, TestServer } from "./harness";

// P7 security review regressions. Own file, so the rate-limit store starts empty.

let server: TestServer;
let api: ReturnType<typeof createClient>;

describe("security regressions (integration)", () => {
  before(async () => {
    server = await startTestServer();
    api = createClient(server.baseUrl);
  });
  after(async () => {
    await server.close();
  });

  it("a spoofed X-Forwarded-For cannot dodge the login rate limit", async () => {
    let limited = 0;
    for (let i = 0; i < 30; i++) {
      const res = await api.post(
        "/api/v1/auth/login",
        { email: "nobody@example.test", password: "wrong-password-1" },
        { headers: { "x-forwarded-for": `203.0.113.${i + 1}` } }
      );
      if (res.status === 429) limited++;
    }
    assert.ok(limited >= 5, `expected the limiter to stop the 30 attempts, only ${limited} were limited`);
  });

  it("the 429 answer uses the standard error shape and Retry-After", async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.test", password: "x" }),
    });
    assert.equal(res.status, 429);
    assert.ok(res.headers.get("retry-after"));
    assert.equal((await res.json()).error.code, "RATE_LIMITED");
  });

  it("security headers are present and the API does not advertise Express", async () => {
    const res = await fetch(`${server.baseUrl}/health`);
    assert.equal(res.headers.get("x-powered-by"), null);
    assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  });

  it("a request with a foreign Origin gets no CORS permission", async () => {
    const res = await fetch(`${server.baseUrl}/api/v1/sites`, { headers: { Origin: "https://evil.example" } });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });
});
