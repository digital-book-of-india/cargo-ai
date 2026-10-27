import type { Types } from "mongoose";
import { LoadingSessionModel, VisionCameraMonitorModel, VisionZoneModel } from "../../models";
import { AppError } from "../../middleware/errorHandler";

// A camera owns counting lines and a monitor (vision data). Moving or deleting the camera must look after them,
// otherwise counting silently stops (the worker would keep reporting the old site) or a deleted camera stays in the
// worker's configuration.

async function openSessionOnCamera(cameraId: Types.ObjectId): Promise<boolean> {
  const lines = await VisionZoneModel.find({ cameraId }).select("_id").lean();
  if (lines.length === 0) return false;
  return Boolean(await LoadingSessionModel.exists({ zoneId: { $in: lines.map((l) => l._id) }, closedAt: null }));
}

// Refuses (409) while a loading session is counting on one of the camera's lines: the session would lose its line.
export async function assertCameraFreeOfOpenSessions(cameraId: Types.ObjectId, doing: "moved" | "deleted"): Promise<void> {
  if (await openSessionOnCamera(cameraId)) {
    throw new AppError(409, "CONFLICT", `This camera cannot be ${doing} while a loading session is counting on one of its lines. Close the session first.`);
  }
}

// The camera now belongs to another site: its lines and monitor follow it. Counts already written keep their old site.
export async function followCameraToSite(cameraId: Types.ObjectId, siteId: Types.ObjectId): Promise<void> {
  await VisionZoneModel.updateMany({ cameraId }, { $set: { siteId } });
  await VisionCameraMonitorModel.updateMany({ cameraId }, { $set: { siteId } });
}

// The camera is deleted: its lines are archived (their counts and history stay) and monitoring is switched off, so the
// worker no longer receives it.
export async function retireCameraVisionData(cameraId: Types.ObjectId): Promise<void> {
  await VisionZoneModel.updateMany({ cameraId, status: { $ne: "archived" } }, { $set: { status: "archived" } });
  await VisionCameraMonitorModel.updateMany({ cameraId }, { $set: { enabled: false, disabledAt: new Date() } });
}
