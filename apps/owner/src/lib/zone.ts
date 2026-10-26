import type { Point, SaveZoneRequest, Zone } from "@/types";

// Pure geometry for the shutter zone. Coordinates are normalized 0..1 of the video frame.

export const MIN_POINTS = 3;
export const MAX_POINTS = 20;
/** smallest accepted zone, as a share of the frame */
export const MIN_AREA = 0.01;

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function polygonArea(p: Point[]): number {
  let sum = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function orient(a: Point, b: Point, c: Point): number {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0;
}

// Proper crossing of segment ab and cd (touching at an end does not count).
function crosses(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && o1 !== o2 && o3 !== o4;
}

// A "bow-tie" polygon cannot be filtered reliably, so it is rejected.
export function isSelfIntersecting(p: Point[]): boolean {
  const n = p.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) continue;
      if (crosses(p[i], p[(i + 1) % n], p[j], p[(j + 1) % n])) return true;
    }
  }
  return false;
}

// Returns a message for the owner, or null when the zone is acceptable.
export function validateZonePoints(p: Point[]): string | null {
  if (p.length < MIN_POINTS) return `Place at least ${MIN_POINTS} points to outline the area.`;
  if (p.length > MAX_POINTS) return `Use at most ${MAX_POINTS} points.`;
  if (p.some((pt) => pt.x < 0 || pt.x > 1 || pt.y < 0 || pt.y > 1)) {
    return "All points must be inside the picture.";
  }
  if (isSelfIntersecting(p)) return "The outline crosses itself. Move a point so the lines do not cross.";
  if (polygonArea(p) < MIN_AREA) return "The area is too small. Make the outline bigger.";
  return null;
}

export function rect(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
}

export const ZONE_PRESETS: Array<{ id: string; label: string; points: Point[] }> = [
  { id: "lower", label: "Lower half", points: rect(0.05, 0.5, 0.95, 0.95) },
  { id: "centre", label: "Centre", points: rect(0.2, 0.2, 0.8, 0.8) },
  { id: "full", label: "Whole picture", points: rect(0.03, 0.03, 0.97, 0.97) },
];

export function toZonePayload(points: Point[], meta: Omit<SaveZoneRequest, "polygon">): SaveZoneRequest {
  return {
    ...meta,
    polygon: points.map((p) => ({ x: round4(clamp01(p.x)), y: round4(clamp01(p.y)) })),
  };
}

// ---- guide picture (stays in the browser, never uploaded) ------------------

export const MAX_GUIDE_IMAGE_BYTES = 8 * 1024 * 1024;

// Returns a message for the owner, or null when the file can be used as a guide.
export function checkGuideImage(file: { type: string; size: number }): string | null {
  if (!file.type.startsWith("image/")) return "Choose a picture file (PNG, JPG or similar).";
  if (file.size <= 0) return "This file is empty.";
  if (file.size > MAX_GUIDE_IMAGE_BYTES) return "This picture is larger than 8 MB. Choose a smaller one.";
  return null;
}

// Keeps a sensible canvas shape for any picture: 16:9 when unknown, never extreme.
export function canvasAspect(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 16 / 9;
  return Math.min(3, Math.max(1, width / height));
}
