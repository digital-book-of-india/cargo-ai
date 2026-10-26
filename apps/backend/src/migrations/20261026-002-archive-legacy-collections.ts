import type { Db } from "mongodb";
import type { Migration } from "./types";

// Collections of the earlier single-shop product. They are renamed (not deleted) so nothing is
// lost, and `down` renames them back. Delete the legacy_* collections by hand once you are sure.
const LEGACY = ["shops", "schedules", "securitystates", "pushtokens", "notificationpreferences", "connectors", "events"];

async function exists(db: Db, name: string): Promise<boolean> {
  return (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
}

export const archiveLegacyCollections: Migration = {
  id: "20261026-002-archive-legacy-collections",
  description: "Rename collections of the old shop/shutter product to legacy_<name> (reversible).",
  async up(db) {
    for (const name of LEGACY) {
      if ((await exists(db, name)) && !(await exists(db, `legacy_${name}`))) {
        await db.renameCollection(name, `legacy_${name}`);
      }
    }
  },
  async down(db) {
    for (const name of LEGACY) {
      if ((await exists(db, `legacy_${name}`)) && !(await exists(db, name))) {
        await db.renameCollection(`legacy_${name}`, name);
      }
    }
  },
};
