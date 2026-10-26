import { Router, Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { aiEventSchema } from "@dbi/validation";
import { SecurityEventModel, ShopModel, NotificationModel, CameraModel } from "../../../models";

export const aiEventsRouter = Router();

// POST /internal/v1/ai/events
aiEventsRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = aiEventSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message ?? "Invalid AI event payload",
          requestId: req.requestId,
        },
      });
      return;
    }

    const {
      eventId,
      shopId,
      cameraId,
      eventType,
      confidence,
      startedAt,
      endedAt,
      evidence,
      modelVersion,
    } = parseResult.data;

    // Idempotency check
    const existing = await SecurityEventModel.findOne({ eventId });
    if (existing) {
      res.status(200).json({
        data: {
          eventId: existing.eventId,
          status: "ALREADY_PROCESSED",
        },
      });
      return;
    }

    const shop = await ShopModel.findById(shopId);
    if (!shop) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Target shop not found for this event.",
          requestId: req.requestId,
        },
      });
      return;
    }

    // Resolve cameraId safely (handle ObjectId or fallback to shop camera)
    let targetCameraId: Types.ObjectId;
    if (Types.ObjectId.isValid(cameraId)) {
      targetCameraId = new Types.ObjectId(cameraId);
    } else {
      const foundCam = await CameraModel.findOne({ shopId: shop._id });
      if (foundCam) {
        targetCameraId = foundCam._id;
      } else {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid cameraId and no cameras found for target shop.",
            requestId: req.requestId,
          },
        });
        return;
      }
    }

    // Persist new event
    const event = await SecurityEventModel.create({
      eventId,
      shopId: shop._id,
      cameraId: targetCameraId,
      eventType,
      confidence,
      startedAt: new Date(startedAt),
      endedAt: endedAt ? new Date(endedAt) : undefined,
      evidence,
      reviewStatus: "NEW",
      demoFlag: false,
      modelVersion: modelVersion ?? "detector-v0.1",
    });

    // Create in-app notification for shop owner
    await NotificationModel.create({
      eventId: event.eventId,
      recipientUserId: shop.ownerId,
      channel: "IN_APP",
      status: "SENT",
      attempts: 1,
    });

    res.status(202).json({
      data: {
        eventId: event.eventId,
        status: "QUEUED",
      },
    });
  } catch (err) {
    next(err);
  }
});
