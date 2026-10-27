import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import {
  CARGO_EVENT_TYPES,
  shiftAt,
  type CargoEventSeverity,
  type CargoEventType,
  type LoadingSession,
  type Shift,
} from "@dbi/api-types";
import { CameraModel, CargoEventModel, LoadingSessionModel, SiteModel, VisionZoneModel } from "../../models";
import type { ICargoEventDocument } from "../../models";
import { asyncHandler, guard } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { exportRateLimiter } from "../../middleware/rateLimiter";
import { auditFromRequest } from "../../services/audit/logger";
import { hasAllSiteAccess } from "../../services/authz/permissions";
import { toCsv } from "../../services/reports/csv";
import { localParts } from "../../services/reports/time";
import { getCompanySettings } from "../../services/settings/companySettings";
import { formatSessions } from "../shipments/routes";

export const reportsRouter = Router();

const HEALTH_TYPES: CargoEventType[] = ["camera_offline", "ai_service_unavailable"];
const DEFAULT_DAYS = 7;
const MAX_RANGE_DAYS = 92;
const MAX_EVENTS = 20_000; // reports scan at most this many events and say so when they stop
const MAX_EXPORT_ROWS = 10_000; // an export never silently drops rows: too many is an error

const oid = (v: unknown, field: string): Types.ObjectId | null => {
  if (v === undefined || v === "") return null;
  if (typeof v !== "string" || !Types.ObjectId.isValid(v)) throw new AppError(400, "VALIDATION_ERROR", `${field} is not valid.`);
  return new Types.ObjectId(v);
};

interface ReportFilters {
  from: Date;
  to: Date;
  siteIds: Types.ObjectId[] | null; // null = every site of the company
  cameraId: Types.ObjectId | null;
  zoneId: Types.ObjectId | null;
  eventType: CargoEventType | null;
  shift: Shift | null;
}

// The same access rules as the event list: company from the membership, only the sites the
// member may use. A site the member cannot use is a 404, exactly as elsewhere.
async function parseFilters(req: Request): Promise<ReportFilters> {
  const q = req.query;
  const now = new Date();
  const to = q.to ? new Date(String(q.to)) : now;
  const from = q.from ? new Date(String(q.from)) : new Date(to.getTime() - DEFAULT_DAYS * 86400_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new AppError(400, "VALIDATION_ERROR", "from and to must be valid dates.");
  }
  if (from > to) throw new AppError(400, "VALIDATION_ERROR", "from must not be after to.");
  if (to.getTime() - from.getTime() > MAX_RANGE_DAYS * 86400_000) {
    throw new AppError(400, "VALIDATION_ERROR", `Choose a range of at most ${MAX_RANGE_DAYS} days.`);
  }

  const scope = hasAllSiteAccess(req.tenant!.role) ? null : req.tenant!.siteIds.map((id) => new Types.ObjectId(id));
  const siteId = oid(q.siteId, "siteId");
  let siteIds: Types.ObjectId[] | null = scope;
  if (siteId) {
    if (scope && !scope.some((s) => s.equals(siteId))) throw new AppError(404, "NOT_FOUND", "Site not found.");
    const exists = await SiteModel.exists({ _id: siteId, companyId: req.tenant!.companyId });
    if (!exists) throw new AppError(404, "NOT_FOUND", "Site not found.");
    siteIds = [siteId];
  }

  let eventType: CargoEventType | null = null;
  if (typeof q.eventType === "string" && q.eventType) {
    if (!CARGO_EVENT_TYPES.includes(q.eventType as CargoEventType)) throw new AppError(400, "VALIDATION_ERROR", "eventType is not valid.");
    eventType = q.eventType as CargoEventType;
  }

  let shift: Shift | null = null;
  if (typeof q.shift === "string" && q.shift) {
    const settings = await getCompanySettings(req.tenant!.companyId);
    shift = settings.shifts.find((s) => s.name.toLowerCase() === String(q.shift).toLowerCase()) ?? null;
    if (!shift) throw new AppError(400, "VALIDATION_ERROR", "That shift is not defined for your company.");
  }

  return { from, to, siteIds, cameraId: oid(q.cameraId, "cameraId"), zoneId: oid(q.zoneId, "zoneId"), eventType, shift };
}

function eventFilter(req: Request, f: ReportFilters, includeType = true): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    companyId: new Types.ObjectId(req.tenant!.companyId),
    occurredAt: { $gte: f.from, $lte: f.to },
  };
  if (f.siteIds) filter.siteId = { $in: f.siteIds };
  if (f.cameraId) filter.cameraId = f.cameraId;
  if (f.zoneId) filter.zoneId = f.zoneId;
  if (includeType && f.eventType) filter.eventType = f.eventType;
  return filter;
}

type SiteInfo = { name: string; code: string; timezone: string };
async function siteMap(companyId: string, ids: string[]): Promise<Map<string, SiteInfo>> {
  const sites = await SiteModel.find({ companyId, _id: { $in: ids } }).select("name code timezone").lean();
  return new Map(sites.map((s) => [s._id.toString(), { name: s.name, code: s.code, timezone: s.timezone }]));
}

// Events matching the filters, with the shift applied in each event's own site time zone.
async function loadEvents(req: Request, f: ReportFilters) {
  const rows = await CargoEventModel.find(eventFilter(req, f))
    .sort({ occurredAt: 1, _id: 1 })
    .limit(MAX_EVENTS + 1)
    .select("siteId cameraId zoneId eventType severity status summary occurredAt")
    .lean();
  const truncated = rows.length > MAX_EVENTS;
  const scanned = truncated ? rows.slice(0, MAX_EVENTS) : rows;
  const sites = await siteMap(req.tenant!.companyId, [...new Set(scanned.map((e) => e.siteId.toString()))]);
  const kept = scanned.filter((e) => {
    if (!f.shift) return true;
    const tz = sites.get(e.siteId.toString())?.timezone ?? "UTC";
    return shiftAt([f.shift], localParts(e.occurredAt, tz).minutes) !== null;
  });
  return { events: kept, sites, truncated };
}

// GET /reports/cargo-activity
reportsRouter.get(
  "/cargo-activity",
  ...guard("reports:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const f = await parseFilters(req);
    const { events, sites, truncated } = await loadEvents(req, f);

    const tzOf = (siteId: string) => sites.get(siteId)?.timezone ?? "UTC";
    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const bySite = new Map<string, number>();
    const days = new Map<string, { date: string; events: number; coverageGap: boolean; byType: Record<string, number> }>();
    const dayOf = (date: string) => {
      let d = days.get(date);
      if (!d) days.set(date, (d = { date, events: 0, coverageGap: false, byType: {} }));
      return d;
    };

    for (const e of events) {
      bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1;
      byType[e.eventType] = (byType[e.eventType] ?? 0) + 1;
      bySite.set(e.siteId.toString(), (bySite.get(e.siteId.toString()) ?? 0) + 1);
      const d = dayOf(localParts(e.occurredAt, tzOf(e.siteId.toString())).date);
      d.events++;
      d.byType[e.eventType] = (d.byType[e.eventType] ?? 0) + 1;
    }

    // Coverage gaps (QA-06): a camera or the AI service was down, so quiet periods are not proof
    // that nothing happened. Looked up separately so an event-type filter cannot hide them.
    const gapFilter = { ...eventFilter(req, f, false), eventType: { $in: HEALTH_TYPES } };
    delete (gapFilter as Record<string, unknown>).zoneId; // health events belong to a camera, not a zone
    const gapRows = await CargoEventModel.find(gapFilter).sort({ occurredAt: 1 }).limit(500).select("siteId cameraId eventType occurredAt").lean();
    const gapSites = await siteMap(req.tenant!.companyId, [...new Set(gapRows.map((g) => g.siteId.toString()))]);
    const gapCameras = await CameraModel.find({ _id: { $in: gapRows.map((g) => g.cameraId) } }).select("name").lean();
    const cameraName = new Map(gapCameras.map((c) => [c._id.toString(), c.name]));
    const coverageGaps = gapRows.map((g) => {
      const tz = gapSites.get(g.siteId.toString())?.timezone ?? "UTC";
      const local = localParts(g.occurredAt, tz);
      dayOf(local.date).coverageGap = true;
      return {
        eventId: g._id.toString(),
        siteId: g.siteId.toString(),
        siteName: gapSites.get(g.siteId.toString())?.name ?? "",
        cameraName: cameraName.get(g.cameraId.toString()) ?? "Unknown camera",
        eventType: g.eventType,
        occurredAt: g.occurredAt.toISOString(),
        localTime: local.text,
        timezone: tz,
      };
    });

    // Loading sessions that started in the range
    const sessionFilter: Record<string, unknown> = {
      companyId: new Types.ObjectId(req.tenant!.companyId),
      startedAt: { $gte: f.from, $lte: f.to },
    };
    if (f.siteIds) sessionFilter.siteId = { $in: f.siteIds };
    if (f.zoneId) sessionFilter.zoneId = f.zoneId;
    const sessions = await LoadingSessionModel.find(sessionFilter).select("closedAt reconciliationStatus expectedCountSnapshot observedCount coverageGap").lean();
    const sessionTotals = {
      total: sessions.length,
      open: sessions.filter((s) => !s.closedAt).length,
      matched: sessions.filter((s) => s.reconciliationStatus === "matched").length,
      reviewRequired: sessions.filter((s) => s.reconciliationStatus === "review_required").length,
      unverified: sessions.filter((s) => s.reconciliationStatus === "closed_unverified").length,
      withCoverageGap: sessions.filter((s) => s.coverageGap).length,
      expectedPackages: sessions.reduce((n, s) => n + (s.expectedCountSnapshot ?? 0), 0),
      observedPackages: sessions.reduce((n, s) => n + (s.observedCount ?? 0), 0),
    };

    res.json({
      data: {
        range: { from: f.from.toISOString(), to: f.to.toISOString() },
        timezoneNote: "Days and shifts use each site's own time zone.",
        truncated,
        totals: { events: events.length, bySeverity, byType },
        bySite: [...bySite.entries()].map(([id, count]) => ({ siteId: id, siteName: sites.get(id)?.name ?? "", events: count })),
        days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
        coverageGaps,
        sessions: sessionTotals,
      },
    });
  })
);

// GET /reports/mismatches - closed sessions whose count differed from the manifest
reportsRouter.get(
  "/mismatches",
  ...guard("reports:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const f = await parseFilters(req);
    const filter: Record<string, unknown> = {
      companyId: new Types.ObjectId(req.tenant!.companyId),
      reconciliationStatus: "review_required",
      closedAt: { $gte: f.from, $lte: f.to },
    };
    if (f.siteIds) filter.siteId = { $in: f.siteIds };
    if (f.zoneId) filter.zoneId = f.zoneId;
    const rows = await LoadingSessionModel.find(filter).sort({ closedAt: -1 }).limit(500);
    const sessions: LoadingSession[] = await formatSessions(rows);

    const eventIds = rows.map((r) => r.mismatchEventId).filter(Boolean);
    const events = await CargoEventModel.find({ _id: { $in: eventIds } }).select("status severity").lean();
    const eventBy = new Map(events.map((e) => [e._id.toString(), e]));
    const sites = await siteMap(req.tenant!.companyId, [...new Set(rows.map((r) => r.siteId.toString()))]);

    res.json({
      data: {
        range: { from: f.from.toISOString(), to: f.to.toISOString() },
        items: sessions.map((s) => {
          const ev = s.mismatchEventId ? eventBy.get(s.mismatchEventId) : undefined;
          const tz = sites.get(s.siteId)?.timezone ?? "UTC";
          return {
            ...s,
            closedAtLocal: s.closedAt ? localParts(new Date(s.closedAt), tz).text : null,
            timezone: tz,
            eventStatus: ev?.status ?? null,
          };
        }),
      },
    });
  })
);

// GET /reports/events/export - CSV of the events matching the filters
reportsRouter.get(
  "/events/export",
  ...guard("reports:export"),
  exportRateLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const f = await parseFilters(req);
    const { events, sites, truncated } = await loadEvents(req, f);
    if (truncated || events.length > MAX_EXPORT_ROWS) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", `Too many events to export at once (more than ${MAX_EXPORT_ROWS}). Narrow the dates or the site.`);
    }

    const cameras = await CameraModel.find({ _id: { $in: [...new Set(events.map((e) => e.cameraId.toString()))] } }).select("name").lean();
    const cameraName = new Map(cameras.map((c) => [c._id.toString(), c.name]));
    const zoneIds = [...new Set(events.map((e) => e.zoneId?.toString()).filter(Boolean) as string[])];
    const zones = zoneIds.length ? await VisionZoneModel.find({ _id: { $in: zoneIds } }).select("zoneType").lean() : [];
    const zoneType = new Map(zones.map((z) => [z._id.toString(), z.zoneType]));

    const rows = events.map((e) => {
      const site = sites.get(e.siteId.toString());
      const local = localParts(e.occurredAt, site?.timezone ?? "UTC");
      return [
        e._id.toString(),
        e.occurredAt.toISOString(),
        local.text,
        site?.timezone ?? "UTC",
        site?.name ?? "",
        site?.code ?? "",
        cameraName.get(e.cameraId.toString()) ?? "",
        e.zoneId ? zoneType.get(e.zoneId.toString()) ?? "" : "",
        e.eventType,
        e.severity,
        e.status,
        e.summary,
      ];
    });
    const csv = toCsv(
      ["Event ID", "Occurred at (UTC)", "Occurred at (site local time)", "Site time zone", "Site", "Site code", "Camera", "Zone", "Event type", "Severity", "Status", "Summary"],
      rows
    );

    await auditFromRequest(req, "EVENTS_EXPORTED", "Report", "events", {
      metadata: {
        rows: rows.length,
        from: f.from.toISOString(),
        to: f.to.toISOString(),
        siteIds: f.siteIds?.map(String) ?? "all",
        eventType: f.eventType,
        shift: f.shift?.name ?? null,
      },
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="events-${f.from.toISOString().slice(0, 10)}-to-${f.to.toISOString().slice(0, 10)}.csv"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(csv);
  })
);

// kept for tests that want to know the limits
export const REPORT_LIMITS = { MAX_EVENTS, MAX_EXPORT_ROWS, MAX_RANGE_DAYS };
export type { CargoEventSeverity, ICargoEventDocument };
