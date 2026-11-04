#!/bin/sh
# Packs the Desk's home for the one-time import into the hosted newsroom (docs/product/10-l2-newsroom-plan.md §3.8):
#   desk-home.zip       editions/ (every file of every edition, but the Desk's own temporaries: dot files and folders
#                       such as .desk.lock and .bundle-*, *.log, measure-status.json; no cache/ and no trash/, which
#                       live beside editions/), the Desk's config.json, and manifest.json (every file's path, bytes
#                       and SHA-256), which `pnpm --filter @pageinator/api import-desk` checks file by file;
#   engine-dataset.zip  the parts of the dataset the engine reads (report/headlines.jsonl, report/page1/pages,
#                       photos and brand, work/*/corrected.json and measure.json) with the Desk's config.json at its
#                       root: the engine profile's bundle (Settings, "Engine profile").
# A ZIP, not the plan's tar.zst: neither the worker's Python 3.11 nor the API reads zstd without a new dependency.
# Both files hold the paper's private data: they are written outside the repository, and the SHA-256 of each is
# printed to compare with what the server reports. Stop the Desk first, so no run is half-written.
#   tools/desk/export-home.sh [--home DIR] [--out DIR]
set -eu

here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
home="${PAGEINATOR_DESK_HOME:-$HOME/PageinatorPrivate/desk}"
out="$HOME/PageinatorPrivate/desk-export"

while [ $# -gt 0 ]; do
  case "$1" in
    --home) home="${2:?--home needs a folder}"; shift 2 ;;
    --out) out="${2:?--out needs a folder}"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (use --home DIR, --out DIR)." >&2; exit 2 ;;
  esac
done

fail() { echo "$1" >&2; exit 1; }
[ -d "$home/editions" ] || fail "No Desk home at $home (it has no editions folder)."
[ -f "$home/config.json" ] || fail "The Desk at $home is not set up (no config.json)."
home=$(cd "$home" && pwd)
case "$out" in /*) ;; *) out="$(pwd)/$out" ;; esac
case "$out/" in "$repo"/*) fail "The export holds the paper's private data: write it outside the repository." ;; esac
mkdir -p "$out" && chmod 700 "$out"
out=$(cd "$out" && pwd)
for name in desk-home.zip engine-dataset.zip; do
  # zip adds to an existing archive: never mix two exports
  [ ! -e "$out/$name" ] || fail "$out/$name exists already: move it away or choose another --out."
done

dataset=$(python3 -I -c 'import json, sys; print(json.load(open(sys.argv[1], encoding="utf-8")).get("dataset") or "")' \
  "$home/config.json")
[ -n "$dataset" ] && [ -d "$dataset/report/page1/pages" ] ||
  fail "The dataset the Desk's config.json names ($dataset) has no report/page1/pages."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

# ------------------------------------------------------------------------------------------------- desk-home.zip
(cd "$home" && find editions \( -name '.*' -o -name '*.log' -o -name measure-status.json \) -prune -o -type f -print |
  LC_ALL=C sort) >"$work/files"
echo config.json >>"$work/files"
# the manifest: one read of each file (python3 -I: nothing from the current folder is imported)
python3 -I - "$home" "$work/files" "$work/manifest.json" <<'PY'
import hashlib, json, os, sys
from datetime import datetime, timezone
home, listing, target = sys.argv[1:4]
files = []
with open(listing, encoding="utf-8") as names:
    for name in names:
        name = name.rstrip("\n")
        path = os.path.join(home, name)
        if not os.path.isfile(path):          # a name with a line break in it, or a file gone meanwhile
            sys.exit(f"Cannot read {name!r}: is the Desk still running?")
        digest, size = hashlib.sha256(), 0
        with open(path, "rb") as f:
            while chunk := f.read(1 << 20):
                digest.update(chunk)
                size += len(chunk)
        files.append({"path": name, "bytes": size, "sha256": digest.hexdigest()})
doc = {"format": "pageinator.desk-export/1", "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
       "files": files}
with open(target, "w", encoding="utf-8") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
print(f"{len(files)} files, {sum(x['bytes'] for x in files)} bytes")
PY
(cd "$home" && zip -q -X -D "$out/desk-home.zip" -@ <"$work/files")
(cd "$work" && zip -q -X "$out/desk-home.zip" manifest.json)

# ---------------------------------------------------------------------------------------------- engine-dataset.zip
(cd "$dataset" && {
  find report/page1/pages report/page1/photos report/page1/brand -type f 2>/dev/null || true
  [ ! -f report/headlines.jsonl ] || echo report/headlines.jsonl
  find work -type f \( -name corrected.json -o -name measure.json \) 2>/dev/null || true
} | LC_ALL=C sort) >"$work/dataset-files"
(cd "$dataset" && zip -q -X -D "$out/engine-dataset.zip" -@ <"$work/dataset-files")
(cd "$home" && zip -q -X "$out/engine-dataset.zip" config.json)
chmod 600 "$out/desk-home.zip" "$out/engine-dataset.zip"

echo "Desk home:      $out/desk-home.zip"
echo "  SHA-256 $(shasum -a 256 "$out/desk-home.zip" | cut -d' ' -f1)"
echo "Engine dataset: $out/engine-dataset.zip ($(wc -l <"$work/dataset-files" | tr -d ' ') files and config.json)"
echo "  SHA-256 $(shasum -a 256 "$out/engine-dataset.zip" | cut -d' ' -f1)"
