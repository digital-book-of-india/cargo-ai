// Safe browser storage helpers. Storage can be missing or blocked, so every call is guarded.
//
// Keys are scoped to the backend the app talks to, so ids from one environment can never be
// mistaken for another's.
import { API_BASE_URL } from "@/lib/api/client";

function scopeName(): string {
  try {
    return new URL(API_BASE_URL).host;
  } catch {
    return "api";
  }
}

function area(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function scoped(key: string): string {
  return `${key}@${scopeName()}`;
}

let legacyPurged = false;
function purgeLegacyKeys(): void {
  if (legacyPurged) return;
  legacyPurged = true;
  try {
    if (typeof window === "undefined") return;
    const ls = window.localStorage;
    for (const k of Object.keys(ls)) {
      const legacy =
        k === "dbi-current-site" || k === "dbi-zone-saved" || (k.startsWith("dbi-zone-copy:") && !k.includes("@"));
      if (legacy) ls.removeItem(k);
    }
  } catch {
    // ignore
  }
}

export function readJson<T>(key: string, fallback: T): T {
  purgeLegacyKeys();
  try {
    const raw = area()?.getItem(scoped(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    area()?.setItem(scoped(key), JSON.stringify(value));
  } catch {
    // ignore
  }
}

const CURRENT_SHOP_KEY = "dbi-current-site";
const ZONE_KEY = "dbi-zone-saved";
const ZONE_COPY_PREFIX = "dbi-zone-copy:";

export function getStoredSiteId(): string | null {
  return readJson<string | null>(CURRENT_SHOP_KEY, null);
}

export function setStoredSiteId(id: string): void {
  writeJson(CURRENT_SHOP_KEY, id);
}

export function getZoneSavedCameraIds(): string[] {
  return readJson<string[]>(ZONE_KEY, []);
}

export function markZoneSaved(cameraId: string): void {
  const ids = getZoneSavedCameraIds();
  if (!ids.includes(cameraId)) writeJson(ZONE_KEY, [...ids, cameraId]);
}

export interface StoredZone {
  zoneType: string;
  sensitivity: string;
  enabled: boolean;
  polygon: Array<{ x: number; y: number }>;
}

export function getStoredZone(cameraId: string): StoredZone | null {
  return readJson<StoredZone | null>(ZONE_COPY_PREFIX + cameraId, null);
}

export function setStoredZone(cameraId: string, zone: StoredZone): void {
  writeJson(ZONE_COPY_PREFIX + cameraId, zone);
}

// Removes everything this app remembered in the browser for the signed-in owner (selected site,
// zone markers and copies). The demo database of the mock layer is kept.
export function clearOwnerStorage(): void {
  try {
    if (typeof window === "undefined") return;
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (const k of Object.keys(store)) {
        if (k.startsWith("dbi-") && k.includes("@")) store.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}
