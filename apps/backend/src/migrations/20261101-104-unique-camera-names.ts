import type { Db } from "mongodb";
import type { Migration } from "./types";

// A camera name becomes unique within a site (ignoring capitals). Existing duplicates are renamed first: the oldest
// camera keeps its name, the others get " (2)", " (3)". Nothing is deleted. `down` keeps the new names and the index:
// removing a unique index would silently allow duplicates again.
export const uniqueCameraNames: Migration = {
  id: "20261101-104-unique-camera-names",
  description: "Rename duplicate camera names within a site, then add the unique (siteId, name) index.",
  async up(db: Db) {
    const cameras = db.collection("cameras");
    const all = await cameras.find({}, { projection: { siteId: 1, name: 1, createdAt: 1 } }).sort({ createdAt: 1, _id: 1 }).toArray();
    const key = (siteId: unknown, name: string) => `${String(siteId)}|${name.trim().toLowerCase()}`;
    const taken = new Set(all.map((c) => key(c.siteId, String(c.name))));
    const seen = new Set<string>();
    for (const cam of all) {
      const k = key(cam.siteId, String(cam.name));
      if (!seen.has(k)) {
        seen.add(k);
        continue;
      }
      const base = String(cam.name).trim();
      let n = 2;
      while (taken.has(key(cam.siteId, `${base} (${n})`))) n++;
      const renamed = `${base} (${n})`;
      taken.add(key(cam.siteId, renamed));
      seen.add(key(cam.siteId, renamed));
      await cameras.updateOne({ _id: cam._id }, { $set: { name: renamed } });
    }
    // Same keys and options as the model, so it is one index whoever creates it first.
    await cameras.createIndex({ siteId: 1, name: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
  },
  async down() {
    // intentionally empty: see the note above
  },
};
