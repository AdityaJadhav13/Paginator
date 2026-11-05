"""Shared helpers for the golden-vector generators (EVIDENCE TOOLING).

The generators run with the FROZEN oracle's Python (tools/oracle/v0/.venv, CPython 3.11.14). They import the frozen
oracle and the Phase-0 experiments read-only, record inputs and outputs, and write deterministic files under
fixtures/goldens/v1 (public: synthetic or OFL inputs only). The TypeScript engine is tested against these files.

Every generator has main(root) -> {"files": {path: sha256}, "counts": {...}}: it writes below `root`, which is the
repository itself or, for `gen_all.py --check`, a temporary directory laid out like it; paths are relative to root.
gen_all.py runs each generator in its own interpreter (`gen_x.py --root DIR`, result as one JSON line on stdout), as
the experiments themselves run: their modules share names (common, fontreg) and keep module-level state.

Floats are written as Python float.hex() strings under keys ending in "_hex"; integers are exact; outputs are gzipped
with mtime=0 so a re-run produces byte-identical files. What produced a golden (platform, libraries) goes into its
info.json and MANIFEST.json only, never into the data files, so `--check` can compare data strictly.
"""
from __future__ import annotations

import gzip
import hashlib
import importlib.metadata as md
import json
import os
import platform
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ORACLE = REPO / "tools" / "oracle" / "v0"
EXPERIMENTS = REPO / "experiments" / "phase0"
GOLDENS = Path("fixtures") / "goldens" / "v1"      # relative to root
FONTS = Path("fixtures") / "fonts" / "v1"          # relative to root
SEED = 20261020

sys.path.insert(0, str(ORACLE))


def cli(main) -> None:
    """`python gen_x.py [--root DIR]`: run one generator and print its result as one JSON line."""
    import argparse  # noqa: PLC0415
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", type=Path, default=REPO, help="write below this directory (default: the repository)")
    a = ap.parse_args()
    print(json.dumps(main(a.root.resolve()), sort_keys=True))


def ensure_public() -> None:
    """Public goldens use OFL fonts and synthetic text only."""
    if os.environ.get("PAGEINATOR_PRIVATE_FONTS"):
        sys.exit("refusing: PAGEINATOR_PRIVATE_FONTS is set; public goldens may use OFL fonts only")


def fhex(x: float) -> str:
    return float.hex(float(x))


def typed(v):
    """A JSON value as a typed tree, so ints, floats, tuples and dicts survive exactly (floats as float.hex()):
    ["f", hex] ["i", "decimal"] ["s", text] ["b", bool] ["n"] ["l", [items]] ["d", [[key, value], …]] (insertion order)."""
    if v is None:
        return ["n"]
    if isinstance(v, bool):
        return ["b", v]
    if isinstance(v, int):
        return ["i", str(v)]
    if isinstance(v, float):
        return ["f", fhex(v)]
    if isinstance(v, str):
        return ["s", v]
    if isinstance(v, (list, tuple)):
        return ["l", [typed(x) for x in v]]
    if isinstance(v, dict):
        return ["d", [[k, typed(x)] for k, x in v.items()]]
    raise TypeError(type(v))


def dumps(obj) -> str:
    """Canonical JSON line: sorted keys, no whitespace, UTF-8, no NaN/Infinity (floats must already be hex)."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


class Out:
    """Writes files below root and remembers {relative path: sha256}."""

    def __init__(self, root: Path):
        self.root = Path(root)
        self.files: dict[str, str] = {}

    def bytes(self, rel: Path | str, data: bytes) -> str:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        sha = hashlib.sha256(data).hexdigest()
        self.files[Path(rel).as_posix()] = sha
        return sha

    def jsonl_gz(self, rel, records) -> str:
        data = "".join(dumps(r) + "\n" for r in records).encode("utf-8")
        return self.bytes(rel, gzip.compress(data, compresslevel=9, mtime=0))

    def json_gz(self, rel, obj) -> str:
        return self.bytes(rel, gzip.compress((dumps(obj) + "\n").encode("utf-8"), compresslevel=9, mtime=0))

    def json(self, rel, obj) -> str:
        return self.bytes(rel, (json.dumps(obj, ensure_ascii=False, sort_keys=True, indent=1) + "\n").encode("utf-8"))


def environment() -> dict:
    """What produced these goldens: platform, interpreter, libraries, and the frozen oracle's manifest hash."""
    def ver(dist: str) -> str:
        try:
            return md.version(dist)
        except md.PackageNotFoundError:
            return "absent"
    import uharfbuzz as hb  # noqa: PLC0415

    manifest = (ORACLE / "ORACLE_MANIFEST.json").read_bytes()
    return {
        "platform": platform.platform(terse=True),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "uharfbuzz": ver("uharfbuzz"),
        "harfbuzz": hb.version_string(),
        "fonttools": ver("fonttools"),
        "oracle_manifest_sha256": hashlib.sha256(manifest).hexdigest(),
    }
