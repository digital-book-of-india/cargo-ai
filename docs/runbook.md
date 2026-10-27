# Runbook: deploy, back up, restore, roll back

Commands run from `apps/backend` (or inside the backend container, where `npm run x` becomes
`node dist/<path>.js`, see the table at the end).

## 1. Deploy a release

1. Take a backup first (section 2).
2. Build: `npm ci && npm run build -w @dbi/backend` (the Docker image does this).
3. Run migrations once: `npm run migrate` (`node dist/migrations/cli.js up`). Production does not build
   indexes on start, so skipping this leaves new collections without their indexes. Rules such as
   "one open loading session per manifest" are indexes.
4. Start the new version. Wait for `GET /health/ready` to answer 200 (it checks the database and the
   evidence storage). The old version keeps serving until the new one is ready if the platform does
   rolling restarts.
5. Smoke test: sign in, open Alerts, open Shipments, `GET /internal/v1/metrics` shows `dbi_db_connected 1`.
6. Scheduled jobs (cron or the platform scheduler; the `scheduler` service in `infra/docker-compose.prod.yml` already runs both):
   - `npm run job:notifications` every minute (delivers and retries notifications)
   - `npm run job:retention` once a day (deletes evidence files past each company's retention)

## 2. Backups

Two things must be backed up together: **the database** and **the evidence files**.

**Database** (portable, needs no `mongodump`):

    npm run backup                    # writes backups/<database>-<timestamp>/
    npm run backup -- /safe/place/b1  # or an explicit empty folder

The folder holds one `.ejson` file per collection and `manifest.json` with document counts and SHA-256
checksums. It contains personal data and secrets-at-rest (encrypted camera passwords): store it
encrypted, off the server, with the same access rules as the database. It is git-ignored.
Atlas also offers continuous cloud backups; use them as well when available.

**Evidence files**: with the `local` driver, copy the folder named by `EVIDENCE_STORAGE_DIR`, for example
`rsync -a /data/evidence/ backup-host:/backups/evidence/`. With the `s3` driver, turn on bucket versioning (or replication to a second
bucket) and keep the same retention as the database backups; the retention job deletes expired files from the bucket.

Frequency: database at least daily, evidence daily (files are write-once, so incremental copies are cheap).
Keep at least 7 daily and 4 weekly copies. A backup that was never restored is not a backup: do the
restore drill below every quarter and after any major change.

## 3. Restore (and the restore drill)

The target is always explicit; the restore command never uses `MONGODB_URI`, so it cannot hit the live
database by accident.

    # into an EMPTY scratch database (the drill)
    npm run restore -- backups/<folder> --target-uri "mongodb://localhost:27017/dbi_restore_drill"
    MONGODB_URI=mongodb://localhost:27017/dbi_restore_drill npm run migrate   # rebuild indexes

It first verifies every file against the manifest checksums and refuses a damaged backup before writing
anything. It refuses a target that already has data in the same collections unless you add `--replace`
(which drops those collections first: only for a real disaster recovery, with the app stopped).

Drill checklist: restore to a scratch database, run `migrate`, start the API against it, sign in as a
known user, open an event with evidence (restore the evidence folder too), compare counts with
`manifest.json`. Record the date and the result.

The automated test `ops.int.test.ts` already proves the round trip (types preserved, damaged backup
refused, existing data protected); the drill proves your real backups and your real environment.

Disaster recovery order: stop the app, restore the database with `--replace`, restore the evidence
folder, run `migrate`, start the app, check `/health/ready`, tell users which time window may have been lost
(everything since the last backup).

## 4. Roll back a release

- **Code only** (no migration in the release): deploy the previous image/commit. Done.
- **With a migration**: migrations in this project only add indexes and rename legacy collections, so older code
  keeps working with a newer database. Roll the code back first. Revert the migration only if it is the
  problem: `npm run migrate:down` undoes the last one (index migrations keep their indexes on purpose:
  removing a unique index would silently allow duplicates).
- **Bad data written by the new version**: restore from the backup taken in step 1 of the deploy (section 3),
  accepting that changes made since then are lost.

## 5. Monitoring and alerts

Scrape `GET /internal/v1/metrics` (header `x-service-token: <AI_SERVICE_TOKEN>`) every 30 to 60 seconds.
Suggested alerts:

| Metric | Alert when |
|---|---|
| `dbi_db_connected` | is 0 for 1 minute |
| `dbi_http_errors_total` | grows faster than 5 per minute |
| `dbi_event_lag_seconds{stat="max"}` | over 60 for 5 minutes (pipeline or API is behind) |
| `dbi_notifications_oldest_pending_seconds` | over 600 (the notification job is not running) |
| `dbi_notifications_queue_depth{status="FAILED"}` | rises (people are not being told; check the channel) |
| `/health/ready` | not 200 for 2 minutes |

Logs are JSON lines on stdout: `ts, level, msg, requestId, method, path, status, durationMs, userId, companyId`.
The `requestId` is also in every error body and in the `X-Request-Id` header, so a user report with an error
code can be traced to one log line. Query strings, headers and bodies are never logged.

## 6. Command names in the container

| Source | Container |
|---|---|
| `npm run migrate` | `node dist/migrations/cli.js up` |
| `npm run migrate:status` | `node dist/migrations/cli.js status` |
| `npm run job:notifications` | `node dist/jobs/notifications.js` |
| `npm run job:retention` | `node dist/jobs/retention.js` |
| `npm run backup` | `node dist/ops/backup.js <folder>` |
| `npm run restore -- ...` | `node dist/ops/restore.js <folder> --target-uri ...` |

## 7. Not yet verified

- MongoDB must be a replica set (Atlas is; the compose files start a single-node one). Vision ingestion writes an event and its
  count in one transaction, which a standalone server refuses.
- The Dockerfiles and `infra/docker-compose.prod.yml` were written but could not be built on the machine
  they were authored on (no Docker). The first deploy should start with `docker compose build` and the
  smoke test above. The bundled server itself was run (`node dist/server.js`, production mode) and works.
- The S3-compatible evidence adapter (`EVIDENCE_STORAGE_DRIVER=s3`) is written and covered by a unit test with a fake client,
  but has not run against a real bucket. On first use: set the variables in `docs/production-env.md`, confirm `/health/ready`
  is 200, upload one snapshot through the worker and open it from an event.
- Rate limits are kept in memory per API process: with several API instances use a shared store.
