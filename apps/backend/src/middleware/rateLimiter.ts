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
    // The client address comes from Express, which only reads X-Forwarded-For when TRUST_PROXY says a
    // reverse proxy is in front. Reading the header here directly let any caller pick a new "address"
    // per request and bypass every limit.
    const ip = req.ip || req.socket.remoteAddress || "unknown_ip";

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


// Limits for the sensitive endpoints named in the requirements. They are applied where the
// endpoint exists (camera control now; imports and exports in later phases; ingestion by the
// AI pipeline). The store is in memory, so with several API instances use a shared store.
export const cameraControlRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: "Too many camera control requests. Please try again in a minute.",
});

export const importRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Too many import requests. Please try again in a minute.",
});

export const exportRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  message: "Too many export requests. Please try again in a minute.",
});

export const ingestRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 600,
  message: "Too many event submissions. Please slow down.",
});
