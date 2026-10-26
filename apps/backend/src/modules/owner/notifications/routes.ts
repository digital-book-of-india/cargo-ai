import { Router, Request, Response, NextFunction } from "express";
import { pushTokenSchema, notificationPreferencesSchema } from "@dbi/validation";
import { NotificationModel, PushTokenModel, NotificationPreferenceModel } from "../../../models";
import { authenticate } from "../../../middleware/auth";

export const notificationsRouter = Router();

// POST /api/v1/notifications/push-token
notificationsRouter.post(
  "/push-token",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = pushTokenSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid push token",
            requestId: req.requestId,
          },
        });
        return;
      }

      await PushTokenModel.findOneAndUpdate(
        { userId: req.user!.id, token: parseResult.data.token },
        { platform: parseResult.data.platform ?? "WEB" },
        { upsert: true, new: true }
      );

      // FCM delivery is not wired up yet (no Firebase project credentials); the token is
      // persisted so it is ready the moment a provider is configured.
      res.json({
        data: {
          status: "REGISTERED",
          message: "Push token registered successfully. (Push provider pending credentials)",
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

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
