// Plain-language names for audit actions. An unknown action is shown readable, not hidden.

const LABELS: Record<string, string> = {
  SITE_CREATED: "Site created",
  SITE_UPDATED: "Site changed",
  SITE_ARCHIVED: "Site archived",
  COMPANY_UPDATED: "Company details changed",
  COMPANY_SETTINGS_UPDATED: "Company settings changed",
  COMPANY_SUSPENDED: "Company suspended",
  COMPANY_ACTIVATED: "Company reactivated",
  EVENTS_EXPORTED: "Events exported",
  EVIDENCE_ACCESSED: "Evidence viewed",
  SUPPORT_EVIDENCE_ACCESS_GRANTED: "Support staff opened evidence",
  MANIFEST_CREATED: "Manifest created",
  MANIFEST_UPDATED: "Manifest changed",
  MANIFEST_IMPORTED: "Manifests imported",
  MANIFEST_IMPORT_FAILED: "Manifest import failed",
  VEHICLE_CREATED: "Vehicle added",
  VEHICLE_UPDATED: "Vehicle changed",
  LOADING_SESSION_STARTED: "Loading session started",
  LOADING_SESSION_CLOSED: "Loading session closed",
};

export function auditLabel(action: string): string {
  if (LABELS[action]) return LABELS[action];
  const words = action.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// The first dates of a report range from <input type="date"> values, in the viewer's own zone.
export function dayStart(value: string): string {
  return new Date(`${value}T00:00:00`).toISOString();
}
export function dayEnd(value: string): string {
  return new Date(`${value}T23:59:59.999`).toISOString();
}
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
