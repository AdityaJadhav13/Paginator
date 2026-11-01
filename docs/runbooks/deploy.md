# Deploy the pilot

The app host runs `infra/docker/compose.pilot.yml` (profile `pilot`): Caddy with the web app (`pageinator-web`), the API
(`pageinator-api`), the nightly backup (`pageinator-backup`), and the one-shot migration step. `infra/deploy/deploy.sh`
does every step; AWS setup is `aws-setup.md`.

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
2. notes `<tag>` in `/var/lib/pageinator/attempt`; logs in to ECR, pulls the three images of `<tag>`, and logs out;
3. `docker compose run --rm migrate`: the pending migrations, as pgn_migrator (they are expand/contract, so the version
   still running keeps working while they run);
4. `docker compose up -d --wait`: each service is replaced; the API is sent SIGTERM and has 20 s (it needs at most
   15: `PGN_SHUTDOWN_GRACE_S` 10 + 5); Caddy keeps its certificates in its volume;
5. `/readyz` through the health listener must say `ready`;
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

## On one machine: pilot-local

The same compose file, profile `pilot-local`: the same images, with a scratch Postgres (`db-local`) and SeaweedFS
(`s3-local`) of its own, Caddy's local CA on `https://app.localhost:<port>`, local logs. Use its own project name and
its own ports, never the development stack's (`pageinator`), and remove it afterwards.

```sh
docker build -f infra/docker/api.Dockerfile -t pgn-plocal/pageinator-api:local-1 .
docker build -f infra/docker/api.Dockerfile --target backup -t pgn-plocal/pageinator-backup:local-1 .
docker build -f infra/docker/web.Dockerfile -t pgn-plocal/pageinator-web:local-1 .
# an env file of its own, with every name the compose file asks for:
# PGN_REGISTRY=pgn-plocal, PGN_DOMAIN=localhost, PGN_TLS_ISSUER=internal, PGN_APP_ORIGIN=https://app.localhost:59443,
# PGN_HTTP_PORT=59080, PGN_HTTPS_PORT=59443, PGN_HEALTH_PORT=59781, PGN_HEALTH_BIND=127.0.0.1,
# PGN_NET_SUBNET=10.241.0.0/24, PGN_CADDY_IP=10.241.0.10, PGN_DB_HOST=db-local, PGN_DB_NAME=pageinator,
# PGSSLMODE=disable (allowed for db-local only), PGN_S3_ENDPOINT=https://s3.localhost:59443,
# PGN_S3_PUBLIC_ORIGIN=https://<work bucket>.s3.localhost:59443, PGN_S3_{WORK,ARCHIVE,BACKUPS}_BUCKET=<names>,
# PGN_SMTP_HOST=mail.invalid, PGN_SMTP_USER=x, PGN_SMTP_PASSWORD=x, PGN_MAIL_FROM=no-reply@example.test;
# random hex for PGN_POSTGRES_PASSWORD, PGN_{MIGRATOR,APP,AUTH,ENGINE,LISTEN,BACKUP}_PASSWORD and PGN_AUTH_SECRET
# (64), and for PGN_S3_ACCESS_KEY_ID and PGN_S3_SECRET_ACCESS_KEY (SeaweedFS's one key pair). SeaweedFS knows no other
# key, so PGN_BACKUP_S3_ACCESS_KEY_ID and PGN_BACKUP_S3_SECRET_ACCESS_KEY must be the same two values.
export PGN_IMAGE_TAG=local-1   # compose needs a tag for every command; deploy.sh sets its own
c="docker compose -p pgn-pilot-local --profile pilot-local --env-file <file> -f infra/docker/compose.pilot.yml"
$c up -d --wait db-local s3-local caddy-local
$c up ca-local
$c run --rm --no-deps -e PGN_S3_CORS_ORIGIN=https://app.localhost:59443 -e PGN_S3_BACKUPS_BUCKET=<backups bucket> \
  api-local node scripts/dev-buckets.ts
PGN_PROFILE=pilot-local PGN_PROJECT=pgn-pilot-local PGN_ENV_FILE=<file> PGN_STATE_DIR=<folder> \
  infra/deploy/deploy.sh deploy local-1
# afterwards
$c --profile pilot-local-migrate down --volumes --remove-orphans
```
