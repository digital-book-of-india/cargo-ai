import type { Types } from "mongoose";
import { SESSION_DISCLAIMER } from "@dbi/api-types";
import { CameraModel, LoadingSessionModel, VisionZoneModel } from "../../models";
import type { ILoadingSessionDocument } from "../../models";
import { errorFields, logger } from "../../utils/logger";
import { createCargoEvent } from "../events/createEvent";

// An event needs a camera: the counting line's own, otherwise the first camera at the site.
async function mismatchCamera(s: ILoadingSessionDocument): Promise<Types.ObjectId | null> {
  if (s.zoneId) {
    const zone = await VisionZoneModel.findOne({ _id: s.zoneId, siteId: s.siteId }).select("cameraId").lean();
    if (zone?.cameraId) return zone.cameraId as Types.ObjectId;
  }
  const cam = await CameraModel.findOne({ siteId: s.siteId, companyId: s.companyId }).sort({ createdAt: 1 }).select("_id").lean();
  return (cam?._id as Types.ObjectId) ?? null;
}

export interface MismatchEventInfo {
  id: string;
  severity: string;
  summary: string;
  created: boolean;
}

// Creates the review-required count_mismatch event of a closed session and links it to the session. The event key is
// fixed per session, so calling this again (a retry, or the repair step) never creates a second event.
export async function ensureMismatchEvent(session: ILoadingSessionDocument, actorUserId: string | null): Promise<MismatchEventInfo | null> {
  if (session.reconciliationStatus !== "review_required" || !session.closedAt) return null;
  const camera = await mismatchCamera(session);
  if (!camera) return null; // no camera at the site: nothing can be attached yet

  const difference = session.difference ?? 0;
  const { event, created } = await createCargoEvent({
    eventKey: `count-mismatch:${session._id.toString()}`,
    siteId: session.siteId.toString(),
    cameraId: camera.toString(),
    zoneId: session.zoneId?.toString() ?? null,
    loadingSessionId: session._id.toString(),
    eventType: "count_mismatch",
    severity: "high",
    summary: `Count mismatch: expected ${session.expectedCountSnapshot}, observed ${session.observedCount} (${difference > 0 ? "+" : ""}${difference}).`,
    occurredAt: session.closedAt,
    payload: {
      expectedCount: session.expectedCountSnapshot,
      observedCount: session.observedCount,
      difference: session.difference,
      tolerance: session.toleranceUsed,
      coverageGap: Boolean(session.coverageGap),
      disclaimer: SESSION_DISCLAIMER,
    },
    actorUserId,
  });
  if (!session.mismatchEventId || !session.mismatchEventId.equals(event._id as Types.ObjectId)) {
    await LoadingSessionModel.updateOne({ _id: session._id }, { $set: { mismatchEventId: event._id } });
  }
  return { id: event._id.toString(), severity: event.severity, summary: event.summary, created };
}

// Finds closed sessions that need a mismatch event but have none (the event could not be created at close time) and
// creates it. Safe to run every minute.
export async function repairMismatchEvents(limit = 50): Promise<{ created: number; checked: number }> {
  const sessions = await LoadingSessionModel.find({
    reconciliationStatus: "review_required",
    closedAt: { $ne: null },
    mismatchEventId: null,
  })
    .sort({ closedAt: 1 })
    .limit(limit);
  let created = 0;
  for (const s of sessions) {
    try {
      const info = await ensureMismatchEvent(s, s.closedBy?.toString() ?? null);
      if (info?.created) created++;
    } catch (err) {
      logger.warn("mismatch event repair failed for a session", { sessionId: s._id.toString(), ...errorFields(err) });
    }
  }
  return { created, checked: sessions.length };
}
