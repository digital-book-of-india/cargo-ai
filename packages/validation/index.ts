import { z } from "zod";
import { HHMM, UNMUTABLE_EVENT_TYPES, validateShifts } from "@dbi/api-types";

// Zod 4 words a missing value as "Invalid input: expected string, received undefined". Keep the short message
// the panels and API clients have always shown.
z.config({ customError: (issue) => (issue.code === "invalid_type" && issue.input === undefined ? "Required" : undefined) });

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email"),
  password: z.string().min(1, "Password is required").max(256, "Password is too long"),
  // "admin": sign in to the platform-admin panel (own cookie, platform administrators only, no token in the answer)
  panel: z.enum(["admin"]).optional(),
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  email: z.string().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
  companyName: z.string().trim().min(1).max(160).optional(),
});

const timezone = z.string().min(1, "Timezone is required");

export const siteAddressSchema = z.object({
  city: z.string().max(120).optional(),
  state: z.string().max(120).optional(),
  postalCode: z.string().max(20).optional(),
});

const siteCode = z
  .string()
  .trim()
  .min(1, "Site code is required")
  .max(60)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, - or _");

export const createSiteSchema = z.object({
  name: z.string().trim().min(1, "Site name is required").max(160),
  code: siteCode,
  timezone: timezone.optional(),
  address: siteAddressSchema.optional(),
});

export const updateSiteSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  code: siteCode.optional(),
  timezone: timezone.optional(),
  address: siteAddressSchema.optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export const updateCompanySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  timezone: timezone.optional(),
});

export const companyRoleSchema = z.enum([
  "COMPANY_OWNER",
  "COMPANY_ADMIN",
  "WAREHOUSE_MANAGER",
  "SECURITY_OPERATOR",
  "AUDITOR",
]);

export const inviteUserSchema = z.object({
  email: z.string().email("Enter a valid email"),
  role: companyRoleSchema,
  siteIds: z.array(z.string().min(1)).max(200).optional(),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(1, "Invitation token is required"),
  name: z.string().trim().min(1, "Name is required").max(120, "Name is too long"),
  password: z.string().min(8, "Use at least 8 characters").max(72, "Use at most 72 characters"),
});

export const changeMemberRoleSchema = z.object({
  role: companyRoleSchema,
  siteIds: z.array(z.string().min(1)).max(200).optional(),
});

export const changeMemberStatusSchema = z.object({
  status: z.enum(["ACTIVE", "DISABLED"]),
});

export const assignCameraSiteSchema = z.object({
  siteId: z.string().min(1, "siteId is required"),
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
  name: z.string().trim().min(1, "Camera name is required").max(120, "Camera name is too long"),
  protocol: z.enum(["RTSP", "ONVIF"]),
  host: z.string().trim().min(1, "Camera host or IP is required").max(253, "Camera host is too long"),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().max(128, "Username is too long").optional(),
  password: z.string().max(256, "Password is too long").optional(),
  path: z.string().trim().max(256, "Path is too long").optional(),
});

export const cameraUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120, "Camera name is too long").optional(),
  protocol: z.enum(["RTSP", "ONVIF"]).optional(),
  host: z.string().trim().min(1).max(253, "Camera host is too long").optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().max(128, "Username is too long").optional(),
  password: z.string().max(256, "Password is too long").optional(),
  path: z.string().trim().max(256, "Path is too long").optional(),
});

export const updateSiteStatusSchema = z.object({
  status: z.enum(["ACTIVE", "INACTIVE"]),
  reason: z.string().trim().min(1, "Reason is required"),
});

export const updateCompanyStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED"]),
  reason: z.string().trim().min(1, "Reason is required"),
});

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name cannot be empty").optional(),
});

const cargoEventType = z.enum(["package_detected","package_line_crossing","zone_entry","zone_exit","restricted_zone_movement","unusual_after_hours_movement","count_mismatch","possible_package_damage","possible_seal_appearance_change","camera_offline","ai_service_unavailable"]);
const cargoSeverity = z.enum(["low", "medium", "high", "critical"]);
const unit = z.number().min(0).max(1);

// Appendix A of the requirements. Unknown fields are rejected. companyId is optional here and is
// only ever checked against the camera's real company, never trusted.
export const aiEventSchema = z
  .object({
    eventKey: z.string().trim().min(1).max(200),
    companyId: z.string().min(1).optional(),
    siteId: z.string().trim().min(1, "siteId is required"),
    cameraId: z.string().trim().min(1, "cameraId is required"),
    zoneId: z.string().min(1).nullable().optional(),
    eventType: cargoEventType,
    severity: cargoSeverity.optional(),
    summary: z.string().trim().min(1).max(500).optional(),
    occurredAt: z.string().datetime({ offset: true }),
    track: z
      .object({
        trackId: z.string().max(160).optional(),
        class: z.string().max(80).optional(),
        confidence: unit.optional(),
        bbox: z.array(unit).length(4).optional(),
      })
      .strict()
      .optional(),
    movement: z
      .object({ direction: z.enum(["IN", "OUT", "UNKNOWN"]), countDelta: z.number().int().min(0).max(1).optional() })
      .strict()
      .optional(),
    evidence: z
      .object({
        snapshotObjectKey: z.string().max(1024).nullable().optional(),
        clipObjectKey: z.string().max(1024).nullable().optional(),
      })
      .strict()
      .optional(),
    model: z.object({ name: z.string().max(80).optional(), version: z.string().max(40).optional() }).strict().optional(),
  })
  .strict();

export const acknowledgeEventSchema = z.object({ note: z.string().trim().max(2000).optional() });

export const assignEventSchema = z.object({
  userId: z.string().min(1).nullable(),
  note: z.string().trim().max(2000).optional(),
});

export const addEventNoteSchema = z.object({
  note: z.string().trim().min(1, "A note cannot be empty").max(5000),
});

export const resolveEventSchema = z.object({
  outcome: z.enum(["confirmed_operational", "reviewed_no_issue", "false_positive", "escalated", "unresolved_other"]),
  note: z.string().trim().max(5000).optional(),
});

export const falsePositiveSchema = z.object({
  reason: z.string().trim().min(3, "Give a short reason").max(2000),
});

export const reopenEventSchema = z.object({
  note: z.string().trim().min(3, "Give a short reason for reopening").max(2000),
});

export const aiHealthSchema = z.object({
  serviceName: z.string().trim().min(1, "serviceName is required"),
  status: z.enum(["ONLINE", "DEGRADED", "OFFLINE"]),
  timestamp: z.string().optional(),
  activeStreams: z.number().int().nonnegative().optional(),
});

const shiftSchema = z
  .object({
    name: z.string().trim().min(1, "Every shift needs a name").max(40),
    start: z.string().regex(HHMM, "Use a time like 06:00"),
    end: z.string().regex(HHMM, "Use a time like 14:00"),
  })
  .strict();

// All fields are optional so one setting can be changed on its own. Unknown fields are refused.
export const updateCompanySettingsSchema = z
  .object({
    mismatchTolerance: z.number().int().min(0).max(100000).optional(),
    retentionDays: z.number().int().min(7).max(3650).optional(),
    defaultConfidence: z.number().min(0).max(1).optional(),
    shifts: z.array(shiftSchema).max(8).optional(),
    notificationRules: z
      .object({
        inAppMinSeverity: z.enum(["low", "medium", "high", "critical"]),
        mutedEventTypes: z.array(cargoEventType).max(20),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.shifts) {
      const problem = validateShifts(value.shifts);
      if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["shifts"] });
    }
    const blocked = value.notificationRules?.mutedEventTypes.find((t) => UNMUTABLE_EVENT_TYPES.includes(t));
    if (blocked) {
      ctx.addIssue({
        code: "custom",
        message: "Camera and AI health notices cannot be muted.",
        path: ["notificationRules", "mutedEventTypes"],
      });
    }
  });

// ---- manifests, vehicles and loading sessions
const objectIdString = z.string().regex(/^[a-f0-9]{24}$/i, "Not a valid id");

export const createManifestSchema = z
  .object({
    reference: z
      .string()
      .trim()
      .min(1, "Reference is required")
      .max(100)
      .regex(/^[A-Za-z0-9][A-Za-z0-9 _./-]*$/, "Use letters, numbers, space and - _ . /"),
    siteId: objectIdString,
    expectedPackageCount: z.number().int().min(0).max(1_000_000),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict();

export const updateManifestSchema = z
  .object({
    expectedPackageCount: z.number().int().min(0).max(1_000_000).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    status: z.enum(["active", "cancelled"]).optional(),
  })
  .strict();

export const createVehicleSchema = z
  .object({
    registrationNumber: z.string().trim().min(2, "Registration number is required").max(32),
    label: z.string().trim().max(120).optional(),
  })
  .strict();

export const updateVehicleSchema = z
  .object({ label: z.string().trim().max(120).nullable().optional(), active: z.boolean().optional() })
  .strict();

export const createLoadingSessionSchema = z
  .object({
    siteId: objectIdString,
    zoneId: objectIdString.nullable().optional(),
    manifestId: objectIdString.nullable().optional(),
    vehicleId: objectIdString.nullable().optional(),
    direction: z.enum(["inbound", "outbound"]),
    startedAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const closeLoadingSessionSchema = z
  .object({
    closedAt: z.string().datetime({ offset: true }).optional(),
    closeNote: z.string().trim().max(1000).optional(),
  })
  .strict();

// Vision (zones, ingestion, monitoring)
export * from "./vision-zones";
export * from "./vision-ingestion";
export * from "./vision-monitoring";
