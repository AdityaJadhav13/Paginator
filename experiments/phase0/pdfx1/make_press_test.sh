#!/usr/bin/env bash
# Pageinator press test (EXP-PDF-1, material for gate G2) — one command:
#   1. generate the press-test page (PDF/X-1a, CMYK, 347 × 540 mm) with Pageinator-composed text
#   2. verify it (40 checks: structure, PDF/X keys, paint/overprint, every glyph, fonts vs the ORIGINAL fonts,
#      INDEPENDENT re-shaping with HarfBuzz, text read-back, colours)
#   3. run the independent PDF/X-1a checker (written separately from the writer)
#   4. regenerate and confirm the bytes are identical
#   5. self-test the verifier: 6 deliberately damaged copies must each be caught
#   6. write a preview PNG and the printable press-test record sheet next to the PDF
# and print PASS/FAIL with the file to send to the press.
#
# Usage (from any folder):
#   <repo>/experiments/phase0/pdfx1/make_press_test.sh <private_dataset_dir>   # the paper's own paragraphs (stays private)
#   <repo>/experiments/phase0/pdfx1/make_press_test.sh --synthetic             # synthetic Marathi text (shareable)
# Options via environment: PDFX=X-1a:2003 (default, %PDF-1.4) | X-1a:2001 (%PDF-1.3)      ACTUALTEXT=1 (default) | 0
#   DEST_PROFILE=/path/press_profile.icc   embed the press's CMYK ICC profile (v2) in the output intent
#   CONDITION_ID=name                      its condition name if it is not IFRA26 (e.g. WAN-IFRAnewspaper26v5)
set -uo pipefail
if [ "${1:-}" = "--synthetic" ]; then
  MODE=synthetic
elif [ -n "${1:-}" ]; then
  MODE=dataset
  DS="$(cd "$1" 2>/dev/null && pwd)" || { echo "Dataset folder not found: $1"; exit 2; }
  umask 077                                   # everything written from private data stays private
else
  echo "usage: $0 <private_dataset_dir> | --synthetic"; exit 2
fi
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO"
ORACLE_PY="tools/oracle/v0/.venv/bin/python"
TOOLS_PY="experiments/phase0/pdfx1/.venv/bin/python"
HERE="experiments/phase0/pdfx1"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ ! -x "$ORACLE_PY" ]; then
  echo "The composer environment is missing. Create it once with:"
  echo "  cd tools/oracle/v0 && uv venv --python 3.11.14 .venv && uv pip install --python .venv/bin/python --require-hashes -r requirements.lock"
  exit 2
fi
if [ ! -x "$TOOLS_PY" ]; then
  echo "Creating the PDF check environment (one time, needs internet)…"
  uv venv --python 3.11 "$HERE/.venv" >/dev/null && uv pip install --python "$TOOLS_PY" -r "$HERE/requirements.txt" || { echo "could not create $HERE/.venv"; exit 2; }
fi

export PYTHONDONTWRITEBYTECODE=1
export SOURCE_DATE_EPOCH="${SOURCE_DATE_EPOCH:-$(date +%s)}"   # fixed for this run → regeneration must be byte-identical
GEN=(--output-intent "${OUTPUT_INTENT:-IFRA26}" --pdfx "${PDFX:-X-1a:2003}")
[ "${ACTUALTEXT:-1}" = "0" ] && GEN+=(--no-actualtext)
[ -n "${DEST_PROFILE:-}" ] && GEN+=(--dest-profile "$(cd "$(dirname "$DEST_PROFILE")" && pwd)/$(basename "$DEST_PROFILE")")
[ -n "${CONDITION_ID:-}" ] && GEN+=(--condition-id "$CONDITION_ID")
if [ "$MODE" = "synthetic" ]; then
  SRC=(--synthetic)
else
  [ -f "$DS/report/paragraphs.jsonl" ] || { echo "No $DS/report/paragraphs.jsonl — run experiments/phase0/published1/paragraphs.py on the dataset first."; exit 2; }
  SRC=(--dataset "$DS")
fi
STATUS=0
show() {   # print the summary line(s) and every FAIL/WARN line of a checker's output
  grep -E "^(FAIL|WARN)|ALL CHECKS|CHECK\(S\)|SUMMARY|RESULT|CAUGHT|MISSED|MUTATIONS" "$1" | sed 's/^/   /' || true
}

echo "== 1/6 generating the press-test page"
if ! OUT_JSON="$("$ORACLE_PY" "$HERE/make_press_test.py" "${SRC[@]}" "${GEN[@]}" 2>"$TMP/gen.err")"; then
  cat "$TMP/gen.err"; echo "GENERATION FAILED"; exit 1
fi
PDF="$(printf '%s' "$OUT_JSON" | "$TOOLS_PY" -c 'import json,sys; print(json.load(sys.stdin)["pdf"])')"
echo "   $PDF"

echo "== 2/6 verifying (40 checks, several independent of the generator)"
"$TOOLS_PY" "$HERE/verify_press_test.py" "$PDF" --json "${PDF%.pdf}.verify.json" >"$TMP/verify.out" 2>&1 || STATUS=1
show "$TMP/verify.out"

echo "== 3/6 independent PDF/X-1a checker"
if [ -f "$HERE/check_pdfx1a_independent.py" ]; then
  "$TOOLS_PY" "$HERE/check_pdfx1a_independent.py" "$PDF" --json "${PDF%.pdf}.pdfx-check.json" >"$TMP/indep.out" 2>&1 || STATUS=1
  show "$TMP/indep.out"
else
  echo "   SKIPPED — check_pdfx1a_independent.py is missing"; [ "$STATUS" -eq 0 ] && STATUS=3
fi

echo "== 4/6 regenerating to confirm byte-identical output"
if "$ORACLE_PY" "$HERE/make_press_test.py" "${SRC[@]}" "${GEN[@]}" --out "$TMP/again.pdf" >/dev/null 2>"$TMP/gen2.err" && cmp -s "$PDF" "$TMP/again.pdf"; then
  echo "   PASS  byte-identical"
else
  echo "   FAIL  regeneration differs"; cat "$TMP/gen2.err"; STATUS=1
fi

echo "== 5/6 verifier self-test (6 deliberately damaged copies must each be caught; synthetic page)"
if "$ORACLE_PY" "$HERE/make_press_test.py" --synthetic "${GEN[@]}" --out "$TMP/selftest.pdf" >/dev/null 2>&1 \
   && "$TOOLS_PY" "$HERE/mutation_test.py" "$TMP/selftest.pdf" >"$TMP/mut.out" 2>&1; then
  show "$TMP/mut.out"
else
  show "$TMP/mut.out"; echo "   FAIL  verifier self-test"; STATUS=1
fi

echo "== 6/6 preview image and press-test record sheet"
"$TOOLS_PY" - "$PDF" <<'PY'
import sys, pypdfium2 as pdfium
pdf = sys.argv[1]
pdfium.PdfDocument(pdf)[0].render(scale=100 / 72).to_pil().save(pdf[:-4] + ".preview.png")
print("   preview:", pdf[:-4] + ".preview.png")
PY
cp "$HERE/press_test_record.html" "$(dirname "$PDF")/press_test_record.html"
echo "   record sheet: $(dirname "$PDF")/press_test_record.html"

SHA="$(shasum -a 256 "$PDF" | cut -d' ' -f1)"
echo
case "$STATUS" in
  0) echo "ALL CHECKS PASSED — ready for the press test" ;;
  3) echo "PASSED, BUT THE INDEPENDENT CHECKER WAS SKIPPED — see above" ;;
  *) echo "SOME CHECKS FAILED — do not send this file; the failing checks are listed above" ;;
esac
echo "File to send : $PDF"
echo "SHA-256      : $SHA"
echo "Size         : $(du -h "$PDF" | cut -f1)"
echo "Send it on WhatsApp as a DOCUMENT (paperclip → Document), not as a photo, so it is not compressed."
echo "Ask the printing unit to fill in press_test_record.html (printed) and send back their RIP/preflight messages."
exit "$STATUS"
