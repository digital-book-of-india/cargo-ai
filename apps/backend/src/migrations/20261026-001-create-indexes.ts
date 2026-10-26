import mongoose from "mongoose";
import type { Migration } from "./types";

// Production runs with autoIndex off, so indexes are created here instead of on every start.
// `down` keeps the indexes: they only speed up and constrain reads and writes, and dropping a
// unique index would silently allow duplicates.
export const createIndexes: Migration = {
  id: "20261026-001-create-indexes",
  description: "Create all model indexes (unique company/site codes, event keys, memberships...). Rollback keeps them.",
  async up() {
    // Importing the models registers their schemas (and indexes) with mongoose.
    await import("../models");
    for (const name of mongoose.modelNames()) {
      await mongoose.model(name).createIndexes();
    }
  },
  async down() {
    // intentionally empty, see the comment above
  },
};
