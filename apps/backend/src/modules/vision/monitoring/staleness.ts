import crypto from "crypto";
import { Types } from "mongoose";
import { env } from "../../../config/env";
import { AiWorkerHealthModel, CameraModel, VisionCameraMonitorModel, VisionEventModel } from "../../../models";

const TICK_MS = 15_000;
let timer: NodeJS.Timeout | null = null;

type MonitorRow = {
  siteId?: Types.ObjectId;
  shopId?: Types.ObjectId;
  cameraId: Types.ObjectId;
  lastFrameAt?: Date | null;
  workerId?: string | null;
};
type WorkerRow = { workerId: string; status: "ONLINE" | "DEGRADED" | "OFFLINE"; lastHeartbeatAt: Date };
type SystemEventType = "camera_offline" | "ai_service_unavailable";

export function startVisionMonitorJob(): void {
  if (timer) return;
  timer = setInterval(() => {
    runStalenessCheck().catch((err) => console.error("[vision-monitor] staleness check failed", err));
  }, TICK_MS);
  timer.unref();
}

export function stopVisionMonitorJob(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function runStalenessCheck(now: Date = new Date()): Promise<{ cameraOffline: number; aiUnavailable: number }> {
  const monitors = await VisionCameraMonitorModel.find({ enabled: true })
    .select("siteId shopId cameraId lastFrameAt workerId")
    .lean<MonitorRow[]>();
  if (monitors.length === 0) return { cameraOffline: 0, aiUnavailable: 0 };

  const workerIds = [...new Set(monitors.map((m) => m.workerId).filter((w): w is string => !!w))];
  const workers = workerIds.length
    ? await AiWorkerHealthModel.find({ workerId: { $in: workerIds } }).lean<WorkerRow[]>()
    : [];
  const workerBy = new Map(workers.map((w) => [w.workerId, w]));

  const cameraStaleMs = env.cameraStaleSeconds * 1000;
  const workerStaleMs = env.workerStaleSeconds * 1000;
  const nowMs = now.getTime();
  let cameraOffline = 0;
  let aiUnavailable = 0;

  for (const m of monitors) {
    const lastFrame = m.lastFrameAt ? new Date(m.lastFrameAt) : null;
    if (!lastFrame || nowMs - lastFrame.getTime() > cameraStaleMs) {
      const episode = lastFrame ? lastFrame.toISOString() : "never";
      if (await recordSystemEvent(m, "camera_offline", episode, lastFrame ?? now)) cameraOffline++;
    }

    const worker = m.workerId ? workerBy.get(m.workerId) : undefined;
    const workerStale =
      !worker ||
      worker.status === "OFFLINE" ||
      nowMs - new Date(worker.lastHeartbeatAt).getTime() > workerStaleMs;
    if (workerStale) {
      const episode = worker ? new Date(worker.lastHeartbeatAt).toISOString() : "never";
      if (await recordSystemEvent(m, "ai_service_unavailable", episode, now)) aiUnavailable++;
    }
  }

  return { cameraOffline, aiUnavailable };
}

async function recordSystemEvent(
  m: MonitorRow,
  eventType: SystemEventType,
  episode: string,
  occurredAt: Date
): Promise<boolean> {
  let siteId = m.siteId || m.shopId;
  if (!siteId) {
    const cam = await CameraModel.findById(m.cameraId).select("siteId shopId").lean<{ siteId?: Types.ObjectId; shopId?: Types.ObjectId }>();
    siteId = cam?.siteId || cam?.shopId;
  }
  if (!siteId) {
    return false;
  }

  const eventKey = `${eventType}:${String(m.cameraId)}:${episode}`;
  try {
    await VisionEventModel.create({
      eventKey,
      payloadHash: crypto.createHash("sha256").update(eventKey).digest("hex"),
      siteId,
      cameraId: m.cameraId,
      zoneId: null,
      eventType,
      occurredAt,
      track: null,
      movement: null,
      evidence: null,
      detector: { name: "monitor", version: "1" },
    });
    return true;
  } catch (err) {
    if ((err as { code?: number } | null)?.code === 11000) return false;
    throw err;
  }
}
