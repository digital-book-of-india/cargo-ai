import type { Server } from "http";
import { app } from "./app";
import { env } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./config/db";
import { startVisionMonitorJob } from "./modules/vision/monitoring/staleness";
import { prepareEvidenceStorage } from "./services/evidence/storage";
import { errorFields, logger } from "./utils/logger";

let server: Server | null = null;
let shuttingDown = false;

// Stop taking new requests, let running ones finish, then close the database. A hard stop after
// 15 seconds keeps a stuck connection from blocking a deploy.
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("shutting down", { signal });
  const force = setTimeout(() => {
    logger.error("shutdown timed out, exiting");
    process.exit(1);
  }, 15_000);
  force.unref();
  try {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await disconnectDatabase();
    process.exit(0);
  } catch (err) {
    logger.error("error during shutdown", errorFields(err));
    process.exit(1);
  }
}

async function bootstrap() {
  await connectDatabase();
  const evidenceDir = await prepareEvidenceStorage();
  if (evidenceDir) logger.info("evidence folder ready", { dir: evidenceDir });

  server = app.listen(env.port, () => {
    logger.info("CargoSense AI API listening", { port: env.port, env: env.nodeEnv });
    startVisionMonitorJob();
  });
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

process.on("unhandledRejection", (reason) => {
  logger.error("unhandled promise rejection", errorFields(reason));
});

bootstrap().catch((err) => {
  logger.error("bootstrap error", errorFields(err));
  process.exit(1);
});
