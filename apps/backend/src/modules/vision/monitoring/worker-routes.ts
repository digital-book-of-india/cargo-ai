import { Router } from "express";
import { workerHeartbeatSchema } from "@dbi/validation";
import { AppError } from "../../../middleware/errorHandler";
import { asyncHandler, parseOrThrow } from "../shared/http";
import { getWorkerConfig, recordWorkerHeartbeat } from "./service";

// Mounted at /internal/v1/monitoring, behind serviceAuth (see app.ts).
export const visionWorkerRouter = Router();

// POST /internal/v1/monitoring/heartbeat
visionWorkerRouter.post(
  "/heartbeat",
  asyncHandler(async (req, res) => {
    const input = parseOrThrow(workerHeartbeatSchema, req.body);
    res.json({ data: await recordWorkerHeartbeat(input) });
  })
);

// GET /internal/v1/monitoring/config?workerId=worker-1
visionWorkerRouter.get(
  "/config",
  asyncHandler(async (req, res) => {
    const workerId = typeof req.query.workerId === "string" ? req.query.workerId.trim() : "";
    if (!workerId || workerId.length > 64) {
      throw new AppError(400, "VALIDATION_ERROR", "workerId is required.");
    }
    res.json({ data: await getWorkerConfig(workerId) });
  })
);