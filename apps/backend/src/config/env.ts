import "dotenv/config";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  mongodbUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017/dbi_intelligence",
  corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? "default_dev_jwt_secret_key_12345",
  aiServiceToken: process.env.AI_SERVICE_TOKEN ?? "dbi-ai-worker-secret-token",
  cameraSecretEncryptionKey:
    process.env.CAMERA_SECRET_ENCRYPTION_KEY ||
    process.env.JWT_ACCESS_SECRET ||
    "default_camera_secret_key_12345",
  connectorPairingCodeTtlMinutes: Number(process.env.CONNECTOR_PAIRING_CODE_TTL_MINUTES ?? 10),
  connectorStaleSeconds: Number(process.env.CONNECTOR_STALE_SECONDS ?? 150),
};

