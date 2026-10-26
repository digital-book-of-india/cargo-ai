import type { ImportRowError } from "@dbi/api-types";

// A small CSV reader (RFC 4180 style: quoted fields, doubled quotes, commas and line breaks inside
// quotes, optional BOM). No dependency, and it never evaluates anything in the file.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (inQuotes) throw new Error("A quoted field is never closed.");
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // blank lines are ignored
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 1024 * 1024;

export interface ManifestRow {
  line: number; // line number in the file (header = 1)
  reference: string;
  siteCode: string;
  expectedPackageCount: number;
  notes?: string;
}

export interface ParsedImport {
  rows: ManifestRow[];
  errors: ImportRowError[];
  totalRows: number;
}

const REQUIRED = ["reference", "sitecode", "expectedpackagecount"];
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9 _./-]*$/;

// Checks the header and every row on its own and against the rest of the file. It does not touch
// the database: site codes and existing references are checked by the caller.
export function parseManifestCsv(text: string): ParsedImport {
  let table: string[][];
  try {
    table = parseCsv(text);
  } catch (err) {
    return { rows: [], totalRows: 0, errors: [{ row: 1, message: err instanceof Error ? err.message : "The file is not valid CSV." }] };
  }
  if (table.length === 0) return { rows: [], totalRows: 0, errors: [{ row: 1, message: "The file is empty." }] };

  const header = table[0].map((h) => h.trim().toLowerCase().replace(/[\s_-]+/g, ""));
  const missing = REQUIRED.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return {
      rows: [],
      totalRows: Math.max(0, table.length - 1),
      errors: [
        {
          row: 1,
          message: `The header must contain reference, siteCode and expectedPackageCount. Missing: ${missing
            .map((m) => (m === "sitecode" ? "siteCode" : m === "expectedpackagecount" ? "expectedPackageCount" : m))
            .join(", ")}.`,
        },
      ],
    };
  }
  const col = (name: string) => header.indexOf(name);
  const iRef = col("reference");
  const iSite = col("sitecode");
  const iCount = col("expectedpackagecount");
  const iNotes = col("notes");

  const dataRows = table.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    return { rows: [], totalRows: dataRows.length, errors: [{ row: 1, message: `A file can have at most ${MAX_IMPORT_ROWS} rows.` }] };
  }

  const errors: ImportRowError[] = [];
  const rows: ManifestRow[] = [];
  const seen = new Map<string, number>();

  dataRows.forEach((cells, idx) => {
    const line = idx + 2; // header is line 1
    const cell = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const before = errors.length;

    const reference = cell(iRef);
    if (!reference) errors.push({ row: line, field: "reference", message: "Reference is required." });
    else if (reference.length > 100 || !REFERENCE.test(reference)) {
      errors.push({ row: line, field: "reference", message: "Use up to 100 letters, numbers, space and - _ . /" });
    } else {
      const key = reference.toLowerCase();
      if (seen.has(key)) errors.push({ row: line, field: "reference", message: `Duplicate of line ${seen.get(key)} in this file.` });
      else seen.set(key, line);
    }

    const siteCode = cell(iSite);
    if (!siteCode) errors.push({ row: line, field: "siteCode", message: "Site code is required." });

    const rawCount = cell(iCount);
    const count = Number(rawCount);
    if (rawCount === "" || !/^\d+$/.test(rawCount) || !Number.isSafeInteger(count) || count > 1_000_000) {
      errors.push({ row: line, field: "expectedPackageCount", message: "Use a whole number from 0 to 1,000,000." });
    }

    const notes = cell(iNotes);
    if (notes.length > 1000) errors.push({ row: line, field: "notes", message: "Notes can be at most 1000 characters." });

    if (errors.length === before) rows.push({ line, reference, siteCode, expectedPackageCount: count, notes: notes || undefined });
  });

  return { rows, errors, totalRows: dataRows.length };
}
