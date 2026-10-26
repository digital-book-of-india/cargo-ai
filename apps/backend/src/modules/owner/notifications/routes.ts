import { Router, Request, Response, NextFunction } from "express";
import { notificationPreferencesSchema } from "@dbi/validation";
import { NotificationModel, NotificationPreferenceModel } from "../../../models";
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

const DEFAULT_PREFERENCES = {
  push: true,
  inApp: true,
  types: {
    PERSON_IN_ZONE: true,
    POSSIBLE_SHUTTER_INTERACTION: true,
    POSSIBLE_TAMPERING: true,
    CAMERA_OFFLINE: true,
    AI_OFFLINE: true,
  },
};

// GET /api/v1/notifications/preferences
notificationsRouter.get(
  "/preferences",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const pref = await NotificationPreferenceModel.findOne({ userId: req.user!.id });
      res.json({
        data: {
          preferences: pref
            ? { push: pref.push, inApp: pref.inApp, types: pref.types }
            : DEFAULT_PREFERENCES,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// PUT /api/v1/notifications/preferences
notificationsRouter.put(
  "/preferences",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = notificationPreferencesSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid notification preferences",
            requestId: req.requestId,
          },
        });
        return;
      }

      const pref = await NotificationPreferenceModel.findOneAndUpdate(
        { userId: req.user!.id },
        { ...parseResult.data },
        { upsert: true, new: true }
      );

      res.json({
        data: {
          preferences: { push: pref.push, inApp: pref.inApp, types: pref.types },
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
