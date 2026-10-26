import type { Request } from "express";
import { Types } from "mongoose";
import type { VisionCountLedgerRow, VisionCountSummaryRow, VisionCountTotals } from "@dbi/api-types";
import { ShopModel, VisionCountLedgerModel, type IVisionCountLedgerDocument } from "../../../models";
import { AppError } from "../../../middleware/errorHandler";
import { assertShopAccess } from "../shared/access";
import { parseObjectId } from "../shared/http";

export type SummaryGroupBy = "zone" | "camera" | "day" | "shift";

export interface DateRange {
  from: Date;
  to: Date;
}

interface MatchInput extends DateRange {
  siteId: string;
  zoneId?: string;
  cameraId?: string;
  direction?: string;
}

function matchStage(input: MatchInput): Record<string, unknown> {
  const match: Record<string, unknown> = {
    shopId: parseObjectId(input.siteId, "siteId"),
    occurredAt: { $gte: input.from, $lt: input.to },
  };
  if (input.zoneId) match.zoneId = parseObjectId(input.zoneId, "zoneId");
  if (input.cameraId) match.cameraId = parseObjectId(input.cameraId, "cameraId");
  if (input.direction) match.direction = input.direction;
  return match;
}

function emptyTotals(): VisionCountTotals {
  return { in: 0, out: 0, unknown: 0, total: 0 };
}

function addToTotals(totals: VisionCountTotals, direction: string, n: number): void {
  if (direction === "IN") totals.in += n;
  else if (direction === "OUT") totals.out += n;
  else totals.unknown += n;
  totals.total += n;
}

// Contract for Dev 1 (shift and session reports). The caller must already have authorised siteId.
export interface ObservedCountInput {
  siteId: string;
  zoneId?: string;
  cameraId?: string;
  from: Date;
  to: Date; // exclusive
}

export async function getObservedCount(input: ObservedCountInput): Promise<VisionCountTotals> {
  const rows = await VisionCountLedgerModel.aggregate<{ _id: string; n: number }>([
    { $match: matchStage(input) },
    { $group: { _id: "$direction", n: { $sum: "$countDelta" } } },
  ]);
  const totals = emptyTotals();
  for (const row of rows) addToTotals(totals, row._id, row.n);
  return totals;
}

export async function countSummary(
  req: Request,
  input: DateRange & { siteId: string; groupBy: SummaryGroupBy }
): Promise<{ groupBy: SummaryGroupBy; items: VisionCountSummaryRow[] }> {
  const shopId = parseObjectId(input.siteId, "siteId");
  await assertShopAccess(req, shopId.toString());

  const shop = await ShopModel.findById(shopId).select("timezone").lean();
  if (!shop) throw new AppError(404, "NOT_FOUND", "Site not found.");

  const tz = shop.timezone || "Asia/Kolkata";

  let groupKey: unknown;
  if (input.groupBy === "zone") {
    groupKey = "$zoneId";
  } else if (input.groupBy === "camera") {
    groupKey = "$cameraId";
  } else if (input.groupBy === "day") {
    groupKey = { $dateToString: { format: "%Y-%m-%d", date: "$occurredAt", timezone: tz } };
  } else {
    // shift grouping in site timezone: Morning (06-14), Afternoon (14-22), Night (22-06)
    const hourExpr = { $hour: { date: "$occurredAt", timezone: tz } };
    groupKey = {
      $switch: {
        branches: [
          { case: { $and: [{ $gte: [hourExpr, 6] }, { $lt: [hourExpr, 14] }] }, then: "Morning (06:00-14:00)" },
          { case: { $and: [{ $gte: [hourExpr, 14] }, { $lt: [hourExpr, 22] }] }, then: "Afternoon (14:00-22:00)" },
        ],
        default: "Night (22:00-06:00)",
      },
    };
  }

  const rows = await VisionCountLedgerModel.aggregate<{ _id: { key: unknown; direction: string }; n: number }>([
    { $match: matchStage({ siteId: input.siteId, from: input.from, to: input.to }) },
    { $group: { _id: { key: groupKey, direction: "$direction" }, n: { $sum: "$countDelta" } } },
  ]);

  const byKey = new Map<string, VisionCountSummaryRow>();
  for (const row of rows) {
    const key = String(row._id.key);
    const item = byKey.get(key) ?? { key, ...emptyTotals() };
    addToTotals(item, row._id.direction, row.n);
    byKey.set(key, item);
  }

  return {
    groupBy: input.groupBy,
    items: [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function toLedgerRow(doc: IVisionCountLedgerDocument): VisionCountLedgerRow {
  return {
    id: String(doc._id),
    eventKey: doc.eventKey,
    siteId: String(doc.shopId),
    cameraId: String(doc.cameraId),
    zoneId: String(doc.zoneId),
    trackId: doc.trackId,
    direction: doc.direction,
    countDelta: 1,
    confidence: doc.confidence ?? null,
    occurredAt: doc.occurredAt.toISOString(),
  };
}

export async function listLedger(
  req: Request,
  input: {
    siteId: string;
    zoneId?: string;
    cameraId?: string;
    direction?: string;
    range?: DateRange;
    cursor?: string;
    limit: number;
  }
): Promise<{ items: VisionCountLedgerRow[]; nextCursor: string | null }> {
  const shopId = parseObjectId(input.siteId, "siteId");
  await assertShopAccess(req, shopId.toString());

  const filter: Record<string, any> = { shopId };
  if (input.zoneId) filter.zoneId = parseObjectId(input.zoneId, "zoneId");
  if (input.cameraId) filter.cameraId = parseObjectId(input.cameraId, "cameraId");
  if (input.direction) filter.direction = input.direction;
  if (input.range) filter.occurredAt = { $gte: input.range.from, $lt: input.range.to };
  if (input.cursor) filter._id = { $lt: parseObjectId(input.cursor, "cursor") };

  const docs = await VisionCountLedgerModel.find(filter).sort({ _id: -1 }).limit(input.limit + 1);
  const hasMore = docs.length > input.limit;
  const page = docs.slice(0, input.limit);
  return {
    items: page.map(toLedgerRow),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
  };
}

export { Types };
