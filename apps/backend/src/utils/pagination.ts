// Shared paging rules: a default page size, a hard maximum, and opaque cursors.
import { AppError } from "../middleware/errorHandler";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export function parseLimit(raw: unknown, defaultSize = DEFAULT_PAGE_SIZE, maxSize = MAX_PAGE_SIZE): number {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  if (!Number.isFinite(n) || n < 1) return defaultSize;
  return Math.min(Math.floor(n), maxSize);
}

// A cursor points just after the last item of a page: its sort time and its id (tie-breaker).
export interface PageCursor {
  at: Date;
  id: string;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

// No cursor means "first page". A cursor that was given but is not one of ours (tampered, truncated, from another
// list) is a client error, never a server crash and never a silent first page.
export function decodeCursor(raw: unknown): PageCursor | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const invalid = () => new AppError(400, "VALIDATION_ERROR", "The cursor is not valid. Start again from the first page.");
  if (typeof raw !== "string") throw invalid();
  const [iso, id] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  const at = new Date(iso);
  if (!id || !/^[a-f0-9]{24}$/i.test(id) || Number.isNaN(at.getTime())) throw invalid();
  return { at, id };
}
