import { app } from "./app";
import { env } from "./config/env";
import { connectDatabase } from "./config/db";

async function bootstrap() {
  await connectDatabase();

  app.listen(env.port, () => {
    console.log(`DBI Intelligence API listening on :${env.port}`);
  });
}

bootstrap().catch((err) => {
  console.error("Bootstrap error:", err);
  process.exit(1);
});

