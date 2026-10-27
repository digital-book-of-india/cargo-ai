import type { Db } from "mongodb";
import type { Migration } from "./types";

// Indexes for queries that were scanning: the audit trail (one company, newest first) and the event inbox and reports
// (filtered by camera or by counting line). Default index names on purpose: Mongoose builds the same indexes from the
// models in development and tests, and a different name for the same keys makes MongoDB refuse the second one.
// `down` keeps the indexes: they only speed up reads and dropping them would slow the service for no gain.
export const addQueryIndexes: Migration = {
  id: "20261101-102-query-indexes",
  description: "Add (companyId, createdAt) on the audit log and (companyId, cameraId|zoneId, occurredAt) on cargo events.",
  async up(db: Db) {
    await db.collection("auditlogs").createIndex({ companyId: 1, createdAt: -1 });
    await db.collection("cargo_events").createIndex({ companyId: 1, cameraId: 1, occurredAt: -1 });
    await db.collection("cargo_events").createIndex({ companyId: 1, zoneId: 1, occurredAt: -1 });
  },
  async down() {
    // intentionally empty: see the note above
  },
};
