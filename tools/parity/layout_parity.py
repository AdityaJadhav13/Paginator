"""Platform parity of the layout engine (risk R1; docs/product/10-l2-newsroom-plan.md L2.3 "Done when" #2, D-14).

Lays out the same frozen run request with the Desk's engine twice, on this machine and in the linux/amd64 worker image
(infra/docker/engine-worker.Dockerfile, built locally, never pushed), then byte-compares every page PDF. Where two pages
differ, a structural diff of the two files says what differs (decoded streams, text drawing, pictures, colours, fonts,
the document's own keys), so the owner can judge the list (D-14).

    <pdfx1 python> tools/parity/layout_parity.py --home DESK_HOME --edition EID --run RID --image TAG --out DIR
    <pdfx1 python> tools/parity/layout_parity.py --compare A.pdf B.pdf          # the structural diff of two files

Both runs are the worker's own call (pgn_worker/engine.py, launcher.py): `<engine python> tools/desk/engine/desk_engine.py
generate --home H --edition E --run R` from the repository's root, in an environment of PATH, HOME and the Python
settings only, with one fixed SOURCE_DATE_EPOCH (the PDF writer's dates). The homes are fresh copies made in DIR: the
config (its dataset path changed to where each run sees it), the edition's articles, photos and ads (the source run's
own pictures win) and the run's request.json. The image runs from its own code, so the script first checks that the
engine's code in the image is byte for byte this checkout's. DIR gets the Desk's private pages: keep it private.
Prints aggregates only (no headline, no text). Exit 0: every page identical; 1: a page differs; 2: the runs could not
be compared."""
from __future__ import annotations

import argparse
import difflib
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
EPOCH = "1790000000"                       # any fixed time: both runs write the same dates
IMAGE_ROOT = "/opt/pageinator"
CODE = ("tools/desk/engine", "tools/desk/deskserver", "tools/oracle/v0", "experiments/phase0/compose1",
        "experiments/phase0/compose2", "experiments/phase0/compose3", "experiments/phase0/gen1", "experiments/phase0/head1",
        "experiments/phase0/page1", "experiments/phase0/pdfx1", "experiments/phase0/typeset_harness",
        "experiments/phase0/results/page1")
SKIP = (".venv", "__pycache__", ".pytest_cache", ".mypy_cache")
# the same walk in both places (run inside the image with its engine Python)
HASH_TREE = f"""
import hashlib, json, os, sys
root, out = sys.argv[1], {{}}
for top in {CODE!r}:
    for d, dirs, files in os.walk(os.path.join(root, top)):
        dirs[:] = sorted(x for x in dirs if x not in {SKIP!r})
        for f in files:
            if not f.endswith(".pyc"):
                p = os.path.join(d, f)
                out[os.path.relpath(p, root)] = hashlib.sha256(open(p, "rb").read()).hexdigest()
print(json.dumps(out))
"""


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ------------------------------------------------------------------------------------------- the two runs


def make_home(src_home: Path, eid: str, rid: str, dest: Path, dataset: str) -> None:
    """A fresh Desk home in dest: config (dataset → `dataset`), the edition's files and pictures, the run's request."""
    cfg = json.loads((src_home / "config.json").read_text(encoding="utf-8"))
    cfg["dataset"] = dataset
    ed_src, ed = src_home / "editions" / eid, dest / "editions" / eid
    run_src, run = ed_src / "runs" / rid, ed / "runs" / rid
    run.mkdir(parents=True, mode=0o700)
    (dest / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")
    for name in ("edition.json", "articles.json"):
        if (ed_src / name).is_file():
            shutil.copy2(ed_src / name, ed / name)
    for kind in ("photos", "ads"):
        (ed / kind).mkdir(mode=0o700)
        index: dict = {}
        for src in (ed_src / kind, run_src / kind):              # the run's own pictures win (they made its pages)
            if (src / "index.json").is_file():
                index.update(json.loads((src / "index.json").read_text(encoding="utf-8")).get("elements", {}))
                for f in src.glob("*.cmyk.gz"):
                    shutil.copy2(f, ed / kind / f.name)
        (ed / kind / "index.json").write_text(json.dumps({"elements": index}), encoding="utf-8")
    shutil.copy2(run_src / "request.json", run / "request.json")


def run_mac(engine_py: Path, home: Path, eid: str, rid: str, timeout: float) -> float:
    env = {"PATH": "/usr/bin:/bin", "HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8",
           "SOURCE_DATE_EPOCH": EPOCH}
    t0 = time.monotonic()
    subprocess.run([str(engine_py), "tools/desk/engine/desk_engine.py", "generate", "--home", str(home), "--edition", eid,
                    "--run", rid], cwd=REPO, env=env, check=True, timeout=timeout, stdout=subprocess.DEVNULL)
    return time.monotonic() - t0


def docker(image: str, *args: str, mounts: tuple = (), timeout: float = 600, capture: bool = False) -> str:
    argv = ["docker", "run", "--rm", "--platform", "linux/amd64", "--read-only", "--tmpfs", "/tmp", "--network", "none",
            "--user", f"{os.getuid()}:{os.getgid()}", "--workdir", IMAGE_ROOT, "--entrypoint", "/usr/bin/env"]
    for m in mounts:
        argv += ["-v", m]
    r = subprocess.run([*argv, image, "-i", *args], check=True, timeout=timeout, text=True,
                       stdout=subprocess.PIPE if capture else subprocess.DEVNULL)
    return r.stdout if capture else ""


def run_image(image: str, home: Path, dataset: Path, eid: str, rid: str, timeout: float) -> float:
    t0 = time.monotonic()
    docker(image, "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/home/pgn", "PYTHONDONTWRITEBYTECODE=1",
           "PYTHONIOENCODING=utf-8", f"SOURCE_DATE_EPOCH={EPOCH}", f"{IMAGE_ROOT}/engine-venv/bin/python",
           "tools/desk/engine/desk_engine.py", "generate", "--home", "/home/pgn", "--edition", eid, "--run", rid,
           mounts=(f"{home}:/home/pgn", f"{dataset}:/dataset:ro"), timeout=timeout)
    return time.monotonic() - t0


def code_check(image: str) -> dict:
    """The engine's code in the image against this checkout's: files that differ or that only the image has."""
    theirs = json.loads(docker(image, f"{IMAGE_ROOT}/engine-venv/bin/python", "-c", HASH_TREE, IMAGE_ROOT, capture=True))
    ours = json.loads(subprocess.run([sys.executable, "-c", HASH_TREE, str(REPO)], check=True, text=True,
                                     stdout=subprocess.PIPE).stdout)
    return {"files": len(theirs), "differ": sorted(p for p in theirs if p in ours and ours[p] != theirs[p]),
            "only_in_image": sorted(set(theirs) - set(ours)), "only_in_checkout": sorted(set(ours) - set(theirs))}


# ------------------------------------------------------------------------------------------- the structural diff


def _num(x) -> float | str:
    try:
        return float(x)
    except (TypeError, ValueError):
        return str(x)


def display_list(page) -> list[tuple]:
    """A page's marks in drawing order: ("glyph", font, size, colour, gid, x, y), ("image", name, matrix),
    ("rect"|"line", colour, numbers…) and ("state", operator, operands) for everything else."""
    import pikepdf
    out, font, size, fill, stroke, cm, pos = [], None, None, None, None, None, (0.0,) * 6
    for operands, op in pikepdf.parse_content_stream(page):
        op = str(op)
        vals = [_num(o) for o in operands]
        if op == "Tf":
            font, size = str(operands[0]), vals[1]
        elif op == "k":
            fill = tuple(vals)
        elif op == "K":
            stroke = tuple(vals)
        elif op == "cm":
            cm = tuple(vals)
        elif op == "Tm":
            pos = tuple(vals)
        elif op == "Tj":
            out.append(("glyph", font, size, fill, bytes(operands[0]).hex(), pos[4], pos[5]))
        elif op == "Do":
            out.append(("image", str(operands[0]), cm))
        elif op == "re":
            out.append(("rect", fill, *vals))
        elif op in ("m", "l"):
            out.append(("line", stroke, op, *vals))
        elif op not in ("q", "Q", "BT", "ET", "f", "S"):
            out.append(("state", op, tuple(str(v) for v in vals)))
    return out


def _shape(item: tuple) -> tuple:
    """What a mark is, without where it is (its numbers): so a moved glyph pairs with itself."""
    if item[0] == "glyph":
        return item[:5]
    if item[0] == "image":
        return item[:2]
    return item[:2] if item[0] in ("rect", "line") else item


def _resources(pdf, page) -> dict:
    """The page's fonts and pictures by resource name, with the SHA-256 of what decides how they look."""
    res = page.obj.get("/Resources", {})
    fonts = {}
    for name, f in dict(res.get("/Font", {})).items():
        d = f.DescendantFonts[0] if "/DescendantFonts" in f else f
        fd = d.get("/FontDescriptor", {})
        prog = fd.get("/FontFile2") or fd.get("/FontFile3") or fd.get("/FontFile")
        fonts[str(name)] = {"base": str(f.get("/BaseFont", "")),
                            "program": hashlib.sha256(prog.read_bytes()).hexdigest() if prog is not None else None,
                            "widths": hashlib.sha256(repr(d.get("/W")).encode()).hexdigest(),
                            "tounicode": hashlib.sha256(f.ToUnicode.read_bytes()).hexdigest() if "/ToUnicode" in f else None}
    images = {str(name): {"w": int(x.Width), "h": int(x.Height), "cs": str(x.get("/ColorSpace")),
                          "bpc": int(x.get("/BitsPerComponent", 0)), "data": hashlib.sha256(x.read_bytes()).hexdigest()}
              for name, x in dict(res.get("/XObject", {})).items()}
    return {"fonts": fonts, "images": images}


def diff_pdfs(a: Path, b: Path) -> dict:
    """What differs between two page PDFs, in categories the owner can judge (empty `differences`: none found)."""
    import pikepdf
    out: dict = {"bytes": [a.stat().st_size, b.stat().st_size], "differences": []}
    note = out["differences"].append
    with pikepdf.open(a) as pa, pikepdf.open(b) as pb:
        if len(pa.pages) != len(pb.pages):
            note({"what": "page count", "a": len(pa.pages), "b": len(pb.pages)})
            return out
        for key in sorted(set(pa.docinfo.keys()) | set(pb.docinfo.keys())):
            if str(pa.docinfo.get(key)) != str(pb.docinfo.get(key)):
                note({"what": "document info", "key": str(key), "a": str(pa.docinfo.get(key)), "b": str(pb.docinfo.get(key))})
        if repr(pa.trailer.get("/ID")) != repr(pb.trailer.get("/ID")):
            note({"what": "file ID (an MD5 of the body: follows any other difference)"})
        if repr(pa.Root.get("/OutputIntents")) != repr(pb.Root.get("/OutputIntents")):
            note({"what": "output intent"})
        # every stream, in object order: decoded content the same but compressed bytes not = only the compression
        sa = [o for o in pa.objects if isinstance(o, pikepdf.Stream)]
        sb = [o for o in pb.objects if isinstance(o, pikepdf.Stream)]
        if len(sa) != len(sb):
            note({"what": "stream count", "a": len(sa), "b": len(sb)})
        else:
            decoded = sum(x.read_bytes() != y.read_bytes() for x, y in zip(sa, sb))
            raw = sum(x.read_raw_bytes() != y.read_raw_bytes() for x, y in zip(sa, sb))
            if decoded or raw:
                note({"what": "streams", "of": len(sa), "decoded_differ": decoded, "compressed_differ": raw})
        for n, (pga, pgb) in enumerate(zip(pa.pages, pb.pages), 1):
            for box in ("/MediaBox", "/TrimBox", "/BleedBox"):
                if repr(pga.obj.get(box)) != repr(pgb.obj.get(box)):
                    note({"what": "page box", "page": n, "box": box})
            ra, rb = _resources(pa, pga), _resources(pb, pgb)
            for kind in ("fonts", "images"):
                for name in sorted(set(ra[kind]) | set(rb[kind])):
                    if ra[kind].get(name) != rb[kind].get(name):
                        x, y = ra[kind].get(name) or {}, rb[kind].get(name) or {}
                        note({"what": kind[:-1], "page": n, "name": name,
                              "fields": sorted(k for k in set(x) | set(y) if x.get(k) != y.get(k))})
            da, db = display_list(pga), display_list(pgb)
            if da == db:
                continue
            sm = difflib.SequenceMatcher(None, [_shape(i) for i in da], [_shape(i) for i in db], autojunk=False)
            moved, worst, extra = Counter(), 0.0, Counter()
            for tag, i1, i2, j1, j2 in sm.get_opcodes():
                if tag == "equal":
                    for x, y in zip(da[i1:i2], db[j1:j2]):
                        if x != y:
                            moved[x[0]] += 1
                            nums = [abs(p - q) for p, q in zip(x, y) if isinstance(p, float) and isinstance(q, float)]
                            worst = max([worst, *nums])
                else:
                    extra.update(f"only in a: {i[0]}" for i in da[i1:i2])
                    extra.update(f"only in b: {i[0]}" for i in db[j1:j2])
            note({"what": "marks", "page": n, "marks": [len(da), len(db)], "changed_numbers": dict(moved),
                  "largest_change": round(worst, 4), "unpaired": dict(extra)})
    return out


# ------------------------------------------------------------------------------------------- compare two runs


def compare_runs(mac_run: Path, image_run: Path) -> dict:
    pages = sorted(p.name for p in mac_run.glob("page-*.pdf"))
    others = sorted(p.name for p in image_run.glob("page-*.pdf"))
    result: dict = {"pages": len(pages), "pages_image": len(others), "identical": 0, "differ": [], "sha256": {}}
    for name in sorted(set(pages) | set(others)):
        a, b = mac_run / name, image_run / name
        if not (a.is_file() and b.is_file()):
            result["differ"].append({"page": name, "differences": [{"what": "made on one side only"}]})
            continue
        result["sha256"][name] = [sha256(a), sha256(b)]
        if result["sha256"][name][0] == result["sha256"][name][1]:
            result["identical"] += 1
        else:
            result["differ"].append({"page": name, **diff_pdfs(a, b)})
    # the run's decisions besides the PDFs: the plan, each page's stories and the stories not placed
    status = [json.loads((r / "engine-status.json").read_text(encoding="utf-8")) for r in (mac_run, image_run)]
    result["same_states"] = [p["state"] for p in status[0]["pages"]] == [p["state"] for p in status[1]["pages"]]
    result["same_articles"] = [p["articles"] for p in status[0]["pages"]] == [p["articles"] for p in status[1]["pages"]]
    result["same_not_placed"] = status[0].get("not_placed") == status[1].get("not_placed")
    result["same_plan"] = all((mac_run / f).read_bytes() == (image_run / f).read_bytes()
                              for f in ("plan.json", "printed.json") if (mac_run / f).is_file())
    manifests = [(m.name, json.loads(m.read_text()), json.loads((image_run / m.name).read_text()))
                 for m in sorted(mac_run.glob("page-*.manifest.json")) if (image_run / m.name).is_file()]
    result["manifests_differ"] = [n for n, x, y in manifests
                                  if {k: v for k, v in x.items() if k != "sha256"} != {k: v for k, v in y.items() if k != "sha256"}]
    return result


def summary(result: dict) -> dict:
    """Aggregates only: what may leave the private folder."""
    kinds = Counter(d["what"] for p in result["differ"] for d in p.get("differences", []))
    return {k: result[k] for k in ("pages", "pages_image", "identical", "same_states", "same_articles", "same_not_placed",
                                   "same_plan", "manifests_differ")} | {"pages_differ": len(result["differ"]),
                                                                       "difference_kinds": dict(kinds)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--compare", nargs=2, type=Path, metavar=("A", "B"), help="only the structural diff of two PDFs")
    ap.add_argument("--home", type=Path, help="the Desk home the run is taken from (its config.json names the dataset)")
    ap.add_argument("--edition")
    ap.add_argument("--run")
    ap.add_argument("--image", default="pageinator-engine-worker", help="the worker image's tag (built locally)")
    ap.add_argument("--engine-python", type=Path, default=REPO / "tools/oracle/v0/.venv/bin/python")
    ap.add_argument("--out", type=Path, help="a new private folder for both runs and the report")
    ap.add_argument("--timeout", type=float, default=7200, help="seconds each run may take")
    a = ap.parse_args()
    if a.compare:
        print(json.dumps(diff_pdfs(*a.compare), indent=1))
        return 0
    if not (a.home and a.edition and a.run and a.out):
        ap.error("--home, --edition, --run and --out are needed (or --compare A B)")
    if a.out.expanduser().resolve().is_relative_to(REPO):
        ap.error("--out holds private files: put it outside the repository")
    os.umask(0o077)
    a.out.mkdir(parents=True)
    dataset = Path(json.loads((a.home / "config.json").read_text(encoding="utf-8"))["dataset"]).expanduser()
    code = code_check(a.image)
    if code["differ"] or code["only_in_image"] or code["only_in_checkout"]:
        print(json.dumps({"error": "the image's engine code is not this checkout's", **code}, indent=1))
        return 2
    homes = {"mac": a.out / "mac", "image": a.out / "image"}
    make_home(a.home, a.edition, a.run, homes["mac"], str(dataset))
    make_home(a.home, a.edition, a.run, homes["image"], "/dataset")
    seconds = {"mac": round(run_mac(a.engine_python, homes["mac"], a.edition, a.run, a.timeout), 1),
               "image": round(run_image(a.image, homes["image"], dataset, a.edition, a.run, a.timeout), 1)}
    runs = [h / "editions" / a.edition / "runs" / a.run for h in homes.values()]
    result = compare_runs(*runs)
    report = {"request_sha256": sha256(runs[0] / "request.json"), "image": a.image, "code_files_checked": code["files"],
              "source_date_epoch": EPOCH, "seconds": seconds, **result}
    (a.out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps({"seconds": seconds, "code_files_checked": code["files"], **summary(result)}, indent=1))
    return 0 if not result["differ"] and result["pages"] else 1


if __name__ == "__main__":
    sys.exit(main())
