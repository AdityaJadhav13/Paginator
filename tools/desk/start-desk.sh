#!/bin/sh
# Starts Pageinator Desk (internal, own use) on this Mac and opens it in the browser.
# Data: $PAGEINATOR_DESK_HOME (default ~/PageinatorPrivate/desk), never inside the repository.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
server_py="${PAGEINATOR_DESK_PY:-$repo/experiments/phase0/pdfx1/.venv/bin/python}"
engine_py="${PAGEINATOR_ORACLE_PY:-$repo/tools/oracle/v0/.venv/bin/python}"
home="${PAGEINATOR_DESK_HOME:-$HOME/PageinatorPrivate/desk}"
for py in "$server_py" "$engine_py"; do
  if [ ! -x "$py" ]; then
    echo "Pageinator Desk needs $py (see docs/DEVELOPMENT.md)." >&2
    exit 1
  fi
done
mkdir -p "$home" && chmod 700 "$home"
export PYTHONDONTWRITEBYTECODE=1
if [ ! -f "$home/config.json" ]; then
  echo "Setting up the Desk from the private dataset…"
  if ! out=$(cd "$repo" && "$engine_py" tools/desk/engine/desk_engine.py setup --home "$home" 2>/dev/null); then
    echo "Pageinator Desk could not set itself up: $out" >&2
    echo "(The Desk needs the private dataset in ~/PageinatorPrivate/published1; see tools/desk/README.md.)" >&2
    exit 1
  fi
fi
cd "$repo"
exec "$server_py" tools/desk/server.py --home "$home" --open "$@"
