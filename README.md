# DBI Intelligence — AI Cargo & Shipment Security

Multi-company AI-assisted cargo monitoring for warehouses, logistics hubs and loading bays.
It uses existing CCTV (RTSP) to detect and track visible packages, count line crossings,
record loading/unloading activity and compare observed counts with expected shipment counts.
AI output is an operational signal for a human to review; it never asserts theft or loss.

The product requirements are in the "AI Cargo & Shipment Security" specification (v1.0).

## Status

The repository was started from a shop-shutter security product and is being converted.
Done so far: the connector app, browser push, closed-hours schedule/security-state stack and the
theft person detector were removed. Still the old model: shops (not companies/sites), shutter
zones (no counting line), shutter-style event types. The cargo domain (count ledger, manifests,
loading sessions, reports) and the cargo detector/tracker are not built yet.
The AI worker is heartbeat-only and reports DEGRADED.

## Layout (npm workspaces)

| Folder | What |
|---|---|
| apps/owner | Owner web panel (Next.js, :3000) |
| apps/superadmin | Super admin panel (Next.js, :3001) |
| apps/backend | REST API (Express + TypeScript + MongoDB, :4000) |
| apps/ai-worker | Python worker (heartbeat only for now) |
| packages/api-types | `@dbi/api-types` shared contract types |
| packages/validation | `@dbi/validation` zod schemas |
| packages/ui | `@dbi/ui` design tokens |
| infra | docker-compose (local MongoDB, optional Redis) |
| docs | security notes (API docs to be rewritten for cargo) |

## Run

    npm install                      # once, from the repo root

    # env files (copy the examples and fill in real values, never commit them)
    cp apps/backend/.env.example apps/backend/.env
    cp apps/owner/.env.example apps/owner/.env.local
    cp apps/superadmin/.env.example apps/superadmin/.env.local
    cp apps/ai-worker/.env.example apps/ai-worker/.env

    npm run dev:backend
    npm run dev:owner
    npm run dev:superadmin
    npm run typecheck
    npm test                         # owner unit tests

The backend needs `MONGODB_URI`, `JWT_ACCESS_SECRET`, `CAMERA_SECRET_ENCRYPTION_KEY` and
`AI_SERVICE_TOKEN`. The AI worker must use the same `AI_SERVICE_TOKEN`.

## Rules

- Never commit secrets. Camera credentials are encrypted at rest and never returned by the API.
- All seed/mock data must be marked DEMO.
- Never show live protection when a camera or the AI worker is offline.
- Labels stay conservative; no face recognition.
