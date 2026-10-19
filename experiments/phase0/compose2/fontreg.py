"""EXP-COMPOSE-2 font registry (EXPERIMENTAL).

Registers: frozen oracle OFL fonts (read-only) + compose2/fonts (OFL, downloaded unmodified from
github.com/google/fonts) + OPTIONAL private fonts from $PAGEINATOR_PRIVATE_FONTS (newsroom/commercial fonts;
never copied into git; used only where the licence permits). Uses the oracle's public FontRegistry API —
the oracle itself is not modified.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402

PUBLIC_FONTS = HERE / "fonts"
PRIVATE_FONTS = Path(os.environ["PAGEINATOR_PRIVATE_FONTS"]) if os.environ.get("PAGEINATOR_PRIVATE_FONTS") else None


def install() -> None:
    """Replace the harness registry with one that also knows compose2 (and private) fonts."""
    reg = C.FontRegistry()
    reg.register_dir(C.ORACLE / "assets" / "fonts")
    reg.register_dir(PUBLIC_FONTS)
    if PRIVATE_FONTS and PRIVATE_FONTS.is_dir():
        reg.register_dir(PRIVATE_FONTS)
    C._REGISTRY = reg  # noqa: SLF001


def manifest() -> dict:
    from fontTools.ttLib import TTFont  # noqa: PLC0415
    out = []
    for root, kind in ((C.ORACLE / "assets" / "fonts", "oracle-OFL"), (PUBLIC_FONTS, "compose2-OFL"),
                       (PRIVATE_FONTS, "PRIVATE (not in git)")):
        if not root or not root.is_dir():
            continue
        for p in sorted(root.rglob("*.ttf")) + sorted(root.rglob("*.otf")):
            f = TTFont(p, lazy=True); n = f["name"]
            lic = sorted(x.name for x in p.parent.glob("*OFL*.txt"))
            rec = {"source": kind, "file": p.name if kind.startswith("PRIVATE") else str(p.relative_to(C.REPO)),
                   "sha256": hashlib.sha256(p.read_bytes()).hexdigest(), "family": n.getDebugName(16) or n.getDebugName(1),
                   "style": n.getDebugName(17) or n.getDebugName(2), "version": n.getDebugName(5),
                   "axes": [a.axisTag for a in f["fvar"].axes] if "fvar" in f else [],
                   "fsType": f["OS/2"].fsType, "licence": "SIL OFL 1.1" if lic else "SEE PRIVATE LICENCE RECORD",
                   "devanagari": any(0x0915 in (t.cmap or {}) for t in f["cmap"].tables)}
            out.append(rec)
    return {"schema": "pageinator.compose2.fonts/1", "upstream": "https://github.com/google/fonts (HEAD bd8f81d at download, 2026-10-11)",
            "note": "Font list chosen as FREELY LICENSED Devanagari faces available to designers; NOT a claim about which fonts Marathi newspapers use (to be confirmed by the newsroom).",
            "fonts": out}


if __name__ == "__main__":
    m = manifest()
    (HERE / "FONTS.json").write_text(json.dumps(m, indent=1, ensure_ascii=False) + "\n")
    for r in m["fonts"]:
        if r["devanagari"]:
            print(r["source"], r["family"], "|", r["style"], "|", r["version"], r["axes"])
