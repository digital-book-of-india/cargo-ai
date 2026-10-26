import type { Day, DaySchedule, Schedule } from "@/types";
import { safeTimeZone } from "@/lib/utils/time";

// Pure schedule logic for the owner form. The server stays the source of truth
// for arming/disarming; this file only edits and validates the weekly hours.

export const DAYS: Array<{ key: Day; label: string; short: string }> = [
  { key: "MON", label: "Monday", short: "Mon" },
  { key: "TUE", label: "Tuesday", short: "Tue" },
  { key: "WED", label: "Wednesday", short: "Wed" },
  { key: "THU", label: "Thursday", short: "Thu" },
  { key: "FRI", label: "Friday", short: "Fri" },
  { key: "SAT", label: "Saturday", short: "Sat" },
  { key: "SUN", label: "Sunday", short: "Sun" },
];

export interface DayForm {
  day: Day;
  closed: boolean;
  openTime: string; // "HH:mm" or ""
  closeTime: string; // "HH:mm" or ""
  closesNextDay: boolean;
}

export interface WeekForm {
  days: DayForm[];
  gracePeriodMinutes: number;
}

export interface DayErrors {
  openTime?: string;
  closeTime?: string;
  closesNextDay?: string;
}

export const DEFAULT_GRACE_MINUTES = 5;
export const MAX_GRACE_MINUTES = 60;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Suggested starting hours for a shop that has never saved a schedule.
export function defaultWeek(): WeekForm {
  return {
    days: DAYS.map(({ key }) => ({
      day: key,
      closed: key === "SUN",
      openTime: key === "SUN" ? "" : "10:00",
      closeTime: key === "SUN" ? "" : "22:00",
      closesNextDay: false,
    })),
    gracePeriodMinutes: DEFAULT_GRACE_MINUTES,
  };
}

// Builds the form from the API. Missing days are treated as closed.
export function weekFromSchedule(schedule: Schedule): WeekForm {
  const byDay = new Map<Day, DaySchedule>(schedule.weeklySchedule.map((d) => [d.day, d]));
  return {
    days: DAYS.map(({ key }) => {
      const d = byDay.get(key);
      if (!d || d.closed) {
        return { day: key, closed: true, openTime: "", closeTime: "", closesNextDay: false };
      }
      return {
        day: key,
        closed: false,
        openTime: d.openTime ?? "",
        closeTime: d.closeTime ?? "",
        closesNextDay: !!d.closesNextDay,
      };
    }),
    gracePeriodMinutes: schedule.gracePeriodMinutes,
  };
}

// Request body shape: closed days carry no times.
export function toWeeklySchedule(week: WeekForm): DaySchedule[] {
  return week.days.map((d) =>
    d.closed
      ? { day: d.day, closed: true, closesNextDay: false }
      : {
          day: d.day,
          closed: false,
          openTime: d.openTime,
          closeTime: d.closeTime,
          closesNextDay: d.closesNextDay,
        }
  );
}

export function toMinutes(hhmm: string): number | null {
  if (!HHMM.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function validateDay(d: DayForm): DayErrors {
  if (d.closed) return {};
  const errors: DayErrors = {};
  const open = toMinutes(d.openTime);
  const close = toMinutes(d.closeTime);

  if (!d.openTime) errors.openTime = "Add an opening time";
  else if (open === null) errors.openTime = "Use HH:mm";
  if (!d.closeTime) errors.closeTime = "Add a closing time";
  else if (close === null) errors.closeTime = "Use HH:mm";

  if (open !== null && close !== null) {
    if (d.closesNextDay && close >= open) {
      errors.closeTime = "With closes next day, closing time must be earlier than opening time";
    } else if (!d.closesNextDay && close <= open) {
      errors.closeTime =
        "Closing time must be after opening time. If you close after midnight, tick closes next day.";
    }
  }
  return errors;
}

export interface WeekValidation {
  days: Record<Day, DayErrors>;
  grace?: string;
  valid: boolean;
}

export function validateWeek(week: WeekForm): WeekValidation {
  const days = {} as Record<Day, DayErrors>;
  let valid = true;
  for (const d of week.days) {
    days[d.day] = validateDay(d);
    if (Object.keys(days[d.day]).length > 0) valid = false;
  }
  const g = week.gracePeriodMinutes;
  let grace: string | undefined;
  if (!Number.isInteger(g) || g < 0 || g > MAX_GRACE_MINUTES) {
    grace = `Enter a whole number from 0 to ${MAX_GRACE_MINUTES}`;
    valid = false;
  }
  return { days, grace, valid };
}

// When monitoring is expected to arm: closing time plus grace period.
export function armsAt(d: DayForm, graceMinutes: number): string | null {
  if (d.closed) return null;
  const close = toMinutes(d.closeTime);
  if (close === null || !Number.isInteger(graceMinutes)) return null;
  const total = close + graceMinutes;
  const wrapsMidnight = total >= 24 * 60;
  const m = total % (24 * 60);
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  const nextDay = d.closesNextDay || wrapsMidnight;
  return nextDay ? `${hh}:${mm} the next day` : `${hh}:${mm}`;
}

export function weeksEqual(a: WeekForm, b: WeekForm): boolean {
  if (a.gracePeriodMinutes !== b.gracePeriodMinutes) return false;
  return a.days.every((d, i) => {
    const o = b.days[i];
    return (
      d.day === o.day &&
      d.closed === o.closed &&
      d.closesNextDay === o.closesNextDay &&
      (d.closed || (d.openTime === o.openTime && d.closeTime === o.closeTime))
    );
  });
}

// Copies one day's hours onto every other day that is open.
export function copyDayToOpenDays(week: WeekForm, from: Day): WeekForm {
  const src = week.days.find((d) => d.day === from);
  if (!src || src.closed) return week;
  return {
    ...week,
    days: week.days.map((d) =>
      d.closed || d.day === from
        ? d
        : { ...d, openTime: src.openTime, closeTime: src.closeTime, closesNextDay: src.closesNextDay }
    ),
  };
}

export function isConfigured(schedule: Schedule | null): boolean {
  return !!schedule && schedule.version > 0 && schedule.weeklySchedule.length > 0;
}

// The API creates a default schedule (version 1) with every shop. Only a save by the owner
// raises the version, so "reviewed" means the owner saved their hours at least once.
export function isReviewed(schedule: Schedule | null): boolean {
  return isConfigured(schedule) && (schedule?.version ?? 0) > 1;
}

// ---- exceptions (holidays and special days) -------------------------------

// Shape stored by the API (handoff section 10). Not in @dbi/api-types yet.
export interface ScheduleException {
  date: string; // YYYY-MM-DD in the shop timezone
  closed?: boolean;
  openTime?: string;
  closeTime?: string;
  closesNextDay?: boolean;
  note?: string;
}

export interface ExceptionForm {
  /** client-only key so rows keep their identity while the date is edited */
  key: string;
  date: string;
  closed: boolean;
  openTime: string;
  closeTime: string;
  closesNextDay: boolean;
  note: string;
}

export interface ExceptionErrors {
  date?: string;
  openTime?: string;
  closeTime?: string;
}

export const MAX_NOTE_LENGTH = 80;

export function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

let keySeq = 0;
export function newExceptionKey(): string {
  keySeq += 1;
  return `ex_${keySeq}`;
}

export function blankException(): ExceptionForm {
  return {
    key: newExceptionKey(),
    date: "",
    closed: true,
    openTime: "10:00",
    closeTime: "22:00",
    closesNextDay: false,
    note: "",
  };
}

export function exceptionsFromApi(raw: unknown): ExceptionForm[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ScheduleException[])
    .filter((e) => e && typeof e.date === "string")
    .map((e) => ({
      key: newExceptionKey(),
      date: e.date,
      // a day without both times can only be a closed day
      closed: e.closed === true || !(e.openTime && e.closeTime),
      openTime: e.openTime ?? "",
      closeTime: e.closeTime ?? "",
      closesNextDay: !!e.closesNextDay,
      note: e.note ?? "",
    }));
}

// Sorted by date; closed days carry no times.
export function toExceptionsPayload(list: ExceptionForm[]): ScheduleException[] {
  return [...list]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => {
      const out: ScheduleException = { date: e.date, closed: e.closed };
      if (!e.closed) {
        out.openTime = e.openTime;
        out.closeTime = e.closeTime;
        out.closesNextDay = e.closesNextDay;
      }
      const note = e.note.trim();
      if (note) out.note = note;
      return out;
    });
}

export interface ExceptionsValidation {
  byKey: Record<string, ExceptionErrors>;
  valid: boolean;
}

export function validateExceptions(list: ExceptionForm[]): ExceptionsValidation {
  const byKey: Record<string, ExceptionErrors> = {};
  const seen = new Map<string, number>();
  for (const e of list) seen.set(e.date, (seen.get(e.date) ?? 0) + 1);

  let valid = true;
  for (const e of list) {
    const errors: ExceptionErrors = {};
    if (!e.date) errors.date = "Pick a date";
    else if (!isValidDateString(e.date)) errors.date = "Enter a valid date";
    else if ((seen.get(e.date) ?? 0) > 1) errors.date = "This date is already added";

    if (!e.closed) {
      const asDay = validateDay({
        day: "MON",
        closed: false,
        openTime: e.openTime,
        closeTime: e.closeTime,
        closesNextDay: e.closesNextDay,
      });
      if (asDay.openTime) errors.openTime = asDay.openTime;
      if (asDay.closeTime) errors.closeTime = asDay.closeTime;
    }
    byKey[e.key] = errors;
    if (Object.keys(errors).length > 0) valid = false;
  }
  return { byKey, valid };
}

export function exceptionsEqual(a: ExceptionForm[], b: ExceptionForm[]): boolean {
  return JSON.stringify(toExceptionsPayload(a)) === JSON.stringify(toExceptionsPayload(b));
}

// Today's date (YYYY-MM-DD) in a timezone, used only to mark past entries.
export function todayInTimezone(timeZone: string, at = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// ---- today (dashboard) ------------------------------------------------------

export interface TodayHours {
  /** where the hours came from */
  source: "WEEKLY" | "EXCEPTION";
  closed: boolean;
  openTime?: string;
  closeTime?: string;
  closesNextDay: boolean;
  note?: string;
}

// Weekday of `at` as seen in the shop's timezone.
export function dayInTimezone(timeZone: string, at = new Date()): Day {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: safeTimeZone(timeZone), weekday: "short" }).format(at);
  const found = DAYS.find((d) => d.short === short);
  return found ? found.key : "MON";
}

// Hours for the shop's current local date: a holiday/special day wins over the weekly row.
// Returns null when nothing is configured for today (so the UI says so instead of guessing).
export function todayHours(
  schedule: Schedule | null,
  timeZone: string,
  at = new Date()
): TodayHours | null {
  if (!schedule || schedule.version === 0) return null;
  const date = todayInTimezone(timeZone, at);
  const exception = exceptionsFromApi((schedule as { exceptions?: unknown }).exceptions).find(
    (e) => e.date === date
  );
  if (exception) {
    return {
      source: "EXCEPTION",
      closed: exception.closed,
      openTime: exception.closed ? undefined : exception.openTime,
      closeTime: exception.closed ? undefined : exception.closeTime,
      closesNextDay: !exception.closed && exception.closesNextDay,
      note: exception.note || undefined,
    };
  }
  const row = schedule.weeklySchedule.find((d) => d.day === dayInTimezone(timeZone, at));
  if (!row) return null;
  return {
    source: "WEEKLY",
    closed: row.closed,
    openTime: row.closed ? undefined : row.openTime,
    closeTime: row.closed ? undefined : row.closeTime,
    closesNextDay: !row.closed && row.closesNextDay,
  };
}
