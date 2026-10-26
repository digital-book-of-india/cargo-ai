import type { BadgeTone } from "@/components/ui";
import type { ImportJobStatus, LoadingSession, ManifestStatus, ReconciliationStatus } from "@/types";

// Plain-language labels for the shipment screens. Pure, so they are easy to test.

export const RECONCILIATION_LABEL: Record<ReconciliationStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  matched: "Matched",
  review_required: "Needs review",
  closed_unverified: "Closed, not verified",
};

export const RECONCILIATION_TONE: Record<ReconciliationStatus, BadgeTone> = {
  not_started: "neutral",
  in_progress: "primary",
  matched: "success",
  review_required: "danger",
  closed_unverified: "warning",
};

export const MANIFEST_STATUS_LABEL: Record<ManifestStatus, string> = {
  draft: "Draft",
  active: "Active",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const MANIFEST_STATUS_TONE: Record<ManifestStatus, BadgeTone> = {
  draft: "neutral",
  active: "primary",
  closed: "success",
  cancelled: "neutral",
};

export const IMPORT_STATUS_LABEL: Record<ImportJobStatus, string> = {
  COMPLETED: "Imported",
  PARTIAL: "Imported with problems",
  FAILED: "Nothing imported",
};

// "94 of 100 (6 fewer)". An observed count is an estimate, so the wording never says "missing".
export function describeDifference(s: Pick<LoadingSession, "expectedCountSnapshot" | "observedCount" | "difference">): string {
  if (s.observedCount === null || s.observedCount === undefined) return "No count available";
  if (s.expectedCountSnapshot === null || s.expectedCountSnapshot === undefined) return `${s.observedCount} counted, no manifest to compare`;
  const base = `${s.observedCount} of ${s.expectedCountSnapshot}`;
  const d = s.difference ?? s.observedCount - s.expectedCountSnapshot;
  if (d === 0) return `${base} (exact)`;
  return `${base} (${Math.abs(d)} ${d < 0 ? "fewer" : "more"})`;
}

export function directionLabel(d: LoadingSession["direction"]): string {
  return d === "outbound" ? "Loading out" : "Unloading in";
}
