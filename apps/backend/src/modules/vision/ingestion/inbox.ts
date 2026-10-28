import type { VisionIngestInput } from "@dbi/validation";
import { AppError } from "../../../middleware/errorHandler";
import { createCargoEvent } from "../../../services/events/createEvent";
import { errorFields, logger } from "../../../utils/logger";

// Event types that a person should review. Line crossings, zone entry/exit and plain detections are
// counting data: they live in the ledger and the vision events, not in the inbox.
const ALERT_TYPES = new Set([
  "restricted_zone_movement",
  "unusual_after_hours_movement",
  "count_mismatch",
  "possible_package_damage",
  "possible_seal_appearance_change",
  "camera_offline",
  "ai_service_unavailable",
]);

// Hands an accepted worker event to the cargo event workflow (contract 2).
export async function forwardToInbox(input: VisionIngestInput): Promise<string | null> {
  if (!ALERT_TYPES.has(input.eventType)) return null;

  const base = {
    eventKey: input.eventKey,
    siteId: input.siteId,
    cameraId: input.cameraId,
    zoneId: input.zoneId ? String(input.zoneId) : null,
    eventType: input.eventType as never,
    occurredAt: input.occurredAt,
    model: input.model ?? null,
    payload: { visionZoneId: input.zoneId ?? null, track: input.track ?? null, movement: input.movement ?? null },
  };

  try {
    try {
      return String((await createCargoEvent({ ...base, evidence: input.evidence ?? undefined })).event._id);
    } catch (err) {
      if (!(err instanceof AppError) || err.status !== 400 || !input.evidence) throw err;
      return String((await createCargoEvent({ ...base, payload: { ...base.payload, evidenceUnavailable: true } })).event._id);
    }
  } catch (err) {
    if (err instanceof AppError && err.status < 500) {
      logger.warn("could not forward event to the inbox", { eventKey: input.eventKey, ...errorFields(err) });
      return null;
    }
    throw err;
  }
}