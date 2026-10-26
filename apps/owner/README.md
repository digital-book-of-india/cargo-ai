# DBI Intelligence - Owner web (Dev 1)

Shop owners register, connect a CCTV camera, draw a shutter zone and see
alerts. Next.js 14 (App Router) + TypeScript + Tailwind + shadcn-style components.

This app only shows what the API reports. It never claims a shop is protected unless the API
says `MONITORING` and the answer is fresh. Everything served by the mock layer is labelled DEMO.

## Run

    # from the repo root, once
    npm install

    cd apps/owner
    cp .env.example .env.local     # mocks on by default
    npm run dev                    # http://localhost:3000

Demo sign in (mock layer only): `owner@demo.test` / `Demo@1234`.

Other scripts: `npm run lint`, `npm run test`, `npm run typecheck`, `npm run build`.

## Environment variables

| Name | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_USE_MOCKS` | `true` in `.env.example` | `true` uses the in-browser demo API. Set `false` for the real backend. |
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
| `/onboarding` | Setup checklist (shop, hours, camera, test, zone) |
| `/dashboard` | Camera health and latest alerts |
| `/shops/new`, `/shops/:id` | Create and edit a shop |
| `/shops/:id/cameras` | Add/edit a camera, connection test, live status |
| `/shops/:id/cameras/:cameraId/zone` | Draw the shutter zone (0..1 polygon) |
| `/shops/:id/alerts`, `/shops/:id/alerts/:eventId` | Alerts list, evidence viewer, review |
| `/notifications` | What we told you, delivery status |
| `/settings` | Profile, notification preferences |

## Rules the UI follows

- "Monitoring" (protected) only for a fresh `MONITORING` answer; stale, failed or unknown answers read "Status unavailable".
- The camera address and password are only typed into a password field, never shown back, never logged, never stored in the browser or put in a URL.
- Evidence addresses are only used as `src` of an image or video.
- Times are shown in the shop's time zone (the API sends UTC).
- Owner-facing wording is conservative: a camera cannot guarantee detection of everything.
- On sign out the app forgets the selected shop, zone markers for this browser.

## Testing without the backend

The mock layer (`src/mocks`) implements every owner endpoint with DEMO data and the honest status
rules. Camera addresses containing `offline`, `error` or `slow` change the mock test outcome.

## Status and known gaps

All owner screens are built and verified against local mock responses and an automated unit test suite (`npm run test`). Live end-to-end integration against the real backend is pending startup resolution.

Accessibility: DOM audit passes (names, labels, one `h1`, skip link, focus ring, reduced motion,
AA contrast for the design tokens). Not yet done: screen-reader pass and keyboard walkthrough on a
real device.