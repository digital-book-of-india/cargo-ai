import path from "path";
import mongoose from "mongoose";
import { env } from "../config/env";
import { backupDatabase } from "./snapshot";

// Usage: npm run backup [-- <folder>]
// Default folder: backups/<database>-<timestamp>. Backups hold personal data: keep them private.
async function main() {
  await mongoose.connect(env.mongodbUri);
  const db = mongoose.connection.db!;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.resolve(process.argv[2] ?? path.join("backups", `${db.databaseName}-${stamp}`));
  const manifest = await backupDatabase(db, dir);
  const total = manifest.collections.reduce((n, c) => n + c.documents, 0);
  console.log(`Backed up ${manifest.collections.length} collections, ${total} documents, to ${dir}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Backup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
