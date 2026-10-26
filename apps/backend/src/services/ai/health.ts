import { AiWorkerHealthModel } from "../../models";

export interface AiWorkerHealthStatus {
  serviceName: string;
  status: "ONLINE" | "DEGRADED" | "OFFLINE";
  lastHeartbeatAt: Date;
  activeStreams: number;
}

export async function recordAiHeartbeat(
  data: Partial<AiWorkerHealthStatus> & { serviceName?: string }
): Promise<AiWorkerHealthStatus> {
  const workerId = data.serviceName || "default-worker";
  const status = data.status ?? "ONLINE";
  const activeStreams = data.activeStreams ?? 1;
  const now = new Date();

  const doc = await AiWorkerHealthModel.findOneAndUpdate(
    { workerId },
    {
      workerId,
      status,
      activeStreams,
      lastHeartbeatAt: now,
    },
    { upsert: true, new: true }
  );

  return {
    serviceName: doc.workerId,
    status: doc.status as "ONLINE" | "DEGRADED" | "OFFLINE",
    lastHeartbeatAt: doc.lastHeartbeatAt,
    activeStreams: doc.activeStreams,
  };
}

export async function getAiWorkerHealth(): Promise<AiWorkerHealthStatus> {
  const staleThresholdSeconds = Number(process.env.WORKER_STALE_SECONDS ?? 60);
  try {
    const workerDoc: any = await AiWorkerHealthModel.findOne()
      .sort({ lastHeartbeatAt: -1 })
      .lean();

    if (!workerDoc || !workerDoc.lastHeartbeatAt) {
      return {
        serviceName: "ai-worker",
        status: "OFFLINE",
        lastHeartbeatAt: new Date(0),
        activeStreams: 0,
      };
    }

    const isFresh =
      Date.now() - new Date(workerDoc.lastHeartbeatAt).getTime() <=
      staleThresholdSeconds * 1000;

    const status =
      isFresh && workerDoc.status === "ONLINE"
        ? ("ONLINE" as const)
        : ("OFFLINE" as const);

    return {
      serviceName: workerDoc.workerId || "ai-worker",
      status,
      lastHeartbeatAt: new Date(workerDoc.lastHeartbeatAt),
      activeStreams: workerDoc.activeStreams ?? 0,
    };
  } catch {
    return {
      serviceName: "ai-worker",
      status: "OFFLINE",
      lastHeartbeatAt: new Date(0),
      activeStreams: 0,
    };
  }
}
