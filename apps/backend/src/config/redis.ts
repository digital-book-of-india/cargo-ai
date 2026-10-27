import "dotenv/config";
import Redis, { type RedisOptions } from "ioredis";

function buildCommonOptions(): RedisOptions {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    connectTimeout: 10_000,
    retryStrategy(attempts: number) {
      if (attempts > 10) {
        console.warn("[Redis] Max reconnect attempts (10) reached. Retrying every 10s.");
        return 10_000;
      }
      const baseDelay = Math.min(attempts * 100, 3000);
      const jitter = Math.floor(Math.random() * 200);
      return baseDelay + jitter;
    },
  };
}

function initRedisClient(): Redis {
  const redisUri = process.env.REDIS_URL?.trim();
  const commonOptions = buildCommonOptions();

  // 1. Cloud / Production connection via REDIS_URL
  if (redisUri) {
    const isTls = redisUri.startsWith("rediss://") || process.env.REDIS_TLS === "true";
    return new Redis(redisUri, {
      ...commonOptions,
      ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
    });
  }

  // 2. Fallback to individual connection parameters
  const host = process.env.REDIS_HOST || "127.0.0.1";
  const port = Number(process.env.REDIS_PORT) || 6379;
  const password = process.env.REDIS_PASSWORD || undefined;
  const isTls = process.env.REDIS_TLS === "true";

  return new Redis({
    ...commonOptions,
    host,
    port,
    password,
    tls: isTls ? { rejectUnauthorized: false } : undefined,
  });
}

export const redis = initRedisClient();

redis.on("connect", () => {
  console.log("[Redis] TCP connection established.");
});

redis.on("ready", () => {
  console.log("[Redis] Ready to accept commands.");
});

redis.on("error", (err: Error) => {
  console.error("[Redis] Connection error:", err.message);
});

redis.on("close", () => {
  console.warn("[Redis] Connection closed.");
});

redis.on("reconnecting", (delay: number) => {
  console.info(`[Redis] Reconnecting in ${delay}ms...`);
});

/**
 * Health check helper for /health endpoint or Kubernetes readiness probe
 */
export async function isRedisHealthy(): Promise<{ status: "up" | "down"; latencyMs: number | null }> {
  const start = Date.now();
  try {
    const res = await redis.ping();
    if (res === "PONG") {
      return { status: "up", latencyMs: Date.now() - start };
    }
    return { status: "down", latencyMs: null };
  } catch {
    return { status: "down", latencyMs: null };
  }
}

/**
 * Graceful shutdown integration.
 * Stops background reconnect timers immediately so the process can exit cleanly.
 */
export async function closeRedisConnection(): Promise<void> {
  try {
    if (redis.status === "ready") {
      await redis.quit();
      console.log("[Redis] Gracefully disconnected.");
    } else {
      redis.disconnect();
      console.log("[Redis] Force disconnected (was not in ready state).");
    }
  } catch (err) {
    redis.disconnect();
    console.error("[Redis] Disconnected with error:", (err as Error).message);
  }
}