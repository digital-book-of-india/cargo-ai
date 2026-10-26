// CSV writing for exports. Cells that a spreadsheet could run as a formula (they start with
// = + - @ or a control character) are prefixed with an apostrophe, so an event summary or a
// reference typed by someone can never execute when an export is opened in Excel.

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = value instanceof Date ? value.toISOString() : String(value);
  if (FORMULA_START.test(text)) text = "'" + text;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.map(csvCell).join(",")];
  for (const row of rows) lines.push(row.map(csvCell).join(","));
  // a byte order mark makes Excel read the file as UTF-8; CRLF is the CSV standard
  return "﻿" + lines.join("\r\n") + "\r\n";
}
