# Vision security notes (Dev 2)

## Controls in place

| Area | Control | Status |
|---|---|---|
| Service auth (AI worker) | `x-service-token` compared with `crypto.timingSafeEqual` on SHA-256 digests. The service fails closed (503) when `AI_SERVICE_TOKEN` is shorter than 32 characters. Outside production the backend has a 32+ character development fallback so tests and CI run without a `.env`; production requires the real value. | Implemented & Verified |
| Token rotation | `AI_SERVICE_TOKEN_PREVIOUS` is accepted during rotation. Remove it once the worker runs the new token. | Implemented |
| Required secrets | In production the server does not start without `JWT_ACCESS_SECRET`, `AI_SERVICE_TOKEN` and `CAMERA_SECRET_ENCRYPTION_KEY`. Outside production they have development defaults. No fallback between secrets. | Implemented |
| Tenant checks | Owner routes check the site through `assertSiteAccess` (company and site assignment). Cross-tenant requests return 404 (no existence leak). Ingestion checks camera to site and zone to camera from the database. | Implemented |
| Payload trust | `companyId` in ingestion payloads is accepted for spec compatibility and never used for authorization. | Implemented & Verified |
| Input validation | Zod schemas with `.strict()` on ingestion, heartbeat and zone payloads. Geometry: finite, 0..1 range, vertex limits, self-intersection check. | Implemented & Verified |
| Evidence keys | Accepted only as storage keys. URLs, schemes, absolute paths and `..` are rejected. | Implemented |
| Body size | JSON body limited to `BODY_LIMIT` (1 MB, shared with the platform because CSV import needs it). Evidence goes through the multipart upload route only. | Implemented |
| Idempotency (QA-03) | `eventKey` unique index. Same key with same payload returns 200 duplicate; same key with different payload returns 409 conflict. Verified via `scripts/test-qa03.ps1`. | Implemented & Verified Live |
| Count integrity | Unique compound index on `(zoneId, trackId)` in count ledger, written in a single MongoDB transaction with the event. | Implemented & Verified Live |
| Session-scoped tracking | Worker prefixes all tracking keys with unique stream session ID (`SESSION_ID-trackId`) so tracks never collide across reboots. | Implemented |
| Rate limit | Ingestion: 300 events per camera per minute (in-memory bucket). | Implemented |
| Worker config | Contains no secrets. Worker reads enabled cameras and zone geometry via authenticated endpoint `/internal/v1/monitoring/config`. | Implemented & Verified |

## Open risks & integration points (before full production pilot)

1. ~~Tenant middleware~~ Resolved: `shared/access.ts` uses Dev 1's tenancy (`assertSiteAccess`).
2. ~~Role guard (QA-02)~~ Resolved: zone and monitoring routes enforce `zones:*` and `monitoring:*` permissions; operators and auditors cannot change them.
3. **Multi-instance Rate Limiter** (open): Current token-bucket rate limiter is in-process memory. Migrate to Redis when scaling backend web instances horizontally.
4. **Stream URL Redaction** (open): RTSP passwords in camera connection configurations should use ephemeral tokens or MediaMTX stream paths.
5. **Worker token:** the worker must be given the same `AI_SERVICE_TOKEN` as the API, at least 32 characters. A shorter token makes the API answer 503 to every worker call.
