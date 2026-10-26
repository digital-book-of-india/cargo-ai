import { z } from "zod";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters"),
});

export const shopSchema = z.object({
  name: z.string().trim().min(1, "Shop name is required"),
  timezone: z.string().min(1, "Timezone is required"),
  address: z
    .object({
      city: z.string().optional(),
      state: z.string().optional(),
      postalCode: z.string().optional(),
    })
    .optional(),
});

export const dayScheduleSchema = z
  .object({
    day: z.enum(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]),
    closed: z.boolean(),
    closesNextDay: z.boolean(),
    openTime: z.string().regex(hhmm, "Use HH:mm").optional(),
    closeTime: z.string().regex(hhmm, "Use HH:mm").optional(),
  })
  .refine((d) => d.closed || (d.openTime && d.closeTime), {
    message: "Open and close time are required on open days",
  });

export const scheduleSchema = z.object({
  weeklySchedule: z.array(dayScheduleSchema).length(7),
  gracePeriodMinutes: z.number().int().min(0).max(60),
});

export const zoneSchema = z.object({
  zoneType: z.enum(["SHUTTER", "GATE", "ENTRANCE", "CUSTOM"]),
  polygon: z
    .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .min(3, "A zone needs at least 3 points"),
  sensitivity: z.enum(["LOW", "MEDIUM", "HIGH"]),
  enabled: z.boolean(),
});

export const cameraRegisterSchema = z.object({
  name: z.string().trim().min(1, "Camera name is required"),
  connectorId: z.string().trim().min(1).optional(),
  protocol: z.enum(["RTSP", "ONVIF"]),
  host: z.string().trim().min(1, "Camera host or IP is required"),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  path: z.string().trim().optional(),
});

export const cameraUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  connectorId: z.string().trim().min(1).nullable().optional(),
  protocol: z.enum(["RTSP", "ONVIF"]).optional(),
  host: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  path: z.string().trim().optional(),
});

export const createConnectorSchema = z.object({
  name: z.string().trim().min(1, "Connector name is required"),
});

export const pairConnectorSchema = z.object({
  pairingCode: z.string().trim().min(1, "Pairing code is required"),
});

export const connectorHeartbeatSchema = z.object({
  version: z.string().trim().min(1, "version is required"),
  activeCameraCount: z.number().int().nonnegative().optional(),
});

export const manualOverrideSchema = z.object({
  action: z.enum(["ARM", "DISARM"]),
  durationMinutes: z.number().int().min(1).max(1440).optional(),
  reason: z.string().trim().min(1, "Reason is required for audit logs"),
});

export const reviewEventSchema = z.object({
  reviewStatus: z.enum(["NEW", "REVIEWED", "FALSE_ALARM", "CONFIRMED"]),
  note: z.string().optional(),
});

export const updateShopStatusSchema = z.object({
  status: z.enum(["PENDING_SETUP", "ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().min(1, "Reason is required"),
});

export const pushTokenSchema = z.object({
  token: z.string().trim().min(1, "Push token is required"),
  platform: z.enum(["WEB", "ANDROID", "IOS"]).optional(),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").optional(),
});

export const notificationPreferencesSchema = z.object({
  push: z.boolean(),
  inApp: z.boolean(),
  types: z.object({
    PERSON_IN_ZONE: z.boolean(),
    POSSIBLE_SHUTTER_INTERACTION: z.boolean(),
    POSSIBLE_TAMPERING: z.boolean(),
    CAMERA_OFFLINE: z.boolean(),
    AI_OFFLINE: z.boolean(),
  }),
});

export const aiEventSchema = z.object({
  eventId: z.string().trim().min(1, "eventId is required"),
  shopId: z.string().trim().min(1, "shopId is required"),
  cameraId: z.string().trim().min(1, "cameraId is required"),
  eventType: z.enum([
    "PERSON_IN_ZONE",
    "POSSIBLE_SHUTTER_INTERACTION",
    "POSSIBLE_TAMPERING",
    "CAMERA_OFFLINE",
    "AI_OFFLINE",
  ]),
  confidence: z.number().min(0).max(1),
  startedAt: z.string().min(1, "startedAt timestamp is required"),
  endedAt: z.string().optional(),
  evidence: z
    .object({
      snapshotObjectKey: z.string().optional(),
      clipObjectKey: z.string().optional(),
    })
    .optional(),
  modelVersion: z.string().optional(),
});

export const aiHealthSchema = z.object({
  serviceName: z.string().trim().min(1, "serviceName is required"),
  status: z.enum(["ONLINE", "DEGRADED", "OFFLINE"]),
  timestamp: z.string().optional(),
  activeStreams: z.number().int().nonnegative().optional(),
});

