// The restore drill from a dump (docs/runbooks/restore.md, "Drill"): src/db/restore-drill.ts. Run it in the backup
// image (it has pg_dump and pg_restore 18) with the backup's settings, plus:
//   PGN_RESTORE_ADMIN_PASSWORD  a role that may create a database and restore owners (the superuser on pilot-local,
//                               the RDS master user in the pilot); PGN_RESTORE_ADMIN_USER names it (postgres)
//   PGN_S3_WORK_BUCKET          optional: also check that the newest photos' originals are in the store (with a key
//                               that may read them; skipped when unset)
//   PGN_RESTORE_KEEP=1          keep the restored database (it is dropped by default)
// It prints one line per check (PASS, FAIL or SKIP) and exits 1 when any check fails. No secret is printed.
import { restoreDrill } from "../src/db/restore-drill.ts";

let ok = false;
try {
  ok = await restoreDrill();
} catch (error) {
  console.error(`restore drill failed: ${error instanceof Error ? error.message : String(error)}`);
}
// at once: nothing the drill opened outlives it, but a stray socket must never keep a failed drill waiting
process.exit(ok ? 0 : 1);
