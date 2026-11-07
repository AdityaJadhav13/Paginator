"""Run the golden-vector generators (EVIDENCE TOOLING).

  gen_all.py                  regenerate the goldens in place and rewrite fixtures/goldens/v1/MANIFEST.json
  gen_all.py --check          regenerate into a temporary directory and compare with the committed files byte for byte
  gen_all.py --only a,b       run some generators (in place: the other generators' manifest entries are kept)

Each generator runs in its own interpreter (`gen_<name>.py --root DIR`), with PYTHONHASHSEED fixed: 0 when
generating, 1 when checking, so an output that depends on set or dict-of-set iteration order shows up as a difference.

`--check` fails on any missing, extra or different file. The one tolerance: the "environment" block of an info.json
or of MANIFEST.json (platform, library versions) may differ while everything else is identical; that is reported as a
warning, or fails with --strict. Run with the frozen oracle's Python:
  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python tools/goldens/v1/gen_all.py --check
A golden changes only through these generators, with a CHANGELOG.md entry and human approval (docs/DEVELOPMENT.md).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

from golden import FONTS, GOLDENS, REPO, Out, ensure_public, environment

HERE = Path(__file__).resolve().parent
GENERATORS = ("unicode", "pyshim", "fonts", "liang", "compose", "headline", "rline", "pdf", "press")
MANIFEST = GOLDENS / "MANIFEST.json"
HAND_WRITTEN = {(GOLDENS / "CHANGELOG.md").as_posix()}       # files under the golden dirs that no generator writes
SIGNATURES = Path("experiments/phase0/results/compose2/signatures.json")
TYPESET = Path("fixtures/typeset/v1")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(name: str, root: Path, hashseed: str) -> dict:
    env = {k: v for k, v in os.environ.items() if k != "PAGEINATOR_PRIVATE_FONTS"}
    env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONHASHSEED=hashseed)
    r = subprocess.run([sys.executable, str(HERE / f"gen_{name}.py"), "--root", str(root)], cwd=REPO, env=env,
                       capture_output=True, text=True)
    if r.returncode:
        sys.stderr.write(r.stderr[-4000:])
        raise SystemExit(f"gen_{name}.py failed (exit {r.returncode})")
    return json.loads(r.stdout.strip().splitlines()[-1])


def referenced_in_place(root: Path = REPO) -> dict:
    """Tracked evidence the TypeScript tests read where it is (never copied): hashes, so a change is noticed."""
    sigs = json.loads((root / SIGNATURES).read_text())
    typeset = sorted(p for p in (root / TYPESET).rglob("*") if p.is_file())
    return {
        SIGNATURES.as_posix(): {"sha256": sha256(root / SIGNATURES), "entries": len(sigs),
                                "c2_entries": sum(1 for k in sigs if k.rsplit("|", 1)[-1].startswith("C2_"))},
        TYPESET.as_posix(): {"files": {p.relative_to(root).as_posix(): sha256(p) for p in typeset}},
    }


def build_manifest(root: Path, results: dict, keep: dict | None = None) -> dict:
    files = dict((keep or {}).get("files", {}))
    counts = dict((keep or {}).get("counts", {}))
    for name, res in results.items():
        files = {rel: meta for rel, meta in files.items() if meta["generator"] != name}
        for rel, digest in res["files"].items():
            files[rel] = {"sha256": digest, "bytes": (root / rel).stat().st_size, "generator": name}
        counts[name] = res["counts"]
    return {"schema": "pageinator.golden.manifest/1", "goldens": "v1", "generators": list(GENERATORS),
            "files": dict(sorted(files.items())), "counts": dict(sorted(counts.items())),
            "referenced_in_place": referenced_in_place(), "environment": environment()}


def committed_files() -> set[str]:
    out = set()
    for base in (GOLDENS, FONTS):
        out |= {p.relative_to(REPO).as_posix() for p in (REPO / base).rglob("*") if p.is_file() and p.name != ".DS_Store"}
    return out - HAND_WRITTEN - {MANIFEST.as_posix()}


def without_environment(data: bytes):
    doc = json.loads(data)
    env = doc.pop("environment", None)
    return doc, env


def check(names: list[str], strict: bool) -> int:
    committed = json.loads((REPO / MANIFEST).read_text())
    problems, warnings = [], []
    with tempfile.TemporaryDirectory(prefix="pageinator-goldens-") as tmp:
        tmp = Path(tmp)
        results = {n: run(n, tmp, "1") for n in names}
        produced = {rel for res in results.values() for rel in res["files"]}
        expected = {rel for rel, meta in committed["files"].items() if meta["generator"] in names}
        problems += [f"missing (generator no longer writes it): {rel}" for rel in sorted(expected - produced)]
        problems += [f"new file not in MANIFEST.json: {rel}" for rel in sorted(produced - expected)]
        if set(names) == set(GENERATORS):
            stray = committed_files() - set(committed["files"])
            problems += [f"file in the golden directories that no generator wrote: {rel}" for rel in sorted(stray)]
        for rel in sorted(produced & expected):
            ours = (tmp / rel).read_bytes()
            theirs = (REPO / rel).read_bytes() if (REPO / rel).is_file() else b""
            if ours == theirs:
                continue
            if rel.endswith("info.json") and theirs:
                (a, env_a), (b, env_b) = without_environment(ours), without_environment(theirs)
                if a == b:
                    warnings.append(f"{rel}: environment differs (committed {env_b}, now {env_a})")
                    continue
            problems.append(f"differs: {rel} (committed {hashlib.sha256(theirs).hexdigest()[:12]}, "
                            f"regenerated {hashlib.sha256(ours).hexdigest()[:12]})")
        fresh = build_manifest(tmp, results, keep=committed)
        a, b = dict(fresh), dict(committed)
        env_a, env_b = a.pop("environment"), b.pop("environment")
        if a != b:
            keys = sorted(k for k in set(a) | set(b) if a.get(k) != b.get(k))
            problems.append(f"MANIFEST.json differs in {keys}")
        elif env_a != env_b:
            warnings.append(f"MANIFEST.json: environment differs (committed {env_b}, now {env_a})")
    for w in warnings:
        print("WARNING", w)
    if strict and warnings:
        problems.append("warnings are failures under --strict")
    for p in problems:
        print("FAIL", p)
    print(f"goldens v1 check: {len(names)} generators, {len(problems)} problems, {len(warnings)} warnings")
    return 1 if problems else 0


def regenerate(names: list[str]) -> int:
    partial = set(names) != set(GENERATORS) and (REPO / MANIFEST).exists()
    keep = json.loads((REPO / MANIFEST).read_text()) if partial else None
    results = {}
    for n in names:
        results[n] = run(n, REPO, "0")
        print(f"{n}: {len(results[n]['files'])} files, counts {results[n]['counts']}")
    Out(REPO).json(MANIFEST, build_manifest(REPO, results, keep))
    print(f"wrote {MANIFEST}")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="regenerate into a temporary directory and compare")
    ap.add_argument("--strict", action="store_true", help="with --check: an environment difference also fails")
    ap.add_argument("--only", help=f"comma-separated subset of {', '.join(GENERATORS)}")
    a = ap.parse_args(argv)
    ensure_public()
    names = a.only.split(",") if a.only else list(GENERATORS)
    unknown = [n for n in names if n not in GENERATORS]
    if unknown:
        ap.error(f"unknown generator(s): {', '.join(unknown)}")
    return check(names, a.strict) if a.check else regenerate(names)


if __name__ == "__main__":
    sys.exit(main())
