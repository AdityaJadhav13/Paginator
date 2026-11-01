#!/bin/sh
# Deploys the pilot (docs/runbooks/deploy.md, rollback.md): run on the EC2 app host, as root.
#   deploy.sh [--dry-run] deploy <tag>   settings from SSM, pull the images, migrate, start, check, record the tag
#   deploy.sh [--dry-run] rollback       after a failed deploy, start the current tag again; else the previous tag;
#                                        never migrating
#   deploy.sh status                     the tags recorded, and the services' state
# --dry-run prints every step, and runs none of them (it reads nothing from AWS either).
#
# The steps (docs/product/10-l2-newsroom-plan.md §8.2):
#   1. settings: every parameter under /pageinator/pilot/ in SSM Parameter Store, written to the root-only env file;
#   2. images: an ECR login, then `docker compose pull` of ${PGN_REGISTRY}/pageinator-{api,web,backup,engine-worker}:<tag>;
#   3. `docker compose run --rm migrate` (expand/contract migrations: the running version keeps working);
#   4. `docker compose up -d --wait` (the API stops within 20 s of its signal, the engine within 200 s: its running job
#      finishes first), then /readyz through the monitor port;
#   5. the tag is recorded, and the one before it kept for a rollback.
# The tag being deployed is written to $STATE_DIR/attempt before step 2 and removed after step 5, so a rollback knows
# a deploy failed part way: it then starts the current tag (the release that ran before the attempt) again. Otherwise
# it starts the previous tag. A rollback never migrates: the old code runs on the newer schema (expand/contract), and
# its migration runner would refuse migrations it does not know. Deploys and rollbacks hold a lock (flock), so two never
# run at once.
#
# Overrides, for the pilot-local copy (docs/runbooks/deploy.md, "On one machine"): PGN_PROFILE=pilot-local skips SSM,
# ECR and pull (its images are built on the machine) and uses the -local services; PGN_PROJECT, PGN_ENV_FILE and
# PGN_STATE_DIR name its own project, env file and state folder.
set -eu

PROFILE="${PGN_PROFILE:-pilot}"
PROJECT="${PGN_PROJECT:-pageinator-pilot}"
ENV_FILE="${PGN_ENV_FILE:-/etc/pageinator/pilot.env}"
STATE_DIR="${PGN_STATE_DIR:-/var/lib/pageinator}"
SSM_PATH="${PGN_SSM_PATH:-/pageinator/pilot/}"
REGION=ap-south-1
HERE=$(cd "$(dirname "$0")" && pwd)
COMPOSE_FILE="$HERE/../docker/compose.pilot.yml"
DRY_RUN=0

say() { printf '%s\n' "$*"; }
fail() {
  printf 'deploy.sh: %s\n' "$*" >&2
  exit 1
}

# Runs a command, or only prints it with --dry-run.
run() {
  printf '+ %s\n' "$*"
  if [ "$DRY_RUN" = 0 ]; then "$@"; fi
}

if [ "$PROFILE" = pilot-local ]; then SUFFIX=-local; else SUFFIX=; fi
case "$PROFILE" in pilot | pilot-local) ;; *) fail "PGN_PROFILE must be pilot or pilot-local, not $PROFILE" ;; esac

compose() {
  run docker compose -p "$PROJECT" --profile "$PROFILE" --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

valid_tag() {
  case "$1" in
    "" | *[!A-Za-z0-9._-]* | [.-]*) return 1 ;;
    *) [ "${#1}" -le 128 ] ;;
  esac
}

recorded() { # the tag in $STATE_DIR/$1, or nothing; exits if the file holds anything but a tag
  [ -f "$STATE_DIR/$1" ] || return 0
  t=$(cat "$STATE_DIR/$1")
  [ -z "$t" ] || valid_tag "$t" || fail "$STATE_DIR/$1 does not hold an image tag"
  printf '%s\n' "$t"
}

# One deploy or rollback at a time. flock frees the lock when the process ends, however it ends.
lock() {
  [ "$DRY_RUN" = 0 ] || return 0
  mkdir -p "$STATE_DIR"
  if ! command -v flock >/dev/null 2>&1; then
    [ "$PROFILE" = pilot-local ] || fail "flock is needed (util-linux)"
    say "lock: none (no flock on this machine; pilot-local only)"
    return 0
  fi
  exec 9>"$STATE_DIR/lock"
  flock -n 9 || fail "another deploy or rollback is running (it holds $STATE_DIR/lock)"
}

# 1. Every parameter under $SSM_PATH as NAME='value' (SecureString parameters decrypted), into a new file that only
# root may read, moved over the old one at once. A name must be PGN_* or PGSSLMODE; a value may hold no quote and no
# line break (the generated secrets are hex).
write_settings() {
  [ "$PROFILE" = pilot ] || {
    say "settings: $ENV_FILE as it is (pilot-local)"
    return 0
  }
  say "settings: every parameter under $SSM_PATH into $ENV_FILE (root only)"
  if [ "$DRY_RUN" = 1 ]; then
    say "+ aws ssm get-parameters-by-path --region $REGION --path $SSM_PATH --recursive --with-decryption --query 'Parameters[].[Name,Value]' --output text > $ENV_FILE.ssm (stop if aws fails)"
    say "+ each line of $ENV_FILE.ssm as NAME='value' > $ENV_FILE.new; chmod 0600 $ENV_FILE.new && mv $ENV_FILE.new $ENV_FILE"
    return 0
  fi
  umask 077
  mkdir -p "$(dirname "$ENV_FILE")"
  # aws's whole answer first, into a file: a pipe would hide its exit status, and a half answer would replace the
  # settings that work
  trap 'rm -f "$ENV_FILE.ssm" "$ENV_FILE.new"' EXIT # the decrypted answer never stays behind
  aws ssm get-parameters-by-path --region "$REGION" --path "$SSM_PATH" --recursive --with-decryption \
    --query 'Parameters[].[Name,Value]' --output text >"$ENV_FILE.ssm" || {
    fail "reading $SSM_PATH from SSM failed; $ENV_FILE is unchanged"
  }
  while IFS="$(printf '\t')" read -r name value; do
    key=${name##*/}
    case "$key" in PGN_[A-Z0-9_]* | PGSSLMODE) ;; *) fail "SSM parameter $name: its last part must be a PGN_* name" ;; esac
    case "$value" in *"'"* | *'"'*) fail "SSM parameter $name: its value may not hold a quote" ;; esac
    printf "%s='%s'\n" "$key" "$value"
  done <"$ENV_FILE.ssm" >"$ENV_FILE.new"
  [ -s "$ENV_FILE.new" ] || fail "no parameter under $SSM_PATH"
  chmod 0600 "$ENV_FILE.new"
  mv "$ENV_FILE.new" "$ENV_FILE"
}

registry() { # PGN_REGISTRY from the env file
  sed -n "s/^PGN_REGISTRY='\{0,1\}\([^']*\)'\{0,1\}$/\1/p" "$ENV_FILE" | tail -n 1
}

# 2. The images.
pull() {
  [ "$PROFILE" = pilot ] || {
    say "images: the ones built on this machine (pilot-local: no pull)"
    return 0
  }
  if [ "$DRY_RUN" = 1 ]; then
    say "+ aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin <PGN_REGISTRY>"
  else
    reg=$(registry)
    [ -n "$reg" ] || fail "PGN_REGISTRY is not in $ENV_FILE"
    say "+ aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $reg"
    aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$reg"
  fi
  pulled=0
  compose pull --quiet || pulled=1
  # the ECR token is good for 12 hours: it is not left in root's Docker config, whether the pull worked or not
  if [ "$DRY_RUN" = 1 ]; then say "+ docker logout <PGN_REGISTRY>"; else run docker logout "$reg"; fi
  [ "$pulled" = 0 ] || fail "the pull failed"
}

# 4. Ready: /readyz through the monitor port (the database and the work bucket answer).
check_ready() {
  port=$(sed -n "s/^PGN_HEALTH_PORT='\{0,1\}\([0-9]*\)'\{0,1\}$/\1/p" "$ENV_FILE" 2>/dev/null | tail -n 1)
  bind=$(sed -n "s/^PGN_HEALTH_BIND='\{0,1\}\([^']*\)'\{0,1\}$/\1/p" "$ENV_FILE" 2>/dev/null | tail -n 1)
  url="http://${bind:-127.0.0.1}:${port:-8781}/readyz"
  run curl --fail --silent --show-error --max-time 10 --retry 5 --retry-delay 2 --retry-all-errors "$url"
  [ "$DRY_RUN" = 1 ] || say ""
}

# The RDS certificate bundle must be a file: Docker would make a missing one into an empty folder, and every database
# connection (verify-full) would then fail.
check_ca() {
  [ "$PROFILE" = pilot ] && [ "$DRY_RUN" = 0 ] || return 0
  ca=$(sed -n "s/^PGN_DB_CA_FILE='\{0,1\}\([^']*\)'\{0,1\}$/\1/p" "$ENV_FILE" | tail -n 1)
  [ -f "${ca:-/etc/pageinator/rds-ca.pem}" ] || fail "no RDS certificate bundle at ${ca:-/etc/pageinator/rds-ca.pem}"
}

start() { # <tag> <migrate: 1 or 0>
  check_ca
  export PGN_IMAGE_TAG="$1"
  say "tag: $1"
  pull
  if [ "$2" = 1 ]; then compose run --rm "migrate$SUFFIX"; else say "migrations: none (a rollback never migrates)"; fi
  compose up -d --wait --remove-orphans
  check_ready
}

record() { # <tag>: the current tag becomes the previous one
  current=$(recorded current)
  if [ "$DRY_RUN" = 1 ]; then
    say "+ record: previous=${current:-<none>}, current=$1 (in $STATE_DIR)"
    return 0
  fi
  mkdir -p "$STATE_DIR"
  if [ -n "$current" ] && [ "$current" != "$1" ]; then printf '%s\n' "$current" >"$STATE_DIR/previous"; fi
  printf '%s\n' "$1" >"$STATE_DIR/current"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,6p' "$0"
      exit 0
      ;;
    -*) fail "unknown option $1" ;;
    *) break ;;
  esac
  shift
done

command=${1:-}
case "$command" in
  deploy)
    tag=${2:-}
    valid_tag "$tag" || fail "deploy needs an image tag (letters, digits, . _ -), such as a commit id"
    if [ "$DRY_RUN" = 0 ] && [ "$PROFILE" = pilot ] && [ "$(id -u)" != 0 ]; then fail "run it as root (sudo)"; fi
    lock
    write_settings
    [ "$DRY_RUN" = 1 ] || [ -f "$ENV_FILE" ] || fail "no settings file $ENV_FILE"
    if [ "$DRY_RUN" = 1 ]; then say "+ attempt: $tag (in $STATE_DIR)"; else printf '%s\n' "$tag" >"$STATE_DIR/attempt"; fi
    start "$tag" 1
    record "$tag"
    [ "$DRY_RUN" = 1 ] || rm -f "$STATE_DIR/attempt"
    say "deployed $tag"
    ;;
  rollback)
    lock
    current=$(recorded current)
    previous=$(recorded previous)
    attempt=$(recorded attempt)
    if [ -n "$attempt" ] && [ "$attempt" != "$current" ] && [ -n "$current" ]; then
      # the deploy of $attempt stopped part way: $current ran before it (its schema may be newer now, which
      # expand/contract allows), so it is the one to start again; the recorded tags stay as they are
      say "the deploy of $attempt did not finish: starting $current again"
      start "$current" 0
      [ "$DRY_RUN" = 1 ] || rm -f "$STATE_DIR/attempt"
      say "rolled back to $current"
      exit 0
    fi
    [ -n "$previous" ] || {
      [ "$DRY_RUN" = 1 ] || fail "no previous tag is recorded in $STATE_DIR"
      previous="<previous>"
    }
    say "rolling back from ${current:-<none>} to $previous"
    start "$previous" 0
    if [ "$DRY_RUN" = 1 ]; then
      say "+ record: current=$previous, previous=${current:-<none>}"
    else
      printf '%s\n' "$previous" >"$STATE_DIR/current"
      if [ -n "$current" ]; then printf '%s\n' "$current" >"$STATE_DIR/previous"; fi
      rm -f "$STATE_DIR/attempt"
    fi
    say "rolled back to $previous"
    ;;
  status)
    say "current: $(recorded current)"
    say "previous: $(recorded previous)"
    [ ! -f "$STATE_DIR/attempt" ] || say "attempt: $(recorded attempt) (a deploy that did not finish)"
    PGN_IMAGE_TAG=$(recorded current)
    export PGN_IMAGE_TAG
    compose ps
    ;;
  *) fail "usage: deploy.sh [--dry-run] deploy <tag> | rollback | status" ;;
esac
