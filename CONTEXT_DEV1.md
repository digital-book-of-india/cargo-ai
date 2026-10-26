# Dev 1 Context and Work Log (Platform, Workflow & Admin)

> Single source of truth for Dev 1. **Update this file at the end of every task.**
> Last updated: 2026-10-26 (P1, P2 and P3 code complete and verified, not committed)

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
- **Do not stage, commit or push without asking the repo owner first.** Do not use `git add`, `git rm`, `git mv`,
  `git commit` or `git push` on your own initiative.
- **No mock data.** Every screen and test reads the real backend and database. Seed rows are real database records
  marked DEMO; tests use a separate throw-away database (`cargo_ai_test`), never `cargo_ai`.
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
3. How is the observed count derived for inbound vs outbound sessions (OUT only, or OUT minus IN)? **Decided: each direction is counted separately and never subtracted.** An outbound session's observed count is the OUT crossings, an inbound session's is the IN crossings; the other direction is stored in the session's `countsBreakdown` for the reviewer. Only `observedForSession` in `services/counts/observed.ts` decides this.
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

### 8.1 Foundation backend (8 d)  [done in P1, uncommitted]
- [x] Shared types and validation for company, site, membership, invitation
- [x] Models: Company, CompanyMember, Invitation, Site; company/site fields on Camera, Zone, Event, Notification, AuditLog
- [x] Permission rules (`services/authz/permissions.ts`) with 11 unit tests
- [x] Tenant middleware: `resolveTenant`, `guard`, `requireSiteAccess`, `requireCameraAccess`
- [x] Auth: register creates company + owner membership, login/me return memberships, `accept-invitation`, `GET /me`
- [x] `GET/PATCH /company`, sites CRUD with archive
- [x] Users: `GET /users`, `POST /users/invitations`, `PATCH /users/:id/role`, `PATCH /users/:id/status`, last-owner rule
- [x] `GET /cameras` (permitted sites), cameras registered under a site, `POST /cameras/:id/assign-site`
- [x] Events, notifications, internal AI ingest/cameras, superadmin (companies, sites, overview, health, audit) moved to company/site
- [x] `app.ts` wired; old shop routes deleted; `x-company-id` header allowed in CORS
- [x] New seed: demo company with all six roles, two sites, camera, zone, events, plus a second company (DEMO rows; NOT run against Atlas yet)
- [x] 34 integration tests on a throw-away database (`npm run test:int -w @dbi/backend`): QA-01, QA-02, site assignment,
      invitations, last owner, disabled member, suspended company, camera secrecy, AI ingestion tenancy and idempotency

### 8.2 Platform standards (4 d)  [done in P2, uncommitted]
- [x] Versioned DB migrations with rollback: `npm run migrate | migrate:down | migrate:status` (index creation; archive of old-product collections as `legacy_*`, reversible)
- [x] `{data, meta:{requestId}}` on every success response; error codes per Appendix B (400, 401, 403, 404, 409, 413, 422, 429, 500, 503); unknown routes return a JSON 404
- [x] Request body limit (413) and page-size caps (events max 100, cursor paging; sites/cameras/users hard-capped)
- [x] Rate limiters: login and accept-invitation (existing), camera test/assign-site, ingestion; import and export limiters exist and are applied when those endpoints are built (P5, P6)
- [x] Production refuses to start without JWT, AI service and camera-secret keys; indexes are built by migrations, not on start

### 8.3 Panels: site/company migration (6 d)  [done in P3, uncommitted]
- [x] Owner: register with company name; the session keeps the user's company role (`useAuth().can / canAtSite`), using the same permission rules as the API (they now live in `@dbi/api-types/permissions.ts`)
- [x] Sites screen (`/sites`): list, show archived, add, deactivate / reactivate, archive (the API refuses while cameras or zones remain, and the message is shown)
- [x] Users and roles screen (`/users`): people with role and sites, invite (role and site assignment, one-time link shown with a copy button), change role/sites, turn access off/on; roles offered are only the ones the signed-in person may grant
- [x] Invitation acceptance page (`/accept-invitation?token=`): works for new people and for an existing account (password must match), also when someone else is signed in
- [x] Cameras: controls shown only to roles that may use them, move a camera to another site, honest status (stale = not online; the test only proves the address was reachable, so no "sending video" claim)
- [x] Site profile read-only for roles that cannot edit; zone editor and add-site screens show a permission-denied state instead of failing
- [x] Navigation: Sites and Users and roles (only for roles that may read users)
- [x] Wording: old shutter/shop text removed from the panel (the zone editor still uses the old zone types until the zone model is replaced by Dev 2)
- [x] Mock layer removed earlier (no mock data anywhere)

### 8.4 Event workflow backend (5 d)  [done in P2, uncommitted]
- [x] Event model `cargo_events`: 11 types, severity, summary, payload, unique (companyId, eventKey); history and notes collections
- [x] Transition map (server side): open -> acknowledged -> in_review -> resolved; false_positive and escalated from the working states; reopen only for resolved and only with `events:reopen` (owner, admin, manager)
- [x] Endpoints: list (filters status/type/severity/camera/site/from/to, cursor), detail with history and notes, acknowledge, assign, notes, resolve (5 outcomes), false-positive, reopen. Every change writes history and an audit entry; concurrent changes get 409
- [x] `createCargoEvent()` (contract 2): derives the company from the site, checks camera/zone ownership, idempotent by eventKey (safe under concurrent retries), rejects payloads with credentials/tokens, notifies reviewers
- [x] Ingestion stopgap: `POST /api/v1/ai/events` and `/internal/v1/ai/events` (service token, Appendix A schema, Idempotency-Key checked). The count ledger is the AI-pipeline work (Dev 2)

### 8.5 Event inbox, notifications, accessibility (7 d)  [done in P4, uncommitted]
- [x] Inbox UI: company-wide and per-site, filters (status, severity, type, assigned to me, date range), evidence, notes, assignment, resolution
- [x] In-app notifications by role (only people who may review the event at that site), unread badge, mark read / mark all
- [x] Notification retry with backoff and dead-letter handling (5 attempts, 1 min / 5 min / 30 min / 2 h, then FAILED)
- [x] Keyboard-usable review, clear severity labels (checked in code and tests; no automated accessibility audit yet, see P7)

### 8.6 Manifests and loading sessions (7 d)  [done in P5, uncommitted]
- [x] Manifest CRUD (create, list, get, update, cancel), vehicle registry
- [x] CSV import with row-level errors, all-or-nothing by default (`allowPartial` opt-in), idempotent by file hash (QA-10)
- [x] Sessions: create, list, get, close
- [x] Reconciliation via `getObservedCount`, tolerance setting, review-required `count_mismatch` event, one per session (QA-07: 100 expected, 94 seen = -6, needs review)
- [x] Shipments screen (Sessions, Manifests with CSV import, Vehicles)

### 8.7 Reports and audit (5.5 d)  [done in P6, uncommitted]
- [x] `reports/cargo-activity`, `reports/mismatches`, `reports/events/export` (audited CSV, 10,000 rows max, formulas neutralised, same site access as the event list)
- [x] Filters: site, camera, zone, date, shift, event type; days and shifts in each site's own time zone (QA-11)
- [x] Camera/AI outages marked as coverage gaps even when an event-type filter would hide them (QA-06)
- [x] `GET /audit-logs` (owners, admins, auditors; company only) and the Audit trail screen; Reports screen

### 8.8 Superadmin (3 d)  [done in P1/P6, uncommitted]
- [x] Companies list; suspend/activate with reason and audit (suspended members are locked out at once)
- [x] Sites overview and KPIs
- [x] Audited support access to evidence: `POST /admin/support/evidence-link` (reason of 10+ characters, 2-minute link, written to the owning company's audit trail). API only; no superadmin screen for it yet.

### 8.9 Evidence storage and retention (5 d)  [done in P2 with the local adapter, uncommitted]
- [x] Private storage behind an interface (`services/evidence/storage.ts`); local-disk adapter that writes to `apps/backend/uploads` (created automatically if missing, gitignored; change with `EVIDENCE_STORAGE_DIR`); S3/GCS adapter still to add (needs credentials)
- [x] Server-generated keys `company/site/yyyy/mm/uuid.ext`; upload endpoint `POST /internal/v1/evidence/upload` (service token) checks type, size and real file content; events may only reference keys that belong to their company and exist
- [x] Signed, expiring links (`EVIDENCE_SIGNED_URL_TTL_SECONDS`, default 300) issued only on the event detail view, bound to event, file kind and company; expired/tampered/wrong links refused (QA-09); every access audited; storage keys are never sent to the browser
- [x] `saveEvidence()` and `signEvidenceUrl()` (contract 4)
- [x] Retention job `npm run job:retention`: deletes evidence files older than `CARGO_EVENT_RETENTION_DAYS`, keeps the event and history. Per-company retention comes with company settings (P3)

### 8.10 Company settings (3 d)  [done in P3, uncommitted]
- [x] Model `company_settings` (one per company; unset fields fall back to platform defaults) and `getCompanySettings()` (contract 7: shifts)
- [x] `GET /company/settings` (every member) and `PATCH /company/settings` (owner, admin; audited with before and after): mismatch tolerance, evidence retention days (7 to 3650), default confidence, shifts (named, may cross midnight, no overlaps, at most 8), notification rules (minimum severity, muted event types; camera/AI health notices can never be muted and ignore the minimum)
- [x] The settings take effect: notification rules in `notifyReviewers`, retention days per company in the retention job
- [x] Settings screen: company name and time zone, operating settings with shift editor and notification rules; read-only for roles that cannot change them
- [ ] Mismatch tolerance is stored but only used by reconciliation in P5; shifts are only used by reports in P6

### 8.11 Observability and delivery (6 d)  [done in P7, uncommitted; Docker files not built]
- [x] Structured JSON logs with request id (no query strings, bodies or tokens), `GET /internal/v1/metrics` (service token; requests, 5xx, event lag, notification queue depth, open sessions, db state), `/health` and `/health/ready`, graceful shutdown
- [x] CI workflow (typecheck, unit + integration tests with MongoDB, builds, informational npm audit); Dockerfiles and `infra/docker-compose.prod.yml` written but NOT built (no Docker on the dev machine): first deploy must build them
- [x] `npm run backup` / `npm run restore` (checksummed, refuses damaged backups and non-empty targets), round trip tested; rollback plan and production env documented (`docs/runbook.md`, `docs/production-env.md`)
- [ ] A restore drill on the real environment and the S3/GCS evidence adapter (need infrastructure)

### 8.12 Docs (3 d)  [done in P7, uncommitted]
- [x] OpenAPI (`docs/openapi.yaml`, kept in sync by a test), README, QA checklist, security notes with the review findings
- [x] Mock layer removed from owner and superadmin (no mock data anywhere)

## 9. Current state (2026-10-26)

- `feature/development` on GitHub holds 9 cleanup commits (connector, browser push, schedule/security-state, theft
  detector, old docs, notification preferences removed; README rewritten). `main` is still the original code.
  `cargo/cleanup` is a duplicate of `feature/development` and can be deleted.
- Local commits not pushed: `CONTEXT_DEV1.md` (2 commits).
- **P1, P2 and P3 are code-complete but uncommitted** (nothing staged by choice of the repo owner; some `git rm`/`git mv`
  side effects from early work may be staged, check `git status`). Verified for P3: typecheck (all apps), owner tests 10,
  backend unit tests 35, backend integration tests 74, owner and superadmin `next build`, and a browser run of the new
  screens (sites, users and roles, invitation acceptance, settings, role-limited controls).
- The `cargo_ai` database was migrated and re-seeded after P2 (`npm run migrate`, `npm run seed`). P3 added the
  `company_settings` collection, which is created on first save; run `npm run migrate` after pulling to be safe.
- Evidence files are stored in `apps/backend/uploads` (created automatically, gitignored).
- **P4 and P5 are code-complete but uncommitted.** Verified: typecheck (all apps), backend unit tests 52, backend
  integration tests 110, owner tests 11, owner and superadmin `next build`, and an API run of the shipment flow against a
  real server and database (`cargo_ai_test`, dropped afterwards). **The P4/P5 screens were NOT checked in a browser**
  (the browser tool could not act on the page); do that before demo.
- Migration 003 creates the P5 indexes (001 is already recorded on existing databases, so it would skip them).
- P5 added collections `cargo_vehicles`, `cargo_manifests`, `cargo_import_jobs`, `cargo_loading_sessions`. Run
  `npm run migrate` after pulling so their indexes exist (the one-open-session-per-manifest rule is an index).
- Contract 3 (`services/counts/observed.ts`): until the counting service exists, the default reads the spec's
  `cargo_count_ledger` collection (companyId, zoneId or siteId, occurredAt, direction IN/OUT, countDelta). If that
  collection is missing, sessions close as `closed_unverified` and no number is invented. Dev 2: point
  `setObservedCountProvider` at the real service if the ledger differs.
- **P6 and P7 are code-complete but uncommitted.** Verified: typecheck (all apps), owner tests 12, backend unit tests 61,
  backend integration tests 138, owner and superadmin `next build`, and the built backend (`node dist/server.js`, production
  mode) run against a real database: JSON logs, `/health/ready`, metrics. The Reports, Audit trail and Shipments screens were
  NOT checked in a browser (the browser tool could not act on the page).
- P7 security review fixes (see `docs/security-and-privacy.md`): rate limits no longer trust a spoofed `X-Forwarded-For`
  (set `TRUST_PROXY` behind a proxy); the dev-only mock admin login was removed; localhost CORS only outside production;
  DNS servers opt-in; `npm start` was broken (shared packages are TypeScript) and the backend is now bundled with esbuild.
- Run `npm run migrate` after pulling (migration 003 creates the P5 indexes). Production needs `TRUST_PROXY` set.
- **Dev work is complete for the Dev 1 list.** Remaining: browser check of the new screens, building the Docker images, a real
  restore drill, object-storage adapter, a superadmin screen for support access, the deferred walkthrough items below, and
  joint integration testing with the AI pipeline once its counting service exists.
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

## Deferred items: fix after ALL phases are complete

The owner asked to collect these and work on them together once every phase is done. Do not fix them piecemeal unless a
phase needs it. Add new deferred items here.

### Browser walkthrough findings (P1, 2026-10-26, against a throw-away database)

Verified in Chrome: owner sign-in, site switcher, dashboard, alerts list, cameras page, site profile edit (duplicate code
rejected, rename persisted after reload), new site with validation, add-camera form blocks submit without consent,
operator sees only the assigned site and gets 403 on create site / list users, platform admin sees the "company panel"
notice, registration creates a new company that sees no other data, superadmin overview / companies (suspend and reactivate
with mandatory reason, company owner locked out while suspended) / sites / camera health / audit trail.

Open findings (deferred, see the heading above):
1. ~~**Owner panel shows a stale camera as "Online"**~~ FIXED in P3 (the API returns an effective status and the panel uses it) ("The camera is sending video") while the superadmin health page marks the
   same camera OFFLINE (stale). The owner panel must use the same effective-status rule. (P3/P4; also Dev 2 camera health)
2. ~~**UI is not permission-aware**~~ FIXED in P3 for cameras, sites, settings, users, zone editor: an operator still sees Add camera, Edit, Delete and Test buttons that the API refuses with 403.
   Hide or disable controls by role (P3).
3. PARTLY FIXED in P3 (the zone editor and its old zone types stay until Dev 2 replaces them). Old wording remained in the owner panel: "shutter", placeholder "Main Street Site", "A shutter zone was saved ... from this
   browser" (a localStorage marker, not the database), login page copy (P3).
4. The auth cookie `dbi_token` is set on host `localhost`, so the owner panel and the superadmin panel share it across ports
   in development; signing in to one replaces the other's session.
5. The seeded demo camera was marked ONLINE with a fake stream. Fixed in the seed (now PENDING_TEST, no frames); re-run the
   seed to refresh existing demo data.
6. Settings is now the new model (P3). The Notifications screen still shows the old layout (P4).

## 12. Work log

| Date | Work | Verified |
|---|---|---|
| 2026-10-26 | Reviewed the requirements PDF and the inherited code; wrote the gap analysis and the Dev 1 / Dev 2 split | n/a |
| 2026-10-26 | Created env files for all apps (own secrets, new Atlas database `cargo_ai`); installed dependencies | Atlas connection OK, typecheck |
| 2026-10-26 | Cleanup: removed connector, browser push, schedule/security-state, theft detector, old docs, notification preferences; rewrote README; added backend `.env.example`; pushed to `feature/development` | typecheck, 10 owner tests, owner `next build` |
| 2026-10-26 | Started Step 6 foundation (types, models, permissions + 11 tests, tenant middleware, auth, company, sites). Uncommitted | permissions tests only |
| 2026-10-26 | **P1 tenancy foundation**: users/invitations/roles/status, cameras under sites + assign-site, events/notifications/internal/superadmin moved to company/site, new seed, owner and superadmin panels renamed to company/site, all mock data removed, `serviceAuth` now compares tokens in constant time | typecheck, 10 owner + 11 backend unit + 34 backend integration tests, owner and superadmin `next build` |
| 2026-10-26 | P1 browser walkthrough in Chrome (own backend :4100, owner :3100, superadmin :3101, database `cargo_ai_test`, dropped afterwards); seed no longer fakes an ONLINE camera | see findings above |
| 2026-10-26 | **P2 events core, evidence and standards (backend)**: response envelope, error codes, body limit, rate limiters, migrations runner (2 migrations), cargo event model + history + notes, transition map, event workflow endpoints, `createCargoEvent()`, evidence storage/upload/signed links/audit, retention job, ingestion stopgap, seed events through `createCargoEvent`, owner Alerts screens moved to the new model | typecheck, 23 backend unit + 63 integration tests (QA-03, QA-08, QA-09), both `next build`, browser review flow |
| 2026-10-26 | **P3 company settings and panel migration**: shared permission rules, settings model/endpoints/audit, notification rules and per-company retention take effect, honest camera status in the API, Sites / Users and roles / Settings / invitation screens, role-aware controls, wording cleanup, evidence folder `uploads` | typecheck, 35 backend unit + 74 integration tests, owner 10 tests, both `next build`, browser run of the new screens |
| 2026-10-26 | **P4 event inbox and notifications**: notification dispatcher (atomic claim, retry with backoff, dead-letter, `job:notifications`), read state and unread count API, `assignedTo` filter, event summary and assignee endpoints; owner Alerts inbox (company and site), notifications screen, unread badge | typecheck, backend integration 85 |
| 2026-10-26 | **P5 manifests, vehicles, sessions, reconciliation**: models, observed-count contract, pure reconcile + CSV parser (17 unit tests), API for vehicles/manifests/import/sessions, Shipments screen | unit 52, integration 110, owner 11, both `next build`s, API run on a real server; browser not used |
| 2026-10-26 | **P6 reports, audit, superadmin**: reports (cargo activity, mismatches, CSV export) in site time zones with shifts and coverage gaps, company audit trail API, audited support access to evidence; owner Reports and Audit trail screens | unit 58, integration 127, owner 12 |
| 2026-10-26 | **P7 observability, delivery, docs, hardening**: structured logs, metrics, readiness, graceful shutdown, esbuild production bundle (fixed broken `npm start`), backup/restore with tests, CI, Dockerfiles + prod compose (unbuilt), OpenAPI with sync test, README, runbook, production env, QA checklist, security review with 4 fixes | unit 61, integration 138, both builds, built server run |
