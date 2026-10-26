// Local-time helpers for reports. A report day and a shift are defined in the SITE's time zone
// (requirements QA-11), never in the server's or the viewer's.

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
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

export interface LocalParts {
  /** calendar date in the zone, YYYY-MM-DD */
  date: string;
  /** minutes since local midnight, 0..1439 */
  minutes: number;
  /** local wall-clock time, YYYY-MM-DD HH:mm */
  text: string;
}

export function localParts(at: Date, timeZone: string): LocalParts {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = formatterFor(timeZone).formatToParts(at);
  } catch {
    parts = formatterFor("UTC").formatToParts(at); // an invalid stored zone must not break a report
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  return { date, minutes: hour * 60 + minute, text: `${date} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
}
