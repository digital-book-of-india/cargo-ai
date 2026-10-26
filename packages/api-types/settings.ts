import type { CargoEventSeverity, CargoEventType } from "./index";

// Per-company settings (requirements section 9: "Cargo Settings"). Pure helpers live here so the
// API and the panels apply exactly the same rules.

// A named time window in the company's timezone, "HH:mm" to "HH:mm". It may cross midnight
// (for example night shift 22:00 to 06:00).
export interface Shift {
  name: string;
  start: string;
  end: string;
}

export interface NotificationRules {
  /** in-app notifications are only sent for events at or above this severity */
  inAppMinSeverity: CargoEventSeverity;
  /** event types nobody is notified about. Health events can never be muted. */
  mutedEventTypes: CargoEventType[];
}

export interface CompanySettings {
  /** an observed count may differ from the expected count by this many packages without a review event */
  mismatchTolerance: number;
  /** evidence files older than this many days are deleted (the events and history stay) */
  retentionDays: number;
  /** minimum detection confidence suggested for new zones, 0..1 */
  defaultConfidence: number;
  shifts: Shift[];
  notificationRules: NotificationRules;
  updatedAt?: string;
}

export type UpdateCompanySettingsRequest = Partial<Omit<CompanySettings, "updatedAt">>;

// Health events tell people the system is not watching; they are never muted.
export const UNMUTABLE_EVENT_TYPES: readonly CargoEventType[] = ["camera_offline", "ai_service_unavailable"];

export const SETTINGS_LIMITS = {
  mismatchTolerance: { min: 0, max: 100000 },
  retentionDays: { min: 7, max: 3650 },
  maxShifts: 8,
} as const;

export const DEFAULT_SETTINGS: Omit<CompanySettings, "updatedAt" | "retentionDays"> = {
  mismatchTolerance: 0,
  defaultConfidence: 0.55,
  shifts: [],
  notificationRules: { inAppMinSeverity: "low", mutedEventTypes: [] },
};

export const SEVERITY_RANK: Record<CargoEventSeverity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// The parts of the 24-hour day a shift covers. A shift that crosses midnight covers two parts.
function spans(shift: Shift): Array<[number, number]> {
  const s = toMinutes(shift.start);
  const e = toMinutes(shift.end);
  return e > s ? [[s, e]] : [[s, 1440], [0, e]];
}

// Returns a plain-language problem with the list of shifts, or null when it is fine.
export function validateShifts(shifts: Shift[]): string | null {
  if (shifts.length > SETTINGS_LIMITS.maxShifts) return `Use at most ${SETTINGS_LIMITS.maxShifts} shifts.`;
  const names = new Set<string>();
  for (const sh of shifts) {
    const key = sh.name.trim().toLowerCase();
    if (!key) return "Every shift needs a name.";
    if (names.has(key)) return `Two shifts are called "${sh.name}".`;
    names.add(key);
    if (!HHMM.test(sh.start) || !HHMM.test(sh.end)) return `Shift "${sh.name}" needs times like 06:00.`;
    if (sh.start === sh.end) return `Shift "${sh.name}" starts and ends at the same time.`;
  }
  for (let i = 0; i < shifts.length; i++) {
    for (let j = i + 1; j < shifts.length; j++) {
      for (const [a1, a2] of spans(shifts[i])) {
        for (const [b1, b2] of spans(shifts[j])) {
          if (a1 < b2 && b1 < a2) return `Shifts "${shifts[i].name}" and "${shifts[j].name}" overlap.`;
        }
      }
    }
  }
  return null;
}

// Which shift (if any) a time of day falls into. `minutes` is minutes since midnight in the company timezone.
export function shiftAt(shifts: Shift[], minutes: number): Shift | null {
  for (const sh of shifts) {
    if (spans(sh).some(([a, b]) => minutes >= a && minutes < b)) return sh;
  }
  return null;
}
