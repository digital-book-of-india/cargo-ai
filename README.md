# DBI Intelligence: AI Cargo & Shipment Security

Multi-company AI-assisted cargo monitoring for warehouses, logistics hubs and loading bays.
It uses existing CCTV (RTSP) to detect and track visible packages, count line crossings,
record loading/unloading activity and compare observed counts with expected shipment counts.
AI output is an operational signal for a person to review; it never asserts theft or loss.

The product requirements are in the "AI Cargo & Shipment Security" specification (v1.0).

## Status

| Area | State |
|---|---|
| Companies, sites, users, roles, invitations, tenant isolation | Done |
| Events: ingestion contract, review workflow, evidence (private, signed links), retention | Done |
| Settings (tolerance, retention, shifts, notification rules) | Done |
| Alerts inbox, notifications with retry and dead-letter | Done |
| Manifests (manual + CSV import), vehicles, loading sessions, reconciliation | Done |
| Reports (time-zone and shift aware, coverage gaps), CSV export, audit trail | Done |
| Super admin: companies, sites, health, audit, suspend/activate, audited support access | Done |
| Logging, metrics, health probes, backup/restore, CI, Docker files, OpenAPI | Done (Docker files not yet built, see docs/runbook.md) |
| Zones with counting lines, AI detector/tracker, count ledger, live view, dashboard, pilot | Separate work stream (the AI pipeline); the API has stubs and contracts ready |

The AI worker is heartbeat-only for now and reports DEGRADED. Until the counting service exists, loading
sessions close as "not verified"; no count is ever invented.

## Layout (npm workspaces)

| Folder | What |
|---|---|
| apps/backend | REST API (Express, TypeScript, MongoDB) on :4000 |
| apps/owner | Owner web panel (Next.js) on :3000 |
| apps/superadmin | Super admin panel (Next.js) on :3001 |
| apps/ai-worker | Python worker (heartbeat only for now) |
| packages/api-types | Shared types and the role/permission table |
| packages/validation | Shared zod schemas |
| packages/ui | Design tokens |
| infra | Local MongoDB, production compose file, Dockerfiles |
| docs | OpenAPI, runbook, production env, QA checklist, security notes |

## Run locally

    npm install                      # once, from the repo root

    # env files (copy the examples and fill in real values; never commit them)
    cp apps/backend/.env.example apps/backend/.env
    cp apps/owner/.env.example apps/owner/.env.local
    cp apps/superadmin/.env.example apps/superadmin/.env.local

    npm run migrate -w @dbi/backend  # creates the indexes
    npm run seed -w @dbi/backend     # optional: DEMO companies, sites and logins (never in production)

    npm run dev:backend
    npm run dev:owner
    npm run dev:superadmin

The backend needs `MONGODB_URI`. Outside production the three secrets have development defaults; in
production the server refuses to start without `JWT_ACCESS_SECRET`, `AI_SERVICE_TOKEN` and
`CAMERA_SECRET_ENCRYPTION_KEY`. The AI worker must use the same `AI_SERVICE_TOKEN`.

## Test

    npm run typecheck                          # all workspaces
    npm test                                   # owner unit tests
    npm test -w @dbi/backend                   # backend unit tests
    npm run test:int -w @dbi/backend           # backend integration tests (need MongoDB)

Integration tests run against a separate throw-away database whose name ends in `_test`
(`cargo_ai_test`, derived from `MONGODB_URI`, or set `MONGODB_URI_TEST`). They drop it afterwards and can
never touch the real data. CI (`.github/workflows/ci.yml`) runs all of the above plus the production builds.

## Operate

| Need | Where |
|---|---|
| Deploy, back up, restore, roll back, alerts | [docs/runbook.md](docs/runbook.md) |
| Every environment variable, go-live checklist | [docs/production-env.md](docs/production-env.md) |
| API reference | [docs/openapi.yaml](docs/openapi.yaml) (a test keeps it in sync with the routes) |
| What is checked and how | [docs/qa-checklist.md](docs/qa-checklist.md) |
| Security model and review findings | [docs/security-and-privacy.md](docs/security-and-privacy.md) |
| Project plan, contracts, decisions, open questions | [CONTEXT_DEV1.md](CONTEXT_DEV1.md) |

Production build of the API: `npm run build -w @dbi/backend` bundles `dist/` (the shared packages are
TypeScript source, so `tsc` output alone cannot run). `npm start -w @dbi/backend` runs it.
Metrics for a monitoring system: `GET /internal/v1/metrics` with the service token. Probes: `/health`, `/health/ready`.

## Rules

- Never commit secrets. Camera credentials are encrypted at rest and never returned by the API.
- All data is real data in the database. Seed rows are real records marked DEMO. No mock data paths.
- Never show live protection when a camera or the AI worker is not reporting.
- Labels stay conservative; no face recognition.
