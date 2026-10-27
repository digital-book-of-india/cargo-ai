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

  // Tenant checks use the database only. Resolve camera and companyId.
  const camera = await CameraModel.findById(input.cameraId).select("siteId companyId").lean();
  if (!camera || String(camera.siteId) !== input.siteId) {
    throw new AppError(404, "NOT_FOUND", "Camera not found for this site.");
  }

  const companyId = camera.companyId;
  const zone = input.zoneId ? await loadEnabledZone(input.zoneId, input.cameraId, input.siteId, companyId) : null;

  const payloadHash = crypto.createHash("sha256").update(stableStringify(input)).digest("hex");

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const duplicate = await findDuplicate(companyId, input.eventKey, payloadHash);
    if (duplicate) return duplicate;

    try {
      await writeEventAndCount(input, payloadHash, zone, companyId);
      return { httpStatus: 202, body: { eventId: input.eventKey, ingestionStatus: "accepted" } };
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      // Concurrent insert with same key; retry to return stored outcome
    }
  }

  throw new AppError(409, "DUPLICATE_EVENT", "Event was already processed.");
}

async function loadEnabledZone(zoneId: string, cameraId: string, siteId: string, companyId?: string | Types.ObjectId): Promise<LoadedZone> {
  const zone = await VisionZoneModel.findById(zoneId).select("siteId cameraId companyId status rules").lean();
  if (!zone || String(zone.cameraId) !== cameraId || String(zone.siteId) !== siteId) {
    throw new AppError(404, "NOT_FOUND", "Zone not found for this camera.");
  }
  if (companyId && zone.companyId && String(zone.companyId) !== String(companyId)) {
    throw new AppError(403, "FORBIDDEN", "Cross-tenant zone access prohibited.");
  }
  if (zone.status !== "active") {
    throw new AppError(422, "BUSINESS_RULE_FAILED", "Zone is not enabled for monitoring.");
  }
  return { id: String(zone._id), rules: zone.rules as VisionZoneRules };
}

async function findDuplicate(companyId: Types.ObjectId, eventKey: string, payloadHash: string): Promise<IngestOutcome | null> {
  const existing = await VisionEventModel.findOne({ companyId, eventKey }).select("payloadHash").lean();
  if (!existing) return null;
  if (existing.payloadHash !== payloadHash) {
    throw new AppError(409, "DUPLICATE_EVENT", "This eventKey was already used with a different payload.");
  }
  return { httpStatus: 200, body: { eventId: eventKey, ingestionStatus: "duplicate" } };
}

async function decideCount(input: VisionIngestInput, zone: LoadedZone | null, companyId: Types.ObjectId): Promise<CountDecision> {
  if (input.movement?.countDelta !== 1) return { countDelta: 0, suppressedReason: null };
  if (!zone || !input.track) return { countDelta: 0, suppressedReason: "NO_ZONE_OR_TRACK" };

  const rules = zone.rules;
  if (!rules.objectClasses.includes(input.track.class as VisionObjectClass)) {
    return { countDelta: 0, suppressedReason: "CLASS_NOT_ENABLED" };
  }
  if (input.track.confidence < rules.minimumConfidence) {
    return { countDelta: 0, suppressedReason: "BELOW_MIN_CONFIDENCE" };
  }

  const alreadyCounted = await VisionCountLedgerModel.exists({
    companyId,
    zoneId: new Types.ObjectId(zone.id),
    trackId: input.track.trackId,
  });
  if (alreadyCounted) return { countDelta: 0, suppressedReason: "TRACK_ALREADY_COUNTED" };

  return { countDelta: 1, suppressedReason: null };
}

async function writeEventAndCount(
  input: VisionIngestInput,
  payloadHash: string,
  zone: LoadedZone | null,
  companyId: Types.ObjectId
): Promise<void> {
  const decision = await decideCount(input, zone, companyId);
  const siteId = new Types.ObjectId(input.siteId);
  const cameraId = new Types.ObjectId(input.cameraId);
  const zoneId = zone ? new Types.ObjectId(zone.id) : null;

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await VisionEventModel.create(
        [
          {
            companyId,
            eventKey: input.eventKey,
            payloadHash,
            siteId,
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
            detector: input.model ?? { name: "cargo-yolov8n-pkg", version: "1.2.0" },
          },
        ],
        { session }
      );

      if (decision.countDelta === 1 && input.track && input.movement && zoneId) {
        await VisionCountLedgerModel.create(
          [
            {
              companyId,
              eventKey: input.eventKey,
              siteId,
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