import { Router } from "express";
import { visionIngestSchema } from "@dbi/validation";
import { AppError } from "../../../middleware/errorHandler";
import { asyncHandler, parseOrThrow } from "../shared/http";
import { ingestVisionEvent } from "./service";

// Mounted at /internal/v1/ai/events, behind serviceAuth (see app.ts).
export const visionIngestRouter = Router();

// In-memory per-camera limit. Fine for one API instance. Move to Redis when scaling out.
const WINDOW_MS = 60_000;
const MAX_EVENTS_PER_CAMERA_PER_WINDOW = 300;
const buckets = new Map<string, { count: number; resetAt: number }>();

function enforceCameraRate(cameraId: string): void {
  const now = Date.now();
  const bucket = buckets.get(cameraId);
  if (!bucket || now > bucket.resetAt) {
    buckets.set(cameraId, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    bucket.count += 1;
    if (bucket.count > MAX_EVENTS_PER_CAMERA_PER_WINDOW) {
      throw new AppError(429, "RATE_LIMITED", "Too many events for this camera. Slow down.");
    }
  }
  if (buckets.size > 5000) {
    for (const [key, value] of buckets) {
      if (now > value.resetAt) buckets.delete(key);
    }
  }
}

// POST /internal/v1/ai/events
visionIngestRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(visionIngestSchema, req.body);
    enforceCameraRate(input.cameraId);

    const header = req.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : undefined;

    const outcome = await ingestVisionEvent(input, idempotencyKey);
    res.status(outcome.httpStatus).json({ data: outcome.body });
  })
);