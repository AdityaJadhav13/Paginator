"""EXP-GEN-1: three different layouts of one page for the editor to choose from (EXPERIMENTAL; PRIVATE OUTPUT).

  A  the best layout (generate.py as usual)
  B  the lead story on the other side of the page (--lead-side)
  C  the lead story at a different width than in A (--ban-lead-width)
Each is a complete, checked page; they differ in design, not in content. Output: <dataset>/report/gen1_alts/<page>/A|B|C
(.pdf + .manifest.json + .fixed.pdf) and a summary of what differs.
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/gen1/alternatives.py <dataset_dir> <page> [...]
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GEN = HERE / "generate.py"


def run(ds: Path, page: str, out: Path, *extra) -> dict | None:
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(GEN), str(ds), page, "--out", str(out), *extra], capture_output=True, text=True)
    mf = out / f"{page}.manifest.json"
    return json.loads(mf.read_text(encoding="utf-8")) if mf.exists() else None


def lead(man: dict) -> dict:
    return min(man["placed"], key=lambda p: p["rank"])


def main():
    ds = Path(sys.argv[1]).expanduser()
    for page in sys.argv[2:]:
        root = ds / "report" / "gen1_alts" / page
        a = run(ds, page, root / "A")
        if a is None:
            print(page, "no layout"); continue
        side = "left" if lead(a)["x"] > 120 else "right"           # the other side than A's lead
        b = run(ds, page, root / "B", "--lead-side", side)
        c = run(ds, page, root / "C", "--ban-lead-width", str(lead(a)["w"]))
        summary = {"page": page, "alternatives": {}}
        for k, m in (("A", a), ("B", b), ("C", c)):
            if m is None:
                summary["alternatives"][k] = None
                continue
            ld = lead(m)
            summary["alternatives"][k] = {"lead_width_cols": ld["w"], "lead_x_mm": ld["x"], "lead_y_mm": ld["y"], "cost": m.get("cost"),
                                          "spans": [p["w"] for p in sorted(m["placed"], key=lambda p: p["rank"])]}
        (root / "summary.json").write_text(json.dumps(summary, indent=1) + "\n")
        for f in root.rglob("*"):
            if f.is_file():
                f.chmod(0o600)
        print(page, json.dumps(summary["alternatives"]))


if __name__ == "__main__":
    main()
