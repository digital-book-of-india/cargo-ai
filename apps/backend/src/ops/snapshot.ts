import fs from "fs";
import path from "path";
import crypto from "crypto";
import { mongo } from "mongoose";

const { EJSON } = mongo.BSON;
type Db = mongo.Db;

// Database backup and restore as plain files, using only the Node driver (no mongodump needed).
// A backup is a folder: one <collection>.ejson file per collection (one JSON document per line,
// types preserved) plus manifest.json with counts and checksums. Evidence files are NOT in here:
// back up the evidence folder (or bucket) separately, see docs/runbook.md.

export interface BackupManifest {
  format: 1;
  createdAt: string;
  database: string;
  collections: Array<{ name: string; documents: number; sha256: string }>;
}

const SKIP_PREFIXES = ["system."];

export async function backupDatabase(db: Db, dir: string): Promise<BackupManifest> {
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    throw new Error(`The backup folder ${dir} is not empty.`);
  }
  fs.mkdirSync(dir, { recursive: true });

  const manifest: BackupManifest = { format: 1, createdAt: new Date().toISOString(), database: db.databaseName, collections: [] };
  const infos = await db.listCollections({}, { nameOnly: true }).toArray();
  for (const info of infos.sort((a, b) => a.name.localeCompare(b.name))) {
    if (SKIP_PREFIXES.some((p) => info.name.startsWith(p))) continue;
    const file = path.join(dir, `${info.name}.ejson`);
    const hash = crypto.createHash("sha256");
    const fd = fs.openSync(file, "w");
    let documents = 0;
    try {
      for await (const doc of db.collection(info.name).find({})) {
        const line = EJSON.stringify(doc, { relaxed: false }) + "\n";
        hash.update(line);
        fs.writeSync(fd, line);
        documents++;
      }
    } finally {
      fs.closeSync(fd);
    }
    manifest.collections.push({ name: info.name, documents, sha256: hash.digest("hex") });
  }
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export interface RestoreResult {
  collections: number;
  documents: number;
}

// Restores a backup into a database. It first verifies every file against the manifest, and it
// refuses to write into a database that already has data unless `replace` is set (which drops the
// restored collections first). Indexes are not part of the backup: run `npm run migrate` afterwards.
export async function restoreDatabase(db: Db, dir: string, opts: { replace?: boolean } = {}): Promise<RestoreResult> {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json in ${dir}: this is not a backup folder.`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as BackupManifest;
  if (manifest.format !== 1) throw new Error(`Unsupported backup format ${manifest.format}.`);

  // 1. verify before touching anything
  for (const c of manifest.collections) {
    const file = path.join(dir, `${c.name}.ejson`);
    if (!fs.existsSync(file)) throw new Error(`Backup is missing ${c.name}.ejson.`);
    const actual = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    if (actual !== c.sha256) throw new Error(`Backup file ${c.name}.ejson is damaged (checksum mismatch).`);
  }

  // 2. refuse to mix with existing data
  const existing = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  const clashes: string[] = [];
  for (const c of manifest.collections) {
    if (existing.has(c.name) && (await db.collection(c.name).estimatedDocumentCount()) > 0) clashes.push(c.name);
  }
  if (clashes.length > 0 && !opts.replace) {
    throw new Error(`The target database already has data in: ${clashes.join(", ")}. Restore into an empty database, or pass --replace.`);
  }

  // 3. write
  let documents = 0;
  for (const c of manifest.collections) {
    if (existing.has(c.name) && opts.replace) await db.collection(c.name).drop();
    const lines = fs.readFileSync(path.join(dir, `${c.name}.ejson`), "utf8").split("\n").filter(Boolean);
    const batch: unknown[] = [];
    for (const line of lines) {
      batch.push(EJSON.parse(line, { relaxed: false }));
      if (batch.length === 500) {
        await db.collection(c.name).insertMany(batch.splice(0) as never[]);
      }
    }
    if (batch.length > 0) await db.collection(c.name).insertMany(batch as never[]);
    if (lines.length === 0) await db.createCollection(c.name).catch(() => undefined);
    documents += lines.length;
  }
  return { collections: manifest.collections.length, documents };
}
