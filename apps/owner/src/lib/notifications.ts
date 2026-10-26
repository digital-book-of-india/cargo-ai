import type { AppNotification, EventType } from "@/types";

// Pure logic for the notification screens and preferences.

export const CHANNEL_LABEL: Record<AppNotification["channel"], string> = {
  PUSH: "Push",
  IN_APP: "In app",
};

// "FAILED" means the owner may NOT have been told: say so plainly.
export const DELIVERY_META: Record<
  AppNotification["status"],
  { label: string; tone: "neutral" | "success" | "danger"; hint: string }
> = {
  PENDING: { label: "Waiting to send", tone: "neutral", hint: "This has not been delivered yet." },
  SENT: { label: "Sent", tone: "success", hint: "" },
  FAILED: {
    label: "Not delivered",
    tone: "danger",
    hint: "This message could not be delivered. Check your alerts to see what happened.",
  },
};

export function sortNotifications<T extends AppNotification>(list: T[]): T[] {
  return [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}

export function countFailed(list: AppNotification[]): number {
  return list.filter((n) => n.status === "FAILED").length;
}

// ---- preferences

export const PREFERENCE_TYPES: Array<{
  type: EventType;
  label: string;
  hint: string;
  /** turning this off removes a safety signal about the monitoring itself */
  safety?: boolean;
}> = [
  { type: "POSSIBLE_SHUTTER_INTERACTION", label: "Possible shutter interaction", hint: "Someone may be touching or moving the shutter." },
  { type: "PERSON_IN_ZONE", label: "Person in monitored zone", hint: "A person was seen in the area you marked." },
  { type: "POSSIBLE_TAMPERING", label: "Suspicious activity near shutter", hint: "Activity that may be tampering." },
  { type: "CAMERA_OFFLINE", label: "Camera went offline", hint: "Your shutter is not watched while the camera is offline.", safety: true },
  { type: "AI_OFFLINE", label: "AI monitoring went offline", hint: "Detection is not working while this is offline.", safety: true },
];

export interface NotificationPreferences {
  push: boolean;
  inApp: boolean;
  types: Record<EventType, boolean>;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  push: true,
  inApp: true,
  types: {
    PERSON_IN_ZONE: true,
    POSSIBLE_SHUTTER_INTERACTION: true,
    POSSIBLE_TAMPERING: true,
    CAMERA_OFFLINE: true,
    AI_OFFLINE: true,
  },
};

// Tolerant reader: anything missing or malformed falls back to "on" (never silently muted).
export function normalizePreferences(raw: unknown): NotificationPreferences {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const t = r.types && typeof r.types === "object" ? (r.types as Record<string, unknown>) : {};
  const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
  const types = { ...DEFAULT_PREFERENCES.types };
  for (const key of Object.keys(types) as EventType[]) types[key] = bool(t[key], true);
  return { push: bool(r.push, true), inApp: bool(r.inApp, true), types };
}

export function preferencesEqual(a: NotificationPreferences, b: NotificationPreferences): boolean {
  if (a.push !== b.push || a.inApp !== b.inApp) return false;
  return (Object.keys(a.types) as EventType[]).every((k) => a.types[k] === b.types[k]);
}

export function allChannelsOff(p: NotificationPreferences): boolean {
  return !p.push && !p.inApp;
}

export function allTypesOff(p: NotificationPreferences): boolean {
  return (Object.values(p.types) as boolean[]).every((v) => !v);
}

/** Safety notices the owner has switched off (shown as a warning before saving). */
export function mutedSafetyTypes(p: NotificationPreferences): EventType[] {
  return PREFERENCE_TYPES.filter((t) => t.safety && !p.types[t.type]).map((t) => t.type);
}

/** True when saving these preferences would mean the owner hears about nothing. */
export function silencesEverything(p: NotificationPreferences): boolean {
  return allChannelsOff(p) || allTypesOff(p);
}

/** Notifications may carry a shop id (not in @dbi/api-types yet). */
export type OwnerNotification = AppNotification & { shopId?: string };

/** Which shop an alert link should use: the notification's own shop when known, else the current one. */
export function notificationShopId(n: OwnerNotification, currentShopId: string | null): string | null {
  return n.shopId || currentShopId;
}

/** Merges a fresh list into what is shown: updated rows replace old ones, unseen ones are counted. */
export function applyLatestNotifications<T extends AppNotification>(
  existing: T[],
  latest: T[]
): { items: T[]; newCount: number } {
  const known = new Set(existing.map((n) => n.id));
  const newCount = latest.filter((n) => !known.has(n.id)).length;
  return { items: sortNotifications(latest), newCount };
}
