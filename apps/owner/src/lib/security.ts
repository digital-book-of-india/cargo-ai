import type { MonitoringState, SecurityState as ApiSecurityState } from "@/types";

// `overrideUntil` is not in @dbi/api-types yet (requested from Dev 3). Shown only when present.
export type SecurityState = ApiSecurityState & { overrideUntil?: string };

// Pure logic for the dashboard's security status. Wording is deliberately conservative:
// only an API answer of MONITORING, that is fresh and not contradicted, reads as protected.

export type StatusTone = "success" | "neutral" | "warning" | "danger";

export const MONITORING_COPY: Record<MonitoringState, { label: string; tone: StatusTone; hint: string }> = {
  MONITORING: {
    label: "Monitoring",
    tone: "success",
    hint: "Your camera and AI monitoring are healthy and watching your shutter.",
  },
  DISARMED: {
    label: "Not armed",
    tone: "neutral",
    hint: "Monitoring is off because your shop is open.",
  },
  DEGRADED: {
    label: "Degraded",
    tone: "warning",
    hint: "Protection may be limited. Check your camera and monitoring service.",
  },
  OFFLINE: {
    label: "Offline: not protected",
    tone: "danger",
    hint: "Your shutter is not being monitored right now.",
  },
  SETUP_REQUIRED: {
    label: "Setup required",
    tone: "warning",
    hint: "Finish setting up your shop to start monitoring.",
  },
};

/** A state older than this is treated as unknown, never as "protected". */
export const STALE_AFTER_MS = 2 * 60_000;

export type DisplayState = MonitoringState | "UNKNOWN";

export interface SecurityView {
  state: DisplayState;
  /** true only when we can honestly say the shutter is being watched */
  protectedNow: boolean;
  label: string;
  tone: StatusTone;
  hint: string;
  /** why the system is in this state, in plain words (may be empty) */
  reason: string;
  /** the data shown is not current (refresh failed or answer is old) */
  stale: boolean;
  /** what was last reported, when the current answer cannot be trusted */
  lastKnown?: { label: string; evaluatedAt: string };
}

const REASON_TEXT: Record<string, string> = {
  SCHEDULE_MISSING: "Opening hours are needed before monitoring can start.",
  NO_CAMERA_CONFIGURED: "Add a camera before monitoring can start.",
  SETUP_INCOMPLETE: "Opening hours and a camera are needed before monitoring can start.",
  CAMERA_NOT_TESTED: "The camera has not passed a connection test yet.",
  MANUAL_OVERRIDE: "A manual override is in effect. The normal schedule resumes when it ends.",
  AFTER_CLOSING: "Your shop is closed, so monitoring is expected to be on.",
  CLOSING_GRACE_PERIOD: "Your shop has just closed. Monitoring starts after the grace period.",
  SHOP_OPEN: "Your shop is open, so monitoring is off.",
  SHOP_OPEN_OVERNIGHT: "Your shop is open past midnight, so monitoring is off.",
  CLOSED_BY_EXCEPTION: "Today is a closed day you set, so monitoring is expected to be on.",
  OPEN_HOURS: "Your shop is open, so monitoring is off.",
};

// The API may add detail after the code ("MANUAL_OVERRIDE: reason", "CLOSED_BY_EXCEPTION (Holiday)").
export function reasonCode(reason: string | undefined): string {
  return (reason ?? "").split(/[:(]/)[0].trim();
}

export function reasonText(reason: string | undefined): string {
  return REASON_TEXT[reasonCode(reason)] || "";
}

export function ageMs(state: Pick<SecurityState, "evaluatedAt">, now: Date): number {
  const t = new Date(state.evaluatedAt).getTime();
  return Number.isNaN(t) ? Infinity : now.getTime() - t;
}

export interface DeriveInput {
  state: SecurityState | null;
  /** the latest attempt to read the state failed */
  refreshFailed: boolean;
  now?: Date;
}

export function deriveSecurityView({ state, refreshFailed, now = new Date() }: DeriveInput): SecurityView {
  if (!state) {
    return {
      state: "UNKNOWN",
      protectedNow: false,
      label: "Status unavailable",
      tone: "warning",
      hint: "We could not read your monitoring status. Do not assume your shutter is watched.",
      reason: "",
      stale: true,
    };
  }

  const reported = MONITORING_COPY[state.actualMonitoringState];
  const old = ageMs(state, now) > STALE_AFTER_MS;

  if (refreshFailed || old || !reported) {
    return {
      state: "UNKNOWN",
      protectedNow: false,
      label: "Status unavailable",
      tone: "warning",
      hint: "We could not confirm your current status. Do not assume your shutter is watched.",
      reason: "",
      stale: true,
      lastKnown: reported ? { label: reported.label, evaluatedAt: state.evaluatedAt } : undefined,
    };
  }

  // The API says MONITORING but its own sub-states disagree: never show "protected".
  let actual: MonitoringState = state.actualMonitoringState;
  if (actual === "MONITORING") {
    const cameraBad = ["OFFLINE", "ERROR", "NONE", "NO_CAMERA", "PENDING_TEST"].includes(state.cameraState);
    if (cameraBad || state.aiWorkerState === "OFFLINE") actual = "DEGRADED";
  }

  const copy = MONITORING_COPY[actual];
  // "because your shop is open" would be wrong while a manual pause is in effect
  const pausedByOverride = actual === "DISARMED" && state.reason === "MANUAL_OVERRIDE";
  return {
    state: actual,
    protectedNow: actual === "MONITORING",
    label: copy.label,
    tone: copy.tone,
    hint: pausedByOverride ? "Monitoring is paused by a manual override. Your shutter is not being watched." : copy.hint,
    reason: reasonText(state.reason),
    stale: false,
  };
}

// ---- manual override

export type OverrideTarget = "ARMED" | "DISARMED";

export const OVERRIDE_DURATIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 30, label: "30 minutes" },
  { minutes: 60, label: "1 hour" },
  { minutes: 120, label: "2 hours" },
  { minutes: 240, label: "4 hours" },
];

export const DEFAULT_OVERRIDE_MINUTES = 60;

export interface OverrideCopy {
  actionLabel: string;
  title: string;
  warning: string;
  confirmLabel: string;
  tone: "danger" | "primary";
}

// Turning monitoring off is the risky direction: it must say so plainly.
export function overrideCopy(target: OverrideTarget, minutesLabel: string): OverrideCopy {
  if (target === "DISARMED") {
    return {
      actionLabel: "Pause monitoring",
      title: "Pause monitoring?",
      warning: `Your shutter will not be monitored for ${minutesLabel}, even after closing time. Alerts will not be raised during this time.`,
      confirmLabel: "Pause monitoring",
      tone: "danger",
    };
  }
  return {
    actionLabel: "Arm now",
    title: "Start monitoring now?",
    warning: `Monitoring will switch on for ${minutesLabel} even though your shop may be open. Movement near the shutter may raise alerts.`,
    confirmLabel: "Arm now",
    tone: "primary",
  };
}

/** What a manual override can sensibly do right now. Unknown status offers nothing. */
export function availableOverride(view: SecurityView, state: SecurityState | null): OverrideTarget | null {
  if (!state || view.state === "UNKNOWN" || view.state === "SETUP_REQUIRED") return null;
  return state.desiredState === "ARMED" ? "DISARMED" : "ARMED";
}

// ---- sub-system health rows (camera, AI monitoring)

export interface HealthRow {
  label: string;
  tone: StatusTone;
}

// Honest wording: anything we do not recognise is "Unknown", never "Online".
export function subsystemHealth(value: string | undefined): HealthRow {
  switch (value) {
    case "ONLINE":
      return { label: "Online", tone: "success" };
    case "OFFLINE":
      return { label: "Offline", tone: "danger" };
    case "ERROR":
      return { label: "Error", tone: "danger" };
    case "PENDING_TEST":
      return { label: "Not tested yet", tone: "neutral" };
    case "NONE":
    case "NO_CAMERA":
      return { label: "Not connected", tone: "neutral" };
    case "DEGRADED":
      return { label: "Degraded", tone: "warning" };
    default:
      return { label: "Unknown", tone: "warning" };
  }
}

/** The override end time, only when it is a valid future moment. */
export function activeOverrideUntil(state: SecurityState | null, now: Date = new Date()): string | null {
  if (!state || reasonCode(state.reason) !== "MANUAL_OVERRIDE" || !state.overrideUntil) return null;
  const t = new Date(state.overrideUntil).getTime();
  return Number.isNaN(t) || t <= now.getTime() ? null : state.overrideUntil;
}
