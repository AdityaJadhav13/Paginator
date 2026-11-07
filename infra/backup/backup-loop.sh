#!/bin/sh
# The backup container's process (infra/docker/compose.pilot.yml, service backup): one database dump a night, at
# PGN_BACKUP_AT_UTC (22:30 UTC, 04:00 IST by default: after the 18:00-02:00 IST production window). A failed dump
# prints "backup failed: ..." and the loop waits for the next night; the CloudWatch alarms in
# docs/runbooks/aws-setup.md match that line, and the absence of "backup done:" for 26 hours. For one dump now:
#   docker compose ... run --rm backup node scripts/db-backup.ts
set -eu

at="${PGN_BACKUP_AT_UTC:-22:30}"
case "$at" in
  [0-1][0-9]:[0-5][0-9] | 2[0-3]:[0-5][0-9]) ;;
  *)
    echo "backup failed: PGN_BACKUP_AT_UTC must be HH:MM (UTC), not $at" >&2
    exit 1
    ;;
esac

while :; do
  now=$(date -u +%s)
  next=$(date -u -d "today $at" +%s)
  if [ "$next" -le "$now" ]; then next=$(date -u -d "tomorrow $at" +%s); fi
  echo "next backup at $(date -u -d "@$next" +%Y-%m-%dT%H:%MZ)"
  sleep $((next - now))
  node scripts/db-backup.ts || true # its own line says what failed
done
