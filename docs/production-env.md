# Production environment

Template: `apps/backend/.env.production.example`. Real values live only in the hosting platform's
secret store, never in git. This table explains every backend variable.

| Variable | Required | Meaning |
|---|---|---|
| `NODE_ENV` | yes | Must be `production`. Turns on: secrets required, indexes not auto-built, JSON logs, `Secure` cookies, no localhost CORS. |
| `PORT` | no (4000) | Listening port. |
| `MONGODB_URI` | yes | A **separate production database**, and a replica set (Atlas, or a single-node replica set): the vision ingestion uses transactions. Never the development one. |
| `JWT_ACCESS_SECRET` | yes | Signs sessions and evidence links. 32+ random bytes. Changing it signs everyone out. |
| `CAMERA_SECRET_ENCRYPTION_KEY` | yes | Encrypts camera passwords at rest. Losing it makes stored camera passwords unreadable (cameras must be re-entered). Back it up in the secret store. |
| `AI_SERVICE_TOKEN` | yes | Shared secret of the AI worker and the metrics scraper. Different from the two above. |
| `CORS_ORIGINS` | yes | Comma-separated https origins of the two panels. No localhost in production. |
| `TRUST_PROXY` | yes behind a proxy | Number of reverse proxies in front of the API (usually 1). 0 means "none": rate limits then see the proxy's address for everyone. A number that is too high lets callers fake their address. |
| `EVIDENCE_STORAGE_DRIVER` | no (`local`) | `local` (a folder on a persistent volume) or `s3` (object storage). |
| `EVIDENCE_STORAGE_DIR` | yes with `local` | Persistent volume for snapshots and clips. Not an ephemeral disk. |
| `EVIDENCE_S3_BUCKET` | yes with `s3` | A **private** bucket (block all public access, enable default encryption). Files are only served through the API's signed, expiring links. |
| `EVIDENCE_S3_REGION` | no (`us-east-1`) | Bucket region. |
| `EVIDENCE_S3_PREFIX` | no | Optional folder inside the bucket. |
| `EVIDENCE_S3_ENDPOINT` | no | Only for S3-compatible services: `https://storage.googleapis.com` for Google Cloud Storage (use an HMAC key pair), or a MinIO address. |
| `EVIDENCE_S3_FORCE_PATH_STYLE` | no (`false`) | `true` for MinIO and some other services. |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | with `s3`, unless a platform role is used | Read by the AWS SDK. Keep them in the secret store, give the key only read/write/delete on that bucket. |
| `EVIDENCE_SIGNED_URL_TTL_SECONDS` | no (300) | How long an evidence link works. |
| `EVIDENCE_MAX_UPLOAD_BYTES` | no (8 MiB) | Largest accepted evidence file. |
| `CARGO_EVENT_RETENTION_DAYS` | no (90) | Default evidence retention; a company can set its own (7 to 3650 days) in Settings. |
| `CAMERA_STALE_SECONDS` | no (120) | A camera silent this long is shown as not online. |
| `WORKER_STALE_SECONDS` | no (60) | The AI worker is shown as down after this silence. |
| `ADMIN_RATE_LIMIT_PER_MIN` | no (100) | Super admin API limit per address. |
| `BODY_LIMIT` | no (1mb) | JSON body limit. |
| `LOG_LEVEL` | no (info) | `debug`, `info`, `warn`, `error`. |
| `LOG_FORMAT` | no (json in production) | `json` or `pretty`. |
| `DNS_SERVERS` | no | Only if the network cannot resolve `mongodb+srv://` addresses, for example `8.8.8.8,8.8.4.4`. |
| `MONGODB_URI_TEST` | tests only | Database for integration tests; its name must end in `_test`. |

Panels (build-time, written into the browser code): `NEXT_PUBLIC_API_BASE_URL`, for example
`https://api.example.com/api/v1`. Build one panel image per environment. Optional:
`NEXT_PUBLIC_REQUEST_TIMEOUT_MS`, `NEXT_PUBLIC_NOTIFICATIONS_REFRESH_MS`.

Checklist before go-live:
- [ ] New random values for the three secrets, stored in the platform's secret store.
- [ ] The database user can only reach the production database; network access is restricted.
- [ ] HTTPS everywhere; the proxy forwards `X-Forwarded-For`; `TRUST_PROXY` matches.
- [ ] `npm run migrate` ran; `/health/ready` is 200.
- [ ] Evidence is on a persistent volume in the backup plan, or in a private bucket with versioning/backups and `/health/ready` is 200 (it checks the bucket).
- [ ] The two scheduled jobs exist (`docs/runbook.md`, section 1; the compose `scheduler` service does it).
- [ ] The AI worker has the same `AI_SERVICE_TOKEN` as the API (32+ characters) and reaches the API.
- [ ] `npm run seed` is **not** run (it creates demo accounts with known passwords).
- [ ] The first company owner is created through registration, and a platform administrator is created
      by setting `role: PLATFORM_ADMIN` on that user in the database by hand (there is deliberately no
      API for it).
