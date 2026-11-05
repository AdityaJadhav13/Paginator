"""G-RLINE: composed lines placed as glyphs, exactly as the press test places them (EVIDENCE TOOLING).

experiments/phase0/pdfx1/make_press_test.py PageBuilder.composed_line() turns one composed line into glyphs: clusters
in order, glyph offsets, advances, Latin tracking between the clusters of a piece, a space glyph and the natural space
times the applied space factor at each word space, an NBSP indent advanced but not drawn, and a hyphen glyph after an
in-word break. natural() sets one label at natural spacing, aligned left, centre or right. Both record the line as the
press manifest does (font key, size, text, glyph ids with x, y in PDF points rounded to 3 decimals, y up from the page
bottom). Recorded in rline/lines.jsonl.gz, one record per line with everything that produced it.
Cases (the press test's fonts F1–F3 and its own composition steps):
  BODY      the Marathi corpus body texts, with the press test's NBSP indent, composed with its body policy at its body
            size on 1 and 2 columns, every line placed down the column at the house leading
  BREAKS    the same with in-word breaks allowed (hyphen glyphs)
  TRACKING  the English corpus body texts in F3 with a HYBRID Latin tracking policy on 1 and 2 columns
  HEADLINE  the corpus headlines with the press test's headline policy in F2 at 22 pt on 1–4 columns
  NATURAL   labels and the glyph ladder at natural spacing, left, centre and right aligned
"""
from __future__ import annotations

import json
import statistics as st
import sys

from golden import EXPERIMENTS, GOLDENS, REPO, Out, cli, ensure_public, environment, fhex

sys.path.insert(0, str(EXPERIMENTS / "pdfx1"))
import make_press_test as MP  # noqa: E402  (its imports install the compose2 font registry)

C, K3, R3, X = MP.C, MP.K3, MP.R3, MP.X
LEAD_MM = MP.HOUSE_LEADING_PT / X.MM


def press_body(B):
    """make_press_test.build_page: body size, house k, chosen policy and NBSP indent."""
    body_pt = round(MP.HOUSE_BODY_PT * MP.DEFAULT_WIDTH_RATIO, 3)
    fam, axes, _wt, _ = MP.FONTS["F1"]
    probe = B.prepare("क ख", "F1", body_pt)
    k = (MP.HOUSE_SPACE_EM * MP.HOUSE_BODY_PT / X.MM) / st.median(s for s in probe.spaces if s)
    summ = json.loads((R3.OUT / "summary.json").read_text())
    chosen = summ["selection"]["chosen"]
    kind, prm = R3.candidates()[chosen]
    nb_adv = C.shape_paragraph(MP.NBSP, "mr", fam, body_pt, axes=axes).runs[0].x_advances_mm[0]
    n_nb = max(1, round(MP.HOUSE_INDENT_MM / nb_adv))
    return body_pt, k, chosen, kind, prm, n_nb


def main(root=REPO) -> dict:
    ensure_public()
    out = Out(root)
    B = MP.PageBuilder(True)
    records = []

    def placed(case: str, inp: dict) -> None:
        line = B.lines[-1]
        records.append({"case": case, "input": inp, "expected": line})

    def flow(case, text, fkey, size, pol, measure, x0, y0, extra):
        p = B.prepare(text, fkey, size)
        c = K3.compose(p, pol, measure)
        if c.status != "OK":
            return 0
        y = y0
        for i, ln in enumerate(c.lines):
            B.composed_line(p, c, ln, x0, y, fkey)
            placed(case, {**extra, "text": text, "font": fkey, "size_pt_hex": fhex(size), "policy": pol.name,
                          "measure_mm_hex": fhex(measure), "line": i, "x0_mm_hex": fhex(x0), "y_mm_hex": fhex(y),
                          "line_kind": ln.kind, "end_break": ln.end_break,
                          "tracking_mm_per_gap_hex": fhex(ln.tracking_mm_per_gap)})
            y += LEAD_MM
        return len(c.lines)

    body_pt, k, chosen, kind, prm, n_nb = press_body(B)
    body_pol = R3.policy_for(chosen, kind, prm, k)
    breaks_pol = R3.policy_for(chosen + "_with_breaks", kind, prm, k, inword="rules")
    texts = {t["id"]: t for t in C.load_corpus()}
    body = [t for t in sorted(texts) if texts[t]["kind"] == "body" and texts[t]["lang"] == "mr"]
    for tid in body:
        text = MP.NBSP * n_nb + texts[tid]["text"]
        for cols in (1, 2):
            flow("BODY", text, "F1", body_pt, body_pol, MP.span_w(cols), MP.col_x(0), 60.0, {"text_id": tid})
            flow("BREAKS", text, "F1", body_pt, breaks_pol, MP.span_w(cols), MP.col_x(2), 60.0, {"text_id": tid})
    tracking = K3.Policy("RLINE_HYBRID_tracking", "HYBRID", tracking_max_milli_em=30.0, inword="rules", inword_min=(2, 2))
    for tid in sorted(t for t in texts if texts[t]["kind"] == "body" and texts[t]["lang"] == "en"):
        for cols in (1, 2):
            flow("TRACKING", texts[tid]["text"], "F3", 10.0, tracking, MP.span_w(cols), MP.col_x(4), 60.0,
                 {"text_id": tid})
    head_pol = K3.Policy("HEADLINE_ragged", "RAGGED", inword="none", token_breaks=True, fallback_max_slack=None)
    for tid in sorted(t for t in texts if texts[t]["kind"] == "headline" and texts[t]["script"] == "Deva"):
        for cols in (1, 2, 3, 4):
            flow("HEADLINE", texts[tid]["text"], "F2", 22.0, head_pol, MP.span_w(cols), MP.col_x(0), 57.5,
                 {"text_id": tid})
    labels = [("F3", 7.0, "PAGEINATOR PRESS TEST — NOT FOR PUBLICATION — PDF/X-1a:2003"), ("F3", 6.5, "K 100%"),
              ("F2", 16.0, "छायाचित्र क्षेत्र"), ("F1", 9.0, "छायाचित्र क्षेत्र : १५% काळी छटा, फक्त काळी शाई"),
              ("F2", 44.0, "पेजिनेटर मुद्रण चाचणी"), ("F1", 8.0, "पांढरी अक्षरे काळ्या पार्श्वभूमीवर — White text")]
    labels += [("F1", float(size), f"{size} pt  " + MP.LADDER) for size in (6, 7, 8, 9, 10, 12)]
    for fkey, size, text in labels:
        for align, x in (("left", MP.MARGIN_L), ("center", MP.PAGE_W / 2), ("right", MP.RIGHT)):
            B.natural(text, fkey, size, x, 100.0, align=align)
            placed("NATURAL", {"text": text, "font": fkey, "size_pt_hex": fhex(size), "align": align,
                               "x_mm_hex": fhex(x), "y_mm_hex": fhex(100.0)})
    out.jsonl_gz(GOLDENS / "rline" / "lines.jsonl.gz", records)
    by_case = {}
    for r in records:
        by_case[r["case"]] = by_case.get(r["case"], 0) + 1
    counts = {"lines": len(records), "by_case": dict(sorted(by_case.items())),
              "glyphs": sum(len(r["expected"]["glyphs"]) for r in records),
              "hyphenated": sum(r["input"].get("end_break") == "inword" for r in records),
              "tracked": sum(r["input"].get("tracking_mm_per_gap_hex", "0x0.0p+0") != "0x0.0p+0" for r in records)}
    out.json(GOLDENS / "rline" / "info.json", {"schema": "pageinator.golden.rline/1", "page_maker": MP.MAKER_VERSION,
                                               "fonts": {k: list(v) for k, v in MP.FONTS.items()},
                                               "body_pt_hex": fhex(body_pt), "house_k_hex": fhex(k), "policy": chosen,
                                               "nbsp_indent": n_nb, "counts": counts, "environment": environment()})
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
