# Parts 2–4: Reference Engine Freeze, Typography Corpus, Measurement Harness

## Part 2: Reference engine freeze (`tools/oracle/v0/`)

| Item | Value |
|---|---|
| Oracle ID | `oracle-v0` (status FROZEN: reference behaviour, not correctness) |
| Source | `~/Engineering/Development /My Projects/Paginator` @ `4694f81fe484f2d14019899df050f580b63340e8` (2026-08-14). Only an untracked `Paginator.code-workspace` was present. **The source repo was not modified** (git status was the same before and after) |
| Copied | 41 files: `paginator/typeset/*`, `errors`, `ids`, `color`, `geometry`, 3 typeset test files, 16 OFL fonts plus licence texts, `requirements.lock`, `pyproject.toml`. **Every file is byte-identical to its source**, verified by SHA-256 in the manifest |
| Runtime | Python 3.11.14 in an isolated venv built from the lockfile with `--require-hashes` (uv). uharfbuzz 0.56.0 (**HarfBuzz 14.3.0**), fontTools 4.63.0, freetype-py 2.5.1, pydantic 2.13.4 |
| Tests | **182 passed, 0 failed, 0 skipped** (JUnit counts, 47 s) in the isolated venv |
| Platform | Apple M4 Pro, macOS (exact string in `ORACLE_MANIFEST.json`) |
| Manifest | `tools/oracle/v0/ORACLE_MANIFEST.json` covers: source commit and status; per-file hashes; packages; the HarfBuzz version; per-font family, version, hash, outline format (all TrueType/glyf), axes, fsType (all installable) and OFL licence; capabilities (what the oracle cannot do) |
| Reproduce | `tools/oracle/v0/README.md` |
| Known limitations | `tools/oracle/v0/KNOWN_LIMITATIONS.md`, OL-01 to OL-13. New in Phase 0: **OL-12**, malformed Devanagari is shaped silently; **OL-13**, default-ignorables are removed |

The reference engine and any experimental composer are kept apart:
- Nothing under `tools/oracle/v0/paginator` may be edited.
- Experiments call the public API from `experiments/phase0/`.

## Part 3: Typography corpus (`fixtures/typeset/v1/`)

### Text sources

All 63 texts are internally authored and fictional. **No native Marathi editor has reviewed them.**

| Kind | Count | Coverage |
|---|---|---|
| Marathi body | 18 | Civic, weather, sports, politics, education, crime, business, agriculture, health, culture, transport, research, court, obituary, GST. Short to long. Devanagari and Latin digits, currency, decimals, curly quotes, abbreviations (डॉ., एसटी), URL/email, names, places |
| Marathi headlines | 10 | Short and long, `;` `,` `?`, numerals, mixed Latin (IT, digits) |
| Difficult Devanagari | 17 | Conjuncts (क्ष ज्ञ त्र श्र द्ध द्व ह्म ह्ल स्त्र ष्ट्र), vocalic r, reph (incl. reph plus pre-base matra र्थि), half forms, pre/post-base matras, anusvara, candrabindu, visarga, nukta, avagraha, ळ, eyelash ra (U+0931 **and** RA+ZWJ+virama), candra-A ॲ/ऑ, ZWJ/ZWNJ, danda, quotes, dashes, ellipsis, Devanagari/Latin digits, ₹, NBSP, soft hyphen, ZWSP, orphan matra (invalid) |
| Mixed Marathi + Latin | 3 | COVID-19, Wi-Fi, initials (प्रा. डॉ. ए. के.), survey numbers (45/2अ), brands (iPhone, UPI, 24x7) |
| English body / headlines | 10 / 4 | Long words, hyphenated compounds, numbers, quotes, abbreviations (U.S., Q2), URL/email |
| Hindi body / headline | 2 / 1 | Weather, business |

### Layout conditions (`conditions.json`)

| Dimension | Values |
|---|---|
| Fonts | Devanagari: Noto Serif Devanagari, Mukta, Tiro Devanagari Hindi, Noto Sans Devanagari. Latin: Source Serif 4. Headlines: Noto Sans Devanagari 700, Mukta 700, Archivo Narrow 700 |
| Sizes | 8.5, 9, 9.5, 10 pt; headlines 24, 36, 48 pt |
| Column widths | 30.25, 38, 45, 52, 60 mm; headlines 64–200 mm. Plausible values only, **not** the pilot's |
| Spacing policies | P0 = oracle default (0.75 / 1.0 / 1.5); P1 = desktop-default-like (0.80 / 1.0 / 1.33); P2 = loose (max 2.0); P3 = very loose (max 3.0). P2 and P3 are sensitivity probes, **not** acceptable policies |

### BEHAVIOR goldens (`behavior/*.jsonl`)

There are **203 fixtures**:

| Kind | Fixtures | Matrix |
|---|---|---|
| Body | 150 | 3 widths × 9.5 pt × P0 × Knuth–Plass, 2 Devanagari fonts |
| Headline | 30 | 2 widths × 36 pt × greedy |
| Difficult | 17 | — |
| Mixed | 6 | — |

The schema is in `fixtures/typeset/README.md`.

**Shaping cross-check** against an independently built HarfBuzz (`hb-shape` 14.5.0; the oracle uses 14.3.0):
- **202 of 203 agree** on glyph IDs and clusters when flags are matched.
- The single disagreement is the orphan-matra input. `hb-shape` inserts a dotted circle; the oracle suppresses it.
- With default flags, 200 of 203 agree. The 2 extra disagreements are ZWJ/ZWNJ/soft-hyphen/ZWSP removal, which is explained by the oracle's flags.
- **This is agreement between HarfBuzz versions, not proof of correctness.**

### Golden classes
- BEHAVIOR: 203.
- CORRECTNESS: 0.
- HUMAN-ACCEPTED: 0.
- PRESS-ACCEPTED: 0.

### Blocked on customer content
- the real newspaper corpus (`real/README.md`, intake format ready);
- the pilot's fonts;
- the legacy-encoded samples (`fixtures/legacy/v1/README.md`).

### Font corpus record
- Every font is listed in `ORACLE_MANIFEST.json` with family, style, version, source file, SHA-256, outline format, axes, fsType and licence.
- **Rights:** all are SIL OFL 1.1. That permits server shaping, sending to browsers, PDF embedding, subsetting and repo redistribution with the licence file.
- **No pilot or commercial font has been added.** Those fonts will be tested only in a controlled environment (`../architecture/v2/19` §1).

## Part 4: Measurement harness (`experiments/phase0/`)

### What is measured

| Measurement | Script | Unit / output |
|---|---|---|
| Shaping time, node-building time, breaking time, total per paragraph (cold and warm) | `measure_performance.py` | p50 / p95 / p99 / max in ms, `paragraph_timings.csv` |
| Edition throughput (1,200 paragraphs; shaping cold vs cached) | same | Seconds |
| Server-authoritative interaction compute (headline edit, body edit, frame resize, column resize, image wrap, continuation change, page recompose) | same | p50 / p95 / p99 in ms |
| Display-list payload (story, page) | same | JSON and gzip bytes, encode ms |
| Line count, overflow (overfull lines), justification success (Knuth–Plass feasibility per policy), word-space expansion and compression (`space_factor` per line, policy-independent), unusable lines (single-word lines), in-word break frequency (upper bound), tracking sensitivity, composition-failure taxonomy | `investigate_justification.py` | `paragraphs.csv`, `lines.csv`, `summary.json` |
| Engine-bug check: oracle Knuth–Plass feasibility vs an independent dynamic-programming check | same | `summary.json` J8 |
| Shaping invariants (no `.notdef`, monotonic clusters, orphan marks) and cross-version shaping | `generate_goldens.py` | Per fixture |

### Reproducibility
- Every run writes `env.json`, covering:
  - CPU model, core count, memory and OS;
  - the Python executable and version;
  - the HarfBuzz and package versions;
  - the oracle manifest hash;
  - the corpus and conditions hashes;
  - the iteration counts and the definition of "warm".
- Commands are listed in `experiments/phase0/README.md`.
- These measurements ran on an **Apple M4 Pro laptop**, not on target servers or newsroom PCs.

### Performance baseline

| Step | Measurement |
|---|---|
| **Baseline** | The "≈1 ms/paragraph" claim from the 2026-10-07 review had no recorded environment. |
| **Measurement** | Warm, 50 iterations × 30 paragraphs, same process, fonts loaded.<br>• **Devanagari** (mean 255 characters): total p50 **0.30 ms**, p95 **0.52 ms**, max 0.64 ms. Shape 0.17, nodes 0.09, break 0.04 ms at p50.<br>• **Latin** (mean 234 characters): p50 0.23 ms, p95 0.55 ms.<br>• **Edition of 1,200 paragraphs:** 0.41 s with shaping, **0.17 s** re-breaking with cached shaping. |
| **Bottleneck** | **Cold font loading**: Noto Serif Devanagari takes **525 ms** and Source Serif 4 **3.2 s** before the first paragraph. Variable-font instancing (fontTools) dominates. Warm compute is not the bottleneck. |
| **Experiment** | None. We are not optimising without a need. |
| **Conclusion** | On this machine, raw Python composition speed is two to three orders of magnitude inside every interaction budget (see `ENGINE_AND_LATENCY_EXPERIMENTS.md`). **Do not migrate languages for performance on this evidence.** Cold font loading is a real operational concern for a server kernel. |
