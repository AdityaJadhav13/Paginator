"""O1 parity: the tools/onboard/chain fork reproduces the frozen Phase-0 chain BYTE FOR BYTE.

Fictional (always runs, ~1-2 min): four generated Marathi editions dated around the frozen SPLIT_DATE (2025-11-10),
with hand-style corrections.json, go through
  - the FROZEN scripts, run from a temporary copy of the repository (never in place: they write into the repo's
    experiments/phase0/results), and
  - the fork (onboard.read_samples with the given corrections + onboard.learn with the split date forced to the frozen
    one),
and every output the bundle and the profile are made of must be identical: work/*/corrected.json, paragraphs.jsonl,
headlines.jsonl, headline_practice.json, the page models, page_model_coverage.json, head1 rows and summary,
house_profile.json.

Private (skips without the data): PAGEINATOR_ONBOARD_PRIVATE_DS = a dataset folder the frozen chain already ran on (the
pilot's: samples/ with manifests and the hand corrections, plus its work/ and report/ outputs). The fork runs on a copy
of its samples and must reproduce those outputs, and the repository's results/page1/house_profile.json and
results/head1/summary.json (the pilot's committed aggregates).

Needs the oracle's Python for head1: PGN_ENGINE_PYTHON, else tools/oracle/v0/.venv/bin/python (skips without it).
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ONB = HERE.parent
REPO = ONB.parents[1]
sys.path.insert(0, str(ONB))
sys.path.insert(0, str(ONB / "fixtures"))
import make_paper as MP  # noqa: E402
import onboard as OB  # noqa: E402

FROZEN_SPLIT = "2025-11-10"
ENGINE_PY = os.environ.get("PGN_ENGINE_PYTHON") or str(REPO / "tools" / "oracle" / "v0" / ".venv" / "bin" / "python")
PUB1_PY = REPO / "experiments" / "phase0" / "published1" / ".venv" / "bin" / "python"
FROZEN_DIRS = ["experiments/phase0/" + d for d in ("published1", "page1", "head1", "compose1", "compose2", "compose3", "typeset_harness")] \
    + ["tools/oracle/v0", "fixtures/typeset/v1"]
REQUIRED = {"page_number": 0, "source_type": "fictional", "evidence_level": "A", "went_to_press": "fictional", "is_final": "yes",
            "date_received": "2026-11-05", "confidentiality": "public (fictional)", "permission_retain": "yes",
            "permission_internal_use": "yes", "permission_regression_tests": "yes", "publication": "fictional"}
CLASS = "GROUND_TRUTH_TOOL_VALIDATION_FIXTURE"


def frozen_repo(dst: Path) -> Path:
    """A copy of the frozen code (read from the repo, run elsewhere)."""
    for d in FROZEN_DIRS:
        shutil.copytree(REPO / d, dst / d, ignore=shutil.ignore_patterns(".venv", "__pycache__", "results", "node_modules"))
    return dst


def run_frozen(repo: Path, ds: Path) -> None:
    e = repo / "experiments" / "phase0"
    py = str(PUB1_PY) if PUB1_PY.exists() else sys.executable
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    for argv in ([py, e / "published1/run.py", ds, "--no-overlay"], [py, e / "published1/paragraphs.py", ds],
                 [py, e / "published1/headlines.py", ds], [ENGINE_PY, e / "head1/run_head1.py", ds],
                 [py, e / "page1/page_model.py", ds], [py, e / "page1/house_profile.py", ds, "--no-figures"]):
        r = subprocess.run([str(a) for a in argv], env=env, cwd=repo, capture_output=True, text=True)
        if r.returncode:
            raise AssertionError(f"frozen {Path(argv[1]).name} failed: {r.stdout[-500:]} {r.stderr[-1500:]}")


def copy_samples(src: Path, dst: Path) -> None:
    shutil.copyfile(src / "DATASET.json", dst / "DATASET.json")
    for sd in sorted((src / "samples").iterdir()):
        if sd.is_dir():
            (dst / "samples" / sd.name).mkdir(parents=True)
            for f in sd.iterdir():
                if f.suffix in (".pdf", ".json"):
                    shutil.copyfile(f, dst / "samples" / sd.name / f.name)


def run_fork(ds: Path, script: str = "devanagari") -> None:
    st = OB.Status(None)
    OB.read_samples(ds, st, auto=False)
    OB.learn(ds, st, FROZEN_SPLIT, script, ENGINE_PY)


def outputs(ds: Path) -> list:
    rel = [p.relative_to(ds).as_posix() for p in sorted((ds / "work").glob("*/corrected.json"))]
    rel += [p.relative_to(ds).as_posix() for p in sorted((ds / "report" / "page1" / "pages").glob("*.json"))]
    return rel + ["report/paragraphs.jsonl", "report/headlines.jsonl", "report/headline_practice.json"]


def read(p: Path) -> bytes:
    return gzip.decompress(p.read_bytes()) if p.suffix == ".gz" else p.read_bytes()   # gzip headers carry a time


def compare(test: unittest.TestCase, pairs: list) -> int:
    diff = [str(b) for a, b in pairs if read(a) != read(b)]
    test.assertEqual(diff, [], f"{len(diff)} of {len(pairs)} outputs differ")
    return len(pairs)


@unittest.skipUnless(Path(ENGINE_PY).exists(), "the oracle's Python (PGN_ENGINE_PYTHON) is needed for head1")
class FictionalParity(unittest.TestCase):
    def test_fork_equals_frozen(self):
        with tempfile.TemporaryDirectory(prefix="onboard-parity-") as t:
            t = Path(t)
            src = t / "src"
            paper = MP.Paper("mr", MP.load_fonts())
            (src / "samples").mkdir(parents=True)
            (src / "DATASET.json").write_text(json.dumps({"dataset_id": "fictional", "dataset_class": CLASS}))
            for n, ds_ in enumerate(("2025-11-04", "2025-11-05", "2025-11-10", "2025-11-11"), 1):
                sid = f"fict-{ds_}"
                sd = src / "samples" / sid
                sd.mkdir()
                pages, fonts = paper.edition(n, date.fromisoformat(ds_), 4)
                MP.write_pdf(sd / "source.pdf", pages, fonts, MP.info_for(date.fromisoformat(ds_), "x.pdf", "fictional"))
                (sd / "manifest.json").write_text(json.dumps({"sample_id": sid, "dataset_class": CLASS, "edition_date": ds_,
                                                              "file_sha256": "", **REQUIRED}))
                (sd / "corrections.json").write_text(json.dumps({"schema": "pageinator.published1.corrections/1", "author": "test",
                                                                 "date": "2026-11-05", "ops": [
                                                                     {"op": "exclude_frame", "frame": "p2-f3", "reason": "test"},
                                                                     {"op": "exclude_frame", "frame": "p9-f1", "reason": "unmatched"}]}))
            a, b = t / "frozen_ds", t / "fork_ds"
            for d in (a, b):
                d.mkdir()
                copy_samples(src, d)
            repo = frozen_repo(t / "repo")
            run_frozen(repo, a)
            run_fork(b)
            res = repo / "experiments" / "phase0" / "results"
            pairs = [(a / r, b / r) for r in outputs(a)]
            pairs += [(a / "report/head1/head1_rows.json.gz", b / "report/head1/head1_rows.json.gz"),
                      (res / "head1/summary.json", b / "report/head1/summary.json"),
                      (res / "page1/page_model_coverage.json", b / "report/page1/page_model_coverage.json"),
                      (res / "page1/house_profile.json", b / "house_profile.json")]
            self.assertGreater(len(list((a / "report/page1/pages").glob("*.json"))), 15)
            print(f"\nfictional parity: {compare(self, pairs)} outputs byte-identical", file=sys.stderr)


PRIVATE = os.environ.get("PAGEINATOR_ONBOARD_PRIVATE_DS")


@unittest.skipUnless(PRIVATE and (Path(PRIVATE) / "samples").is_dir() and Path(ENGINE_PY).exists(),
                     "private: set PAGEINATOR_ONBOARD_PRIVATE_DS to the pilot dataset the frozen chain ran on")
class PrivateParity(unittest.TestCase):
    def test_fork_reproduces_the_pilot(self):
        src = Path(PRIVATE)
        with tempfile.TemporaryDirectory(prefix="onboard-private-") as t:
            b = Path(t) / "ds"
            b.mkdir()
            copy_samples(src, b)
            run_fork(b)
            res = REPO / "experiments" / "phase0" / "results"
            pairs = [(src / r, b / r) for r in outputs(src)]
            pairs += [(src / "report/head1/head1_rows.json.gz", b / "report/head1/head1_rows.json.gz"),
                      (res / "head1/summary.json", b / "report/head1/summary.json"),
                      (res / "page1/house_profile.json", b / "house_profile.json")]
            print(f"\nprivate parity: {compare(self, pairs)} outputs byte-identical", file=sys.stderr)


if __name__ == "__main__":
    unittest.main()
