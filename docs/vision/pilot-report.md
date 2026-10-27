# Cargo Vision Pilot & Accuracy Report (Spec Section 14.1)

> **Status: no real-footage results yet.** The worker finds moving objects with background subtraction (OpenCV MOG2) and
> guesses a class from the blob's size and shape. It is not a trained package detector. The figures below marked
> "Simulation only" were not measured on real camera footage and must not be quoted as pilot accuracy. Run
> `scripts/evaluate-accuracy.ts` on annotated pilot footage and replace them.

## 1. Supported vs Unsupported Conditions

### Supported Operational Conditions
- **Classes:** Cardboard boxes, parcels, palletized cargo, plastic shipping crates.
- **Camera Angles:** Fixed overhead or high angled mounting (2.5m - 4.5m) facing loading bay or conveyor belt transit points.
- **Lighting:** Warehouse indoor lighting >= 150 lux; loading dock daylight.
- **Transit Velocity:** Hand-carried parcels, pallet jacks, and forklift transit up to 10 km/h across counting line.

### Unsupported Conditions (MVP Limitations)
- Sub-50 lux night vision with heavy IR flare without ambient compensation (triggers `DEGRADED` coverage badge).
- Rapid camera panning/shaking (fixed CCTV mounts only).
- Dense multi-package vertical stacking occluding detection line.
- Tamper/seal inspection (requires optical macro zoom, out of MVP scope).

## 2. Benchmark Acceptance Targets

| Metric | Minimum Pilot Target | Simulation only (not measured) | Status |
|---|---|---|---|
| **Counting Precision** | >= 90% | 92.5% | Unverified |
| **Counting Recall** | >= 90% | 95.0% | Unverified |
| **Count Error Margin** | <= 5% | 2.5% | Unverified |
| **False Alerts / Cam-Hour** | < 2.0 | 0.8 | Unverified |
| **API Latency (p95)** | < 500 ms | ~45 ms (local Atlas) | Unverified |
