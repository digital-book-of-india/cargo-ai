import type { NextFunction, Request, Response } from "express";
import { errorFields, logger } from "../utils/logger";

// Error codes used by the API (requirements, Appendix B).
export const ErrorCodes = {
  VALIDATION_ERROR: "VALIDATION_ERROR", // 400
  UNAUTHORIZED: "UNAUTHORIZED", // 401
  FORBIDDEN: "FORBIDDEN", // 403
  NOT_FOUND: "NOT_FOUND", // 404
  CONFLICT: "CONFLICT", // 409 (duplicate reference, invalid state transition)
  DUPLICATE_EVENT: "DUPLICATE_EVENT", // 409 (idempotency conflict)
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE", // 413
  BUSINESS_RULE_FAILED: "BUSINESS_RULE_FAILED", // 422
  RATE_LIMITED: "RATE_LIMITED", // 429
  INTERNAL_ERROR: "INTERNAL_ERROR", // 500
  DEPENDENCY_UNAVAILABLE: "DEPENDENCY_UNAVAILABLE", // 503
} as const;

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

function isDatabaseUnavailable(err: unknown): boolean {
  const name = err instanceof Error ? err.name : "";
  return /MongoNetworkError|MongoServerSelectionError|MongooseServerSelectionError|MongoNotConnectedError/.test(name);
}

// 404 for any route that does not exist, in the standard error shape (instead of an HTML page).
export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: ErrorCodes.NOT_FOUND, message: "Route not found.", requestId: req.requestId },
  });
}

// Standard error shape: { error: { code, message, requestId } }. Never leaks stack traces.
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.requestId || (res.locals.requestId as string | undefined);
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, requestId } });
  }

  // Handle CORS rejection cleanly
  if (err instanceof Error && err.message.includes("not allowed by CORS")) {
    return res.status(403).json({
      error: { code: "CORS_FORBIDDEN", message: err.message, requestId },
    });
  }

  // Body parser problems: oversized or malformed JSON.
  const bodyErr = err as { type?: string; status?: number } | null;
  if (bodyErr?.type === "entity.too.large") {
    return res.status(413).json({
      error: { code: ErrorCodes.PAYLOAD_TOO_LARGE, message: "The request body is too large.", requestId },
    });
  }
  if (bodyErr?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: { code: ErrorCodes.VALIDATION_ERROR, message: "The request body is not valid JSON.", requestId },
    });
  }

  if (isDatabaseUnavailable(err)) {
    logger.error("database unavailable", { requestId, ...errorFields(err) });
    return res.status(503).json({
      error: {
        code: ErrorCodes.DEPENDENCY_UNAVAILABLE,
        message: "A required service is temporarily unavailable. Please try again.",
        requestId,
      },
    });
  }

  logger.error("unhandled error", { requestId, path: req.originalUrl.split("?")[0], ...errorFields(err) });
  return res
    .status(500)
    .json({ error: { code: ErrorCodes.INTERNAL_ERROR, message: "Something went wrong.", requestId } });
}
