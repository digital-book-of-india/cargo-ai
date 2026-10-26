import { connectDatabase, disconnectDatabase } from "../config/db";
import { runEvidenceRetention } from "../services/events/retention";

// Usage: npm run job:retention   (run it daily, for example from a scheduler or cron)
async function main() {
  await connectDatabase();
  const result = await runEvidenceRetention();
  console.log(
    `Retention cutoff ${result.cutoff.toISOString()}: ${result.eventsPurged} events purged, ` +
      `${result.filesDeleted} files deleted, ${result.filesMissing} files already missing.`
  );
  await disconnectDatabase();
}

main().catch((err) => {
  console.error("Retention job failed:", err);
  process.exit(1);
});
