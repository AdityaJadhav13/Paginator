"""Generate ORACLE_MANIFEST.json for the frozen reference engine (oracle-v0).

EXPERIMENTAL TOOLING — Phase 0 evidence. Not production code.

Answers: "What exact engine produced this reference output?"

Usage (from this directory):
    .venv/bin/python freeze.py --source "<path to old Python repo>" [--run-tests]

Writes ORACLE_MANIFEST.json next to this file. Never writes to the source repo.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.metadata as md
import json
import platform
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
COPIED = ["paginator", "tests", "assets", "requirements.lock", "pyproject.toml"]
SOURCE_MAP = {  # oracle path -> path inside the source repo
    "paginator/typeset": "paginator/typeset",
    "paginator/geometry/__init__.py": "paginator/geometry/__init__.py",
    "paginator/geometry/page.py": "paginator/geometry/page.py",
    "paginator/__init__.py": "paginator/__init__.py",
    "paginator/errors.py": "paginator/errors.py",
    "paginator/ids.py": "paginator/ids.py",
    "paginator/color.py": "paginator/color.py",
    "tests": "tests",
    "assets/fonts": "assets/fonts",
    "requirements.lock": "requirements.lock",
    "pyproject.toml": "pyproject.toml",
}
FSTYPE_BITS = {1: "restricted_licence_embedding", 2: "preview_and_print", 3: "editable",
               8: "no_subsetting", 9: "bitmap_embedding_only"}


def sha256(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run(cmd: list[str], cwd: Path | None = None) -> str:
    try:
        return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=600).stdout.strip()
    except Exception as e:  # noqa: BLE001 — evidence tool: record, don't crash
        return f"ERROR: {e}"


def files_under(rel: str) -> list[Path]:
    p = HERE / rel
    if p.is_file():
        return [p]
    return sorted(x for x in p.rglob("*") if x.is_file() and "__pycache__" not in x.parts)


def font_record(path: Path) -> dict:
    from fontTools.ttLib import TTFont

    f = TTFont(path, lazy=True)
    name = f["name"]
    def nm(i: int) -> str | None:
        r = name.getDebugName(i)
        return r
    fs = f["OS/2"].fsType
    bits = [label for bit, label in FSTYPE_BITS.items() if fs & (1 << bit)]
    lic_files = sorted(x.name for x in path.parent.glob("*OFL*.txt"))
    axes = [a.axisTag for a in f["fvar"].axes] if "fvar" in f else []
    return {
        "file": str(path.relative_to(HERE)),
        "sha256": sha256(path),
        "bytes": path.stat().st_size,
        "family": nm(1), "subfamily": nm(2), "full_name": nm(4), "version": nm(5),
        "typographic_family": nm(16),
        "outline_format": "CFF" if "CFF " in f or "CFF2" in f else "TrueType(glyf)",
        "variable_axes": axes,
        "upem": f["head"].unitsPerEm,
        "os2_fsType": fs, "os2_fsType_flags": bits or ["installable_embedding"],
        "licence": "SIL OFL 1.1 (licence file shipped alongside)" if lic_files else "UNKNOWN",
        "licence_files": lic_files,
        # Permissions per SIL OFL 1.1 for platform-bundled OFL fonts (see docs/architecture/v2/19 §1).
        "rights": {"server_shaping": True, "browser_binary": True, "pdf_embedding": True,
                   "subsetting": True, "redistribution_in_repo": True,
                   "basis": "SIL OFL 1.1; verify licence file before any non-OFL font is added"}
        if lic_files else {"basis": "UNKNOWN — do not use"},
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--run-tests", action="store_true")
    a = ap.parse_args()
    src = Path(a.source)

    copied = []
    mismatches = []
    for orel, srel in SOURCE_MAP.items():
        for f in files_under(orel):
            rel_in_oracle = f.relative_to(HERE)
            s = src / srel / f.relative_to(HERE / orel) if (HERE / orel).is_dir() else src / srel
            h = sha256(f)
            sh = sha256(s) if s.exists() else None
            copied.append({"path": str(rel_in_oracle), "sha256": h, "source_sha256": sh})
            if h != sh:
                mismatches.append(str(rel_in_oracle))

    import uharfbuzz as hb  # noqa: PLC0415
    pkgs = {d.metadata["Name"]: d.version for d in md.distributions()}
    fonts = [font_record(p) for p in sorted((HERE / "assets/fonts").rglob("*.ttf"))]

    tests = None
    if a.run_tests:
        import tempfile  # noqa: PLC0415
        import xml.etree.ElementTree as ET  # noqa: PLC0415

        with tempfile.TemporaryDirectory() as td:
            junit = Path(td) / "junit.xml"
            run([sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", f"--junitxml={junit}", "tests/"], cwd=HERE)
            suite = ET.parse(junit).getroot()
            suite = suite if suite.tag == "testsuite" else suite.find("testsuite")
            counts = {k: int(suite.get(k, 0)) for k in ("tests", "failures", "errors", "skipped")}
            counts["time_s"] = float(suite.get("time", 0))
        tests = {"command": "python -m pytest -q -p no:cacheprovider tests/", **counts,
                 "env": "PYTHONDONTWRITEBYTECODE=1 recommended"}

    manifest = {
        "schema": "pageinator.oracle-manifest/1",
        "oracle_id": "oracle-v0",
        "status": "FROZEN — reference behaviour, not correctness. Do not edit; record defects in KNOWN_LIMITATIONS.md",
        "generated_at_utc": dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        "source": {
            "path": str(src),
            "git_commit": run(["git", "-C", str(src), "rev-parse", "HEAD"]),
            "git_commit_date": run(["git", "-C", str(src), "log", "-1", "--format=%cI"]),
            "git_status_porcelain": run(["git", "-C", str(src), "status", "--porcelain"]),
            "note": "Copied, not moved. Source repository left unmodified.",
        },
        "copy_integrity": {"files": len(copied), "byte_identical_to_source": not mismatches,
                           "mismatches": mismatches},
        "runtime": {
            "python": sys.version.split()[0], "implementation": platform.python_implementation(),
            "platform": platform.platform(), "machine": platform.machine(),
            "cpu": run(["sysctl", "-n", "machdep.cpu.brand_string"]) if sys.platform == "darwin" else platform.processor(),
            "harfbuzz": hb.version_string(),
            "key_packages": {k: pkgs.get(k) for k in ("uharfbuzz", "fonttools", "freetype-py", "pydantic", "pytest", "hypothesis")},
            "all_packages": dict(sorted(pkgs.items())),
            "lockfile_sha256": sha256(HERE / "requirements.lock"),
            "install": "uv venv --python 3.11.14 .venv && uv pip install --python .venv/bin/python --require-hashes -r requirements.lock",
        },
        "public_api_used_by_harness": [
            "paginator.typeset.FontRegistry(register_dir, resolve)",
            "paginator.typeset.shape_run", "paginator.typeset.linebreak.build_nodes",
            "paginator.typeset.linebreak.break_lines / break_knuth_plass / break_greedy",
            "paginator.typeset.schemas.TextStyle / HyphenPoint",
        ],
        "capabilities": {
            "shaping": True, "script_itemization": True, "line_breaking_knuth_plass": True,
            "line_breaking_greedy": True, "hyphenation_hook": "input only (HyphenPoint); no hyphenator",
            "justification_positions": False, "frame_flow": False, "overset": False,
            "rtl": False, "emergency_stretch": False, "tracking_in_breaking": False,
        },
        "tests": tests,
        "fonts": fonts,
        "files": copied,
    }
    (HERE / "ORACLE_MANIFEST.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
    print(f"files={len(copied)} identical={not mismatches} fonts={len(fonts)} tests={tests}")


if __name__ == "__main__":
    main()
