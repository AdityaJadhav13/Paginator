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

Check it before anything points at it: `verify-restore.ts` in its point-in-time mode, in the backup image, as below
(`c` as in "Drill"), with the restore time exactly as given to RDS:

```sh
c run --rm -e PGN_RESTORE_TARGET_HOST=<pgn-pilot-restore-<yyyymmdd> endpoint> -e PGN_RESTORE_TIME=<UTC time> \
  backup node scripts/verify-restore.ts
```

It reads the live database and the restored instance as `pgn_backup` in read-only sessions (its roles and passwords
came with the restore) and writes nothing. The live database has moved on since the restore time, so it compares only
what cannot change after it: every audit event (append-only) and every closed story revision (never changed once
closed) up to a minute before the restore time must be the same in both, and the restored instance may hold no audit
event from more than a minute after it. Its applied migrations must be live's first ones (any others are applied by
the deploy that points the pilot at it); its RLS policies must be live's when the migrations are the same (else SKIP:
run it again after that deploy), and every `app` table must have RLS and FORCE RLS. With `PGN_S3_WORK_BUCKET`, the
newest photos' originals must be in S3. PASS, FAIL or SKIP per check; it exits 1 on any FAIL. A transaction that was
open for more than a minute across the restore time can make an honest restore FAIL the audit or revision check
(its rows carry its start time but appear only at its commit): when a check FAILs by a row or two, look at the rows
written in the minutes before the restore time, in both, before calling the restore wrong.

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
photos' keys exist in S3. Record the date, the source, the time it took and the result. Delete the restored instance
afterwards.

From a dump (B), `apps/api/scripts/verify-restore.ts` does all of it in the backup image: it reads the live database's
facts, takes a dump as the nightly backup does, checks its SHA-256 against the store's, restores it into a new database
with `pg_restore --exit-on-error`, and compares row counts of every table, the applied migrations, the RLS policies,
RLS and FORCE RLS on every table (against the migrations the release carries, too), the newest audit event and story
text, and the newest photos' originals in S3. It prints PASS, FAIL or SKIP per check (also when it stops part way),
exits 1 on any FAIL or failure, and drops the restored database (`PGN_RESTORE_KEEP=1` keeps it). It reads the live
database as `pgn_backup` in read-only sessions; the admin connects to the `postgres` database only, to make the restored
database under a name of its own (`<live>_restore_<time>_<random>`) and to drop it: it never drops a database it did
not make. **Each run writes one more dump to the backups bucket**, under the same 35-day GOVERNANCE lock as a nightly
one (a run that fails after the backup leaves its dump too). With `PGN_RESTORE_TARGET_HOST` set, it checks an instance
already restored to a point in time instead (A, above). To rehearse A on pilot-local, where there is no second
instance: run the drill with `PGN_RESTORE_KEEP=1`, then the point-in-time check against the database it kept
(`PGN_RESTORE_TARGET_HOST=db-local`, `PGN_RESTORE_TARGET_DB=<the kept database>`, `PGN_RESTORE_TIME=<the dump's
time>`: the UTC time in its key, `…-<YYYYMMDD>T<hhmmss>Z.dump`, written as `YYYY-MM-DDThh:mm:ssZ`; an event written
between the dump and a later time would rightly fail), and drop that database afterwards.

```sh
c() { docker compose -p <project> --profile <profile> --env-file <file> -f infra/docker/compose.pilot.yml "$@"; }
c run --rm -e PGN_RESTORE_ADMIN_PASSWORD=<superuser or RDS master password> -e PGN_S3_WORK_BUCKET=<work bucket> \
  backup<-local> node scripts/verify-restore.ts
```

`PGN_RESTORE_ADMIN_USER` names the admin role (postgres by default); on pilot-local the admin password is
`PGN_POSTGRES_PASSWORD`, and `PGN_IMAGE_TAG` must be exported for compose, as in `deploy.md`. The backup's S3 key may not read the work bucket in
the pilot: leave `PGN_S3_WORK_BUCKET` unset there (that check is then SKIP) or run with a key that may; a bucket the key
cannot read, or that lacks the originals, makes that check FAIL.

Rehearsed again on pilot-local on 2026-11-05 after a whole newsroom day (11 PASS: 69 tables, 22 migrations, 108
policies, the newest audit event, story text and photos). Verified on pilot-local only (PR 25), not yet on RDS and S3: one dump of the scratch database (139 KB) was uploaded under governance lock for
35 days; a delete of its version was refused (AccessDenied); it was fetched back with the same SHA-256 and restored
with `pg_restore --exit-on-error` into a new database, with its story, user and photo rows.
