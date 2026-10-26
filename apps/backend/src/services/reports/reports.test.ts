import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { localParts } from "./time";
import { csvCell, toCsv } from "./csv";

describe("report time zones (QA-11)", () => {
  it("the same instant is a different calendar day in different zones", () => {
    const at = new Date("2026-03-10T20:00:00Z");
    assert.equal(localParts(at, "Asia/Kolkata").date, "2026-03-11"); // 01:30 next day
    assert.equal(localParts(at, "Asia/Kolkata").text, "2026-03-11 01:30");
    assert.equal(localParts(at, "America/New_York").date, "2026-03-10"); // 16:00 (daylight time)
    assert.equal(localParts(at, "UTC").minutes, 20 * 60);
  });

  it("midnight is minute 0, not 24", () => {
    assert.equal(localParts(new Date("2026-03-10T18:30:00Z"), "Asia/Kolkata").minutes, 0);
  });

  it("an invalid zone falls back to UTC instead of breaking the report", () => {
    assert.equal(localParts(new Date("2026-03-10T05:00:00Z"), "Not/AZone").text, "2026-03-10 05:00");
  });
});

describe("csv export", () => {
  it("quotes commas, quotes and line breaks", () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell("x\ny"), '"x\ny"');
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(5), "5");
  });

  it("defuses spreadsheet formulas", () => {
    for (const bad of ["=SUM(A1)", "+1+1", "-2+3", "@cmd", "\tx"]) {
      assert.ok(csvCell(bad).startsWith("'") || csvCell(bad).startsWith('"\''), bad);
    }
    assert.equal(csvCell("normal text"), "normal text");
  });

  it("writes a header, CRLF rows and a byte order mark", () => {
    const out = toCsv(["a", "b"], [[1, "x,y"]]);
    assert.equal(out, "﻿a,b\r\n1,\"x,y\"\r\n");
  });
});
