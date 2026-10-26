import type { CargoEventDetail, CargoEventStatus, CargoEventSummary, CargoEventType } from "@/types";

// Pure logic for the alerts screens. Wording is conservative: a camera cannot guarantee
// that it saw everything, and an AI suggestion can be wrong.

export type OwnerEvent = CargoEventSummary;
export type OwnerEventDetail = CargoEventDetail;

/** Events that report the system's own health, not something seen on camera. */
export function isSystemEvent(type: CargoEventType): boolean {
  return type === "camera_offline" || type === "ai_service_unavailable";
}

// Evidence is rendered by the browser, so only same-site paths and http(s) addresses are allowed.
export function isSafeEvidenceUrl(url: string | undefined): url is string {
  if (!url) return false;
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  return /^https?:\/\//i.test(url);
}

export interface EventFilter {
  status: CargoEventStatus | "ALL";
  type: CargoEventType | "ALL";
}

export const NO_FILTER: EventFilter = { status: "ALL", type: "ALL" };

export function filterEvents<T extends CargoEventSummary>(events: T[], filter: EventFilter): T[] {
  return events.filter(
    (e) => (filter.status === "ALL" || e.status === filter.status) && (filter.type === "ALL" || e.eventType === filter.type)
  );
}

export function isFiltered(filter: EventFilter): boolean {
  return filter.status !== "ALL" || filter.type !== "ALL";
}

export function countByStatus(events: CargoEventSummary[]): Record<CargoEventStatus | "ALL", number> {
  const out: Record<CargoEventStatus | "ALL", number> = {
    ALL: events.length,
    open: 0,
    acknowledged: 0,
    in_review: 0,
    resolved: 0,
    false_positive: 0,
    escalated: 0,
  };
  for (const e of events) if (e.status in out) out[e.status] += 1;
  return out;
}

export type ReviewActionId = "acknowledge" | "reviewed_no_issue" | "confirmed_operational" | "escalated" | "false_positive";

export interface ReviewAction {
  id: ReviewActionId;
  label: string;
  hint: string;
  /** false positive needs a reason */
  needsNote?: boolean;
}

// Mirrors the server's transition map so the screen only offers moves the server will accept.
// The server stays the authority: it refuses anything else.
export function availableActions(status: CargoEventStatus): ReviewAction[] {
  const falsePositive: ReviewAction = {
    id: "false_positive",
    label: "Not an issue (false alarm)",
    hint: "The system was wrong. Add a short reason.",
    needsNote: true,
  };
  switch (status) {
    case "open":
      return [{ id: "acknowledge", label: "Acknowledge", hint: "I have seen this and I am looking at it." }, falsePositive];
    case "acknowledged":
    case "in_review":
    case "escalated":
      return [
        { id: "reviewed_no_issue", label: "Reviewed, no issue", hint: "I checked and nothing needs action." },
        { id: "confirmed_operational", label: "Confirmed operational", hint: "This was normal operational activity." },
        ...(status === "escalated" ? [] : [{ id: "escalated" as const, label: "Escalate", hint: "Someone senior needs to look." }]),
        falsePositive,
      ];
    default:
      return []; // resolved and false alarms are closed; reopening comes with the full inbox
  }
}

export type DateRange = "ALL" | "24h" | "7d" | "30d";

export const DATE_RANGE_OPTIONS: Array<{ value: DateRange; label: string }> = [
  { value: "ALL", label: "Any time" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

/** The ISO start time for a range, or undefined for "any time". */
export function rangeStart(range: DateRange, now: Date = new Date()): string | undefined {
  const hours = range === "24h" ? 24 : range === "7d" ? 24 * 7 : range === "30d" ? 24 * 30 : 0;
  return hours ? new Date(now.getTime() - hours * 3600_000).toISOString() : undefined;
}

/** Newest first, ties broken by id so the order is stable. */
export function sortEvents<T extends CargoEventSummary>(events: T[]): T[] {
  return [...events].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id.localeCompare(a.id));
}

/** Adds a page of results without duplicating events already shown. */
export function mergeEvents<T extends CargoEventSummary>(existing: T[], incoming: T[]): T[] {
  const seen = new Set(existing.map((e) => e.id));
  return [...existing, ...incoming.filter((e) => !seen.has(e.id))];
}

/**
 * Applies a fresh first page to what is already shown: events in `latest` replace older copies
 * (their status may have changed), unseen ones are added, and older loaded pages stay.
 */
export function applyLatest<T extends CargoEventSummary>(existing: T[], latest: T[]): { items: T[]; newCount: number } {
  const known = new Set(existing.map((e) => e.id));
  const fresh = new Map(latest.map((e) => [e.id, e]));
  const kept = existing.map((e) => fresh.get(e.id) ?? e);
  const added = latest.filter((e) => !known.has(e.id));
  return { items: sortEvents([...kept, ...added]), newCount: added.length };
}
