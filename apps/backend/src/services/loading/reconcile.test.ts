import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcile } from "./reconcile";
import { observedForSession } from "../counts/observed";

describe("reconciliation", () => {
  it("manifest 100, observed 94 gives -6 and needs review (QA-07)", () => {
    assert.deepEqual(reconcile({ expected: 100, observed: 94, tolerance: 0 }), { difference: -6, status: "review_required" });
  });

  it("a difference inside the tolerance matches, on either side", () => {
    assert.equal(reconcile({ expected: 100, observed: 94, tolerance: 6 }).status, "matched");
    assert.equal(reconcile({ expected: 100, observed: 106, tolerance: 6 }).status, "matched");
    assert.equal(reconcile({ expected: 100, observed: 93, tolerance: 6 }).status, "review_required");
    assert.equal(reconcile({ expected: 100, observed: 107, tolerance: 6 }).status, "review_required");
  });

  it("an exact count matches even with no tolerance", () => {
    assert.deepEqual(reconcile({ expected: 50, observed: 50, tolerance: 0 }), { difference: 0, status: "matched" });
  });

  it("never guesses: no manifest or no count means unverified", () => {
    assert.deepEqual(reconcile({ expected: null, observed: 40, tolerance: 0 }), { difference: null, status: "closed_unverified" });
    assert.deepEqual(reconcile({ expected: 40, observed: null, tolerance: 0 }), { difference: null, status: "closed_unverified" });
  });

  it("an observed count of zero is a real count, not a missing one", () => {
    assert.deepEqual(reconcile({ expected: 10, observed: 0, tolerance: 0 }), { difference: -10, status: "review_required" });
  });
});

describe("observed count for a session", () => {
  it("an outbound session uses only the packages counted going out", () => {
    assert.equal(observedForSession("outbound", { inCount: 2, outCount: 100 }), 100);
  });
  it("an inbound session uses only the packages counted coming in", () => {
    assert.equal(observedForSession("inbound", { inCount: 40, outCount: 3 }), 40);
  });
  it("never subtracts the other direction", () => {
    assert.equal(observedForSession("outbound", { inCount: 9, outCount: 4 }), 4);
    assert.equal(observedForSession("inbound", { inCount: 0, outCount: 50 }), 0);
  });
});
