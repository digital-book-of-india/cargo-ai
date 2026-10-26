# Dev 1 (Owner Experience): Context and Work Log

> Single source of truth for Dev 1. **Update this file at the end of every task.**
> Last updated: 2026-10-12 (after Phase 9 gap closure)

## 1. Project in one paragraph

DBI Intelligence is a web-first SaaS that watches a shop shutter/gate during scheduled closed hours
using the owner's **existing CCTV** (RTSP/DVR/NVR). The owner registers, creates a shop, sets
opening/closing times, connects a camera, draws a shutter zone and receives alerts for suspected
after-hours activity. No extra sensors or lock hardware. Android APK is a later phase.

Source document: "DBI Intelligence Final Combined Developer Handoff v2.0".

## 2. My role

**Developer 1: Owner experience.** I own the Shop Owner Web Panel (UI plus integration with owner APIs).

- I do **not** build a second auth or shop data model.
- Dev 2 owns Super Admin (`apps/superadmin`, `apps/backend/src/modules/superadmin`).
- Dev 3 owns models, schedule/security-state logic, camera/event services, AI worker, contract.
- All three are full-stack, but each has one accountable area. No edits to another dev's files without coordination.

## 3. Repository

- Remote: `https://github.com/digital-book-of-india/theaft-ai.git`
- `main`: stable. Skeleton pushed as commit `3d1bbcc`.
- **Working branch for everyone: `feature/develop`** (single shared branch).
- Push flow: `git add apps/owner` -> `git commit` -> `git pull origin feature/develop --rebase` -> `git push origin feature/develop`.

### Layout (npm workspaces)

```
apps/owner         @dbi/owner        Dev 1   :3000   <- my area
apps/superadmin    @dbi/superadmin   Dev 2   :3001
apps/backend       @dbi/backend      Dev 3 core, modules/owner Dev 1, modules/superadmin Dev 2   :4000
apps/ai-worker     Python stub       Dev 3
packages/api-types @dbi/api-types    contract types
packages/ui        @dbi/ui           tokens.css
packages/validation @dbi/validation  zod schemas
docs/  infra/  .github/CODEOWNERS
```

### My folders

```
apps/owner/src/app/(auth)/        login, register
apps/owner/src/app/(app)/         dashboard, onboarding, notifications, settings, shops/[shopId]/{schedule,cameras,alerts}
apps/owner/src/components/        ui, common, layout, dashboard, shop, schedule, camera, alerts
apps/owner/src/lib/api/           client.ts + auth, shops, schedule, cameras, events, notifications
apps/owner/src/lib/{auth,validation,utils}
apps/owner/src/{hooks,mocks,types}
apps/backend/src/modules/owner/   backend modules for owner endpoints (coordinate with Dev 3)
```

### Commands

```
npm install                 # from repo root, once
npm run dev:owner           # http://localhost:3000
npm run typecheck           # all workspaces
npm run build:owner
```

## 4. Requirements (checklist)

### Screens
- [x] Register / login / logout (mock backend; real backend untested)
- [x] Onboarding with checklist (until camera and schedule are set up) (mock backend)
- [x] Shop create / edit (mock backend)
- [x] Weekly schedule (open/close, closed day, overnight, grace 0-60) (mock backend)
- [x] Schedule exceptions/holidays (special days UI) (mock backend)
- [x] Camera connect + status + test (mock backend)
- [x] Shutter/gate zone editor (polygon, normalized 0..1) (mock backend; no live camera picture)
- [x] Security state + manual override (mock backend; no cancel endpoint)
- [x] Alerts list + detail (mock backend)
- [x] Evidence viewer (mock backend; evidence URL shape is an open question)
- [x] Event review (reviewed / false alarm / confirmed) (mock backend)
- [x] Notifications list + push-token registration (mock backend; real web-push needs a VAPID key and backend contract)
- [x] Notification preferences (mock backend; endpoint is assumed, not in the catalogue)
- [x] Profile / settings (mock backend; name edit endpoint is assumed)
- [x] Dashboard cards: Security Status, Today's Schedule, Camera Health, Latest Alerts (mock backend)

### Cross-cutting
- [x] Loading, empty, error, success states on every screen (verified over mock and fake HTTP; real backend untested)
- [x] Responsive: desktop, tablet, phone (360 / 768 / 1024 swept)
- [x] DEMO label on all seed/mock data (banner in mock mode, badges for flagged data)
- [x] Standard error shape handled `{ error: { code, message, requestId } }` (`friendlyMessage`, `ApiErrorState`)
- [x] 401/403 handled (global 401 handler, `ApiErrorState` for 403/404; to be applied on each data screen)
- [x] Times shown in shop IANA timezone (API sends UTC ISO-8601)
- [x] Frontend API client + owner-facing validation
- [x] README section, env vars used, endpoints completed, known gaps

### Theme tokens
primary `#2563EB`, white `#FFFFFF`, pale `#EFF6FF`, border `#DBEAFE`, text `#0F172A`,
success `#16A34A`, warning `#D97706`, danger `#DC2626`. Brand text: "DBI Intelligence".

## 5. Non-negotiable rules

1. Show **MONITORING / protected only when the API says `MONITORING`**. Otherwise show OFFLINE / DEGRADED / DISARMED / SETUP_REQUIRED honestly.
2. Conservative labels: "Possible shutter interaction", "Suspicious activity near shutter". Never "theft detected".
3. Never render or log the full RTSP URL or camera password. Show safe fields only (name, status, lastFrameAt).
4. No hardcoded success responses. Seeded events are never shown as live.
5. Never show push as "sent" unless the API says so. If FCM is not configured: "push integration pending".
6. No face recognition.
7. Do not claim anything is complete until tested against the real service.
8. If blocked, reduce scope openly.

## 6. Enums the UI must handle

| Name | Values |
|---|---|
| Monitoring state | MONITORING, DISARMED, DEGRADED, OFFLINE, SETUP_REQUIRED |
| Desired state | ARMED, DISARMED |
| Camera status | PENDING_TEST, ONLINE, OFFLINE, ERROR |
| Event type | PERSON_IN_ZONE, POSSIBLE_SHUTTER_INTERACTION, POSSIBLE_TAMPERING, CAMERA_OFFLINE, AI_OFFLINE |
| Review status | NEW, REVIEWED, FALSE_ALARM, CONFIRMED |
| Notification | channel PUSH/IN_APP, status PENDING/SENT/FAILED |
| Zone | type SHUTTER/GATE/ENTRANCE/CUSTOM, sensitivity LOW/MEDIUM/HIGH |
| Shop status | PENDING_SETUP, ACTIVE, SUSPENDED |

## 7. Endpoints I consume (`/api/v1`)

- Auth: `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- Shops: `POST /shops`, `GET /shops`, `GET /shops/:shopId`, `PATCH /shops/:shopId`
- Schedule: `GET|PUT /shops/:shopId/schedule`
- Security: `GET /shops/:shopId/security-state`, `POST /shops/:shopId/override`
- Cameras: `POST|GET /shops/:shopId/cameras`, `POST /cameras/:cameraId/test`, `PATCH /cameras/:cameraId`, `PUT /cameras/:cameraId/zones`
- Events: `GET /shops/:shopId/events`, `GET /events/:eventId`, `POST /events/:eventId/review`
- Notifications: `POST /notifications/push-token`, `GET /notifications`

## 8. Strategy (phases)

| Phase | Name | Status |
|---|---|---|
| P0 | Align and unblock (branch, open questions, flow) | In progress (open questions still unanswered) |
| P1 | Foundation: mock layer, UI primitives, states, shell | **Done** (2026-10-12) |
| P2 | Auth and session | **Done** (2026-10-12) |
| P3 | Shop and onboarding | **Done** (2026-10-12) |
| P4 | Schedule | **Done** (2026-10-12), including holidays/special days |
| P5 | Camera and zone | **Done** (2026-10-12) |
| P6 | Security state and dashboard | **Done** (2026-10-12) |
| P7 | Alerts, evidence, review | **Done** (2026-10-12) |
| P8 | Notifications and settings | **Done** (2026-10-12) |
| P9 | Hardening (truthfulness, secrets, states, responsive) | **Done** (2026-10-12), see "Phase 9 audit" |
| P10 | Real integration (mocks off) | Not started |
| P11 | QA and handoff docs | Not started |

Cut order if short on time: schedule exceptions, notification preferences UI, clip playback, polling polish.
Never cut: auth guard, truthful status, secrets handling, error/empty states, DEMO labels.

## 9. Open questions (unanswered)

1. Auth method: cookie session or bearer token? (affects `lib/api/client.ts`, `middleware.ts`)
2. Evidence (snapshot/clip): how does the browser get an access-controlled URL? No endpoint in the catalogue.
3. Notification preferences: no endpoint in the catalogue.
4. Profile/settings update: only `GET /auth/me` exists.
5. Camera test: synchronous or queued/polled?
6. Override request body (state, duration, reason) not specified.
7. Event list pagination format not specified (current assumption: `{ items, nextCursor }`).
8. Who implements owner endpoints (shops, schedule, cameras, events)? Document is ambiguous.
9. Backend base URL/port assumed `http://localhost:4000/api/v1`.
11. Schedule PUT response example only has `version` and `nextTransitionAt`; the UI re-reads with GET so it works either way. Still confirm, and confirm that GET returns `exceptions` and `nextTransitionAt`.
13. How does an owner supply camera credentials? The contract has only `streamUrl` and `credentialSecretRef`. The UI sends credentials inside the (masked) address; confirm this is acceptable and that the backend moves them into the secret store.
14. No snapshot/preview endpoint, so the zone editor cannot show the real camera picture (owner can use a guide screenshot).
16. Add `GET` for the saved zone and `DELETE` for a camera (see `docs/gaps/dev1-owner.md`).
15. `POST /cameras/:id/test` response body is not specified (we re-read the list instead).
12. `exceptions` is not in `@dbi/api-types`; ask Dev 3 to add it (kept as a local type for now).
10. No `GET` endpoint for a camera zone, so the editor cannot show a previously saved zone.

## 10. Current state

- Phase 1 (Foundation) is done. **Route pages are still placeholders** ("Not built yet").
- **Design system (shadcn/ui style, added after Phase 2)** is in place: see "Design system" below.
- Implemented:
  - API client with error parsing, typed API files, zod schemas (`@dbi/validation`), contract types.
  - **Mock layer** (`src/mocks/store.ts`, `handlers.ts`), switched by `NEXT_PUBLIC_USE_MOCKS`.
  - UI primitives in `src/components/ui` (shadcn/ui pattern on Radix): Button, Card (+Header/Title/Description/Content/Footer),
    Input, TextField (label + error + password toggle), FormField, Label, Select/SelectField, Badge (with dot), Dialog + Modal,
    Skeleton, Switch, Checkbox, Tabs, Progress, Avatar, Separator, Tooltip, DropdownMenu, Toaster (sonner).
  - Common: LoadingState, EmptyState, ErrorState (retry + requestId), Alert, DemoBadge, DemoBanner, StatusBadges, `EVENT_TYPE_LABEL`.
  - `useAsync` hook (loading/error/data/reload), `cn` helper.
  - Shell: desktop sidebar (icons, active state, user menu), phone top bar + bottom tab bar, DEMO banner, `PageHeader`,
    `PlaceholderPage`, `Brand`.
  - Dev-only `/ui-preview` page showing every primitive (404 in production).
- **Auth (Phase 2)**: `AuthProvider` + `useAuth` (status loading/authenticated/unauthenticated/error),
  login and register forms with inline validation, route guard `RequireAuth` for `(app)`,
  `RedirectIfAuthed` for `(auth)`, sign out in the sidebar, global 401 handler, `safeNextPath`
  (open-redirect safe), `friendlyMessage`, `ApiErrorState`.
- **Shop and onboarding (Phase 3)**: `ShopProvider`/`useShop` (shop list, current shop persisted in localStorage),
  `ShopSwitcher` (sidebar + phone top bar), create shop (`/shops/new`), shop profile + edit (`/shops/[shopId]`),
  `ShopForm` (IANA timezone select with offsets, address), onboarding checklist (`/onboarding`) driven by
  `computeOnboarding` (pure function), shop-scoped navigation (`buildNav`), dashboard redirects new owners to setup.
- **Schedule (Phase 4)**: `/shops/[shopId]/schedule` with `WeeklyScheduleForm`, pure logic in `lib/schedule.ts`.
- **Camera and zone (Phase 5)**: `/shops/[shopId]/cameras` (`CameraCard`, `CameraFormDialog`) and
  `/shops/[shopId]/cameras/[cameraId]/zone` (`ZoneEditor`), logic in `lib/camera.ts` and `lib/zone.ts`.
- Not implemented: dashboard cards, alerts, notifications, settings screens.
- Backend: every router is an empty stub. No models, no auth, no DB connection.

### Shop and onboarding behaviour (Phase 3)

- One owner can have several shops. `GET /shops` fills `ShopProvider`; the current shop is the stored one if it still
  exists, otherwise the first. Switching goes to `/dashboard`. Opening `/shops/[id]` makes that shop current.
- A new owner (no shops) is sent from `/dashboard` to `/onboarding`, which shows "Create your shop".
- Create shop: name required, timezone required and must be a valid IANA zone (default `Asia/Kolkata`), address optional.
  On success: toast, shop becomes current, user goes to `/onboarding`.
- Edit shop: Save stays disabled until a field changes; success toast; header and switcher update. 403 and 404 render
  `ApiErrorState` (no retry). `SUSPENDED` shows a warning banner.
- Checklist steps and rules (`lib/onboarding.ts`):
  1 shop exists; 2 schedule has `version > 0` and days; 3 at least one camera; 4 at least one camera `ONLINE`
  (OFFLINE/ERROR with none online -> "Needs attention"); 5 zone saved.
  Steps depending on missing earlier steps are locked. "Complete" means configured, not that monitoring is live.
- **Zone step is client-side only**: there is no `GET` zone endpoint, so the browser remembers saved zones in
  localStorage (`dbi-zone-saved`, helper `markZoneSaved(cameraId)` in `lib/utils/storage.ts`). Phase 5 must call it
  after a successful zone save. This is wrong if the owner uses another browser. Replace when a GET endpoint exists.
- Schedule, Cameras and Alerts links from the checklist go to placeholder pages until Phases 4, 5 and 7.

### Camera and zone behaviour (Phase 5)

- **Secrets:** the stream address (it may contain a username and password) is only sent to the API. The field is
  masked (password input with show/hide), cleared when the dialog closes, never rendered or logged, and never stored
  in localStorage. The edit dialog never shows the current address; blank means "keep it". `redactStreamUrl` exists for
  any message that could echo an address. Verified: no secret in DOM, sessionStorage or localStorage after add/test.
- **Statuses stay fresh:** the cameras page re-reads the list every 15 s (`NEXT_PUBLIC_CAMERA_REFRESH_MS`) while the tab
  is visible, on tab focus, and on the Refresh button; it pauses during a running test. If a refresh fails it says
  "Could not refresh. These statuses may be out of date (last checked ...)" and keeps showing the last known values.
- **Add/edit:** name, connection type (RTSP/ONVIF; locked when editing because PATCH cannot change it), address validated client-side (`checkStreamUrl`: rtsp:// or rtsps://,
  host, port 1-65535, no spaces). Editing with a new address resets the camera to "Not tested yet".
- **Test connection:** calls `POST /cameras/:id/test`, then re-reads the list every 2 s (up to 10 times) until the
  camera leaves `PENDING_TEST`, showing "queued, waiting" meanwhile. Result text per status is in
  `TEST_RESULT_MESSAGE`. A camera that is not ONLINE shows a warning that the shutter is not monitored.
- **Zone editor:** SVG canvas (16:9). Click adds a point, drag moves it, arrow keys nudge (Shift = bigger), Delete removes,
  quick starts (Lower half, Centre, Whole picture), Undo, Clear. Validation (`validateZonePoints`): 3-20 points, inside
  0..1, no self-crossing outline, area at least 1% of the frame. Concave shapes are allowed. Payload is rounded to
  4 decimals. Settings: area type, sensitivity, watch on/off.
- **No live camera picture:** there is no snapshot endpoint. The owner can pick a screenshot as a **guide picture**
  (file input, 8 MB, images only, `checkGuideImage`). It is shown through an object URL, never uploaded or stored,
  and the canvas takes the picture's aspect ratio (`canvasAspect`, clamped 1:1 to 3:1). Without one, the canvas is a
  plain stand-in and the UI says so.
- **Saved zone memory:** after a successful save the browser stores a copy (`dbi-zone-copy:<cameraId>`) and ticks the
  onboarding step (`dbi-zone-saved`). Both are per browser and are a convenience, not the source of truth.
  Keys are **scoped to the backend** (`key@localhost:4000`, or `@mock` in sessionStorage for mocks) so ids from another
  environment cannot tick the wrong step. Unscoped keys from older builds are removed once (`dbi-*` names only).
- **Edit:** the dialog is pre-filled with the name, the address field is empty ("blank keeps the current address"),
  saving with no changes closes without a request, a rename keeps the status, a new address resets it to "Not tested yet".
- **Unsaved changes guard** (`hooks/useUnsavedChangesGuard`): used on the zone and schedule pages. Closing/reloading the tab
  shows the browser prompt; clicking an in-app link shows "Leave without saving?" (Stay / Leave and discard).
  Not covered: the browser Back button and programmatic navigation (the shop switcher).
- **No delete camera:** the catalogue has no delete endpoint, so none is offered.
- Mock cheat sheet for cameras: address containing `offline` -> OFFLINE, `error` or `auth` -> ERROR, `slow` -> the test
  is queued and the result arrives about 3.5 s later. Otherwise ONLINE.

### Schedule behaviour (Phase 4)

- Loads shop + schedule together. `version 0` / no days = not configured: the form shows suggested hours
  (Mon-Sat 10:00-22:00, Sun closed, grace 5) with a warning that nothing is saved; Save is enabled.
- Each day: Open switch, `Opens`/`Closes` (native time input, `HH:mm`), "Closes after midnight (next day)", and a
  live "Monitoring arms at HH:mm (N min after closing)" line. Closed days show "monitoring stays armed".
- Validation (`validateWeek`): open days need both times; without next-day, closing must be after opening; with
  next-day, closing must be earlier than opening (10:00 -> 01:00 is valid; 10:00 -> 22:00 with the flag is not);
  grace must be a whole number 0-60. Errors show after a failed save attempt, with an error toast.
- "Copy to other open days" copies one day's hours (including next-day flag) to every other open day.
- **Holidays and special days** (`ExceptionsEditor`): add/remove rows with date, "Closed all day" or special hours
  (same rules as weekly days, overnight allowed), optional note (80 chars). Duplicate or invalid dates are rejected
  client-side. Dates before today (in the shop timezone) are tagged "Already passed". On those dates the hours replace
  the weekly hours.
- Save sends all 7 days (closed days without times) plus grace. `exceptions` is sent only when the GET returned the
  field or the owner added some, so saving never wipes holidays the API did not show us; sending `[]` clears them.
  After saving it re-fetches (GET) so the form shows what the server stored. The PUT response is not used for
  the weekly data (the handoff example only returns `shopId`, `timezone`, `version`, `nextTransitionAt`).
- Shows `Saved version N`, and `Next change` in the shop timezone only when the API sends `nextTransitionAt`.
- Exceptions are typed locally (`ScheduleException` in `lib/schedule.ts`); `@dbi/api-types` has no field for them yet.
- Warns on page close with unsaved edits. Save is disabled when nothing changed (and the schedule is saved).
- The "arms at" text is what the schedule implies, not live state. Live state is the security state (Phase 6).

### API client behaviour over real HTTP (`lib/api/client.ts`)

- `credentials: "include"` (cookie session). Verified with an HttpOnly cookie from another origin.
- `readResponse`: tolerates empty bodies (204/202), non-JSON error pages (proxy 502) and unwrapped payloads; error
  envelope `{ error: { code, message, requestId } }` becomes `ApiError`. Server detail is never shown for 5xx
  (`friendlyMessage`).
- Timeout: `REQUEST_TIMEOUT_MS` (20 s, override with `NEXT_PUBLIC_REQUEST_TIMEOUT_MS`) -> `ApiError(0, "TIMEOUT")`.
  Caller abort -> `ABORTED`; unreachable -> `NETWORK_ERROR`. A failed session check shows an error with retry and does
  **not** pretend the owner is signed out.
- Bug fixed here: a success response with an empty body used to throw `TypeError` (for example 204 on logout).

### Testing without the real backend

- Mock layer (`NEXT_PUBLIC_USE_MOCKS=true`) for fast UI work.
- For the real fetch path, run a small HTTP fake (cookie session, CORS credentials, `{data}` and error envelopes, 204/202,
  500, 502 HTML, slow endpoint) and start the app with `NEXT_PUBLIC_USE_MOCKS=false` and
  `NEXT_PUBLIC_API_BASE_URL=http://localhost:<port>/api/v1`. The fake used for Phase 5 verification was throwaway and is
  not committed. The real backend replaces it in Phase 10.
- Contract requests for Dev 3 are listed in `docs/gaps/dev1-owner.md`.

### Design system

- **Stack:** Tailwind 3 + shadcn/ui conventions (class-variance-authority, tailwind-merge, Radix primitives, lucide-react,
  sonner). Components are hand-written source (shadcn is copy-paste), kept PascalCase to avoid case clashes on Windows.
  `components.json` exists, but prefer writing components by hand over `npx shadcn add` (it creates lowercase files).
- **Tokens:** HSL CSS variables in `src/app/globals.css`, mapped in `tailwind.config.ts`. Brand values:
  primary `#2563EB`, accent/pale `#EFF6FF`, border `#DBEAFE`, foreground `#0F172A`, success/warning text colours are
  slightly darkened for contrast. Legacy aliases (`pale`, `line`, `ink`, `danger`) still work.
- **Font:** Geist Sans via the `geist` package (bundled, no network at build time).
- **Feedback:** `toast.success(...)` / `toast.error(...)` from `sonner` for success and failure messages.
- **Icons:** lucide-react, used sparingly (nav, status, empty states) per "minimal icons".
- **Status wording** lives in `components/common/StatusBadges.tsx` (`monitoringMeta` has label + hint per state).
- **Not shared yet:** these components live in `apps/owner`. If Dev 2 wants them, extract to `packages/ui` by agreement.
- **Preview:** `/ui-preview` (dev only) shows every component.
- **Verified:** screenshots of login, register, shell (desktop) and phone width (390px) in Chrome.
- Bundle note: `/login` first load JS is about 169 kB (Radix + lucide + sonner). Acceptable for now; revisit in hardening.

### Mock layer cheat sheet (DEMO data only)

- Login: `owner@demo.test` / `Demo@1234` (other credentials -> 401). Register creates a new owner with no shops.
- The demo owner starts with one shop `shop_demo` (setup pending, no schedule, no camera).
- `GET /shops/shop_forbidden` -> 403. Unknown shop -> 404.
- Camera stream URL must start with `rtsp://` or `rtsps://`. After "test":
  URL containing `offline` -> OFFLINE; containing `error` or `auth` -> ERROR; otherwise ONLINE.
- Stream URL is never returned. Camera response has only id, shopId, name, protocol, status, lastFrameAt.
- Security state is derived honestly: no schedule/camera or untested camera -> SETUP_REQUIRED;
  open hours -> DISARMED; armed + camera ONLINE -> MONITORING; armed + camera not ONLINE -> OFFLINE.
- Schedule with no days and `version: 0` means "not configured".
- `nextTransitionAt` is **derived** from the saved schedule, exceptions and shop timezone (`src/mocks/transition.ts`,
  minute scan up to 8 days) and omitted when nothing would ever flip (all closed or always open). Close 22:00 +
  5 min grace gives 22:05, matching the handoff example. The real server owns this logic.
- Mock `PUT /shops/:id/schedule` answers in the handoff shape (`shopId`, `timezone`, `version`, `nextTransitionAt`),
  so the UI is exercised against the real contract shape. Duplicate or malformed exception dates are rejected (400).
- Events are seeded (DEMO, `demoFlag: true`) the first time a shop with a camera lists events.
  Pagination: `limit` and `cursor` (index string), `{ items, nextCursor }`.
- Data persists in sessionStorage for the tab session.

### Auth behaviour (Phase 2)

- Session is checked once on load via `GET /auth/me`. 401 -> signed out. Network/5xx -> error state with
  retry (the app does not pretend the user is signed out).
- `/dashboard` etc. while signed out -> `/login?next=<path>`. After login the user goes to `next`
  (validated by `safeNextPath`, same-site relative paths only, never `/login` or `/register`).
- Signed-in user opening `/login` or `/register` -> redirected to `next` or `/dashboard`.
- A 401 from any non-`/auth/*` request means the session is gone: user is sent to
  `/login?reason=expired` and sees "Your session expired".
- Register: after `POST /auth/register` the app calls `GET /auth/me`; if that is 401 (backend did not
  open a session) it signs in with the same credentials. Works for both backend behaviours.
- Sign out clears the local session even if the logout call fails.
- A user with role `SUPER_ADMIN` opening the owner panel sees a notice and a sign-out button.
  Assumption: `SHOP_OWNER` and `SHOP_STAFF` may both use the owner panel. Confirm.
- The guard is **client-side only** (UX). `middleware.ts` was intentionally not added: with an HttpOnly
  cookie or mock sessionStorage it cannot validate the session reliably. Revisit when the auth method is known.

## 11. Work log

| Date | Work | Verified |
|---|---|---|
| 2026-10-12 | Read handoff document; defined Dev 1 scope and requirements | n/a |
| 2026-10-12 | Created `frontend/` skeleton (Next.js 14, TS, Tailwind, API client, types, zod, 13 placeholder pages) | typecheck + `next build` |
| 2026-10-12 | Reorganized into `frontend/owner`, `frontend/superadmin`, common `backend`, `ai-worker`, `shared`, `infra`, `docs` | build + typecheck |
| 2026-10-12 | Migrated to monorepo: `apps/*`, `packages/*`, root npm workspaces, `@dbi/*` packages | `npm run typecheck`, both `next build` OK |
| 2026-10-12 | Expanded root `.gitignore` (env, evidence/video, python, logs) | `git check-ignore` |
| 2026-10-12 | Committed and pushed to `main` (`3d1bbcc`). User created shared branch `feature/develop` | `git push` OK |
| 2026-10-12 | Wrote this context file | n/a |
| 2026-10-12 | **Phase 1 Foundation**: mock layer, UI primitives, status badges, states, `useAsync`, shell, `/ui-preview` | typecheck, 31-case mock test script, isolated `next build`, dev server render of `/ui-preview`, `/dashboard`, `/login` |
| 2026-10-12 | Fixed skeleton bug: `src/middleware.ts` contained only `export {}`, which made `next dev` return 500 on every page. File removed (real middleware comes in P2) | dev server returns 200 |
| 2026-10-12 | `next.config.js` now honours `NEXT_DIST_DIR`; `.next-*` gitignored | isolated build ran |
| 2026-10-12 | **Design system upgrade**: shadcn/ui-style components on Radix, HSL tokens, Geist font, redesigned shell (sidebar, phone tabs, user menu), split-panel auth screens, toasts, empty/error/alert states with icons, PageHeader, PlaceholderPage | typecheck, 31 mock cases, 15 util cases, 7 handler cases, isolated `next build`, Chrome screenshots (desktop + 390px), login and sign-out via new user menu |
| 2026-10-12 | **Phase 5 gap closure**: camera edit verified end to end (and a dead "connection type" control locked), unsaved-changes guard for zone and schedule pages, cameras page status auto-refresh with stale warning | typecheck; 13 camera-edit API cases; all earlier suites; real browser over real HTTP: edit dialog (prefill, masked address, validation, rename keeps Online, no-op sends nothing, new address resets), camera flipped offline server-side shows Offline in about 3 s with no click, server stopped shows the stale warning, guard on zone and schedule (dirty/clean beforeunload, link click dialog, Stay keeps edits, Leave navigates, saved or discarded means no prompt); isolated `next build` |
| 2026-10-12 | **Phase 5 follow-ups**: real-HTTP verification with a fake backend; API client hardened (empty bodies, timeout, abort); storage keys scoped per backend with legacy cleanup; zone guide picture (client-only) with aspect-aware canvas; contract requests written to `docs/gaps/dev1-owner.md` | typecheck; 18 real-HTTP cases (envelopes, cookie, 204, 502 HTML, 429, 500, timeout, abort); 46 camera/zone cases; all earlier suites; real browser over real HTTP with mocks off: login with HttpOnly cookie, schedule save, camera add + test with empty 202 body, guide picture 4:3 + wrong file rejected, zone save, session expiry, logout 204, 500/timeout/network-down states; isolated `next build` |
| 2026-10-12 | **Phase 5 Camera and zone**: `lib/camera.ts`, `lib/zone.ts`, `CameraFormDialog`, `CameraCard`, cameras page (add, edit, test with polling), `ZoneEditor`, zone page; mock supports queued tests and URL changes | typecheck; 35 camera/zone unit cases (URL rules, redaction, time-ago, geometry incl. bow-tie and concave); all earlier suites; real browser run: validation, masked field, no secret in DOM/storage, immediate and queued test, offline and error states, 4 clicks = 4 points, drag, keyboard nudge/delete, bow-tie rejected, save, reload prefill, onboarding 4/5; phone width; isolated `next build` |
| 2026-10-12 | **Phase 4 follow-ups**: holidays/special days editor (`ExceptionsEditor`, exception validation helpers); mock now answers PUT in the handoff shape, supports exceptions, and derives `nextTransitionAt` (`mocks/transition.ts`) | typecheck; 20 exception unit cases; 25 transition cases (handoff example 16:35Z, overnight, grace past midnight, holidays, special hours, never-flips); 14 mock schedule API cases; all earlier suites; real browser run: add rows, empty/duplicate/bad-time errors, save v2, reload persistence, remove and save v3, Next change line; isolated `next build` |
| 2026-10-12 | **Phase 4 Schedule**: `lib/schedule.ts`, `WeeklyScheduleForm`, schedule page (defaults, validation, overnight, copy to days, grace, save + reload, unsaved-changes guard); `scheduleApi.update` passes exceptions through | typecheck; 38 unit cases (validation, overnight, arms-at, conversion, dirty, copy); earlier suites; real browser run: defaults + warning, invalid close time and grace errors with toast, overnight Friday, closed Saturday, copy to days, save v1/v2, full reload persistence, onboarding 2/5; phone width; isolated `next build` |
| 2026-10-12 | **Phase 3 Shop and onboarding**: ShopProvider, ShopSwitcher, create shop, shop profile edit, timezone select, onboarding checklist + `computeOnboarding`, shop-scoped nav, dashboard redirect for new owners | typecheck; 23 unit cases (onboarding rules, timezones); earlier suites (31 + 15 + 7); real browser run: register -> empty onboarding -> create shop (validation, toast) -> 1/5 checklist -> edit profile (save gating, toast, header update) -> 403 page -> add second shop -> switcher; phone width; isolated `next build` |
| 2026-10-12 | **Phase 2 Auth and session**: AuthProvider/useAuth, login + register forms, route guard, redirect-if-authed, sign out, global 401 handler, safeNextPath, friendlyMessage, ApiErrorState | typecheck; 15 unit cases (safeNextPath, messages); 7 handler cases; real browser run of guard, validation, wrong password, login, reload, signed-in /login redirect, sign out, register; isolated `next build` |

## 12. Known issues / notes

- **Never run `next build` while `next dev` is running from the same folder**: both write `apps/owner/.next` (EPERM / broken dev server).
  To build in parallel use `NEXT_DIST_DIR=.next-verify npx next build` (run from `apps/owner`).
  Next may add that folder to `tsconfig.json` `include`; revert that change before committing.
- Browser testing note: clicking by ref/coordinates in the automation tool sometimes does not fire React
  handlers; keyboard Enter and `element.click()` do. This is a test-tool quirk, not an app bug.
- Mock session lives in `sessionStorage` (per tab). Closing the tab signs the demo user out.
- Zone editor has no endpoint to load an existing zone (only `PUT`). See open question 10.
- `next@14.2.15` is flagged by npm as having a security vulnerability. Upgrade to a patched 14.2.x before real deployment.
- Windows prints LF->CRLF warnings on `git add`. Harmless.
- `package-lock.json` conflicts: take the remote version and re-run `npm install`.
- `apps/owner/src/types/index.ts` re-exports `@dbi/api-types`; edit types in `packages/api-types` (Dev 3 owns it, coordinate).
- The AI endpoint path is written two ways in the document (`/internal/v1/...` vs `/api/v1/internal/v1/...`). Not my area; currently mounted at `/internal/v1`.

### Phase 6 behaviour (security state + dashboard)

- `/dashboard` shows four cards: Security status (hero), Today's hours, Camera health, Latest alerts. Finish-setup checklist shows above them until setup is complete.
- Security state is polled every `NEXT_PUBLIC_SECURITY_REFRESH_MS` (default 30000) only while the tab is visible, plus on tab focus and the Refresh button.
- Pure logic lives in `lib/security.ts` (`deriveSecurityView`). Rules:
  - Only a fresh `MONITORING` answer reads as protected (Monitoring, green).
  - Failed refresh, no answer yet, answer older than 2 minutes, or unknown state value: "Status unavailable" (never protected), with "Last reported: X (n ago)".
  - `MONITORING` but camera `OFFLINE/ERROR/NONE/PENDING_TEST` or AI worker `OFFLINE`: downgraded to Degraded.
  - Unknown `reason` codes show no text rather than a raw code.
- Manual override: "Pause monitoring" (when desired is ARMED) or "Arm now" (when DISARMED). Hidden for Setup required and unknown status. Confirmation dialog with duration (30m/1h/2h/4h) and a plain warning that pausing means no monitoring and no alerts. After POST the real state is re-read (response body is unspecified); a toast confirms. Errors show inside the dialog.
- Manual pause wording: "paused by a manual override. Your shutter is not being watched" (not "because your shop is open").
- Each lower card loads on its own: one failing card shows its own error + retry and never looks empty. Camera and alert cards refresh with each security poll.
- Today's hours use the shop timezone (`todayHours`, `dayInTimezone` in `lib/schedule.ts`); an exception for today's date wins over the weekly row. No data for today: says so instead of guessing.
- `monitoringMeta` in StatusBadges is now derived from `MONITORING_COPY` in `lib/security.ts` (single source of wording).
- Parts row on the status card: Camera and AI monitoring, each Online / Offline / Error / Not tested / Not connected / Unknown (`subsystemHealth`). Unrecognised values read "Unknown", never "Online". While status is stale both read Unknown.
- "Override ends <time in shop timezone>" shows only when the API sends `overrideUntil` with `MANUAL_OVERRIDE` and it is in the future (type extension `SecurityState` in `lib/security.ts`; not in `@dbi/api-types` yet).
- Mock: `db.aiWorkerState` knob (default ONLINE); AI not ONLINE makes the mock report DEGRADED; mock returns `overrideUntil`.
- No "cancel override" button: the contract has no such endpoint. Owner can set the opposite override.
- Tests: `securitytest` (56 cases). Browser over real HTTP (fake backend): Monitoring; AI worker offline -> Degraded + "AI monitoring Offline" without a click; override end time shown; backend killed -> "Status unavailable", parts Unknown, last reported shown, no override buttons; 360 px width: no horizontal scroll, all 4 cards. Mock-mode run: setup-required, monitoring, pause, offline-not-protected.

### Phase 7 behaviour (alerts, evidence, review)

- `/shops/:id/alerts`: newest first, 10 per page with "Load more" (cursor). Filters (review status tabs with counts, type select) apply to the loaded alerts only and say so while more pages exist. States: loading, empty ("No alerts does not guarantee that nothing happened"), no match + clear filters, error (403/404/retry), refresh failure keeps old list with a warning, load-more error keeps the list.
- Rows show type, review badge, DEMO badge, shop-timezone time + "n ago", camera name, High/Medium/Low confidence (never a bare percentage).
- `/shops/:id/alerts/:eventId`: details, evidence, review. An event of another shop reads as "not found". Automatic-suggestion caveat for detections; system notices (`CAMERA_OFFLINE`, `AI_OFFLINE`) get a different note and no confidence row.
- Evidence (`lib/events.ts`, `EvidenceViewer`): reads `event.evidence.snapshotUrl` / `clipUrl` (not in api-types yet). Only http(s), relative and inline image data addresses are used (`isSafeEvidenceUrl`); anything else counts as no evidence. Addresses are only used as `src`: never logged, stored or put in a page address. States: system notice, no picture (retention), loading shimmer, load failure with "Try again" (re-reads the event, also retries the same address), clip failure, clip via `<video controls preload="none">`.
- Review: three buttons (reviewed / false alarm / confirm incident). The badge changes only after the server accepts; errors show inline; current choice is disabled with `aria-pressed`. Keeps the evidence if the response omits it.
- Mock: 13 seeded events (all `demoFlag`), snapshots are inline SVGs labelled "DEMO picture - not a real camera frame", none for system events or events older than 48 h.
- Auto refresh: the first page is re-read every `NEXT_PUBLIC_ALERTS_REFRESH_MS` (default 30000) while the tab is visible and on tab focus. New alerts are merged in (`applyLatest`), review changes made elsewhere are applied, older loaded pages and filters stay, and "N new alerts arrived." shows. A failed refresh keeps the list and shows "Could not refresh. These alerts may be out of date."
- Mock clip: shutter-interaction events carry `clipUrl: /demo/clip.webm` (`public/demo/clip.webm`, 2 KB, labelled DEMO, recorded in a browser). Real playback of the clip was not verified (see below).
- Tests: `eventstest` (55 cases), `eventapi` (28 API cases), browser (mock mode and real HTTP): auto-refresh with 2 injected alerts, status changed elsewhere, poll failure warning, Back button after review shows the new status, 768 and 1024 px widths, list/paging/filter, detail + evidence, review change + persistence, system event, old event, image failure + retry, 360 px width, 403, 404, empty.

### Phase 8 behaviour (notifications and settings)

- `/notifications`: newest first, channel badge (Push / In app), delivery badge (Waiting to send / Sent / Not delivered), shop-timezone time + "n ago", link to the alert when `eventId` exists (uses the current shop). A "Not delivered" row says so, and a banner counts them and points to Alerts. Refreshes on tab focus and the Refresh button. States: loading, empty, error/403/404, refresh failure keeps the list.
- `/settings` has Profile, Push notifications, Notification preferences, Your shop, Account (sign out).
- Profile (`ProfileCard`): only the name (1..80). Email is read-only. `PATCH /auth/me {name}` is an assumed endpoint; a 404/405/501 shows "Changing your name is not available yet." and nothing changes. Success updates the signed-in user everywhere (`updateUser` on the auth context).
- Push (`lib/push.ts`, `PushCard`): nothing runs until the owner clicks "Turn on notifications". The browser prompt is shown only if push can work (VAPID key + service worker, or the demo layer). States: unsupported, not set up for this service, blocked, off, on. Token goes to `POST /notifications/push-token`; a "registered" marker is kept per backend. Demo mode uses a clearly fake `demo-token-*` with a DEMO badge. Real mode sends the JSON push subscription as `token` (contract is open). `public/sw.js` shows a generic notice only (no picture, no detail).
- Preferences (`PreferencesCard`): push/in-app channels and five alert types. Assumed `GET/PUT /notifications/preferences`. Missing values read as ON (never silently muted). Turning off camera/AI offline warns that monitoring failures will not be reported; turning everything off asks for confirmation. Unsaved-changes guard, Discard, Save disabled until changed. A 404/405/501 shows "Preferences are not available yet. You will receive every alert."
- Auto refresh: re-read every `NEXT_PUBLIC_NOTIFICATIONS_REFRESH_MS` (default 30000) while visible and on tab focus, without a spinner. New rows are counted ("n new notifications arrived."); a failed refresh keeps the list and warns.
- Shop-aware links: a notification link uses its own `shopId` when the API sends one, otherwise the current shop. The alert detail page opens an event that belongs to another shop of the same owner under the right shop (and switches the shop switcher). Events of other owners still end in 403/404 from the API.
- Mock: notifications are derived from seeded events (6) plus the 2 seeded ones; one is FAILED. Preferences and push registration are stored per user.
- Tests: `notiftest` (preferences, list rules, merge + shop link rules, push permission rules incl. no prompt when denied/not configured, mock API: 71 cases); browser: list, failed banner, link to alert, profile validation + rename (sidebar updates), push enable with simulated permission (one prompt, none when already granted), preferences warn/save/discard/silence-confirm/unsaved guard/persistence, 360 px, and a stub API without the endpoints (preferences and profile "not available", push "not set up", empty notifications).

### Phase 9 audit (hardening)

Automated guard: `hardentest` (42 checks, scratchpad) scans the source and checks the demo layer.

- Truthfulness: copy reviewed. Removed "how your shop is protected" (login, dashboard) and "stored securely" (camera dialog); error page makes no safety claims. Only a fresh `MONITORING` reads as protected (Phase 6 rules).
- Secrets: no `console.*`, `eval`, `dangerouslySetInnerHTML`, `document.cookie`; browser storage only through `lib/utils/storage.ts` (and the mock store); no camera address with credentials in source; the address field is a password input. The demo database now keeps only a password hash, and a typed camera address/password never reaches storage or any API response (tested).
- Sign out clears this browser's selected shop, zone markers/copies and push marker (`clearOwnerStorage`); the demo database is kept.
- Headers (next.config.js): `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (camera/mic/geo off), `poweredByHeader: false`. No CSP yet (see gaps).
- Error handling: `error.tsx`, `global-error.tsx`, `not-found.tsx` (no technical detail shown).
- Production check: `/ui-preview` returns 404, security headers present, 404 page works.
- Accessibility: skip link + `main#main`, one `h1` per page, per-page `document.title`, focus ring, reduced motion, DOM audit of Settings (names, labels, ids, targets). Contrast: success/warning/destructive tokens darkened so text on their tinted backgrounds is >= 4.5:1 (brand #16A34A / #D97706 / #DC2626 are no longer used for text); verified from the real tokens.
- Responsive sweep (360 px) of all 14 screens, plus login/register at 768: no horizontal overflow, no stuck loading. Earlier phases covered 768/1024 for the data screens.
- Gap closure (second pass):
  - DEMO audit: mock mode shows the DEMO banner on every authed and auth screen; real mode never shows it, and only `demoFlag` events, `shop.demo` (dashboard, shop profile, shop switcher) and the demo push token carry badges. Dashboard now badges a demo shop. Static checks in `hardentest`.
  - Time zone audit: absolute times are formatted only by `formatInTimezone` (all screens listed by the test). A bad zone or timestamp no longer throws (UTC fallback, "Unknown time"); schedule helpers use `safeTimeZone`. Notifications use the zone of the notification's own shop.
  - States matrix (real HTTP, iframes): for shop, schedule, cameras, zone, alerts and alert detail, a 500 gives an error state with "Try again", a 403 "no access", a 404 "not found"; the shop page shows a loading state while the API is slow, then resolves. No screen ended blank or stuck.
  - Tablet sweep (real HTTP, iframes): 11 screens at 768 and 1024 px, 22 of 22 without horizontal overflow or a stuck loading state.
  - Colours checked by eye on the dashboard (stale status) and notifications (sent / waiting / not delivered / warning banner): readable, brand blue unchanged.
  - Deliberate sign out goes to `/login` without `?next=` (`signedOutByUser`); expired sessions still return to the page.
 `next@14.2.15` (critical advisories fixed in later 14.2.x patches), tailwindcss/postcss chain (dev-time) and, in the backend, express/mongoose. Not changed here because the lockfile is shared with Dev 2 and Dev 3; needs a coordinated bump (next 14.2.35 is the same minor).

## 13. Next step

Phase 10 (real integration, mocks off) needs Dev 3's backend: set `NEXT_PUBLIC_USE_MOCKS=false`, point
`NEXT_PUBLIC_API_BASE_URL` at it, then walk every flow and fix contract differences listed in
`docs/gaps/dev1-owner.md`. Phase 11: QA pass and final handoff docs. Until the backend exists, ask Dev 3
for the answers to the open questions (section 9) and coordinate the Next.js patch bump.
