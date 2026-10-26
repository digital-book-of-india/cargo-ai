import { apiRequest, apiRequestList, USE_MOCKS, PaginationMeta } from "./client";

export type { PaginationMeta };

export interface OverviewData {
  kpis: {
    totalShops: number;
    activeShops: number;
    suspendedShops: number;
    totalCameras: number;
    onlineCameras: number;
    cameraOnlineRate: number | null;
    activeMonitoringShops: number;
    unreviewedAlerts: number;
  };
  aiWorker: {
    status: "ONLINE" | "OFFLINE" | "UNKNOWN";
    lastHeartbeatAt: string | null;
    isStale: boolean;
  };
  recentEvents: Array<{
    eventId: string;
    shopName: string;
    eventType: string;
    startedAt: string | null;
    reviewStatus: string;
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

export interface ShopItem {
  _id: string;
  name: string;
  timezone: string;
  address?: { city?: string; state?: string; postalCode?: string };
  status: "ACTIVE" | "PENDING_SETUP" | "SUSPENDED";
  owner?: { id: string; name: string; email: string };
  demoFlag?: boolean;
  createdAt: string;
}

export interface OwnerItem {
  _id: string;
  name: string;
  email: string;
  status: string;
  shopCount: number;
  createdAt: string;
}

export interface CameraHealthItem {
  cameraId: string;
  shopId: string;
  shopName: string;
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
  reason: string;
  requestId: string;
  createdAt: string | null;
}

export async function getAdminOverview(): Promise<OverviewData> {
  if (USE_MOCKS) {
    return {
      kpis: {
        totalShops: 12,
        activeShops: 8,
        suspendedShops: 1,
        totalCameras: 15,
        onlineCameras: 13,
        cameraOnlineRate: 87,
        activeMonitoringShops: 7,
        unreviewedAlerts: 3,
      },
      aiWorker: { status: "ONLINE", lastHeartbeatAt: new Date().toISOString(), isStale: false },
      recentEvents: [
        {
          eventId: "evt_demo_101",
          shopName: "Central Market Shutter",
          eventType: "POSSIBLE_SHUTTER_INTERACTION",
          startedAt: new Date(Date.now() - 15 * 60000).toISOString(),
          reviewStatus: "NEW",
          demoFlag: true,
        },
      ],
      recentAuditActivity: [
        {
          actor: { name: "Super Admin", email: "admin@dbi-intelligence.com" },
          action: "SHOP_ACTIVATED",
          targetType: "Shop",
          targetId: "shop_demo_01",
          reason: "Manual inspection verified",
          createdAt: new Date().toISOString(),
        },
      ],
    };
  }
  return apiRequest<OverviewData>("/admin/overview");
}

export async function getAdminShops(query?: { page?: number; limit?: number; search?: string; status?: string }) {
  if (USE_MOCKS) {
    return {
      shops: [
        {
          _id: "shop_01",
          name: "Main Street General Store",
          timezone: "Asia/Kolkata",
          address: { city: "Delhi", state: "Delhi" },
          status: "ACTIVE" as const,
          owner: { id: "usr_01", name: "Rahul Verma", email: "rahul@example.com" },
          demoFlag: true,
          createdAt: new Date().toISOString(),
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
  }

  return apiRequestList<{ shops: ShopItem[] }>("/admin/shops", { query: query as any });
}

export async function updateShopStatus(shopId: string, status: "ACTIVE" | "SUSPENDED", reason: string) {
  if (USE_MOCKS) {
    return {
      shopId,
      requestedStatus: status,
      appliedStatus: status,
      updatedAt: new Date().toISOString(),
    };
  }

  return apiRequest<any>(`/admin/shops/${shopId}/status`, {
    method: "PATCH",
    body: { status, reason },
  });
}

export async function getAdminOwners(query?: { page?: number; limit?: number; search?: string; status?: string }) {
  if (USE_MOCKS) {
    return {
      owners: [
        {
          _id: "usr_01",
          name: "Rahul Verma",
          email: "rahul@example.com",
          status: "ACTIVE",
          shopCount: 1,
          createdAt: new Date().toISOString(),
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
  }

  return apiRequestList<{ owners: OwnerItem[] }>("/admin/owners", { query: query as any });
}

export async function getAdminHealth(query?: { page?: number; limit?: number; status?: string }) {
  if (USE_MOCKS) {
    return {
      aiWorker: { status: "ONLINE" as const, lastHeartbeatAt: new Date().toISOString(), isStale: false },
      cameras: [
        {
          cameraId: "cam_101",
          shopId: "shop_01",
          shopName: "Main Street Store",
          name: "Front Shutter Cam",
          protocol: "RTSP",
          rawStatus: "ONLINE",
          effectiveStatus: "ONLINE" as const,
          isStale: false,
          lastFrameAt: new Date().toISOString(),
          lastHealthAt: new Date().toISOString(),
          lastErrorCode: null,
          demoFlag: true,
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
  }

  return apiRequestList<{ cameras: CameraHealthItem[]; aiWorker: any }>("/admin/cameras/health", { query: query as any });
}

export async function getAdminAuditLogs(query?: {
  page?: number;
  limit?: number;
  actorUserId?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  startDate?: string;
  endDate?: string;
}) {
  if (USE_MOCKS) {
    return {
      auditLogs: [
        {
          _id: "log_101",
          actor: { id: "usr_superadmin_01", name: "Super Admin", email: "admin@dbi-intelligence.com" },
          action: "SHOP_SUSPENDED",
          targetType: "Shop",
          targetId: "shop_01",
          reason: "Non-compliance review",
          requestId: "req_demo_01",
          createdAt: new Date().toISOString(),
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
  }

  return apiRequestList<{ auditLogs: AuditLogItem[] }>("/admin/audit-logs", { query: query as any });
}