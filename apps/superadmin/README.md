# DBI Intelligence - Super Admin web

Next.js + TypeScript + Tailwind. Runs on port 3001. For platform administrators only (a real user whose role is
`PLATFORM_ADMIN`; there is no mock login).

## Setup

    cp .env.example .env.local   # run from this folder
    npm install
    npm run dev

## Screens

Overview (KPIs), Companies (suspend / reactivate with a mandatory reason), Sites, Camera health, Audit trail (all companies).

Admin APIs live under `/api/v1/admin` in the common backend (`apps/backend/src/modules/superadmin`). Audited support access
to a company's evidence is `POST /api/v1/admin/support/evidence-link` (reason of 10+ characters; short link; written to the
company's own audit trail). It has no screen yet. See `docs/openapi.yaml`.
