import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shiftAt, validateShifts, toMinutes } from "@dbi/api-types";

const MORNING = { name: "Morning", start: "06:00", end: "14:00" };
const EVENING = { name: "Evening", start: "14:00", end: "22:00" };
const NIGHT = { name: "Night", start: "22:00", end: "06:00" }; // crosses midnight

describe("shift rules", () => {
  it("accepts three back-to-back shifts including one that crosses midnight (QA-11)", () => {
    assert.equal(validateShifts([MORNING, EVENING, NIGHT]), null);
  });

  it("accepts an empty list", () => {
    assert.equal(validateShifts([]), null);
  });

  it("rejects overlaps, including across midnight", () => {
    assert.match(validateShifts([MORNING, { name: "Early", start: "05:00", end: "07:00" }]) ?? "", /overlap/);
    assert.match(validateShifts([NIGHT, { name: "Dawn", start: "04:00", end: "08:00" }]) ?? "", /overlap/);
    assert.match(validateShifts([NIGHT, { name: "Late", start: "23:00", end: "23:30" }]) ?? "", /overlap/);
  });

  it("rejects duplicate names, equal start and end, bad times and too many shifts", () => {
    assert.match(validateShifts([MORNING, { ...EVENING, name: "morning" }]) ?? "", /called/);
    assert.match(validateShifts([{ name: "Zero", start: "08:00", end: "08:00" }]) ?? "", /same time/);
    assert.match(validateShifts([{ name: "Bad", start: "8am", end: "14:00" }]) ?? "", /times like/);
    const nine = Array.from({ length: 9 }, (_, i) => ({ name: `S${i}`, start: "00:00", end: "00:01" }));
    assert.match(validateShifts(nine) ?? "", /at most/);
  });

  it("finds the shift a time falls into, including after midnight", () => {
    const list = [MORNING, EVENING, NIGHT];
    assert.equal(shiftAt(list, toMinutes("07:30"))?.name, "Morning");
    assert.equal(shiftAt(list, toMinutes("14:00"))?.name, "Evening");
    assert.equal(shiftAt(list, toMinutes("23:30"))?.name, "Night");
    assert.equal(shiftAt(list, toMinutes("02:00"))?.name, "Night");
    assert.equal(shiftAt([MORNING], toMinutes("20:00")), null);
  });
});
