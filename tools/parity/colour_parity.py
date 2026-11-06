"""Colour parity of photo conversion (docs/product/10-l2-newsroom-plan.md L2.2 "Done when" #2): the hosted CMYK path
against the Desk's, with the same colour profile, on real photos. A private, local check.

    <pdfx1 python> tools/parity/colour_parity.py --image TAG --icc PROFILE.icc --out DIR PHOTO_OR_FOLDER…

- **Hosted:** the worker's own `media.ingest` (apps/engine-worker/pgn_worker/media.py), run in the linux/amd64 worker
  image with the profile mounted where the worker reads it, each photo stored first as an asset's original in a store
  held in memory (no S3, no network).
- **Desk:** `deskserver.images.convert_photo` from this checkout, run by this Python (the Desk's), with PAGEINATOR_ICC.
- Compared per photo, by SHA-256: the raw CMYK raster the engine places (gunzipped), its gzip file, the gzip file
  without its 10-byte header (whose OS byte is the platform's: 19 on macOS, 3 on Linux), and the preview.
  When a photo is a Desk original (`<id>.orig.<ext>`) with the Desk's own `<id>.cmyk.gz` beside it, that stored
  raster is compared too.
Folders are searched for .jpg, .jpeg, .png and .webp files; the same bytes are converted once. DIR gets a copy of every
photo and the SHA-256 list (report.json): keep it private. Prints aggregates only. Exit 0: every raster identical."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SUFFIXES = (".jpg", ".jpeg", ".png", ".webp")
ICC_IN_IMAGE = "/run/pageinator/newsprint.icc"         # where the worker reads its profile (PAGEINATOR_ICC)
# fixed ids for the in-memory asset: uuidv7 forms, as the API makes them
ORG, PUB, ASSET = "0b9d2c4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", "01900000-0000-7000-8000-000000000001", \
    "01900000-0000-7000-8000-000000000002"

DESK = """
import gzip, hashlib, json, os, sys
sys.path.insert(0, os.path.join(sys.argv[1], "tools", "desk"))
from deskserver import images, util
h = lambda b: hashlib.sha256(b).hexdigest()
for name in sorted(os.listdir(sys.argv[2])):
    data = open(os.path.join(sys.argv[2], name), "rb").read()
    try:
        c = images.convert_photo(data)
    except util.DeskError as e:
        print(json.dumps({"in": name, "refused": e.status}))
        continue
    print(json.dumps({"in": name, "raw": h(gzip.decompress(c.cmyk_gz)), "gz": h(c.cmyk_gz), "gz_body": h(c.cmyk_gz[10:]),
                      "preview": h(c.preview), "size": [c.width, c.height]}))
"""

HOSTED = f"""
import gzip, hashlib, json, os, sys
from pgn_worker import media
from pgn_worker.keys import KeyGuard
from pgn_worker.params import file_sha256
h = lambda b: hashlib.sha256(b).hexdigest()

class Memory:
    def __init__(self): self.files = {{}}
    def get(self, key, version_id): return self.files[key]
    def put(self, key, data, content_type): self.files[key] = data; return "v1"

icc = file_sha256(__import__("pathlib").Path(os.environ["PAGEINATOR_ICC"]))
for name in sorted(os.listdir("/in")):
    data, store = open(os.path.join("/in", name), "rb").read(), Memory()
    store.put(KeyGuard({ORG!r}, {PUB!r}).asset_original({ASSET!r}), data, "")
    out = media.ingest(store, {{"org_id": {ORG!r}, "pub_id": {PUB!r}, "asset_id": {ASSET!r}, "version_id": "v1",
                                "sha256": h(data)}}, icc)
    if out["kind"] != "media.ready":
        print(json.dumps({{"in": name, "refused": out.get("status")}}))
        continue
    r = {{x["purpose"]: x for x in out["renditions"]}}
    gz = store.files[r["cmyk"]["key"]]
    print(json.dumps({{"in": name, "raw": h(gzip.decompress(gz)), "gz": r["cmyk"]["sha256"], "gz_body": h(gz[10:]),
                      "preview": r["preview"]["sha256"], "size": [out["raster"]["width_px"], out["raster"]["height_px"]],
                      "icc": icc}}))
"""


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def gather(paths: list[Path], dest: Path) -> dict:
    """Each distinct photo copied into dest as <sha256><suffix> → {that name: the Desk's stored raster's raw SHA-256}."""
    found: dict = {}
    files = [p for x in paths for p in ([x] if x.is_file() else sorted(x.rglob("*")))
             if p.is_file() and p.suffix.lower() in SUFFIXES]
    for p in files:
        data = p.read_bytes()
        name = sha256(data) + p.suffix.lower()
        if not (dest / name).exists():
            (dest / name).write_bytes(data)
        stored = p.with_name(p.name.split(".orig.")[0] + ".cmyk.gz") if ".orig." in p.name else None
        if stored is not None and stored.is_file():
            found[name] = sha256(gzip.decompress(stored.read_bytes()))
        else:
            found.setdefault(name, None)
    return found


def lines(text: str) -> dict:
    return {d["in"]: d for d in map(json.loads, text.splitlines()) if d}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--image", default="pageinator-engine-worker", help="the worker image's tag (built locally)")
    ap.add_argument("--icc", type=Path, required=True, help="the newsprint colour profile (stays where it is)")
    ap.add_argument("--out", type=Path, required=True, help="a new private folder")
    ap.add_argument("paths", nargs="+", type=Path, help="photos, or folders holding them")
    a = ap.parse_args()
    if a.out.expanduser().resolve().is_relative_to(REPO):
        ap.error("--out holds private files: put it outside the repository")
    os.umask(0o077)
    icc = a.icc.expanduser().resolve()
    inputs = a.out / "in"
    inputs.mkdir(parents=True)
    stored = gather([p.expanduser() for p in a.paths], inputs)
    env = {"PATH": "/usr/bin:/bin", "PAGEINATOR_ICC": str(icc), "PYTHONDONTWRITEBYTECODE": "1"}
    desk = lines(subprocess.run([sys.executable, "-c", DESK, str(REPO), str(inputs)], env=env, check=True, text=True,
                                stdout=subprocess.PIPE).stdout)
    hosted = lines(subprocess.run(
        ["docker", "run", "--rm", "--platform", "linux/amd64", "--read-only", "--tmpfs", "/tmp", "--network", "none",
         "--user", f"{os.getuid()}:{os.getgid()}", "-v", f"{inputs}:/in:ro", "-v", f"{icc}:{ICC_IN_IMAGE}:ro",
         "--entrypoint", "/usr/bin/env", a.image, "-i", "PATH=/usr/local/bin:/usr/bin:/bin", f"PAGEINATOR_ICC={ICC_IN_IMAGE}",
         "PYTHONDONTWRITEBYTECODE=1", "PYTHONPATH=/opt/pageinator/apps/engine-worker", "/opt/pageinator/venv/bin/python",
         "-c", HOSTED], check=True, text=True, stdout=subprocess.PIPE, timeout=7200).stdout)
    rows, agg = [], {"photos": len(stored), "converted": 0, "refused_both": 0, "raw_identical": 0, "gz_identical": 0,
                     "gz_body_identical": 0, "preview_identical": 0, "desk_stored": 0, "desk_stored_identical": 0,
                     "mismatch": 0}
    for name in sorted(stored):
        d, w = desk.get(name, {}), hosted.get(name, {})
        if "refused" in d and d.get("refused") == w.get("refused"):
            agg["refused_both"] += 1
        elif "raw" in d and "raw" in w:
            agg["converted"] += 1
            for k in ("raw", "gz", "gz_body", "preview"):
                agg[f"{k}_identical"] += d[k] == w[k]
        else:
            agg["mismatch"] += 1                                  # one side refused it, or gave no line
        if stored[name]:
            agg["desk_stored"] += 1
            agg["desk_stored_identical"] += stored[name] == d.get("raw") == w.get("raw")
        rows.append({"photo_sha256": name, "desk": d, "hosted": w, "desk_stored_raw": stored[name]})
    agg["icc_sha256"] = sha256(icc.read_bytes())
    agg["icc_as_hosted_saw_it"] = sorted({w.get("icc") for w in hosted.values() if w.get("icc")})
    (a.out / "report.json").write_text(json.dumps({"aggregate": agg, "photos": rows}, indent=1), encoding="utf-8")
    print(json.dumps(agg, indent=1))
    ok = agg["converted"] and agg["raw_identical"] == agg["converted"] and not agg["mismatch"]
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
