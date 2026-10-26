import { z } from "zod";

// Limits from the spec (section 10.2) plus geometry sanity thresholds.
export const VISION_LIMITS = {
  maxPolygonVertices: 100,
  minEdgeLength: 0.005, // normalized units (about 5 px on a 1000 px frame)
  minArea: 0.0005,
  maxNameLength: 80,
  maxObjectClasses: 3,
} as const;

const coord = z.number().finite().min(0).max(1);
const point = z.tuple([coord, coord]);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const visionZoneTypeSchema = z.enum(["polygon", "counting_line", "loading_bay", "restricted", "storage"]);
export const visionObjectClassSchema = z.enum(["package", "box", "pallet"]);
export const visionCountDirectionSchema = z.enum(["A_TO_B", "B_TO_A", "EITHER"]);

export const visionGeometrySchema = z.object({
  coordinateSpace: z.literal("normalized_0_1"),
  line: z.tuple([point, point]).optional(),
  polygon: z.array(point).max(VISION_LIMITS.maxPolygonVertices).optional(),
});

export const visionZoneRulesSchema = z.object({
  objectClasses: z
    .array(visionObjectClassSchema)
    .min(1, "Pick at least one object class")
    .max(VISION_LIMITS.maxObjectClasses)
    .refine((c) => new Set(c).size === c.length, "Object classes must be unique"),
  minimumConfidence: z.number().finite().min(0).max(1),
  countDirection: visionCountDirectionSchema.optional(),
  countOncePerTrackPerRule: z.boolean().default(true),
  afterHours: z
    .object({
      enabled: z.boolean(),
      start: z.string().regex(HHMM, "Use HH:mm (24-hour)"),
      end: z.string().regex(HHMM, "Use HH:mm (24-hour)"),
    })
    .optional(),
});

export const saveVisionZoneSchema = z
  .object({
    siteId: z.string().trim().min(1, "siteId is required"),
    cameraId: z.string().trim().min(1, "cameraId is required"),
    name: z.string().trim().min(1, "Zone name is required").max(VISION_LIMITS.maxNameLength),
    zoneType: visionZoneTypeSchema,
    geometry: visionGeometrySchema,
    rules: visionZoneRulesSchema,
  })
  .superRefine((val, ctx) => {
    for (const message of checkVisionZoneConfig(val)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["geometry"] });
    }
  });

export const updateVisionZoneSchema = z
  .object({
    name: z.string().trim().min(1).max(VISION_LIMITS.maxNameLength).optional(),
    zoneType: visionZoneTypeSchema.optional(),
    geometry: visionGeometrySchema.optional(),
    rules: visionZoneRulesSchema.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to update");

export type SaveVisionZoneInput = z.infer<typeof saveVisionZoneSchema>;
export type UpdateVisionZoneInput = z.infer<typeof updateVisionZoneSchema>;

type Pt = [number, number];

// Single source of truth for zone configuration checks. Used by the create schema,
// by PATCH (on the merged result) and by validate. Returns human-readable issues.
export function checkVisionZoneConfig(input: { zoneType: string; geometry: unknown; rules: unknown }): string[] {
  const geo = visionGeometrySchema.safeParse(input.geometry);
  if (!geo.success) return [geo.error.errors[0]?.message ?? "Invalid geometry."];
  const rules = visionZoneRulesSchema.safeParse(input.rules);
  if (!rules.success) return [rules.error.errors[0]?.message ?? "Invalid rules."];

  const g = geo.data;
  const r = rules.data;
  const issues: string[] = [];

  if (r.afterHours?.enabled && r.afterHours.start === r.afterHours.end) {
    issues.push("After-hours start and end cannot be the same time.");
  }

  if (input.zoneType === "counting_line") {
    if (!g.line) return [...issues, "A counting line needs a 'line' with exactly 2 points."];
    if (g.polygon) issues.push("A counting line must not include a polygon.");
    if (!r.countDirection) issues.push("countDirection is required for a counting line.");
    if (dist(g.line[0], g.line[1]) < VISION_LIMITS.minEdgeLength) {
      issues.push("Counting line is too short.");
    }
    return issues;
  }

  if (g.line) return [...issues, "This zone type needs a polygon, not a line."];
  if (r.countDirection) issues.push("countDirection applies only to counting lines.");
  if (!g.polygon || g.polygon.length < 3) {
    return [...issues, "A zone needs a polygon with at least 3 points."];
  }
  return [...issues, ...polygonIssues(g.polygon)];
}

function polygonIssues(poly: Pt[]): string[] {
  const issues: string[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    if (dist(poly[i], poly[(i + 1) % n]) < VISION_LIMITS.minEdgeLength) {
      issues.push("Two neighbouring points are too close (or the first point is repeated at the end).");
      break;
    }
  }
  if (Math.abs(shoelace(poly)) / 2 < VISION_LIMITS.minArea) {
    issues.push("Zone area is too small or the points lie on a straight line.");
  }
  if (hasSelfIntersection(poly)) {
    issues.push("Zone edges cross each other. Redraw the outline without crossings.");
  }
  return issues;
}

function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function shoelace(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    s += x1 * y2 - x2 * y1;
  }
  return s;
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  return orient(p3, p4, p1) * orient(p3, p4, p2) < 0 && orient(p1, p2, p3) * orient(p1, p2, p4) < 0;
}

function hasSelfIntersection(poly: Pt[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // these two edges share a vertex
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}