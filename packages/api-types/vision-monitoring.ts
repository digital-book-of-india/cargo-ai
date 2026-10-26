// Dev 2 (Vision) monitoring contract types.
import type { VisionGeometry, VisionZoneRules, VisionZoneType } from "./vision";

export type VisionStreamStatus = "UNKNOWN" | "STREAMING" | "RECONNECTING" | "ERROR";
export type VisionCoverage = "LIVE" | "DEGRADED" | "OFFLINE" | "NOT_MONITORED";
export type VisionWorkerStatus = "ONLINE" | "DEGRADED" | "OFFLINE" | "UNKNOWN";
export type VisionLimitation =
  | "MONITORING_DISABLED"
  | "NO_ACTIVE_ZONE"
  | "NO_FRAME_REPORTED"
  | "STREAM_STALE"
  | "STREAM_RECONNECTING"
  | "STREAM_ERROR"
  | "WORKER_UNAVAILABLE";

export interface VisionCameraMonitoringStatus {
  cameraId: string;
  cameraName: string;
  enabled: boolean;
  coverage: VisionCoverage;
  limitations: VisionLimitation[];
  streamStatus: VisionStreamStatus;
  streamErrorCode: string | null;
  lastFrameAt: string | null;
  frameRate: number | null;
  activeZoneCount: number;
  workerId: string | null;
  workerStatus: VisionWorkerStatus;
  workerLastHeartbeatAt: string | null;
}

export interface VisionMonitoringStatusResponse {
  checkedAt: string;
  items: VisionCameraMonitoringStatus[];
}

export interface VisionWorkerZone {
  id: string;
  zoneType: VisionZoneType;
  geometry: VisionGeometry;
  rules: VisionZoneRules;
}

export interface VisionWorkerConfig {
  workerId: string;
  heartbeatIntervalSeconds: number;
  cameras: Array<{ cameraId: string; siteId: string; zones: VisionWorkerZone[] }>;
}