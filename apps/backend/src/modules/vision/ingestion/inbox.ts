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

// Hands an accepted worker event to the cargo event workflow (contract 2). The company comes from the
// site, notifications go to the right reviewers, and the same eventKey is never stored twice.
export async function forwardToInbox(input: VisionIngestInput): Promise<void> {
  if (!ALERT_TYPES.has(input.eventType)) return;

  const base = {
    eventKey: input.eventKey,
    siteId: input.siteId,
    cameraId: input.cameraId,
    // the worker's zone lives in the vision collections, so it is kept in the payload instead
    zoneId: null,
    eventType: input.eventType as never,
    occurredAt: input.occurredAt,
    model: input.model ?? null,
    payload: { visionZoneId: input.zoneId ?? null, track: input.track ?? null, movement: input.movement ?? null },
  };

  try {
    try {
      await createCargoEvent({ ...base, evidence: input.evidence ?? undefined });
    } catch (err) {
      // evidence that was not uploaded through our endpoint is refused: keep the event, drop the files
      if (!(err instanceof AppError) || err.status !== 400 || !input.evidence) throw err;
      await createCargoEvent({ ...base, payload: { ...base.payload, evidenceUnavailable: true } });
    }
  } catch (err) {
    logger.warn("could not forward event to the inbox", { eventKey: input.eventKey, ...errorFields(err) });
  }
}
