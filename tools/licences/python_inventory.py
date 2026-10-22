"""The Python packages' licence inventory (docs/product/11-fix-before-launch.md CI-10, l22-plan §5): for every pin of
the pinned locks, the wheels a Linux x86_64 server with CPython 3.11 installs (manylinux), read from the wheels
themselves: their METADATA licence fields, and the native libraries they bundle (auditwheel's `<pkg>.libs/` folder and
any other shared library that is not a Python extension module of the package).

Only wheels whose SHA-256 the lock lists are read, so the inventory is of exactly the bytes `uv pip install
--require-hashes` would install. The inventory is committed (tools/licences/python-inventory.json) and checked offline by
tools/ts/check-licences.ts; this script makes it again from PyPI and, with --check, fails when it differs.

    python3 -B tools/licences/python_inventory.py           # writes the inventory
    python3 -B tools/licences/python_inventory.py --check   # CI: fails when the committed one is not what PyPI serves

Standard library only; it downloads from pypi.org and files.pythonhosted.org (about 100 MB, cached)."""
from __future__ import annotations

import argparse
import email.parser
import hashlib
import io
import json
import os
import re
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
LOCKS = ("tools/desk/requirements.lock", "tools/oracle/v0/requirements.lock", "apps/engine-worker/requirements.lock")
OUT = REPO / "tools/licences/python-inventory.json"
FORMAT = "pageinator.python-licences/1"
PIN = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s\\;]+)\s*\\?$")
HASH = re.compile(r"^\s+--hash=sha256:([0-9a-f]{64})\s*\\?$")
WHEEL = re.compile(r"^(?P<name>[^-]+)-(?P<ver>[^-]+)(?:-(?P<build>\d[^-]*))?-(?P<py>[^-]+)-(?P<abi>[^-]+)-(?P<plat>[^-]+)\.whl$")
EXTENSION = re.compile(r"\.(cpython-\d+[a-z]*-[^.]+|abi3)\.so$")       # a Python extension module: the package's own
SHARED = re.compile(r"\.so(\.\d+)*$")


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def read_lock(path: Path) -> dict[str, set[str]]:
    """A `uv pip compile --generate-hashes` lock: {"name==version": {sha256, …}}. Any other line that is not a comment
    or blank fails (an option, an include, a URL: not read here, so not allowed)."""
    pins: dict[str, set[str]] = {}
    current = None
    for n, line in enumerate(path.read_text("utf-8").splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if m := PIN.match(line):
            current = f"{norm(m.group(1))}=={m.group(2)}"
            pins[current] = set()
        elif (m := HASH.match(line)) and current:
            pins[current].add(m.group(1))
        else:
            sys.exit(f"{path}:{n}: a line this inventory does not read: {line.strip()[:120]}")
    if not pins or any(not h for h in pins.values()):
        sys.exit(f"{path}: no pins, or a pin without hashes")
    return pins


def compatible(filename: str) -> bool:
    """A wheel CPython 3.11 on Linux x86_64 (glibc) installs: py3/cp311 (abi3 from cp3x ≤ 3.11), any or manylinux."""
    m = WHEEL.match(filename)
    if not m:
        return False
    pys, abis, plats = (m.group(k).split(".") for k in ("py", "abi", "plat"))
    def py_ok(py: str) -> bool:
        return py in ("py3", "py311", "cp311", "py2.py3") or (py.startswith("cp3") and "abi3" in abis
                                                               and py[3:].isdigit() and int(py[3:]) <= 11)
    return (any(py_ok(p) for p in pys) and any(a in ("none", "abi3", "cp311") for a in abis)
            and any(p == "any" or re.fullmatch(r"manylinux[0-9_]*_x86_64|manylinux1_x86_64|manylinux2010_x86_64|"
                                                r"manylinux2014_x86_64", p) for p in plats))


def fetch(url: str, cache: Path, sha256: str | None = None) -> bytes:
    path = cache / (sha256 or hashlib.sha256(url.encode()).hexdigest())
    if sha256 and path.is_file():
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() == sha256:
            return data
    with urllib.request.urlopen(url, timeout=120) as r:  # noqa: S310 — pypi.org and its file host only
        data = r.read()
    if sha256 is not None:
        if hashlib.sha256(data).hexdigest() != sha256:
            sys.exit(f"{url}: not the bytes the lock names")
        path.write_bytes(data)
    return data


def inspect(data: bytes) -> dict:
    """A wheel's licence fields and the native libraries it carries."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = z.namelist()
        meta_name = next(n for n in names if re.fullmatch(r"[^/]+\.dist-info/METADATA", n))
        meta = email.parser.Parser().parsestr(z.read(meta_name).decode("utf-8", "replace"), headersonly=True)
    licence = (meta.get("License") or "").strip()
    bundled = []
    for n in sorted(names):
        base = n.rsplit("/", 1)[-1]
        in_libs = re.fullmatch(r"[^/]+\.libs/[^/]+", n) is not None
        if in_libs or (SHARED.search(base) and not EXTENSION.search(base)):
            bundled.append({"file": n, "library": re.sub(r"(-[0-9a-f]{8})?\.so(\.\d+)*$", "", base)})
    return {"metadata": {"license_expression": (meta.get("License-Expression") or "").strip() or None,
                         "license": licence.splitlines()[0][:200] if licence else None,
                         "classifiers": sorted(c for c in meta.get_all("Classifier") or [] if c.startswith("License ::"))},
            "bundled": bundled}


def build(cache: Path) -> dict:
    locks = {rel: read_lock(REPO / rel) for rel in LOCKS}
    pins: dict[str, set[str]] = {}
    for found in locks.values():
        for pin, hashes in found.items():
            pins.setdefault(pin, set()).update(hashes)
    packages = {}
    for pin in sorted(pins):
        name, version = pin.split("==")
        info = json.loads(fetch(f"https://pypi.org/pypi/{name}/{version}/json", cache))
        wheels = []
        for f in sorted(info.get("urls") or [], key=lambda f: f["filename"]):
            sha = f.get("digests", {}).get("sha256")
            if f.get("packagetype") == "bdist_wheel" and sha in pins[pin] and compatible(f["filename"]):
                wheels.append({"file": f["filename"], "sha256": sha, **inspect(fetch(f["url"], cache, sha))})
        packages[pin] = {"wheels": wheels}
    return {"format": FORMAT, "target": "CPython 3.11, Linux x86_64 (manylinux)",
            "locks": {rel: sorted(found) for rel, found in locks.items()}, "packages": packages}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="fail when the committed inventory differs")
    ap.add_argument("--cache", default=os.environ.get("PGN_WHEEL_CACHE") or Path(tempfile.gettempdir()) / "pgn-wheels")
    args = ap.parse_args()
    cache = Path(args.cache)
    cache.mkdir(parents=True, exist_ok=True)
    inventory = build(cache)
    text = json.dumps(inventory, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    if args.check:                                  # compared as data: the committed file is formatted by Prettier
        try:
            committed = json.loads(OUT.read_text("utf-8"))
        except (OSError, ValueError):
            committed = None
        if committed != inventory:
            print("✗ python licences: tools/licences/python-inventory.json is not what PyPI serves for the locks: "
                  "run tools/licences/python_inventory.py and review the change", file=sys.stderr)
            return 1
        print("✓ python licences: the committed inventory is the locks' wheels as PyPI serves them")
        return 0
    OUT.write_text(text, "utf-8")
    print(f"wrote {OUT.relative_to(REPO)} (format it with Prettier before committing)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
