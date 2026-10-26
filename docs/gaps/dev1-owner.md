# Known gaps and contract requests - Dev 1 (owner panel)

Status: owner screens are fully built across all 11 spec modules, and verified against the in-app mock layer and automated unit test suite (`npm run test`).
They have **not** been run against the real backend yet.

## Needed from the API (blocking real behaviour)

> Update: items 1 and 3 below are implemented now (`GET /cameras/:cameraId/zones`,
> `DELETE /cameras/:cameraId`) — this list was stale. Evidence URLs are also implemented
> (`GET /api/v1/evidence/:eventId/:kind`, short-lived signed link, wired into `evidence.snapshotUrl`/`clipUrl`
> on `GET /events/:eventId` and `GET /shops/:shopId/events`).

| # | Need | Why it matters | What the UI does today |
|---|---|---|---|
| 2 | Camera preview: `GET /cameras/:cameraId/snapshot` (access-controlled image) | The zone editor has no real picture to draw on | Optional guide picture chosen by the owner, kept in the browser, not uploaded |
| 4 | How owners provide camera credentials (`credentialSecretRef` is a reference, not a form field) | Owners need a safe way to give a username and password | Credentials go inside the masked stream address; confirm the backend moves them to the secret store |
| 5 | Response body of `POST /cameras/:cameraId/test` (sync result or queued id) | Needed to show progress and the final result | Works with an empty body: the UI re-reads the camera list until the status leaves `PENDING_TEST` |
| 6 | `exceptions` and `nextTransitionAt` on `GET /shops/:shopId/schedule`; add `exceptions` to `@dbi/api-types` | Holidays and the "Next change" line | Handled when present; omitted when absent |
| 7 | Request body of `POST /shops/:shopId/override` (state, duration, reason) | Needed for the manual override dialog | Implemented in UI; sends `{ state, minutes }` and polls status |
| 8 | Notification preferences endpoint; profile update endpoint | Settings screen | Implemented in UI; sends profile PATCH and preferences PUT |
| 9 | Evidence URL for snapshots and clips | Evidence viewer | Implemented in UI; renders snapshot preview and video player |
| 10 | Pagination format for `GET /shops/:shopId/events` | Alerts list | Assumes `{ items, nextCursor }` |
| 11 | Auth: cookie session or bearer token | Client uses `credentials: "include"` (cookie) | Verified with cookie session and CORS credentials |

## Verified over real HTTP (fake backend, mocks off)

- Login sets an HttpOnly cookie that JavaScript cannot read; credentialed cross-origin calls work.
- 401 envelope, 400 validation, 429, 500 and an HTML 502 page are parsed without crashing.
- Empty 204 and 202 responses are accepted.
- A slow server ends in a timeout message with retry; a stopped server shows "Cannot reach the server"
  and does **not** sign the owner out.
- A session expiring mid-work sends the owner to sign in with "Your session expired" and returns them to the page.

## Shipped (owner scope)

All 11 spec modules are implemented:
- Authentication & Onboarding (signup, login, onboarding checklist)
- Shop Management (create shop, edit shop, shop switcher)
- Schedule Configuration (weekly schedule, overnight hours, exceptions/holidays, grace period)
- Camera Management (camera list, connection test, status indicators)
- Shutter Zone Editor (normalized 0..1 polygon drawing, validation, self-intersection guard)
- Security State & Truthful Display (evaluates actual monitoring state, degrades on camera offline)
- Manual Override Dialog (temporary ARM/DISARM with duration)
- Alerts & Evidence Viewer (paginated alert list, filters, event detail, snapshot & video clip viewer, review actions)
- Notifications (in-app notification list, delivery status, push token registration)
- Profile & Settings (profile update, push notification toggle, notification preferences)
- Automated Unit Tests (`npm run test`) and ESLint in CI (`npm run lint`)

## Pending backend integration & open contract requests

- Day-2 integration against real backend once backend startup and auth fixes land.
- Live camera RTSP streaming/snapshot access URL endpoints (`GET /cameras/:cameraId/snapshot`).
- Real secret storage flow for camera credentials (`credentialSecretRef`).
- Camera deletion endpoint (`DELETE /cameras/:cameraId`).

## Known limits

- Mock and fake ids restart on every run, so a browser can briefly hold a "zone saved" marker from an earlier run.
  Real ids are unique, so this is a development-only effect.

## Phase 6 additions (security state / override)

- `GET /shops/:id/security-state`: owner UI treats `aiWorkerState` values other than `OFFLINE` as healthy and `cameraState` of `OFFLINE|ERROR|NONE|PENDING_TEST` as not healthy. Please confirm the exact enum values for `cameraState` and `aiWorkerState`.
- `reason` codes the UI has wording for: `SETUP_INCOMPLETE`, `CAMERA_NOT_TESTED`, `MANUAL_OVERRIDE`, `AFTER_CLOSING`, `OPEN_HOURS`. Unknown codes are shown with no text.
- `POST /shops/:id/override`: UI sends `{ state: "ARMED"|"DISARMED", minutes }` and then re-reads security-state (response body not relied on). Please confirm body shape, and add an `overrideUntil` field to security-state so the UI can say when the override ends.
- `evaluatedAt` must be refreshed on every evaluation: the UI treats an answer older than 2 minutes as unknown.
- Please add `overrideUntil?: string` (UTC ISO) to `SecurityState` in `@dbi/api-types`; the UI already reads it. A way to end an override early (e.g. `DELETE /shops/:id/override`) would let the UI offer a real cancel.

## Phase 7 additions (alerts / evidence / review)

- Evidence shape the UI reads from `GET /events/:id`: `evidence: { snapshotUrl?, clipUrl?, expiresAt? }` with short-lived, access-controlled addresses the browser can load directly (cookie or signed). Please confirm, or tell us the endpoint to call. Add it to `@dbi/api-types`.
- `GET /shops/:id/events` is assumed to return `{ items, nextCursor }` with `limit` and `cursor` query params. Server-side filters (`reviewStatus`, `eventType`) would let the filters search all alerts, not only loaded ones.
- `POST /events/:id/review` response: UI uses `{ event }` when present; otherwise it applies the chosen status locally.
- Event `confidence` is 0..1; the UI shows High (>=0.8), Medium (>=0.5), Low.

## Phase 8 additions (notifications / settings)

- `GET /notifications`: UI expects `{ notifications: [{ id, eventId?, channel, status, createdAt }] }`. There is no title or text, so rows read "Alert notification" / "Notification". Please add a short `title` if you want richer rows. Add `read`/`readAt` if unread state is wanted.
- Push token: what is `token` for the web? The UI sends the JSON of a Web Push subscription (needs `NEXT_PUBLIC_VAPID_PUBLIC_KEY`). If you use FCM, tell us and the key/SDK to use. No endpoint exists to unregister a token.
- `GET/PUT /notifications/preferences` (assumed): `{ push: boolean, inApp: boolean, types: { PERSON_IN_ZONE, POSSIBLE_SHUTTER_INTERACTION, POSSIBLE_TAMPERING, CAMERA_OFFLINE, AI_OFFLINE: boolean } }`, GET answers `{ preferences }` or `null` before the first save. The server must still deliver safety notices according to these flags.
- `PATCH /auth/me { name }` (assumed) returning `{ user }`. Email change and password change are not built (no endpoint, and they need verification).
- Please add `shopId` to each notification (the UI already uses it for links). Without it, links use the currently selected shop and the alert page redirects to the event's own shop.

## Phase 9 additions (hardening)

- Dependency advisories: `next@14.2.15` (owner and superadmin) has critical advisories fixed in 14.2.x patches (latest 14.2.35, same minor). Please agree one coordinated bump for all workspaces, since the lockfile is shared. `express` and `mongoose` in the backend also have advisories.
- Content-Security-Policy is not set. A strict CSP needs nonces for Next's inline scripts and an allow-list for evidence image/video hosts (needs the evidence URL decision). Add when the evidence host is known.
- Cookie flags are the backend's job: `HttpOnly`, `Secure` (in production), `SameSite=Lax` or stricter, and CSRF protection if cookies are used across sites.