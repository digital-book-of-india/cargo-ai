import type { Db } from "mongodb";
import type { Migration } from "./types";

// The old owner zone model (collection "zones", one shutter-style polygon per camera) is replaced by vision zones
// (collection "vision_zones"). The old collection is renamed, not deleted; `down` renames it back.
async function exists(db: Db, name: string): Promise<boolean> {
  return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

export const archiveOldZones: Migration = {
  id: "20261101-106-archive-old-zones",
  description: "Rename the old zones collection to legacy_zones (reversible); vision_zones is the only zone model.",
  async up(db) {
    if ((await exists(db, "zones")) && !(await exists(db, "legacy_zones"))) await db.renameCollection("zones", "legacy_zones");
  },
  async down(db) {
    if ((await exists(db, "legacy_zones")) && !(await exists(db, "zones"))) await db.renameCollection("legacy_zones", "zones");
  },
};
