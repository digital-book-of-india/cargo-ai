// API contract types. Update here when the contract changes.

// System-level role on the User record. Company-scoped roles live on CompanyMember.
export type Role = "PLATFORM_ADMIN" | "USER";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION";

export type CompanyRole =
  | "COMPANY_OWNER"
  | "COMPANY_ADMIN"
  | "WAREHOUSE_MANAGER"
  | "SECURITY_OPERATOR"
  | "AUDITOR";

export const COMPANY_ROLES: readonly CompanyRole[] = [
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "WAREHOUSE_MANAGER",
  "SECURITY_OPERATOR",
  "AUDITOR",
];

export type MemberStatus = "ACTIVE" | "DISABLED";
export type CompanyStatus = "ACTIVE" | "SUSPENDED";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export interface Company {
  id: string;
  name: string;
  status: CompanyStatus;
  timezone: string;
  demo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// What the signed-in user may do in one company. siteIds only matters for roles that are
// limited to assigned sites; owners and admins always see every site of their company.
export interface CompanyMembership {
  companyId: string;
  companyName: string;
  role: CompanyRole;
  status: MemberStatus;
  siteIds: string[];
}

export interface CompanyMember {
  userId: string;
  name: string;
  email: string;
  role: CompanyRole;
  status: MemberStatus;
  siteIds: string[];
  createdAt?: string;
}

export type SiteStatus = "ACTIVE" | "INACTIVE" | "ARCHIVED";

export interface SiteAddress {
  city?: string;
  state?: string;
  postalCode?: string;
}

// A physical warehouse / loading location that belongs to one company.
export interface Site {
  id: string;
  companyId: string;
  name: string;
  code: string; // unique within the company
  timezone: string;
  address?: SiteAddress;
  status: SiteStatus;
  demo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type CameraStatus = "PENDING_TEST" | "ONLINE" | "OFFLINE" | "ERROR";

// Safe fields only. Never the stream URL or credentials.
export interface Camera {
  id: string;
  companyId: string;
  siteId: string;
  name: string;
  protocol: "RTSP" | "ONVIF";
  status: CameraStatus;
  /** what the camera is really doing now: a camera whose last report is old is not shown as online */
  effectiveStatus: CameraStatus | "DEGRADED";
  isStale: boolean;
  lastFrameAt: string | null;
  lastHealthAt?: string | null;
  lastErrorCode?: string | null;
  createdAt?: string;
}

export interface Point {
  x: number; // 0..1
  y: number; // 0..1
}

export type ZoneType = "SHUTTER" | "GATE" | "ENTRANCE" | "CUSTOM";
export type ZoneSensitivity = "LOW" | "MEDIUM" | "HIGH";

export interface Zone {
  id?: string;
  cameraId: string;
  companyId: string;
  siteId: string;
  zoneType: ZoneType;
  polygon: Point[];
  sensitivity: ZoneSensitivity;
  enabled: boolean;
  updatedAt?: string;
}

export interface AppNotification {
  id: string;
  eventId?: string;
  recipientUserId: string;
  channel: "PUSH" | "IN_APP";
  /** PENDING = waiting for delivery or a retry, SENT = delivered, FAILED = gave up after the last retry */
  status: "PENDING" | "SENT" | "FAILED";
  readAt: string | null;
  createdAt: string;
  /** what the notification is about; null when the event is no longer visible to this person */
  event: {
    id: string;
    siteId: string;
    siteName: string;
    eventType: CargoEventType;
    severity: CargoEventSeverity;
    status: CargoEventStatus;
    summary: string;
    occurredAt: string;
  } | null;
}

export interface EventSummaryCounts {
  total: number;
  byStatus: Record<CargoEventStatus, number>;
  bySeverity: Record<CargoEventSeverity, number>;
}

export interface EventAssignee {
  id: string;
  name: string;
  role: CompanyRole;
}

export interface AuditLog {
  id: string;
  companyId?: string | null;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AdminKpis {
  totalCompanies: number;
  totalSites: number;
  activeSites: number;
  onlineCameras: number;
  recentAlertsCount: number;
  aiWorkerStatus: "ONLINE" | "DEGRADED" | "OFFLINE";
}

// Request & Response DTOs

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  companyName?: string;
}

export interface AuthResponse {
  user: User;
  memberships: CompanyMembership[];
  token: string;
}

export interface MeResponse {
  user: User;
  memberships: CompanyMembership[];
  activeCompanyId: string | null;
}

export interface UpdateCompanyRequest {
  name?: string;
  timezone?: string;
}

export interface CreateSiteRequest {
  name: string;
  code: string;
  timezone?: string;
  address?: SiteAddress;
}

export interface UpdateSiteRequest {
  name?: string;
  code?: string;
  timezone?: string;
  address?: SiteAddress;
  status?: "ACTIVE" | "INACTIVE";
}

export interface InviteUserRequest {
  email: string;
  role: CompanyRole;
  siteIds?: string[];
}

// The one-time token is returned once (no email service yet); only its hash is stored.
export interface InvitationResponse {
  id: string;
  email: string;
  role: CompanyRole;
  siteIds: string[];
  expiresAt: string;
  token: string;
}

export interface AcceptInvitationRequest {
  token: string;
  name: string;
  password: string;
}

export interface ChangeMemberRoleRequest {
  role: CompanyRole;
  siteIds?: string[];
}

export interface ChangeMemberStatusRequest {
  status: MemberStatus;
}

export interface AssignCameraSiteRequest {
  siteId: string;
}

export interface RegisterCameraRequest {
  name: string;
  protocol: "RTSP" | "ONVIF";
  host: string;
  port?: number;
  username?: string;
  password?: string;
  path?: string;
}

export interface UpdateCameraRequest {
  name?: string;
  protocol?: "RTSP" | "ONVIF";
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  path?: string;
}

export interface SaveZoneRequest {
  zoneType: ZoneType;
  polygon: Point[];
  sensitivity: ZoneSensitivity;
  enabled: boolean;
}

export interface UpdateSiteStatusRequest {
  status: "ACTIVE" | "INACTIVE";
  reason: string;
}

export interface UpdateCompanyStatusRequest {
  status: CompanyStatus;
  reason: string;
}

export interface UpdateProfileRequest {
  name?: string;
}

export interface AiEventSubmissionRequest {
  eventKey: string; // idempotency key, unique per company
  companyId?: string; // optional; verified against the camera's real company, never trusted
  siteId: string;
  cameraId: string;
  zoneId?: string | null;
  eventType: CargoEventType;
  severity?: CargoEventSeverity;
  summary?: string;
  occurredAt: string;
  track?: { trackId?: string; class?: string; confidence?: number; bbox?: number[] };
  movement?: { direction: "IN" | "OUT" | "UNKNOWN"; countDelta?: number };
  evidence?: { snapshotObjectKey?: string | null; clipObjectKey?: string | null };
  model?: { name?: string; version?: string };
}

export interface AiHealthHeartbeatRequest {
  serviceName: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  timestamp?: string;
  activeStreams?: number;
}

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string };
}

export interface ApiResponse<T> {
  data: T;
}

export interface Paginated<T> {
  items: T[];
  nextCursor?: string | null;
  total?: number;
}

// ---------------------------------------------------------------------------------------------
// Cargo events (requirements sections 8.4, 8.5, 10.1, 17)
// ---------------------------------------------------------------------------------------------

export const CARGO_EVENT_TYPES = [
  "package_detected",
  "package_line_crossing",
  "zone_entry",
  "zone_exit",
  "restricted_zone_movement",
  "unusual_after_hours_movement",
  "count_mismatch",
  "possible_package_damage",
  "possible_seal_appearance_change",
  "camera_offline",
  "ai_service_unavailable",
] as const;
export type CargoEventType = (typeof CARGO_EVENT_TYPES)[number];

export const CARGO_EVENT_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type CargoEventSeverity = (typeof CARGO_EVENT_SEVERITIES)[number];

export const CARGO_EVENT_STATUSES = [
  "open",
  "acknowledged",
  "in_review",
  "resolved",
  "false_positive",
  "escalated",
] as const;
export type CargoEventStatus = (typeof CARGO_EVENT_STATUSES)[number];

// Outcome names are deliberately neutral: none of them asserts theft or loss.
export const RESOLVE_OUTCOMES = [
  "confirmed_operational",
  "reviewed_no_issue",
  "false_positive",
  "escalated",
  "unresolved_other",
] as const;
export type ResolveOutcome = (typeof RESOLVE_OUTCOMES)[number];

export interface CargoEventEvidenceInfo {
  snapshotAvailable: boolean;
  clipAvailable: boolean;
  /** short-lived signed links, only present on the detail view */
  snapshotUrl?: string;
  clipUrl?: string;
  expiresAt?: string;
}

export interface CargoEventSummary {
  id: string;
  eventKey: string;
  eventType: CargoEventType;
  severity: CargoEventSeverity;
  status: CargoEventStatus;
  summary: string;
  occurredAt: string;
  siteId: string;
  cameraId: string;
  zoneId?: string | null;
  loadingSessionId?: string | null;
  site: { id: string; name: string };
  camera: { id: string; name: string };
  assignedTo?: { id: string; name: string } | null;
  evidence: CargoEventEvidenceInfo;
  demo?: boolean;
}

export interface EventHistoryEntry {
  id: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  actor?: { id: string; name: string } | null;
  createdAt: string;
}

export interface EventNote {
  id: string;
  note: string;
  author: { id: string; name: string };
  createdAt: string;
}

export interface CargoEventDetail extends CargoEventSummary {
  companyId: string;
  payload: Record<string, unknown>;
  model?: { name?: string; version?: string } | null;
  resolution?: { outcome: ResolveOutcome; note?: string | null; resolvedAt: string; resolvedBy?: { id: string; name: string } | null } | null;
  history: EventHistoryEntry[];
  notes: EventNote[];
}

export interface ResolveEventRequest {
  outcome: ResolveOutcome;
  note?: string;
}

export interface AssignEventRequest {
  userId: string | null;
  note?: string;
}

export interface AddEventNoteRequest {
  note: string;
}

export interface FalsePositiveRequest {
  reason: string;
}

export interface ReopenEventRequest {
  note: string;
}

export * from "./permissions";
export * from "./settings";
export * from "./shipments";

// Vision (zones, events, monitoring)
export * from "./vision";
export * from "./vision-events";
export * from "./vision-monitoring";
