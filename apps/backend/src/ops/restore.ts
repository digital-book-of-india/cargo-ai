import path from "path";
import mongoose from "mongoose";
import { restoreDatabase } from "./snapshot";

// Usage: npm run restore -- <backup-folder> --target-uri <mongodb uri> [--replace]
//
// The target is always explicit: this command never falls back to MONGODB_URI, so a restore can
// not hit the live database by accident. To restore over the live database, pass its URI AND --replace.
async function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--target-uri");
  const uriAt = args.indexOf("--target-uri");
  const uri = uriAt >= 0 ? args[uriAt + 1] : undefined;
  if (!dir || !uri) {
    console.error("Usage: npm run restore -- <backup-folder> --target-uri <mongodb uri> [--replace]");
    process.exit(2);
  }
  await mongoose.connect(uri);
  const result = await restoreDatabase(mongoose.connection.db!, path.resolve(dir), { replace: args.includes("--replace") });
  console.log(`Restored ${result.collections} collections, ${result.documents} documents, into ${mongoose.connection.db!.databaseName}.`);
  console.log("Next: run `npm run migrate` against it so indexes exist.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Restore failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
