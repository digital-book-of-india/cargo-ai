// IANA timezone helpers for the shop form.

export interface TimezoneOption {
  value: string;
  label: string;
}

const COMMON = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Dhaka",
  "Asia/Karachi",
  "Asia/Kathmandu",
  "Europe/London",
  "America/New_York",
  "UTC",
];

export const DEFAULT_TIMEZONE = "Asia/Kolkata";

export function isValidTimezone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function offsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function labelFor(tz: string): string {
  const offset = offsetLabel(tz);
  return offset ? `${tz} (${offset})` : tz;
}

let cache: TimezoneOption[] | null = null;

// Common zones first, then every zone the runtime knows. `include` keeps a
// stored value selectable even if the runtime does not list it.
export function getTimezoneOptions(include?: string): TimezoneOption[] {
  if (!cache) {
    let all: string[] = [];
    try {
      const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
      all = fn ? fn("timeZone") : [];
    } catch {
      all = [];
    }
    const rest = all.filter((z) => !COMMON.includes(z)).sort();
    cache = [...COMMON, ...rest].map((value) => ({ value, label: labelFor(value) }));
  }
  if (include && !cache.some((o) => o.value === include)) {
    return [{ value: include, label: labelFor(include) }, ...cache];
  }
  return cache;
}
