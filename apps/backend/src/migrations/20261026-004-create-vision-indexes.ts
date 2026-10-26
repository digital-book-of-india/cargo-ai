import mongoose from "mongoose";
import type { Migration } from "./types";

// Earlier index migrations are recorded as done on existing databases, so they skip collections added
// later. Creating an index that already exists is a no-op. Rollback keeps the indexes, as before.
export const createVisionIndexes: Migration = {
  id: "20261026-004-create-vision-indexes",
  description: "Create indexes for the vision collections (zones, events, count ledger, camera monitors). Rollback keeps them.",
  async up() {
    await import("../models");
    for (const name of mongoose.modelNames()) {
      await mongoose.model(name).createIndexes();
    }
  },
  async down() {
    // intentionally empty
  },
};
