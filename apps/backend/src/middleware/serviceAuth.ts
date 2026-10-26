import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";

// Internal AI worker authentication. Fail closed: no default token, constant-time compare,
// and a previous token is accepted during rotation (AI_SERVICE_TOKEN_PREVIOUS).
const MIN_TOKEN_LENGTH = 32;

function digest(value: string): Buffer {
  return crypto.createHash("sha256").update(value, "utf8").digest();
}

// Hash both sides first so timingSafeEqual always gets equal-length buffers (no length leak).
function matches(candidate: string, secret: string): boolean {
  return crypto.timingSafeEqual(digest(candidate), digest(secret));
}

export function serviceAuth(req: Request, res: Response, next: NextFunction): void {
  const current = env.aiServiceToken ?? "";
  const previous = env.aiServiceTokenPrevious ?? "";

  if (current.length < MIN_TOKEN_LENGTH) {
    res.status(503).json({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "Service authentication is not configured.",
        requestId: req.requestId,
      },
    });
    return;
  }

  const tokenHeader = req.headers["x-service-token"];
  const authHeader = req.headers.authorization;
  let token = "";
  if (typeof tokenHeader === "string") token = tokenHeader;
  else if (authHeader && authHeader.startsWith("Bearer ")) token = authHeader.substring(7);

  const ok =
    token.length > 0 &&
    (matches(token, current) || (previous.length >= MIN_TOKEN_LENGTH && matches(token, previous)));

  if (!ok) {
    res.status(401).json({
      error: {
        code: "UNAUTHORIZED",
        message: "Invalid or missing internal service token.",
        requestId: req.requestId,
      },
    });
    return;
  }

  req.serviceName = "ai-worker";
  next();
}