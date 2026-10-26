import { Router, Request, Response, NextFunction } from "express";
import { NotificationModel } from "../../../models";
import { authenticate } from "../../../middleware/auth";

export const notificationsRouter = Router();

// GET /api/v1/notifications
notificationsRouter.get(
  "/",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const notifications = await NotificationModel.find({
        recipientUserId: req.user!.id,
      })
        .sort({ createdAt: -1 })
        .limit(50);

      res.json({
        data: {
          items: notifications.map((n) => ({
            id: n._id.toString(),
            eventId: n.eventId,
            channel: n.channel,
            status: n.status,
            createdAt: n.createdAt.toISOString(),
          })),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
