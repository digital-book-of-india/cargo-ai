import { connectDatabase, disconnectDatabase } from "../config/db";
import { dispatchDue } from "../services/notifications/dispatcher";

// Usage: npm run job:notifications   (run it every minute from a scheduler or cron)
async function main() {
  await connectDatabase();
  const r = await dispatchDue();
  console.log(`Notifications: ${r.delivered} delivered, ${r.retryScheduled} scheduled for retry, ${r.deadLettered} gave up.`);
  await disconnectDatabase();
}

main().catch((err) => {
  console.error("Notification job failed:", err);
  process.exit(1);
});
