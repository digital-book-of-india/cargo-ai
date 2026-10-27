import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import {
  acknowledgeEventSchema,
  addEventNoteSchema,
  assignEventSchema,
  falsePositiveSchema,
  reopenEventSchema,
  resolveEventSchema,
} from "@dbi/validation";
import {
  CARGO_EVENT_SEVERITIES,
  CARGO_EVENT_STATUSES,
  CARGO_EVENT_TYPES,
  type CargoEventDetail,
  type CargoEventStatus,
  type CargoEventSummary,
} from "@dbi/api-types";
import {
  CameraModel,
  CargoEventModel,
  CompanyMemberModel,
  EventHistoryModel,
  EventNoteModel,
  SiteModel,
  UserModel,
} from "../../../models";
import type { ICargoEventDocument } from "../../../models";
import { asyncHandler, guard, requireSiteAccess } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { auditFromRequest } from "../../../services/audit/logger";
import { can, canAccessSite, hasAllSiteAccess } from "../../../services/authz/permissions";
import { signEvidenceUrl } from "../../../services/evidence/signer";
import { canReopen, canTransition, statusForOutcome } from "../../../services/events/transitions";
import { decodeCursor, encodeCursor, parseLimit } from "../../../utils/pagination";

// Mounted at /api/v1/sites -> GET /:siteId/events
export const siteEventsRouter = Router();
// Mounted at /api/v1/events
export const eventRouter = Router();

type Who = { companyId: string; userId: string };

function evidenceInfo(e: ICargoEventDocument, who?: Who) {
  const snapshot = e.evidence?.find((x) => x.type === "snapshot");
  const clip = e.evidence?.find((x) => x.type === "clip");
  const info: CargoEventSummary["evidence"] = { snapshotAvailable: Boolean(snapshot), clipAvailable: Boolean(clip) };
  if (who) {
    // Signed, short-lived links are issued only on the detail view, after authorisation.
    if (snapshot) {
      const s = signEvidenceUrl(e._id.toString(), "snapshot", who);
      info.snapshotUrl = s.url;
      info.expiresAt = s.expiresAt;
    }
    if (clip) {
      const c = signEvidenceUrl(e._id.toString(), "clip", who);
      info.clipUrl = c.url;
      info.expiresAt = c.expiresAt;
    }
  }
  return info;
}

async function nameMaps(events: ICargoEventDocument[]) {
  const siteIds = Array.from(new Set(events.map((e) => e.siteId.toString())));
  const cameraIds = Array.from(new Set(events.map((e) => e.cameraId.toString())));
  const userIds = Array.from(new Set(events.map((e) => e.assignedTo?.toString()).filter(Boolean) as string[]));
  const [sites, cameras, users] = await Promise.all([
    SiteModel.find({ _id: { $in: siteIds } }).select("name").lean(),
    CameraModel.find({ _id: { $in: cameraIds } }).select("name").lean(),
    UserModel.find({ _id: { $in: userIds } }).select("name").lean(),
  ]);
  return {
    sites: new Map(sites.map((s) => [s._id.toString(), s.name])),
    cameras: new Map(cameras.map((c) => [c._id.toString(), c.name])),
    users: new Map(users.map((u) => [u._id.toString(), u.name])),
  };
}

function toSummary(e: ICargoEventDocument, names: Awaited<ReturnType<typeof nameMaps>>, who?: Who): CargoEventSummary {
  const assigned = e.assignedTo?.toString();
  return {
    id: e._id.toString(),
    eventKey: e.eventKey,
    eventType: e.eventType,
    severity: e.severity,
    status: e.status,
    summary: e.summary,
    occurredAt: e.occurredAt.toISOString(),
    siteId: e.siteId.toString(),
    cameraId: e.cameraId.toString(),
    zoneId: e.zoneId ? e.zoneId.toString() : null,
    loadingSessionId: e.loadingSessionId ? e.loadingSessionId.toString() : null,
    site: { id: e.siteId.toString(), name: names.sites.get(e.siteId.toString()) ?? "Unknown site" },
    camera: { id: e.cameraId.toString(), name: names.cameras.get(e.cameraId.toString()) ?? "Unknown camera" },
    assignedTo: assigned ? { id: assigned, name: names.users.get(assigned) ?? "Unknown user" } : null,
    evidence: evidenceInfo(e, who),
    demo: e.demo,
  };
}

function parseDate(raw: unknown, field: string): Date | undefined {
  if (raw === undefined || raw === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new AppError(400, "VALIDATION_ERROR", `${field} must be an ISO 8601 date.`);
  return d;
}

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], field: string): T | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    throw new AppError(400, "VALIDATION_ERROR", `${field} must be one of: ${allowed.join(", ")}.`);
  }
  return raw as T;
}

// One page of events for the caller's company (and optionally one site), newest first.
async function listEvents(req: Request, siteScope: Types.ObjectId | Types.ObjectId[] | null) {
  const q = req.query;
  const filter: Record<string, any> = { companyId: req.tenant!.companyId };

  if (siteScope) filter.siteId = Array.isArray(siteScope) ? { $in: siteScope } : siteScope;

  // "me" or a user id: only events assigned to that person
  if (typeof q.assignedTo === "string" && q.assignedTo) {
    const who = q.assignedTo === "me" ? req.user!.id : q.assignedTo;
    if (!Types.ObjectId.isValid(who)) throw new AppError(400, "VALIDATION_ERROR", "assignedTo is not valid.");
    filter.assignedTo = new Types.ObjectId(who);
  }

  const status = oneOf(q.status, CARGO_EVENT_STATUSES, "status");
  const eventType = oneOf(q.eventType, CARGO_EVENT_TYPES, "eventType");
  const severity = oneOf(q.severity, CARGO_EVENT_SEVERITIES, "severity");
  if (status) filter.status = status;
  if (eventType) filter.eventType = eventType;
  if (severity) filter.severity = severity;
  if (typeof q.cameraId === "string" && q.cameraId) {
    if (!Types.ObjectId.isValid(q.cameraId)) throw new AppError(400, "VALIDATION_ERROR", "cameraId is not valid.");
    filter.cameraId = new Types.ObjectId(q.cameraId);
  }

  const from = parseDate(q.from, "from");
  const to = parseDate(q.to, "to");
  if (from && to && from > to) throw new AppError(400, "VALIDATION_ERROR", "from must not be after to.");
  if (from || to) filter.occurredAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };

  const limit = parseLimit(q.limit);
  const cursor = decodeCursor(q.cursor);
  if (q.cursor && !cursor) throw new AppError(400, "VALIDATION_ERROR", "cursor is not valid.");

  const query = { ...filter };
  if (cursor) {
    const before = { $or: [{ occurredAt: { $lt: cursor.at } }, { occurredAt: cursor.at, _id: { $lt: new Types.ObjectId(cursor.id) } }] };
    query.$and = [...(query.$and ?? []), before];
  }

  const [rows, total] = await Promise.all([
    CargoEventModel.find(query).sort({ occurredAt: -1, _id: -1 }).limit(limit + 1),
    CargoEventModel.countDocuments(filter),
  ]);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const names = await nameMaps(page);
  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeCursor(last.occurredAt, last._id.toString()) : null;
  return { items: page.map((e) => toSummary(e, names)), nextCursor, total };
}

// Loads one event inside the caller's company and site access; anything else is a plain 404.
async function loadEvent(req: Request): Promise<ICargoEventDocument> {
  const id = req.params.eventId;
  const event = Types.ObjectId.isValid(id)
    ? await CargoEventModel.findOne({ _id: id, companyId: req.tenant!.companyId })
    : null;
  if (!event || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, event.siteId.toString())) {
    throw new AppError(404, "NOT_FOUND", "Event not found.");
  }
  return event;
}

// Moves an event to a new status through the transition map. The update is conditional on the
// status we read, so two people acting at once cannot both win; the loser gets 409.
async function applyTransition(
  req: Request,
  event: ICargoEventDocument,
  step: {
    to: CargoEventStatus;
    action: string;
    note?: string | null;
    set?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): Promise<ICargoEventDocument> {
  const from = event.status;
  if (!canTransition(from, step.to)) {
    throw new AppError(409, "CONFLICT", `An event that is ${from} cannot become ${step.to}.`);
  }
  const updated = await CargoEventModel.findOneAndUpdate(
    { _id: event._id, companyId: event.companyId, status: from },
    { $set: { status: step.to, ...(step.set ?? {}) } },
    { new: true }
  );
  if (!updated) throw new AppError(409, "CONFLICT", "This event was changed by someone else. Reload and try again.");

  await EventHistoryModel.create({
    companyId: event.companyId,
    eventId: event._id,
    actorUserId: req.user!.id,
    action: step.action,
    fromStatus: from,
    toStatus: step.to,
    note: step.note ?? null,
    metadata: step.metadata ?? {},
  });
  await auditFromRequest(req, `EVENT_${step.action}`, "Event", event._id.toString(), {
    reason: step.note ?? undefined,
    metadata: { from, to: step.to, ...(step.metadata ?? {}) },
  });
  return updated;
}

async function detailFor(req: Request, event: ICargoEventDocument): Promise<CargoEventDetail> {
  const who: Who = { companyId: req.tenant!.companyId, userId: req.user!.id };
  const [history, notes] = await Promise.all([
    EventHistoryModel.find({ companyId: event.companyId, eventId: event._id }).sort({ createdAt: 1 }).lean(),
    EventNoteModel.find({ companyId: event.companyId, eventId: event._id }).sort({ createdAt: 1 }).lean(),
  ]);
  const userIds = new Set<string>();
  history.forEach((h) => h.actorUserId && userIds.add(h.actorUserId.toString()));
  notes.forEach((n) => userIds.add(n.authorUserId.toString()));
  if (event.resolution?.resolvedBy) userIds.add(event.resolution.resolvedBy.toString());
  const people = await UserModel.find({ _id: { $in: Array.from(userIds) } }).select("name").lean();
  const nameOf = new Map(people.map((u) => [u._id.toString(), u.name]));
  const names = await nameMaps([event]);
  const person = (id?: Types.ObjectId | null) => (id ? { id: id.toString(), name: nameOf.get(id.toString()) ?? "Unknown user" } : null);

  return {
    ...toSummary(event, names, who),
    companyId: event.companyId.toString(),
    payload: (event.payload as Record<string, unknown>) ?? {},
    model: event.detector ?? null,
    resolution: event.resolution
      ? {
          outcome: event.resolution.outcome,
          note: event.resolution.note ?? null,
          resolvedAt: event.resolution.resolvedAt.toISOString(),
          resolvedBy: person(event.resolution.resolvedBy),
        }
      : null,
    history: history.map((h) => ({
      id: h._id.toString(),
      action: h.action,
      fromStatus: h.fromStatus ?? null,
      toStatus: h.toStatus ?? null,
      note: h.note ?? null,
      actor: person(h.actorUserId),
      createdAt: h.createdAt.toISOString(),
    })),
    notes: notes.map((n) => ({
      id: n._id.toString(),
      note: n.note,
      author: person(n.authorUserId) ?? { id: n.authorUserId.toString(), name: "Unknown user" },
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

function badRequest(parsed: { success: false; error: { issues: Array<{ message: string }> } }, fallback: string): AppError {
  return new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? fallback);
}

// GET /api/v1/sites/:siteId/events
siteEventsRouter.get(
  "/:siteId/events",
  ...requireSiteAccess("events:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const page = await listEvents(req, req.site!._id as Types.ObjectId);
    res.json({ data: page, meta: { nextCursor: page.nextCursor } });
  })
);

// GET /api/v1/events - the sites this member may access (?siteId= narrows)
eventRouter.get(
  "/",
  ...guard("events:read"),
  asyncHandler(async (req: Request, res: Response) => {
    let scope: Types.ObjectId | Types.ObjectId[] | null = null;
    const siteIdParam = typeof req.query.siteId === "string" ? req.query.siteId : undefined;
    if (siteIdParam) {
      if (!Types.ObjectId.isValid(siteIdParam) || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, siteIdParam)) {
        throw new AppError(404, "NOT_FOUND", "Site not found.");
      }
      scope = new Types.ObjectId(siteIdParam);
    } else if (!hasAllSiteAccess(req.tenant!.role)) {
      scope = req.tenant!.siteIds.map((id) => new Types.ObjectId(id));
    }
    const page = await listEvents(req, scope);
    res.json({ data: page, meta: { nextCursor: page.nextCursor } });
  })
);

// GET /api/v1/events/summary - counts by status and severity for the sites this member may see
eventRouter.get(
  "/summary",
  ...guard("events:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const match: Record<string, any> = { companyId: new Types.ObjectId(req.tenant!.companyId) };
    const siteIdParam = typeof req.query.siteId === "string" ? req.query.siteId : undefined;
    if (siteIdParam) {
      if (!Types.ObjectId.isValid(siteIdParam) || !canAccessSite(req.tenant!.role, req.tenant!.siteIds, siteIdParam)) {
        throw new AppError(404, "NOT_FOUND", "Site not found.");
      }
      match.siteId = new Types.ObjectId(siteIdParam);
    } else if (!hasAllSiteAccess(req.tenant!.role)) {
      match.siteId = { $in: req.tenant!.siteIds.map((id) => new Types.ObjectId(id)) };
    }
    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (from || to) match.occurredAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    if (req.query.assignedTo === "me") match.assignedTo = new Types.ObjectId(req.user!.id);

    const [byStatus, bySeverity] = await Promise.all([
      CargoEventModel.aggregate([{ $match: match }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
      CargoEventModel.aggregate([{ $match: match }, { $group: { _id: "$severity", n: { $sum: 1 } } }]),
    ]);
    const statuses = Object.fromEntries(CARGO_EVENT_STATUSES.map((s) => [s, 0])) as Record<string, number>;
    const severities = Object.fromEntries(CARGO_EVENT_SEVERITIES.map((s) => [s, 0])) as Record<string, number>;
    byStatus.forEach((r: any) => (statuses[r._id] = r.n));
    bySeverity.forEach((r: any) => (severities[r._id] = r.n));
    const total = Object.values(statuses).reduce((a, b) => a + b, 0);
    res.json({ data: { total, byStatus: statuses, bySeverity: severities } });
  })
);

// GET /api/v1/events/:eventId - detail, history, notes and short-lived evidence links
eventRouter.get(
  "/:eventId",
  ...guard("events:read"),
  asyncHandler(async (req: Request, res: Response) => {
    const event = await loadEvent(req);
    res.json({ data: { event: await detailFor(req, event) } });
  })
);

// GET /api/v1/events/:eventId/assignees - people this event can be given to
eventRouter.get(
  "/:eventId/assignees",
  ...guard("events:review"),
  asyncHandler(async (req: Request, res: Response) => {
    const event = await loadEvent(req);
    const members = await CompanyMemberModel.find({ companyId: event.companyId, status: "ACTIVE" }).lean();
    const eligible = members.filter(
      (m) =>
        can(m.role, "events:review") &&
        canAccessSite(m.role, (m.siteIds ?? []).map((id) => id.toString()), event.siteId.toString())
    );
    const users = await UserModel.find({ _id: { $in: eligible.map((m) => m.userId) } }).select("name").lean();
    const nameOf = new Map(users.map((u) => [u._id.toString(), u.name]));
    res.json({
      data: {
        items: eligible.map((m) => ({ id: m.userId.toString(), name: nameOf.get(m.userId.toString()) ?? "Unknown user", role: m.role })),
      },
    });
  })
);

// POST /api/v1/events/:eventId/acknowledge
eventRouter.post(
  "/:eventId/acknowledge",
  ...guard("events:review"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = acknowledgeEventSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed, "Invalid request");
    const event = await loadEvent(req);
    const updated = await applyTransition(req, event, { to: "acknowledged", action: "ACKNOWLEDGED", note: parsed.data.note });
    res.json({ data: { event: await detailFor(req, updated) } });
  })
);

// POST /api/v1/events/:eventId/assign - give the event to a reviewer (or clear the assignee)
eventRouter.post(
  "/:eventId/assign",
  ...guard("events:review"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = assignEventSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed, "Invalid request");
    const event = await loadEvent(req);
    if (event.status === "resolved" || event.status === "false_positive") {
      throw new AppError(422, "BUSINESS_RULE_FAILED", "A closed event cannot be assigned. Reopen it first.");
    }

    const { userId, note } = parsed.data;
    let assignee: Types.ObjectId | null = null;
    if (userId) {
      // The assignee must be an active member of this company who may review events at this site.
      const member = Types.ObjectId.isValid(userId)
        ? await CompanyMemberModel.findOne({ companyId: event.companyId, userId, status: "ACTIVE" }).lean()
        : null;
      const allowed =
        member &&
        can(member.role, "events:review") &&
        canAccessSite(member.role, (member.siteIds ?? []).map((id) => id.toString()), event.siteId.toString());
      if (!allowed) {
        throw new AppError(400, "VALIDATION_ERROR", "That person cannot review events at this site.");
      }
      assignee = new Types.ObjectId(userId);
    }

    // Handing an acknowledged event to a reviewer moves it into review.
    if (assignee && event.status === "acknowledged") {
      const updated = await applyTransition(req, event, {
        to: "in_review",
        action: "ASSIGNED",
        note,
        set: { assignedTo: assignee },
        metadata: { assigneeId: assignee.toString() },
      });
      return void res.json({ data: { event: await detailFor(req, updated) } });
    }

    const previous = event.assignedTo?.toString() ?? null;
    const updated = await CargoEventModel.findOneAndUpdate(
      { _id: event._id, companyId: event.companyId, status: event.status },
      { $set: { assignedTo: assignee } },
      { new: true }
    );
    if (!updated) throw new AppError(409, "CONFLICT", "This event was changed by someone else. Reload and try again.");
    await EventHistoryModel.create({
      companyId: event.companyId,
      eventId: event._id,
      actorUserId: req.user!.id,
      action: assignee ? "ASSIGNED" : "UNASSIGNED",
      fromStatus: event.status,
      toStatus: event.status,
      note: note ?? null,
      metadata: { from: previous, to: assignee?.toString() ?? null },
    });
    await auditFromRequest(req, assignee ? "EVENT_ASSIGNED" : "EVENT_UNASSIGNED", "Event", event._id.toString(), {
      metadata: { from: previous, to: assignee?.toString() ?? null },
    });
    res.json({ data: { event: await detailFor(req, updated) } });
  })
);

// POST /api/v1/events/:eventId/notes
eventRouter.post(
  "/:eventId/notes",
  ...guard("events:review"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = addEventNoteSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed, "Invalid note");
    const event = await loadEvent(req);

    const note = await EventNoteModel.create({
      companyId: event.companyId,
      eventId: event._id,
      authorUserId: req.user!.id,
      note: parsed.data.note,
    });
    await EventHistoryModel.create({
      companyId: event.companyId,
      eventId: event._id,
      actorUserId: req.user!.id,
      action: "NOTE_ADDED",
      fromStatus: event.status,
      toStatus: event.status,
      metadata: { noteId: note._id.toString() },
    });
    await auditFromRequest(req, "EVENT_NOTE_ADDED", "Event", event._id.toString(), { metadata: { noteId: note._id.toString() } });
    res.status(201).json({ data: { event: await detailFor(req, event) } });
  })
);

// POST /api/v1/events/:eventId/resolve
eventRouter.post(
  "/:eventId/resolve",
  ...guard("events:review"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = resolveEventSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed, "Invalid outcome");
    const { outcome, note } = parsed.data;
    const event = await loadEvent(req);
    const to = statusForOutcome(outcome);

    const updated = await applyTransition(req, event, {
      to,
      action: to === "resolved" ? "RESOLVED" : to === "escalated" ? "ESCALATED" : "FALSE_POSITIVE",
      note,
      set: { resolution: { outcome, note: note ?? null, resolvedAt: new Date(), resolvedBy: new Types.ObjectId(req.user!.id) } },
      metadata: { outcome },
    });
    res.json({ data: { event: await detailFor(req, updated) } });
  })
);

// POST /api/v1/events/:eventId/false-positive
eventRouter.post(
  "/:eventId/false-positive",
  ...guard("events:review"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = falsePositiveSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed, "A reason is required");
    const event = await loadEvent(req);
    const updated = await applyTransition(req, event, {
      to: "false_positive",
      action: "FALSE_POSITIVE",
      note: parsed.data.reason,
      set: {
        resolution: {
          outcome: "false_positive",
          note: parsed.data.reason,
          resolvedAt: new Date(),
          resolvedBy: new Types.ObjectId(req.user!.id),
        },
      },
      metadata: { outcome: "false_positive" },
    });
    res.json({ data: { event: await detailFor(req, updated) } });
  })
);

// POST /api/v1/events/:eventId/reopen - only a resolved event, only with the reopen permission
eventRouter.post(
  "/:eventId/reopen",
  ...guard("events:reopen"),
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = reopenEventSchema.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest(parsed, "A reason is required");
    const event = await loadEvent(req);
    if (!canReopen(event.status)) {
      throw new AppError(409, "CONFLICT", "Only a resolved event can be reopened.");
    }
    const updated = await CargoEventModel.findOneAndUpdate(
      { _id: event._id, companyId: event.companyId, status: "resolved" },
      { $set: { status: "open", resolution: null, assignedTo: null } },
      { new: true }
    );
    if (!updated) throw new AppError(409, "CONFLICT", "This event was changed by someone else. Reload and try again.");

    await EventHistoryModel.create({
      companyId: event.companyId,
      eventId: event._id,
      actorUserId: req.user!.id,
      action: "REOPENED",
      fromStatus: "resolved",
      toStatus: "open",
      note: parsed.data.note,
    });
    await auditFromRequest(req, "EVENT_REOPENED", "Event", event._id.toString(), {
      reason: parsed.data.note,
      metadata: { from: "resolved", to: "open" },
    });
    res.json({ data: { event: await detailFor(req, updated) } });
  })
);
