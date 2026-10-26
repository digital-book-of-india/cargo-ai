import type { ReconciliationStatus } from "@dbi/api-types";

export interface ReconcileInput {
  /** the manifest's expected count, or null when the session has no manifest */
  expected: number | null;
  /** what the counting service saw, or null when it could not say */
  observed: number | null;
  /** an observed count may differ from the expected count by this many packages */
  tolerance: number;
}

export interface ReconcileResult {
  difference: number | null; // observed minus expected
  status: ReconciliationStatus;
}

// The reconciliation rule (requirements 5.3):
//  - no manifest, or no count available: closed_unverified (we cannot compare, so we do not guess)
//  - the absolute difference is within the tolerance: matched
//  - otherwise: review_required (a person checks coverage, occlusion and the manifest)
export function reconcile({ expected, observed, tolerance }: ReconcileInput): ReconcileResult {
  if (expected === null || observed === null) return { difference: null, status: "closed_unverified" };
  const difference = observed - expected;
  return { difference, status: Math.abs(difference) <= tolerance ? "matched" : "review_required" };
}
