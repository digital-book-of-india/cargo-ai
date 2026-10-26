# Dev 3 Status & Known Gaps (Core Security / API / AI)

## ✅ Completed Modules (Day 1)
1. **Shared Contracts & Validation (`@dbi/api-types`, `@dbi/validation`)**:
   - Added all canonical interfaces, DTOs, Enums, and Zod schemas.
   - Synchronized across monorepo workspaces.
2. **MongoDB Schemas (`apps/backend/src/models`)**:
   - Implemented `User`, `Shop`, `Schedule`, `Camera`, `Zone`, `SecurityState`, `SecurityEvent`, `Notification`, and `AuditLog`.
3. **Auth & Tenant Isolation (`apps/backend/src/modules/auth`)**:
   - Secure password hashing with `bcryptjs`.
   - JWT tokens + cookie support (`authenticate` middleware).
   - Strict tenant isolation (`requireShopAccess`) returning 403 Forbidden on cross-tenant access.
   - `requireRole` supporting `SUPER_ADMIN` and `SHOP_OWNER`.
4. **Schedule & Security-State Engine (`apps/backend/src/services`)**:
   - Timezone-aware calculation (`Intl.DateTimeFormat`) for arbitrary IANA timezones (e.g. `Asia/Kolkata`).
   - Supports opening hours, closing time + grace period, overnight closing (spillover to next day), and date exceptions.
   - Real-time health evaluation: enforces the handoff rule that `MONITORING` is never returned unless both camera and AI worker are actively reporting health.
5. **Camera & Zone Management**:
   - Symmetrically encrypted stream URLs and passwords (no plaintext leakage to frontend).
   - Polygon zone coordinates normalized (0..1) with sensitivity and type.
6. **Internal AI Worker Pipeline & Python Stub (`apps/ai-worker`)**:
   - Internal service authentication via `x-service-token`.
   - Heartbeat reporting endpoint `/internal/v1/ai/health`.
   - Event ingestion with idempotency key deduplication (`eventId`).
   - Runnable Python worker script with heartbeat loop and `--simulate` flag.
7. **Database Seeder (`npm run seed`)**:
   - Seeds Demo Super Admin (`admin@dbi.com`), Demo Shop Owner (`owner@dbi.com`), Demo Shop, Camera, Zone, and Events marked with `DEMO` flag.

## 🛡️ Completed QA Audit Hardening (Day 2)
1. **Model Registry & Production Startup (Phase 1)**:
   - Resolved `OverwriteModelError` crash by converting all models to safe guarded Mongoose pattern `(mongoose.models.X as Model<IX>) || model(...)`.
   - Single-source-of-truth export in `models/index.ts` with cross-developer model aliases.
2. **Multi-Tenant Security & Access Control (Phase 2)**:
   - Added `requireCameraAccess` middleware across all camera test, patch, and zone endpoints.
   - Enforced tenant verification on event review (`POST /events/:eventId/review`).
   - Mongoose collection binding explicitly bound to `events` and protected against non-ObjectId cast exceptions.
3. **Truthfulness Engine & AI Pipeline Integration (Phase 3)**:
   - Manual ARM override gated on real camera and AI worker health checks (returns `DEGRADED` or `OFFLINE` if streams or worker are down; never false `MONITORING`).
   - Unified AI Worker health state in MongoDB `AiWorkerHealthModel` with dynamic staleness threshold (`WORKER_STALE_SECONDS`).
   - AI event ingestion gating: automatically suppresses/ignores alarm triggers when shop is `DISARMED` during open business hours.
   - Resilient camera resolution: symbolic camera IDs gracefully map to the shop's registered camera `_id`.
   - Runnable Python AI Worker script (`apps/ai-worker/src/main.py`) with heartbeat reporting and end-to-end event simulation (`--simulate`).
4. **Hygiene & Reliability Polish (Phase 4)**:
   - In-memory sliding window rate limiter on `POST /auth/register` and `POST /auth/login` (throttles brute force with 429 `RATE_LIMITED` and `Retry-After`).
   - Strict CORS allowlist enforcement with rejection of untrusted external origins (403 `CORS_FORBIDDEN`).
   - Global `X-Request-Id` preservation and propagation on all requests and error responses.
   - Dedicated `CAMERA_SECRET_ENCRYPTION_KEY` environment configuration for AES camera credential encryption.

## ⚠️ Known Gaps & Day 2 Pilot Items
1. **Live Camera Streams**: Requires physical network access or RTSP relay/VPN to camera feed. Mock test stream endpoint is functional for development.
2. **Private Object Storage**: Production clips/snapshots currently store object storage references; S3/GCS bucket credentials required for presigned URL generation.
3. **FCM Push Credentials**: Push token registration endpoint is active, but actual FCM credentials will be plugged in once Firebase project is provisioned.
