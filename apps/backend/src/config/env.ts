import "dotenv/config";

// Required secrets fail closed: the server refuses to start without them.
// No fallback to another secret (the old code fell back from the camera key to the JWT secret).
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  mongodbUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/dbi_intelligence",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),

  jwtAccessSecret: required("JWT_ACCESS_SECRET"),
  cameraSecretEncryptionKey: required("CAMERA_SECRET_ENCRYPTION_KEY"),

  // No default token. serviceAuth returns 503 if this is shorter than 32 characters.
  aiServiceToken: process.env.AI_SERVICE_TOKEN ?? "",
  // Only set during rotation. Both tokens are accepted until the worker has the new one.
  aiServiceTokenPrevious: process.env.AI_SERVICE_TOKEN_PREVIOUS ?? "",

  cameraStaleSeconds: Number(process.env.CAMERA_STALE_SECONDS ?? 120),
  workerStaleSeconds: Number(process.env.WORKER_STALE_SECONDS ?? 60),
};