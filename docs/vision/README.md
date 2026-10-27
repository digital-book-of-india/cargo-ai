# Vision (Dev 2): Zones, Ingestion, Counts, Monitoring & AI Worker

Dev 2 owns the Vision subsystem: zones backend & UI, AI ingestion pipeline, count ledger, monitoring staleness, live stream HUD, cargo KPI dashboard, and the Python detection/tracking worker.

## Architecture & Layout

| Module | Location | Description |
|---|---|---|
| **Zones Backend** | `apps/backend/src/modules/vision/zones` | CRUD, geometry validation (shoelace, self-intersection, vertex bounds), validate & enable flow. |
| **Ingestion Pipeline** | `apps/backend/src/modules/vision/ingestion` | `POST /internal/v1/ai/events` adhering to Appendix A schema, SHA-256 payload hashing, transaction write, rate limiting. |
| **Counts & Ledger** | `apps/backend/src/modules/vision/counts` | `GET /counts/summary` (grouped by zone/camera/day in site timezone), `GET /counts/ledger`, `getObservedCount()` for Dev 1. |
| **Monitoring** | `apps/backend/src/modules/vision/monitoring` | `/monitoring/status`, start/stop monitoring, `/internal/v1/monitoring/config`, `/internal/v1/monitoring/heartbeat`, 15s staleness cron job (`QA-06`). |
| **Zones UI Editor** | `apps/owner/src/components/camera/ZoneEditor.tsx` | Interactive SVG canvas supporting polygons & virtual counting lines with direction arrows (A -> B). |
| **Zone Management** | `apps/owner/src/app/(app)/sites/[siteId]/cameras/[cameraId]/zone/page.tsx` | Class selection (package, box, pallet), confidence slider, validate & enable actions. |
| **Live Monitoring** | `apps/owner/src/app/(app)/sites/[siteId]/cameras/[cameraId]/live/page.tsx` | HUD stream overlay, active zone visualization, coverage badges, live crossing ledger. |
| **Cargo Dashboard** | `apps/owner/src/app/(app)/dashboard/page.tsx` | IN/OUT line crossing metrics, movement totals, camera monitoring health, and event inbox. |
| **AI Worker** | `apps/ai-worker/src/main.py` | Python worker: auto-config fetch, session-scoped tracker, line crossing vector geometry with debounce, event ingestion. |
| **Accuracy Harness** | `scripts/evaluate-accuracy.ts` | Ground-truth benchmark evaluator calculating precision, recall, F1, and count error percentage. |
| **QA Verification** | `scripts/test-qa03.ps1` | Automated idempotency test verifying 202 Accepted, 200 Duplicate, and 409 Conflict. |

## Collections (Owned by Dev 2)

- `vision_zones`: Camera zones with validation status, hash fingerprints, and rules.
- `vision_events`: Ingested AI events with normalized payload hashes.
- `vision_count_ledger`: Idempotent count entries with compound unique index on `(zoneId, trackId)`.
- `vision_camera_monitors`: Per-camera monitoring state, stream health, frame rate, and coverage.

## Two ingestion paths

- `POST /internal/v1/ai/events` is the worker's gateway: strict Appendix A schema, payload hash, 409 on key reuse with a
  different payload, count ledger. After an accepted alert-type event (restricted zone, after hours, count mismatch, damage,
  seal change, camera offline, AI unavailable) `ingestion/inbox.ts` forwards it to `createCargoEvent`, so it shows in the Alerts
  inbox. Counting-only types (line crossing, zone entry/exit, detection) stay in the ledger.
- `POST /internal/v1/ai/cargo-events` (and `/api/v1/ai/events`) write straight to the inbox with the older, simpler payload.

API reference: `docs/vision/openapi.yaml`.

## Dev 1 Contract Status

- Dev 1 provides (all delivered): tenancy middleware (`shared/access.ts` now uses it), `createCargoEvent()`, `saveEvidence()`, `signEvidenceUrl()`, company shift settings.
- Dev 2 provides: `getObservedCount()` (in `counts/service.ts`), worker config (`GET /internal/v1/monitoring/config`), and active zone geometry.
