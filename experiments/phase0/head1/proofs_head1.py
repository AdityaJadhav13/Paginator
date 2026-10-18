"""EXP-HEAD-1 blind review, headline round: printed vs Pageinator headline breaks (EXPERIMENTAL; PRIVATE OUTPUT).

Design (G1_ACCEPTANCE_PACKAGE.md §7.2/§7.3 R9 "line balance, breaks, fit"; a calibration round, NOT G1):
  pool  = EVERY multi-line headline from the HELD-OUT test editions (run_head1.eligible(); left/centre/right aligned;
          distinct texts) whose printed layout fits in the stand-in and where a Pageinator shape breaks it differently
  A     = the printed line breaks, re-drawn in the stand-in font
  B     = Pageinator with the printed number of lines (the page layout fixes a headline's depth), in one of two shapes —
          BAL (V1_C7: balanced lines) or FILL (FILL_C7: the last line is free) — both with the c7 rules counted on the
          calibration editions exactly as in summary.json (hash in the key). When both shapes give the same breaks the
          item is "BAL=FILL"; when they differ, the headline appears twice (once per shape), at least MIN_SAME_GAP apart.
  font  = Noto Sans Devanagari bold/extra-bold; to resemble the house's condensed headline type, the WIDTH axis
          (wdth 62.5–100) is found by bisection so the words take the printed width at the printed size, then the size
          fine-tunes the total width (it differs from the printed size only where wdth hits a limit). A and B use exactly
          the same font instance, size, leading, alignment, measure and box (sized from the ink of both versions).
  order = seeded; TOP/BOTTOM randomised per item; N_REPEAT items repeated with sides swapped, each ≥ REPEAT_GAP items
          after its original; items are numbered after placement.
Outputs → <dataset>/report/round1_headlines/: headlines_A3.pdf (print at 100 %, landscape), score sheet (A4), CSV
template, KEY_SEALED.json (layout "TB"), README.txt. Analyse with compose3/analyze_round1.py <that folder>.
Safety: refuses to run when the folder holds answers, or when a sealed key exists (its sheets may be with raters) unless
--replace is given; every sheet, CSV row and the key carry the same run id.
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/head1/proofs_head1.py <dataset_dir> [--replace]
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
import subprocess
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import headliner as H  # noqa: E402
import run_head1 as RH  # noqa: E402

sys.path.insert(0, str(HERE.parent / "compose1"))
import render_sheets as RS  # noqa: E402  (glyph outlines/defs; read-only reuse)

K3 = H.K3
MM = 72 / 25.4
SEED = 20261012
N_MAX, N_REPEAT, REPEAT_GAP, MIN_SAME_GAP = 40, 4, 10, 5
PAGE_W, PAGE_H, MARGIN, GAP, PAD = 420.0, 297.0, 12.0, 10.0, 1.0
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
VARIANTS = {"BAL": "V1_C7", "FILL": "FILL_C7"}
GENERATED = ("headlines_A3.pdf", "headlines_score_sheet_A4.pdf", "score_template.csv", "KEY_SEALED.json", "README.txt")


def font_for(h: dict):
    """wdth (bisection, 62.5–100) so the words take the printed width at the printed size; then size fine-tunes."""
    axes0, wt = RH.standin(h["font"])
    text = RH.norm_text(h)
    target = sum(l["words_width_pt"] for l in h["lines"])

    def width(wdth):
        return RH.per_pt_width(text, {**axes0, "wdth": wdth}, wt) * h["size_pt"]
    lo, hi = 62.5, 100.0
    if width(hi) <= target:
        wdth = hi
    elif width(lo) >= target:
        wdth = lo
    else:
        for _ in range(14):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if width(mid) < target else (lo, mid)
        wdth = round((lo + hi) / 2, 2)
    axes = {**axes0, "wdth": wdth}
    return axes, wt, round(target / RH.per_pt_width(text, axes, wt), 3)


def ink(p, ranges) -> tuple[float, float]:
    """Largest ink extent above and below the baseline (mm) over the glyphs of these lines (glyph bounds + y offsets)."""
    f = RS._font_cache(RS.hashlib.sha256(p.face_bytes).hexdigest()[:10], p.face_bytes)  # noqa: SLF001
    glyf, order, s = f["glyf"], f.getGlyphOrder(), p.em_mm / f["head"].unitsPerEm
    asc = desc = 0.0
    for i, j in ranges:
        for k in range(i, j):
            for ci in p.words[k]:
                for ri, gi in p.clusters[ci].glyphs:
                    r = p.runs[ri]
                    g = glyf[order[r.glyph_ids[gi]]]
                    if hasattr(g, "yMax"):
                        asc = max(asc, s * g.yMax - r.y_offsets_mm[gi])
                        desc = max(desc, r.y_offsets_mm[gi] - s * g.yMin)
    return asc, desc


def place_lines(p, ranges, x0, width, baseline, leading, align):
    """<use> elements for token ranges (natural spacing), aligned within [x0, x0+width], first baseline given."""
    s = p.em_mm / RS._font_cache(RS.hashlib.sha256(p.face_bytes).hexdigest()[:10], p.face_bytes)["head"].unitsPerEm  # noqa: SLF001
    els, y = [], baseline
    widths, spaces, _ = H._words(p)
    for i, j in ranges:
        w = H._line_width(widths, spaces, i, j)
        x = x0 + ((width - w) / 2 if align == "center" else (width - w) if align == "right" else 0.0)
        for k in range(i, j):
            for ci in p.words[k]:
                for ri, gi in p.clusters[ci].glyphs:
                    r = p.runs[ri]
                    did, _ = RS.glyph_path(p.face_bytes, r.glyph_ids[gi])
                    els.append(f'<use href="#{did}" transform="translate({x + r.x_offsets_mm[gi]:.4f},{y + r.y_offsets_mm[gi]:.4f}) scale({s:.6f},{-s:.6f})"/>')
                    x += r.x_advances_mm[gi]
            if k < j - 1:
                x += spaces[k] or 0.0
        y += leading
    return els


def versions(h: dict, pols: dict):
    axes, wt, size = font_for(h)
    measure = max(h["span_width_mm"], max(l["width_mm"] for l in h["lines"]))
    pr = RH.print_cuts(h)
    text = RH.norm_text(h)
    pa = K3.prepare(text, "mr", "Deva", RH.FAMILY, size, axes, wt)              # A: unglued tokens = printed words
    if len(pa.words) != len(text.split(" ")):
        return None, "token_mismatch"
    wa, sa, _ = H._words(pa)
    ranges_a, start = [], 0
    for c in pr:
        ranges_a.append((start, c)); start = c
    if any(H._line_width(wa, sa, i, j) > measure + 1e-6 for i, j in ranges_a):
        return None, "print_overflows_standin"                                      # strict, as the composer's fit
    bs, same, unfit = {}, [], []
    for name, key in VARIANTS.items():
        r = H.compose(text, RH.FAMILY, axes, wt, size, measure, pols[key], n_lines=len(pr))
        if not r.fits or len(r.p.words) != len(r.text_glued.split(" ")):
            unfit.append(name)
            continue
        cu = RH.to_unglued(r.text_glued, r.lines)
        if cu != pr:
            bs[name] = (r.p, r.lines, cu, r.relaxed)
        else:
            same.append(name)
    if not bs:
        return None, ("identical" if not unfit else "identical_other_unfit" if same else "no_fit")
    lead = (h["leading_pt"] or 1.15 * h["size_pt"]) * (size / h["size_pt"]) / MM
    asc, desc = ink(pa, ranges_a)
    for p, lines, _, _ in bs.values():
        a2, d2 = ink(p, lines)
        asc, desc = max(asc, a2), max(desc, d2)
    return {"A": (pa, ranges_a), "B": bs, "same": same, "unfit": unfit, "measure": measure, "lead": lead, "size": size, "axes": axes,
            "asc": asc, "desc": desc, "align": h["alignment"], "lines": len(pr)}, "differs"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    ds = Path(args[0]).expanduser()
    out = ds / "report" / "round1_headlines"; out.mkdir(parents=True, exist_ok=True)
    csv_path = out / "score_template.csv"
    if (out / "analysis.json").exists() or (csv_path.exists() and any(r.get("rater", "").strip() for r in csv.DictReader(open(csv_path, encoding="utf-8-sig")))):
        sys.exit(f"refusing to regenerate: {out} holds review answers (move them away first)")
    if (out / "KEY_SEALED.json").exists() and "--replace" not in sys.argv:
        sys.exit(f"refusing to regenerate: {out}/KEY_SEALED.json exists and its sheets may already be with raters "
                 "(answers on paper). Re-run with --replace only if no sheet from that run is in use.")
    for f in [*out.glob("headlines_sheet_*.svg"), *(out / n for n in GENERATED)]:   # a fresh set: stale sheets never mix in
        f.unlink(missing_ok=True)
    rows = [json.loads(l) for l in open(ds / "report" / "headlines.jsonl", encoding="utf-8")]
    hs = RH.eligible(rows)
    pols = RH.policies(hs)
    seen, pool = set(), []
    for h in sorted((h for h in hs if RH.split_of(h) == "test" and RH.kind(h) == "headline" and len(h["lines"]) > 1
                     and h["alignment"] in ("left", "center", "right")), key=lambda h: (h["edition_date"], h["id"])):
        if RH.norm_text(h) not in seen:
            seen.add(RH.norm_text(h)); pool.append(h)
    why, cands, vers = Counter(), [], {}
    for h in pool:
        v, reason = versions(h, pols)
        why[reason] += 1
        if v is None:
            continue
        vers[h["id"]] = v
        b = v["B"]
        if len(b) == 2 and b["BAL"][2] == b["FILL"][2]:
            cands.append((h, "BAL=FILL"))
        else:
            cands += [(h, name) for name in b]
    rng = random.Random(SEED)
    if len(cands) > N_MAX:
        cands = rng.sample(cands, N_MAX)
    for _ in range(1000):                                           # same headline twice (two shapes): keep them apart
        rng.shuffle(cands)
        pos = {}
        for i, (h, _) in enumerate(cands):
            pos.setdefault(h["id"], []).append(i)
        if all(max(p) - min(p) >= MIN_SAME_GAP for p in pos.values() if len(p) > 1):
            break
    seq = [{"uid": i, "id": h["id"], "variant": var, "pageinator_side": "T" if rng.random() < 0.5 else "B", "repeat_of": None}
           for i, (h, var) in enumerate(cands)]
    n_main = len(seq)
    def min_gap(at, ident):        # distance from a new item inserted at index `at` to every item of the same headline
        return min([(at - q) if q < at else (q + 1 - at) for q, e in enumerate(seq) if e["id"] == ident] or [len(seq) + 1])
    eligible_o = list(range(max(0, n_main - REPEAT_GAP)))
    todo = sorted(rng.sample(eligible_o, min(N_REPEAT, len(eligible_o))))
    spare = [u for u in eligible_o if u not in todo]
    while todo:
        o = todo.pop(0)
        orig = seq[[e["uid"] for e in seq].index(o)]
        span = range(min(seq.index(orig) + REPEAT_GAP + 1, len(seq)), len(seq) + 1)
        ok = [a for a in span if min_gap(a, orig["id"]) >= MIN_SAME_GAP]
        if not ok and spare:                    # no valid slot for this original: draw another one instead
            todo.append(spare.pop(rng.randrange(len(spare))))
            continue
        at = rng.choice(ok) if ok else max(span, key=lambda a: min_gap(a, orig["id"]))
        seq.insert(at, {**orig, "uid": f"r{o}", "pageinator_side": "B" if orig["pageinator_side"] == "T" else "T", "repeat_of": o})
    gaps = [b - a for a in range(len(seq)) for b in range(a + 1, len(seq)) if seq[a]["id"] == seq[b]["id"]]
    number = {e["uid"]: n for n, e in enumerate(seq, 1)}
    items = [{"item": number[e["uid"]], "id": e["id"], "variant": e["variant"], "pageinator_side": e["pageinator_side"],
              "repeat_of": number[e["repeat_of"]] if e["repeat_of"] is not None else None,
              "same_as_print": vers[e["id"]]["same"]} for e in seq]
    byid = {h["id"]: h for h, _ in cands}
    run_id = hashlib.sha256(json.dumps({"items": items, "c7": RH.c7_hash(pols["V1_C7"]), "headliner": H.HEADLINER_VERSION},
                                       sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()[:8]

    # layout: blocks (TOP above BOTTOM) packed left→right, top→bottom on landscape A3
    def block_h(v):
        return 6 + 2 * (4 + PAD + v["asc"] + (v["lines"] - 1) * v["lead"] + v["desc"] + PAD + 2)
    pages, page, x, y, row_h = [], [], MARGIN, MARGIN + 12, 0.0
    for it in items:
        v = vers[it["id"]]
        if x + v["measure"] > PAGE_W - MARGIN:
            x, y, row_h = MARGIN, y + row_h + GAP, 0.0
        if y + block_h(v) > PAGE_H - MARGIN:
            pages.append(page); page, x, y, row_h = [], MARGIN, MARGIN + 12, 0.0
        page.append((it, x, y)); x += v["measure"] + GAP + 4; row_h = max(row_h, block_h(v))
    if page:
        pages.append(page)
    names = []
    for pn, page in enumerate(pages, 1):
        RS._GLYPH_DEFS.clear()  # noqa: SLF001
        els = [f'<text x="{MARGIN}" y="{MARGIN + 4}" font-size="4.2" font-family="sans-serif" font-weight="bold">Blind review · HEADLINES · run {run_id} · sheet {pn} of {len(pages)}</text>',
               f'<text x="{MARGIN}" y="{MARGIN + 9}" font-size="2.8" font-family="sans-serif">Print at 100 % (“Actual size”, A3 landscape). Each item shows the same headline twice (TOP and BOTTOM): same words, font, size, number of lines and column width. Judge only the line breaks, balance and fit.</text>',
               f'<line x1="{MARGIN}" y1="{MARGIN + 11}" x2="{PAGE_W - MARGIN}" y2="{MARGIN + 11}" stroke="#000" stroke-width="0.3"/>']
        for it, x0, y0 in page:
            v = vers[it["id"]]
            b = v["B"]["BAL" if it["variant"] == "BAL=FILL" else it["variant"]]
            versions_tb = ((b[0], b[1]), v["A"]) if it["pageinator_side"] == "T" else (v["A"], (b[0], b[1]))
            box_h = PAD + v["asc"] + (v["lines"] - 1) * v["lead"] + v["desc"] + PAD
            els.append(f'<text x="{x0}" y="{y0 + 3.5}" font-size="3.6" font-family="sans-serif" font-weight="bold">Item {it["item"]:02d}</text>')
            yy = y0 + 6
            for label, (p, ranges) in zip(("TOP", "BOTTOM"), versions_tb):
                els.append(f'<text x="{x0}" y="{yy + 3}" font-size="2.6" font-family="sans-serif" fill="#555">{label}</text>')
                els.append(f'<rect x="{x0}" y="{yy + 4}" width="{v["measure"]:.2f}" height="{box_h:.2f}" fill="none" stroke="#bbb" stroke-width="0.2"/>')
                els += place_lines(p, ranges, x0, v["measure"], yy + 4 + PAD + v["asc"], v["lead"], v["align"])
                yy += 4 + box_h + 2
        f = out / f"headlines_sheet_{pn:02d}.svg"; f.write_text(RS.svg_doc(els, PAGE_W, PAGE_H), encoding="utf-8"); names.append(f.name)
    html = out / "headlines.print.html"
    html.write_text("<!doctype html><html><head><meta charset='utf-8'><style>@page{size:420mm 297mm;margin:0}html,body{margin:0}"
                    "img{display:block;width:420mm;height:297mm;page-break-after:always}</style></head><body>"
                    + "".join(f'<img src="{n}">' for n in names) + "</body></html>")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", "--no-pdf-header-footer",
                    "--virtual-time-budget=20000", f"--print-to-pdf={out / 'headlines_A3.pdf'}", html.as_uri()], check=True, capture_output=True)
    html.unlink()
    rows_html = "".join(f"<tr><td class='c'>{it['item']:02d}</td><td>T&nbsp;&nbsp;/&nbsp;&nbsp;B&nbsp;&nbsp;/&nbsp;&nbsp;same</td>"
                        f"<td>1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td>1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td>Y&nbsp;/&nbsp;fix&nbsp;/&nbsp;N</td><td>Y&nbsp;/&nbsp;fix&nbsp;/&nbsp;N</td><td></td></tr>" for it in items)
    sheet = out / "score.print.html"
    sheet.write_text(f"""<!doctype html><html><head><meta charset='utf-8'><style>@page{{size:A4;margin:12mm}}body{{font:10.5pt/1.35 -apple-system,Helvetica,Arial,sans-serif}}
h1{{font-size:14pt;margin:0 0 4mm}}table{{border-collapse:collapse;width:100%}}th,td{{border:0.3mm solid #444;padding:1.4mm 2mm;text-align:left}}th{{font-size:9pt;background:#eee}}
.c{{text-align:center;font-weight:bold}}td:last-child{{width:40mm}}p{{margin:1.5mm 0}}</style></head><body>
<h1>Blind review · HEADLINES · score sheet · run {run_id}</h1>
<p>Name: ______________________ &nbsp; Role: sub-editor / designer / proofreader &nbsp; Date: __________</p>
<p>Each item shows the <b>same headline</b>, in the <b>same font, size, number of lines and column width</b>, broken into lines two ways (TOP and BOTTOM).
Judge only the headline's shape: where the lines break (no awkward splits of names, numbers, phrases), how balanced the lines are, and how well it fills the width.
Some headlines appear more than once; judge every item on its own. Work alone; circle one answer per box.</p>
<p><b>Better:</b> which would you rather print? &nbsp; <b>Headline quality:</b> 1 = bad breaks or shape … 5 = could not be better. &nbsp; <b>OK to print?</b> Y / fix / N.</p>
<table><tr><th>Item</th><th>Better</th><th>Quality TOP</th><th>Quality BOTTOM</th><th>OK? TOP</th><th>OK? BOTTOM</th><th>Notes</th></tr>{rows_html}</table>
</body></html>""", encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={out / 'headlines_score_sheet_A4.pdf'}", sheet.as_uri()],
                   check=True, capture_output=True)
    sheet.unlink()
    (out / "score_template.csv").write_text("run,rater,role,item,better(T/B/same),quality_top(1-5),quality_bottom(1-5),ok_top(Y/fix/N),ok_bottom(Y/fix/N),notes\n"
                                            + "".join(f"{run_id},,,{it['item']},,,,,,\n" for it in items), encoding="utf-8")
    key = {"run_id": run_id, "seed": SEED, "layout": "TB", "headliner": H.HEADLINER_VERSION, "c7_hash": RH.c7_hash(pols["V1_C7"]),
           "min_gap_same_headline": min(gaps) if gaps else None,
           "variants": {name: {"policy": pols[k].name, "shape": pols[k].shape} for name, k in VARIANTS.items()},
           "pool": dict(why), "note": "A = the paper's printed line breaks re-drawn in the stand-in font; B = Pageinator with the printed "
                                     "number of lines (variant BAL, FILL, or BAL=FILL when both give the same breaks). HOLD THIS FILE AWAY FROM RATERS.",
           "items": [{**it, "span_cols": byid[it["id"]].get("span_cols"), "edition_date": byid[it["id"]]["edition_date"],
                      "alignment": byid[it["id"]]["alignment"], "lines": vers[it["id"]]["lines"],
                      "relaxed": vers[it["id"]]["B"]["BAL" if it["variant"] == "BAL=FILL" else it["variant"]][3],
                      "size_pt": vers[it["id"]]["size"], "printed_size_pt": byid[it["id"]]["size_pt"],
                      "wdth": vers[it["id"]]["axes"]["wdth"]} for it in items]}
    (out / "KEY_SEALED.json").write_text(json.dumps(key, indent=1, ensure_ascii=False) + "\n")
    n_head = len({it["id"] for it in items})
    (out / "README.txt").write_text(f"""Blind review, HEADLINE round, run {run_id} (PRIVATE: contains the newspaper's headlines)

{n_main} items from {n_head} printed headlines (editions the rules were NOT derived from): every such headline where Pageinator
breaks the lines differently from the paper. Each item shows the paper's breaks and Pageinator's, in the same stand-in font,
size, number of lines and width. Some headlines appear twice (two Pageinator styles), and {len(items) - n_main} items are repeated
with sides swapped. The sheet size can differ from the printed size where the stand-in cannot be condensed enough (both sides
are always identical in size).
1. Print headlines_A3.pdf on A3 LANDSCAPE at 100 % ("Actual size").
2. Give each reviewer (2 sub-editors + 1 page designer) a set plus headlines_score_sheet_A4.pdf. Work alone.
3. KEY_SEALED.json goes to someone who is not reviewing; open it only after all sheets are back.
4. Check that every returned sheet shows run {run_id}. Type answers into score_template.csv (keep the run column) and run:  python3 experiments/phase0/compose3/analyze_round1.py "{out}"
""", encoding="utf-8")
    for f in out.iterdir():
        f.chmod(0o600)
    print("pool", len(pool), dict(why), "| items", n_main, "from", n_head, "headlines", dict(Counter(it["variant"] for it in items if it["repeat_of"] is None)),
          "+ repeats", len(items) - n_main, "| sheets", len(pages), "| run", run_id, "| min gap same headline", min(gaps) if gaps else None, "| span_cols", dict(Counter(str(byid[i]["span_cols"]) for i in {it["id"] for it in items})))


if __name__ == "__main__":
    main()
