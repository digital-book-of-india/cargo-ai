# Dev 1 plan: Phases 10 to 16

Scope: everything Dev 1 owns (platform, data safety, security, operations, workflow screens, superadmin). Dev 2's work
(detector, worker, zones, vision collections, pilot) is listed only where Dev 1 depends on it.
Source: the four-part code review of 2026-10-27 plus `CONTEXT_DEV1.md`. Items marked **verify first** were reported by a
reviewer who read the code but did not run it: confirm in 10 minutes before building the fix.

## 0. Working rules (so the work finishes with few surprises)

1. One task = one commit (when the owner says to commit). Never commit, push or rewrite history without the owner's yes.
2. Before each task: `npm run typecheck`. After each task: the tests for that area. Full suites only at the end of a phase.
3. Anything that changes stored data: write the migration with a working `down`, run it on `cargo_ai_test` first, take
   `npm run backup` before running it on `cargo_ai`.
4. Migration ids for Dev 1: `20261101-1xx` (Dev 2 uses `20261101-2xx`). Never edit a migration that has already run.
5. Every new route: permission guard, company scoping, entry in `docs/openapi.yaml` (a test fails otherwise).
6. A reviewer claim is not a fact until you reproduce it. Write the failing test first when you can.
7. Do not stop the owner's dev servers (3000, 3001, 4000). For browser checks use the throw-away setup in `CONTEXT_DEV1.md`.

## 1. The flow Dev 1 protects

```
 browser (owner / superadmin)            AI worker (Dev 2)
        |  cookie session                       |  service token
        v                                       v
 [auth + tenant + permission]            [service auth + rate limit]
        |                                       |
        |   sites, users, manifests,            |  POST /internal/v1/ai/events
        |   sessions, reports, events           v
        |                               vision ingestion (Dev 2)
        |                                  |  event + count ledger (one transaction)
        |                                  v
        |                        createCargoEvent()  <-- contract: Dev 1 owns
        |                                  |
        |<------ getObservedCount() ------ |  <-- contract: Dev 2 owns
        v                                  v
 loading session close -> reconcile -> count_mismatch event -> inbox -> notifications
        |
        v
 reports, CSV export, audit trail          evidence (private storage, signed links)
```

Where Dev 1 work lands: the boxes on the left and bottom, plus the two contracts. Every phase below fixes one part of this picture.

## 2. Phase map

| Phase | Name | Why this order | Depends on |
|---|---|---|---|
| 10 | Safety first: secrets, CI, fail-closed config | Nothing else is safe to merge while secrets are public and CI is red | none |
| 11 | One zone model for sessions and reports | Wrong observed counts is the worst correctness bug | 10 (green CI) |
| 12 | Data safety: indexes, migrations, tenant refs, retention | Protects the data before more code touches it | 11 |
| 13 | Security hardening | Closes the holes found in review | 10 |
| 14 | Operations: metrics, Docker, backup and restore (the shared rate limiter is Dev 2's) | Needed before any deployment | 10, 12 |
| 15 | Frontend: Dev 1 screens and superadmin | Honest states, correct evidence, safe admin session | 13 (auth change) |
| 16 | Hygiene and delivery | Line endings, naming, pins, docs, final checks | all |

Run order: 10, then 11. After that 12, 13 and 15 can run side by side if there are two people. 14 after 12. 16 last.

## 3. Cross-dev contracts and hand-offs

| What | Owner | Notes |
|---|---|---|
| `createCargoEvent(input)` | Dev 1 | Dev 2's ingestion calls it. Do not change its signature without telling Dev 2. |
| `getObservedCount(q)` in `services/counts/observed.ts` and `modules/vision/counts/service.ts` | Dev 2 data, Dev 1 caller | Phase 11 starts passing a real `zoneId`. |
| `VisionZone` is the only zone model | agreed | Dev 1 moves its code off `ZoneModel` in Phase 11. Dev 2 deletes `ZoneModel` only after Phase 11 merges. |
| Camera move/delete must clean vision data | Dev 1 asks, Dev 2 provides a function | Phase 12, task 12.6. |
| Dashboard, live page, zone editor are Dev 2's files | Dev 2 | Review findings on them (dashboard shows "all clear" on API failure, no role gating, fake "LIVE" badge) go to Dev 2. Dev 1 only reports them. |
| `.gitattributes` renormalise | both | Touches every file. Do it once, when neither dev has open work. |
| Shared rate limiter (Redis, optional) | Dev 2 builds, Dev 1 documents and wires deployment | One-time exception to "one owner per file": Dev 2 edits `middleware/rateLimiter.ts`. Dev 1 stays out of that file meanwhile. |

## 4. Phase 10: safety first  (status 2026-10-27: done in the tree, owner actions pending)

Done: placeholders in `.env.example` (and the real values are in no other tracked file), `scripts/check-secrets.js` and `npm run check:secrets` (CI step; proven to pass on the clean tree and fail on the old leaked file), CI on a replica set with lint and the root `npm test` running backend unit tests, fail-closed `NODE_ENV` with tests. Gate: typecheck clean, 12 + 64 unit tests, 145 integration tests green.
Owner decision: the database password is not rotated (accepted risk, recorded in `docs/security-and-privacy.md`); closed, do not raise it again. Still open: (1) the CI audit job stays informational until the postcss bump can be installed with the panels' dev servers stopped; (2) the new CI steps have not run on GitHub yet, only locally.

Goal: no public secrets, CI green, config fails closed.

**10.1 Secrets** (owner decision: no rotation, see below)
- Verified: `apps/backend/.env.example` is identical to the real `.env` and is on GitHub (branches `feature/development`, `cargo/cleanup`).
- Replace the values in `apps/backend/.env.example` with placeholders (same style as `.env.production.example`).
- Search for other leaks: `git grep -n -E "mongodb(\+srv)?://[^<$ ]+:[^@<$ ]+@"`, and look for 32+ character hex strings in tracked files.
- Add a secret scan to CI (for example gitleaks) so this cannot return.
- Done when: the scan finds nothing in the tree and the app runs with the existing `.env`.

**10.2 CI on a replica set**
- Why: vision ingestion uses transactions (`modules/vision/ingestion/service.ts`), a standalone Mongo refuses them. `.github/workflows/ci.yml` starts plain `mongo:7`.
- GitHub service containers cannot take start arguments. Replace the `services:` block with a step: `docker run -d --name mongo -p 27017:27017 mongo:7 --replSet rs0 --bind_ip_all`, wait, then `mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]})"`. Set `MONGODB_URI=mongodb://localhost:27017/cargo_ai?replicaSet=rs0&directConnection=true`.
- Also in CI: add a lint step for the owner (`npm run lint -w @dbi/owner`), make `npm audit --audit-level=high` fail the job (remove `continue-on-error`), and make the root `npm test` also run the backend unit tests.
- Done when: a push to `feature/development` runs all 145+ integration tests green, including `chain.int.test.ts`.

**10.3 Config fails closed**
- Why: `config/env.ts` only enforces secrets when `NODE_ENV === "production"` exactly. An unset or misspelled value falls back to published defaults, and the camera key falls back to the JWT secret.
- Change: require the secrets unless `NODE_ENV` is exactly `development` or `test`. Never derive the camera key from the JWT secret outside tests.
- Test: start the server with `NODE_ENV` unset and no secrets, expect it to refuse in anything but dev/test.
- Done when: the above test passes and `.env.example` documents it.

## 5. Phase 11: sessions and reports on `VisionZone`  (status 2026-10-27: done)

Done: sessions, `mismatchCamera`, the cargo-event zone check, the event export, the site archive guard and the observed-count source now use `VisionZone` only. A session needs an enabled counting line when the site has one (422 otherwise); a line of another site is 400; a draft line or a non-line zone is 422; one open session per line and direction (database index plus 409). The session response carries `zone: {id, name}`. The Shipments start dialog has a counting-line picker. The seed adds a DEMO counting line. Migration `20261101-101` moves old session zone ids to `legacyZoneId` (reversible). Tests: 5 new in `chain.int.test.ts`, 1 in `migration-sessions.int.test.ts`. The old `ZoneModel` is still used by the legacy camera `/zones` routes and the worker's stream-config: Dev 2 removes it.
Owner decision applied: a zone IS required when the site has an enabled counting line.

Goal: the observed count of a session comes from the zone that was actually used.

Problem: `LoadingSession.zoneId` points at the old `Zone` model; the count ledger uses `VisionZone` ids. Result: a session with a vision zone is rejected, and a session without a zone counts the whole site.

Files to change:
- `models/LoadingSession.ts:32` ref `"VisionZone"`. Same for `models/CargoEvent.ts:64` (decide: the inbox forwarder stores the vision zone in the payload today; make `zoneId` the real reference).
- `modules/shipments/routes.ts:523` (start session: validate the zone with `VisionZoneModel` by `siteId` and `companyId`) and `:677` (`mismatchCamera`: take the camera from `VisionZone.cameraId`).
- `modules/reports/routes.ts:264`, `modules/sites/routes.ts:157` (archive guard: count active `VisionZone`s), `services/events/createEvent.ts:161`, `seeds/seed.ts`.
- Leave `ZoneModel` and the camera `/zones` routes alone. Dev 2 removes them after this merges.

Steps:
1. Write the failing tests first (`shipments.int.test.ts`): a session with a vision zone returns 201; a zone of another company or site is refused; two zones at one site count separately; a session without a zone closes as `closed_unverified` when the site has active vision zones (decision below).
2. Make `observed.ts` pass the session's `zoneId` to `getObservedCount` (it already accepts one).
3. Add a partial unique index so one zone has at most one open session (`companyId`, `zoneId`, where `closedAt` is null). Check existing data for violations before creating it.
4. Data migration `20261101-101`: existing sessions with an old-zone id get `zoneId: null`. Write the `down`.
5. Update `docs/openapi.yaml`, the Shipments screen zone picker (list `/zones?siteId=`), and the QA checklist.

Decision for the owner: is a zone required to start a session? Recommendation: yes, whenever the site has an active counting zone. Without it the count is site-wide and unreliable.

Done when: QA-07 passes end to end with a zone, a session only counts its own zone's crossings, `chain.int.test.ts` is extended with a two-zone case.

## 6. Phase 12: data safety and tenancy  (status 2026-10-27: done)

Done: new indexes (migration `20261101-102`, also declared in the models); `createCargoEvent` checks the loading session and the evidence key's site; a camera's lines and monitor follow it, and move/delete are refused while a session counts on it (the camera cleanup is written in Dev 1's `services/cameras/lifecycle.ts`, no change to Dev 2's files); delivered notifications and old audit entries are purged by the daily job; false-positive events can be reopened; a bad cursor is a 400; a failed CSV import can be sent again; session start cannot be backdated more than 48 hours and both times are audited; a missing mismatch event is created by a repair step in the notification job; a failed history write puts the status back. Tests: `phase12.int.test.ts` (13).
Added after the owner asked for them (2026-10-27): (1) `Notification.eventId` is now an ObjectId (migration `20261101-103`, reversible); (2) a camera name is unique within a site, ignoring capitals, with a clear 409 on create, rename and move (migration `20261101-104` renames existing duplicates first, oldest keeps its name); (3) evidence of an unresolved event (open, acknowledged, in review, escalated) is kept up to twice the retention period, then deleted, so nothing is kept forever (`UNRESOLVED_RETENTION_FACTOR` in `services/events/retention.ts`). Left as it is: the old migrations 001, 003 and 004, because they have already run; every new index change is a new migration.

**12.1 Indexes (new migration `20261101-102`, never edit old ones)**
- `AuditLog`: `(companyId, createdAt -1)`.
- `CargoEvent`: `(companyId, cameraId, occurredAt -1)`, `(companyId, zoneId, occurredAt -1)`.
- `Notification.eventId` is a string; make it an ObjectId ref and fix the sparse unique compound index.
- `Camera`: check for duplicate `(siteId, name)` first, then decide whether to add a unique index.
- Use `explain()` on the events list, audit list and reports queries before and after.

**12.2 Why not collapse the old migrations**: 001, 003 and 004 repeat the same index creation with an empty `down`, but they have already run. Leave them. From now on every index change is a new migration with a real `down`, and a note in `docs/runbook.md` says what each migration guarantees.

**12.3 Foreign-id validator**
- New `services/tenancy/refs.ts`: `assertSameCompany({ siteId, cameraId, zoneId, loadingSessionId, manifestId, vehicleId }, companyId)`; throws a uniform 404.
- Use it in `createCargoEvent`, sessions, manifests, vehicles, event assignment.
- Tests: for each route, post an id belonging to company B and expect 404. One table-driven test file.
- Also: evidence keys only need to start with the company id today (`keyBelongsToCompany`), so a file from one site can be attached to another site's event. Require company and site in the key.

**12.4 Retention**
- `services/events/retention.ts` only deletes evidence files of cargo events. Extend it to event history, notifications and audit logs, with days per collection in company settings (defaults in `.env.production.example`).
- Owner decision: how long to keep audit logs (recommendation: longer than events, for example 365 days).
- Also stop deleting evidence of events that are still open or in review.
- Document the policy in `docs/security-and-privacy.md`.

**12.5 Small data bugs (each is a 5-line fix with a test)**
- `canReopen` (`services/events/transitions.ts:59`): allow reopen from `false_positive` and `escalated`, with the permission.
- `decodeCursor`: validate the id, return 400 not 500 (`owner/events/routes.ts`, `audit/routes.ts`, `shipments/routes.ts`).
- Manifest import: only short-circuit on COMPLETED or PARTIAL jobs, not FAILED (`shipments/routes.ts:254`).
- Session `startedAt`/`closedAt`: forbid backdating beyond a limit and write both into the audit metadata.
- Session close: if the mismatch event fails after the session is closed, the session keeps `review_required` with no event. Make creation retryable (a repair step in `job:notifications` or a flag on the session) so no mismatch is lost.
- Event transition: write history first, or use a transaction, so a failure cannot leave a moved event without history.

**12.6 Camera lifecycle (needs Dev 2's function)**
- `owner/cameras/routes.ts:231` (assign-site) and `:286-298` (delete) only touch the old zone model. Vision zones and monitors keep the old site or stay enabled, so counting silently stops or a deleted camera stays in the worker config.
- Agree one function with Dev 2, for example `onCameraMoved(cameraId, newSiteId)` and `onCameraDeleted(cameraId)` in `modules/vision/zones/service.ts`. Dev 1 calls it. Block deletion while a loading session is open.
- Done when: a test moves a camera with a vision zone and the worker config reports the new site.

Done when (phase): the new indexes exist, a tenant-ref test table passes, retention covers all four collections, and each small bug has a test.

## 7. Phase 13: security hardening  (status 2026-10-27: done, with open items)

Done: camera address policy and honest camera test (13.1); admin routes on the shared session check (13.2, auth part only); token version, database check on every request, 12 h lifetime, sign-out revocation, per-account lock, password-before-status, dummy hash, registration race (13.3); AES-GCM camera secrets plus migration `20261101-105` (13.4); evidence links with own key, audience and holder recheck (13.5); credential-read audit once per camera and hour and AuditLog actor made optional (13.6, audit only); audit of zone, monitoring and camera-test actions and a required, first-written audit entry for support grants (13.7); request-id sanitising, limiters after the permission check, counts permission, field length caps, seed refuses non-development (13.8). Tests: `phase13.int.test.ts` (20).
Not done: (a) per-worker service tokens (needs the worker too: Dev 2); (b) the admin routes keep their own response envelope, error codes and limiter, and the sign-in JSON still carries the token (both change with the superadmin panel in Phase 15); (c) the ingestion limiter is keyed by an unvalidated camera id and evidence upload has no limit (Dev 2's and the evidence files); (d) migration 105 still has to be run on the real database (the code reads both formats until then).

Do each item as: reproduce, failing test, fix.

**13.1 Camera host validation (SSRF)** (verify first)
- A user can register any host and call `/cameras/:id/test`, and the server opens a TCP connection. Fix: in `cameraRegisterSchema` (`packages/validation/index.ts`) and again at test time, resolve the host and refuse loopback, link-local (169.254.x), private ranges and metadata addresses unless an allow-list says otherwise. Check again after DNS, not only on the string.
- Also: a TCP connect must not set `lastFrameAt` or report ONLINE (`owner/cameras/routes.ts:147-155`). Report "reachable" only.

**13.2 One auth system** (verify first: `cookie-parser` is not installed, so `adminAuth.ts` cookie path may never work)
- Move `/admin/*` onto `authenticate` plus a database-checked platform-admin guard and the central error handler. Remove `adminAuth.ts` duplicates (own rate limiter, own response helpers, extra error codes, five cookie names).
- The superadmin client must change at the same time (Phase 15).

**13.3 Sessions**
- Add a `tokenVersion` on the user; bump it on logout, role change, disable and password change; check it in `authenticate`. Shorten token life (for example 12 hours).
- Do not return the token in the JSON body for browsers (cookie only). Check who still needs it (tests, superadmin).
- Per-account lockout (counter per email with decay), check the password before reporting a suspended account, and run a dummy hash for unknown emails.

**13.4 Camera secrets**: replace AES-256-CBC with AES-256-GCM in `services/secrets/manager.ts`, remove the "no colon means plaintext" passthrough, and re-encrypt on read (lazy migration). Dependent on the key rotation in 10.1.

**13.5 Evidence links**: sign with a separate secret or an `aud` claim, and re-check membership, site access and company status when a link is used. Audit every access, not only when `uid` is set.

**13.6 Service token**: one global token can read every tenant's decrypted camera URL. Short term: audit every credential read. Longer term (with Dev 2): one token per worker, bound to the cameras it serves.

**13.7 Audit gaps**: zone create/update/enable, monitoring start/stop, camera test, camera credential reads, session open/close timestamps. A failed audit write for a sensitive action must fail the request (`services/audit/logger.ts` currently swallows it).

**13.8 Small items**: cap and sanitise `x-request-id`; rate limiters should run after auth on import and export; add `requirePermission` to counts and notifications routes; max lengths on free-text fields; registration race gives a 500 (catch the duplicate key); seed refuses to run when `NODE_ENV=production`.

Done when: each item has a test, `docs/security-and-privacy.md` lists what changed, and the findings table in that file is updated.

## 8. Phase 14: operations  (status 2026-10-27: done, with open items)

Done: request-time histogram overall and per route, readable p95 (14.2); Dockerfiles with a cached dependency layer, a CI job that builds all four images and starts the backend against a real replica set (14.3, first real check happens on GitHub); first real restore drill, recorded in the runbook, PASS (14.4); response compression, capped list totals, platform overview counted in the database (14.5). Tests: `phase14.int.test.ts` (3), `metrics.test.ts`.
Not done, with reasons: shared rate limiter (Redis: Dev 2); Next standalone web image, Mongo password with key file, worker container health check (cannot be verified without Docker; reasons in the runbook); `cargo_*` metric aliases (no dashboards exist yet and the runbook alerts use the `dbi_` names); a consistent backup (Atlas snapshots or `mongodump --oplog`) for production; the superadmin camera-health page still loads all cameras to filter them; the drill did not start the API on the copy or restore evidence files.

**14.1 Shared rate limiter: assigned to Dev 2, not Dev 1.** Redis is not used anywhere today (the dev compose has an unused `redis` profile, no client package is installed). Dev 2 adds an optional `REDIS_URL` store with a memory fallback and uses it for both limiters: the main one and their per-camera ingestion limit. Dev 1 only does two things: (a) does not touch `middleware/rateLimiter.ts` while Dev 2 works on it (it is a Dev 1 file, so the owner must approve this one cross-over), and (b) afterwards adds `REDIS_URL` to `docs/production-env.md` and `.env.production.example` and a Redis service to `infra/docker-compose.prod.yml`.

**14.2 Latency metrics**: `services/observability/metrics.ts` keeps only a sum and a count, so p95 (spec: 500 ms) cannot be read. Add a histogram with fixed buckets per route group. Keep the `dbi_*` metric names and add `cargo_*` aliases until dashboards move.

**14.3 Docker**
- `backend.Dockerfile`: copy only `package.json` files and the lockfile before `npm ci` so the dependency layer is cached.
- `web.Dockerfile`: multi-stage, `output: "standalone"` in both `next.config.js`, run as `node` user, no dev dependencies in the final image.
- Compose: MongoDB auth. Gotcha: a replica set with auth needs a key file on every member (`--keyFile`), so do both together and test with `docker compose up` before relying on it. Do not publish port 4000 directly behind a proxy. Add a healthcheck to the worker.
- CI: add a job that builds all four images.
- Done when: `docker compose -f infra/docker-compose.prod.yml build` and `up` work on a machine with Docker, and `/health/ready` is 200.

**14.4 Backup and restore**
- The dump is per-collection and not consistent at one moment. For Atlas use snapshots or `mongodump --oplog`; keep `npm run backup` for small installs and say so in the runbook.
- Run the restore drill into a scratch database following `docs/runbook.md`, record date and result in the runbook.

**14.5 Speed**: drop the exact `countDocuments` from list endpoints (return `hasMore` and a capped count); use `.lean()` on read-only lists; add response compression; replace `find({})` over all cameras in the superadmin overview and health routes with aggregations; cache nothing in the API that is tenant-specific.

Done when: p95 is readable from `/internal/v1/metrics`, the images build in CI, and one restore drill is recorded.

## 9. Phase 15: frontend (Dev 1 screens and superadmin)  (status 2026-10-27: done, with open items)

Done: evidence and preview pictures use the API origin (checked in the browser with a real uploaded picture); superadmin keeps no token (own `cargosense_admin` cookie, `/admin/me` session check, retry screen on network errors, old localStorage token removed); security headers and a CSP on both panels (`packages/ui/security-headers.js`); stale states, labels, dialog behaviour and a skip link on the superadmin; stale-answer guards in `useAsync`, `EventInbox`, the cameras page and the superadmin lists; CSV export through the shared helper; shipments screen shows a no-access state; Poppins is the font in both panels; 360 px check clean on 9 owner routes. Not done: email/webhook notification handlers (owner has not asked for them); the superadmin 360 px check (frame-ancestors none blocks the iframe method); the admin cookie needs the panel and API on the same registrable domain.

Boundary: dashboard, live page and zone editor are Dev 2's files. Hand them these findings: dashboard shows "all clear" when the API fails and counts DEGRADED as nominal; live page badge stays green after the API drops and shows no video; no role gating on live and zone pages; zone page uses the raw camera status.

Dev 1 tasks:
1. **Evidence origin** (verify first, open an event with evidence in the browser): `components/alerts/EvidenceViewer.tsx` and `lib/events.ts` use the API's relative `/api/v1/evidence/...` path as the image source, which resolves against the panel's own origin. Fix with the API origin (as the superadmin support page does) or a Next rewrite. Test with a real uploaded snapshot.
2. **Superadmin session**: remove the admin token from `localStorage`, rely on the cookie; give the admin cookie its own name so signing in on one panel does not sign out the other; do not hard-redirect to access-denied on every 403 under `/admin` (only on `/auth/me`); show a retry state, not a logout, on network errors.
3. **Superadmin headers and wording**: copy the owner's security headers (`X-Frame-Options`, `Referrer-Policy`, `nosniff`) and add a Content-Security-Policy to both panels; fix the old "shutter and gate monitoring for shop owners" description; rename leftover "shop" wording.
4. **Superadmin states**: show "stale" when the API says `isStale` (overview and health pages); use one shared API client and states component (move to a shared package or copy the owner's); add labels (`htmlFor`), dialog roles, Escape and focus handling on custom modals, a skip link.
5. **Race conditions**: request token or `AbortController` in `EventInbox`, the cameras refresh and the superadmin list pages; `useAsync` should clear data when its key changes, so a site switch never shows the previous site's data.
6. **Reports export**: use the shared fetch helper (timeout, 401 handling).
7. **Permission-denied states**: add them to every Dev 1 screen that lacks one; keep the UI in sync with `packages/api-types/permissions.ts`.
8. **Browser QA** at desktop and 360 px with real data: sessions, manifests with a CSV import, clips, a support grant. Keyboard-only pass on the alert review. Use the throw-away `127.0.0.1` setup in `CONTEXT_DEV1.md`.
9. **Notifications**: implement the email and webhook handlers behind the dispatcher's existing plug-in points (only if the owner wants them in this release).

Done when: evidence images load in the real panel, the superadmin has no token in `localStorage`, and the QA walkthrough is repeated and recorded.

## 10. Phase 16: hygiene and delivery  (status 2026-10-27: done, with owner decisions open)

Done: `.gitattributes` (`* text=auto eol=lf`; the index is already LF, so no renormalize commit is needed); the CSV byte order mark is now written as `﻿` (it is meant for Excel, it was a hidden character in the source); backend and owner dependencies pinned to the installed versions, one `tsx` version, Python requirements pinned, Dependabot added; root `npm test` runs owner, superadmin and backend unit tests; `bench:load` and `eval:accuracy` scripts wired; the integration harness refuses a remote `MONGODB_URI` unless `MONGODB_URI_TEST` or `TEST_DB_FROM_DEV_ENV=1` is set. Final gate (typecheck, owner lint, 81 unit tests, 197 integration tests, both builds, secret scan) passed. Not done: naming of the cookie, default database and metric prefix (owner decision: renaming logs everyone out and breaks dashboards); `main.py`, `staleness.ts` and the dashboard page still have byte order marks (Dev 2); `legacy_*` collections are deleted by hand after the owner confirms the archive (suggested: 2026-12-01); CI image job and Docker never run on GitHub; GitHub CI not yet seen green.

1. `.gitattributes` with `* text=auto eol=lf`, then one `git add --renormalize .` commit. Coordinate with Dev 2 first. Remove the byte-order marks in `reports/csv.ts` (Dev 1); `main.py` and `staleness.ts` are Dev 2's.
2. Naming: decide the scope. Recommendation: keep `@dbi/*` package names (internal), rename user-visible and operational names only: the cookie, default database name and metric prefix (with aliases), then docs. Renaming the package scope touches hundreds of imports for no user benefit.
3. Pin versions: mixed exact and caret in `apps/backend/package.json`; pin the Python requirements; pick one `tsx` version; add Dependabot or Renovate.
4. Tests: a root `npm test` that runs owner and backend unit tests; add a smoke test for the superadmin; remove or wire up `scripts/load-test.ts`, `scripts/evaluate-accuracy.ts`, `scripts/test-qa03.ps1` (they are not run by anything today); the test harness should not silently take its database host from a developer's `.env`.
5. Docs: merge `docs/vision/openapi.yaml` and `docs/openapi.yaml` or link them clearly; update `CONTEXT_DEV1.md` (state, numbers, decisions) and `README.md`; date the removal of the `legacy_*` collections.
6. Final gate: typecheck, all unit and integration tests, both builds, image builds, one browser pass, restore drill recorded, secret scan clean, CI green.

## 11. Decisions the owner must make (they block specific tasks)

| # | Decision | Blocks | Recommendation |
|---|---|---|---|
| 1 | Rotate keys / purge git history? | 10.1 | **Decided by the owner: the database password is not rotated. Closed; do not ask again.** |
| 2 | Is a zone required to start a session? | Phase 11 | Yes when the site has an active counting zone. |
| 3 | Audit log retention | 12.4 | Longer than events, for example 365 days. |
| 4 | Rate limiter store | Dev 2's task | Redis, optional, memory fallback. Owner has decided: Dev 2 does it. Only open point: approve the one-time edit of `middleware/rateLimiter.ts` by Dev 2. |
| 5 | Rename scope | 16.2 | User-visible and operational names only. |
| 6 | Email and webhook notifications in this release? | 15.9 | Only if a customer needs them. |
| 7 | Session token model | 13.3 | Version claim plus shorter life. Full refresh tokens later. |

## 12. How to know Dev 1 is finished

- Secret scan clean, new keys in use, CI green on a replica set.
- Sessions count only their own zone; the two-zone test passes.
- Tenant-ref test table passes; retention covers events, history, notifications, audit.
- Each security item in Phase 13 has a test.
- p95 readable; images build; a restore drill recorded. (Shared rate limits: Dev 2, then Dev 1 documents and wires Redis in compose and the env docs.)
- Superadmin and evidence fixed, and the browser walkthrough repeated.
- Docs and `CONTEXT_DEV1.md` match the code.
