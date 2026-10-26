// Dev 2 (Vision) ingestion and count contract types. Aligned to spec v1.0 section 8.3 and Appendix A.

export type VisionEventType =
  | "package_detected"
  | "package_line_crossing"
  | "zone_entry"
  | "zone_exit"
  | "restricted_zone_movement"
  | "unusual_after_hours_movement"
  | "count_mismatch"
  | "possible_package_damage"
  | "possible_seal_appearance_change"
  | "camera_offline"
  | "ai_service_unavailable";

export type VisionMovementDirection = "IN" | "OUT" | "UNKNOWN";

export interface VisionIngestResponse {
  eventId: string;
  ingestionStatus: "accepted" | "duplicate";
}

export interface VisionCountLedgerRow {
  id: string;
  eventKey: string;
  siteId: string;
  cameraId: string;
  zoneId: string;
  trackId: string;
  direction: VisionMovementDirection;
  countDelta: 1;
  confidence: number | null;
  occurredAt: string;
}

export interface VisionCountTotals {
  in: number;
  out: number;
  unknown: number;
  total: number;
}

export interface VisionCountSummaryRow extends VisionCountTotals {
  key: string; // zone id, camera id, or "YYYY-MM-DD" in site timezone
}