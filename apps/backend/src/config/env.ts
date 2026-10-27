import "dotenv/config";

// Only an explicit "development" or "test" may use the built-in development fallbacks. Anything else
// (unset, "prod", "staging", a typo) is treated like production, so a missing variable can never
// silently run the server on published default secrets.
const rawNodeEnv = process.env.NODE_ENV ?? "";
const isDevLike = rawNodeEnv === "development" || rawNodeEnv === "test";
const isProduction = !isDevLike;
const nodeEnv = rawNodeEnv || "unset";

// Values copied from .env.example that must never be used outside development.
const PLACEHOLDER = /^(change-?me|<|your-)/i;

// In production a missing secret must stop the server, never fall back to a published default.
function secret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (value && value.trim()) {
    if (isProduction && PLACEHOLDER.test(value.trim())) {
      throw new Error(`${name} still has the placeholder value from .env.example. Generate a real one.`);
    }
    return value;
  }
  if (isProduction) {
    throw new Error(`${name} must be set unless NODE_ENV is "development" or "test" (NODE_ENV is "${nodeEnv}").`);
  }
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
  isProduction, // true for anything except NODE_ENV=development|test
  mongodbUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/cargo_ai",
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

  // How long a sign-in lasts. After that the person signs in again. Sign-out ends it at once (see tokenVersion).
  accessTokenTtl: process.env.ACCESS_TOKEN_TTL ?? "12h",

  // Camera addresses on private networks (10.x, 192.168.x, 172.16-31.x). Allowed in development, refused in
  // production unless this is "true": a cloud-hosted API must not be tricked into probing its own internal network.
  // Loopback is allowed only in development. Link-local addresses (169.254.x, the cloud metadata service) never are.
  cameraAllowPrivateHosts: process.env.CAMERA_ALLOW_PRIVATE_HOSTS ? process.env.CAMERA_ALLOW_PRIVATE_HOSTS === "true" : !isProduction,

  // JSON request body limit (bigger bodies get 413 PAYLOAD_TOO_LARGE).
  bodyLimit: process.env.BODY_LIMIT ?? "1mb",

  // Evidence (snapshots/clips): private storage, short-lived signed links, retention.
  evidenceStorageDriver: process.env.EVIDENCE_STORAGE_DRIVER ?? "local",
  evidenceStorageDir: process.env.EVIDENCE_STORAGE_DIR ?? "uploads",
  // Object storage (EVIDENCE_STORAGE_DRIVER=s3): AWS S3, or any S3-compatible service such as Google Cloud
  // Storage (EVIDENCE_S3_ENDPOINT=https://storage.googleapis.com) or MinIO. Credentials are read by the AWS SDK
  // from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or the platform role, never from this file.
  evidenceS3Bucket: process.env.EVIDENCE_S3_BUCKET ?? "",
  evidenceS3Region: process.env.EVIDENCE_S3_REGION ?? "us-east-1",
  evidenceS3Endpoint: process.env.EVIDENCE_S3_ENDPOINT ?? "",
  evidenceS3ForcePathStyle: process.env.EVIDENCE_S3_FORCE_PATH_STYLE === "true",
  evidenceS3Prefix: process.env.EVIDENCE_S3_PREFIX ?? "",
  evidenceSignedUrlTtlSeconds: positiveInt("EVIDENCE_SIGNED_URL_TTL_SECONDS", 300),
  evidenceMaxUploadBytes: positiveInt("EVIDENCE_MAX_UPLOAD_BYTES", 8 * 1024 * 1024),
  eventRetentionDays: positiveInt("CARGO_EVENT_RETENTION_DAYS", 90),
  // Notification delivery records (sent or given up) are only useful for a while; undelivered ones are never deleted.
  notificationRetentionDays: positiveInt("CARGO_NOTIFICATION_RETENTION_DAYS", 90),
  // The audit trail is kept longer than anything else. Set a very large number to keep it effectively forever.
  auditRetentionDays: positiveInt("CARGO_AUDIT_RETENTION_DAYS", 365),

  // A camera that has not reported for this long is no longer shown as online.
  cameraStaleSeconds: positiveInt("CAMERA_STALE_SECONDS", 120),
  // The AI worker (and a monitored camera's frames) are treated as stale after this long.
  workerStaleSeconds: positiveInt("WORKER_STALE_SECONDS", 60),
};
