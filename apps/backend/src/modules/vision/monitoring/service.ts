import type { Request } from "express";
import { Types } from "mongoose";
import type {
  VisionCameraMonitoringStatus,
  VisionCoverage,
  VisionLimitation,
  VisionMonitoringStatusResponse,
  VisionStreamStatus,
  VisionWorkerConfig,
  VisionWorkerStatus,
} from "@dbi/api-types";
import type { WorkerHeartbeatInput } from "@dbi/validation";
import { env } from "../../../config/env";
import {
  AiWorkerHealthModel,
  CameraModel,
  VisionCameraMonitorModel,
  VisionZoneModel,
} from "../../../models";
import { AppError } from "../../../middleware/errorHandler";
import { assertShopAccess } from "../shared/access";
import { parseObjectId } from "../shared/http";

// Worker is told this in the config response, so it can change without a code change.
export const WORKER_HEARTBEAT_INTERVAL_SECONDS = 15;

type MonitorLean = {
  shopId: Types.ObjectId;
  cameraId: Types.ObjectId;
  enabled: boolean;
  lastFrameAt?: Date | null;
  streamStatus?: VisionStreamStatus;
  streamErrorCode?: string | null;
  frameRate?: number | null;
  workerId?: string | null;
};

type WorkerLean = {
  workerId: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  lastHeartbeatAt: Date;
};

type ZoneLean = {
  _id: Types.ObjectId;
  cameraId: Types.ObjectId;
  zoneType: VisionWorkerConfig["cameras"][number]["zones"][number]["zoneType"];
  geometry: VisionWorkerConfig["cameras"][number]["zones"][number]["geometry"];
  rules: VisionWorkerConfig["cameras"][number]["zones"][number]["rules"];
};

// Pure function: coverage is never "LIVE" when the stream or the worker is stale (spec section 11).
export function buildCameraStatus(input: {
  cameraId: Types.ObjectId;
  cameraName: string;
  monitor: MonitorLean | undefined;
  activeZoneCount: number;
  worker: WorkerLean | undefined;
  nowMs: number;
}): VisionCameraMonitoringStatus {
  const { monitor, worker, nowMs } = input;
  const enabled = monitor?.enabled === true;
  const streamStatus: VisionStreamStatus = monitor?.streamStatus ?? "UNKNOWN";
  const lastFrameMs = monitor?.lastFrameAt ? new Date(monitor.lastFrameAt).getTime() : null;

  const cameraStale = lastFrameMs === null || nowMs - lastFrameMs > env.cameraStaleSeconds * 1000;
  const workerStale =
    !worker ||
    worker.status === "OFFLINE" ||
    nowMs - new Date(worker.lastHeartbeatAt).getTime() > env.workerStaleSeconds * 1000;

  const limitations: VisionLimitation[] = [];
  let coverage: VisionCoverage;

  if (!enabled) {
    coverage = "NOT_MONITORED";
    limitations.push("MONITORING_DISABLED");
  } else {
    if (input.activeZoneCount === 0) limitations.push("NO_ACTIVE_ZONE");
    if (workerStale) limitations.push("WORKER_UNAVAILABLE");
    if (lastFrameMs === null) limitations.push("NO_FRAME_REPORTED");
    else if (cameraStale) limitations.push("STREAM_STALE");
    if (streamStatus === "ERROR") limitations.push("STREAM_ERROR");
    if (streamStatus === "RECONNECTING") limitations.push("STREAM_RECONNECTING");

    if (workerStale || cameraStale || streamStatus === "ERROR") coverage = "OFFLINE";
    else if (limitations.length > 0) coverage = "DEGRADED";
    else coverage = "LIVE";
  }

  const workerStatus: VisionWorkerStatus = !worker ? "UNKNOWN" : workerStale ? "OFFLINE" : worker.status;

  return {
    cameraId: String(input.cameraId),
    cameraName: input.cameraName,
    enabled,
    coverage,
    limitations,
    streamStatus,
    streamErrorCode: monitor?.streamErrorCode ?? null,
    lastFrameAt: monitor?.lastFrameAt ? new Date(monitor.lastFrameAt).toISOString() : null,
    frameRate: monitor?.frameRate ?? null,
    activeZoneCount: input.activeZoneCount,
    workerId: monitor?.workerId ?? null,
    workerStatus,
    workerLastHeartbeatAt: worker ? new Date(worker.lastHeartbeatAt).toISOString() : null,
  };
}

async function loadStatusItems(
  shopId: Types.ObjectId,
  onlyCameraId?: Types.ObjectId
): Promise<VisionCameraMonitoringStatus[]> {
  const cameraFilter: Record<string, unknown> = { shopId };
  if (onlyCameraId) cameraFilter._id = onlyCameraId;
  const cameras = await CameraModel.find(cameraFilter).select("name").lean<{ _id: Types.ObjectId; name: string }[]>();
  const cameraIds = cameras.map((c) => c._id);

  const [monitors, zoneRows, workers] = await Promise.all([
    VisionCameraMonitorModel.find({ cameraId: { $in: cameraIds } }).lean<MonitorLean[]>(),
    VisionZoneModel.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { cameraId: { $in: cameraIds }, status: "active" } },
      { $group: { _id: "$cameraId", n: { $sum: 1 } } },
    ]),
    AiWorkerHealthModel.find({}).lean<WorkerLean[]>(),
  ]);

  const monitorBy = new Map(monitors.map((m) => [String(m.cameraId), m]));
  const zoneBy = new Map(zoneRows.map((z) => [String(z._id), z.n]));
  const workerBy = new Map(workers.map((w) => [w.workerId, w]));
  const latestWorker = workers.reduce<WorkerLean | undefined>(
    (best, w) => (!best || new Date(w.lastHeartbeatAt) > new Date(best.lastHeartbeatAt) ? w : best),
    undefined
  );
  const nowMs = Date.now();

  return cameras.map((cam) => {
    const monitor = monitorBy.get(String(cam._id));
    const worker = (monitor?.workerId ? workerBy.get(monitor.workerId) : undefined) ?? latestWorker;
    return buildCameraStatus({
      cameraId: cam._id,
      cameraName: cam.name,
      monitor,
      activeZoneCount: zoneBy.get(String(cam._id)) ?? 0,
      worker,
      nowMs,
    });
  });
}

export async function getMonitoringStatus(req: Request, siteIdRaw: string): Promise<VisionMonitoringStatusResponse> {
  const shopId = parseObjectId(siteIdRaw, "siteId");
  await assertShopAccess(req, shopId.toString());
  return { checkedAt: new Date().toISOString(), items: await loadStatusItems(shopId) };
}

export async function setCameraMonitoring(
  req: Request,
  cameraIdRaw: string,
  enabled: boolean
): Promise<VisionCameraMonitoringStatus> {
  const cameraId = parseObjectId(cameraIdRaw, "cameraId");
  const camera = await CameraModel.findById(cameraId).select("shopId").lean<{ shopId: Types.ObjectId }>();
  if (!camera) throw new AppError(404, "NOT_FOUND", "Camera not found.");
  await assertShopAccess(req, String(camera.shopId));

  // Spec 5.1: monitoring can be enabled only after a successful zone validation.
  if (enabled) {
    const hasActiveZone = await VisionZoneModel.exists({ cameraId, status: "active" });
    if (!hasActiveZone) {
      throw new AppError(
        422,
        "BUSINESS_RULE_FAILED",
        "Validate and enable at least one zone before starting monitoring."
      );
    }
  }

  const now = new Date();
  await VisionCameraMonitorModel.updateOne(
    { cameraId },
    {
      $set: {
        shopId: camera.shopId,
        enabled,
        ...(enabled ? { enabledAt: now } : { disabledAt: now }),
      },
      $setOnInsert: {
        streamStatus: "UNKNOWN",
        streamErrorCode: null,
        lastFrameAt: null,
        frameRate: null,
        workerId: null,
      },
    },
    { upsert: true }
  );

  const [item] = await loadStatusItems(camera.shopId, cameraId);
  return item;
}

// Called by the AI worker. Only cameras that are enabled are updated; the rest are ignored.
export async function recordWorkerHeartbeat(
  input: WorkerHeartbeatInput
): Promise<{ accepted: number; ignored: number }> {
  const now = new Date();
  const streaming = input.cameras.filter((c) => c.streamStatus === "STREAMING").length;

  await AiWorkerHealthModel.updateOne(
    { workerId: input.workerId },
    { $set: { status: input.status, activeStreams: streaming, lastHeartbeatAt: now } },
    { upsert: true }
  );

  if (input.cameras.length === 0) return { accepted: 0, ignored: 0 };

  const cameraIds = input.cameras.map((c) => new Types.ObjectId(c.cameraId));
  const enabledMonitors = await VisionCameraMonitorModel.find({ cameraId: { $in: cameraIds }, enabled: true })
    .select("cameraId")
    .lean<{ cameraId: Types.ObjectId }[]>();
  const enabledIds = new Set(enabledMonitors.map((m) => String(m.cameraId)));

  const ops: Array<Record<string, unknown>> = [];
  let accepted = 0;
  let ignored = 0;

  for (const c of input.cameras) {
    if (!enabledIds.has(c.cameraId)) {
      ignored++;
      continue;
    }
    // Worker clock can be skewed: never store a frame time in the future.
    const frame = c.lastFrameAt ? new Date(Math.min(new Date(c.lastFrameAt).getTime(), now.getTime())) : null;
    ops.push({
      updateOne: {
        filter: { cameraId: new Types.ObjectId(c.cameraId) },
        update: {
          $set: {
            streamStatus: c.streamStatus,
            streamErrorCode: c.errorCode ?? null,
            frameRate: c.frameRate ?? null,
            workerId: input.workerId,
            lastReportedAt: now,
          },
          // $max: a late or replayed report can never move lastFrameAt backwards.
          ...(frame ? { $max: { lastFrameAt: frame } } : {}),
        },
      },
    });
    accepted++;
  }

  if (ops.length > 0) await VisionCameraMonitorModel.bulkWrite(ops as any);
  return { accepted, ignored };
}

// What the worker needs to run: enabled cameras with active zones. No secrets (stream URL comes from stream-config).
export async function getWorkerConfig(workerId: string): Promise<VisionWorkerConfig> {
  const monitors = await VisionCameraMonitorModel.find({ enabled: true })
    .select("shopId cameraId")
    .lean<{ shopId: Types.ObjectId; cameraId: Types.ObjectId }[]>();
  const cameraIds = monitors.map((m) => m.cameraId);

  const zones: ZoneLean[] = cameraIds.length
    ? await VisionZoneModel.find({ cameraId: { $in: cameraIds }, status: "active" }).lean<ZoneLean[]>()
    : [];

  const zonesByCamera = new Map<string, VisionWorkerConfig["cameras"][number]["zones"]>();
  for (const z of zones) {
    const key = String(z.cameraId);
    const list = zonesByCamera.get(key) ?? [];
    list.push({ id: String(z._id), zoneType: z.zoneType, geometry: z.geometry, rules: z.rules });
    zonesByCamera.set(key, list);
  }

  return {
    workerId,
    heartbeatIntervalSeconds: WORKER_HEARTBEAT_INTERVAL_SECONDS,
    cameras: monitors
      .map((m) => ({
        cameraId: String(m.cameraId),
        siteId: String(m.shopId),
        zones: zonesByCamera.get(String(m.cameraId)) ?? [],
      }))
      .filter((c) => c.zones.length > 0),
  };
}