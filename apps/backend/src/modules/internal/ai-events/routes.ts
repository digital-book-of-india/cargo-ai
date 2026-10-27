import { Router, Request, Response } from "express";
import { aiEventSchema } from "@dbi/validation";
import { asyncHandler } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { createCargoEvent } from "../../../services/events/createEvent";

export const aiEventsRouter = Router();

// POST /internal/v1/ai/events and POST /api/v1/ai/events  (service token only)
// Thin ingestion endpoint: validates the Appendix A payload and hands it to createCargoEvent(),
// which owns tenant checks and idempotency. The count ledger is added by the AI-pipeline work.
aiEventsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = aiEventSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid AI event payload");
    }
    const body = parsed.data;

    // The Idempotency-Key header, when sent, must agree with the body so a retry cannot be split in two.
    const header = req.headers["idempotency-key"];
    const headerKey = Array.isArray(header) ? header[0] : header;
    if (headerKey && headerKey !== body.eventKey) {
      throw new AppError(400, "VALIDATION_ERROR", "Idempotency-Key must match eventKey.");
    }

    const { event, created } = await createCargoEvent({
      eventKey: body.eventKey,
      siteId: body.siteId,
      cameraId: body.cameraId,
      zoneId: body.zoneId ?? null,
      eventType: body.eventType,
      severity: body.severity,
      summary: body.summary,
      occurredAt: body.occurredAt,
      payload: {
        ...(body.track ? { track: body.track } : {}),
        ...(body.movement ? { movement: body.movement } : {}),
      },
      evidence: body.evidence,
      model: body.model ?? null,
      expectedCompanyId: body.companyId,
    });

    // A retry gets the same event id and the same outcome, and nothing new is written.
    res
      .status(created ? 202 : 200)
      .json({ data: { eventId: event._id.toString(), ingestionStatus: created ? "accepted" : "already_processed" } });
  })
);
