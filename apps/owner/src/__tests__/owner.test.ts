import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { safeNextPath } from "../lib/auth";
import { friendlyMessage } from "../lib/api/messages";
import { ApiError } from "../lib/api/errors";
import { clamp01, round4, polygonArea, isSelfIntersecting, validateZonePoints } from "../lib/zone";
import { deriveSecurityView, STALE_AFTER_MS } from "../lib/security";
import { checkHost, checkPort, timeAgo } from "../lib/camera";
import type { SecurityState } from "../types";

describe("Authentication & Navigation Security", () => {
  it("safeNextPath prevents open-redirect and protocol vulnerabilities", () => {
    assert.equal(safeNextPath(null), "/dashboard");
    assert.equal(safeNextPath("/shops/shop_1/schedule"), "/shops/shop_1/schedule");
    assert.equal(safeNextPath("/shops/x?tab=1"), "/shops/x?tab=1");
    assert.equal(safeNextPath("https://evil.test"), "/dashboard");
    assert.equal(safeNextPath("//evil.test"), "/dashboard");
    assert.equal(safeNextPath("/" + String.fromCharCode(92) + "evil.test"), "/dashboard");
    assert.equal(safeNextPath("javascript:alert(1)"), "/dashboard");
    assert.equal(safeNextPath("/a\nb"), "/dashboard");
    assert.equal(safeNextPath("/login"), "/dashboard");
    assert.equal(safeNextPath("/register?x=1"), "/dashboard");
    assert.equal(safeNextPath("", "/x"), "/x");
  });

  it("friendlyMessage sanitizes internal errors and preserves safe messages", () => {
    assert.ok(friendlyMessage(new ApiError(0, "NETWORK_ERROR", "x")).startsWith("Cannot reach"));
    assert.ok(friendlyMessage(new ApiError(429, "RATE", "x")).startsWith("Too many"));
    assert.equal(friendlyMessage(new ApiError(500, "INTERNAL_ERROR", "stack trace here")).includes("stack"), false);
    assert.equal(
      friendlyMessage(new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.")),
      "Email or password is incorrect."
    );
  });
});

describe("Zone Geometry & Polygon Validation", () => {
  it("clamps and rounds coordinate points correctly", () => {
    assert.equal(clamp01(-0.2), 0);
    assert.equal(clamp01(1.4), 1);
    assert.equal(clamp01(0.456), 0.456);
    assert.equal(round4(0.123456), 0.1235);
  });

  it("computes polygon area accurately", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 0, y: 0.5 },
    ];
    assert.equal(polygonArea(square), 0.25);
  });

  it("detects self-intersecting bow-tie polygons", () => {
    const normalQuad = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ];
    assert.equal(isSelfIntersecting(normalQuad), false);

    const bowTie = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];
    assert.equal(isSelfIntersecting(bowTie), true);
  });

  it("validates zone point count and minimum area requirement", () => {
    const tooFew = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    assert.ok(validateZonePoints(tooFew)?.includes("at least 3"));

    const validZone = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    assert.equal(validateZonePoints(validZone), null);
  });
});

describe("Security State & Truthful Status Evaluation", () => {
  it("treats stale security states as unknown / stale", () => {
    const staleState: SecurityState = {
      shopId: "shop_1",
      desiredState: "ARMED",
      actualMonitoringState: "MONITORING",
      cameraState: "ONLINE",
      aiWorkerState: "ONLINE",
      reason: "AFTER_CLOSING",
      evaluatedAt: new Date(Date.now() - (STALE_AFTER_MS + 10000)).toISOString(),
    };
    const res = deriveSecurityView({ state: staleState, refreshFailed: false });
    assert.equal(res.stale, true);
    assert.equal(res.protectedNow, false);
    assert.equal(res.state, "UNKNOWN");
  });

  it("downgrades to DEGRADED when camera is offline even if backend claims MONITORING", () => {
    const conflictedState: SecurityState = {
      shopId: "shop_1",
      desiredState: "ARMED",
      actualMonitoringState: "MONITORING",
      cameraState: "OFFLINE",
      aiWorkerState: "ONLINE",
      reason: "AFTER_CLOSING",
      evaluatedAt: new Date().toISOString(),
    };
    const res = deriveSecurityView({ state: conflictedState, refreshFailed: false });
    assert.equal(res.state, "DEGRADED");
    assert.equal(res.protectedNow, false);
    assert.equal(res.tone, "warning");
  });

  it("reports protectedNow true only when fresh, MONITORING, and sub-states agree", () => {
    const healthyState: SecurityState = {
      shopId: "shop_1",
      desiredState: "ARMED",
      actualMonitoringState: "MONITORING",
      cameraState: "ONLINE",
      aiWorkerState: "ONLINE",
      reason: "AFTER_CLOSING",
      evaluatedAt: new Date().toISOString(),
    };
    const res = deriveSecurityView({ state: healthyState, refreshFailed: false });
    assert.equal(res.state, "MONITORING");
    assert.equal(res.protectedNow, true);
    assert.equal(res.tone, "success");
  });
});

describe("Camera Helpers & Security", () => {
  it("checkHost requires a bare IP/hostname, not a full rtsp:// address", () => {
    assert.equal(checkHost("").ok, false);
    assert.equal(checkHost("rtsp://192.168.1.50:554/stream").ok, false);
    assert.equal(checkHost("192.168.1.50").ok, true);
    assert.equal(checkHost("my camera").ok, false); // spaces not allowed
  });

  it("checkPort validates range and allows blank (defaults server-side)", () => {
    assert.equal(checkPort("").ok, true);
    assert.equal(checkPort("554").ok, true);
    assert.equal(checkPort("0").ok, false);
    assert.equal(checkPort("70000").ok, false);
    assert.equal(checkPort("abc").ok, false);
  });

  it("timeAgo generates correct relative time", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    const tenMinAgo = new Date("2026-10-13T11:50:00Z").toISOString();
    assert.equal(timeAgo(tenMinAgo, now), "10 minutes ago");
  });

  it("camerasApi exports delete method for camera removal", async () => {
    const { camerasApi } = await import("../lib/api/cameras");
    assert.equal(typeof camerasApi.delete, "function");
  });
});
