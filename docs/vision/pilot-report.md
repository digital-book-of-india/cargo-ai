# Cargo Vision Pilot & Accuracy Report (Spec Section 14.1)

> **Status: NOT MEASURED (2026-10-27).** No numbers are claimed. Earlier versions of this file listed accuracy figures
> that were not produced by any run on real footage; they were removed. The worker now needs a trained ONNX model
> (`MODEL_PATH`) and, without one, reports DEGRADED and sends no events. This report is filled in only from a real
> pilot, with the steps below.

## 1. Supported vs unsupported conditions (design targets, not measured results)

### Intended conditions
- **Classes:** cardboard boxes, parcels, palletised cargo (`package`, `box`, `pallet`).
- **Camera angles:** fixed, overhead or high-angle mounting facing a loading bay or conveyor transit point.
- **Lighting:** indoor warehouse lighting or loading dock daylight.
- **Speed:** hand-carried parcels, pallet jacks and forklifts crossing the counting line.

### Not supported
- Very low light with strong infrared glare.
- Moving or shaking cameras (fixed mounts only).
- Dense stacking that hides the packages crossing the line.
- Seal or tamper inspection.

## 2. How the pilot is measured

1. Choose real footage from the customer's own site: at least 2 cameras, 1 hour each, day and evening.
2. A person counts every crossing and writes `ground-truth.json` (time offset in seconds, direction, class).
3. Run the worker on the same footage (or live) with the trained model, and export what it reported for the line
   as `observed.json` (same shape, with `confidence`). The model name and version are on every event.
4. Run `npm run eval:accuracy -- ground-truth.json observed.json <video-hours>`.
5. Copy the output into the table below with the date, footage description, model name and version.

| Metric | Target | Measured | Footage / model / date |
|---|---|---|---|
| Package count error | <= 2.0 % | not measured | |
| Precision | >= 97 % | not measured | |
| Recall | >= 97 % | not measured | |
| False alerts per camera-hour | to be agreed | not measured | |
| Frame processing time (p95) | <= 200 ms on the target machine | not measured | |

## 3. What is verified without footage
- Event format, idempotency, tenant isolation and the counting rules are covered by the automated tests
  (`apps/backend` integration tests, `apps/ai-worker/tests`, and the contract test that checks the worker's events
  against the API schema).
- These tests do not say anything about detection accuracy.
