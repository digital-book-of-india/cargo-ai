import type { CargoEventSeverity, CargoEventStatus, CargoEventType, ResolveOutcome } from "@dbi/api-types";

// The controlled transition map (requirements section 17). Clients never send a status; they
// call an action, and the server checks the move here. Anything not listed is refused.
const TRANSITIONS: Record<CargoEventStatus, readonly CargoEventStatus[]> = {
  open: ["acknowledged", "false_positive", "escalated"],
  acknowledged: ["in_review", "resolved", "false_positive", "escalated"],
  in_review: ["resolved", "false_positive", "escalated"],
  escalated: ["in_review", "resolved", "false_positive"],
  resolved: [], // only reopen() can leave this state
  false_positive: [],
};

export function canTransition(from: CargoEventStatus, to: CargoEventStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: CargoEventStatus): readonly CargoEventStatus[] {
  return TRANSITIONS[from] ?? [];
}

// Reopening is a separate, permissioned action. It applies to the two end states: a resolved event, and one that
// was marked a false positive (a wrongly dismissed event must be recoverable).
export function canReopen(from: CargoEventStatus): boolean {
  return from === "resolved" || from === "false_positive";
}

// A resolve outcome decides the final status. Neutral names only: none asserts theft or loss.
export function statusForOutcome(outcome: ResolveOutcome): CargoEventStatus {
  if (outcome === "false_positive") return "false_positive";
  if (outcome === "escalated") return "escalated";
  return "resolved";
}

// Default severity per event type when the caller does not supply one. A tamper-style or
// mismatch signal needs a human, so it ranks higher; routine movement stays low.
const DEFAULT_SEVERITY: Record<CargoEventType, CargoEventSeverity> = {
  package_detected: "low",
  package_line_crossing: "low",
  zone_entry: "low",
  zone_exit: "low",
  restricted_zone_movement: "high",
  unusual_after_hours_movement: "high",
  count_mismatch: "high",
  possible_package_damage: "medium",
  possible_seal_appearance_change: "medium",
  camera_offline: "medium",
  ai_service_unavailable: "medium",
};

export function defaultSeverity(type: CargoEventType): CargoEventSeverity {
  return DEFAULT_SEVERITY[type];
}

// Conservative wording: these describe what the system saw, never what someone did.
const DEFAULT_SUMMARY: Record<CargoEventType, string> = {
  package_detected: "Package detected",
  package_line_crossing: "Package crossed the counting line",
  zone_entry: "Package movement entered a zone",
  zone_exit: "Package movement left a zone",
  restricted_zone_movement: "Package movement detected in a restricted zone",
  unusual_after_hours_movement: "Movement detected outside configured hours",
  count_mismatch: "Observed count differs from the expected count",
  possible_package_damage: "Possible visible package damage (needs review)",
  possible_seal_appearance_change: "Possible change in seal appearance (needs review)",
  camera_offline: "Camera is offline; coverage is missing",
  ai_service_unavailable: "AI service is unavailable; detection is not running",
};

export function defaultSummary(type: CargoEventType): string {
  return DEFAULT_SUMMARY[type];
}
