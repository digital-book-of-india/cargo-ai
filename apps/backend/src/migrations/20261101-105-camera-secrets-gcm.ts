import type { Db } from "mongodb";
import type { Migration } from "./types";
import { decryptSecret, encryptSecret, isLegacySecret } from "../services/secrets/manager";

// Camera stream addresses (they contain the camera password) were encrypted with AES-256-CBC, which does not notice a
// changed value. This re-encrypts them with AES-256-GCM. A value that cannot be read with the current key is left
// untouched and counted, never overwritten. `down` is empty on purpose: the code reads both formats, so nothing needs
// undoing, and turning secrets back into the weaker format would only lower security.
export const cameraSecretsGcm: Migration = {
  id: "20261101-105-camera-secrets-gcm",
  description: "Re-encrypt camera secrets with AES-256-GCM (old values stay readable; unreadable ones are left alone).",
  async up(db: Db) {
    const cameras = db.collection("cameras");
    const cursor = cameras.find({ secretRef: { $type: "string", $regex: /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/ } });
    let converted = 0;
    let unreadable = 0;
    for await (const cam of cursor) {
      const secret = String(cam.secretRef);
      const plain = isLegacySecret(secret) ? decryptSecret(secret) : "";
      if (!plain) {
        unreadable++;
        continue;
      }
      await cameras.updateOne({ _id: cam._id, secretRef: secret }, { $set: { secretRef: encryptSecret(plain) } });
      converted++;
    }
    if (unreadable > 0) console.warn(`camera secrets: ${unreadable} could not be read with the current key and were left unchanged (${converted} converted)`);
  },
  async down() {
    // intentionally empty: see the note above
  },
};
