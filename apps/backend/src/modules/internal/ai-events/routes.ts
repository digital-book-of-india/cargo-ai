import { Router, Request, Response } from "express";
import { visionIngestSchema } from "@dbi/validation";
import { asyncHandler } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { ingestVisionEvent } from "../../vision/ingestion/service";
import { forwardToInbox } from "../../vision/ingestion/inbox";

export const aiEventsRouter = Router();

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

// Merged Ingestion Handler (Dev 2: unified ingestion pipeline)
// The one ingestion handler. Mounted at /internal/v1/ai/events, /internal/v1/ai/cargo-events and /api/v1/ai/events
// (all behind the service token, see app.ts).
aiEventsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = visionIngestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid event payload");
    }
    const input = parsed.data;
    enforceCameraRate(input.cameraId);

    const header = req.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : (Array.isArray(header) ? header[0] : undefined);

    const outcome = await ingestVisionEvent(input, idempotencyKey);
    // Also for a duplicate (200): if the first attempt stored the event but the inbox step failed, the retry completes it.
    const inboxEventId = await forwardToInbox(input);

    res.status(outcome.httpStatus).json({ data: { ...outcome.body, eventId: inboxEventId ?? outcome.body.eventId } });
  })
);