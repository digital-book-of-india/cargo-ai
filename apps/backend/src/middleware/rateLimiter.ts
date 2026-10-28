import { Request, Response, NextFunction } from "express";
import { redis } from "../config/redis";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitRecord>();

const ATOMIC_RATE_LIMIT_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local pttl = redis.call('PTTL', KEYS[1])
return {current, pttl}
`;

function memoryFallbackLimit(
  key: string,
  now: number,
  windowMs: number,
  maxRequests: number
): { limited: boolean; retryAfterSeconds: number } {
  if (rateLimitStore.size > 1000) {
    for (const [k, v] of rateLimitStore.entries()) {
      if (now > v.resetAt) rateLimitStore.delete(k);
    }
  }

  const current = rateLimitStore.get(key);
  if (!current || now > current.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, retryAfterSeconds: 0 };
  }

  current.count += 1;
  if (current.count > maxRequests) {
    const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);
    return { limited: true, retryAfterSeconds };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

export function createRateLimiter(options: {
  windowMs?: number;
  maxRequests?: number;
  message?: string;
}) {
  const windowMs = options.windowMs ?? 60 * 1000;
  const maxRequests = options.maxRequests ?? 20;
  const message = options.message ?? "Too many requests. Please try again later.";

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const ip = req.ip || req.socket.remoteAddress || "unknown_ip";
    const rawKey = `${req.baseUrl}${req.path}:${ip}`;
    const now = Date.now();

    let isLimited = false;
    let retryAfter = 0;

    if (redis.status === "ready") {
      try {
        const redisKey = `ratelimit:${rawKey}`;
        const result = (await redis.eval(
          ATOMIC_RATE_LIMIT_LUA,
          1,
          redisKey,
          windowMs
        )) as [number, number];

        if (Array.isArray(result) && result.length >= 2) {
          const count = result[0];
          const pttl = result[1];

          if (count > maxRequests) {
            isLimited = true;
            retryAfter = Math.ceil(pttl / 1000) || Math.ceil(windowMs / 1000);
          }
        }
      } catch {
        const fallback = memoryFallbackLimit(rawKey, now, windowMs, maxRequests);
        isLimited = fallback.limited;
        retryAfter = fallback.retryAfterSeconds;
      }
    } else {
      const fallback = memoryFallbackLimit(rawKey, now, windowMs, maxRequests);
      isLimited = fallback.limited;
      retryAfter = fallback.retryAfterSeconds;
    }

    if (isLimited) {
      res.setHeader("Retry-After", String(retryAfter));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message,
          requestId: req.requestId || res.locals.requestId,
        },
      });
      return;
    }

    next();
  };
}

export const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 20,
  message: "Too many authentication attempts. Please try again in a minute.",
});

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