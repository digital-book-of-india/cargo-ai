import mongoose from "mongoose";

export const escapeRegex = (text: string): string => {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

export const sanitizeString = (val: unknown): string => {
  if (typeof val !== "string") return "";
  return val.trim();
};

export const parsePagination = (query: any) => {
  const page = Math.max(1, parseInt(query.page as string, 10) || 1);
  const rawLimit = parseInt(query.limit as string, 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit));
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

export const isValidObjectId = (id: string): boolean => {
  return mongoose.Types.ObjectId.isValid(id) && new mongoose.Types.ObjectId(id).toString() === id;
};

// Strict ISO date check
export const isValidIsoDate = (dateStr: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/.test(dateStr)) {
    return false;
  }
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
};

let txSupported: boolean | null = null;
export async function supportsTransactions(): Promise<boolean> {
  if (txSupported !== null) return txSupported;
  try {
    if (!mongoose.connection.db) return false;
    const info: any = await mongoose.connection.db.admin().command({ hello: 1 });
    txSupported = Boolean(info.setName) || info.msg === "isdbgrid";
    return txSupported;
  } catch {
    return false; // Do not cache permanent failure
  }
}

export const computeEffectiveCameraStatus = (
  rawStatus: string,
  lastHealthAt: Date | null | undefined,
  lastFrameAt: Date | null | undefined,
  staleThresholdSeconds = 120
) => {
  const now = Date.now();
  const thresholdMs = staleThresholdSeconds * 1000;

  if (rawStatus === "ERROR") return { effectiveStatus: "ERROR" as const, isStale: false };
  if (rawStatus === "PENDING_TEST") return { effectiveStatus: "PENDING_TEST" as const, isStale: false };
  if (rawStatus === "OFFLINE") return { effectiveStatus: "OFFLINE" as const, isStale: true };

  const healthFresh = lastHealthAt ? now - new Date(lastHealthAt).getTime() <= thresholdMs : false;
  const frameFresh = lastFrameAt ? now - new Date(lastFrameAt).getTime() <= thresholdMs : false;

  if (!lastHealthAt) return { effectiveStatus: "OFFLINE" as const, isStale: true };
  if (!lastFrameAt) return { effectiveStatus: "DEGRADED" as const, isStale: true };

  if (healthFresh && frameFresh) return { effectiveStatus: "ONLINE" as const, isStale: false };
  if ((healthFresh && !frameFresh) || (!healthFresh && frameFresh)) {
    return { effectiveStatus: "DEGRADED" as const, isStale: true };
  }

  return { effectiveStatus: "OFFLINE" as const, isStale: true };
};

export const getAiWorkerHealthSnapshot = async (
  AiWorkerHealthModel: any,
  workerStaleThreshold = 60
) => {
  try {
    const workerDoc: any = await AiWorkerHealthModel.findOne()
      .sort({ lastHeartbeatAt: -1 })
      .lean();

    if (!workerDoc) {
      return { status: "UNKNOWN" as const, lastHeartbeatAt: null, isStale: true };
    }

    const lastHeartbeatAt = workerDoc.lastHeartbeatAt
      ? new Date(workerDoc.lastHeartbeatAt).toISOString()
      : null;

    const isFresh = workerDoc.lastHeartbeatAt
      ? Date.now() - new Date(workerDoc.lastHeartbeatAt).getTime() <= workerStaleThreshold * 1000
      : false;

    const status = isFresh && workerDoc.status === "ONLINE" ? ("ONLINE" as const) : ("OFFLINE" as const);
    return { status, lastHeartbeatAt, isStale: !isFresh };
  } catch {
    return { status: "UNKNOWN" as const, lastHeartbeatAt: null, isStale: true };
  }
};