import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/db";
import { migrations } from "./list";
import { migrateDown, migrateUp, status } from "./runner";

// Usage: tsx src/migrations/cli.ts up | down [steps] | status
async function main() {
  const [command = "status", arg] = process.argv.slice(2);
  await connectDatabase();
  const db = mongoose.connection.db;
  if (!db) throw new Error("Database connection is not ready.");

  if (command === "up") {
    const ran = await migrateUp(db, migrations);
    console.log(ran.length ? `Applied: ${ran.join(", ")}` : "Nothing to apply.");
  } else if (command === "down") {
    const steps = Math.max(1, Number(arg) || 1);
    const reverted = await migrateDown(db, migrations, steps);
    console.log(reverted.length ? `Rolled back: ${reverted.join(", ")}` : "Nothing to roll back.");
  } else if (command === "status") {
    for (const row of await status(db, migrations)) console.log(`${row.applied ? "applied " : "pending "} ${row.id}`);
  } else {
    console.error("Unknown command. Use: up | down [steps] | status");
    process.exitCode = 1;
  }
  await disconnectDatabase();
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
