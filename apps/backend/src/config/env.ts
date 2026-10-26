import "dotenv/config";

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

// In production a missing secret must stop the server, never fall back to a published default.
function secret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.trim()) return value;
  if (isProduction) throw new Error(`${name} must be set when NODE_ENV=production.`);
  return devFallback;
}

function positiveInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function positiveIntOrZero(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const jwtAccessSecret = secret("JWT_ACCESS_SECRET", "default_dev_jwt_secret_key_12345");

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv,
  mongodbUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/dbi_intelligence",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jwtAccessSecret,
  // The service-token check refuses tokens shorter than 32 characters, so the development fallback is long enough.
  aiServiceToken: secret("AI_SERVICE_TOKEN", "dbi-dev-ai-service-token-change-me-0123456789"),
  // Only set during rotation. Both tokens are accepted until the worker has the new one.
  aiServiceTokenPrevious: process.env.AI_SERVICE_TOKEN_PREVIOUS ?? "",
  cameraSecretEncryptionKey: isProduction
    ? secret("CAMERA_SECRET_ENCRYPTION_KEY", "")
    : process.env.CAMERA_SECRET_ENCRYPTION_KEY || jwtAccessSecret || "default_camera_secret_key_12345",

  // How many reverse proxies sit in front of the API (0 = none). Only then is X-Forwarded-For trusted
  // for the client address; trusting it blindly would let anyone dodge the rate limits.
  trustProxy: positiveIntOrZero("TRUST_PROXY", 0),

  // JSON request body limit (bigger bodies get 413 PAYLOAD_TOO_LARGE).
  bodyLimit: process.env.BODY_LIMIT ?? "1mb",

  // Evidence (snapshots/clips): private storage, short-lived signed links, retention.
  evidenceStorageDriver: process.env.EVIDENCE_STORAGE_DRIVER ?? "local",
  evidenceStorageDir: process.env.EVIDENCE_STORAGE_DIR ?? "uploads",
  evidenceSignedUrlTtlSeconds: positiveInt("EVIDENCE_SIGNED_URL_TTL_SECONDS", 300),
  evidenceMaxUploadBytes: positiveInt("EVIDENCE_MAX_UPLOAD_BYTES", 8 * 1024 * 1024),
  eventRetentionDays: positiveInt("CARGO_EVENT_RETENTION_DAYS", 90),

  // A camera that has not reported for this long is no longer shown as online.
  cameraStaleSeconds: positiveInt("CAMERA_STALE_SECONDS", 120),
  // The AI worker (and a monitored camera's frames) are treated as stale after this long.
  workerStaleSeconds: positiveInt("WORKER_STALE_SECONDS", 60),
};
