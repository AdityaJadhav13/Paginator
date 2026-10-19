"""EXP-PUBLISHED-1 pipeline: dataset directory → raw → measurement → corrected → overlays → report (EXPERIMENTAL).

Dataset layout (see docs/phase0/EXP_PUBLISHED_1.md §Intake):
  <dataset>/DATASET.json                     dataset_id, dataset_class, description, permissions
  <dataset>/samples/<sample_id>/source.pdf   the file as received (never modified)
  <dataset>/samples/<sample_id>/manifest.json   provenance (schema: intake/manifest.template.json)
  <dataset>/samples/<sample_id>/corrections.json (optional, human-written)
Outputs: <dataset>/work/<sample_id>/{raw.json, measure.json, corrected.json, overlay/} and <dataset>/report/.

PRIVACY GUARD: a PILOT_EVIDENCE dataset is refused if it sits inside the git repository and is not git-ignored.
Default private location: $PAGEINATOR_PRIVATE_CORPUS or ~/PageinatorPrivate/published1/.

Usage: .venv/bin/python run.py <dataset_dir> [--no-overlay]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import corrections as CO  # noqa: E402
import extract as X  # noqa: E402
import measure as M  # noqa: E402
import overlay as O  # noqa: E402
import report as R  # noqa: E402
import schema as S  # noqa: E402

REPO = HERE.parents[2]
REQUIRED = ["sample_id", "dataset_class", "publication", "edition_date", "page_number", "source_type", "evidence_level",
            "went_to_press", "is_final", "file_sha256", "date_received", "confidentiality", "permission_retain",
            "permission_internal_use", "permission_regression_tests"]


def guard(dataset: Path, cls: str) -> None:
    if cls != S.PILOT_EVIDENCE:
        return
    d = dataset.resolve()
    if REPO in d.parents or d == REPO:
        r = subprocess.run(["git", "-C", str(REPO), "check-ignore", "-q", str(d)], capture_output=True)
        if r.returncode != 0:
            sys.exit(f"REFUSED: PILOT_EVIDENCE dataset {d} is inside the git repo and NOT ignored. "
                     f"Move it to $PAGEINATOR_PRIVATE_CORPUS (default ~/PageinatorPrivate/published1/).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", type=Path); ap.add_argument("--no-overlay", action="store_true")
    a = ap.parse_args()
    ds = json.loads((a.dataset / "DATASET.json").read_text())
    if ds.get("dataset_class") not in S.DATASET_CLASSES:
        sys.exit(f"DATASET.json dataset_class must be one of {S.DATASET_CLASSES}")
    guard(a.dataset, ds["dataset_class"])
    docs = []
    for sd in sorted((a.dataset / "samples").iterdir()):
        if not sd.is_dir():
            continue
        man = json.loads((sd / "manifest.json").read_text())
        missing = [k for k in REQUIRED if k not in man]
        if missing:
            sys.exit(f"{sd.name}: manifest missing {missing}")
        if man["dataset_class"] != ds["dataset_class"]:
            sys.exit(f"{sd.name}: sample dataset_class {man['dataset_class']} ≠ dataset {ds['dataset_class']} (never mix classes)")
        pdf = next(sd.glob("*.pdf"))
        sha = hashlib.sha256(pdf.read_bytes()).hexdigest()
        if man["file_sha256"] not in ("", sha):
            sys.exit(f"{sd.name}: file hash {sha} ≠ manifest {man['file_sha256']} (file changed since intake?)")
        work = a.dataset / "work" / sd.name
        work.mkdir(parents=True, exist_ok=True)
        raw = X.extract(pdf); (work / "raw.json").write_text(json.dumps(raw, ensure_ascii=False))
        meas = M.measure(raw, man); (work / "measure.json").write_text(json.dumps(meas, ensure_ascii=False))
        doc = meas
        if (sd / "corrections.json").exists():
            doc = CO.apply(meas, json.loads((sd / "corrections.json").read_text()))
            (work / "corrected.json").write_text(json.dumps(doc, ensure_ascii=False))
        if not a.no_overlay:
            O.render(pdf, doc, work / "overlay")
        docs.append(doc)
        fr = [f for p in doc["pages"] for f in p["frames"]]
        print(f"{sd.name}: pages={len(doc['pages'])} frames={len(fr)} body={sum(f['is_body_candidate'] for f in fr)}")
    rep = R.build(docs, ds)
    (a.dataset / "report").mkdir(exist_ok=True)
    (a.dataset / "report" / "report.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False, default=str))
    (a.dataset / "report" / "report.md").write_text(R.to_markdown(rep), encoding="utf-8")
    print("report:", a.dataset / "report" / "report.md", "| pilot evidence:", rep["is_pilot_evidence"])


if __name__ == "__main__":
    main()
