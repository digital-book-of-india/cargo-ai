# Dev 1 Context and Work Log (Platform, Workflow & Admin)

> Single source of truth for Dev 1. **Update this file at the end of every task.**
> Last updated: 2026-10-26

## 1. Project in one paragraph

DBI Intelligence is a multi-company AI cargo and shipment security product for warehouses, logistics hubs and
loading bays. It reads the customer's existing CCTV (RTSP), detects and tracks visible packages, counts line
crossings (in/out), records loading/unloading, and compares observed counts with a manifest. Output is
operator-reviewable events (camera, zone, time, snapshot, optional clip). AI output is a signal for a human to
review; it must never claim theft, tampering or loss as fact. Source: "AI Cargo & Shipment Security, Product
Requirements v1.0" (25 Oct 2026).

## 2. Working rules

- **One branch for everyone: `feature/development`.** Do not create other branches.
- Push flow: `git add <your files>` -> `git commit` -> `git pull origin feature/development --rebase` -> `git push origin feature/development`.
- Small commits, one task per commit, typecheck and tests green before every push.
- Edit only your own areas (section 5). Shared packages change by agreement (see "Shared packages").
- Never commit secrets. `.env` files are gitignored; use the `.env.example` templates.
- All seed/mock data must be marked DEMO.
- Never show live protection when a camera or the AI worker is offline.
- Labels stay conservative ("possible ..."); no face recognition; never claim theft.
- Deny by default. The company comes from the signed-in user's membership, **never** from a request body.

## 3. Roles of the two devs

| | Dev 1 (this file) | Dev 2 |
|---|---|---|
| Focus | Platform, workflow and admin | Vision, zones and counting |
| Owns | tenancy, users, sites, cameras (record), events and review, notifications, manifests, sessions, reports, audit, evidence storage, settings, superadmin, CI/deploy | zones, AI worker, ingestion, count ledger, monitoring and health, live view, dashboard, accuracy and pilot |

## 4. Contracts between Dev 1 and Dev 2 (frozen; change only by agreement)

| # | Contract | Implemented by | Used by |
|---|---|---|---|
| 1 | Auth and tenancy: `guard(permission)`, `requireSiteAccess`, `requireCameraAccess`, roles and permissions | Dev 1 | Dev 2 |
| 2 | `createCargoEvent(input)`: persist an event, write history, notify | Dev 1 | Dev 2 (ingestion, offline events) |
| 3 | `getObservedCount(companyId, zoneId, from, to)`: net counts from the ledger | Dev 2 | Dev 1 (reconciliation) |
| 4 | `saveEvidence()` and `signEvidenceUrl()`: private storage, expiring links | Dev 1 | Dev 2 (worker upload) |
| 5 | Worker config endpoint: camera stream, zones, rules, enabled flag | Dev 2 | the AI worker |
| 6 | `CargoEventInput` shape, 11 event types, severity | Dev 1 | Dev 2 |
| 7 | Shift definitions (company settings) used by `counts/summary` | Dev 1 | Dev 2 |

Until the other side is ready, code against a stub with the same signature.

Collection ownership. Dev 1: Company, CompanyMember, Invitation, Site, Camera, Event, EventHistory, EventNote,
Notification, AuditLog, Manifest, Vehicle, LoadingSession, CompanySettings. Dev 2: Zone, CountLedger,
MonitoringState, AiWorkerHealth.

Shared packages: `packages/api-types` and `packages/validation` are split into one file per domain.
Dev 1: `tenancy.ts`, `events.ts`, `cargo.ts`. Dev 2: `zones.ts`, `counts.ts`, `monitoring.ts`.
(Today they are still single `index.ts` files; split them when the first Dev 2 change lands.)

## 5. My folders (Dev 1)

```
apps/backend/src/middleware/          auth, tenant, errors, rate limits
apps/backend/src/models/              Company, CompanyMember, Invitation, Site, Camera, Event*, Notification, AuditLog, Manifest, Vehicle, LoadingSession, CompanySettings
apps/backend/src/modules/             auth, company, sites, users, owner/cameras, owner/events, owner/notifications, manifests, loading-sessions, reports, audit-logs, superadmin
apps/backend/src/services/            authz, tenancy, audit, evidence, notifications, reconciliation
apps/backend/src/jobs/                retention, notification retry
apps/backend/src/seeds/
apps/owner/                           owner web panel (everything except zones and live view and dashboard)
apps/superadmin/                      superadmin panel
docs/  CI/deploy files
```

Dev 2 owns: `modules/zones`, `modules/counts`, `modules/monitoring`, `modules/internal/ai-events`, `apps/ai-worker`,
and the owner panel's zone editor, live monitoring and dashboard.

## 6. Decisions already made

1. **Database: MongoDB (Atlas).** The spec's Postgres DDL is a logical reference; translate it to Mongo collections.
   Database name `cargo_ai`. Connection string lives only in `apps/backend/.env` (never committed).
2. **Company layer is required** (company -> sites -> zones/cameras). Shop becomes Site.
3. **Routes follow the spec** (`/api/v1/sites`, `/zones`, `/events`, ...).
4. **Self-signup creates a company** and makes the registrant its Company Owner. Invitations return a one-time
   token (no email service yet; email delivery is Phase 2).
5. **Roles:** system role on the user (`PLATFORM_ADMIN` / `USER`) plus company roles on the membership
   (`COMPANY_OWNER`, `COMPANY_ADMIN`, `WAREHOUSE_MANAGER`, `SECURITY_OPERATOR`, `AUDITOR`).
6. Owners and admins see all sites; other roles only their assigned sites (none assigned = none visible).
7. Only an owner can grant or change ownership; the last owner cannot be demoted or disabled.
8. The old weekly schedule/security-state engine is gone for good. Only a per-zone after-hours window is needed.
9. Audit log keeps `targetType/targetId` (spec's resource_type/resource_id) and adds `companyId` and `metadata`.

## 7. Open questions (need product / customer input)

1. Which package classes can be detected, and is annotated footage available? (Dev 2's critical path)
2. Live view: stream relay (MediaMTX/go2rtc) or snapshots only for the MVP?
3. How is the observed count derived for inbound vs outbound sessions (OUT only, or OUT minus IN)?
4. Mismatch tolerance and where it is configured (company setting vs per session).
5. Evidence and event retention period, and who may view/export clips.
6. Manifest source: manual only, CSV, or WMS/TMS?
7. Pilot accuracy and count-error thresholds per camera and zone.
8. Subscriptions/entitlements: skipped (no billing in this codebase); confirm with the product owner.

## 7a. Strategy (phases)

Rule for every phase: the repo must be **green at the end** (`npm run typecheck`, `npm test`, backend tests,
owner `next build`) before the phase is committed and pushed. Never push a phase that does not compile.

| Phase | Name | Effort | Delivers to Dev 2 | Depends on |
|---|---|---|---|---|
| P0 | Cleanup of the inherited product | done | n/a | n/a |
| P1 | Tenancy foundation (backend) | ~9 d | contract 1 | P0 |
| P2 | Events core, evidence and platform standards (backend) | ~14 d | contracts 2, 4, 6 | P1 |
| P3 | Company settings and panel migration | ~9 d | contract 7 | P1, P2 |
| P4 | Event inbox, notifications, accessibility | ~7 d | first end-to-end view | P2, P3 |
| P5 | Manifests, vehicles, loading sessions, reconciliation | ~7 d | consumes contract 3 | P2, P3 |
| P6 | Reports, audit trail, superadmin | ~8.5 d | n/a | P2, P3 |
| P7 | Observability, delivery, docs, hardening | ~9 d | joint integration tests | all |

### P1 Tenancy foundation (backend)
Goal: every request is company-scoped and role-checked; the repo compiles on the new Company/Site model.
- Finish what is already written (types, models, permissions, middleware, auth, company, sites).
- Users and invitations, `PATCH role`, member status, last-owner rule, `GET /me`.
- Camera registration under a site, `GET /cameras`, `POST /cameras/:id/assign-site`.
- Move events, notifications, evidence, internal AI routes and superadmin routes to company/site.
- Mechanical rename in both panels and mocks only so `typecheck` and `next build` stay green (real screens are P3).
- New seed (six roles, site, camera, zone, DEMO). Wire `app.ts`; delete old shop routes.
- Integration tests on a **separate test database**: QA-01, QA-02, invitation, last owner, site assignment.
Exit: typecheck + all tests green; backend boots; register -> create site -> invite -> accept works via HTTP.
Hand-off: tell Dev 2 contract 1 is ready (`guard`, `requireSiteAccess`, `requireCameraAccess`, permissions).

### P2 Events core, evidence and platform standards (backend)
Goal: events can be created, reviewed and stored safely; every route follows one convention.
- Event model (11 types, severity, status, summary, payload, eventKey) with unique `(companyId, eventKey)`.
- Transition map, history, notes, assign; acknowledge, resolve (5 outcomes), false-positive, reopen.
- `createCargoEvent()` service (idempotent) and `GET /events` with filters and cursor.
- Evidence service: private object storage (local adapter + S3/GCS adapter), `saveEvidence()`, `signEvidenceUrl()`,
  expired link denied. Retention job skeleton.
- Standards: migrations with rollback, `{data, meta:{requestId}}`, full error codes, body limit, page caps,
  rate limits (login, imports, exports).
Exit: QA-08 and QA-09 pass as tests; idempotent `createCargoEvent` test (same key twice = one event).
Hand-off: contracts 2, 4, 6 (event input shape, event types, severity) published; Dev 2 swaps stubs for real.

### P3 Company settings and panel migration
Goal: a user can do the whole setup in the browser.
- CompanySettings model and endpoints (tolerance, retention, default confidence, shifts, timezone).
- Owner panel: register with company, memberships, Sites screen, Users & Roles screen, Cameras list with site
  assignment, Settings screen; permission-denied, empty, error and offline states.
- Superadmin panel moved to companies and sites (read-only lists first).
- Decide mocks: delete the owner mock layer or rebuild it on the new model.
Exit: in a real browser (mocks off): register, create a site, invite and accept, assign a camera, change a role.
Hand-off: contract 7 (shifts) published.

### P4 Event inbox, notifications, accessibility
Goal: an operator can review an event end to end.
- Inbox UI (filters, evidence, notes, assignment, resolve, false positive) and event detail.
- In-app notifications by role and site; retry with backoff and dead-letter handling (jobs).
- Keyboard-usable review, clear severity and status labels.
Exit: with a seeded event: acknowledge -> in review -> resolve works in the browser and writes history.
Milestone M4: first end-to-end with Dev 2 (ingestion creates an event, it appears in the inbox).

### P5 Manifests, vehicles, loading sessions, reconciliation
Goal: expected vs observed count with a review-required mismatch event.
- Manifest CRUD, vehicle registry, CSV import (row-level errors, no partial writes, idempotent) (QA-10).
- Sessions create/list/get/close; reconciliation through `getObservedCount` (stub until Dev 2 delivers).
- Mismatch event via `createCargoEvent`; UI for manifests and sessions.
Exit: manifest 100 / observed 94 gives difference -6 and `review_required` (QA-07), tolerance respected.

### P6 Reports, audit trail, superadmin
Goal: managers and auditors can report, and admins can supervise.
- Reports (cargo activity, mismatches) with filters, site timezone (QA-11), coverage-gap marking (QA-06).
- Audited CSV export; `GET /audit-logs` and the audit trail UI.
- Superadmin: company suspend/activate with reason and audit, audited support access to evidence.
Exit: export respects the same access rules as the event list; role changes and exports appear in the audit log.

### P7 Observability, delivery, docs, hardening
Goal: pilot-ready.
- Structured logs, metrics endpoint, CI, Dockerfiles, health checks, backups with tested restore, rollback plan.
- OpenAPI, README, QA checklist, security notes, production env documentation.
- Joint integration tests with Dev 2; security review (tenant isolation, secrets, rate limits).
Exit: Definition of Done in the requirements PDF section 16, for Dev 1's areas.

### Working loop for every task
1. Read this file and the code around the task. 2. Implement (small commits). 3. Add or update tests.
4. `npm run typecheck`, `npm test`, backend tests. 5. Manual check (HTTP or browser). 6. Update this file
(checklist, state, log). 7. `git pull --rebase`, `git push origin feature/development`.

### Cut order if time runs short
Cut first: accessibility polish beyond keyboard use, metrics endpoint, audited support-access workflow, CSV import
(manual manifests still work). Never cut: tenant isolation and role checks, audit of sensitive actions,
idempotency, loading/empty/error/permission states, DEMO labels, secret handling, evidence privacy.

### Risks
- Mid-migration the repo does not compile (P1): do P1 in one sitting, commit only when green.
- Dev 2 blocked on contracts: publish contracts 1, 2, 4, 6 at the end of P1 and P2 and keep stubs in the meantime.
- Reconciliation needs the ledger: stub `getObservedCount` first.
- Object storage credentials are not available yet: ship a local adapter behind the same interface.

## 8. Requirements checklist (Dev 1)

Legend: [x] done and pushed, [~] started, not pushed or not compiling, [ ] not started.
Effort figures are rough estimates in person-days.

### 8.1 Foundation backend (8 d)
- [~] Shared types and validation for company, site, membership, invitation (written, uncommitted)
- [~] Models: Company, CompanyMember, Invitation, Site; company/site fields on Camera, Zone, Event, Notification, AuditLog (written, uncommitted)
- [~] Permission rules (`services/authz/permissions.ts`) with 11 unit tests passing (uncommitted)
- [~] Tenant middleware: `resolveTenant`, `guard`, `requireSiteAccess`, `requireCameraAccess` (uncommitted)
- [~] Auth routes: register creates company + owner membership, login/me return memberships, accept-invitation (uncommitted)
- [~] `GET/PATCH /company`, sites CRUD with archive (uncommitted)
- [ ] `GET /me` (spec path), `GET /cameras` (company-wide, permitted sites)
- [ ] Users: `GET /users`, `POST /users/invitations`, `PATCH /users/:id/role`, member status, last-owner rule
- [ ] `POST /cameras/:id/assign-site`; camera registration scoped to a site and company
- [ ] Migrate events, notifications, evidence, internal AI routes, superadmin routes to company/site
- [ ] Wire everything in `app.ts`; delete the old `modules/owner/shops`
- [ ] New seed: demo company with all six roles, site, camera, zone (DEMO)
- [ ] Tenant-isolation tests (QA-01, QA-02) against a test database

### 8.2 Platform standards (4 d)
- [ ] Versioned DB migrations with rollback
- [ ] `{data, meta:{requestId}}` envelope; full error-code list (400, 401, 403, 404, 409, 413, 422, 429, 500, 503)
- [ ] Request body size limit (413) and page-size caps everywhere
- [ ] Rate limits: login, CSV import, report export

### 8.3 Panels: site/company migration (6 d)
- [ ] Owner: register with company, login with memberships, active company handling
- [ ] Sites screen (list/create/edit/archive), Users & Roles screen (invite, role, site assignment, deactivate)
- [ ] Cameras list with site assignment
- [ ] Rename shop -> site across both panels and the mock layer
- [ ] Permission-denied and offline states

### 8.4 Event workflow backend (5 d)
- [ ] Event model: 11 types, severity, status, summary, payload, eventKey
- [ ] Transition map (open -> acknowledged -> in_review -> resolved; false_positive; escalated) validated server-side
- [ ] History and notes collections; every transition audited
- [ ] Endpoints: acknowledge, assign, notes, resolve (5 outcomes), false-positive, reopen (permissioned)
- [ ] `GET /events` with filters and cursor; `GET /events/:id`
- [ ] `createCargoEvent()` contract (section 4)

### 8.5 Event inbox, notifications, accessibility (7 d)
- [ ] Inbox UI: filters, evidence, notes, assignment, resolution
- [ ] In-app notifications by role
- [ ] Notification retry with backoff and dead-letter handling
- [ ] Keyboard-usable review, clear severity labels

### 8.6 Manifests and loading sessions (7 d)
- [ ] Manifest CRUD, vehicle registry
- [ ] CSV import with row-level errors, no partial corruption, idempotent (QA-10)
- [ ] Sessions: create, list, get, close
- [ ] Reconciliation via `getObservedCount`, tolerance setting, review-required `count_mismatch` event (QA-07)
- [ ] Manifests and Sessions UI

### 8.7 Reports and audit (5.5 d)
- [ ] `reports/cargo-activity`, `reports/mismatches`, `reports/events/export` (audited CSV)
- [ ] Filters: site, camera, zone, date, shift, event type; site timezone (QA-11)
- [ ] Mark camera-offline coverage gaps (QA-06)
- [ ] `GET /audit-logs` and the audit trail UI

### 8.8 Superadmin (3 d)
- [ ] Companies list; suspend/activate with reason and audit
- [ ] Sites overview and KPIs
- [ ] Audited support access to evidence

### 8.9 Evidence storage and retention (5 d)
- [ ] Private object storage (S3/GCS), signed expiring URLs, expired link denied (QA-09)
- [ ] `saveEvidence()` / `signEvidenceUrl()` contract
- [ ] Retention job (`CARGO_EVENT_RETENTION_DAYS`); audit of evidence access

### 8.10 Company settings (3 d)
- [ ] CompanySettings model and Settings screen: mismatch tolerance, retention, default confidence, shifts, timezone, notification rules

### 8.11 Observability and delivery (6 d)
- [ ] Structured logs, request IDs, metrics endpoint (API errors, event lag, queue depth)
- [ ] CI (typecheck, tests, build), Dockerfiles, health checks
- [ ] Backups and tested restore, rollback plan, production env documentation

### 8.12 Docs (3 d)
- [ ] OpenAPI, README, QA checklist, security notes
- [ ] Remove or rebuild the owner mock layer

## 9. Current state (2026-10-26)

- `feature/development` on GitHub holds 9 cleanup commits on top of the original code (connector app, browser push,
  schedule/security-state stack, theft detector, old docs and notification preferences removed; README rewritten;
  `apps/backend/.env.example` added). Typecheck and the 10 owner tests pass on that state.
- `main` is still the original code. `cargo/cleanup` is a duplicate of `feature/development` and can be deleted.
- Step 6 (foundation, section 8.1) is **partly written and uncommitted**; the backend does not compile until the
  remaining routes and frontends are migrated. Commit it only when `npm run typecheck` is green.
- Still the old model: shops/shutter zones, old event types and review statuses, owner mock layer, old panel wording.
- The AI worker is heartbeat-only and reports DEGRADED (Dev 2 replaces it).

## 10. Commands

```
npm install                 # from repo root, once
npm run dev:backend         # http://localhost:4000
npm run dev:owner           # http://localhost:3000
npm run dev:superadmin      # http://localhost:3001
npm run typecheck           # all workspaces
npm test                    # owner unit tests
npm test -w @dbi/backend    # backend unit tests (permissions)
```

Env files (gitignored): `apps/backend/.env`, `apps/owner/.env.local`, `apps/superadmin/.env.local`,
`apps/ai-worker/.env`. Backend needs `MONGODB_URI`, `JWT_ACCESS_SECRET`, `CAMERA_SECRET_ENCRYPTION_KEY`,
`AI_SERVICE_TOKEN` (the worker must use the same token).

## 11. Known issues and notes

- Never run `next build` while `next dev` is running in the same app folder; use
  `NEXT_DIST_DIR=.next-verify npx next build` and revert any `tsconfig.json` change Next makes.
- Many source files use Windows (CRLF) line endings; scripted edits must handle `\r\n`.
- `next@14.2.15` has a known vulnerability; upgrade to a patched 14.2.x before deployment.
- The backend rate limiter is in memory; it does not work across multiple instances (needs Redis).
- Standalone MongoDB has no multi-document transactions; multi-step writes use compensating deletes.

## 12. Work log

| Date | Work | Verified |
|---|---|---|
| 2026-10-26 | Reviewed the requirements PDF and the inherited code; wrote the gap analysis and the Dev 1 / Dev 2 split | n/a |
| 2026-10-26 | Created env files for all apps (own secrets, new Atlas database `cargo_ai`); installed dependencies | Atlas connection OK, typecheck |
| 2026-10-26 | Cleanup: removed connector, browser push, schedule/security-state, theft detector, old docs, notification preferences; rewrote README; added backend `.env.example`; pushed to `feature/development` | typecheck, 10 owner tests, owner `next build` |
| 2026-10-26 | Started Step 6 foundation (types, models, permissions + 11 tests, tenant middleware, auth, company, sites). Uncommitted | permissions tests only |
