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

Reviewed and found sound: every tenant route has an authentication and permission guard; by-id lookups are
scoped to the company (the few unscoped ones are service-token routes or use ids taken from rows already
scoped to the company); responses carry no stack traces; security headers are set by helmet; the API does not
advertise Express.
