// Dev 2 (Vision) contract types. Aligned to "AI Cargo & Shipment Security" spec v1.0.
// Owned by Dev 2. Dev 1 / Dev 3 types stay in index.ts.

export type VisionZoneType = "polygon" | "counting_line" | "loading_bay" | "restricted" | "storage";
export type VisionZoneStatus = "draft" | "active" | "disabled" | "archived";
export type VisionZoneValidationStatus = "pending" | "valid" | "invalid";
export type VisionObjectClass = "package" | "box" | "pallet";
export type VisionCountDirection = "A_TO_B" | "B_TO_A" | "EITHER";

// [x, y], both 0..1 in the camera image (origin top-left).
export type VisionPoint = [number, number];

export type VisionGeometry =
  | { coordinateSpace: "normalized_0_1"; line: [VisionPoint, VisionPoint] }
  | { coordinateSpace: "normalized_0_1"; polygon: VisionPoint[] };

export interface VisionAfterHours {
  enabled: boolean;
  start: string; // "HH:mm", site timezone
  end: string; // "HH:mm", site timezone
}

export interface VisionZoneRules {
  objectClasses: VisionObjectClass[];
  minimumConfidence: number; // 0..1
  countDirection?: VisionCountDirection; // counting_line only
  countOncePerTrackPerRule: boolean;
  afterHours?: VisionAfterHours;
}

export interface VisionZone {
  id: string;
  siteId: string;
  cameraId: string;
  name: string;
  zoneType: VisionZoneType;
  geometry: VisionGeometry;
  rules: VisionZoneRules;
  status: VisionZoneStatus;
  validationStatus: VisionZoneValidationStatus;
  validationIssues: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface VisionZoneListResponse {
  items: VisionZone[];
  nextCursor: string | null;
}

export interface VisionZoneValidateResponse {
  zone: VisionZone;
  passed: boolean;
}