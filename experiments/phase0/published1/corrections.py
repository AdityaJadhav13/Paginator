"""EXP-PUBLISHED-1 manual corrections (EXPERIMENTAL).

RAW EXTRACTION (raw.json) and AUTOMATED MEASUREMENT (measure.json) are never modified. A human writes
<sample>/corrections.json; this script produces corrected.json = measurement + recorded operations, with every
touched item marked MANUALLY_VERIFIED and frame metrics recomputed.

corrections.json:
{ "schema": "pageinator.published1.corrections/1", "author": "...", "date": "YYYY-MM-DD", "ops": [
   {"op": "exclude_sample", "reason": "..."},
   {"op": "exclude_frame", "frame": "p1-f3", "reason": "headline/caption/ad text"},
   {"op": "exclude_line", "line": "p1-f2-l7", "reason": "..."},
   {"op": "set_line_class", "line": "p1-f2-l9", "class": "FINAL_PARAGRAPH_LINE", "reason": "..."},
   {"op": "set_break", "line": "p1-f2-l4", "is_break": true, "visible_hyphen": true,
        "verified_word": "महानगरपालिकेच्या", "break_offset_chars": 5, "manual_or_auto": "unknown|manual|auto", "note": "..."},
   {"op": "set_font", "frame": "p1-f2", "family": "...", "version": "...", "licence": "...", "note": "..."},
   {"op": "set_column", "frame": "p1-f2", "left_mm": 20.0, "right_mm": 66.5, "reason": "..."},
   {"op": "annotate", "target": "p1-f2-l12", "note": "URL set in smaller type"} ] }

Usage: .venv/bin/python corrections.py <measure.json> <corrections.json> --out <corrected.json>
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "compose1"))
import measure as M  # noqa: E402
import schema as S  # noqa: E402


def hyph_mr_consistent(word: str, offset: int) -> bool | None:
    try:
        import hyphenation as Hy  # noqa: PLC0415  (EXP-COMPOSE-1 Liang reader; hyph-mr pattern data, LICENCE REVIEW REQUIRED)
        return offset in Hy.word_breaks(word, "mr", 1, 1)
    except Exception:  # noqa: BLE001
        return None


def apply(meas: dict, corr: dict) -> dict:
    out = copy.deepcopy(meas)
    out["schema"] = "pageinator.published1.corrected/1"
    out["corrections"] = {"author": corr.get("author"), "date": corr.get("date"), "ops": corr.get("ops", []), "applied": [], "unmatched": []}
    frames = {f["id"]: f for p in out["pages"] for f in p["frames"]}
    lines = {l["id"]: (f, l) for f in frames.values() for l in f["lines"]}
    for op in corr.get("ops", []):
        kind = op.get("op"); ok = True
        if kind == "exclude_sample":
            out["excluded"] = {"reason": op.get("reason"), "confidence": S.MANUALLY_VERIFIED}
        elif kind == "exclude_frame" and op.get("frame") in frames:
            frames[op["frame"]]["excluded"] = {"reason": op.get("reason")}
        elif kind == "exclude_line" and op.get("line") in lines:
            lines[op["line"]][1]["excluded"] = {"reason": op.get("reason")}
        elif kind == "set_line_class" and op.get("line") in lines and op.get("class") in S.LINE_CLASSES:
            l = lines[op["line"]][1]; l["class_auto"] = l["class"]; l["class"] = op["class"]; l["class_confidence"] = S.MANUALLY_VERIFIED
        elif kind == "set_break" and op.get("line") in lines:
            l = lines[op["line"]][1]
            if not op.get("is_break"):
                l["break_auto"] = l.get("break"); l["break"] = None
            else:
                b = dict(l.get("break") or {})
                b.update({"visible_hyphen": op.get("visible_hyphen"), "verified_word": op.get("verified_word"),
                          "break_offset_chars": op.get("break_offset_chars"), "manual_or_auto": op.get("manual_or_auto"),
                          "note": op.get("note"), "confidence": S.MANUALLY_VERIFIED})
                if op.get("verified_word") and op.get("break_offset_chars") is not None:
                    w, k = op["verified_word"], op["break_offset_chars"]
                    b["hyph_mr_consistent"] = hyph_mr_consistent(w, k)
                    b["aksharas_before_est"], b["aksharas_after_est"] = S.akshara_estimate(w[:k]), S.akshara_estimate(w[k:])
                l["break"] = b
        elif kind == "set_font" and op.get("frame") in frames:
            frames[op["frame"]]["font_manual"] = {k: op.get(k) for k in ("family", "version", "licence", "note")}
            frames[op["frame"]]["font_family_confidence"] = S.MANUALLY_VERIFIED
        elif kind == "set_column" and op.get("frame") in frames:
            f = frames[op["frame"]]
            f["column_auto"] = {"left_mm": f["column_left_mm"], "right_mm": f["right_edge_mm"]}
            f["column_left_mm"], f["right_edge_mm"] = op["left_mm"], op["right_mm"]
            f["width_mm"] = round(op["right_mm"] - op["left_mm"], 4); f["width_confidence"] = S.MANUALLY_VERIFIED
            for l in f["lines"]:
                l["right_slack_mm"] = round(op["right_mm"] - l["x1_mm"], 4)
                if l.get("class_confidence") != S.MANUALLY_VERIFIED and l["class"] != "FINAL_PARAGRAPH_LINE":
                    slack_pt = l["right_slack_mm"] / S.MM_PER_PT
                    near = S.TOL["align_near_spaces"] * (f["nominal_space_pt"] or 0.25 * (f["size_pt"] or 10))
                    l["class"] = "FULLY_ALIGNED" if abs(slack_pt) <= S.TOL["align_full_pt"] else ("NEAR_ALIGNED" if slack_pt <= near else "RAGGED")
        elif kind == "annotate":
            out.setdefault("annotations", []).append({"target": op.get("target"), "note": op.get("note")})
        else:
            ok = False
        (out["corrections"]["applied"] if ok else out["corrections"]["unmatched"]).append(op)
    for f in frames.values():
        kept = [l for l in f["lines"] if not l.get("excluded")]
        f["metrics"] = M.frame_metrics(kept)
        f["metrics"]["excluded_lines"] = len(f["lines"]) - len(kept)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("measure", type=Path); ap.add_argument("corrections", type=Path); ap.add_argument("--out", type=Path, required=True)
    a = ap.parse_args()
    out = apply(json.loads(a.measure.read_text()), json.loads(a.corrections.read_text()))
    a.out.write_text(json.dumps(out, ensure_ascii=False))
    print(f"applied={len(out['corrections']['applied'])} unmatched={len(out['corrections']['unmatched'])}")


if __name__ == "__main__":
    main()
