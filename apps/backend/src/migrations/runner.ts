import type { Db } from "mongodb";
import type { Migration } from "./types";

const COLLECTION = "_migrations";

interface AppliedRecord {
  id: string;
  appliedAt: Date;
}

function assertValid(list: Migration[]): void {
  const seen = new Set<string>();
  let previous = "";
  for (const m of list) {
    if (seen.has(m.id)) throw new Error(`Duplicate migration id: ${m.id}`);
    if (m.id <= previous) throw new Error(`Migrations must be listed in ascending id order (${m.id}).`);
    seen.add(m.id);
    previous = m.id;
  }
}

export async function appliedIds(db: Db): Promise<string[]> {
  const rows = await db.collection<AppliedRecord>(COLLECTION).find({}).sort({ id: 1 }).toArray();
  return rows.map((r) => r.id);
}

export async function status(db: Db, list: Migration[]): Promise<Array<{ id: string; applied: boolean }>> {
  assertValid(list);
  const applied = new Set(await appliedIds(db));
  return list.map((m) => ({ id: m.id, applied: applied.has(m.id) }));
}

// Applies every pending migration in order. A migration is recorded only after it succeeded.
export async function migrateUp(db: Db, list: Migration[]): Promise<string[]> {
  assertValid(list);
  const applied = new Set(await appliedIds(db));
  const ran: string[] = [];
  for (const m of list) {
    if (applied.has(m.id)) continue;
    await m.up(db);
    await db.collection<AppliedRecord>(COLLECTION).insertOne({ id: m.id, appliedAt: new Date() });
    ran.push(m.id);
  }
  return ran;
}

// Rolls back the last `steps` applied migrations, newest first.
export async function migrateDown(db: Db, list: Migration[], steps = 1): Promise<string[]> {
  assertValid(list);
  const applied = new Set(await appliedIds(db));
  const reverted: string[] = [];
  for (const m of [...list].reverse()) {
    if (reverted.length >= steps) break;
    if (!applied.has(m.id)) continue;
    await m.down(db);
    await db.collection<AppliedRecord>(COLLECTION).deleteOne({ id: m.id });
    reverted.push(m.id);
  }
  return reverted;
}
