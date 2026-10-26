import { z } from "zod";

export const visionEventTypeSchema = z.enum([
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
]);

const OBJECT_ID = /^[a-fA-F0-9]{24}$/;
const unit = z.number().finite().min(0).max(1);

// Evidence must be a private storage key, never a URL or a filesystem path (spec 8.3, section 11).
function isStorageKey(value: string): boolean {
  return (
    !/^[a-z][a-z0-9+.-]*:/i.test(value) &&
    !value.startsWith("/") &&
    !value.includes("..") &&
    !value.includes("\\")
  );
}

const evidenceKey = z
  .string()
  .min(1)
  .max(1024)
  .refine(isStorageKey, "Evidence must be a storage key, not a URL or path.")
  .nullable()
  .optional();

const LINE_EVENT_TYPES = new Set([
  "package_line_crossing",
  "zone_entry",
  "zone_exit",
  "restricted_zone_movement",
  "unusual_after_hours_movement",
]);

const MAX_FUTURE_SKEW_MS = 5 * 60_000;

// Appendix A plus two documented extensions from spec 8.3: "movement" and "model".
export const visionIngestSchema = z
  .object({
    eventKey: z.string().trim().min(1).max(200),
    // Accepted for spec compatibility. Never used for authorization (spec section 3 and 6).
    companyId: z.string().trim().min(1).max(64),
    siteId: z.string().regex(OBJECT_ID, "siteId must be a valid id"),
    cameraId: z.string().regex(OBJECT_ID, "cameraId must be a valid id"),
    zoneId: z.string().regex(OBJECT_ID, "zoneId must be a valid id").nullable().optional(),
    eventType: visionEventTypeSchema,
    occurredAt: z.string().datetime({ offset: true, message: "occurredAt must be an ISO 8601 date-time" }),
    track: z
      .object({
        trackId: z.string().trim().min(1).max(160),
        class: z.string().trim().min(1).max(80),
        confidence: unit,
        bbox: z.tuple([unit, unit, unit, unit]),
      })
      .strict()
      .optional(),
    movement: z
      .object({
        direction: z.enum(["IN", "OUT", "UNKNOWN"]),
        countDelta: z.union([z.literal(0), z.literal(1)]),
      })
      .strict()
      .optional(),
    evidence: z
      .object({
        snapshotObjectKey: evidenceKey,
        clipObjectKey: evidenceKey,
      })
      .strict()
      .optional(),
    model: z
      .object({
        name: z.string().trim().min(1).max(80),
        version: z.string().trim().min(1).max(40),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (LINE_EVENT_TYPES.has(v.eventType) && !v.zoneId) {
      fail("zoneId is required for zone and line events.", ["zoneId"]);
    }
    if (v.eventType === "package_line_crossing" && (!v.track || !v.movement)) {
      fail("package_line_crossing needs track and movement.", ["movement"]);
    }
    if (v.movement?.countDelta === 1 && v.eventType !== "package_line_crossing") {
      fail("Only package_line_crossing events can count.", ["movement", "countDelta"]);
    }
    if (Date.parse(v.occurredAt) > Date.now() + MAX_FUTURE_SKEW_MS) {
      fail("occurredAt is in the future.", ["occurredAt"]);
    }
  });

export type VisionIngestInput = z.infer<typeof visionIngestSchema>;