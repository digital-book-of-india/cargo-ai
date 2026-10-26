import { Day, DaySchedule, DesiredSecurityState, Schedule } from "@dbi/api-types";

const DAY_MAP: Record<string, Day> = {
  Sun: "SUN",
  Mon: "MON",
  Tue: "TUE",
  Wed: "WED",
  Thu: "THU",
  Fri: "FRI",
  Sat: "SAT",
};

const DAY_ORDER: Day[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export interface ScheduleEvaluationResult {
  desiredState: DesiredSecurityState;
  reason: string;
  isOpen: boolean;
  isGracePeriod: boolean;
  nextTransitionAt: string; // ISO UTC
}

function parseTimeToMinutes(timeStr?: string): number | null {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

export function getLocalTimeInTimezone(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);

    const partMap: Record<string, string> = {};
    for (const p of parts) {
      partMap[p.type] = p.value;
    }

    const dayName = DAY_MAP[partMap.weekday] ?? "MON";
    const hour = parseInt(partMap.hour, 10);
    const minute = parseInt(partMap.minute, 10);
    const currentMinutes = hour * 60 + minute;
    const dateStr = `${partMap.year}-${partMap.month}-${partMap.day}`;

    return { dayName, hour, minute, currentMinutes, dateStr };
  } catch {
    // Fallback to UTC if timezone invalid
    const dayName = DAY_ORDER[(date.getUTCDay() + 6) % 7];
    const currentMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    const dateStr = date.toISOString().split("T")[0];
    return { dayName, hour: date.getUTCHours(), minute: date.getUTCMinutes(), currentMinutes, dateStr };
  }
}

export function evaluateSchedule(
  schedule: Schedule,
  timezone: string = "Asia/Kolkata",
  now: Date = new Date()
): ScheduleEvaluationResult {
  const { dayName, currentMinutes, dateStr } = getLocalTimeInTimezone(now, timezone);

  // 1. Check for date exceptions first (holidays, special hours)
  const exception = schedule.exceptions?.find((e) => e.date === dateStr);
  if (exception) {
    if (exception.closed) {
      return {
        desiredState: "ARMED",
        reason: `CLOSED_BY_EXCEPTION (${exception.note ?? "Holiday"})`,
        isOpen: false,
        isGracePeriod: false,
        nextTransitionAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      };
    }
  }

  // 2. Weekly schedule lookup
  const todaySchedule = schedule.weeklySchedule.find((s) => s.day === dayName);

  // Check previous day for overnight spillover (e.g., open 22:00 to 02:00 closesNextDay)
  const todayIdx = DAY_ORDER.indexOf(dayName);
  const prevDay = DAY_ORDER[(todayIdx + 6) % 7];
  const prevDaySchedule = schedule.weeklySchedule.find((s) => s.day === prevDay);

  let isOpen = false;
  let isGracePeriod = false;
  let reason = "AFTER_CLOSING";

  const gracePeriod = schedule.gracePeriodMinutes ?? 5;

  // Check if yesterday had overnight hours spilling into today
  if (prevDaySchedule && !prevDaySchedule.closed && prevDaySchedule.closesNextDay) {
    const prevCloseMinutes = parseTimeToMinutes(prevDaySchedule.closeTime);
    if (prevCloseMinutes !== null) {
      if (currentMinutes < prevCloseMinutes) {
        isOpen = true;
        reason = "SHOP_OPEN_OVERNIGHT";
      } else if (currentMinutes < prevCloseMinutes + gracePeriod) {
        isGracePeriod = true;
        reason = "CLOSING_GRACE_PERIOD";
      }
    }
  }

  // Check today's schedule
  if (!isOpen && !isGracePeriod && todaySchedule && !todaySchedule.closed) {
    const openMinutes = parseTimeToMinutes(todaySchedule.openTime);
    const closeMinutes = parseTimeToMinutes(todaySchedule.closeTime);

    if (openMinutes !== null && closeMinutes !== null) {
      if (todaySchedule.closesNextDay) {
        // e.g. open at 20:00, closes next day at 02:00
        if (currentMinutes >= openMinutes) {
          isOpen = true;
          reason = "SHOP_OPEN";
        }
      } else {
        // Standard same-day open/close
        if (currentMinutes >= openMinutes && currentMinutes < closeMinutes) {
          isOpen = true;
          reason = "SHOP_OPEN";
        } else if (
          currentMinutes >= closeMinutes &&
          currentMinutes < closeMinutes + gracePeriod
        ) {
          isGracePeriod = true;
          reason = "CLOSING_GRACE_PERIOD";
        }
      }
    }
  }

  const desiredState: DesiredSecurityState = isOpen || isGracePeriod ? "DISARMED" : "ARMED";

  // Approximate next transition (simplified UTC calculation)
  const nextTransitionDate = new Date(now.getTime() + (isOpen ? 120 : 60) * 60 * 1000);

  return {
    desiredState,
    reason: isOpen ? "SHOP_OPEN" : isGracePeriod ? "CLOSING_GRACE_PERIOD" : "AFTER_CLOSING",
    isOpen,
    isGracePeriod,
    nextTransitionAt: nextTransitionDate.toISOString(),
  };
}
