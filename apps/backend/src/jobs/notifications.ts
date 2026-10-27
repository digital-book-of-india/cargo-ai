import { connectDatabase, disconnectDatabase } from "../config/db";
import { repairMismatchEvents } from "../services/loading/mismatchEvent";
import { dispatchDue } from "../services/notifications/dispatcher";

// Usage: npm run job:notifications   (run it every minute from a scheduler or cron)
async function main() {
  await connectDatabase();
  const r = await dispatchDue();
  console.log(`Notifications: ${r.delivered} delivered, ${r.retryScheduled} scheduled for retry, ${r.deadLettered} gave up.`);
  const repaired = await repairMismatchEvents();
  if (repaired.checked > 0) console.log(`Mismatch events: ${repaired.created} created for ${repaired.checked} closed sessions that had none.`);
  await disconnectDatabase();
}

main().catch((err) => {
  console.error("Notification job failed:", err);
  process.exit(1);
});
