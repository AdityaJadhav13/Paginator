# oracle-v0: Frozen Python Reference Engine

**EXPERIMENTAL / EVIDENCE TOOLING.**
- This is not production code and makes no architecture commitment (ADR-017: the kernel language is still open).
- Do not edit anything under `paginator/` or `tests/`. Record defects in `KNOWN_LIMITATIONS.md`. Experimental changes belong in `experiments/`, never here.

## What it is
- **Source:** a byte-identical copy of the typesetting core of the old Python stack.
  - Repo: `~/Engineering/Development /My Projects/Paginator`
  - Commit: `4694f81fe484f2d14019899df050f580b63340e8` (2026-08-14)
  - The source working tree was clean apart from an untracked `Paginator.code-workspace`.
- **Contents:**
  - `paginator/typeset/` (fonts, shaping, line breaking, schemas);
  - its imports `errors`, `ids`, `color` and `geometry`;
  - the 3 typesetting test files;
  - 16 OFL fonts with their licence files;
  - `requirements.lock`.
- **Manifest:** `ORACLE_MANIFEST.json` is machine-readable. It records:
  - the source commit and status;
  - a per-file SHA-256 compared against the source (identical);
  - Python, HarfBuzz and package versions;
  - CPU and OS;
  - every font's family, version, hash, outline format, axes, fsType and licence;
  - test results (182/182 passed).

## What it is not
- **Not correctness.** Its outputs are **BEHAVIOR goldens** only (`fixtures/typeset/README.md`).
- **Not a composer.** It has no justification positions, no frame flow, no overset, no emergency stretch, no tracking in breaking, no hyphenator and no RTL (see `capabilities` in the manifest).

## Reproduce
```bash
cd tools/oracle/v0
uv venv --python 3.11.14 .venv
uv pip install --python .venv/bin/python --require-hashes -r requirements.lock
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -q -p no:cacheprovider tests/      # expect 182 passed
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python freeze.py --source "<old repo path>" --run-tests  # regenerates manifest
```

## Fonts
- All bundled fonts are SIL OFL 1.1, so redistribution and embedding are allowed.
- The licence texts are in `assets/fonts/**/`.
- **Never add a non-OFL font here.** Pilot and commercial fonts are tested only in controlled environments (`docs/architecture/v2/19`).
