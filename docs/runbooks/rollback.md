# Roll back the pilot

A rollback starts an earlier release's images again: after a deploy that stopped part way, the release that was
running before it (the current tag); otherwise the previous tag. It does **not** migrate: the migrations are expand/contract
(docs/product/10-l2-newsroom-plan.md §8.2), so the previous code runs on the newer schema, and its migration runner
would refuse migrations it does not know. There is no down migration.

## When

- `check-headers` fails after a deploy, `/readyz` stays `not_ready`, or the app misbehaves and the cause is the new
  release.
- Not when the cause is the database, S3 or SES (rolling back changes nothing then): see `restore.md` or the AWS
  status page.

## How

```sh
sudo infra/deploy/deploy.sh status                 # current and previous tags
sudo infra/deploy/deploy.sh --dry-run rollback
sudo infra/deploy/deploy.sh rollback               # previous tag, no migration, /readyz checked
node tools/ts/check-headers.ts https://app.example.test   # [D-2]
```

Which release it starts:
- **A deploy stopped part way** (`deploy.sh status` shows an `attempt`: the migration, the start or `/readyz`
  failed): the current tag, the release that ran before the attempt. Its schema may now be the attempt's (if the
  migration ran), which expand/contract allows. The recorded tags stay as they were, and `attempt` is removed.
- **Otherwise** (the last deploy finished, and the release itself is wrong): the previous tag. The tags then swap: a
  second rollback returns to the release just left.

deploy.sh refuses a state file that holds anything but a tag, and runs one deploy or rollback at a time (a lock on
`/var/lib/pageinator/lock`). To go further back, deploy an older tag
(`deploy.sh deploy <tag>`): ECR keeps the last 20 images, and its migration step finds nothing to apply (the database is
ahead of it) only if no migration came after it. If one did, an older release than the previous one may not run on the
schema: check `apps/api/src/db/migrations` between the two commits first.

## Releases from before the engine's queue (migration `2026_11_27_0001_engine_queue`)

Rolling back to a release older than that migration is not safe as it stands (doc 11 L2-333):
- such a release does not know the photo state `failed`: a story whose photo failed cannot be read (500) until its
  photo is taken off (in the story editor, while the newer release still runs) or the release is rolled forward;
- its upload completion enqueues no job: photos sent while it runs stay "Preparing…", and after the next deploy the
  sweep fails them (`worker.lost`) after 30 minutes, so they must be sent again.

Prefer fixing forward. If a rollback past it cannot wait, take the failed photos off their stories first and tell the
desk that photos sent meanwhile must be sent again.

## If a migration itself was wrong

Fix forward: a new migration that undoes or repairs it, in a new release. Restore the database (`restore.md`) only if
data was lost.

## Record

What failed, the tags, the times, and whether staff noticed: in the pilot log the owner keeps (no story text).
