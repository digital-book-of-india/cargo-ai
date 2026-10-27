import type { Db } from "mongodb";
import type { Migration } from "./types";

const SESSIONS = "cargo_loading_sessions";

// Loading sessions used to point at the old camera-zone model; the count ledger uses vision zones. A session whose
// zoneId is not a vision zone could never be matched with any count, so the old id is parked in `legacyZoneId` and
// the session becomes zone-less (its count then reads as "site-wide", as it effectively always did). `down` puts the
// old ids back. The unique index (one open session per counting line and direction) is kept on `down` on purpose:
// removing a unique index would silently allow duplicates.
export const sessionsOnVisionZones: Migration = {
  id: "20261101-101-sessions-on-vision-zones",
  description: "Loading sessions: move the zone reference to vision zones (old ids kept in legacyZoneId) and add the one-open-session-per-line index.",
  async up(db: Db) {
    const sessions = db.collection(SESSIONS);
    const visionZoneIds = (await db.collection("vision_zones").find({}, { projection: { _id: 1 } }).toArray()).map((z) => z._id);
    await sessions.updateMany(
      { zoneId: { $type: "objectId", $nin: visionZoneIds } },
      [{ $set: { legacyZoneId: "$zoneId", zoneId: null } }]
    );
    // Default index name on purpose: Mongoose builds the same index from the model in development and tests, and a
    // different name for the same keys makes MongoDB refuse the second one.
    await sessions.createIndex(
      { companyId: 1, zoneId: 1, direction: 1 },
      { unique: true, partialFilterExpression: { closedAt: null, zoneId: { $type: "objectId" } } }
    );
  },
  async down(db: Db) {
    await db.collection(SESSIONS).updateMany(
      { legacyZoneId: { $type: "objectId" } },
      [{ $set: { zoneId: "$legacyZoneId" } }, { $unset: "legacyZoneId" }]
    );
  },
};
