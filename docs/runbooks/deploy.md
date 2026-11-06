# Deploy the pilot

The app host runs `infra/docker/compose.pilot.yml` (profile `pilot`): Caddy with the web app (`pageinator-web`), the API
(`pageinator-api`, which also runs the news finder's schedule, the ads' cut-off alert and the background measuring),
the nightly backup (`pageinator-backup`), the engine's queue (`pageinator-engine-worker`: photo conversions, Word
imports, engine profiles, layout runs, the news finder's collections; the newsprint colour profile at `PGN_ICC_FILE`
on the host, checked against `PGN_ICC_SHA256`), the page editor's edit gateway (the same image, `gateway`: it shares
the engine's homes volume, and only the API reaches it, signed with `PGN_GATEWAY_SECRET`), and the one-shot migration
step. The engine's 2 GB and the gateway's 1 GB make the host's containers 4 GB in all: a t3.large (8 GB).
`infra/deploy/deploy.sh` does every step; AWS setup is `aws-setup.md`.

## When

- Not between 18:00 and 02:00 IST on a production night (ADR-016), unless the fix is for that night.
- With a CI run green on the commit, and its images in ECR.

## Build and push the images (from a build machine with Docker and ECR access)

```sh
tag=$(git rev-parse --short=12 HEAD)
reg=<account>.dkr.ecr.ap-south-1.amazonaws.com
aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin $reg
docker buildx build --platform linux/amd64 -f infra/docker/api.Dockerfile -t $reg/pageinator-api:$tag --push .
docker buildx build --platform linux/amd64 -f infra/docker/api.Dockerfile --target backup -t $reg/pageinator-backup:$tag --push .
docker buildx build --platform linux/amd64 -f infra/docker/web.Dockerfile -t $reg/pageinator-web:$tag --push .
docker buildx build --platform linux/amd64 -f infra/docker/engine-worker.Dockerfile -t $reg/pageinator-engine-worker:$tag --push .
```

## Deploy (on the app host, through SSM Session Manager)

```sh
cd /opt/pageinator && sudo git fetch && sudo git checkout <commit>   # deploy.sh and the compose file of that commit
sudo infra/deploy/deploy.sh --dry-run deploy <tag>                    # read every step first
sudo infra/deploy/deploy.sh deploy <tag>
```

What it does, in order (it stops at the first failure; one deploy or rollback at a time, under a lock):
1. writes `/etc/pageinator/pilot.env` (0600, root) from every parameter under `/pageinator/pilot/` in SSM, only once
   the whole answer has arrived (if reading SSM fails, the file stays as it was);
2. notes `<tag>` in `/var/lib/pageinator/attempt`; logs in to ECR, pulls the four images of `<tag>`, and logs out;
3. `docker compose run --rm migrate`: the pending migrations, as pgn_migrator (they are expand/contract, so the version
   still running keeps working while they run; they also install and upgrade Graphile Worker's schema `queue`);
4. `docker compose up -d --wait`: each service is replaced, and the step fails unless every one with a health check
   (Caddy, the API, the engine's queue, the edit gateway) is healthy; the API is sent SIGTERM and has 20 s (it needs at most
   15: `PGN_SHUTDOWN_GRACE_S` 10 + 5); the engine is sent SIGTERM and has 200 s: it takes no new job and lets a running
   one finish (at most `PGN_RUNNER_TIMEOUT_S`, 180 s), so a deploy may wait that long; a job cut short is run again
   (or, on its last attempt, settled by the API's sweep within its 2-hour staleness); Caddy keeps its certificates in
   its volume;
5. `/readyz` through the health listener must say `ready` (the database and the work bucket), and the API must reach
   the edit gateway, which refuses its unsigned test call (401);
6. records the tag in `/var/lib/pageinator/current`, and the one before in `previous`, and removes `attempt`.

If it stops part way, `attempt` stays: `rollback.md` then starts the release that was running before it.

## Check

```sh
node tools/ts/check-headers.ts https://app.example.test     # [D-2] the real origin; from any machine with Node 24
sudo infra/deploy/deploy.sh status
```

With `PGN_CHECK_EMAIL` and `PGN_CHECK_PASSWORD` set to a test account of the pilot, it also checks the sign-in cookies.
Every line must be PASS (a SKIP says what was not checked). Then sign in, open a story, and watch the live updates.

After the first deploy, and after any change to the instance: the containers must not reach the instance role through
the metadata service (`aws-setup.md` step 5, hop limit 1). From inside the API container, a token request must fail:

```sh
sudo docker compose -p pageinator-pilot --profile pilot --env-file /etc/pageinator/pilot.env \
  -f infra/docker/compose.pilot.yml exec api node -e "fetch('http://169.254.169.254/latest/api/token', {method: 'PUT',
  headers: {'X-aws-ec2-metadata-token-ttl-seconds': '60'}, signal: AbortSignal.timeout(5000)}).then(
  (r) => { console.log('FAIL: the metadata service answered', r.status); process.exit(1); },
  () => console.log('PASS: no metadata token from a container'))"
```

(`deploy.sh status` prints the tag for `PGN_IMAGE_TAG`, which compose needs: prefix the command with
`PGN_IMAGE_TAG=<tag>`.) This is checked only on the real host; pilot-local has no metadata service.

If a check fails: `rollback.md`.

## The legal pages' texts [D-6]

`/legal/privacy`, `/legal/terms` and `/legal/grievance` show the owner's own texts, which never go in the repository or
an image: plain UTF-8 text files on the app host, in `/etc/pageinator/legal/` (or the folder `PGN_LEGAL_DIR` names),
each named `<doc>.<lang>.txt`, with `<doc>` one of `privacy`, `terms`, `grievance` and `<lang>` `en` or `mr`
(`privacy.en.txt`, `grievance.mr.txt`). Caddy serves those six names only, read only, at `/legal-text/<name>`. A page
shows its language's file; else the other language's, with a one-line note; else a line saying the text is to be
supplied by the owner. In a file, a blank line separates paragraphs, a line break inside a paragraph is kept, and a
paragraph that starts with `## ` is a subheading; nothing else is formatted (no HTML, no Markdown).

```sh
sudo install -d -m 0755 /etc/pageinator/legal     # once (compose would otherwise make it, empty, at the next deploy)
sudo install -m 0644 privacy.en.txt /etc/pageinator/legal/
curl -sI https://app.example.test/legal-text/privacy.en.txt   # [D-2] the real origin: 200, text/plain
```

A new or changed file is shown at once: no deploy and no new image. Caddy's user (10001) must be able to read it (the
folder 0755, the files 0644; otherwise the page says the text could not be loaded). Copy files into the folder; do not
delete and remake the folder while Caddy runs, which would keep showing the old one until the next `up`.
pilot-local mounts `PGN_LEGAL_DIR` when it is set, and otherwise an empty volume (every page says its text is to come).

## On one machine: pilot-local

The same compose file, profile `pilot-local`: the same images, with a scratch Postgres (`db-local`) and SeaweedFS
(`s3-local`) of its own, Caddy's local CA on `https://app.localhost:<port>`, local logs. Use its own project name and
its own ports, never the development stack's (`pageinator`), and remove it afterwards.

```sh
docker build -f infra/docker/api.Dockerfile -t pgn-plocal/pageinator-api:local-1 .
docker build -f infra/docker/api.Dockerfile --target backup -t pgn-plocal/pageinator-backup:local-1 .
docker build -f infra/docker/web.Dockerfile -t pgn-plocal/pageinator-web:local-1 .
docker build --platform linux/amd64 -f infra/docker/engine-worker.Dockerfile -t pgn-plocal/pageinator-engine-worker:local-1 .
# (the worker image runs both the engine's queue and the edit gateway)
# an env file of its own, with every name the compose file asks for:
# PGN_REGISTRY=pgn-plocal, PGN_DOMAIN=localhost, PGN_TLS_ISSUER=internal, PGN_APP_ORIGIN=https://app.localhost:59443,
# PGN_HTTP_PORT=59080, PGN_HTTPS_PORT=59443, PGN_HEALTH_PORT=59781, PGN_HEALTH_BIND=127.0.0.1,
# PGN_NET_SUBNET=10.241.0.0/24, PGN_CADDY_IP=10.241.0.10, PGN_DB_HOST=db-local, PGN_DB_NAME=pageinator,
# PGSSLMODE=disable (allowed for db-local only), PGN_S3_ENDPOINT=https://s3.localhost:59443,
# PGN_S3_PUBLIC_ORIGIN=https://<work bucket>.s3.localhost:59443, PGN_S3_{WORK,ARCHIVE,BACKUPS}_BUCKET=<names>,
# PGN_SMTP_HOST=mail.invalid, PGN_SMTP_USER=x, PGN_SMTP_PASSWORD=x (api-local sends every email to mail-local's
# Mailpit instead: read them at http://127.0.0.1:<PGN_MAIL_UI_PORT>, 59025 by default), PGN_MAIL_FROM=no-reply@example.test,
# PGN_CONTACT_TO=contact@example.test (optional: without it the site shows no contact form); random hex for PGN_POSTGRES_PASSWORD,
# PGN_{MIGRATOR,APP,AUTH,ENGINE,LISTEN,BACKUP}_PASSWORD, and PGN_AUTH_SECRET and PGN_GATEWAY_SECRET (64 hex
# characters each: `openssl rand -hex 32`), and
# for PGN_S3_ACCESS_KEY_ID and PGN_S3_SECRET_ACCESS_KEY (SeaweedFS's one key pair). SeaweedFS knows no other
# key, so PGN_BACKUP_S3_ACCESS_KEY_ID and PGN_BACKUP_S3_SECRET_ACCESS_KEY, and PGN_ENGINE_S3_ACCESS_KEY_ID and
# PGN_ENGINE_S3_SECRET_ACCESS_KEY, must be the same two values; PGN_ICC_FILE=<a CMYK printer profile on this machine>
# and PGN_ICC_SHA256=<its sha256sum> (a fictional or public profile: the newsprint one stays in ~/PageinatorPrivate).
# Docker Desktop mounts only shared folders: a profile under /System/Library (macOS's Generic CMYK) fails with "mounts
# denied"; copy it into a shared folder (your home, for example) and name the copy.
export PGN_IMAGE_TAG=local-1   # compose needs a tag for every command; deploy.sh sets its own
# a function, not a variable: zsh (macOS's shell) does not split "$c" into words
c() { docker compose -p pgn-pilot-local --profile pilot-local --env-file <file> -f infra/docker/compose.pilot.yml "$@"; }
c up -d --wait db-local s3-local caddy-local mail-local
c up ca-local
c run --rm --no-deps -e PGN_S3_CORS_ORIGIN=https://app.localhost:59443 -e PGN_S3_BACKUPS_BUCKET=<backups bucket> \
  api-local node scripts/dev-buckets.ts
PGN_PROFILE=pilot-local PGN_PROJECT=pgn-pilot-local PGN_ENV_FILE=<file> PGN_STATE_DIR=<folder> \
  infra/deploy/deploy.sh deploy local-1
# afterwards
c --profile pilot-local-migrate down --volumes --remove-orphans
```

The newsroom's first organisation and its Owner (on the pilot too, with `api` and the real names, D-3): the Owner gets
two emails, to confirm the address and to choose a password (pilot-local: in Mailpit).

```sh
c run --rm --no-deps api-local node scripts/bootstrap-org.ts --owner-name "<name>" --owner-email <address> \
  --org-name "<newspaper>" --org-slug <slug> --pub-name "<title>" --pub-slug <slug> --languages mr,en --primary mr \
  --digits devanagari
```

Then the whole day can be rehearsed in a browser at `https://app.localhost:<PGN_HTTPS_PORT>` (Caddy's local CA:
accept it, or trust its certificate:
`docker run --rm -v pgn-pilot-local_local-ca:/ca pgn-plocal/pageinator-web:local-1 cat /ca/root.crt > root.crt`, which
`NODE_EXTRA_CA_CERTS=root.crt` also gives `tools/ts/check-headers.ts`): the Owner chooses a password from the welcome email (which confirms the address) and
turns on two-step sign-in; invites the team (Team); a Reporter files a story with a photo (the engine converts it); Stories → "Import
Word file"; the desk readies stories; Engine profile → upload the paper's dataset bundle (private: never from the
repository); Editions → create; Ads → advertisers, bookings, artwork; the edition's Plan, Layout, Pages and the page
editor (save); Release → issue number, approve pages, press test, approve release, download, mark sent, the press's
confirmation; Sources → Collect now (the AI part is off without `PGN_ANTHROPIC_API_KEY`). The restore drill
(`restore.md`) runs against it as `backup-local`. pilot-local gives its engine the pilot's 2 GB and 2 CPUs (its layout
pool follows the container, so it lays pages out as the pilot does), its file store 1 GB and its Caddy 256 MB (Caddy
carries the file store's traffic there).
