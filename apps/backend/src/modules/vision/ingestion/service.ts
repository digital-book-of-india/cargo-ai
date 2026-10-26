import crypto from "crypto";
import mongoose, { Types } from "mongoose";
import type { VisionEventType, VisionIngestResponse, VisionObjectClass, VisionZoneRules } from "@dbi/api-types";
import type { VisionIngestInput } from "@dbi/validation";
import { CameraModel, VisionCountLedgerModel, VisionEventModel, VisionZoneModel } from "../../../models";
import { AppError } from "../../../middleware/errorHandler";
import { stableStringify } from "../zones/service";

export interface IngestOutcome {
  httpStatus: 200 | 202;
  body: VisionIngestResponse;
}

interface LoadedZone {
  id: string;
  rules: VisionZoneRules;
}

interface CountDecision {
  countDelta: 0 | 1;
  suppressedReason: string | null;
}

const MAX_ATTEMPTS = 2;

export async function ingestVisionEvent(
  input: VisionIngestInput,
  idempotencyKey?: string
): Promise<IngestOutcome> {
  if (idempotencyKey !== undefined && idempotencyKey !== input.eventKey) {
    throw new AppError(400, "VALIDATION_ERROR", "Idempotency-Key header must equal eventKey.");
  }

  // Tenant checks use the database only. input.companyId is never used for authorization.
  const camera = await CameraModel.findById(input.cameraId).select("shopId").lean();
  if (!camera || String(camera.shopId) !== input.siteId) {
    throw new AppError(404, "NOT_FOUND", "Camera not found for this site.");
  }

  const zone = input.zoneId ? await loadEnabledZone(input.zoneId, input.cameraId, input.siteId) : null;

  const payloadHash = crypto.createHash("sha256").update(stableStringify(input)).digest("hex");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const duplicate = await findDuplicate(input.eventKey, payloadHash);
    if (duplicate) return duplicate;

    try {
      await writeEventAndCount(input, payloadHash, zone);
      return { httpStatus: 202, body: { eventId: input.eventKey, ingestionStatus: "accepted" } };
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // A concurrent request stored the same eventKey or track first.
      // Loop once more so this request returns that stored result.
    }
  }

  throw new AppError(409, "DUPLICATE_EVENT", "Event was already processed.");
}

async function loadEnabledZone(zoneId: string, cameraId: string, siteId: string): Promise<LoadedZone> {
  const zone = await VisionZoneModel.findById(zoneId).select("shopId cameraId status rules").lean();
  if (!zone || String(zone.cameraId) !== cameraId || String(zone.shopId) !== siteId) {
    throw new AppError(404, "NOT_FOUND", "Zone not found for this camera.");
  }
  if (zone.status !== "active") {
    throw new AppError(422, "BUSINESS_RULE_FAILED", "Zone is not enabled for monitoring.");
  }
  return { id: String(zone._id), rules: zone.rules as VisionZoneRules };
}

async function findDuplicate(eventKey: string, payloadHash: string): Promise<IngestOutcome | null> {
  const existing = await VisionEventModel.findOne({ eventKey }).select("payloadHash").lean();
  if (!existing) return null;
  if (existing.payloadHash !== payloadHash) {
    throw new AppError(409, "DUPLICATE_EVENT", "This eventKey was already used with a different payload.");
  }
  return { httpStatus: 200, body: { eventId: eventKey, ingestionStatus: "duplicate" } };
}

// Decides whether a line crossing becomes a count. Every reason for not counting is stored on the event.
async function decideCount(input: VisionIngestInput, zone: LoadedZone | null): Promise<CountDecision> {
  if (input.movement?.countDelta !== 1) return { countDelta: 0, suppressedReason: null };
  if (!zone || !input.track) return { countDelta: 0, suppressedReason: "NO_ZONE_OR_TRACK" };

  const rules = zone.rules;
  if (!rules.objectClasses.includes(input.track.class as VisionObjectClass)) {
    return { countDelta: 0, suppressedReason: "CLASS_NOT_ENABLED" };
  }
  if (input.track.confidence < rules.minimumConfidence) {
    return { countDelta: 0, suppressedReason: "BELOW_MIN_CONFIDENCE" };
  }
  // MVP rule: count once per track per zone. The track id must be session-scoped (spec FR-05).
  const alreadyCounted = await VisionCountLedgerModel.exists({
    zoneId: new Types.ObjectId(zone.id),
    trackId: input.track.trackId,
  });
  if (alreadyCounted) return { countDelta: 0, suppressedReason: "TRACK_ALREADY_COUNTED" };

  return { countDelta: 1, suppressedReason: null };
}

async function writeEventAndCount(
  input: VisionIngestInput,
  payloadHash: string,
  zone: LoadedZone | null
): Promise<void> {
  const decision = await decideCount(input, zone);
  const shopId = new Types.ObjectId(input.siteId);
  const cameraId = new Types.ObjectId(input.cameraId);
  const zoneId = zone ? new Types.ObjectId(zone.id) : null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await VisionEventModel.create(
        [
          {
            eventKey: input.eventKey,
            payloadHash,
            shopId,
            cameraId,
            zoneId,
            eventType: input.eventType as VisionEventType,
            occurredAt: new Date(input.occurredAt),
            track: input.track ?? null,
            movement: input.movement
              ? {
                  direction: input.movement.direction,
                  requestedCountDelta: input.movement.countDelta,
                  countDelta: decision.countDelta,
                  suppressedReason: decision.suppressedReason,
                }
              : null,
            evidence: input.evidence ?? null,
            detector: input.model ?? null,
          },
        ],
        { session }
      );

      if (decision.countDelta === 1 && input.track && input.movement && zoneId) {
        await VisionCountLedgerModel.create(
          [
            {
              eventKey: input.eventKey,
              shopId,
              cameraId,
              zoneId,
              trackId: input.track.trackId,
              direction: input.movement.direction,
              countDelta: 1,
              confidence: input.track.confidence,
              occurredAt: new Date(input.occurredAt),
            },
          ],
          { session }
        );
      }
    });
  } finally {
    await session.endSession();
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  return (err as { code?: number } | null)?.code === 11000;
}