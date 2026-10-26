// Format a UTC ISO-8601 timestamp in the site's IANA timezone.
// A bad timezone or timestamp never throws: the time falls back to UTC and says so.
export function formatInTimezone(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  const options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" };
  try {
    return new Intl.DateTimeFormat("en-IN", { ...options, timeZone }).format(date);
  } catch {
    return `${new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "UTC" }).format(date)} UTC`;
  }
}

/** The zone itself when it is a valid IANA name, otherwise UTC (never throws). */
export function safeTimeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}
