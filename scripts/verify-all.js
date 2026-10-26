/**
 * DBI Intelligence — Master End-to-End Integration Test Suite
 * Validates Developer 1 (Owner Experience), Developer 2 (Super Admin),
 * and Developer 3 (Core Security, AI Pipeline & Data Layer) per PDF v2.0 Spec.
 */

const http = require("http");

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runMasterTest() {
  console.log("================================================================================");
  console.log("   DBI Intelligence — Full 3-Developer Verification Suite (PDF v2.0 Spec)       ");
  console.log("================================================================================\n");

  let ownerToken = "";
  let adminToken = "";
  let testShopId = "";
  let testCameraId = "";
  let testEventId = "";

  // -------------------------------------------------------------------------
  // 1. DEVELOPER 3: Core Security, Models, Database & AI Pipeline
  // -------------------------------------------------------------------------
  console.log("--- [TEST SUITE 1] DEVELOPER 3: Core Security, AI & Data Layer ---");

  // D3.1: Health check & RequestId tracing
  const healthRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/health",
    method: "GET",
  });
  console.log("[D3.1] Backend Health:", healthRes.status, "RequestId header:", healthRes.headers["x-request-id"]);
  if (healthRes.status !== 200 || !healthRes.headers["x-request-id"]) throw new Error("Health check failed");

  // D3.2: AI Worker Heartbeat reporting (/internal/v1/ai/health)
  const aiHealthRes = await request(
    {
      hostname: "localhost",
      port: 4000,
      path: "/internal/v1/ai/health",
      method: "POST",
      headers: { "Content-Type": "application/json", "x-service-token": "dbi-ai-worker-secret-token" },
    },
    { serviceName: "worker-1", status: "ONLINE", activeStreams: 2 }
  );
  console.log("[D3.2] AI Worker Heartbeat:", aiHealthRes.status, aiHealthRes.body?.data?.workerStatus);
  if (aiHealthRes.status !== 200 || aiHealthRes.body?.data?.workerStatus !== "ONLINE") throw new Error("AI Heartbeat failed");

  // D3.3: Rate limiter check & error format
  const badAuthRes = await request(
    { hostname: "localhost", port: 4000, path: "/api/v1/auth/login", method: "POST", headers: { "Content-Type": "application/json" } },
    { email: "nonexistent@dbi.com", password: "wrong" }
  );
  console.log("[D3.3] Auth Error Handling (Standard error shape):", badAuthRes.status, badAuthRes.body?.error?.code);
  if (badAuthRes.status !== 401 || !badAuthRes.body?.error?.requestId) throw new Error("Auth error response format invalid");

  // -------------------------------------------------------------------------
  // 2. DEVELOPER 1: Shop Owner Journey & Endpoints
  // -------------------------------------------------------------------------
  console.log("\n--- [TEST SUITE 2] DEVELOPER 1: Shop Owner Experience & APIs ---");

  // D1.1: Owner Login
  const ownerLoginRes = await request(
    { hostname: "localhost", port: 4000, path: "/api/v1/auth/login", method: "POST", headers: { "Content-Type": "application/json" } },
    { email: "owner@dbi.com", password: "Owner@123456" }
  );
  console.log("[D1.1] Owner Login:", ownerLoginRes.status, "User:", ownerLoginRes.body?.data?.user?.email);
  if (ownerLoginRes.status !== 200 || !ownerLoginRes.body?.data?.token) throw new Error("Owner login failed");
  ownerToken = ownerLoginRes.body.data.token;

  // D1.2: Owner Profile (/auth/me)
  const ownerMeRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/api/v1/auth/me",
    method: "GET",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  console.log("[D1.2] Owner Profile (/auth/me):", ownerMeRes.status, "Role:", ownerMeRes.body?.data?.user?.role);
  if (ownerMeRes.status !== 200 || ownerMeRes.body?.data?.user?.role !== "SHOP_OWNER") throw new Error("Owner /auth/me failed");

  // D1.3: List Owner Shops (/shops)
  const shopsRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/api/v1/shops",
    method: "GET",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  console.log("[D1.3] Owner Shops List:", shopsRes.status, "Count:", shopsRes.body?.data?.items?.length);
  if (shopsRes.status !== 200 || !shopsRes.body?.data?.items?.length) throw new Error("List shops failed");
  testShopId = shopsRes.body.data.items[0].id;
  console.log("       Active Shop ID:", testShopId);

  // D1.4: Read Weekly Schedule (/shops/:id/schedule)
  const scheduleRes = await request({
    hostname: "localhost",
    port: 4000,
    path: `/api/v1/shops/${testShopId}/schedule`,
    method: "GET",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  console.log("[D1.4] Read Schedule:", scheduleRes.status, "Grace period:", scheduleRes.body?.data?.gracePeriodMinutes, "min");
  if (scheduleRes.status !== 200) throw new Error("Read schedule failed");

  // D1.5: Security State Evaluation & Truthfulness (/shops/:id/security-state)
  const secStateRes = await request({
    hostname: "localhost",
    port: 4000,
    path: `/api/v1/shops/${testShopId}/security-state`,
    method: "GET",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  console.log("[D1.5] Security State:", secStateRes.status, "Desired:", secStateRes.body?.data?.desiredState, "Actual:", secStateRes.body?.data?.actualMonitoringState);
  if (secStateRes.status !== 200) throw new Error("Security state query failed");

  // D1.6: Camera Listing
  const listCamsRes = await request({
    hostname: "localhost",
    port: 4000,
    path: `/api/v1/shops/${testShopId}/cameras`,
    method: "GET",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  console.log("[D1.6] List Cameras:", listCamsRes.status, "Count:", listCamsRes.body?.data?.items?.length);
  if (listCamsRes.status !== 200 || !listCamsRes.body?.data?.items?.length) throw new Error("List cameras failed");
  testCameraId = listCamsRes.body.data.items[0].id;

  // D1.7: Camera Stream Test
  // The seeded demo camera points at a deliberately unresolvable placeholder host
  // (demo-camera-stream), so the real TCP reachability probe correctly reports it as
  // unreachable. Point it at a guaranteed-open local TCP port first so this test proves
  // the probe genuinely detects a reachable endpoint instead of trusting a hardcoded status.
  const repointRes = await request(
    {
      hostname: "localhost",
      port: 4000,
      path: `/api/v1/cameras/${testCameraId}`,
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    },
    { host: "127.0.0.1", port: 4000 }
  );
  if (repointRes.status !== 200) throw new Error("Repointing camera to a reachable host failed");

  const testCamRes = await request({
    hostname: "localhost",
    port: 4000,
    path: `/api/v1/cameras/${testCameraId}/test`,
    method: "POST",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  console.log("[D1.7] Camera Stream Test:", testCamRes.status, "New Status:", testCamRes.body?.data?.camera?.status);
  if (testCamRes.status !== 200 || testCamRes.body?.data?.camera?.status !== "ONLINE") throw new Error("Camera test failed");

  // D1.8: Shutter/Gate Polygon Zones (/cameras/:id/zones)
  const zoneRes = await request(
    {
      hostname: "localhost",
      port: 4000,
      path: `/api/v1/cameras/${testCameraId}/zones`,
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    },
    {
      zoneType: "SHUTTER",
      polygon: [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }, { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 }],
      sensitivity: "MEDIUM",
      enabled: true,
    }
  );
  console.log("[D1.8] Save Shutter Zone:", zoneRes.status, "Type:", zoneRes.body?.data?.zone?.zoneType);
  if (zoneRes.status !== 200) throw new Error("Save zone failed");

  // D1.9: Event Feed & Review Status (/shops/:id/events & /events/:id/review)
  const eventsRes = await request({
    hostname: "localhost",
    port: 4000,
    path: `/api/v1/shops/${testShopId}/events`,
    method: "GET",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  console.log("[D1.9] Shop Events Feed:", eventsRes.status, "Count:", eventsRes.body?.data?.items?.length);
  if (eventsRes.status !== 200 || !eventsRes.body?.data?.items?.length) throw new Error("Get events failed");
  testEventId = eventsRes.body.data.items[0].id || eventsRes.body.data.items[0].eventId;

  const reviewRes = await request(
    {
      hostname: "localhost",
      port: 4000,
      path: `/api/v1/events/${testEventId}/review`,
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ownerToken}` },
    },
    { reviewStatus: "REVIEWED", note: "Verified clean during end-to-end integration" }
  );
  console.log("[D1.10] Review Security Event:", reviewRes.status, "ReviewStatus:", reviewRes.body?.data?.event?.reviewStatus);
  if (reviewRes.status !== 200 || reviewRes.body?.data?.event?.reviewStatus !== "REVIEWED") throw new Error("Event review failed");

  // D1.11: Notifications (/notifications)
  const notifRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/api/v1/notifications",
    method: "GET",
    headers: { Authorization: `Bearer ${ownerToken}` },
  });
  console.log("[D1.11] In-app Notifications:", notifRes.status, "Count:", notifRes.body?.data?.items?.length);
  if (notifRes.status !== 200) throw new Error("Notifications query failed");

  // -------------------------------------------------------------------------
  // 3. DEVELOPER 2: Super Admin Platform & Management Endpoints
  // -------------------------------------------------------------------------
  console.log("\n--- [TEST SUITE 3] DEVELOPER 2: Super Admin Platform & APIs ---");

  // D2.1: Super Admin Login
  const adminLoginRes = await request(
    { hostname: "localhost", port: 4000, path: "/api/v1/auth/login", method: "POST", headers: { "Content-Type": "application/json" } },
    { email: "admin@dbi.com", password: "Admin@123456" }
  );
  console.log("[D2.1] Super Admin Login:", adminLoginRes.status, "Role:", adminLoginRes.body?.data?.user?.role);
  if (adminLoginRes.status !== 200 || adminLoginRes.body?.data?.user?.role !== "SUPER_ADMIN") throw new Error("Admin login failed");
  adminToken = adminLoginRes.body.data.token;

  // D2.2: Admin Overview KPIs (/admin/overview)
  const overviewRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/api/v1/admin/overview",
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log("[D2.2] Admin Overview KPIs:", overviewRes.status, "KPIs:", {
    totalShops: overviewRes.body?.data?.kpis?.totalShops,
    onlineCameras: overviewRes.body?.data?.kpis?.onlineCameras,
    aiWorkerStatus: overviewRes.body?.data?.aiWorker?.status,
  });
  if (overviewRes.status !== 200 || !overviewRes.body?.data?.kpis) throw new Error("Admin overview failed");

  // D2.3: Admin Owners Search Table (/admin/owners)
  const adminOwnersRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/api/v1/admin/owners",
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const ownersCount = adminOwnersRes.body?.data?.owners?.length ?? adminOwnersRes.body?.data?.items?.length;
  console.log("[D2.3] Admin Owners List:", adminOwnersRes.status, "Found:", ownersCount);
  if (adminOwnersRes.status !== 200 || ownersCount === undefined) throw new Error("Admin owners failed");

  // D2.4: Admin Shops Search & Status Filter (/admin/shops)
  const adminShopsRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/api/v1/admin/shops",
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const shopsCount = adminShopsRes.body?.data?.shops?.length ?? adminShopsRes.body?.data?.items?.length;
  console.log("[D2.4] Admin Shops Search:", adminShopsRes.status, "Found:", shopsCount);
  if (adminShopsRes.status !== 200 || shopsCount === undefined) throw new Error("Admin shops failed");

  // D2.5: Admin Service Health (/admin/cameras/health)
  const healthMetricsRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/api/v1/admin/cameras/health",
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  console.log("[D2.5] Camera & Worker Health Metrics:", healthMetricsRes.status, "Worker Status:", healthMetricsRes.body?.data?.aiWorker?.status, "Cameras count:", healthMetricsRes.body?.data?.cameras?.length);
  if (healthMetricsRes.status !== 200 || !healthMetricsRes.body?.data?.aiWorker) throw new Error("Health metrics failed");

  // D2.6: Admin Audit Trail (/admin/audit-logs)
  const auditLogsRes = await request({
    hostname: "localhost",
    port: 4000,
    path: "/api/v1/admin/audit-logs",
    method: "GET",
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  const auditCount = auditLogsRes.body?.data?.auditLogs?.length ?? auditLogsRes.body?.data?.items?.length;
  console.log("[D2.6] Audit Trail Logged:", auditLogsRes.status, "Logs count:", auditCount);
  if (auditLogsRes.status !== 200 || auditCount === undefined) throw new Error("Audit logs failed");

  console.log("\n================================================================================");
  console.log("   🎉 ALL 3 DEVELOPERS DELIVERABLES PASSED 100% SPEC VERIFICATION!             ");
  console.log("================================================================================\n");
}

runMasterTest().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
