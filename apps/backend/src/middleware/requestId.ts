import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

export function requestId(req: Request, res: Response, next: NextFunction) {
  // A caller may supply its own request id for tracing, but only a short, plain one: it is copied into logs, audit
  // rows and response bodies, so anything else (long, spaces, quotes, control characters) is replaced.
  const incomingId = req.headers["x-request-id"];
  const id =
    typeof incomingId === "string" && /^[A-Za-z0-9._-]{8,64}$/.test(incomingId.trim())
      ? incomingId.trim()
      : `req_${randomUUID()}`;

  req.requestId = id;
  res.locals.requestId = id;
  res.setHeader("X-Request-Id", id);

  // Every success body has the shape { data, meta: { requestId } }. Handlers keep calling
  // res.json({ data }); the request id is added here so no route can forget it.
  const send = res.json.bind(res);
  res.json = (body?: unknown) => {
    if (body && typeof body === "object" && !Array.isArray(body) && "data" in body && !("error" in body)) {
      const existing = (body as { meta?: Record<string, unknown> }).meta ?? {};
      return send({ ...(body as object), meta: { ...existing, requestId: id } });
    }
    return send(body);
  };

  next();
}
