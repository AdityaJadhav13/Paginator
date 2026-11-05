# Golden vectors v1 — generators

The TypeScript engine must reproduce the frozen Python reference exactly. These generators run the frozen oracle
(`tools/oracle/v0`) and the Phase-0 experiments **read-only**, record inputs and outputs, and write them to
`fixtures/goldens/v1/` (and the font instances to `fixtures/fonts/v1/`). The TypeScript packages are tested against
those files from M1 on. Nothing here is product code.

## Run

From the repository root, with the frozen oracle's Python (CPython 3.11.14, never upgraded):

```sh
PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python tools/goldens/v1/gen_all.py           # regenerate in place
PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python tools/goldens/v1/gen_all.py --check   # must change nothing
PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python tools/goldens/v1/gen_all.py --only compose,pdf
```

- Each generator runs in its own interpreter (`gen_<name>.py --root DIR`). The experiments' modules share names
  (`common`, `fontreg`) and keep module-level state, so they are never mixed in one process.
- `--check` regenerates into a temporary directory and compares every file byte for byte. It also fails on files
  the generators did not write. The only tolerance is an `environment` block (platform, library versions) that
  differs while everything else is identical; that is a warning, or a failure with `--strict`.
- `PYTHONHASHSEED` is 0 when generating and 1 when checking. Any output that depends on set or dict ordering
  would therefore show up as a difference.
- The **reference machine** is the owner's Mac (macOS arm64, Python 3.11.14), decision O-c. gzip and the PDF
  writer's Flate streams come from the platform's zlib, so `--check` is run there. CI checks integrity instead:
  `tools/testkit/test/goldens.test.ts` compares every file with `MANIFEST.json`.
- A full run takes about 30 seconds.

## What is recorded

| Directory | Generator | Contents |
|---|---|---|
| `unicode/` | `gen_unicode.py` | Python 3.11 `unicodedata` (Unicode 14) categories, `isspace` / `isalpha` / `isdigit` / `isdecimal`, `lower()`, and HarfBuzz 14.3.0's script for every code point, as ranges |
| `pyshim/` | `gen_pyshim.py` | Python semantics the port emulates: `round`, fixed and `g` formatting, `repr`, `x ** 3`, `sum`, `statistics.median`, `sorted`, `split`, `json.dumps`, `stable_id` (616,073 assertions) |
| `fonts/`, `../fonts/v1/` | `gen_fonts.py` | Every font request of the goldens and experiments, resolved by the oracle: `font_id`, metrics, sample glyphs, every glyph's advance, the best cmap, and the pinned instance binaries with their OFL texts |
| `liang/` | `gen_liang.py` | The parsed hyph-mr / hyph-en-us tables and `word_breaks()` for 11,719 words |
| `compose/` | `gen_compose.py` | `prepare()` and full `compose()` dumps (6,565 compositions, 37,788 lines), 37 policies with their `key()`, and the inputs of the 32,076 tracked compose2 signatures |
| `headline/` | `gen_headline.py` | Keep-together links and glue, `compose()`, ranked layouts, forced line counts and `copyfit()` for 55 headlines (44 fictional) |
| `rline/` | `gen_rline.py` | 892 composed and natural lines placed as glyphs by the press test's `PageBuilder` |
| `pdf/` | `gen_pdf.py` | The PDF writer's building blocks (1,477 vectors) and 14 small PDF/X-1a files, each taken apart object by object |
| `press/` | `gen_press.py` | The synthetic press-test page and its manifest (every line and glyph), from the frozen script |

`MANIFEST.json` lists every file with its size and SHA-256, the counts, and the hashes of the evidence that is
referenced in place rather than copied (`experiments/phase0/results/compose2/signatures.json`, `fixtures/typeset/v1`).

## Conventions

- Floats are Python `float.hex()` text, under keys ending in `_hex`.
- Values whose Python type matters (policies) are typed trees: `["f", hex]`, `["i", "decimal"]`, `["s", text]`,
  `["b", bool]`, `["n"]`, `["l", […]]`, `["d", [[key, value], …]]`.
- JSON lines are canonical: sorted keys, no whitespace, UTF-8, no NaN or Infinity. They are gzipped with `mtime=0`.
- The PDF writer stamps dates from `SOURCE_DATE_EPOCH`. Both the press golden and the micro files use the EXP-PDF-1
  run's own timestamp, 1791991449 (2026-10-14 15:24:09 UTC).

## Privacy

- Public goldens use only the synthetic corpus, public prose from `docs/`, fictional headlines and OFL fonts.
- Every generator refuses to run when `PAGEINATOR_PRIVATE_FONTS` is set.
- The privacy guard reads every file, including the gzip content.
- The fictional headlines were checked against the private corpus: no four-word stretch of any of them occurs there.
- Private goldens (the pilot's own text, fonts and pages, for the private parity tests of M3, M4 and M8) belong in
  `~/PageinatorPrivate/goldens/v1/` and are never committed.

## Changing a golden

1. Change the generator. Never edit a file by hand.
2. Regenerate.
3. Explain the change in `fixtures/goldens/v1/CHANGELOG.md`.
4. Get a human's approval in the pull request.

Changing the frozen experiments or the oracle to change a golden is never the fix: they are the reference.
