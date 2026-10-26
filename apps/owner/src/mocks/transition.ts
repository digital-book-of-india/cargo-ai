// Mock-only schedule evaluation. The real server owns this logic; the mock needs it so the UI
// can be exercised with values that are derived from the saved schedule (nothing is invented).
import type { Day, DaySchedule } from "@/types";

export interface MockException {
  date: string;
  closed?: boolean;
  openTime?: string;
  closeTime?: string;
  closesNextDay?: boolean;
  note?: string;
}

export interface MockScheduleLike {
  weeklySchedule: DaySchedule[];
  gracePeriodMinutes: number;
  exceptions?: MockException[];
}

const DAY_BY_UTC_INDEX: Day[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const MINUTES_PER_DAY = 24 * 60;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

function toMinutes(hhmm?: string): number | null {
  if (!hhmm || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function localParts(timeZone: string, at: Date) {
  const parts = formatter(timeZone).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function dayKeyOf(date: string): Day {
  const [y, m, d] = date.split("-").map(Number);
  return DAY_BY_UTC_INDEX[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function previousDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 1, d - 1));
  const mm = String(prev.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(prev.getUTCDate()).padStart(2, "0");
  return `${prev.getUTCFullYear()}-${mm}-${dd}`;
}

interface DayConfig {
  closed: boolean;
  open: number | null;
  close: number | null;
  nextDay: boolean;
}

function configFor(s: MockScheduleLike, date: string): DayConfig {
  const ex = s.exceptions?.find((e) => e.date === date);
  if (ex) {
    const open = toMinutes(ex.openTime);
    const close = toMinutes(ex.closeTime);
    return { closed: ex.closed === true || open === null || close === null, open, close, nextDay: !!ex.closesNextDay };
  }
  const d = s.weeklySchedule.find((x) => x.day === dayKeyOf(date));
  if (!d) return { closed: true, open: null, close: null, nextDay: false };
  const open = toMinutes(d.openTime);
  const close = toMinutes(d.closeTime);
  return { closed: !!d.closed || open === null || close === null, open, close, nextDay: !!d.closesNextDay };
}

// true while the shop is expected to be open (monitoring disarmed), including the grace period.
export function isOpenAt(s: MockScheduleLike, timeZone: string, at: Date = new Date()): boolean {
  const { date, minutes } = localParts(timeZone, at);
  const grace = s.gracePeriodMinutes;

  const today = configFor(s, date);
  if (!today.closed && today.open !== null && today.close !== null) {
    if (today.nextDay) {
      if (minutes >= today.open) return true;
    } else if (minutes >= today.open && minutes < today.close + grace && minutes < MINUTES_PER_DAY) {
      return true;
    }
  }

  // the previous day can still be open: an overnight close, or a grace period past midnight
  const yesterday = configFor(s, previousDate(date));
  if (!yesterday.closed && yesterday.open !== null && yesterday.close !== null) {
    const closesAt = yesterday.close + grace;
    if (yesterday.nextDay) {
      if (minutes < closesAt) return true;
    } else if (closesAt > MINUTES_PER_DAY && minutes < closesAt - MINUTES_PER_DAY) {
      return true;
    }
  }
  return false;
}

// First minute (UTC ISO-8601) at which the expected state flips, searched up to 8 days ahead.
// Returns undefined when it never flips in that window (for example every day is closed).
export function nextTransitionAt(
  s: MockScheduleLike,
  timeZone: string,
  from: Date = new Date()
): string | undefined {
  const start = new Date(Math.floor(from.getTime() / 60000) * 60000);
  const current = isOpenAt(s, timeZone, start);
  for (let i = 1; i <= 8 * MINUTES_PER_DAY; i++) {
    const t = new Date(start.getTime() + i * 60000);
    if (isOpenAt(s, timeZone, t) !== current) return t.toISOString();
  }
  return undefined;
}
