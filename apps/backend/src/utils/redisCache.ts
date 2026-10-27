import { redis } from "../config/redis";

/**
 * Cache wrapper with automatic JSON serialization and fail-open error boundary.
 * If Redis is unavailable or times out, it falls back to calling fetcher() directly.
 */
export async function getOrSetCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  try {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch (cacheReadError) {
    console.warn(`[Redis Cache] Read error on key '${key}', falling back to DB:`, (cacheReadError as Error).message);
  }

  const freshData = await fetcher();

  if (freshData !== null && freshData !== undefined) {
    redis.set(key, JSON.stringify(freshData), "EX", ttlSeconds).catch((cacheWriteError) => {
      console.warn(`[Redis Cache] Write error on key '${key}':`, (cacheWriteError as Error).message);
    });
  }

  return freshData;
}

/**
 * Delete one or more explicit cache keys
 */
export async function invalidateCacheKeys(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (err) {
    console.warn("[Redis Cache] Invalidation error:", (err as Error).message);
  }
}

/**
 * Scan and delete by pattern safely using SCAN (never KEYS in production)
 */
export async function invalidateCachePattern(pattern: string): Promise<number> {
  let cursor = "0";
  let totalDeleted = 0;

  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        totalDeleted += keys.length;
      }
    } while (cursor !== "0");
  } catch (err) {
    console.warn(`[Redis Cache] Pattern deletion failed for '${pattern}':`, (err as Error).message);
  }

  return totalDeleted;
}