import type { EventType, ReviewStatus, SecurityEvent } from "@/types";

// Pure logic for the alerts screens. Wording is conservative: a camera cannot guarantee
// that it saw everything, and an AI suggestion can be wrong.

/** Evidence fields are not in @dbi/api-types yet (requested from Dev 3). Shown only when present. */
export interface EventEvidence {
  /** private storage keys: what the API stores. They are not viewable addresses. */
  snapshotObjectKey?: string;
  clipObjectKey?: string;
  /** short-lived, access-controlled addresses, when the API provides them (not in the contract yet) */
  snapshotUrl?: string;
  clipUrl?: string;
  expiresAt?: string;
}

export type OwnerEvent = Omit<SecurityEvent, "evidence"> & { evidence?: EventEvidence };

/** Events that report the system's own health, not something seen near the shutter. */
export function isSystemEvent(type: EventType): boolean {
  return type === "CAMERA_OFFLINE" || type === "AI_OFFLINE";
}

export function confidenceLabel(confidence: number | undefined): string | null {
  if (typeof confidence !== "number" || Number.isNaN(confidence)) return null;
  if (confidence >= 0.8) return "High";
  if (confidence >= 0.5) return "Medium";
  return "Low";
}

// Evidence is rendered by the browser, so only http(s) addresses and inline images are allowed.
export function isSafeEvidenceUrl(url: string | undefined): url is string {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^https?:\/\//i.test(url) || /^data:image\/(png|jpe?g|webp|svg\+xml)[;,]/i.test(url);
}

export interface EventFilter {
  review: ReviewStatus | "ALL";
  type: EventType | "ALL";
}

export const NO_FILTER: EventFilter = { review: "ALL", type: "ALL" };

export function filterEvents<T extends SecurityEvent>(events: T[], filter: EventFilter): T[] {
  return events.filter(
    (e) =>
      (filter.review === "ALL" || e.reviewStatus === filter.review) &&
      (filter.type === "ALL" || e.eventType === filter.type)
  );
}

export function isFiltered(filter: EventFilter): boolean {
  return filter.review !== "ALL" || filter.type !== "ALL";
}

export function countByReview(events: SecurityEvent[]): Record<ReviewStatus | "ALL", number> {
  const out: Record<ReviewStatus | "ALL", number> = {
    ALL: events.length,
    NEW: 0,
    REVIEWED: 0,
    FALSE_ALARM: 0,
    CONFIRMED: 0,
  };
  for (const e of events) {
    if (e.reviewStatus in out) out[e.reviewStatus] += 1;
  }
  return out;
}

/** Whole minutes between start and end, or null while the event is still open or unknown. */
export function eventDurationMinutes(event: Pick<SecurityEvent, "startedAt" | "endedAt">): number | null {
  if (!event.endedAt) return null;
  const ms = new Date(event.endedAt).getTime() - new Date(event.startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return null;
  return Math.max(1, Math.round(ms / 60000));
}

export type ReviewChoice = Exclude<ReviewStatus, "NEW">;

export const REVIEW_CHOICES: Array<{
  value: ReviewChoice;
  label: string;
  hint: string;
}> = [
  { value: "REVIEWED", label: "Mark as reviewed", hint: "I have looked at this." },
  { value: "FALSE_ALARM", label: "False alarm", hint: "Nothing worrying happened." },
  { value: "CONFIRMED", label: "Confirm incident", hint: "Something real happened." },
];

/** Newest first, ties broken by id so the order is stable. */
export function sortEvents<T extends SecurityEvent>(events: T[]): T[] {
  return [...events].sort(
    (a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id)
  );
}

/** Adds a page of results without duplicating events already shown. */
export function mergeEvents<T extends SecurityEvent>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((e) => e.id));
  return [...existing, ...incoming.filter((e) => !seen.has(e.id))];
}

/**
 * Applies a fresh first page to what is already shown: events in `latest` replace older copies
 * (their review status may have changed), unseen ones are added, and older loaded pages stay.
 */
export function applyLatest<T extends SecurityEvent>(
  existing: T[],
  latest: T[]
): { items: T[]; newCount: number } {
  const known = new Set(existing.map((e) => e.id));
  const fresh = new Map(latest.map((e) => [e.id, e]));
  const kept = existing.map((e) => fresh.get(e.id) ?? e);
  const added = latest.filter((e) => !known.has(e.id));
  return { items: sortEvents([...kept, ...added]), newCount: added.length };
}

/** Evidence exists on the server but there is no address the browser can open. */
export function hasEvidenceButNoAddress(evidence: EventEvidence | undefined): boolean {
  if (!evidence) return false;
  const stored = !!(evidence.snapshotObjectKey || evidence.clipObjectKey);
  const viewable = isSafeEvidenceUrl(evidence.snapshotUrl) || isSafeEvidenceUrl(evidence.clipUrl);
  return stored && !viewable;
}
