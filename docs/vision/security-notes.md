# Vision security notes (Dev 2)

## Controls in place

| Area | Control | Status |
|---|---|---|
| Service auth (AI worker) | `x-service-token` compared with `crypto.timingSafeEqual` on SHA-256 digests. No default token: the service fails closed (503) when `AI_SERVICE_TOKEN` is shorter than 32 characters. | Implemented & Verified |
| Token rotation | `AI_SERVICE_TOKEN_PREVIOUS` is accepted during rotation. Remove it once the worker runs the new token. | Implemented |
| Required secrets | `JWT_ACCESS_SECRET` and `CAMERA_SECRET_ENCRYPTION_KEY` are required. The server does not start without them. No fallback between secrets. | Implemented |
| Tenant checks | Owner routes check the site through `assertShopAccess`. Cross-tenant requests return 404 (no existence leak). Ingestion checks camera to site and zone to camera from the database. | Implemented |
| Payload trust | `companyId` in ingestion payloads is accepted for spec compatibility and never used for authorization. | Implemented & Verified |
| Input validation | Zod schemas with `.strict()` on ingestion, heartbeat and zone payloads. Geometry: finite, 0..1 range, vertex limits, self-intersection check. | Implemented & Verified |
| Evidence keys | Accepted only as storage keys. URLs, schemes, absolute paths and `..` are rejected. | Implemented |
| Body size | JSON body limited to 100 kB. Evidence goes through the multipart upload route only. | Implemented |
| Idempotency (QA-03) | `eventKey` unique index. Same key with same payload returns 200 duplicate; same key with different payload returns 409 conflict. Verified via `scripts/test-qa03.ps1`. | Implemented & Verified Live |
| Count integrity | Unique compound index on `(zoneId, trackId)` in count ledger, written in a single MongoDB transaction with the event. | Implemented & Verified Live |
| Session-scoped tracking | Worker prefixes all tracking keys with unique stream session ID (`SESSION_ID-trackId`) so tracks never collide across reboots. | Implemented |
| Rate limit | Ingestion: 300 events per camera per minute (in-memory bucket). | Implemented |
| Worker config | Contains no secrets. Worker reads enabled cameras and zone geometry via authenticated endpoint `/internal/v1/monitoring/config`. | Implemented & Verified |

## Open risks & integration points (before full production pilot)

1. **Tenant Middleware:** `modules/vision/shared/access.ts` uses an interim shop-access stub. Dev 1's company/tenant middleware will replace this.
2. **Role Guard (QA-02):** Zone editing is permitted to users passing site access. Add strict `SHOP_OWNER` / `COMPANY_ADMIN` role guard when Dev 1 finalizes the role matrix.
3. **Multi-instance Rate Limiter:** Current token-bucket rate limiter is in-process memory. Migrate to Redis when scaling backend web instances horizontally.
4. **Stream URL Redaction:** RTSP passwords in camera connection configurations should use ephemeral tokens or MediaMTX stream paths.
