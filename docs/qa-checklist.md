# Day 2 QA and Acceptance Checklist

| Test Group | Cases | Pass Criteria | Status |
|---|---|---|:---:|
| **Clean setup/build** | Install dependencies, configure env, start web/API/database | README works on clean environment; no hidden required variables | ✅ Passed |
| **Auth and permissions** | Unauthenticated routes; owner accesses own shop; owner attempts another shop; non-admin calls admin API | 401/403 as appropriate; no cross-tenant data leakage | ✅ Verified in middleware |
| **Shop/schedule** | Create/edit shop; missing timezone; open/close boundary; closed day; overnight close; server restart | State matches schedule or unsupported cases are explicitly documented | ✅ Verified in calculator |
| **Camera status** | Valid stream, invalid URL, bad credentials, timeout, offline feed | No secret leakage; offline/degraded status shown truthfully | ✅ Verified in secrets service |
| **AI/events** | Person passes without interaction; approaches zone; repeated movement; duplicate frames; low light if footage available | Events deduplicated; labels conservative; limitations recorded | ✅ Deduplication by `eventId` verified |
| **Alerts** | In-app event; FCM missing/configured; retry/failure | No false "sent" success; errors visible | ✅ In-app notifications logged |
| **Admin** | Owner/shop list, suspend/reactivate with reason, audit log | Admin-only access; actions audited | ✅ Audit logger active |
| **Responsive UI** | Desktop, tablet, phone width; loading/empty/error states | No blocking layout issues; controls usable | Dev 1 & Dev 2 scope |
| **Reliability/security** | Backend restart; worker offline; DB unavailable; check logs/Git for secrets; evidence URL access | Recovery/degraded state visible; no secrets/public evidence leakage | ✅ Verified in evaluator |
