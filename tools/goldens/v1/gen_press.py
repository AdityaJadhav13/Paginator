"""G-PRESS: the synthetic press-test page, regenerated into the tracked goldens (EVIDENCE TOOLING).

experiments/phase0/pdfx1/make_press_test.py --synthetic writes the EXP-PDF-1 test page (PDF/X-1a, synthetic Marathi
text, OFL fonts) and a manifest of every line and glyph position. That output is git-ignored where the experiment
writes it; this generator runs the frozen script unchanged and keeps the result as a public golden, so the TypeScript
PDF writer (M5/M6) is checked against it in CI. The private press-accepted page stays private.

The writer stamps CreationDate/ModDate from the clock (and /ID is an MD5 of the body, dates included) unless
SOURCE_DATE_EPOCH is set, so the epoch is pinned to the EXP-PDF-1 run's own timestamp.

Against the EXP-PDF-1 file of 2026-10-14 (REFERENCE below) the golden differs in the build id only: page1-compose
2.8.0 (c9786fd) added two fields to composer3.Policy (pattern_min, compound_breaks); Policy.key() hashes asdict(), so
the body policy key and with it the build id printed in the two slug lines and the Title changed. Shown by rebuilding
the reference byte for byte from c9786fd^ with the same epoch, then diffing it against this output: 644 of 646
manifest lines and 6 of 7 streams identical; in the page stream only the 20 build-id glyphs (ids and x positions of
the two slug lines) differ; outside the streams only Title, the page stream's Length, xref offsets and /ID.
"""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from golden import EXPERIMENTS, GOLDENS, REPO, Out, cli, ensure_public, environment

NAME = "pageinator_press_test_synthetic"          # the EXP-PDF-1 name, so the manifest's "pdf" field matches too
SOURCE_DATE_EPOCH = 1791991449                    # 2026-10-14 15:24:09 UTC, the EXP-PDF-1 synthetic run
REFERENCE = {
    "file": "experiments/phase0/results/pdfx1/pageinator_press_test_synthetic.pdf (git-ignored; EXP-PDF-1)",
    "sha256": "7593d3f4981ce02a5ce90ee274e4ab31600745ba6a05832b0d61dba0ace7f1bd",
    "build_id": "39b217c097",
    "body_policy_key": "2d2631806ae1",
    "reproduced_from": "c9786fd^ (composer3.Policy before pattern_min/compound_breaks), same SOURCE_DATE_EPOCH",
    "differences": "build id only: Title; 2 slug lines (20 glyph ids and their x positions); page stream Length; "
                   "xref offsets; /ID. 644/646 manifest lines and 6/7 streams identical",
}


def main(root=REPO) -> dict:
    ensure_public()
    root = Path(root)
    out = Out(root)
    pdf = root / GOLDENS / "press" / f"{NAME}.pdf"
    pdf.parent.mkdir(parents=True, exist_ok=True)
    env = {k: v for k, v in os.environ.items() if k != "PAGEINATOR_PRIVATE_FONTS"}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["SOURCE_DATE_EPOCH"] = str(SOURCE_DATE_EPOCH)
    run = subprocess.run([sys.executable, str(EXPERIMENTS / "pdfx1" / "make_press_test.py"), "--synthetic", "--out", str(pdf)],
                         cwd=REPO, env=env, check=True, capture_output=True, text=True)
    result = json.loads(run.stdout.strip().splitlines()[-1])
    for p in (pdf, pdf.with_suffix(".manifest.json")):             # written by the frozen script; recorded here
        out.files[p.relative_to(root).as_posix()] = hashlib.sha256(p.read_bytes()).hexdigest()
    counts = {"bytes": result["bytes"], "glyphs": result["glyphs"], "actualtext_spans": result["actualtext_spans"],
              "lines": result["lines"]}
    out.json(GOLDENS / "press" / "info.json", {
        "schema": "pageinator.golden.press/1",
        "source": "experiments/phase0/pdfx1/make_press_test.py --synthetic (frozen, unchanged)",
        "source_date_epoch": SOURCE_DATE_EPOCH,
        "build_id": result["build_id"],
        "counts": counts,
        "files": dict(out.files),
        "reference": REFERENCE,
        "environment": environment(),
    })
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
