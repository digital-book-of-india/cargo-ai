import mongoose from "mongoose";
import { VisionCameraMonitorModel, VisionZoneModel } from "../../models";
import { getObservedCount as ledgerTotals } from "../../modules/vision/counts/service";
import type { SessionDirection } from "@dbi/api-types";

// Contract 3: the number of packages the counting service saw. The default reads the AI pipeline's count
// ledger; tests and other sources can replace it with setObservedCountProvider. It says "not
// available" (null) when counting is not set up, so nothing is ever invented.

export interface ObservedCountQuery {
  companyId: string;
  siteId: string;
  zoneId?: string | null;
  from: Date;
  to: Date;
}

export interface ObservedCounts {
  /** counted crossings in each direction (count_delta summed) */
  inCount: number;
  outCount: number;
}

// null means "the counting service cannot say" (not set up, or unreachable)
export type ObservedCountProvider = (query: ObservedCountQuery) => Promise<ObservedCounts | null>;

// Shared across module copies, so the server and the test runner see the same provider.
const registry = globalThis as unknown as { __dbiObservedProvider?: ObservedCountProvider };

// Default source: the counting ledger written by the AI pipeline (vision_count_ledger), read through its
// own service. A site where nobody has enabled monitoring has no counts at all, so it answers "not
// available" (null) instead of a misleading zero.
const ledgerProvider: ObservedCountProvider = async (q) => {
  if (mongoose.connection.readyState !== 1) return null;
  // For a counting line, what matters is that the line's own camera is monitored. Without a line, any monitored camera at the site.
  let monitored: unknown;
  const company = q.companyId ? { companyId: new mongoose.Types.ObjectId(q.companyId) } : {};
  if (q.zoneId) {
    const line = await VisionZoneModel.findOne({ _id: q.zoneId, siteId: q.siteId }).select("cameraId").lean();
    monitored = line ? await VisionCameraMonitorModel.exists({ cameraId: line.cameraId, enabled: true, ...company }) : null;
  } else {
    monitored = await VisionCameraMonitorModel.exists({ siteId: new mongoose.Types.ObjectId(q.siteId), enabled: true, ...company });
  }
  if (!monitored) return null;
  const totals = await ledgerTotals({
    companyId: q.companyId,
    siteId: q.siteId,
    zoneId: q.zoneId ?? undefined,
    from: q.from,
    to: new Date(q.to.getTime() + 1), // the ledger query excludes its end
  });
  return { inCount: totals.in, outCount: totals.out };
};

export function setObservedCountProvider(provider: ObservedCountProvider | null): void {
  registry.__dbiObservedProvider = provider ?? undefined;
}

export async function getObservedCount(query: ObservedCountQuery): Promise<ObservedCounts | null> {
  const provider = registry.__dbiObservedProvider ?? ledgerProvider;
  try {
    return await provider(query);
  } catch {
    return null; // an unreachable counting service must never produce a number
  }
}

export function observedForSession(direction: SessionDirection, counts: ObservedCounts): number {
  return direction === "outbound" ? counts.outCount : counts.inCount;
}