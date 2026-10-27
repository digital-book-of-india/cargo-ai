# QA checklist (Dev 1 areas)

How each requirement scenario is checked. "Auto" means an automated test that runs in CI
(`npm run test:int -w @dbi/backend`); "Manual" means a person checks it in the panels before a release.
Test files are in `apps/backend/src/test`.

| ID | Scenario | How | Where / how to check |
|---|---|---|---|
| QA-01 | Company A cannot read or change company B's sites, cameras, events, manifests, sessions, reports or audit trail | Auto | `tenancy.int.test.ts`, and the "another company" cases in every file |
| QA-02 | Each role can do exactly what the permission table says | Auto | `tenancy.int.test.ts` (roles), `reports.int.test.ts`, `shipments.int.test.ts` |
| QA-03 | Submitting the same event key ten times at once creates one event, one history row, one notification per reviewer | Auto | `events.int.test.ts` (ingestion and idempotency) |
| QA-04 | A camera that was never tested, or is silent, is not shown as online; the UI never says "sending video" | Auto + Manual | `settings.int.test.ts` (honest camera status); open Cameras with a never-tested camera |
| QA-06 | Camera/AI outages are marked as coverage gaps in reports and on sessions | Auto | `reports.int.test.ts` (coverage gaps), `shipments.int.test.ts` (coverageGap) |
| QA-07 | Manifest 100, observed 94: difference -6, "needs review", exactly one count-mismatch event | Auto + Manual | `shipments.int.test.ts`; unit test `reconcile.test.ts` |
| QA-08 | Review workflow: acknowledge, resolve, false positive, reopen; illegal moves refused; two people acting at once -> one wins | Auto | `events.int.test.ts` (review workflow) |
| QA-09 | Evidence: private, signed expiring links, expired/tampered/wrong links refused, access audited, support access needs a reason | Auto | `events.int.test.ts` (evidence), `reports.int.test.ts` (support access) |
| QA-10 | CSV import: row errors with line numbers, nothing half-imported, same file never imported twice | Auto | `shipments.int.test.ts` (csv import), `csv.test.ts` |
| QA-11 | Days and shifts follow each site's own time zone; shifts may cross midnight | Auto | `reports.int.test.ts`, `reports.test.ts`, `settings.int.test.ts` |
| QA-12 | Notifications reach only people who may review the event; failures retry with backoff and end in FAILED, not lost | Auto | `inbox.int.test.ts` |
| QA-13 | Backup restores into an empty database with the same data; a damaged backup is refused | Auto + drill | `ops.int.test.ts`; quarterly drill in `docs/runbook.md` |
| QA-14 | Every route is documented | Auto | `openapi.int.test.ts` |
| QA-15 | Worker events to reconciliation: zone enabled, monitoring started, crossings counted once per track, session mismatch raises one inbox event, alert-type worker events reach the inbox, counting-only ones do not | Auto | `chain.int.test.ts` |
| QA-16 | Zone and monitoring changes follow the role table; operators and auditors cannot change them | Auto | `chain.int.test.ts` |
| QA-17 | A loading session counts only the crossings of its own counting line; a line is required when the site has an enabled one; a line of another site, a draft line or an area is refused; one open session per line and direction | Auto | `chain.int.test.ts` |
| QA-18 | Migration 20261101-101 parks old zone ids, keeps vision zone ids, runs twice safely and rolls back | Auto | `migration-sessions.int.test.ts` |
| QA-19 | Every write that takes a foreign id (camera, zone, loading session, manifest, vehicle, site, assignee) refuses ids of another company | Auto | `phase12.int.test.ts` |
| QA-20 | A false-positive event can be reopened; a tampered cursor answers 400; a failed CSV import can be sent again; a session cannot be backdated by days and its times are audited | Auto | `phase12.int.test.ts` |
| QA-21 | A mismatch event that was not created at close time is created once by the repair step; a failed history write leaves the event unchanged | Auto | `phase12.int.test.ts` |
| QA-22 | Old delivered notifications and old audit entries are deleted, undelivered notifications never | Auto | `phase12.int.test.ts` |
| QA-24 | A camera name is unique within a site (any capitals) on create, rename and move; existing duplicates are renamed by migration 20261101-104 | Auto | `phase12.int.test.ts` |
| QA-25 | Notifications store the event id as an ObjectId, the API still returns it as a string with the event, and migration 20261101-103 converts and reverses | Auto | `phase12.int.test.ts` |
| QA-26 | Evidence of unresolved events is kept up to twice the retention period; resolved and dismissed events lose it at the period | Auto | `phase12.int.test.ts` |
| QA-27 | Sessions: 12 h lifetime; sign-out ends every copy of the token; a suspended or demoted account stops at once; old tokens keep working until they expire; five wrong passwords lock the account; a wrong password reveals nothing about the account; simultaneous registrations give 201 and 409 | Auto | `phase13.int.test.ts` |
| QA-28 | Camera addresses: metadata, link-local and invalid hosts refused on save and at test time (also when the stored address is changed behind the API); a TCP answer is not 'online' | Auto | `phase13.int.test.ts` |
| QA-29 | Camera secrets: GCM, tamper detected, old values readable, plain text not trusted; migration 105 | Auto | `phase13.int.test.ts` |
| QA-30 | Evidence links: refused when the holder is disabled or demoted, a sign-in token is not a link, a support grant is audited first | Auto | `phase13.int.test.ts` |
| QA-31 | Audit: zone, monitoring, camera test, credential reads, support grant | Auto | `phase13.int.test.ts` |
| QA-32 | Request-time histogram on the metrics endpoint; compressed list answers; the platform overview counts online cameras in the database | Auto | `phase14.int.test.ts`, `metrics.test.ts` |
| QA-23 | Moving a camera moves its counting lines and monitor; moving or deleting it is refused while a session counts on it; deleting archives its lines and stops monitoring | Auto | `phase12.int.test.ts` |

## Manual walkthrough before each release (about 20 minutes)

Use the demo accounts of a throw-away database (never production):

1. Sign in as the owner. Dashboard, Alerts, Shipments, Reports, Sites, Users and roles, Audit trail, Settings all load.
2. Alerts: filter by status and severity, open an event, acknowledge it, add a note, assign it, resolve it,
   reopen it with a reason. Keyboard only: Tab reaches every control, Enter/Space operate it, focus is visible.
3. Notifications: the badge shows the unread number, "mark all read" clears it.
4. Shipments: add a vehicle and a manifest; import a CSV with one bad row (nothing imported, line number shown),
   fix it and import (rows appear), import the same file again ("already imported"); start a session, close it.
5. Reports: pick a date range and a shift, run; coverage gaps show a warning; export CSV, open it in a spreadsheet
   (times in site local time, no formulas run); the export appears in the Audit trail.
6. Sign in as an operator: no Users, no Audit trail, no export button, cannot create manifests.
7. Sign in as the platform admin: suspend a company with a reason (its members are locked out), reactivate it.
8. Phone width (360 px): no horizontal scroll on any screen above; touch targets usable.

Known gaps: no automated browser tests; no automated accessibility audit; load/performance testing and the
pilot accuracy numbers belong to the AI pipeline work.
