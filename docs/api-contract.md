# DBI Intelligence — API Contract v2.0

> **Source**: DBI Intelligence Final Combined Developer Handoff v2.0  
> **Owner**: Developer 3 (Core API / Schemas)  
> **Base Path**: `/api/v1` (AI Internal: `/internal/v1`)  
> **Conventions**:
> - Success format: `{ "data": ... }`
> - Error format: `{ "error": { "code": string, "message": string, "requestId": string } }`
> - Timestamps: UTC ISO-8601 (e.g. `2026-10-12T17:12:00Z`)
> - Timezones: Interpreted in the shop's IANA timezone (e.g. `Asia/Kolkata`)

---

## 📋 Endpoint Catalogue

### 1. Authentication (`/api/v1/auth`)

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| `POST` | `/auth/register` | Register new shop owner | Public (Rate limited) |
| `POST` | `/auth/login` | Login with email and password | Public |
| `POST` | `/auth/logout` | End session (clears cookie) | Public |
| `GET` | `/auth/me` | Fetch current user & role | Authenticated |

### 2. Shops (`/api/v1/shops`)

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| `POST` | `/shops` | Create shop with default schedule | `SHOP_OWNER` |
| `GET` | `/shops` | List user's shops (all shops for Admin) | Authenticated |
| `GET` | `/shops/:shopId` | Fetch shop details | Owner or `SUPER_ADMIN` |
| `PATCH` | `/shops/:shopId` | Update shop profile/address | Owner or `SUPER_ADMIN` |

### 3. Schedules & Security State (`/api/v1/shops/:shopId`)

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| `GET` | `/shops/:shopId/schedule` | Read weekly schedule & grace period | Owner or Admin |
| `PUT` | `/shops/:shopId/schedule` | Update weekly schedule, recalculate state | Owner |
| `GET` | `/shops/:shopId/security-state` | Fetch expected vs actual monitoring state | Owner or Admin |
| `POST` | `/shops/:shopId/override` | Temporary manual ARM/DISARM override | Owner (Audit logged) |

### 4. Cameras & Zones (`/api/v1/shops/:shopId/cameras`, `/api/v1/cameras/:cameraId`)

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| `POST` | `/shops/:shopId/cameras` | Register camera metadata & encrypted stream | Owner |
| `GET` | `/shops/:shopId/cameras` | List safe camera fields (no secrets) | Owner or Admin |
| `POST` | `/cameras/:cameraId/test` | Test camera stream reachability | Owner or Admin |
| `PATCH` | `/cameras/:cameraId` | Update camera name or stream credentials | Owner |
| `PUT` | `/cameras/:cameraId/zones` | Save shutter/gate polygon (0..1 coordinates) | Owner |
| `GET` | `/cameras/:cameraId/zones` | Fetch defined zone polygon for camera | Owner or Admin |

### 5. Security Events & Reviews (`/api/v1/shops/:shopId/events`, `/api/v1/events/:eventId`)

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| `GET` | `/shops/:shopId/events` | Paginated list of security events | Owner or Admin |
| `GET` | `/events/:eventId` | Single event detail and evidence URLs | Owner or Admin |
| `POST` | `/events/:eventId/review` | Mark review status (`REVIEWED`, `FALSE_ALARM`, `CONFIRMED`) | Owner or Admin |

### 6. Notifications (`/api/v1/notifications`)

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| `POST` | `/notifications/push-token` | Register push token for browser/mobile | Authenticated |
| `GET` | `/notifications` | List recent in-app notifications | Authenticated |

### 7. Internal AI Service (`/internal/v1/ai`)

| Method | Endpoint | Purpose | Access |
|---|---|---|---|
| `POST` | `/ai/health` | AI Worker heartbeat (every 30s) | Service Auth (`x-service-token`) |
| `POST` | `/ai/events` | Submit suspicious event with idempotency `eventId` | Service Auth (`x-service-token`) |

---

## 🔍 Request & Response Examples

### Create Shop — `POST /api/v1/shops`
```json
// Request
{
  "name": "Main Street Electronics",
  "timezone": "Asia/Kolkata",
  "address": { "city": "Delhi", "state": "Delhi", "postalCode": "110001" }
}

// 201 Response
{
  "data": {
    "shop": {
      "id": "670a...",
      "ownerId": "670a...",
      "name": "Main Street Electronics",
      "timezone": "Asia/Kolkata",
      "status": "PENDING_SETUP"
    }
  }
}
```

### Update Schedule — `PUT /api/v1/shops/:shopId/schedule`
```json
// Request
{
  "weeklySchedule": [
    { "day": "MON", "openTime": "10:00", "closeTime": "22:00", "closed": false, "closesNextDay": false },
    { "day": "TUE", "openTime": "10:00", "closeTime": "22:00", "closed": false, "closesNextDay": false },
    { "day": "SUN", "closed": true, "closesNextDay": false }
  ],
  "gracePeriodMinutes": 5
}

// 200 Response
{
  "data": {
    "shopId": "670a...",
    "timezone": "Asia/Kolkata",
    "version": 2,
    "nextTransitionAt": "2026-10-12T16:35:00Z"
  }
}
```

### Security State — `GET /api/v1/shops/:shopId/security-state`
```json
// 200 Response
{
  "data": {
    "shopId": "670a...",
    "desiredState": "ARMED",
    "actualMonitoringState": "MONITORING",
    "cameraState": "ONLINE",
    "aiWorkerState": "ONLINE",
    "reason": "AFTER_CLOSING",
    "evaluatedAt": "2026-10-12T17:12:03Z"
  }
}
```
*Note: `actualMonitoringState` values: `MONITORING` | `DISARMED` | `DEGRADED` | `OFFLINE` | `SETUP_REQUIRED`.*
*Rule: Never returns `MONITORING` unless camera and AI worker health are active and recent.*
