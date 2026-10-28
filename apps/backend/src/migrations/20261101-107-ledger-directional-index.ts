import type { Db } from "mongodb";
import type { Migration } from "./types";

// Index for counting ledger range queries: shift summaries, manifest reconciliation, and direction filters.
// Covers queries filtering by zoneId, direction, and date range without scanning whole zone history.
// `down` keeps the indexes intentionally to prevent read slowdowns.
export const addLedgerDirectionalIndex: Migration = {
  id: "20261101-107-ledger-directional-index",
  description: "Add (zoneId, direction, occurredAt) and (companyId, zoneId, occurredAt) on vision_count_ledger.",
  async up(db: Db) {
    await db.collection("vision_count_ledger").createIndex({ zoneId: 1, direction: 1, occurredAt: -1 });
    await db.collection("vision_count_ledger").createIndex({ companyId: 1, zoneId: 1, occurredAt: -1 });
  },
  async down() {
    // intentionally empty: indexes improve reads and drop provides no gain
  },
};