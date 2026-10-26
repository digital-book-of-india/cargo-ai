import mongoose from "mongoose";
import type { Migration } from "./types";

// Migration 001 only covers the models that existed when it ran, and it is recorded as done on
// databases that already ran it. This one creates the indexes of every model again (creating an
// index that exists is a no-op), so the shipment collections get theirs, including the unique
// "one open loading session per manifest" rule. Rollback keeps them, as in 001.
export const createShipmentIndexes: Migration = {
  id: "20261026-003-create-shipment-indexes",
  description: "Create indexes for vehicles, manifests, import jobs and loading sessions. Rollback keeps them.",
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
