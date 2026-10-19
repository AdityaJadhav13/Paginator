# Typography fixtures

**Status:** EXPERIMENTAL evidence assets (Phase 0). These fixtures are not product code and do not commit the architecture to any engine language.

## Golden classes

The class tells you how far to trust a fixture.

| Class | Meaning | How a fixture gets it | Present now |
|---|---|---|---|
| **BEHAVIOR** | What `oracle-v0` currently produces. It preserves existing behaviour and is **not** correctness | `experiments/phase0/typeset_harness/generate_goldens.py` | **Yes:** 203 fixtures in `v1/behavior/` |
| **CORRECTNESS** | Independently verified as correct, for example shaping confirmed by a native reviewer against a reference rendering, or line breaks proven by an independent check | A named method plus a reviewer or tool record per fixture | **None yet.** Cross-version `hb-shape` agreement (202/203) is supporting evidence only, not correctness |
| **HUMAN-ACCEPTED** | Typography accepted by qualified Marathi newspaper professionals under the G1 protocol | `docs/phase0/G1_ACCEPTANCE_PACKAGE.md` score sheets | **None.** BLOCKED: needs reviewers and representative output |
| **PRESS-ACCEPTED** | Tied to a real accepted printed result | `docs/architecture/v2/12` §7 | **None.** BLOCKED on G2 |

**Promotion rules:**
- Fixtures move up classes; they never move down silently.
- A changed expectation needs a changelog entry approved by a human (`CHANGELOG.md`).

## Layout
```
v1/corpus/texts.json        source texts (internally authored, fictional; NOT native-reviewed)
v1/conditions.json          fonts, sizes, measures, spacing policies, golden matrix
v1/behavior/*.jsonl         BEHAVIOR goldens (one JSON object per line) + GENERATION_ENV.json
v1/real/                    real newspaper material: BLOCKED on pilot (see README there)
```

## Fixture record (`pageinator.fixture.typeset/1`)

**Inputs:** id, golden_class, text_id, kind, tags, and `input`:
- text, sha256, language, script, direction;
- font: family, file, sha256, version, weight, axes, font_stack;
- size_pt, leading_pt, measures_mm;
- policy: name, word_space_min / max, tolerance;
- algorithm, hyphenation, tracking.

**Observed output** (`observed`):

| Field | Contents |
|---|---|
| `generator` | oracle id, source commit, HarfBuzz version |
| `itemization` | per-run start / end / script |
| `shaping` | per run: glyph_ids, clusters, advances, offsets in mm (**hex floats** for bit-exact comparison), font_id |
| `breaks` | algorithm requested / used, `used_fallback`, node indices, ratios (hex), natural widths (hex), hyphenated flags |
| `derived` | line_count, depth estimate, per-line `space_factor` (actual word space ÷ natural; policy-independent), per-line class |
| `invariants` | no `.notdef`; monotonic clusters; orphan combining marks |
| `shaping_crosscheck` | system `hb-shape` with matching flags (`--remove-default-ignorables`) |
| `shaping_crosscheck_hb_default_flags` | the same check with default flags |
| `not_available_in_oracle_v0` | honest list of what oracle-v0 cannot produce |

The record also carries a `limitations` list of KNOWN_LIMITATIONS IDs.

**Comparing across languages:** glyph IDs and clusters must match exactly. Advances may differ by at most 1 µpt after unit conversion. Ratios may differ by at most 1e-9.

## Regenerate
```bash
tools/oracle/v0/.venv/bin/python experiments/phase0/typeset_harness/generate_goldens.py
```
The output is deterministic for a fixed environment. `GENERATION_ENV.json` records that environment.
