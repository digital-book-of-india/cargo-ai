import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseManifestCsv } from "./csv";

describe("csv reader", () => {
  it("reads quoted fields, doubled quotes, commas and line breaks inside quotes", () => {
    const rows = parseCsv('a,b\n"x, y","say ""hi"""\n"line1\nline2",z\n');
    assert.deepEqual(rows, [["a", "b"], ["x, y", 'say "hi"'], ["line1\nline2", "z"]]);
  });

  it("handles Windows line endings, a byte order mark and blank lines", () => {
    assert.deepEqual(parseCsv("\uFEFFa,b\r\n1,2\r\n\r\n3,4"), [["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("refuses a quote that is never closed", () => {
    assert.throws(() => parseCsv('a,b\n"oops,1'));
  });
});

describe("manifest csv validation", () => {
  const good = "reference,siteCode,expectedPackageCount,notes\nMAN-1,WH-NORTH,100,Outbound\nMAN-2,WH-NORTH,0,\n";

  it("accepts a good file and keeps line numbers", () => {
    const r = parseManifestCsv(good);
    assert.equal(r.errors.length, 0);
    assert.deepEqual(r.rows.map((x) => [x.line, x.reference, x.expectedPackageCount]), [[2, "MAN-1", 100], [3, "MAN-2", 0]]);
  });

  it("accepts any header order and spelling style", () => {
    const r = parseManifestCsv("Site Code,expected_package_count,Reference\nWH-1,5,A-1\n");
    assert.equal(r.errors.length, 0);
    assert.equal(r.rows[0].siteCode, "WH-1");
  });

  it("reports a missing column once, on the header", () => {
    const r = parseManifestCsv("reference,siteCode\nA,B\n");
    assert.equal(r.rows.length, 0);
    assert.equal(r.errors.length, 1);
    assert.match(r.errors[0].message, /expectedPackageCount/);
  });

  it("reports every bad row with its line number and field, and keeps the good rows", () => {
    const r = parseManifestCsv(
      [
        "reference,siteCode,expectedPackageCount",
        "OK-1,WH,10",
        ",WH,10",
        "BAD COUNT,WH,ten",
        "NEG,WH,-5",
        "FRAC,WH,2.5",
        "NOSITE,,5",
        "OK-1,WH,11",
      ].join("\n")
    );
    assert.deepEqual(r.rows.map((x) => x.reference), ["OK-1"]);
    const byLine = Object.fromEntries(r.errors.map((e) => [e.row, e.field]));
    assert.deepEqual(byLine, { 3: "reference", 4: "expectedPackageCount", 5: "expectedPackageCount", 6: "expectedPackageCount", 7: "siteCode", 8: "reference" });
    assert.match(r.errors.find((e) => e.row === 8)!.message, /Duplicate of line 2/);
  });

  it("rejects spreadsheet formulas in the reference", () => {
    const r = parseManifestCsv("reference,siteCode,expectedPackageCount\n=SUM(A1:A9),WH,1\n");
    assert.equal(r.rows.length, 0);
    assert.equal(r.errors[0].field, "reference");
  });

  it("an empty file and a header-only file are handled", () => {
    assert.equal(parseManifestCsv("").errors[0].message, "The file is empty.");
    const r = parseManifestCsv("reference,siteCode,expectedPackageCount\n");
    assert.equal(r.totalRows, 0);
    assert.equal(r.errors.length, 0);
  });
});
