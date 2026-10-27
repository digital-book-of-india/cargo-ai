import type { LoadingSession } from "@/types";
import { apiDownload, apiRequest } from "./client";

export interface ReportQuery {
  from: string;
  to: string;
  siteId?: string;
  eventType?: string;
  shift?: string;
}

export interface CargoActivityReport {
  range: { from: string; to: string };
  timezoneNote: string;
  /** true when more events matched than the report scans; narrow the filters */
  truncated: boolean;
  totals: { events: number; bySeverity: Record<string, number>; byType: Record<string, number> };
  bySite: Array<{ siteId: string; siteName: string; events: number }>;
  days: Array<{ date: string; events: number; coverageGap: boolean; byType: Record<string, number> }>;
  coverageGaps: Array<{
    eventId: string;
    siteName: string;
    cameraName: string;
    eventType: string;
    occurredAt: string;
    localTime: string;
    timezone: string;
  }>;
  sessions: {
    total: number;
    open: number;
    matched: number;
    reviewRequired: number;
    unverified: number;
    withCoverageGap: number;
    expectedPackages: number;
    observedPackages: number;
  };
}

export type MismatchItem = LoadingSession & { closedAtLocal: string | null; timezone: string; eventStatus: string | null };

export interface AuditEntry {
  id: string;
  action: string;
  actor: { id: string; name: string };
  targetType: string;
  targetId: string;
  reason: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

type Query = Record<string, string | number | undefined>;
const clean = (q: Query): Query => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== "" && v !== undefined));

export const reportsApi = {
  activity: (q: ReportQuery) => apiRequest<CargoActivityReport>("/reports/cargo-activity", { query: clean({ ...q }) }),
  mismatches: async (q: ReportQuery) =>
    (await apiRequest<{ items: MismatchItem[] }>("/reports/mismatches", { query: clean({ ...q }) })).items,

  // The export is a file, so it is fetched as a blob with the session cookie.
  exportEvents: (q: ReportQuery): Promise<{ blob: Blob; fileName: string }> =>
    apiDownload("/reports/events/export", clean({ ...q }), "events.csv"),
};

export const auditApi = {
  list: (q: { action?: string; from?: string; to?: string; cursor?: string; limit?: number } = {}) =>
    apiRequest<{ items: AuditEntry[]; nextCursor: string | null }>("/audit-logs", { query: clean({ ...q }) }),
};
