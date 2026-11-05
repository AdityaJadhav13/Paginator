# A fake of tools/onboard/onboard.py for the worker's tests (the real one takes minutes on real PDFs): the same
# commands, files and answers, on fictional files. Its behaviour is chosen by the first file's name: "ready …",
# "rejected …", "crash …", "silent …" (no answer), "slow …" (works for a long time, its status moving), "stall …"
# (one status, then nothing), "stubborn …" (as slow, and ignores SIGTERM).
import argparse, json, os, signal, sys, time, zipfile
from pathlib import Path

def status(path, step, done, total):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"step": step, "done": done, "total": total}))
    os.replace(tmp, path)

p = argparse.ArgumentParser()
p.add_argument("command")
for a in ("--files", "--out", "--status", "--icc", "--engine-python", "--dataset", "--zip"):
    p.add_argument(a)
a = p.parse_args()
if a.command == "pack":
    with zipfile.ZipFile(a.zip, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(Path(a.dataset).rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(a.dataset).as_posix())
    print(json.dumps({"sha256": "unused", "bytes": os.path.getsize(a.zip)}))
    sys.exit(0)
files = json.loads(Path(a.files).read_text())["files"]
assert all(Path(f["path"]).read_bytes().startswith(b"%PDF") for f in files)
assert Path(a.icc).is_file() and Path(a.engine_python).is_file()
mode = files[0]["name"].split()[0]
st = Path(a.status)
checks = [{"n": f["n"], "status": "ok", "date": f"2026-01-{f['n']:02d}", "pages": 4, "notes": []} for f in files]
if mode == "crash":
    print("Traceback: a fictional fault", file=sys.stderr)
    sys.exit(3)
if mode == "silent":
    sys.exit(0)
if mode == "stubborn":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
if mode == "stall":
    status(st, "reading", 1, len(files))
    time.sleep(60)
if mode in ("slow", "stubborn"):
    for i in range(600):
        status(st, "reading", i, 600)
        time.sleep(0.05)
for i, step in enumerate(("checking", "reading", "measuring", "learning", "pictures")):
    status(st, step, i, 5)
    time.sleep(0.1)
if mode == "rejected":
    print(json.dumps({"outcome": "rejected", "code": "onboard.no_grid", "params": None, "files": checks,
                      "message": "No column grid was found on these pages."}))
    sys.exit(0)
out = Path(a.out)
(out / "report" / "page1" / "pages").mkdir(parents=True)
(out / "report" / "page1" / "pages" / "fictional-p1.json").write_text(json.dumps({"page": 1}))
(out / "env.json").write_text(json.dumps(sorted(os.environ)))   # what the tool was given
(out / "paper.json").write_text(json.dumps({"format": "pageinator.paper/1", "script": "latn"}))
print("a log line the tool wrote", file=sys.stderr)
print(json.dumps({"outcome": "ready", "files": checks, "report": {
    "editions": len(files), "pages": 4 * len(files), "calibration_editions": 2, "page_w_mm": 330.0, "page_h_mm": 520.0,
    "grid": {"columns": 6, "column_width_mm": 48.5, "gutter_mm": 4.0}, "grids_seen": 1, "script": "latn",
    "excluded_share": 0.0, "roles": {"front": 3, "inside_imprint": 3, "inside": 6, "back": 3}}}))
