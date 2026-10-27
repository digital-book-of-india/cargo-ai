# DBI Intelligence - Owner web (Dev 1)

Company users register a company, add sites (warehouses), connect CCTV cameras and review
alerts. Next.js 14 (App Router) + TypeScript + Tailwind + shadcn-style components.

This app only shows what the API reports. It never claims a site is protected when a camera or the AI worker is offline.
There is no mock data: every screen reads the real backend and database.

## Run

    # from the repo root, once
    npm install

    cd apps/owner
    cp .env.example .env.local     # set NEXT_PUBLIC_API_BASE_URL to the running backend
    npm run dev                    # http://localhost:3000

Other scripts: `npm run lint`, `npm run test`, `npm run typecheck`, `npm run build`.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:4000/api/v1` | Backend base URL (cookie session, `credentials: include`). |
| `NEXT_PUBLIC_REQUEST_TIMEOUT_MS` | `20000` | Per-request timeout. |
| `NEXT_PUBLIC_CAMERA_REFRESH_MS` | `15000` | Camera status refresh while the Cameras page is visible. |
| `NEXT_PUBLIC_ALERTS_REFRESH_MS` | `30000` | New-alert check on the Alerts page. |
| `NEXT_PUBLIC_NOTIFICATIONS_REFRESH_MS` | `30000` | Refresh on the Notifications page. |

All of these are public (shipped to the browser). Never put a secret in a `NEXT_PUBLIC_` variable.

## Screens

| Route | What it does |
|---|---|
| `/login`, `/register` | Sign in / create account |
| `/onboarding` | First-run page for a user with no site yet |
| `/dashboard` | Camera monitoring health, IN/OUT crossing totals and latest alerts |
| `/sites/new`, `/sites/:id` | Create and edit a site |
| `/sites/:id/cameras` | Add/edit a camera, connection test, live status |
| `/sites/:id/cameras/:cameraId/zone` | Draw counting lines and zones, pick object classes and confidence, validate and enable |
| `/sites/:id/cameras/:cameraId/live` | Live monitoring view: coverage badge, active zones, latest crossings (the preview image is a test card, not video) |
| `/sites/:id/alerts`, `/sites/:id/alerts/:eventId` | Alerts list, evidence viewer, review |
| `/notifications` | What we told you, delivery status |
| `/sites`, `/sites/new`, `/sites/:id` | Sites list (deactivate, archive), add a site, site profile |
| `/users` | Users and roles: invite people, change role and site access |
| `/accept-invitation?token=` | Join a company from an invitation link |
| `/alerts` | Company-wide alert inbox: filters (status, severity, type, assigned to me, date), review, notes, assignment |
| `/shipments` | Sessions (start/close, count vs manifest), Manifests (add, CSV import), Vehicles |
| `/reports` | Cargo activity by day (site time zone), shifts, coverage gaps, count differences, CSV export |
| `/audit` | Company audit trail (owners, admins, auditors) |
| `/settings` | Profile, company, operating settings (tolerance, evidence retention, shifts, notification rules) |

## Rules the UI follows

- "Monitoring" (protected) only for a fresh `MONITORING` answer; stale, failed or unknown answers read "Status unavailable".
- The camera address and password are only typed into a password field, never shown back, never logged, never stored in the browser or put in a URL.
- Evidence addresses are only used as `src` of an image or video.
- Times are shown in the site's time zone (the API sends UTC).
- Owner-facing wording is conservative: a camera cannot guarantee detection of everything.
- On sign out the app forgets the selected site, zone markers for this browser.

## Testing

`npm run test` runs the unit tests. Backend behaviour (tenant isolation, roles, invitations) is covered by the
integration tests in `apps/backend` (`npm run test:int -w @dbi/backend`), which use a throw-away database.

## Status and known gaps

Done: sites, users and roles, invitations, settings, alerts inbox, notifications, shipments, reports, audit trail, zone editor,
live view and dashboard counts. Menu items appear only for roles allowed to use them, and every action the API would refuse is
hidden or disabled.
Not yet done: the live view shows a generated test card, not real video. The Alerts, Notifications, Shipments, Reports and Audit
screens have not yet been checked in a real browser (see `CONTEXT_DEV1.md`, section 0).

Accessibility: DOM audit passes (names, labels, one `h1`, skip link, focus ring, reduced motion, AA contrast for the design
tokens). Not yet done: screen-reader pass and keyboard walkthrough on a real device.
