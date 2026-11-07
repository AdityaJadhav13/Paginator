"""O6: corrections without a human. Replaces the hand-written corrections.json (in the pilot, every frame correction was
an exclude_frame) with automatic exclude_frame operations for the body frames the checks flag. Deterministic rules,
fixed here; they read the measurement (measure.json) and the PDF's text (actualtext.py, the validated reader):
  narrow  a body frame narrower than NARROW x the set's modal body width: a box or table fragment, not a column
  wide    a body frame wider than WIDE_PAGE x the page: a full-width footer or imprint line, not a column
  merged  a body frame wider than WIDE x the modal width whose lines' widest gaps have a median >= MERGE_GAP_EM:
          columns merged across a gutter (a wide measure set justified has narrower gaps)
  unmapped  a line of the frame has a glyph the PDF gives no Unicode for (the words cannot be read)
  words   in more than WORDS_SHARE of the frame's lines the decoded word count differs from the geometric token count
The share left out (excluded body frames / body frames) is reported; above MAX_EXCLUDED_SHARE the set is refused
(onboard.too_many_excluded) and a person looks.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import actualtext as AT  # the chain copy (tools/onboard/chain on sys.path)

NARROW = 0.5
WIDE = 1.6
WIDE_PAGE = 0.5
MERGE_GAP_EM = 0.8
WORDS_SHARE = 0.5
MAX_EXCLUDED_SHARE = 0.15


def body_frames(doc: dict):
    for pg in doc["pages"]:
        for f in pg["frames"]:
            if f["is_body_candidate"]:
                yield pg, f


def modal_width(docs: dict) -> float | None:
    c = Counter(round(f["width_mm"] * 2) / 2 for d in docs.values() for _, f in body_frames(d) if f["width_confidence"] == "DERIVED")
    return max(c.items(), key=lambda kv: (kv[1], -kv[0]))[0] if c else None


def frame_flags(f: dict, glyphs: list, modal: float, page_w: float) -> list:
    out = []
    sz = f["size_pt"] or 10
    widest = sorted(max(l["gaps_pt"], default=0.0) for l in f["lines"])
    if f["width_mm"] < NARROW * modal:
        out.append(f"narrow: {f['width_mm']:.1f} mm < {NARROW} x the modal body width {modal} mm")
    elif f["width_mm"] > WIDE_PAGE * page_w:
        out.append(f"wide: {f['width_mm']:.1f} mm > {WIDE_PAGE} x the page width")
    elif f["width_mm"] > WIDE * modal and widest and widest[len(widest) // 2] >= MERGE_GAP_EM * sz:
        out.append(f"merged: {f['width_mm']:.1f} mm with gutter-sized gaps (median widest {widest[len(widest) // 2]:.1f} pt)")
    dec = [AT.line_text(glyphs, l["baseline_pt"], l["x0_mm"] * AT.MM, l["x1_mm"] * AT.MM, sz) for l in f["lines"]]
    if any(d["unmapped"] for d in dec):
        out.append("unmapped: a glyph without Unicode")
    bad = sum(len(d["text"].split()) != len(l["tokens"]) for d, l in zip(dec, f["lines"]))
    if f["lines"] and bad > WORDS_SHARE * len(f["lines"]):
        out.append(f"words: {bad} of {len(f['lines'])} lines' word counts differ from the geometry")
    return out


def corrections(docs: dict, pdfs: dict) -> tuple[dict, dict]:
    """docs {sid: measure doc}, pdfs {sid: Path} -> ({sid: corrections.json}, totals)."""
    modal = modal_width(docs)
    out, n_body, n_ex, by_rule = {}, 0, 0, Counter()
    for sid in sorted(docs):
        ops = []
        for pno in sorted({pg["page"] for pg, _ in body_frames(docs[sid])}):
            glyphs = AT.page_glyphs(pdfs[sid], pno)
            for pg, f in body_frames(docs[sid]):
                if pg["page"] != pno:
                    continue
                n_body += 1
                flags = frame_flags(f, glyphs, modal, pg["page_w_mm"]) if modal else []
                if flags:
                    n_ex += 1
                    by_rule.update(x.split(":")[0] for x in flags)
                    ops.append({"op": "exclude_frame", "frame": f["id"], "reason": "auto: " + "; ".join(flags)})
        out[sid] = {"schema": "pageinator.published1.corrections/1", "author": "tools/onboard autocorrect (O6)", "date": None, "ops": ops}
    return out, {"body_frames": n_body, "excluded": n_ex, "share": round(n_ex / n_body, 4) if n_body else 0.0,
                 "by_rule": dict(sorted(by_rule.items())), "modal_width_mm": modal}


def write(ds: Path, corr: dict) -> None:
    for sid, c in corr.items():
        (ds / "samples" / sid / "corrections.json").write_text(json.dumps(c, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
