import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CARGO_EVENT_STATUSES, CARGO_EVENT_TYPES, RESOLVE_OUTCOMES } from "@dbi/api-types";
import {
  canReopen,
  canTransition,
  defaultSeverity,
  defaultSummary,
  nextStatuses,
  statusForOutcome,
} from "./transitions";

describe("event transition map", () => {
  it("follows open -> acknowledged -> in_review -> resolved", () => {
    assert.equal(canTransition("open", "acknowledged"), true);
    assert.equal(canTransition("acknowledged", "in_review"), true);
    assert.equal(canTransition("in_review", "resolved"), true);
  });

  it("allows acknowledged -> resolved directly (QA-08)", () => {
    assert.equal(canTransition("acknowledged", "resolved"), true);
  });

  it("cannot skip acknowledgement to resolve an open event", () => {
    assert.equal(canTransition("open", "resolved"), false);
    assert.equal(canTransition("open", "in_review"), false);
  });

  it("false positive and escalation are reachable from the working states", () => {
    for (const from of ["open", "acknowledged", "in_review"] as const) {
      assert.equal(canTransition(from, "false_positive"), true, from);
      assert.equal(canTransition(from, "escalated"), true, from);
    }
  });

  it("resolved and false_positive are final for ordinary actions", () => {
    assert.deepEqual(nextStatuses("resolved"), []);
    assert.deepEqual(nextStatuses("false_positive"), []);
  });

  it("an event never moves to itself or backwards", () => {
    for (const s of CARGO_EVENT_STATUSES) assert.equal(canTransition(s, s), false, s);
    assert.equal(canTransition("resolved", "open"), false);
    assert.equal(canTransition("acknowledged", "open"), false);
  });

  it("only a resolved event can be reopened", () => {
    assert.equal(canReopen("resolved"), true);
    for (const s of CARGO_EVENT_STATUSES.filter((x) => x !== "resolved")) assert.equal(canReopen(s), false, s);
  });
});

describe("resolve outcomes", () => {
  it("maps every outcome to a valid final-ish status", () => {
    assert.equal(statusForOutcome("false_positive"), "false_positive");
    assert.equal(statusForOutcome("escalated"), "escalated");
    for (const o of ["confirmed_operational", "reviewed_no_issue", "unresolved_other"] as const) {
      assert.equal(statusForOutcome(o), "resolved");
    }
    for (const o of RESOLVE_OUTCOMES) assert.ok(CARGO_EVENT_STATUSES.includes(statusForOutcome(o)));
  });

  it("no outcome name asserts theft or loss", () => {
    for (const o of RESOLVE_OUTCOMES) assert.ok(!/theft|stolen|loss|missing/i.test(o), o);
  });
});

describe("event defaults", () => {
  it("every event type has a severity and a conservative summary", () => {
    for (const t of CARGO_EVENT_TYPES) {
      assert.ok(defaultSeverity(t));
      const text = defaultSummary(t);
      assert.ok(text.length > 0 && text.length <= 500);
      assert.ok(!/theft|stolen|thief/i.test(text), t);
    }
  });

  it("rates restricted-zone and mismatch signals higher than routine movement", () => {
    assert.equal(defaultSeverity("restricted_zone_movement"), "high");
    assert.equal(defaultSeverity("count_mismatch"), "high");
    assert.equal(defaultSeverity("package_line_crossing"), "low");
  });
});
