import { apiRequest, apiRequestList, PaginationMeta } from "./client";

export type { PaginationMeta };

export interface OverviewData {
  kpis: {
    totalCompanies: number;
    suspendedCompanies: number;
    totalSites: number;
    activeSites: number;
    inactiveSites: number;
    totalCameras: number;
    onlineCameras: number;
    cameraOnlineRate: number | null;
    unreviewedAlerts: number;
  };
  aiWorker: {
    status: "ONLINE" | "DEGRADED" | "OFFLINE" | "UNKNOWN";
    lastHeartbeatAt: string | null;
    isStale: boolean;
  };
  recentEvents: Array<{
    eventId: string;
    siteName: string;
    eventType: string;
    occurredAt: string | null;
    severity: string;
    status: string;
    summary: string;
    demoFlag: boolean;
  }>;
  recentAuditActivity: Array<{
    actor: { name: string; email: string };
    action: string;
    targetType: string;
    targetId: string;
    reason: string;
    createdAt: string | null;
  }>;
}

export interface CompanyItem {
  id: string;
  name: string;
  status: "ACTIVE" | "SUSPENDED";
  timezone: string;
  siteCount: number;
  memberCount: number;
  owner: { id: string; name: string; email: string } | null;
  demoFlag?: boolean;
  createdAt: string;
}

export interface SiteItem {
  _id: string;
  name: string;
  code: string;
  timezone: string;
  address?: { city?: string; state?: string; postalCode?: string };
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  company: { id: string; name: string } | null;
  demoFlag?: boolean;
  createdAt: string;
}

export interface CameraHealthItem {
  cameraId: string;
  siteId: string;
  siteName: string;
  companyId: string;
  name: string;
  protocol: string;
  rawStatus: string;
  effectiveStatus: "ONLINE" | "DEGRADED" | "OFFLINE" | "ERROR" | "PENDING_TEST";
  isStale: boolean;
  lastFrameAt: string | null;
  lastHealthAt: string | null;
  lastErrorCode: string | null;
  demoFlag?: boolean;
}

export interface AuditLogItem {
  _id: string;
  actor: { id: string; name: string; email: string };
  action: string;
  targetType: string;
  targetId: string;
  companyId: string | null;
  reason: string;
  requestId: string;
  createdAt: string | null;
}

type ListQuery = { page?: number; limit?: number; search?: string; status?: string; companyId?: string };

export async function getAdminOverview(): Promise<OverviewData> {
  return apiRequest<OverviewData>("/admin/overview");
}

export async function getAdminCompanies(query?: ListQuery) {
  return apiRequestList<{ companies: CompanyItem[] }>("/admin/companies", { query: query as any });
}

export async function updateCompanyStatus(companyId: string, status: "ACTIVE" | "SUSPENDED", reason: string) {
  return apiRequest<any>(`/admin/companies/${companyId}/status`, {
    method: "PATCH",
    body: { status, reason },
  });
}

export async function getAdminSites(query?: ListQuery) {
  return apiRequestList<{ sites: SiteItem[] }>("/admin/sites", { query: query as any });
}

export async function updateSiteStatus(siteId: string, status: "ACTIVE" | "INACTIVE", reason: string) {
  return apiRequest<any>(`/admin/sites/${siteId}/status`, {
    method: "PATCH",
    body: { status, reason },
  });
}

export async function getAdminHealth(query?: { page?: number; limit?: number; status?: string }) {
  return apiRequestList<{ cameras: CameraHealthItem[]; aiWorker: any }>("/admin/cameras/health", {
    query: query as any,
  });
}

export async function getAdminAuditLogs(query?: {
  page?: number;
  limit?: number;
  actorUserId?: string;
  companyId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  startDate?: string;
  endDate?: string;
}) {
  return apiRequestList<{ auditLogs: AuditLogItem[] }>("/admin/audit-logs", { query: query as any });
}

export interface SupportEvidenceLink {
  url: string; // path on the API host
  expiresAt: string;
}

export async function requestSupportEvidenceLink(input: { eventId: string; kind: "snapshot" | "clip"; reason: string }) {
  return apiRequest<SupportEvidenceLink>("/admin/support/evidence-link", { method: "POST", body: input });
}
