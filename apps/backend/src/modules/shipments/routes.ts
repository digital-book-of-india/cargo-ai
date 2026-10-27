import crypto from "crypto";
import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import {
  SESSION_DISCLAIMER,
  type LoadingSession,
  type Manifest,
  type ManifestImportJob,
  type Vehicle,
} from "@dbi/api-types";
import {
  closeLoadingSessionSchema,
  createLoadingSessionSchema,
  createManifestSchema,
  createVehicleSchema,
  updateManifestSchema,
  updateVehicleSchema,
} from "@dbi/validation";
import {
  CameraModel,
  CargoEventModel,
  ImportJobModel,
  LoadingSessionModel,
  ManifestModel,
  SiteModel,
  VehicleModel,
  ZoneModel,
} from "../../models";
import type { ILoadingSessionDocument, IManifestDocument, IVehicleDocument } from "../../models";
import { asyncHandler, guard } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { importRateLimiter } from "../../middleware/rateLimiter";
import { auditFromRequest } from "../../services/audit/logger";
import { canAccessSite, hasAllSiteAccess } from "../../services/authz/permissions";
import { createCargoEvent } from "../../services/events/createEvent";
import { getObservedCount, observedForSession } from "../../services/counts/observed";
import { reconcile } from "../../services/loading/reconcile";
import { MAX_IMPORT_BYTES, parseManifestCsv } from "../../services/manifests/csv";
import { getCompanySettings } from "../../services/settings/companySettings";
import { decodeCursor, encodeCursor, parseLimit } from "../../utils/pagination";
import { isDuplicateKeyError } from "../../utils/validation";

export const vehiclesRouter = Router();
export const manifestsRouter = Router();
export const loadingSessionsRouter = Router();

function bad(parsed: { error: { issues: Array<{ message: string }> } }, fallback: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? fallback);
}
const oid = (v: unknown) => (typeof v === "string" && Types.ObjectId.isValid(v) ? new Types.ObjectId(v) : null);

// ids of the sites this member may use, or null when they may use every site
function siteScope(req: Request): Types.ObjectId[] | null {
  return hasAllSiteAccess(req.tenant!.role) ? null : req.tenant!.siteIds.map((id) => new Types.ObjectId(id));
}

// A site of this company that the member may access, or a 404 (never reveals other companies).
async function accessibleSite(req: Request, siteId: unknown) {
  const id = oid(siteId);
  const site = id ? await SiteModel.findOne({ _id: id, companyId: req.tenant!.companyId }) : null;
  if (!site || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, site._id.toString())) {
    throw new AppError(404, "NOT_FOUND", "Site not found.");
  }
  if (site.status === "ARCHIVED") throw new AppError(422, "BUSINESS_RULE_FAILED", "This site is archived.");
  return site;
}

// ------------------------------------------------------------------ vehicles
function formatVehicle(v: IVehicleDocument): Vehicle {
  return {
    id: v._id.toString(),
    registrationNumber: v.registrationNumber,
    label: v.label ?? null,
    active: v.active,
    createdAt: v.createdAt?.toISOString(),
  };
}

vehiclesRouter.get(
  "/",
  ...guard("manifests:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { companyId: req.tenant!.companyId };
    if (req.query.active === "true") filter.active = true;
    const items = await VehicleModel.find(filter).sort({ registrationNumber: 1 }).limit(500);
    res.json({ data: { items: items.map(formatVehicle) } });
  })
);

vehiclesRouter.post(
  "/",
  ...guard("manifests:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createVehicleSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed, "Invalid vehicle data");
    try {
      const v = await VehicleModel.create({
        companyId: req.tenant!.companyId,
        registrationNumber: parsed.data.registrationNumber,
        label: parsed.data.label,
        createdBy: req.user!.id,
      });
      await auditFromRequest(req, "VEHICLE_CREATED", "Vehicle", v._id.toString(), {
        metadata: { registrationNumber: v.registrationNumber },
      });
      res.status(201).json({ data: { vehicle: formatVehicle(v) } });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new AppError(409, "CONFLICT", "This vehicle is already registered.");
      throw err;
    }
  })
);

vehiclesRouter.patch(
  "/:vehicleId",
  ...guard("manifests:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateVehicleSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed, "Invalid vehicle data");
    const id = oid(req.params.vehicleId);
    const v = id ? await VehicleModel.findOne({ _id: id, companyId: req.tenant!.companyId }) : null;
    if (!v) throw new AppError(404, "NOT_FOUND", "Vehicle not found.");
    if (parsed.data.label !== undefined) v.label = parsed.data.label;
    if (parsed.data.active !== undefined) v.active = parsed.data.active;
    await v.save();
    await auditFromRequest(req, "VEHICLE_UPDATED", "Vehicle", v._id.toString(), { metadata: { changed: Object.keys(parsed.data) } });
    res.json({ data: { vehicle: formatVehicle(v) } });
  })
);

// ------------------------------------------------------------------ manifests
async function formatManifests(list: IManifestDocument[]): Promise<Manifest[]> {
  const ids = [...new Set(list.map((m) => m.siteId.toString()))];
  const sites = await SiteModel.find({ _id: { $in: ids } }).select("name code").lean();
  const byId = new Map(sites.map((s) => [s._id.toString(), s]));
  return list.map((m) => {
    const s = byId.get(m.siteId.toString());
    return {
      id: m._id.toString(),
      reference: m.reference,
      siteId: m.siteId.toString(),
      site: { id: m.siteId.toString(), name: s?.name ?? "", code: s?.code ?? "" },
      expectedPackageCount: m.expectedPackageCount,
      source: m.source,
      status: m.status,
      notes: m.notes ?? null,
      createdAt: m.createdAt?.toISOString(),
    };
  });
}

async function loadManifest(req: Request): Promise<IManifestDocument> {
  const id = oid(req.params.manifestId);
  const m = id ? await ManifestModel.findOne({ _id: id, companyId: req.tenant!.companyId }) : null;
  // a manifest at a site the member cannot use looks like one that does not exist
  if (!m || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, m.siteId.toString())) {
    throw new AppError(404, "NOT_FOUND", "Manifest not found.");
  }
  return m;
}

manifestsRouter.get(
  "/",
  ...guard("manifests:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { companyId: req.tenant!.companyId };
    const scope = siteScope(req);
    const siteId = oid(req.query.siteId);
    if (req.query.siteId && !siteId) throw new AppError(400, "VALIDATION_ERROR", "siteId is not valid.");
    if (siteId) {
      if (scope && !scope.some((s) => s.equals(siteId))) throw new AppError(404, "NOT_FOUND", "Site not found.");
      filter.siteId = siteId;
    } else if (scope) filter.siteId = { $in: scope };
    if (typeof req.query.status === "string") filter.status = req.query.status;
    if (typeof req.query.q === "string" && req.query.q.trim()) {
      filter.reference = { $regex: "^" + req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    }
    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      filter.$or = [
        { createdAt: { $lt: cursor.at } },
        { createdAt: cursor.at, _id: { $lt: new Types.ObjectId(cursor.id) } },
      ];
    }
    const rows = await ManifestModel.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    res.json({
      data: {
        items: await formatManifests(page),
        nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last._id.toString()) : null,
      },
    });
  })
);

manifestsRouter.post(
  "/",
  ...guard("manifests:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createManifestSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed, "Invalid manifest data");
    const site = await accessibleSite(req, parsed.data.siteId);
    try {
      const m = await ManifestModel.create({
        companyId: req.tenant!.companyId,
        siteId: site._id,
        reference: parsed.data.reference,
        expectedPackageCount: parsed.data.expectedPackageCount,
        notes: parsed.data.notes,
        source: "manual",
        status: "active",
        createdBy: req.user!.id,
      });
      await auditFromRequest(req, "MANIFEST_CREATED", "Manifest", m._id.toString(), {
        metadata: { reference: m.reference, expectedPackageCount: m.expectedPackageCount },
      });
      res.status(201).json({ data: { manifest: (await formatManifests([m]))[0] } });
    } catch (err) {
      if (isDuplicateKeyError(err)) throw new AppError(409, "CONFLICT", "A manifest with this reference already exists.");
      throw err;
    }
  })
);

// POST /manifests/import - the CSV arrives as JSON { fileName, content } (no file upload needed).
// All-or-nothing unless allowPartial is true. The same file is never imported twice.
manifestsRouter.post(
  "/import",
  importRateLimiter,
  ...guard("manifests:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const { fileName, content, allowPartial } = (req.body ?? {}) as Record<string, unknown>;
    if (typeof content !== "string" || !content.trim()) throw new AppError(400, "VALIDATION_ERROR", "The CSV content is required.");
    if (Buffer.byteLength(content, "utf8") > MAX_IMPORT_BYTES) {
      throw new AppError(413, "PAYLOAD_TOO_LARGE", "The file is larger than 1 MB.");
    }
    const name = (typeof fileName === "string" && fileName.trim() ? fileName.trim() : "manifests.csv").slice(0, 200);
    const companyId = new Types.ObjectId(req.tenant!.companyId);
    const hash = crypto.createHash("sha256").update(content).digest("hex");

    const toDto = (j: any, duplicate = false): ManifestImportJob => ({
      id: j._id.toString(),
      fileName: j.fileName,
      status: j.status,
      totalRows: j.totalRows,
      createdCount: j.createdCount,
      errors: j.rowErrors ?? [],
      duplicate: duplicate || undefined,
      createdAt: j.createdAt.toISOString(),
    });

    const previous = await ImportJobModel.findOne({ companyId, kind: "manifests", contentHash: hash });
    if (previous) {
      // a failed import wrote nothing, so the same file may be fixed and sent again only if changed;
      // an identical file always returns the stored result.
      return void res.json({ data: { job: toDto(previous, true) } });
    }

    const parsed = parseManifestCsv(content);
    const errors = [...parsed.errors];
    let rows = parsed.rows;

    if (rows.length > 0) {
      // site codes must be sites this member may use
      const scope = siteScope(req);
      const siteFilter: Record<string, unknown> = {
        companyId,
        status: { $ne: "ARCHIVED" },
        code: { $in: [...new Set(rows.map((r) => r.siteCode))] },
      };
      if (scope) siteFilter._id = { $in: scope };
      const sites = await SiteModel.find(siteFilter).select("code").lean();
      const siteByCode = new Map(sites.map((s) => [s.code, s._id as Types.ObjectId]));

      const existing = await ManifestModel.find({ companyId, reference: { $in: rows.map((r) => r.reference) } })
        .select("reference")
        .lean();
      const taken = new Set(existing.map((m) => m.reference.toLowerCase()));

      rows = rows.filter((r) => {
        if (!siteByCode.has(r.siteCode)) {
          errors.push({ row: r.line, field: "siteCode", message: `Unknown site code "${r.siteCode}".` });
          return false;
        }
        if (taken.has(r.reference.toLowerCase())) {
          errors.push({ row: r.line, field: "reference", message: "A manifest with this reference already exists." });
          return false;
        }
        return true;
      });

      errors.sort((a, b) => a.row - b.row);
      const partial = allowPartial === true;
      if (errors.length === 0 || (partial && rows.length > 0)) {
        const jobId = new Types.ObjectId();
        const docs = rows.map((r) => ({
          companyId,
          siteId: siteByCode.get(r.siteCode)!,
          reference: r.reference,
          expectedPackageCount: r.expectedPackageCount,
          notes: r.notes,
          source: "csv_import" as const,
          status: "active" as const,
          importJobId: jobId,
          createdBy: req.user!.id,
        }));
        try {
          await ManifestModel.insertMany(docs, { ordered: true });
        } catch (err) {
          // no transactions on a standalone server: undo what this import wrote
          await ManifestModel.deleteMany({ companyId, importJobId: jobId });
          if (isDuplicateKeyError(err) || (err as { code?: number }).code === 11000) {
            throw new AppError(409, "CONFLICT", "A manifest in this file was created by someone else meanwhile. Nothing was imported; try again.");
          }
          throw err;
        }
        const job = await ImportJobModel.create({
          _id: jobId,
          companyId,
          fileName: name,
          contentHash: hash,
          status: errors.length === 0 ? "COMPLETED" : "PARTIAL",
          totalRows: parsed.totalRows,
          createdCount: docs.length,
          rowErrors: errors.slice(0, 500),
          createdBy: req.user!.id,
        });
        await auditFromRequest(req, "MANIFEST_IMPORTED", "ImportJob", job._id.toString(), {
          metadata: { fileName: name, created: docs.length, errors: errors.length },
        });
        return void res.json({ data: { job: toDto(job) } });
      }
    }

    // nothing written
    const job = await ImportJobModel.create({
      companyId,
      fileName: name,
      contentHash: hash,
      status: "FAILED",
      totalRows: parsed.totalRows,
      createdCount: 0,
      rowErrors: errors.slice(0, 500),
      createdBy: req.user!.id,
    });
    await auditFromRequest(req, "MANIFEST_IMPORT_FAILED", "ImportJob", job._id.toString(), {
      metadata: { fileName: name, errors: errors.length },
    });
    res.json({ data: { job: toDto(job) } });
  })
);

manifestsRouter.get(
  "/:manifestId",
  ...guard("manifests:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const m = await loadManifest(req);
    res.json({ data: { manifest: (await formatManifests([m]))[0] } });
  })
);

manifestsRouter.patch(
  "/:manifestId",
  ...guard("manifests:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateManifestSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed, "Invalid manifest data");
    const m = await loadManifest(req);
    if (m.status === "closed" || m.status === "cancelled") {
      throw new AppError(422, "BUSINESS_RULE_FAILED", `A ${m.status} manifest cannot be changed.`);
    }
    const openSession = await LoadingSessionModel.exists({ companyId: m.companyId, manifestId: m._id, closedAt: null });
    if (openSession && parsed.data.expectedPackageCount !== undefined) {
      throw new AppError(409, "CONFLICT", "The expected count cannot change while a loading session is open for this manifest.");
    }
    if (openSession && parsed.data.status === "cancelled") {
      throw new AppError(409, "CONFLICT", "Close the loading session before cancelling this manifest.");
    }
    const changed: Record<string, unknown> = {};
    if (parsed.data.expectedPackageCount !== undefined && parsed.data.expectedPackageCount !== m.expectedPackageCount) {
      changed.expectedPackageCount = { from: m.expectedPackageCount, to: parsed.data.expectedPackageCount };
      m.expectedPackageCount = parsed.data.expectedPackageCount;
    }
    if (parsed.data.notes !== undefined) {
      m.notes = parsed.data.notes;
      changed.notes = true;
    }
    if (parsed.data.status !== undefined && parsed.data.status !== m.status) {
      changed.status = { from: m.status, to: parsed.data.status };
      m.status = parsed.data.status;
    }
    if (Object.keys(changed).length > 0) {
      await m.save();
      await auditFromRequest(req, "MANIFEST_UPDATED", "Manifest", m._id.toString(), { metadata: { changed } });
    }
    res.json({ data: { manifest: (await formatManifests([m]))[0] } });
  })
);

// ------------------------------------------------------------------ loading sessions
export async function formatSessions(list: ILoadingSessionDocument[], withLive = false): Promise<LoadingSession[]> {
  const ids = (key: "siteId" | "manifestId" | "vehicleId") => [
    ...new Set(list.map((s) => s[key]?.toString()).filter((x): x is string => Boolean(x))),
  ];
  const [sites, manifests, vehicles] = await Promise.all([
    SiteModel.find({ _id: { $in: ids("siteId") } }).select("name").lean(),
    ManifestModel.find({ _id: { $in: ids("manifestId") } }).select("reference expectedPackageCount").lean(),
    VehicleModel.find({ _id: { $in: ids("vehicleId") } }).select("registrationNumber").lean(),
  ]);
  const siteBy = new Map(sites.map((x) => [x._id.toString(), x]));
  const manBy = new Map(manifests.map((x) => [x._id.toString(), x]));
  const vehBy = new Map(vehicles.map((x) => [x._id.toString(), x]));

  return Promise.all(
    list.map(async (s) => {
      const man = s.manifestId ? manBy.get(s.manifestId.toString()) : undefined;
      const veh = s.vehicleId ? vehBy.get(s.vehicleId.toString()) : undefined;
      let liveObserved: number | null | undefined;
      if (withLive && !s.closedAt) {
        const counts = await getObservedCount({
          companyId: s.companyId.toString(),
          siteId: s.siteId.toString(),
          zoneId: s.zoneId?.toString() ?? null,
          from: s.startedAt,
          to: new Date(),
        });
        liveObserved = counts ? observedForSession(s.direction, counts) : null;
      }
      return {
        id: s._id.toString(),
        siteId: s.siteId.toString(),
        site: { id: s.siteId.toString(), name: siteBy.get(s.siteId.toString())?.name ?? "" },
        zoneId: s.zoneId?.toString() ?? null,
        manifestId: s.manifestId?.toString() ?? null,
        manifest: man ? { id: man._id.toString(), reference: man.reference, expectedPackageCount: man.expectedPackageCount } : null,
        vehicleId: s.vehicleId?.toString() ?? null,
        vehicle: veh ? { id: veh._id.toString(), registrationNumber: veh.registrationNumber } : null,
        direction: s.direction,
        startedAt: s.startedAt.toISOString(),
        closedAt: s.closedAt?.toISOString() ?? null,
        expectedCountSnapshot: s.expectedCountSnapshot ?? null,
        observedCount: s.observedCount ?? null,
        difference: s.difference ?? null,
        countsBreakdown: s.countsBreakdown ?? null,
        reconciliationStatus: s.reconciliationStatus,
        toleranceUsed: s.toleranceUsed ?? null,
        closeNote: s.closeNote ?? null,
        coverageGap: s.coverageGap,
        mismatchEventId: s.mismatchEventId?.toString() ?? null,
        liveObserved,
        disclaimer: SESSION_DISCLAIMER,
      };
    })
  );
}

async function loadSession(req: Request): Promise<ILoadingSessionDocument> {
  const id = oid(req.params.sessionId);
  const s = id ? await LoadingSessionModel.findOne({ _id: id, companyId: req.tenant!.companyId }) : null;
  if (!s || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, s.siteId.toString())) {
    throw new AppError(404, "NOT_FOUND", "Loading session not found.");
  }
  return s;
}

loadingSessionsRouter.get(
  "/",
  ...guard("manifests:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const filter: Record<string, unknown> = { companyId: req.tenant!.companyId };
    const scope = siteScope(req);
    const siteId = oid(req.query.siteId);
    if (req.query.siteId && !siteId) throw new AppError(400, "VALIDATION_ERROR", "siteId is not valid.");
    if (siteId) {
      if (scope && !scope.some((s) => s.equals(siteId))) throw new AppError(404, "NOT_FOUND", "Site not found.");
      filter.siteId = siteId;
    } else if (scope) filter.siteId = { $in: scope };
    if (req.query.open === "true") filter.closedAt = null;
    if (typeof req.query.reconciliationStatus === "string") filter.reconciliationStatus = req.query.reconciliationStatus;
    const limit = parseLimit(req.query.limit);
    const cursor = decodeCursor(req.query.cursor);
    if (cursor) {
      filter.$or = [
        { startedAt: { $lt: cursor.at } },
        { startedAt: cursor.at, _id: { $lt: new Types.ObjectId(cursor.id) } },
      ];
    }
    const rows = await LoadingSessionModel.find(filter).sort({ startedAt: -1, _id: -1 }).limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    res.json({
      data: {
        items: await formatSessions(page),
        nextCursor: rows.length > limit && last ? encodeCursor(last.startedAt, last._id.toString()) : null,
      },
    });
  })
);

loadingSessionsRouter.post(
  "/",
  ...guard("manifests:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createLoadingSessionSchema.safeParse(req.body);
    if (!parsed.success) throw bad(parsed, "Invalid loading session data");
    const d = parsed.data;
    const site = await accessibleSite(req, d.siteId);
    const companyId = new Types.ObjectId(req.tenant!.companyId);

    let manifest: IManifestDocument | null = null;
    if (d.manifestId) {
      manifest = await ManifestModel.findOne({ _id: d.manifestId, companyId });
      if (!manifest || !manifest.siteId.equals(site._id)) {
        throw new AppError(400, "VALIDATION_ERROR", "The manifest does not belong to this site.");
      }
      if (manifest.status !== "active") {
        throw new AppError(422, "BUSINESS_RULE_FAILED", `A ${manifest.status} manifest cannot start a loading session.`);
      }
    }
    if (d.zoneId) {
      const zone = await ZoneModel.exists({ _id: d.zoneId, siteId: site._id, companyId });
      if (!zone) throw new AppError(400, "VALIDATION_ERROR", "The zone does not belong to this site.");
    }
    if (d.vehicleId) {
      const vehicle = await VehicleModel.exists({ _id: d.vehicleId, companyId, active: true });
      if (!vehicle) throw new AppError(400, "VALIDATION_ERROR", "The vehicle was not found or is inactive.");
    }
    const startedAt = d.startedAt ? new Date(d.startedAt) : new Date();
    if (startedAt.getTime() > Date.now() + 60_000) {
      throw new AppError(400, "VALIDATION_ERROR", "The start time cannot be in the future.");
    }

    try {
      const s = await LoadingSessionModel.create({
        companyId,
        siteId: site._id,
        zoneId: d.zoneId ?? null,
        manifestId: manifest?._id ?? null,
        vehicleId: d.vehicleId ?? null,
        direction: d.direction,
        startedAt,
        expectedCountSnapshot: manifest?.expectedPackageCount ?? null,
        reconciliationStatus: "in_progress",
        createdBy: req.user!.id,
      });
      await auditFromRequest(req, "LOADING_SESSION_STARTED", "LoadingSession", s._id.toString(), {
        metadata: { siteId: site._id.toString(), manifestId: manifest?._id.toString() ?? null, direction: d.direction },
      });
      res.status(201).json({ data: { session: (await formatSessions([s], true))[0] } });
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new AppError(409, "CONFLICT", "This manifest already has an open loading session.");
      }
      throw err;
    }
  })
);

loadingSessionsRouter.get(
  "/:sessionId",
  ...guard("manifests:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const s = await loadSession(req);
    res.json({ data: { session: (await formatSessions([s], true))[0] } });
  })
);

// POST /loading-sessions/:id/close - counts, compares with the manifest, records the result.
loadingSessionsRouter.post(
  "/:sessionId/close",
  ...guard("manifests:write"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = closeLoadingSessionSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw bad(parsed, "Invalid close data");
    const s = await loadSession(req);
    if (s.closedAt) throw new AppError(409, "CONFLICT", "This loading session is already closed.");

    const closedAt = parsed.data.closedAt ? new Date(parsed.data.closedAt) : new Date();
    if (closedAt.getTime() > Date.now() + 60_000) throw new AppError(400, "VALIDATION_ERROR", "The close time cannot be in the future.");
    if (closedAt.getTime() < s.startedAt.getTime()) {
      throw new AppError(400, "VALIDATION_ERROR", "The close time cannot be before the start time.");
    }

    const companyId = s.companyId.toString();
    const counts = await getObservedCount({
      companyId,
      siteId: s.siteId.toString(),
      zoneId: s.zoneId?.toString() ?? null,
      from: s.startedAt,
      to: closedAt,
    });
    const observed = counts ? observedForSession(s.direction, counts) : null;
    const settings = await getCompanySettings(companyId);
    const tolerance = settings.mismatchTolerance;
    const result = reconcile({ expected: s.expectedCountSnapshot ?? null, observed, tolerance });

    // cameras or the AI service being down during the session means the count may be incomplete
    const gap = await CargoEventModel.exists({
      companyId: s.companyId,
      siteId: s.siteId,
      eventType: { $in: ["camera_offline", "ai_service_unavailable"] },
      occurredAt: { $gte: s.startedAt, $lte: closedAt },
    });

    // the close is atomic: only one request can move an open session to closed
    const closed = await LoadingSessionModel.findOneAndUpdate(
      { _id: s._id, companyId: s.companyId, closedAt: null },
      {
        $set: {
          closedAt,
          closedBy: req.user!.id,
          closeNote: parsed.data.closeNote ?? null,
          observedCount: observed,
          difference: result.difference,
          countsBreakdown: counts ? { in: counts.inCount, out: counts.outCount } : null,
          reconciliationStatus: result.status,
          toleranceUsed: tolerance,
          coverageGap: Boolean(gap),
        },
      },
      { new: true }
    );
    if (!closed) throw new AppError(409, "CONFLICT", "This loading session was closed by someone else.");

    if (closed.manifestId) {
      await ManifestModel.updateOne({ _id: closed.manifestId, companyId: closed.companyId }, { $set: { status: "closed" } });
    }

    let mismatchEvent: { id: string; severity: string; summary: string } | null = null;
    if (result.status === "review_required") {
      const camera = await mismatchCamera(closed);
      if (camera) {
        const { event } = await createCargoEvent({
          eventKey: `count-mismatch:${closed._id.toString()}`,
          siteId: closed.siteId.toString(),
          cameraId: camera.toString(),
          zoneId: closed.zoneId?.toString() ?? null,
          loadingSessionId: closed._id.toString(),
          eventType: "count_mismatch",
          severity: "high",
          summary: `Count mismatch: expected ${closed.expectedCountSnapshot}, observed ${observed} (${(result.difference ?? 0) > 0 ? "+" : ""}${result.difference}).`,
          occurredAt: closedAt,
          payload: {
            expectedCount: closed.expectedCountSnapshot,
            observedCount: observed,
            difference: result.difference,
            tolerance,
            coverageGap: Boolean(gap),
            disclaimer: SESSION_DISCLAIMER,
          },
          actorUserId: req.user!.id,
        });
        closed.mismatchEventId = event._id as Types.ObjectId;
        await LoadingSessionModel.updateOne({ _id: closed._id }, { $set: { mismatchEventId: event._id } });
        mismatchEvent = { id: event._id.toString(), severity: event.severity, summary: event.summary };
      }
    }

    await auditFromRequest(req, "LOADING_SESSION_CLOSED", "LoadingSession", closed._id.toString(), {
      metadata: {
        expected: closed.expectedCountSnapshot,
        observed,
        difference: result.difference,
        status: result.status,
        coverageGap: Boolean(gap),
      },
    });
    res.json({ data: { session: (await formatSessions([closed]))[0], mismatchEvent } });
  })
);

// an event needs a camera: the zone's own, otherwise the first camera at the site
async function mismatchCamera(s: ILoadingSessionDocument): Promise<Types.ObjectId | null> {
  if (s.zoneId) {
    const zone = await ZoneModel.findOne({ _id: s.zoneId, companyId: s.companyId }).select("cameraId").lean();
    if (zone?.cameraId) return zone.cameraId as Types.ObjectId;
  }
  const cam = await CameraModel.findOne({ siteId: s.siteId, companyId: s.companyId }).sort({ createdAt: 1 }).select("_id").lean();
  return (cam?._id as Types.ObjectId) ?? null;
}
