import { Router } from "express";
import { authenticate, requirePermission, resolveTenant } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { asyncHandler, parseLimit } from "../shared/http";
import { countSummary, listLedger, type DateRange, type SummaryGroupBy } from "./service";

// Mounted at /api/v1/counts (spec section 7)
export const visionCountsRouter = Router();

visionCountsRouter.use(authenticate, resolveTenant, requirePermission("monitoring:read"));

const MAX_RANGE_MS = 366 * 24 * 3600_000;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readDate(value: unknown, field: string): Date | undefined {
  const raw = readString(value);
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be an ISO 8601 date.`);
  }
  return new Date(ms);
}

function readRequiredRange(query: Record<string, unknown>): DateRange {
  const from = readDate(query.from, "from");
  const to = readDate(query.to, "to");
  if (!from || !to) throw new AppError(400, "VALIDATION_ERROR", "from and to (ISO 8601) are required.");
  if (to <= from) throw new AppError(400, "VALIDATION_ERROR", "to must be after from.");
  if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
    throw new AppError(400, "VALIDATION_ERROR", "The date range cannot exceed 366 days.");
  }
  return { from, to };
}

// GET /api/v1/counts/summary?siteId&from&to&groupBy=zone|camera|day
visionCountsRouter.get(
  "/summary",
  asyncHandler(async (req, res) => {
    const siteId = readString(req.query.siteId);
    if (!siteId) throw new AppError(400, "VALIDATION_ERROR", "siteId is required.");

    const groupBy = readString(req.query.groupBy) ?? "zone";
    if (groupBy !== "zone" && groupBy !== "camera" && groupBy !== "day" && groupBy !== "shift") {
      throw new AppError(400, "VALIDATION_ERROR", "groupBy must be zone, camera, day or shift.");
    }

    const range = readRequiredRange(req.query as Record<string, unknown>);
    const data = await countSummary(req, { siteId, ...range, groupBy: groupBy as SummaryGroupBy });
    res.json({ data });
  })
);

// GET /api/v1/counts/ledger?siteId&zoneId&cameraId&direction&from&to&cursor&limit
visionCountsRouter.get(
  "/ledger",
  asyncHandler(async (req, res) => {
    const siteId = readString(req.query.siteId);
    if (!siteId) throw new AppError(400, "VALIDATION_ERROR", "siteId is required.");

    const direction = readString(req.query.direction);
    if (direction && !["IN", "OUT", "UNKNOWN"].includes(direction)) {
      throw new AppError(400, "VALIDATION_ERROR", "direction must be IN, OUT or UNKNOWN.");
    }

    const hasRange = req.query.from !== undefined || req.query.to !== undefined;
    const range = hasRange ? readRequiredRange(req.query as Record<string, unknown>) : undefined;

    const data = await listLedger(req, {
      siteId,
      zoneId: readString(req.query.zoneId),
      cameraId: readString(req.query.cameraId),
      direction,
      range,
      cursor: readString(req.query.cursor),
      limit: parseLimit(req.query.limit),
    });
    res.json({ data });
  })
);
