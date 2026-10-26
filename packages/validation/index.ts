import { z } from "zod";

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
  protocol: z.enum(["RTSP", "ONVIF"]),
  host: z.string().trim().min(1, "Camera host or IP is required"),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  path: z.string().trim().optional(),
});

export const cameraUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  protocol: z.enum(["RTSP", "ONVIF"]).optional(),
  host: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().optional(),
  password: z.string().optional(),
  path: z.string().trim().optional(),
});



export const reviewEventSchema = z.object({
  reviewStatus: z.enum(["NEW", "REVIEWED", "FALSE_ALARM", "CONFIRMED"]),
  note: z.string().optional(),
});

export const updateShopStatusSchema = z.object({
  status: z.enum(["PENDING_SETUP", "ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().min(1, "Reason is required"),
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

