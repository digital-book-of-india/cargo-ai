import { Router, Request, Response, NextFunction } from "express";
import { aiHealthSchema } from "@dbi/validation";
import { recordAiHeartbeat } from "../../../services/ai/health";

export const aiHealthRouter = Router();

// POST /internal/v1/ai/health
aiHealthRouter.post("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parseResult = aiHealthSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: parseResult.error.errors[0]?.message ?? "Invalid heartbeat payload",
          requestId: req.requestId,
        },
      });
      return;
    }

    const { serviceName, status, activeStreams } = parseResult.data;
    const recorded = await recordAiHeartbeat({
      serviceName,
      status,
      activeStreams: activeStreams ?? 1,
    });

    res.json({
      data: {
        status: "OK",
        workerStatus: recorded.status,
        recordedAt: recorded.lastHeartbeatAt.toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});
