# Vision QA checklist (spec v1.0 section 14)

Status key: DONE = code present and tested manually, PARTIAL = code present, a part is missing, TODO = not started, N/A = not in Dev 2 scope.

| ID | Scenario | Status | How it is verified / what is missing |
|---|---|---|---|
| QA-01 | Company A requests Company B's site by ID | PARTIAL | Zones, counts and monitoring return 404 for other tenants. Uses the stub `assertShopAccess`; replace with Dev 1 tenancy middleware, then re-test. |
| QA-02 | Operator tries to edit a zone | TODO | Role guard (SHOP_STAFF / operator) not implemented. Needs the role matrix from Dev 1. |
| QA-03 | Same AI event sent twice | DONE | Verified live: 202 Accepted on first write, 200 OK duplicate on re-send, 409 DUPLICATE_EVENT on conflicting payload with same eventKey. (scripts/test-qa03.ps1). |
| QA-04 | Track crosses line in configured direction | DONE | One count per track per zone is enforced by MongoDB unique index `(zoneId, trackId)`. Direction vector geometry calculated in AI worker and validated in ingestion. |
| QA-05 | Object jitters around line | DONE | Debounce and trajectory history implemented in Python worker LineCrossingTracker. |
| QA-06 | Camera disconnects | DONE | Staleness job runs every 15s and writes camera_offline / ai_service_unavailable events with deduplication. Monitoring UI shows OFFLINE. |
| QA-07 | Manifest 100, observed 94 | PARTIAL | Manifest model is Dev 1; Dev 2 contract `getObservedCount()` is implemented and live. |
| QA-08 | Event acknowledged then resolved | N/A | Event review workflow belongs to Dev 1. |
| QA-09 | Expired evidence URL reused | N/A | Signed evidence links belong to Dev 1. |
| QA-10 | CSV malformed rows | N/A | CSV manifest import is Phase 2. |
| QA-11 | Timezone crosses midnight | DONE | `counts/summary?groupBy=day` groups by date in site timezone using MongoDB `$dateToString`. |
| QA-12 | Poor lighting or occlusion | DONE | Coverage and limitations displayed in live monitoring HUD and dashboard cards. |

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
