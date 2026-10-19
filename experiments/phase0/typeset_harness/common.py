"""Shared helpers for the Phase 0 typesetting measurement harness.

EXPERIMENTAL / EVIDENCE TOOLING. Not production code. Not an architecture decision
(a Python harness does not mean the production kernel is Python — ADR-017, `16` §1).

The harness only *calls* the frozen reference engine (tools/oracle/v0) through its public
API. It never modifies it. Anything that goes beyond the oracle's behaviour (diagnostics,
hypothetical hyphenation points, space-factor accounting) lives here and is labelled.
"""
from __future__ import annotations

import hashlib
import importlib.metadata as md
import json
import os
import platform
import subprocess
import sys
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
ORACLE = REPO / "tools" / "oracle" / "v0"
CORPUS = REPO / "fixtures" / "typeset" / "v1" / "corpus" / "texts.json"
CONDITIONS = REPO / "fixtures" / "typeset" / "v1" / "conditions.json"
sys.path.insert(0, str(ORACLE))

from paginator.geometry import MM_PER_PT  # noqa: E402
from paginator.typeset import FontRegistry, itemize, shape_run  # noqa: E402
from paginator.typeset.linebreak import (  # noqa: E402
    break_greedy, break_knuth_plass, break_lines, build_nodes)
from paginator.typeset.schemas import Glue, HyphenPoint, Penalty, TextStyle  # noqa: E402

FINAL_GLUE_STRETCH = 1e5  # oracle's terminal infinite glue is ≥1e5 mm stretch


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_file(p: Path) -> str:
    return sha256_bytes(p.read_bytes())


def _cmd(args: list[str]) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=30).stdout.strip()
    except Exception:  # noqa: BLE001
        return ""


def environment(extra: dict | None = None) -> dict:
    """Everything needed to reproduce a measurement (prompt §18)."""
    oracle_manifest = json.loads((ORACLE / "ORACLE_MANIFEST.json").read_text())
    import uharfbuzz as hb  # noqa: PLC0415
    env = {
        "captured_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "hardware": {
            "machine": platform.machine(),
            "cpu": _cmd(["sysctl", "-n", "machdep.cpu.brand_string"]) or platform.processor(),
            "cores_logical": os.cpu_count(),
            "mem_bytes": int(_cmd(["sysctl", "-n", "hw.memsize"]) or 0) or None,
            "model": _cmd(["sysctl", "-n", "hw.model"]) or None,
        },
        "os": platform.platform(),
        "python": sys.version.split()[0],
        "python_executable": sys.executable,
        "harfbuzz": hb.version_string(),
        "packages": {k: _ver(k) for k in ("uharfbuzz", "fonttools", "pydantic", "freetype-py")},
        "oracle": {"id": oracle_manifest["oracle_id"], "source_commit": oracle_manifest["source"]["git_commit"],
                   "manifest_sha256": sha256_file(ORACLE / "ORACLE_MANIFEST.json")},
        "corpus": {"path": str(CORPUS.relative_to(REPO)), "sha256": sha256_file(CORPUS)},
        "conditions": {"path": str(CONDITIONS.relative_to(REPO)), "sha256": sha256_file(CONDITIONS)},
        "power_note": "Laptop measurements: record AC power / low-power mode manually if relevant.",
    }
    if extra:
        env.update(extra)
    return env


def _ver(name: str) -> str | None:
    try:
        return md.version(name)
    except md.PackageNotFoundError:
        return None


_REGISTRY: FontRegistry | None = None


def registry() -> FontRegistry:
    global _REGISTRY
    if _REGISTRY is None:
        r = FontRegistry()
        r.register_dir(ORACLE / "assets" / "fonts")
        _REGISTRY = r
    return _REGISTRY


def face(family: str, weight: int = 400, axes: dict | None = None):
    return registry().resolve(family, weight, "normal", axes=axes)


def font_file_for(family: str) -> dict:
    """Font identity from the oracle manifest (hash of the source file)."""
    m = json.loads((ORACLE / "ORACLE_MANIFEST.json").read_text())
    for f in m["fonts"]:
        if family in (f["family"], f.get("typographic_family")) and f["subfamily"] in ("Regular", None):
            return {"family": family, "file": f["file"], "sha256": f["sha256"], "version": f["version"]}
    for f in m["fonts"]:
        if (f.get("typographic_family") or f["family"]).startswith(family):
            return {"family": family, "file": f["file"], "sha256": f["sha256"], "version": f["version"]}
    return {"family": family, "file": None, "sha256": None, "version": None}


def load_corpus() -> list[dict]:
    return json.loads(CORPUS.read_text())["texts"]


def load_conditions() -> dict:
    return json.loads(CONDITIONS.read_text())


@dataclass
class Shaped:
    text: str
    runs: list
    items: list
    shape_s: float


def shape_paragraph(text: str, lang: str, family: str, size_pt: float, *,
                    weight: int = 400, axes: dict | None = None, tracking: float = 0.0) -> Shaped:
    """Itemize by script (oracle `itemize`) and shape every item with ONE face.

    Font stack policy for Phase 0 fixtures: a single face for all items. All corpus Devanagari
    faces cover the Latin/punctuation used (probed 2026-10-07). Fallback stacks are a kernel
    feature not present in oracle-v0.
    """
    f = face(family, weight, axes)
    t0 = time.perf_counter()
    items = itemize(text, lang)
    runs = []
    for it in items:
        runs.append(shape_run(text[it.start:it.end], f, size_pt, script=it.script, language=lang,
                              direction=it.direction, tracking=tracking, char_offset=it.start))
    return Shaped(text=text, runs=runs, items=items, shape_s=time.perf_counter() - t0)


def style(family: str, size_pt: float, leading_pt: float, policy: dict, algorithm: str = "knuth_plass",
          in_word_break: str = "none") -> TextStyle:
    return TextStyle(font_family=family, size_pt=size_pt, leading_pt=leading_pt, algorithm=algorithm,
                     word_space_min=policy["word_space_min"], word_space_opt=1.0,
                     word_space_max=policy["word_space_max"], tolerance=policy["tolerance"],
                     in_word_break=in_word_break)


# --------------------------------------------------------------------------------------------
# Diagnostics (EXPERIMENTAL — not oracle behaviour)
# --------------------------------------------------------------------------------------------

def line_diagnostics(nodes: list, breakpoints, measure_mm: float, size_pt: float) -> list[dict]:
    """Per-line, policy-independent accounting of each chosen line.

    space_factor = width each inter-word space would need to fill the measure exactly,
    as a multiple of its natural width. 1.0 = natural spacing; 1.5 = 150 %.
    Computed from the line's own content, so it does not depend on word_space_max.
    """
    out = []
    start = 0
    em_mm = size_pt * MM_PER_PT
    for k, bp in enumerate(breakpoints):
        seg = nodes[start:bp.node_index]
        glues = [n for n in seg if isinstance(n, Glue) and n.stretch_mm < FINAL_GLUE_STRETCH]
        n_gl = len(glues)
        space_w = (sum(g.width_mm for g in glues) / n_gl) if n_gl else 0.0
        boxes_w = bp.natural_width_mm - sum(g.width_mm for g in glues)
        last = k == len(breakpoints) - 1
        slack = bp.measure_mm - bp.natural_width_mm  # >0 underfull, <0 overfull
        if n_gl:
            space_factor = (bp.measure_mm - boxes_w) / (n_gl * space_w)
        else:
            space_factor = float("inf") if slack > 1e-9 else (1.0 if abs(slack) <= 1e-9 else float("-inf"))
        out.append({
            "line": k, "last": last, "glues": n_gl, "natural_mm": bp.natural_width_mm,
            "measure_mm": bp.measure_mm, "slack_mm": slack, "hyphenated": bp.is_hyphenated,
            "space_factor": space_factor, "ratio": bp.adjustment_ratio,
            "space_em": space_w / em_mm if n_gl else None,
        })
        # next line starts after the break node (glue/penalty discarded at break)
        start = bp.node_index + 1
    return out


def classify_line(d: dict, policy: dict) -> str:
    """Policy-relative class of one non-final line."""
    if d["last"]:
        return "LAST_LINE"
    if d["slack_mm"] < -1e-6 and d["glues"] == 0:
        return "OVERFULL_NO_LEGAL_BREAK"  # single unbreakable item wider than the measure
    if d["glues"] == 0:
        return "UNDERFULL_SINGLE_WORD"  # nothing to stretch
    sf = d["space_factor"]
    if sf < policy["word_space_min"] - 1e-9:
        return "SPACING_BELOW_MIN"
    if sf > policy["word_space_max"] + 1e-9:
        return "SPACING_ABOVE_MAX"
    return "OK"


def orthographic_break_points(text: str, runs, script_min_side: int = 2) -> list[HyphenPoint]:
    """UPPER-BOUND sensitivity probe — NOT a hyphenation proposal and NOT linguistically valid.

    Allows an in-word break at every cluster boundary (HarfBuzz clusters ≈ aksharas for
    Devanagari, letters for Latin) leaving ≥ `script_min_side` clusters on each side, only
    inside words of letters/marks. Answers "how much could ANY in-word breaking help?",
    nothing more. Real hyphenation needs patterns/dictionaries + editorial validation.
    """
    pts: list[HyphenPoint] = []
    bounds: list[int] = []
    for r in runs:
        prev = None
        for c in r.cluster_map:
            if c != prev:
                bounds.append(c)
                prev = c
    bounds = sorted(set(bounds))
    # word spans: maximal runs of letter/mark chars
    i, n = 0, len(text)
    while i < n:
        if unicodedata.category(text[i])[0] in "LM":
            j = i
            while j < n and unicodedata.category(text[j])[0] in "LM":
                j += 1
            inner = [b for b in bounds if i < b < j]
            word_bounds = [i] + inner + [j]
            for idx in range(script_min_side, len(word_bounds) - script_min_side):
                pts.append(HyphenPoint(offset=word_bounds[idx], inserts_glyph=True))
            i = j
        else:
            i += 1
    return pts


def percentile(xs: list[float], p: float) -> float:
    if not xs:
        return float("nan")
    s = sorted(xs)
    k = (len(s) - 1) * p
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


__all__ = [n for n in dir() if not n.startswith("_")] + [
    "break_greedy", "break_knuth_plass", "break_lines", "build_nodes", "Glue", "Penalty", "MM_PER_PT"]
