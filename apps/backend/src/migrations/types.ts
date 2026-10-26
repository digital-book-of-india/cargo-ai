import type { Db } from "mongodb";

// A versioned change to the database. Every migration must be able to go back (down) or say
// plainly in its description why it cannot.
export interface Migration {
  /** sortable, unique, never reused: YYYYMMDD-NNN-short-name */
  id: string;
  description: string;
  up(db: Db): Promise<void>;
  down(db: Db): Promise<void>;
}
