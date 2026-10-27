# Vision QA checklist (spec v1.0 section 14)

Status key: DONE = code present and tested manually, PARTIAL = code present, a part is missing, TODO = not started, N/A = not in Dev 2 scope.

| ID | Scenario | Status | How it is verified / what is missing |
|---|---|---|---|
| QA-01 | Company A requests Company B's site by ID | DONE | Zones, counts and monitoring return 404 for other tenants through `assertSiteAccess` (Dev 1 tenancy). Covered by `chain.int.test.ts` and `tenancy.int.test.ts`. |
| QA-02 | Operator tries to edit a zone | DONE | Zone and monitoring routes use `requirePermission` (`zones:read/write`, `monitoring:read/control`). Operators and auditors get 403 on every change; managers, admins and owners may change. Test in `chain.int.test.ts`. |
| QA-03 | Same AI event sent twice | DONE | Verified live: 202 Accepted on first write, 200 OK duplicate on re-send, 409 DUPLICATE_EVENT on conflicting payload with same eventKey. (scripts/test-qa03.ps1). |
| QA-04 | Track crosses line in configured direction | DONE | One count per track per zone is enforced by MongoDB unique index `(zoneId, trackId)`. Direction vector geometry calculated in AI worker and validated in ingestion. |
| QA-05 | Object jitters around line | DONE | Debounce and trajectory history implemented in Python worker LineCrossingTracker. |
| QA-06 | Camera disconnects | DONE | Staleness job runs every 15s and writes camera_offline / ai_service_unavailable events with deduplication. Monitoring UI shows OFFLINE. |
| QA-07 | Manifest 100, observed 94 | DONE | Reconciliation (Dev 1) reads the count ledger through `getObservedCount()`. End to end: `chain.int.test.ts`; unit case: `reconcile.test.ts`. |
| QA-08 | Event acknowledged then resolved | N/A | Event review workflow belongs to Dev 1 (`docs/qa-checklist.md`). |
| QA-09 | Expired evidence URL reused | N/A | Signed evidence links belong to Dev 1. |
| QA-10 | CSV malformed rows | N/A | CSV manifest import belongs to Dev 1 (`docs/qa-checklist.md`). |
| QA-11 | Timezone crosses midnight | DONE | `counts/summary?groupBy=day` groups by date in site timezone using MongoDB `$dateToString`. |
| QA-12 | Poor lighting or occlusion | PARTIAL | Coverage and limitations are shown in the live HUD and dashboard cards. The worker's motion detector has not been measured on real footage. |

## Ingestion and counts verification

- [x] Appendix A schema validation, strict mode, unknown fields rejected
- [x] Evidence accepted as storage key only (no URL, no path traversal)
- [x] Camera belongs to site, zone belongs to camera, zone is active
- [x] companyId in payload is never used for authorization
- [x] Count only for package_line_crossing with countDelta 1
- [x] Suppressed counts store a reason (CLASS_NOT_ENABLED, BELOW_MIN_CONFIDENCE, TRACK_ALREADY_COUNTED)
- [x] Event and ledger written in one MongoDB session transaction
- [x] Service token: constant-time compare (`crypto.timingSafeEqual`), rotation supported
- [x] In-memory rate limiting (300 events / camera / min)
