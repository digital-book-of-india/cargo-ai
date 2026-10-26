import { Router, Request, Response } from "express";
import { Types } from "mongoose";
import { CargoEventModel, NotificationModel, SiteModel } from "../../../models";
import { asyncHandler, authenticate, resolveTenant } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { canAccessSite } from "../../../services/authz/permissions";
import { parseLimit } from "../../../utils/pagination";

export const notificationsRouter = Router();

notificationsRouter.use(authenticate, resolveTenant);

function mine(req: Request, extra: Record<string, unknown> = {}) {
  return { companyId: req.tenant!.companyId, recipientUserId: req.user!.id, ...extra };
}

// GET /api/v1/notifications?unread=true&limit=  - the caller's own notifications, newest first
notificationsRouter.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const filter = mine(req, req.query.unread === "true" ? { readAt: null } : {});
    const limit = parseLimit(req.query.limit, 30, 100);
    const rows = await NotificationModel.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit);

    // event details, only for events at sites the person can still reach
    const eventIds = rows.map((n) => n.eventId).filter((id): id is string => !!id && Types.ObjectId.isValid(id));
    const events = await CargoEventModel.find({ _id: { $in: eventIds }, companyId: req.tenant!.companyId }).lean();
    const sites = await SiteModel.find({ _id: { $in: events.map((e) => e.siteId) } }).select("name").lean();
    const siteName = new Map(sites.map((s) => [s._id.toString(), s.name]));
    const eventById = new Map(events.map((e) => [e._id.toString(), e]));

    const unreadCount = await NotificationModel.countDocuments(mine(req, { readAt: null }));
    res.json({
      data: {
        items: rows.map((n) => {
          const e = n.eventId ? eventById.get(n.eventId) : undefined;
          const visible = e && canAccessSite(req.tenant!.role, req.tenant!.siteIds, e.siteId.toString());
          return {
            id: n._id.toString(),
            eventId: n.eventId,
            recipientUserId: n.recipientUserId.toString(),
            channel: n.channel,
            status: n.status,
            readAt: n.readAt ? n.readAt.toISOString() : null,
            createdAt: n.createdAt.toISOString(),
            event: visible
              ? {
                  id: e._id.toString(),
                  siteId: e.siteId.toString(),
                  siteName: siteName.get(e.siteId.toString()) ?? "Unknown site",
                  eventType: e.eventType,
                  severity: e.severity,
                  status: e.status,
                  summary: e.summary,
                  occurredAt: e.occurredAt.toISOString(),
                }
              : null,
          };
        }),
        unreadCount,
      },
    });
  })
);

// GET /api/v1/notifications/unread-count - cheap, for the menu badge
notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req: Request, res: Response) => {
    res.json({ data: { unreadCount: await NotificationModel.countDocuments(mine(req, { readAt: null })) } });
  })
);

// POST /api/v1/notifications/read-all
notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await NotificationModel.updateMany(mine(req, { readAt: null }), { $set: { readAt: new Date() } });
    res.json({ data: { marked: result.modifiedCount } });
  })
);

// POST /api/v1/notifications/:id/read
notificationsRouter.post(
  "/:id/read",
  asyncHandler(async (req: Request, res: Response) => {
    if (!Types.ObjectId.isValid(req.params.id)) throw new AppError(404, "NOT_FOUND", "Notification not found.");
    // scoped to the caller: nobody can mark someone else's notification
    const n = await NotificationModel.findOneAndUpdate(
      mine(req, { _id: req.params.id }),
      { $set: { readAt: new Date() } },
      { new: true }
    );
    if (!n) throw new AppError(404, "NOT_FOUND", "Notification not found.");
    res.json({ data: { id: n._id.toString(), readAt: n.readAt!.toISOString() } });
  })
);
