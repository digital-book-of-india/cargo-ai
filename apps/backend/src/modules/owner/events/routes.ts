import { Router, Request, Response, NextFunction } from "express";
import { Types } from "mongoose";
import { reviewEventSchema } from "@dbi/validation";
import { SecurityEventModel, ShopModel } from "../../../models";
import { authenticate, requireShopAccess } from "../../../middleware/auth";
import { signEvidenceUrl } from "../../../services/evidence/signer";

// Mounted at /api/v1/shops -> GET /:shopId/events
export const shopEventsRouter = Router();
// Mounted at /api/v1/events -> GET /:eventId, POST /:eventId/review
export const eventRouter = Router();

function formatEvent(e: any) {
  const evidence: Record<string, unknown> = {
    snapshotObjectKey: e.evidence?.snapshotObjectKey,
    clipObjectKey: e.evidence?.clipObjectKey,
  };

  if (e.evidence?.snapshotObjectKey) {
    const signed = signEvidenceUrl(e.eventId, "snapshot");
    evidence.snapshotUrl = signed.url;
    evidence.expiresAt = signed.expiresAt;
  }
  if (e.evidence?.clipObjectKey) {
    const signed = signEvidenceUrl(e.eventId, "clip");
    evidence.clipUrl = signed.url;
    evidence.expiresAt = signed.expiresAt;
  }

  return {
    id: e._id.toString(),
    eventId: e.eventId,
    shopId: e.shopId.toString(),
    cameraId: e.cameraId.toString(),
    eventType: e.eventType,
    confidence: e.confidence,
    startedAt: e.startedAt.toISOString(),
    endedAt: e.endedAt ? e.endedAt.toISOString() : undefined,
    evidence,
    reviewStatus: e.reviewStatus,
    demoFlag: e.demoFlag,
    modelVersion: e.modelVersion,
    createdAt: e.createdAt?.toISOString(),
  };
}

// GET /api/v1/shops/:shopId/events
shopEventsRouter.get(
  "/:shopId/events",
  authenticate,
  requireShopAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 20), 100);
      const query: any = { shopId: req.params.shopId };

      if (req.query.eventType) {
        query.eventType = req.query.eventType;
      }

      if (req.query.cursor) {
        query.startedAt = { $lt: new Date(String(req.query.cursor)) };
      }

      const [items, total] = await Promise.all([
        SecurityEventModel.find(query).sort({ startedAt: -1 }).limit(limit + 1),
        SecurityEventModel.countDocuments({ shopId: req.params.shopId }),
      ]);

      const hasMore = items.length > limit;
      const resultItems = hasMore ? items.slice(0, limit) : items;
      const nextCursor = hasMore ? resultItems[resultItems.length - 1].startedAt.toISOString() : null;

      res.json({
        data: {
          items: resultItems.map(formatEvent),
          nextCursor,
          total,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/events/:eventId
eventRouter.get("/:eventId", authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isObjectId = Types.ObjectId.isValid(req.params.eventId);
    const query = isObjectId
      ? { $or: [{ eventId: req.params.eventId }, { _id: req.params.eventId }] }
      : { eventId: req.params.eventId };
    const event = await SecurityEventModel.findOne(query);

    if (!event) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Event not found.",
          requestId: req.requestId,
        },
      });
      return;
    }

    // Tenant check if not SUPER_ADMIN
    if (req.user?.role !== "SUPER_ADMIN") {
      const shop = await ShopModel.findById(event.shopId).select("ownerId");
      if (!shop || shop.ownerId.toString() !== req.user?.id) {
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "You do not have access to this event.",
            requestId: req.requestId,
          },
        });
        return;
      }
    }

    res.json({
      data: {
        event: formatEvent(event),
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/events/:eventId/review
eventRouter.post(
  "/:eventId/review",
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parseResult = reviewEventSchema.safeParse(req.body);
      if (!parseResult.success) {
        res.status(400).json({
          error: {
            code: "VALIDATION_ERROR",
            message: parseResult.error.errors[0]?.message ?? "Invalid review status",
            requestId: req.requestId,
          },
        });
        return;
      }

      const isObjectId = Types.ObjectId.isValid(req.params.eventId);
      const query = isObjectId
        ? { $or: [{ eventId: req.params.eventId }, { _id: req.params.eventId }] }
        : { eventId: req.params.eventId };
      const event = await SecurityEventModel.findOne(query);

      if (!event) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: "Event not found.",
            requestId: req.requestId,
          },
        });
        return;
      }

      // Tenant check if not SUPER_ADMIN
      if (req.user?.role !== "SUPER_ADMIN") {
        const shop = await ShopModel.findById(event.shopId).select("ownerId");
        if (!shop || shop.ownerId.toString() !== req.user?.id) {
          res.status(403).json({
            error: {
              code: "FORBIDDEN",
              message: "You do not have access to review this event.",
              requestId: req.requestId,
            },
          });
          return;
        }
      }

      event.reviewStatus = parseResult.data.reviewStatus;
      await event.save();

      res.json({
        data: {
          event: formatEvent(event),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);
