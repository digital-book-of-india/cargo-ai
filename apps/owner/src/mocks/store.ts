// In-memory mock database for the owner panel. ALL DATA HERE IS DEMO DATA.
// It is mirrored to sessionStorage so a page reload keeps the demo session.
import type {
  AppNotification,
  Camera,
  CameraStatus,
  Connector,
  Day,
  DaySchedule,
  Schedule,
  SecurityEvent,
  Shop,
  User,
  Zone,
} from "@/types";

export interface MockUser extends User {
  /** a hash, never the clear text (this object is mirrored to sessionStorage) */
  password: string;
}

// Demo-only, not real security: keeps typed passwords out of storage in clear text.
export function hashPassword(value: string): string {
  let h = 0x811c9dc5;
  for (const ch of `dbi-demo:${value}`) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `h${h.toString(16)}`;
}

// The private part of a mock camera. The stream URL is kept here only to decide
// the test outcome, and is never returned to the UI.
export interface MockCamera extends Camera {
  testOutcome: CameraStatus;
  /** the test result arrives a few seconds after the request (queued test) */
  testSlow?: boolean;
}

// Mirrors the real Connector document, minus the hashed token (never kept in the mock).
export interface MockConnector extends Omit<Connector, "online"> {
  pairingCode: string | null;
  pairingCodeExpiresAt: string | null;
}

export interface MockOverride {
  state: "ARMED" | "DISARMED";
  until: string; // UTC ISO-8601
  reason?: string;
}

export interface MockDb {
  seq: number;
  sessionUserId: string | null;
  users: MockUser[];
  shops: Shop[];
  schedules: Record<string, Schedule>;
  overrides: Record<string, MockOverride>;
  /** dev knob: what the mock AI worker reports (default ONLINE) */
  aiWorkerState?: string;
  /** notification preferences by user id */
  preferences?: Record<string, unknown>;
  /** push tokens registered by user id (the token itself is never returned) */
  pushTokens?: Record<string, number>;
  cameras: MockCamera[];
  connectors: MockConnector[];
  zones: Record<string, Zone>;
  events: SecurityEvent[];
  eventsSeeded: Record<string, boolean>;
  notifications: AppNotification[];
}

const KEY = "dbi-owner-mock-db";

export const DEMO_USER_EMAIL = "owner@demo.test";
export const DEMO_USER_PASSWORD = "Demo@1234";

// The real backend creates this schedule together with every shop (version 1). It has not been
// reviewed by the owner until a save raises the version.
export function defaultSchedule(shopId: string): Schedule {
  const day = (d: Day, close = "22:00"): DaySchedule => ({
    day: d,
    openTime: "10:00",
    closeTime: close,
    closed: false,
    closesNextDay: false,
  });
  return {
    shopId,
    weeklySchedule: [day("MON"), day("TUE"), day("WED"), day("THU"), day("FRI"), day("SAT"), day("SUN", "20:00")],
    gracePeriodMinutes: 5,
    version: 1,
  };
}

function freshDb(): MockDb {
  return {
    seq: 100,
    sessionUserId: null,
    users: [
      {
        id: "usr_demo",
        name: "Demo Owner",
        email: DEMO_USER_EMAIL,
        password: hashPassword(DEMO_USER_PASSWORD),
        role: "SHOP_OWNER",
        status: "ACTIVE",
        createdAt: "2026-10-01T09:00:00.000Z",
      },
    ],
    shops: [
      {
        id: "shop_demo",
        ownerId: "usr_demo",
        name: "Demo Shop",
        timezone: "Asia/Kolkata",
        address: { city: "Delhi", state: "Delhi", postalCode: "110001" },
        status: "PENDING_SETUP",
        demo: true,
      },
    ],
    schedules: { shop_demo: defaultSchedule("shop_demo") },
    overrides: {},
    cameras: [],
    connectors: [],
    zones: {},
    events: [],
    eventsSeeded: {},
    notifications: [
      {
        id: "ntf_demo_1",
        recipientUserId: "usr_demo",
        channel: "IN_APP",
        status: "SENT",
        createdAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
      },
      {
        id: "ntf_demo_2",
        recipientUserId: "usr_demo",
        channel: "PUSH",
        status: "PENDING",
        createdAt: new Date(Date.now() - 1 * 3600_000).toISOString(),
      },
    ],
  };
}

let db: MockDb | null = null;

export function getDb(): MockDb {
  if (db) return db;
  try {
    const raw = typeof window !== "undefined" ? window.sessionStorage.getItem(KEY) : null;
    if (raw) {
      db = JSON.parse(raw) as MockDb;
      db.connectors ??= []; // older sessions saved before Connectors existed
      return db;
    }
  } catch {
    // storage unavailable or corrupt: fall back to a fresh db
  }
  db = freshDb();
  return db;
}

export function saveDb(): void {
  try {
    if (typeof window !== "undefined" && db) {
      window.sessionStorage.setItem(KEY, JSON.stringify(db));
    }
  } catch {
    // ignore: the mock still works in memory
  }
}

export function resetDb(): void {
  db = freshDb();
  saveDb();
}

export function nextId(prefix: string): string {
  const d = getDb();
  d.seq += 1;
  return `${prefix}_${d.seq}`;
}
