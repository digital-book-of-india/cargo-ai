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

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const MAX_ATTEMPTS = 2;
const LOOKUP_TTL_MS = 60_000;

// In-memory 60s TTL caches to prevent Mongo connection starvation under high ingestion FPS
const cameraCache = new Map<string, CacheEntry<{ siteId: string; companyId: Types.ObjectId } | null>>();
const zoneCache = new Map<
  string,
  CacheEntry<{
    _id: Types.ObjectId;
    siteId: string;
    cameraId: string;
    companyId: string;
    status: string;
    rules: VisionZoneRules;
  } | null>
>();

async function getCachedCamera(cameraId: string): Promise<{ siteId: string; companyId: Types.ObjectId } | null> {
  const now = Date.now();
  const cached = cameraCache.get(cameraId);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }

  const camera = await CameraModel.findById(cameraId).select("siteId companyId").lean<{ siteId: Types.ObjectId; companyId: Types.ObjectId }>();
  const data = camera ? { siteId: String(camera.siteId), companyId: camera.companyId } : null;
  cameraCache.set(cameraId, { data, expiresAt: now + LOOKUP_TTL_MS });

  if (cameraCache.size > 2000) {
    for (const [k, v] of cameraCache.entries()) {
      if (now > v.expiresAt) cameraCache.delete(k);
    }
  }

  return data;
}

async function getCachedZone(zoneId: string) {
  const now = Date.now();
  const cached = zoneCache.get(zoneId);
  if (cached && now < cached.expiresAt) {
    return cached.data;
  }

  const zone = await VisionZoneModel.findById(zoneId).select("siteId cameraId companyId status rules").lean<{
    _id: Types.ObjectId;
    siteId: Types.ObjectId;
    cameraId: Types.ObjectId;
    companyId: Types.ObjectId;
    status: string;
    rules: VisionZoneRules;
  }>();

  const data = zone
    ? {
        _id: zone._id,
        siteId: String(zone.siteId),
        cameraId: String(zone.cameraId),
        companyId: String(zone.companyId),
        status: zone.status,
        rules: zone.rules as VisionZoneRules,
      }
    : null;

  zoneCache.set(zoneId, { data, expiresAt: now + LOOKUP_TTL_MS });

  if (zoneCache.size > 2000) {
    for (const [k, v] of zoneCache.entries()) {
      if (now > v.expiresAt) zoneCache.delete(k);
    }
  }

  return data;
}

export async function ingestVisionEvent(
  input: VisionIngestInput,
  idempotencyKey?: string
): Promise<IngestOutcome> {
  if (idempotencyKey !== undefined && idempotencyKey !== input.eventKey) {
    throw new AppError(400, "VALIDATION_ERROR", "Idempotency-Key header must equal eventKey.");
  }

  // Tenant checks use cached metadata (60s TTL) to prevent MongoDB thread starvation
  const camera = await getCachedCamera(input.cameraId);
  if (!camera || camera.siteId !== input.siteId) {
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

async function loadEnabledZone(
  zoneId: string,
  cameraId: string,
  siteId: string,
  companyId?: string | Types.ObjectId
): Promise<LoadedZone> {
  const zone = await getCachedZone(zoneId);
  if (!zone || zone.cameraId !== cameraId || zone.siteId !== siteId) {
    throw new AppError(404, "NOT_FOUND", "Zone not found for this camera.");
  }
  if (companyId && zone.companyId && zone.companyId !== String(companyId)) {
    throw new AppError(403, "FORBIDDEN", "Cross-tenant zone access prohibited.");
  }
  if (zone.status !== "active") {
    throw new AppError(422, "BUSINESS_RULE_FAILED", "Zone is not enabled for monitoring.");
  }
  return { id: String(zone._id), rules: zone.rules };
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