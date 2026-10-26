import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incomingId = req.headers["x-request-id"];
  const id =
    typeof incomingId === "string" && incomingId.trim()
      ? incomingId.trim()
      : `req_${randomUUID()}`;

  req.requestId = id;
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
