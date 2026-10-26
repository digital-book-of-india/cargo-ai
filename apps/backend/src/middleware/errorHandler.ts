import type { NextFunction, Request, Response } from "express";

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
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

  console.error(err);
  return res
    .status(500)
    .json({ error: { code: "INTERNAL_ERROR", message: "Something went wrong.", requestId } });
}
