# DBI Intelligence

Web-first SaaS that monitors a shop shutter/gate during scheduled closed hours using the
owner existing CCTV (RTSP). Owner panel, Super Admin panel, one common API, one AI worker.

## Layout (npm workspaces)

| Folder | What | Owner |
|---|---|---|
| apps/owner | Shop owner panel (Next.js, :3000) | Dev 1 |
| apps/superadmin | Super admin panel (Next.js, :3001) | Dev 2 |
| apps/backend | Common REST API (Express + TS + MongoDB, :4000) | Dev 3 core; modules/owner Dev 1; modules/superadmin Dev 2 |
| apps/ai-worker | Python + OpenCV worker (stub for now) | Dev 3 |
| packages/api-types | `@dbi/api-types` API contract types | Dev 3 |
| packages/ui | `@dbi/ui` design tokens and shared UI | shared |
| packages/validation | `@dbi/validation` zod schemas | Dev 3 |
| infra | docker-compose (MongoDB, optional Redis) | Dev 3 |
| docs | API contract, QA, per-dev known gaps | Dev 3 |

## Run

    # once, from the repo root
    npm install

    # database
    docker compose -f infra/docker-compose.yml up -d mongo

    # env files
    cp apps/backend/.env.example apps/backend/.env
    cp apps/owner/.env.example apps/owner/.env.local
    cp apps/superadmin/.env.example apps/superadmin/.env.local

    npm run dev:backend
    npm run dev:owner
    npm run dev:superadmin
    npm run typecheck

ai-worker: see apps/ai-worker (Python, separate venv).

## Branches

feature/owner-panel (Dev 1), feature/admin-panel (Dev 2), feature/core-api-ai (Dev 3).
Merge into an integration branch before the Day 1 freeze.

## Rules

- Edit only your own folders. Shared packages change by agreement with Dev 3.
- All seed/mock data must be marked DEMO.
- Never commit secrets. Never show live protection when camera or AI worker is offline.
- If package-lock.json conflicts, take main version and re-run `npm install`.
