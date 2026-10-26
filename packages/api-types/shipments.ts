// Manifests, vehicles and loading sessions (requirements sections 5.3, 8.6, 9).

export type ManifestStatus = "draft" | "active" | "closed" | "cancelled";
export type ManifestSource = "manual" | "csv_import" | "integration";

export interface Vehicle {
  id: string;
  registrationNumber: string;
  label?: string | null;
  active: boolean;
  createdAt?: string;
}

export interface Manifest {
  id: string;
  reference: string;
  siteId: string;
  site: { id: string; name: string; code: string };
  expectedPackageCount: number;
  source: ManifestSource;
  status: ManifestStatus;
  notes?: string | null;
  createdAt?: string;
}

export type SessionDirection = "inbound" | "outbound";

export type ReconciliationStatus =
  | "not_started"
  | "in_progress"
  | "matched"
  | "review_required"
  | "closed_unverified";

export interface LoadingSession {
  id: string;
  siteId: string;
  site: { id: string; name: string };
  zoneId?: string | null;
  manifestId?: string | null;
  manifest?: { id: string; reference: string; expectedPackageCount: number } | null;
  vehicleId?: string | null;
  vehicle?: { id: string; registrationNumber: string } | null;
  direction: SessionDirection;
  startedAt: string;
  closedAt?: string | null;
  expectedCountSnapshot?: number | null;
  observedCount?: number | null;
  /** observed minus expected: negative means fewer packages were seen than expected */
  difference?: number | null;
  countsBreakdown?: { in: number; out: number } | null;
  reconciliationStatus: ReconciliationStatus;
  toleranceUsed?: number | null;
  closeNote?: string | null;
  /** true when the camera or AI service was down during the session, so the count may be incomplete */
  coverageGap: boolean;
  mismatchEventId?: string | null;
  /** while the session is open: the count seen so far, when the counting service can tell */
  liveObserved?: number | null;
  /** always present: the observed count is an estimate, not proof */
  disclaimer: string;
}

export interface CreateManifestRequest {
  reference: string;
  siteId: string;
  expectedPackageCount: number;
  notes?: string;
}

export interface UpdateManifestRequest {
  expectedPackageCount?: number;
  notes?: string | null;
  status?: "active" | "cancelled";
}

export interface CreateVehicleRequest {
  registrationNumber: string;
  label?: string;
}

export interface CreateLoadingSessionRequest {
  siteId: string;
  zoneId?: string | null;
  manifestId?: string | null;
  vehicleId?: string | null;
  direction: SessionDirection;
  startedAt?: string;
}

export interface CloseLoadingSessionRequest {
  closedAt?: string;
  closeNote?: string;
}

export interface ImportRowError {
  /** the line number in the file, counting the header as line 1 */
  row: number;
  field?: string;
  message: string;
}

export type ImportJobStatus = "COMPLETED" | "PARTIAL" | "FAILED";

export interface ManifestImportJob {
  id: string;
  fileName: string;
  status: ImportJobStatus;
  totalRows: number;
  createdCount: number;
  errors: ImportRowError[];
  /** true when this exact file was already imported: nothing was written again */
  duplicate?: boolean;
  createdAt: string;
}

export interface CloseSessionResult {
  session: LoadingSession;
  mismatchEvent?: { id: string; severity: string; summary: string } | null;
}

export const SESSION_DISCLAIMER =
  "The observed count is an estimate from the configured camera coverage and rules. It is not proof that parcels are missing.";
