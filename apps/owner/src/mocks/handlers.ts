// Mock implementation of the owner-facing API (see docs / handoff section 8).
// Used only when NEXT_PUBLIC_USE_MOCKS=true. ALL RESPONSES ARE DEMO DATA.
//
// Ways to exercise states while building the UI:
//   login        owner@demo.test / Demo@1234 (any other credentials -> 401)
//   shop id      "shop_forbidden" -> 403 (someone else's shop)
//   camera URL   contains "offline" -> test ends OFFLINE
//                contains "error" or "auth" -> test ends ERROR
//                anything else (must start with rtsp:// or rtsps://) -> ONLINE
import { ApiError } from "@/lib/api/errors";
import type {
  AppNotification,
  Camera,
  CameraStatus,
  EventType,
  Paginated,
  ReviewStatus,
  SecurityEvent,
  Shop,
  User,
  Zone,
} from "@/types";
import { getDb, hashPassword, nextId, saveDb } from "./store";
import type { MockCamera } from "./store";

interface MockOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
}

const LATENCY_MS = 250;
const REQUEST_ID = "req_mock";

function fail(status: number, code: string, message: string): never {
  throw new ApiError(status, code, message, REQUEST_ID);
}

function publicUser(u: User & { password?: string }): User {
  return { id: u.id, name: u.name, email: u.email, role: u.role, status: u.status, createdAt: u.createdAt };
}

function requireUser(): User & { password: string } {
  const db = getDb();
  const user = db.users.find((u) => u.id === db.sessionUserId);
  if (!user) fail(401, "UNAUTHENTICATED", "Please sign in to continue.");
  return user;
}

function requireShop(shopId: string): Shop {
  const user = requireUser();
  if (shopId === "shop_forbidden") {
    fail(403, "FORBIDDEN", "You do not have access to this shop.");
  }
  const shop = getDb().shops.find((s) => s.id === shopId);
  if (!shop) fail(404, "NOT_FOUND", "Shop not found.");
  if (shop.ownerId !== user.id) {
    fail(403, "FORBIDDEN", "You do not have access to this shop.");
  }
  return shop;
}

function requireCamera(cameraId: string): MockCamera {
  const camera = getDb().cameras.find((c) => c.id === cameraId);
  if (!camera) fail(404, "NOT_FOUND", "Camera not found.");
  requireShop(camera.shopId);
  return camera;
}

function toCamera(c: MockCamera): Camera {
  // Safe fields only: never the stream URL or credentials.
  return {
    id: c.id,
    shopId: c.shopId,
    name: c.name,
    protocol: c.protocol,
    status: c.status,
    lastFrameAt: c.lastFrameAt,
  };
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

// Decides how a mock camera behaves when tested, from the address text.
//   contains "offline"          -> OFFLINE
//   contains "error" or "auth"  -> ERROR
//   contains "slow"             -> result arrives about 3.5 s later (queued test)
function testBehaviour(url: string): { outcome: CameraStatus; slow: boolean } {
  const lower = url.toLowerCase();
  const outcome: CameraStatus = lower.includes("offline")
    ? "OFFLINE"
    : lower.includes("error") || lower.includes("auth")
      ? "ERROR"
      : "ONLINE";
  return { outcome, slow: lower.includes("slow") };
}


// ---- events

const SEED_EVENTS: Array<{ type: EventType; hoursAgo: number; confidence: number }> = [
  { type: "POSSIBLE_SHUTTER_INTERACTION", hoursAgo: 2, confidence: 0.86 },
  { type: "PERSON_IN_ZONE", hoursAgo: 5, confidence: 0.72 },
  { type: "CAMERA_OFFLINE", hoursAgo: 26, confidence: 1 },
  { type: "POSSIBLE_TAMPERING", hoursAgo: 30, confidence: 0.64 },
  { type: "PERSON_IN_ZONE", hoursAgo: 33, confidence: 0.45 },
  { type: "POSSIBLE_SHUTTER_INTERACTION", hoursAgo: 49, confidence: 0.91 },
  { type: "AI_OFFLINE", hoursAgo: 52, confidence: 1 },
  { type: "PERSON_IN_ZONE", hoursAgo: 55, confidence: 0.58 },
  { type: "POSSIBLE_TAMPERING", hoursAgo: 72, confidence: 0.77 },
  { type: "PERSON_IN_ZONE", hoursAgo: 74, confidence: 0.83 },
  { type: "CAMERA_OFFLINE", hoursAgo: 96, confidence: 1 },
  { type: "POSSIBLE_SHUTTER_INTERACTION", hoursAgo: 100, confidence: 0.69 },
  { type: "PERSON_IN_ZONE", hoursAgo: 120, confidence: 0.52 },
];

// Demo picture: clearly labelled, never presented as a real camera frame.
function demoSnapshot(label: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">` +
    `<rect width="640" height="360" fill="#0F172A"/>` +
    `<rect x="60" y="70" width="520" height="220" fill="#1E293B" stroke="#475569" stroke-width="2"/>` +
    `<polygon points="150,150 490,150 490,270 150,270" fill="#2563EB" fill-opacity="0.25" stroke="#60A5FA" stroke-width="2"/>` +
    `<text x="320" y="50" fill="#F8FAFC" font-family="sans-serif" font-size="20" text-anchor="middle">DEMO picture - not a real camera frame</text>` +
    `<text x="320" y="320" fill="#94A3B8" font-family="sans-serif" font-size="16" text-anchor="middle">${label}</text>` +
    `</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// System notices carry no picture, and pictures older than 48 h are gone (retention).
function evidenceFor(
  event: SecurityEvent
): { snapshotUrl?: string; clipUrl?: string; expiresAt?: string } | undefined {
  if (event.eventType === "CAMERA_OFFLINE" || event.eventType === "AI_OFFLINE") return undefined;
  const ageHours = (Date.now() - new Date(event.startedAt).getTime()) / 3600_000;
  if (ageHours > 48) return undefined;
  return {
    // shutter interactions also carry a short demo clip
    ...(event.eventType === "POSSIBLE_SHUTTER_INTERACTION" ? { clipUrl: "/demo/clip.webm" } : {}),
    snapshotUrl: demoSnapshot(event.eventType.replace(/_/g, " ").toLowerCase()),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

function seedEventsFor(shopId: string) {
  const db = getDb();
  if (db.eventsSeeded[shopId]) return;
  const camera = db.cameras.find((c) => c.shopId === shopId);
  if (!camera) return;
  db.eventsSeeded[shopId] = true;
  for (const s of SEED_EVENTS) {
    const id = nextId("evt");
    db.events.push({
      id,
      eventId: `${id}_demo`,
      shopId,
      cameraId: camera.id,
      eventType: s.type,
      confidence: s.confidence,
      startedAt: new Date(Date.now() - s.hoursAgo * 3600_000).toISOString(),
      reviewStatus: "NEW",
      demoFlag: true,
    });
  }
  saveDb();
}

function requireEvent(eventId: string): SecurityEvent {
  const event = getDb().events.find((e) => e.id === eventId || e.eventId === eventId);
  if (!event) fail(404, "NOT_FOUND", "Event not found.");
  requireShop(event.shopId);
  return event;
}

// ---- router

type Handler = (m: RegExpMatchArray, o: MockOptions) => unknown;
interface Route {
  method: MockOptions["method"];
  pattern: RegExp;
  handle: Handler;
}

const routes: Route[] = [
  // auth
  {
    method: "POST",
    pattern: /^\/auth\/register$/,
    handle: (_m, o) => {
      const b = asRecord(o.body);
      const email = String(b.email ?? "").trim().toLowerCase();
      const name = String(b.name ?? "").trim();
      const password = String(b.password ?? "");
      if (!name || !email || password.length < 8) {
        fail(400, "VALIDATION_ERROR", "Name, email and a password of 8+ characters are required.");
      }
      const db = getDb();
      if (db.users.some((u) => u.email === email)) {
        fail(409, "EMAIL_TAKEN", "An account with this email already exists.");
      }
      const user = {
        id: nextId("usr"),
        name,
        email,
        password: hashPassword(password),
        role: "SHOP_OWNER" as const,
        status: "ACTIVE" as const,
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
      db.sessionUserId = user.id;
      saveDb();
      return { user: publicUser(user) };
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/login$/,
    handle: (_m, o) => {
      const b = asRecord(o.body);
      const email = String(b.email ?? "").trim().toLowerCase();
      const db = getDb();
      const user = db.users.find((u) => u.email === email);
      if (!user || user.password !== hashPassword(String(b.password ?? ""))) {
        fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
      }
      db.sessionUserId = user.id;
      saveDb();
      return { user: publicUser(user) };
    },
  },
  {
    method: "POST",
    pattern: /^\/auth\/logout$/,
    handle: () => {
      getDb().sessionUserId = null;
      saveDb();
      return null;
    },
  },
  { method: "GET", pattern: /^\/auth\/me$/, handle: () => ({ user: publicUser(requireUser()) }) },

  // shops
  {
    method: "POST",
    pattern: /^\/shops$/,
    handle: (_m, o) => {
      const user = requireUser();
      const b = asRecord(o.body);
      const name = String(b.name ?? "").trim();
      const timezone = String(b.timezone ?? "").trim();
      if (!name) fail(400, "VALIDATION_ERROR", "Shop name is required.");
      if (!timezone) fail(400, "VALIDATION_ERROR", "Timezone is required.");
      const shop: Shop = {
        id: nextId("shop"),
        ownerId: user.id,
        name,
        timezone,
        address: b.address as Shop["address"],
        status: "PENDING_SETUP",
        demo: true,
      };
      const db = getDb();
      db.shops.push(shop);
      saveDb();
      return { shop };
    },
  },
  {
    method: "GET",
    pattern: /^\/shops$/,
    handle: () => {
      const user = requireUser();
      return { items: getDb().shops.filter((s) => s.ownerId === user.id) };
    },
  },
  { method: "GET", pattern: /^\/shops\/([^/]+)$/, handle: (m) => ({ shop: requireShop(m[1]) }) },
  {
    method: "PATCH",
    pattern: /^\/shops\/([^/]+)$/,
    handle: (m, o) => {
      const shop = requireShop(m[1]);
      const b = asRecord(o.body);
      if (typeof b.name === "string" && b.name.trim()) shop.name = b.name.trim();
      if (typeof b.timezone === "string" && b.timezone.trim()) shop.timezone = b.timezone.trim();
      if (b.address && typeof b.address === "object") shop.address = b.address as Shop["address"];
      saveDb();
      return { shop };
    },
  },

  // cameras
  {
    method: "POST",
    pattern: /^\/shops\/([^/]+)\/cameras$/,
    handle: (m, o) => {
      const shop = requireShop(m[1]);
      const b = asRecord(o.body);
      const name = String(b.name ?? "").trim();
      const url = String(b.streamUrl ?? "").trim();
      const protocol = b.protocol === "ONVIF" ? "ONVIF" : "RTSP";
      if (!name) fail(400, "VALIDATION_ERROR", "Camera name is required.");
      if (!/^rtsps?:\/\//i.test(url)) {
        fail(400, "VALIDATION_ERROR", "Stream URL must start with rtsp:// or rtsps://.");
      }
      const { outcome, slow } = testBehaviour(url);
      const camera: MockCamera = {
        id: nextId("cam"),
        shopId: shop.id,
        name,
        protocol,
        status: "PENDING_TEST",
        lastFrameAt: null,
        testOutcome: outcome,
        testSlow: slow,
      };
      getDb().cameras.push(camera);
      saveDb();
      return { camera: toCamera(camera) };
    },
  },
  {
    method: "GET",
    pattern: /^\/shops\/([^/]+)\/cameras$/,
    handle: (m) => {
      const shop = requireShop(m[1]);
      return { items: getDb().cameras.filter((c) => c.shopId === shop.id).map(toCamera) };
    },
  },
  {
    method: "POST",
    pattern: /^\/cameras\/([^/]+)\/test$/,
    handle: (m) => {
      const camera = requireCamera(m[1]);
      const finish = () => {
        camera.status = camera.testOutcome;
        camera.lastFrameAt = camera.status === "ONLINE" ? new Date().toISOString() : null;
        saveDb();
      };
      if (camera.testSlow) {
        // Like a real worker queue: answer now, finish a few seconds later.
        camera.status = "PENDING_TEST";
        saveDb();
        setTimeout(finish, 3500);
        return { camera: toCamera(camera), message: "Test queued. The result will appear shortly." };
      }
      finish();
      return {
        camera: toCamera(camera),
        message:
          camera.status === "ONLINE"
            ? "Stream connection verified. Feed is online."
            : "The camera could not be reached.",
      };
    },
  },
  {
    method: "PATCH",
    pattern: /^\/cameras\/([^/]+)$/,
    handle: (m, o) => {
      const camera = requireCamera(m[1]);
      const b = asRecord(o.body);
      if (typeof b.name === "string" && b.name.trim()) camera.name = b.name.trim();
      if (typeof b.streamUrl === "string" && b.streamUrl.trim()) {
        const url = b.streamUrl.trim();
        if (!/^rtsps?:\/\//i.test(url)) {
          fail(400, "VALIDATION_ERROR", "Stream URL must start with rtsp:// or rtsps://.");
        }
        const { outcome, slow } = testBehaviour(url);
        camera.testOutcome = outcome;
        camera.testSlow = slow;
        camera.status = "PENDING_TEST"; // a changed URL must be tested again
        camera.lastFrameAt = null;
      }
      saveDb();
      return { camera: toCamera(camera) };
    },
  },
  {
    method: "DELETE",
    pattern: /^\/cameras\/([^/]+)$/,
    handle: (m) => {
      const camera = requireCamera(m[1]);
      const db = getDb();
      db.cameras = db.cameras.filter((c) => c.id !== camera.id);
      delete db.zones[camera.id];
      saveDb();
      return { success: true };
    },
  },
  {
    method: "PUT",
    pattern: /^\/cameras\/([^/]+)\/zones$/,
    handle: (m, o) => {
      const camera = requireCamera(m[1]);
      const zone = asRecord(o.body) as unknown as Zone;
      const polygon = Array.isArray(zone.polygon) ? zone.polygon : [];
      const inRange = polygon.every(
        (p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
      );
      if (polygon.length < 3 || !inRange) {
        fail(400, "VALIDATION_ERROR", "A zone needs at least 3 points between 0 and 1.");
      }
      getDb().zones[camera.id] = zone;
      saveDb();
      return { zone: { ...zone, id: `zone_${camera.id}`, cameraId: camera.id, shopId: camera.shopId } };
    },
  },
  {
    method: "GET",
    pattern: /^\/cameras\/([^/]+)\/zones$/,
    handle: (m) => {
      const camera = requireCamera(m[1]);
      const zone = getDb().zones[camera.id];
      if (!zone) fail(404, "NOT_FOUND", "No zone defined for this camera.");
      return { zone: { ...zone, id: `zone_${camera.id}`, cameraId: camera.id, shopId: camera.shopId } };
    },
  },


  // events
  {
    method: "GET",
    pattern: /^\/shops\/([^/]+)\/events$/,
    handle: (m, o): Paginated<SecurityEvent> => {
      const shop = requireShop(m[1]);
      seedEventsFor(shop.id);
      const all = getDb()
        .events.filter((e) => e.shopId === shop.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
      const limit = Math.min(Math.max(Number(o.query?.limit ?? 10), 1), 50);
      const start = Number(o.query?.cursor ?? 0) || 0;
      const items = all.slice(start, start + limit);
      const next = start + limit;
      return { items, nextCursor: next < all.length ? String(next) : null };
    },
  },
  {
    method: "GET",
    pattern: /^\/events\/([^/]+)$/,
    handle: (m) => {
      const event = requireEvent(m[1]);
      return { event: { ...event, evidence: evidenceFor(event) } };
    },
  },
  {
    method: "POST",
    pattern: /^\/events\/([^/]+)\/review$/,
    handle: (m, o) => {
      const event = requireEvent(m[1]);
      const status = asRecord(o.body).reviewStatus as ReviewStatus;
      if (!["REVIEWED", "FALSE_ALARM", "CONFIRMED"].includes(status)) {
        fail(400, "VALIDATION_ERROR", "Invalid review status.");
      }
      event.reviewStatus = status;
      saveDb();
      return { event };
    },
  },

  // profile (assumed endpoint, not in the handoff catalogue)
  {
    method: "PATCH",
    pattern: /^\/auth\/me$/,
    handle: (_m, o) => {
      const user = requireUser();
      const name = String(asRecord(o.body).name ?? "").trim();
      if (!name || name.length > 80) {
        fail(400, "VALIDATION_ERROR", "Name must be between 1 and 80 characters.");
      }
      user.name = name;
      saveDb();
      return { user: publicUser(user) };
    },
  },

  // notifications
  {
    method: "GET",
    pattern: /^\/notifications$/,
    handle: (): { items: AppNotification[] } => {
      const user = requireUser();
      const db = getDb();
      // One in-app/push notification per recent detection, built from the seeded events.
      for (const shop of db.shops.filter((s) => s.ownerId === user.id)) seedEventsFor(shop.id);
      const mine = new Set(db.shops.filter((s) => s.ownerId === user.id).map((s) => s.id));
      const derived: AppNotification[] = db.events
        .filter((e) => mine.has(e.shopId))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 6)
        .map((e, i) => ({
          id: `ntf_${e.id}`,
          eventId: e.id,
          recipientUserId: user.id,
          channel: i % 2 === 0 ? ("PUSH" as const) : ("IN_APP" as const),
          status: i === 1 ? ("FAILED" as const) : ("SENT" as const),
          createdAt: e.startedAt,
        }));
      return { items: [...derived, ...db.notifications] };
    },
  },
  {
    method: "GET",
    pattern: /^\/notifications\/preferences$/,
    handle: () => {
      const user = requireUser();
      return { preferences: getDb().preferences?.[user.id] ?? null };
    },
  },
  {
    method: "PUT",
    pattern: /^\/notifications\/preferences$/,
    handle: (_m, o) => {
      const user = requireUser();
      const b = asRecord(o.body);
      const types = asRecord(b.types);
      const okTypes = Object.values(types).every((v) => typeof v === "boolean");
      if (typeof b.push !== "boolean" || typeof b.inApp !== "boolean" || !okTypes) {
        fail(400, "VALIDATION_ERROR", "Preferences must be true or false values.");
      }
      const db = getDb();
      db.preferences = { ...(db.preferences ?? {}), [user.id]: { push: b.push, inApp: b.inApp, types } };
      saveDb();
      return { preferences: db.preferences[user.id] };
    },
  },
];

export async function mockRequest<T>(path: string, options: MockOptions): Promise<T> {
  await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
  for (const route of routes) {
    if (route.method !== options.method) continue;
    const match = path.match(route.pattern);
    if (match) return route.handle(match, options) as T;
  }
  fail(404, "NOT_FOUND", `No mock for ${options.method} ${path}.`);
}
