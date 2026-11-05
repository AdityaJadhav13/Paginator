"""Onboard a new paper (L4): a paper's past edition PDFs -> its engine dataset bundle, deterministically (no AI).

  <PY> tools/onboard/onboard.py build --files <files.json> --out <dataset dir> --status <status.json>
        [--icc <icc file>] [--masthead <image>] [--engine-python <oracle python>]
  <PY> tools/onboard/onboard.py pack --dataset <dir> --zip <out.zip> [--status <status.json>]

<PY> is the pdfx1 venv's Python (experiments/phase0/pdfx1/.venv: pdfminer, pypdfium2, fontTools, pikepdf, Pillow; the
engine worker's venv has the same pins) and runs every step but one in this process or as its child. head1 (headline
breaks) needs the oracle's typesetter and runs under --engine-python, else $PGN_ENGINE_PYTHON, else
tools/oracle/v0/.venv/bin/python (the Desk engine's Python).

build, in order (status.json's step, packages/contracts/src/onboard.ts ONBOARD_STEPS):
  checking   intake.py: one check per PDF; fewer than MIN_EDITIONS usable editions -> onboard.too_few_editions
  reading    samples/<id>/{source.pdf, manifest.json}: the manifest is generated from the upload facts (the date read
             from the file name, else the PDF's CreationDate; the paper confirmed the permissions on upload), never hand
             written; chain/extract + chain/measure; autocorrect.py writes corrections.json (O6) -> corrected.json;
             no column grid -> onboard.no_grid; too much left out -> onboard.too_many_excluded
  measuring  chain/paragraphs.py, chain/headlines.py, chain/run_head1.py
  learning   chain/page_model.py, chain/house_profile.py -> house_profile.json; paper.json; the roles check
             (no page for a role -> onboard.no_template)
  pictures   chain/photos.py (and chain/brand.py with --masthead): the press ICC if given, else a plain conversion
The calibration/test split (SPLIT RULE): editions sorted by date; the oldest ceil(2n/3) are calibration; split_date =
the date of the oldest test edition (pages dated before it are "cal").
Prints ONE JSON line on stdout (outcome ready | rejected; FileCheck and OnboardReport shapes); exit 0 for both. A crash
exits non-zero (stderr says why); SIGTERM stops the running step and exits 143. Child output goes to <out>/logs/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
import zipfile
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
CHAIN = HERE / "chain"
REPO = HERE.parents[1]
sys.path.insert(0, str(CHAIN))
sys.path.insert(0, str(HERE))
import autocorrect as AC  # noqa: E402
import corrections as CO  # noqa: E402
import extract as X  # noqa: E402
import intake as IN  # noqa: E402
import measure as M  # noqa: E402

MIN_EDITIONS = 3                 # furniture must recur in 3 editions (headlines.py RECUR_EDITIONS)
RECUR_EDITIONS = 3
IMPRINT_FOOT = 0.15              # the imprint sits in the lowest 15 % of page 2
GRID_MIN_FRAMES = 6              # a column grid needs at least this many body frames of the modal width ...
GRID_SHARE = 0.10                # ... and a measure is "seen" when it holds >= 10 % of the body frames
ROLES = ("front", "inside_imprint", "inside", "back")
CHILD: list = []
FILES: dict = {}                 # n -> FileCheck, as far as build got (a rejection reports them)


class Rejected(Exception):
    def __init__(self, code: str, message: str, params: dict | None = None):
        super().__init__(message)
        self.code, self.params, self.message = code, params, message


# ------------------------------------------------------------------------------------------------ plumbing
BEAT_S = 30                    # a long step rewrites status.json this often (the worker stops a tool that shows no change)


class Status:
    def __init__(self, path: Path | None):
        self.path, self.last, self.beats = path, None, 0
        STATUS.append(self)

    def __call__(self, step: str, done: int, total: int) -> None:
        self.last = {"step": step, "done": done, "total": total}
        self._write()

    def beat(self) -> None:
        """The same step, still alive: `beat` counts up (the worker reads step, done and total only)."""
        if self.last:
            self.beats += 1
            self._write()

    def _write(self) -> None:
        if self.path:
            tmp = self.path.with_suffix(self.path.suffix + ".tmp")
            tmp.write_text(json.dumps({**self.last, "beat": self.beats}) + "\n")
            os.replace(tmp, self.path)


STATUS: list = []


def on_term(signum, frame):  # noqa: ARG001
    for p in CHILD:
        if p.poll() is None:
            p.terminate()
    sys.stderr.write("onboard: stopped (SIGTERM)\n")
    os._exit(143)


def run(ds: Path, step: str, argv: list) -> None:
    """A chain script as a child (its own output to logs/<name>.log); a non-zero exit -> onboard.failed."""
    logs = ds / "logs"
    logs.mkdir(exist_ok=True)
    name = Path(argv[1]).stem
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    with open(logs / f"{name}.log", "w") as log:
        p = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT, env=env, cwd=CHAIN)
        CHILD.append(p)
        while True:
            try:
                rc = p.wait(timeout=BEAT_S)
                break
            except subprocess.TimeoutExpired:
                for st in STATUS:
                    st.beat()
        CHILD.remove(p)
    if rc != 0:
        tail = (logs / f"{name}.log").read_text(errors="replace").strip().splitlines()[-1:] or [""]
        raise Rejected("onboard.failed", f"the {step} step ({name}) stopped: {tail[0][:300]}", {"step": step})


def engine_python(arg: str | None) -> str:
    py = arg or os.environ.get("PGN_ENGINE_PYTHON") or str(REPO / "tools" / "oracle" / "v0" / ".venv" / "bin" / "python")
    if not Path(py).exists():
        raise SystemExit(f"head1 needs the oracle's Python: pass --engine-python (not found: {py})")
    return py


def split_date(dates: list) -> str:
    """SPLIT RULE: the oldest ceil(2n/3) editions calibrate; the split date is the oldest test edition's date."""
    ds = sorted(dates)
    return ds[(2 * len(ds) + 2) // 3] if len(ds) >= 2 else "9999-12-31"


def manifest(sid: str, f: dict, facts: dict) -> dict:
    return {"sample_id": sid, "dataset_class": "PILOT_EVIDENCE", "publication": None, "edition_date": facts["date"],
            "page_number": 0, "source_type": "production PDF uploaded by the paper", "evidence_level": "A",
            "went_to_press": "confirmed by the paper on upload", "is_final": "confirmed by the paper on upload",
            "file_name_as_received": f["name"], "file_sha256": facts["sha256"], "date_received": None,
            "producing_software_if_known": None, "confidentiality": "private to the paper",
            "permission_retain": "confirmed by the paper on upload", "permission_internal_use": "confirmed by the paper on upload",
            "permission_regression_tests": "no", "notes": "generated by tools/onboard from the upload facts (no hand-written manifest)"}


# ------------------------------------------------------------------------------------------------ the chain
def read_samples(ds: Path, status: Status, auto: bool = True) -> dict:
    """extract + measure every sample, then corrections (O6 automatic, or the corrections.json already there) -> corrected.
    The loop is published1/run.py's (no manifest field check, no repo guard, no overlays, no report)."""
    sids = sorted(p.name for p in (ds / "samples").iterdir() if p.is_dir())
    docs, pdfs = {}, {}
    for k, sid in enumerate(sids):
        status("reading", k, len(sids) + 1)
        sd = ds / "samples" / sid
        man = json.loads((sd / "manifest.json").read_text())
        pdf = next(sd.glob("*.pdf"))
        work = ds / "work" / sid
        work.mkdir(parents=True, exist_ok=True)
        raw = X.extract(pdf)
        (work / "raw.json").write_text(json.dumps(raw, ensure_ascii=False))
        meas = M.measure(raw, man)
        (work / "measure.json").write_text(json.dumps(meas, ensure_ascii=False))
        docs[sid], pdfs[sid] = meas, pdf
    totals = None
    if auto:
        status("reading", len(sids), len(sids) + 1)
        corr, totals = AC.corrections(docs, pdfs)
        AC.write(ds, corr)
    for sid in sids:
        cf = ds / "samples" / sid / "corrections.json"
        if cf.exists():
            doc = CO.apply(docs[sid], json.loads(cf.read_text()))
            (ds / "work" / sid / "corrected.json").write_text(json.dumps(doc, ensure_ascii=False))
    (ds / "report").mkdir(exist_ok=True)  # as run.py: the later steps write into report/
    return {"sids": sids, "docs": docs, "excluded": totals}


def learn(ds: Path, status: Status, split: str, script: str, engine_py: str) -> None:
    py = sys.executable
    steps = [("measuring", [py, "paragraphs.py", str(ds)]), ("measuring", [py, "headlines.py", str(ds)]),
             ("measuring", [engine_py, "run_head1.py", str(ds), split]),
             ("learning", [py, "page_model.py", str(ds), "--split-date", split]),
             ("learning", [py, "house_profile.py", str(ds), "--no-figures", "--script", script])]
    for k, (step, argv) in enumerate(steps):
        status(step, k, len(steps))
        run(ds, step, [argv[0], str(CHAIN / argv[1]), *argv[2:]])


def pictures(ds: Path, status: Status, icc: str | None, masthead: str | None) -> None:
    prof = ["--profile", icc] if icc else []
    status("pictures", 0, 2)
    run(ds, "pictures", [sys.executable, str(CHAIN / "photos.py"), str(ds), *prof])
    if masthead:
        status("pictures", 1, 2)
        run(ds, "pictures", [sys.executable, str(CHAIN / "brand.py"), str(ds), *prof, "--masthead", masthead])
    status("pictures", 2, 2)


# ------------------------------------------------------------------------------------------------ what the bundle says
def body_script(docs: dict) -> str:
    deva = latn = 0
    for d in docs.values():
        for pg in d["pages"]:
            for f in pg["frames"]:
                if f["is_body_candidate"] and not f.get("excluded"):
                    for l in f["lines"]:
                        for t in l["tokens"]:
                            deva += sum("ऀ" <= ch <= "ॿ" for ch in t["text"])
                            latn += sum("A" <= ch <= "ɏ" and ch.isalpha() for ch in t["text"])  # as the Desk's
    return "deva" if deva >= latn else "latn"


def grid_check(docs: dict) -> int:
    """grids seen (measures holding >= GRID_SHARE of the body frames); refuses when no grid can be estimated."""
    w = Counter(round(f["width_mm"] * 2) / 2 for d in docs.values() for pg in d["pages"] for f in pg["frames"]
                if f["is_body_candidate"] and not f.get("excluded") and f["width_confidence"] == "DERIVED")
    total = sum(w.values())
    if not w or max(w.values()) < GRID_MIN_FRAMES:
        raise Rejected("onboard.no_grid", "No column grid was found: too few justified body columns.")
    return max(1, sum(1 for n in w.values() if n >= GRID_SHARE * total))


def imprint_texts(ds: Path, page_h_mm: float) -> list:
    """Text at the foot of page 2 (lowest IMPRINT_FOOT of the page) recurring in >= RECUR_EDITIONS editions."""
    seen: dict = {}
    for line in open(ds / "report" / "headlines.jsonl", encoding="utf-8"):
        r = json.loads(line)
        if r["page"] != 2 or not r["lines"]:
            continue
        if min(l["baseline_pt"] for l in r["lines"]) <= IMPRINT_FOOT * page_h_mm * 72 / 25.4:
            seen.setdefault(" ".join(r["text"].split()), set()).add(r["sample"])
    return sorted(t for t, s in seen.items() if len(s) >= RECUR_EDITIONS)


def roles_check(ds: Path, imprint: list) -> dict:
    """Pages per template role, an equivalent of the Desk setup's test (setup itself chooses the templates): front =
    page 1 without ads; inside_imprint = page 2 without ads holding the imprint; inside = pages 3 … last-1 without ads;
    back = the last page with ads."""
    models = [json.loads(p.read_text(encoding="utf-8")) for p in sorted((ds / "report" / "page1" / "pages").glob("*.json"))]
    last = {}
    for m in models:
        last[m["sample"]] = max(last.get(m["sample"], 0), m["page"])
    roles = Counter()
    for m in models:
        ads = any(e["kind"] == "ad" for e in m["elements"])
        p, lp = m["page"], last[m["sample"]]
        texts = " ".join(" ".join((e.get("text") or "").split()) for e in m["elements"])
        if p == 1 and not ads:
            roles["front"] += 1
        elif p == 2 and not ads and imprint and any(t in texts for t in imprint):
            roles["inside_imprint"] += 1
        elif p == lp and ads:
            roles["back"] += 1
        elif 2 < p < lp and not ads:
            roles["inside"] += 1
    return {r: roles[r] for r in ROLES}


# ------------------------------------------------------------------------------------------------ commands
def build(a) -> dict:
    status = Status(a.status)
    out = a.out.resolve()
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"--out must be empty: {out}")
    files = json.loads(a.files.read_text(encoding="utf-8"))["files"]
    status("checking", 0, len(files))
    rows = IN.check_set(files)
    checks = FILES
    checks.update({r["n"]: r["check"] for r in rows})
    usable = [r for r in rows if r["check"]["status"] != "refused"]
    if len(usable) < MIN_EDITIONS:
        raise Rejected("onboard.too_few_editions", f"{len(usable)} usable editions; at least {MIN_EDITIONS} are needed.",
                       {"usable": len(usable), "needed": MIN_EDITIONS})
    engine_py = engine_python(a.engine_python)
    t = {"start": time.monotonic()}
    out.mkdir(parents=True, exist_ok=True)
    sid_of = {}
    for r in usable:
        sid = f"ed-{r['facts']['date'].replace('-', '')}"  # ed-YYYYMMDD: the Desk reads the date from it (desksamples)
        sid_of[sid] = r
        sd = out / "samples" / sid
        sd.mkdir(parents=True)
        shutil.copyfile(r["path"], sd / "source.pdf")
        (sd / "manifest.json").write_text(json.dumps(manifest(sid, r, r["facts"]), ensure_ascii=False, indent=1) + "\n")
    (out / "DATASET.json").write_text(json.dumps({"dataset_id": "onboard", "dataset_class": "PILOT_EVIDENCE",
                                                  "description": "made by tools/onboard from the paper's uploads"}) + "\n")
    rd = read_samples(out, status)
    t["reading"] = time.monotonic()
    for sid, r in sid_of.items():
        n_ex = sum(1 for p in json.loads((out / "samples" / sid / "corrections.json").read_text())["ops"])
        if n_ex:
            checks[r["n"]] = IN.file_check(r, [{"code": "onboard.frames_excluded", "count": n_ex}])
    ex = rd["excluded"]
    if ex["share"] > AC.MAX_EXCLUDED_SHARE:
        raise Rejected("onboard.too_many_excluded", f"{ex['share']:.1%} of the body frames could not be read "
                       f"(limit {AC.MAX_EXCLUDED_SHARE:.0%}).", {"share": ex["share"], "limit": AC.MAX_EXCLUDED_SHARE})
    grids_seen = grid_check(rd["docs"])
    script = body_script(rd["docs"])
    dates = [r["facts"]["date"] for r in usable]
    split = split_date(dates)
    learn(out, status, split, "devanagari" if script == "deva" else "latin", engine_py)
    t["learning"] = time.monotonic()
    pg0 = rd["docs"][rd["sids"][0]]["pages"][0]
    w_mm, h_mm = round(pg0["page_w_mm"], 1), round(pg0["page_h_mm"], 1)
    imprint = imprint_texts(out, h_mm)
    sizes = sorted({r["facts"]["pages"] for r in usable})
    paper = {"format": "pageinator.paper/1", "script": script, "imprint_text": imprint, "split_date": split,
             "page_w_mm": w_mm, "page_h_mm": h_mm, "edition_sizes": sizes}
    (out / "paper.json").write_text(json.dumps(paper, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    roles = roles_check(out, imprint)
    missing = [r for r in ROLES if not roles[r]]
    if missing:
        raise Rejected("onboard.no_template", f"No page was found for the {missing[0].replace('_', ' ')} role.", {"role": missing[0]})
    pictures(out, status, a.icc, a.masthead)
    t["pictures"] = time.monotonic()
    g = json.loads((out / "house_profile.json").read_text())["grid"]
    report = {"editions": len(usable), "pages": sum(r["facts"]["pages"] for r in usable),
              "calibration_editions": sum(1 for d in dates if d < split), "page_w_mm": w_mm, "page_h_mm": h_mm,
              "grid": {"columns": int(g["columns"]), "column_width_mm": g["column_width_mm"], "gutter_mm": g["gutter_mm"]},
              "grids_seen": grids_seen, "script": script, "excluded_share": ex["share"], "roles": roles}
    log = {"timings_s": {"reading": round(t["reading"] - t["start"], 1), "learning": round(t["learning"] - t["reading"], 1),
                         "pictures": round(t["pictures"] - t["learning"], 1)}, "excluded": ex, "report": report}
    (out / "onboard_log.json").write_text(json.dumps(log, ensure_ascii=False, indent=1) + "\n")
    return {"outcome": "ready", "files": [checks[n] for n in sorted(checks)], "report": report}


PACK = ("report/page1/pages/", "report/page1/photos/", "report/page1/brand/")


def pack(a) -> dict:
    """Deterministic ZIP of what engine.setup reads: sorted entries, fixed time stamps, deflated."""
    ds = a.dataset.resolve()
    Status(a.status)("packing", 0, 1)
    names = []
    for p in ds.rglob("*"):
        rel = p.relative_to(ds).as_posix()
        if p.is_file() and (rel.startswith(PACK) or rel in ("report/headlines.jsonl", "house_profile.json", "paper.json")
                            or (rel.startswith("work/") and rel.endswith("/corrected.json") and rel.count("/") == 2)):
            names.append(rel)
    tmp = a.zip.with_suffix(a.zip.suffix + ".tmp")
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for rel in sorted(names):
            zi = zipfile.ZipInfo(rel, date_time=(1980, 1, 1, 0, 0, 0))
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o600 << 16
            z.writestr(zi, (ds / rel).read_bytes())
    os.replace(tmp, a.zip)
    data = a.zip.read_bytes()
    Status(a.status)("packing", 1, 1)
    return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def main():
    signal.signal(signal.SIGTERM, on_term)
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--files", type=Path, required=True)
    b.add_argument("--out", type=Path, required=True)
    b.add_argument("--status", type=Path)
    b.add_argument("--icc")
    b.add_argument("--masthead")
    b.add_argument("--engine-python")
    p = sub.add_parser("pack")
    p.add_argument("--dataset", type=Path, required=True)
    p.add_argument("--zip", type=Path, required=True)
    p.add_argument("--status", type=Path)
    a = ap.parse_args()
    if a.cmd == "pack":
        print(json.dumps(pack(a)))
        return
    try:
        res = build(a)
    except Rejected as r:
        res = {"outcome": "rejected", "code": r.code, "params": r.params, "files": [FILES[n] for n in sorted(FILES)],
               "message": r.message}
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
