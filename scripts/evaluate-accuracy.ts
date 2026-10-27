/**
 * Accuracy & Pilot Evaluation Harness (Spec section 14.1)
 * Computes precision, recall, false alerts / camera-hour, and count error against ground-truth.
 */

export interface GroundTruthEvent {
  timeOffsetSeconds: number;
  direction: "IN" | "OUT";
  objectClass: "package" | "box" | "pallet";
}

export interface ObservedEvent {
  timeOffsetSeconds: number;
  direction: "IN" | "OUT";
  objectClass: "package" | "box" | "pallet";
  confidence: number;
}

export interface EvaluationResult {
  groundTruthCount: number;
  observedCount: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  precision: number;
  recall: number;
  f1Score: number;
  countErrorPercentage: number;
  falseAlertsPerHour: number;
}

export function evaluateStreamPerformance(
  groundTruth: GroundTruthEvent[],
  observed: ObservedEvent[],
  videoDurationHours: number,
  timeToleranceSeconds = 2.0
): EvaluationResult {
  let tp = 0;
  let fp = 0;
  const matchedGtIndices = new Set<number>();

  for (const obs of observed) {
    let matchedIndex = -1;
    for (let i = 0; i < groundTruth.length; i++) {
      if (matchedGtIndices.has(i)) continue;
      const gt = groundTruth[i];
      if (
        Math.abs(gt.timeOffsetSeconds - obs.timeOffsetSeconds) <= timeToleranceSeconds &&
        gt.direction === obs.direction
      ) {
        matchedIndex = i;
        break;
      }
    }

    if (matchedIndex !== -1) {
      tp++;
      matchedGtIndices.add(matchedIndex);
    } else {
      fp++;
    }
  }

  const fn = groundTruth.length - tp;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
  const recall = groundTruth.length > 0 ? tp / groundTruth.length : 1;
  const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const countErrorPercentage =
    groundTruth.length > 0
      ? Math.abs(observed.length - groundTruth.length) / groundTruth.length * 100
      : 0;
  const falseAlertsPerHour = videoDurationHours > 0 ? fp / videoDurationHours : 0;

  return {
    groundTruthCount: groundTruth.length,
    observedCount: observed.length,
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision: Number(precision.toFixed(4)),
    recall: Number(recall.toFixed(4)),
    f1Score: Number(f1Score.toFixed(4)),
    countErrorPercentage: Number(countErrorPercentage.toFixed(2)),
    falseAlertsPerHour: Number(falseAlertsPerHour.toFixed(2)),
  };
}

// Command line: npm run eval:accuracy -- <ground-truth.json> <observed.json> <video-hours>
//   ground-truth.json  [{ "timeOffsetSeconds": 10.2, "direction": "IN", "objectClass": "package" }, ...]  counted by a person
//   observed.json      the same shape plus "confidence", taken from what the worker reported for the same footage
// Prints the result as JSON. The numbers in docs/vision/pilot-report.md must come from this, run on real footage.
if (process.argv[1] && /evaluate-accuracy\.[tj]s$/.test(process.argv[1])) {
  const [truthFile, observedFile, hours] = process.argv.slice(2);
  if (!truthFile || !observedFile || !hours || !(Number(hours) > 0)) {
    console.error("Usage: npm run eval:accuracy -- <ground-truth.json> <observed.json> <video-hours>");
    process.exit(2);
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  const truth = JSON.parse(fs.readFileSync(truthFile, "utf8")) as GroundTruthEvent[];
  const observed = JSON.parse(fs.readFileSync(observedFile, "utf8")) as ObservedEvent[];
  console.log(JSON.stringify(evaluateStreamPerformance(truth, observed, Number(hours)), null, 2));
}
