# Restore the database

Two sources, newest first:
1. **RDS point-in-time recovery**: any second within the retention (**[PITR]**: 14 days by default; the owner may set
   14–35), to a **new** instance. Targets (doc 04 §7): RPO ≤ 5 minutes, RTO ≤ 1 hour.
2. **The nightly dump**: `pg_dump --format=custom` of the whole database as `pgn_backup`, at 22:30 UTC (04:00 IST),
   in `s3://pgn-pilot-backups/postgres/YYYY/MM/DD/pageinator-<time>.dump`, under Object Lock (governance) for 35
   days, with its SHA-256 in the object's metadata and checksum. `apps/api/scripts/db-backup.ts` makes it;
   `infra/backup/backup-loop.sh` runs it nightly in the `backup` service; CloudWatch alarms on "backup failed:" and on a
   missing "backup done:".

S3 objects (photos) are versioned; a deleted or overwritten object comes back from its previous version.

## A. Point in time (RDS)

```sh
aws rds restore-db-instance-to-point-in-time --source-db-instance-identifier pgn-pilot \
  --target-db-instance-identifier pgn-pilot-restore-<yyyymmdd> --restore-time <UTC time> \
  --db-subnet-group-name pgn-pilot --vpc-security-group-ids <pgn-db> --no-publicly-accessible \
  --db-parameter-group-name pgn-pilot-pg18 --no-multi-az
aws rds wait db-instance-available --db-instance-identifier pgn-pilot-restore-<yyyymmdd>
```

Then either point the pilot at it (`PGN_DB_HOST` in SSM, `deploy.sh deploy <current tag>`; the roles and passwords
came with it), or copy the rows needed out of it. Keep the old instance until the owner agrees.

## B. From a dump

```sh
aws s3 ls s3://pgn-pilot-backups/postgres/ --recursive | tail -5
aws s3 cp s3://pgn-pilot-backups/postgres/<key> /tmp/restore.dump
aws s3api head-object --bucket pgn-pilot-backups --key postgres/<key> --checksum-mode ENABLED   # compare its sha256
sha256sum /tmp/restore.dump
```

Into a new, empty database whose roles exist (`infra/docker/postgres-init.sql`, then `backup-role.sql`), as the
master user: `pg_restore --exit-on-error --dbname=<new database> /tmp/restore.dump`. Then run the migrations
(`docker compose run --rm migrate`: none should be pending), and point the pilot at it as in A.

## Drill (monthly during L2)

Restore to a new instance (A) or a new database (B), then check: row counts of `app.story`, `identity."user"` and
`app.asset` against the live database at the restore time; the newest audit entry; a story's text; that the newest
photos' keys exist in S3 (`verify-restore.ts`, PR 26). Record the date, the source, the time it took and the result.
Delete the restored instance afterwards.

Verified on pilot-local only (PR 25), not yet on RDS and S3: one dump of the scratch database (139 KB) was uploaded under governance lock for
35 days; a delete of its version was refused (AccessDenied); it was fetched back with the same SHA-256 and restored
with `pg_restore --exit-on-error` into a new database, with its story, user and photo rows.
