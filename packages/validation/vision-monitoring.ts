import { z } from "zod";

const objectId = z.string().regex(/^[a-fA-F0-9]{24}$/, "cameraId must be a valid id");
const isoDate = z.string().datetime({ offset: true, message: "Must be an ISO 8601 date-time" });

export const workerCameraReportSchema = z
  .object({
    cameraId: objectId,
    streamStatus: z.enum(["STREAMING", "RECONNECTING", "ERROR"]),
    lastFrameAt: isoDate.nullable(),
    frameRate: z.number().finite().min(0).max(120).nullable().optional(),
    errorCode: z.string().trim().max(64).nullable().optional(),
  })
  .strict();

export const workerHeartbeatSchema = z
  .object({
    workerId: z.string().trim().min(1).max(64),
    status: z.enum(["ONLINE", "DEGRADED", "OFFLINE"]),
    sentAt: isoDate,
    cameras: z.array(workerCameraReportSchema).max(200),
  })
  .strict();

export type WorkerHeartbeatInput = z.infer<typeof workerHeartbeatSchema>;