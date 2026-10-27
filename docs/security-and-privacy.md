# Security and privacy notes

What the system does to protect companies, people and evidence, where each rule is enforced, and what
is known to be open. The last section lists the findings of the P7 security review.

## Principles

- AI output is a signal for a person to review. The product never asserts theft or loss, uses no face
  recognition, and the wording stays conservative ("count differs", not "parcels are missing").
- All data is real data in the database. Demo rows from `npm run seed` are marked DEMO. There are no
  mock logins or mock data paths in the API or the panels.
- Never show live protection when a camera or the AI worker is not reporting (`effectiveStatus`, `isStale`).

## Tenant isolation (QA-01)

- The company comes from the signed-in user's membership (optionally `X-Company-Id` among the user's own
  memberships). It is never read from a request body or query.
- Every tenant query filters by `companyId`; a record of another company or an unassigned site answers
  **404**, not 403, so nothing is revealed. Owners and admins see all sites; other roles only assigned sites.
- A suspended company is locked out immediately (`COMPANY_SUSPENDED`); a disabled member loses access
  immediately.
- The AI event contract derives the company from the site; a mismatching stated company is refused.
- Tests: `tenancy.int.test.ts`, plus cross-company cases in every other integration test file.

## Roles (QA-02)

One shared permission table (`packages/api-types/permissions.ts`) is used by the API and the panels:
owner and admin (everything for their company), warehouse manager (cameras, zones, manifests, review,
export for assigned sites), security operator (review and live view for assigned sites), auditor
(read, reports, export, audit trail). An admin cannot grant or change ownership; the last owner cannot be
demoted or disabled.

## Authentication and secrets

- Passwords: bcrypt. Session: signed token in an `httpOnly`, `SameSite=Lax`, `Secure` (production) cookie.
- Login, registration and invitation acceptance are rate limited per client address. The address comes from
  Express and honours `X-Forwarded-For` only as far as `TRUST_PROXY` says (see review finding 1).
- Invitation tokens are stored hashed, single use, expiring.
- Camera passwords are encrypted at rest and never returned by the API; the AI worker reads them through the
  service-token route only. Payloads that contain password/secret/token/credential/rtsp keys are rejected.
- In production the server refuses to start without `JWT_ACCESS_SECRET`, `AI_SERVICE_TOKEN` and
  `CAMERA_SECRET_ENCRYPTION_KEY`. The service token is compared in constant time.

## Evidence (QA-09)

- Stored privately (never a public folder); keys are chosen by the server (`company/site/yyyy/mm/uuid.ext`)
  and checked against path traversal. Uploads are checked for type, size and real file content.
- Viewed only through signed, expiring links (default 5 minutes) issued with an authorised event detail
  view, bound to one event, one file kind and one company. Storage keys are never sent to the browser.
- Every access is audited. Support staff can open evidence only with a written reason (10+ characters);
  that grant is written to the owning company's audit trail and the link lasts 2 minutes.
- Retention: each company sets its own days (7 to 3650); the daily job deletes files, keeps the event record.

## Audit trail

Security-relevant actions are written with actor, company, request id and metadata (never secrets):
sites, settings, role and status changes, invitations, manifests and imports, loading sessions, exports,
evidence access, company suspension, support access. Owners, admins and auditors read their company's trail;
platform administrators read all.

## Exports

CSV export follows the same site access as the event list, is limited to 10,000 rows (more is refused, not
cut), is rate limited, is audited with its filters and row count, and neutralises cells that a spreadsheet
could run as a formula.

## Personal data

Users' names and emails, camera footage evidence, and audit entries are personal data. Backups contain all of
it: keep them encrypted and off the server. Logs contain user and company ids and request paths, never
query strings, bodies or tokens.

## P7 security review: findings

| # | Finding | Status |
|---|---|---|
| 1 | The rate limiter trusted the `X-Forwarded-For` header directly, so a caller could send a new value per request and bypass the login/registration/export limits. | **Fixed.** The address now comes from Express; `TRUST_PROXY` says how many proxies to believe (default none). Regression test in `security.int.test.ts`. |
| 2 | A development-only "mock admin token" login existed in the admin middleware (gated by an environment flag). | **Removed.** Every administrator is a real database user. |
| 3 | CORS allowed `localhost:3000/3001` with credentials even in production. | **Fixed.** Localhost origins are added only outside production. |
| 4 | The database layer forced Google DNS servers for every deployment. | **Fixed.** Opt-in through `DNS_SERVERS`. |
| 5 | `npm start` (`node dist/server.js`) could not run: the shared packages are TypeScript source and `tsc` output cannot load them. | **Fixed.** The backend is bundled with esbuild; verified by running the built server. |
| 6 | Rate limits live in process memory. With more than one API instance each has its own counters. | Open: use one instance, or add a shared store (Redis) before scaling out. |
| 7 | Evidence is on local disk by default. | Adapter for S3-compatible object storage written (`EVIDENCE_STORAGE_DRIVER=s3`); not yet run against a real bucket. Use a private bucket with public access blocked; until then use a persistent, backed-up volume. |
| 8 | A database password was pasted into a chat during setup. | Open, user action: rotate that Atlas password. |
| 9 | Dependency vulnerabilities. | Partly fixed: `next` 14.2.35, `express` 4.22.3 and `mongoose` 8.24.7 (patched, non-breaking). Still open: `next` 16 and `zod` 4 fixes are major upgrades, planned as a separate migration. CI runs `npm audit` (informational) on every push. |
| 10 | No automated accessibility audit. | Open: manual keyboard checks only. |
| 11 | `apps/backend/.env.example` was committed with the real database URI and three real secrets (found in the 2026-10-27 review; on GitHub since commit `bc9fa5c`). | **Fixed in the tree** (placeholders, plus `npm run check:secrets` in CI). **Owner decision (2026-10-27): the database password is NOT being rotated.** The exposed values stay valid and remain readable in git history (`bc9fa5c` onward); this is an accepted risk. Removing them from history would need `git filter-repo` and a force-push, and has not been requested. |
| 12 | An unset or misspelled `NODE_ENV` ran the server on published default secrets. | **Fixed.** Only `development` and `test` may use development fallbacks; anything else behaves like production and refuses to start without real secrets. Tested for unset, `prod`, `production` without secrets, and placeholder secrets. |
| 13 | CI ran MongoDB as a standalone server, which refuses the transactions the vision ingestion needs. | **Fixed.** CI starts a single-node replica set. |
| 14 | An event could be linked to any loading-session id (no company or site check), and an evidence file stored for one site could be attached to another site's event. | **Fixed.** `createCargoEvent` checks the session belongs to the event's company and site; evidence keys must be inside the event's company and site folder. |
| 15 | Moving or deleting a camera left its counting lines and monitor behind, so counting stopped silently or a deleted camera stayed in the worker's configuration. | **Fixed.** The lines and monitor follow the camera; both actions are refused while a session counts on it; deleting archives the lines and stops monitoring. |
| 16 | A tampered paging cursor caused a 500 error. | **Fixed.** It answers 400. |
| 17 | Notifications and audit entries were never deleted. | **Fixed.** The daily job deletes delivered notifications after `CARGO_NOTIFICATION_RETENTION_DAYS` (90) and audit entries after `CARGO_AUDIT_RETENTION_DAYS` (365). Undelivered notifications are kept. Evidence of a resolved or dismissed event is deleted at the retention period; evidence of an event nobody has dealt with yet (open, acknowledged, in review, escalated) is kept up to twice the period and then deleted, so nothing is kept forever. |
| 18 | A token was only checked for its signature, so a suspended or demoted account, and a signed-out token, kept working for up to 7 days. Login revealed a suspended account before the password was checked, skipped the password hash for unknown emails, and had no per-account lock. | **Fixed.** Every request reads the account from the database (role, status, token version); signing out raises the version and ends every sign-in of that user; a sign-in lasts 12 hours (`ACCESS_TOKEN_TTL`); five wrong passwords lock the account for 15 minutes; the password is always compared (a dummy hash for an unknown email) and nothing about the account is shown before it is right. Tokens issued before this change keep working until they expire. |
| 19 | The camera test connected to any address a user typed in (the server could be used to scan its own network or reach the cloud metadata service), and a successful TCP connection marked the camera as having sent a frame. | **Fixed.** Addresses are checked when a camera is saved and again, on the resolved address, when it is tested. Link-local (169.254.x), unspecified, multicast and reserved addresses are never allowed; loopback only outside production; private networks only outside production or with `CAMERA_ALLOW_PRIVATE_HOSTS=true`. A TCP answer no longer sets `lastFrameAt`: such a camera shows as degraded, never online. |
| 20 | Camera passwords were encrypted with AES-CBC (a changed value is not noticed) and a stored value without a colon was returned as if decrypted. | **Fixed.** New values use AES-256-GCM; a changed or truncated value is refused; plain text is no longer passed through. Migration `20261101-105` re-encrypts existing values (old ones stay readable until it runs). |
| 21 | Evidence links were signed with the sign-in secret and still worked after the person lost access. | **Fixed.** Own signing key and audience (a sign-in token is not a link, and the other way round); on every use the holder must still be an active member of an active company with access to the site, or still a platform administrator for a support link. |
| 22 | Zone changes, monitoring start/stop, camera tests and the AI worker reading camera credentials were not audited; a failed audit write was ignored for a support evidence grant. | **Fixed.** All are audited (credential reads once per camera and hour, as the system); a support grant writes its audit entry first and is refused if that fails. |
| 23 | The platform-admin routes had their own token check that never read the cookie. | **Partly fixed.** They now use the same session check as everything else (cookie and Bearer, role from the database, signed-out tokens refused). **Open:** they keep their own response format, error codes and rate limiter; the sign-in response still contains the token for the superadmin panel, which stores it in the browser. Both go with the panel changes in Phase 15. |
| 24 | One AI service token works for every company and can read every decrypted camera address. | **Open.** Credential reads are now audited. Per-worker tokens or mutual TLS are a change to the worker as well and belong to Dev 2's work. |

Reviewed and found sound: every tenant route has an authentication and permission guard; by-id lookups are
scoped to the company (the few unscoped ones are service-token routes or use ids taken from rows already
scoped to the company); responses carry no stack traces; security headers are set by helmet; the API does not
advertise Express.
