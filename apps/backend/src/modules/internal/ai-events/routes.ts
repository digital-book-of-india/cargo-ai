import { Router, Request, Response } from "express";
import { visionIngestSchema } from "@dbi/validation";
import { asyncHandler } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { ingestVisionEvent } from "../../vision/ingestion/service";
import { forwardToInbox } from "../../vision/ingestion/inbox";
import { redis } from "../../../config/redis";

export const aiEventsRouter = Router();

const WINDOW_MS = 60_000;
const MAX_EVENTS_PER_CAMERA_PER_WINDOW = 300;
const buckets = new Map<string, { count: number; resetAt: number }>();

const ATOMIC_CAMERA_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return {current, pttl}
`;

function memoryFallbackCameraRate(cameraId: string, now: number): void {
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

async function enforceCameraRate(cameraId: string): Promise<void> {
  const now = Date.now();

  if (redis.status === "ready") {
    try {
      const redisKey = `ratelimit:camera:${cameraId}`;
      const result = (await redis.eval(
        ATOMIC_CAMERA_LIMIT_LUA,
        1,
        redisKey,
        WINDOW_MS
      )) as [number, number];

      if (Array.isArray(result) && result.length >= 2) {
        const count = result[0];
        if (count > MAX_EVENTS_PER_CAMERA_PER_WINDOW) {
          throw new AppError(429, "RATE_LIMITED", "Too many events for this camera. Slow down.");
        }
        return;
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      memoryFallbackCameraRate(cameraId, now);
      return;
    }
  }

  memoryFallbackCameraRate(cameraId, now);
}

aiEventsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = visionIngestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid event payload");
    }
    const input = parsed.data;
    await enforceCameraRate(input.cameraId);

    const header = req.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : (Array.isArray(header) ? header[0] : undefined);

    const outcome = await ingestVisionEvent(input, idempotencyKey);
    const inboxEventId = await forwardToInbox(input);

    res.status(outcome.httpStatus).json({ data: { ...outcome.body, eventId: inboxEventId ?? outcome.body.eventId } });
  })
);