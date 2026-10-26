import { Request, Response, NextFunction } from "express";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

export function createRateLimiter(options: {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
}) {
  const windowMs = options.windowMs ?? 60 * 1000;
  const maxRequests = options.maxRequests ?? 20;
  const message = options.message ?? "Too many requests. Please try again later.";

  return (req: Request, res: Response, next: NextFunction): void => {
    // Determine client IP
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.ip ||
      req.socket.remoteAddress ||
      "unknown_ip";

    const key = `${req.baseUrl}${req.path}:${ip}`;
    const now = Date.now();

    // Clean expired entries periodically
    if (rateLimitStore.size > 1000) {
      for (const [k, v] of rateLimitStore.entries()) {
        if (now > v.resetAt) rateLimitStore.delete(k);
      }
    }

    const current = rateLimitStore.get(key);
    if (!current || now > current.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > maxRequests) {
      const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSeconds));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message,
          requestId: req.requestId || res.locals.requestId,
        },
      });
      return;
    }

    return next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20, // max 20 auth attempts per minute per IP
  message: "Too many authentication attempts. Please try again in a minute.",
});
