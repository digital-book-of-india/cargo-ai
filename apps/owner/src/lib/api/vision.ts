import type {
  VisionCountLedgerRow,
  VisionCountSummaryRow,
  VisionMonitoringStatusResponse,
  VisionZone,
  VisionZoneListResponse,
  VisionZoneValidateResponse,
} from "@dbi/api-types";
import type { SaveVisionZoneInput, UpdateVisionZoneInput } from "@dbi/validation";
import { apiRequest } from "./client";

export const visionApi = {
  // --- Zones ---
  listZones: (siteId: string, cameraId?: string, cursor?: string) =>
    apiRequest<VisionZoneListResponse>("/zones", {
      query: { siteId, cameraId, cursor, limit: 50 },
    }),

  getZone: (zoneId: string) =>
    apiRequest<{ zone: VisionZone }>(`/zones/${zoneId}`),

  createZone: (input: SaveVisionZoneInput) =>
    apiRequest<{ zone: VisionZone }>("/zones", {
      method: "POST",
      body: input,
    }),

  updateZone: (zoneId: string, input: UpdateVisionZoneInput) =>
    apiRequest<{ zone: VisionZone }>(`/zones/${zoneId}`, {
      method: "PATCH",
      body: input,
    }),

  validateZone: (zoneId: string) =>
    apiRequest<VisionZoneValidateResponse>(`/zones/${zoneId}/validate`, {
      method: "POST",
    }),

  enableZone: (zoneId: string) =>
    apiRequest<{ zone: VisionZone }>(`/zones/${zoneId}/enable`, {
      method: "POST",
    }),

  // --- Monitoring ---
  getStatus: (siteId: string) =>
    apiRequest<VisionMonitoringStatusResponse>("/monitoring/status", {
      query: { siteId },
    }),

  startMonitoring: (cameraId: string) =>
    apiRequest<{ item: unknown }>(`/monitoring/cameras/${cameraId}/start`, {
      method: "POST",
    }),

  stopMonitoring: (cameraId: string) =>
    apiRequest<{ item: unknown }>(`/monitoring/cameras/${cameraId}/stop`, {
      method: "POST",
    }),

  // --- Counts ---
  getSummary: (siteId: string, groupBy: "zone" | "camera" | "day" | "shift", from: string, to: string) =>
    apiRequest<{ groupBy: string; items: VisionCountSummaryRow[] }>("/counts/summary", {
      query: { siteId, groupBy, from, to },
    }),

  getLedger: (siteId: string, options?: { zoneId?: string; cameraId?: string; cursor?: string }) =>
    apiRequest<{ items: VisionCountLedgerRow[]; nextCursor: string | null }>("/counts/ledger", {
      query: { siteId, ...options, limit: 50 },
    }),
};

