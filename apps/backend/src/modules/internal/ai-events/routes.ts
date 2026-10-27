import { Router, Request, Response } from "express";
import { visionIngestSchema } from "@dbi/validation";
import { asyncHandler } from "../../../middleware/auth";
import { AppError } from "../../../middleware/errorHandler";
import { ingestVisionEvent } from "../../vision/ingestion/service";
import { forwardToInbox } from "../../vision/ingestion/inbox";

export const aiEventsRouter = Router();

// Merged Ingestion Handler (Dev 2: unified ingestion pipeline)
// Handles /api/v1/ai/events and /internal/v1/ai/cargo-events
aiEventsRouter.post(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = visionIngestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid event payload");
    }
    const input = parsed.data;

    const header = req.headers["idempotency-key"];
    const idempotencyKey = typeof header === "string" ? header.trim() : (Array.isArray(header) ? header[0] : undefined);

    const outcome = await ingestVisionEvent(input, idempotencyKey);
    if (outcome.httpStatus === 202) {
      await forwardToInbox(input);
    }

    res.status(outcome.httpStatus).json({ data: outcome.body });
  })
);