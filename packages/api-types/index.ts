// API contract types (source of truth: Dev 3). Update here when the contract changes.

export type Role = "SUPER_ADMIN" | "SHOP_OWNER" | "SHOP_STAFF";
export type UserStatus = "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  createdAt: string;
}

export type ShopStatus = "PENDING_SETUP" | "ACTIVE" | "SUSPENDED";

export interface ShopAddress {
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface Shop {
  id: string;
  ownerId: string;
  name: string;
  timezone: string;
  address?: ShopAddress;
  status: ShopStatus;
  demo?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export type Day = "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT" | "SUN";

export interface DaySchedule {
  day: Day;
  openTime?: string; // local HH:mm
  closeTime?: string; // local HH:mm
  closed: boolean;
  closesNextDay: boolean;
}

export interface ScheduleException {
  date: string; // YYYY-MM-DD
  closed: boolean;
  openTime?: string;
  closeTime?: string;
  closesNextDay?: boolean;
  note?: string;
}

export interface Schedule {
  shopId: string;
  weeklySchedule: DaySchedule[];
  gracePeriodMinutes: number;
  exceptions?: ScheduleException[];
  version: number;
  nextTransitionAt?: string; // UTC ISO-8601
  updatedAt?: string;
}

export type CameraStatus = "PENDING_TEST" | "ONLINE" | "OFFLINE" | "ERROR";

// Safe fields only. Never the stream URL or credentials.
export interface Camera {
  id: string;
  shopId: string;
  name: string;
  protocol: "RTSP" | "ONVIF";
  status: CameraStatus;
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
  shopId: string;
  zoneType: ZoneType;
  polygon: Point[];
  sensitivity: ZoneSensitivity;
  enabled: boolean;
  updatedAt?: string;
}

export type DesiredSecurityState = "ARMED" | "DISARMED";
export type MonitoringState =
  | "MONITORING"
  | "DISARMED"
  | "DEGRADED"
  | "OFFLINE"
  | "SETUP_REQUIRED";

export interface SecurityState {
  shopId: string;
  desiredState: DesiredSecurityState;
  actualMonitoringState: MonitoringState;
  cameraState: string;
  aiWorkerState: string;
  reason: string;
  scheduleVersion?: number;
  evaluatedAt: string;
  changedAt?: string;
}

export type EventType =
  | "PERSON_IN_ZONE"
  | "POSSIBLE_SHUTTER_INTERACTION"
  | "POSSIBLE_TAMPERING"
  | "CAMERA_OFFLINE"
  | "AI_OFFLINE";

export type ReviewStatus = "NEW" | "REVIEWED" | "FALSE_ALARM" | "CONFIRMED";

export interface EventEvidence {
  snapshotObjectKey?: string;
  clipObjectKey?: string;
  snapshotUrl?: string;
  clipUrl?: string;
  expiresAt?: string;
}

export interface SecurityEvent {
  id: string;
  eventId: string;
  shopId: string;
  cameraId: string;
  eventType: EventType;
  confidence?: number;
  startedAt: string;
  endedAt?: string;
  evidence?: EventEvidence;
  reviewStatus: ReviewStatus;
  demoFlag?: boolean;
  modelVersion?: string;
  createdAt?: string;
}

export interface AppNotification {
  id: string;
  eventId?: string;
  recipientUserId: string;
  channel: "PUSH" | "IN_APP";
  status: "PENDING" | "SENT" | "FAILED";
  attempts?: number;
  lastErrorCode?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string;
  requestId?: string;
  createdAt: string;
}

export interface AdminKpis {
  totalShops: number;
  activeShops: number;
  totalOwners: number;
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
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface CreateShopRequest {
  name: string;
  timezone: string;
  address?: ShopAddress;
}

export interface UpdateShopRequest {
  name?: string;
  timezone?: string;
  address?: ShopAddress;
}

export interface UpdateScheduleRequest {
  weeklySchedule: DaySchedule[];
  gracePeriodMinutes?: number;
  exceptions?: ScheduleException[];
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

export interface ManualOverrideRequest {
  action: "ARM" | "DISARM";
  durationMinutes?: number;
  reason: string;
}

export interface ReviewEventRequest {
  reviewStatus: ReviewStatus;
  note?: string;
}

export interface RegisterPushTokenRequest {
  token: string;
  platform?: "WEB" | "ANDROID" | "IOS";
}

export interface UpdateShopStatusRequest {
  status: ShopStatus;
  reason: string;
}

export interface UpdateProfileRequest {
  name?: string;
}

export interface NotificationTypePrefs {
  PERSON_IN_ZONE: boolean;
  POSSIBLE_SHUTTER_INTERACTION: boolean;
  POSSIBLE_TAMPERING: boolean;
  CAMERA_OFFLINE: boolean;
  AI_OFFLINE: boolean;
}

export interface NotificationPreferences {
  push: boolean;
  inApp: boolean;
  types: NotificationTypePrefs;
}

export interface AiEventSubmissionRequest {
  eventId: string;
  shopId: string;
  cameraId: string;
  eventType: EventType;
  confidence: number;
  startedAt: string;
  endedAt?: string;
  evidence?: EventEvidence;
  modelVersion?: string;
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

