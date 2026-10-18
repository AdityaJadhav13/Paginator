"""EXP-COMPOSE-3 blind review, round 1: paired proof sheets of the pilot's OWN paragraphs (EXPERIMENTAL; PRIVATE OUTPUT).

Design (G1_ACCEPTANCE_PACKAGE.md §7.2, scaled down — this is a calibration round, NOT G1):
  item   = one complete published paragraph from the HELD-OUT test editions whose line breaks differ in Pageinator
  A      = the published line breaks (the paper's InDesign), re-drawn line by line in the OFL stand-in font
  B      = Pageinator (EXP-COMPOSE-3 chosen policy, no word breaks), same text, font, size, measure, leading, indent
  Both use the same font because the house font is not licensed to us; raters therefore compare line breaking and
  word spacing only. L/R order is randomised per item (seeded); 4 items are repeated with sides swapped (consistency).
Outputs (PRIVATE, they contain the paper's text) → <dataset>/report/round1/:
  round1_proofs_A3.pdf (print at 100 %), round1_score_sheet_A4.pdf, score_template.csv, KEY_SEALED.json, README.txt
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose3/proofs_round1.py <dataset_dir>
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
from html import escape
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run_compose3 as R  # noqa: E402  (also installs the compose2 font registry)

sys.path.insert(0, str(HERE.parent / "compose1"))
import render_sheets as RS  # noqa: E402  (glyph outlines/defs; read-only reuse)
import render as R3R  # noqa: E402  (compose3/render.py: line placement with the correct vertical mark offset)

K3, C, MM = R.K3, R.C, R.MM
SEED = 20261012
N_ITEMS, N_REPEAT = 24, 4
PAGE_W, PAGE_H, MARGIN, GAP_COLS, GAP_ITEMS = 297.0, 420.0, 14.0, 9.0, 12.0
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BANDS = [("36.5", 35.5, 38.0), ("46.5", 44.0, 48.5), ("50", 48.5, 52.0), ("57", 54.0, 59.0), ("wide", 70.0, 80.0)]
QUOTA = {"36.5": 6, "46.5": 4, "50": 7, "57": 4, "wide": 3}


def replay_line(text: str, size: float, target_mm: float, justify: bool):
    """One published line, re-drawn in the stand-in font: same words; justified to the printed set width or natural."""
    p = K3.prepare(text, "mr", "Deva", R.FAM, size, R.AXES, R.WT)
    pol = K3.Policy("REPLAY", "HYBRID", ws_min_hard=0.0, ws_max_hard=1e9, inword="none", token_breaks=False, fallback_max_slack=None)
    pieces, btype, bspace = K3.build_pieces(p, pol, target_mm)
    P = len(pieces)
    boxes = sum(pc.width for pc in pieces)
    spaces = sum(bspace[:P - 1]) if P > 1 else 0.0
    n_sp = sum(1 for k in range(P - 1) if btype[k] == "space")
    natural = boxes + spaces
    sf = 1.0 + (target_mm - natural) / spaces if (justify and spaces > 0) else 1.0
    kind = "justified" if (justify and spaces > 0) else "final"
    ln = K3.Line(0, P, kind, n_sp, n_sp + 1, boxes, spaces, natural, target_mm, sf, sf, 0.0, target_mm - natural, "end", 0.0, True, [])
    return p, K3.Composed("OK", "", [ln], 0.0, pieces, btype), sf, natural


def item_versions(par: dict, chosen: str):
    p, size, n_nb, our_sp, house_sp = R.prepare_paragraph(par)
    kind, prm = R.candidates()[chosen]
    c = K3.compose(p, R.policy_for(chosen, kind, prm, house_sp / our_sp), par["width_mm"])
    ours = [(p, c, ln) for ln in c.lines]
    replay, sfs = [], []
    for i, ln in enumerate(par["lines"]):
        txt = (R.NBSP * n_nb if i == 0 else "") + ln["text"]
        just = ln["class"] in ("FULLY_ALIGNED", "NEAR_ALIGNED")
        target = par["width_mm"] - max(0.0, ln["right_slack_mm"]) if just else par["width_mm"]
        pl, cl, sf, nat = replay_line(txt, size, target, just)
        replay.append((pl, cl, cl.lines[0])); sfs.append(sf if just else 1.0)
    differs = [ln.n_words for ln in c.lines] != [l["n_words"] for l in par["lines"]]
    return {"size": size, "ours": ours, "replay": replay, "replay_min_sf": min(sfs), "differs": differs,
            "lines_print": len(par["lines"]), "lines_ours": len(c.lines)}


def draw_column(lines, x0: float, y0: float, leading: float) -> tuple[list[str], float]:
    els, y = [], y0
    for p, c, ln in lines:
        y += leading
        upem = RS._font_cache(RS.hashlib.sha256(p.face_bytes).hexdigest()[:10], p.face_bytes)["head"].unitsPerEm  # noqa: SLF001
        els += R3R.line_glyphs(p, c, ln, x0, y, upem)
    return els, y


def main():
    ds = Path(sys.argv[1]).expanduser()
    out = ds / "report" / "round1"; out.mkdir(parents=True, exist_ok=True)
    summary = json.loads((R.OUT / "summary.json").read_text())
    chosen = summary["selection"]["chosen"]
    pars = [json.loads(l) for l in open(ds / "report" / "paragraphs.jsonl", encoding="utf-8")]
    pool = [p for p in pars if p["edition_date"] >= R.SPLIT_DATE and p["width_confidence"] == "DERIVED" and 5 <= len(p["lines"]) <= 18]
    rng = random.Random(SEED)
    rng.shuffle(pool)
    picked, versions = [], {}
    for band, lo, hi in BANDS:
        n = 0
        for par in pool:
            if n >= QUOTA[band] or not (lo <= par["width_mm"] < hi) or par in picked:
                continue
            v = item_versions(par, chosen)
            if not v["differs"] or v["replay_min_sf"] < 0.5:      # identical breaks, or the font swap distorts the original
                continue
            picked.append(par); versions[par["id"]] = v; n += 1
    rng.shuffle(picked)
    items = []
    for i, par in enumerate(picked, 1):
        b_left = rng.random() < 0.5
        items.append({"item": i, "id": par["id"], "pageinator_side": "L" if b_left else "R", "repeat_of": None})
    for j, it in enumerate(rng.sample(items, N_REPEAT), 1):
        items.append({"item": len(picked) + j, "id": it["id"], "pageinator_side": "R" if it["pageinator_side"] == "L" else "L",
                      "repeat_of": it["item"]})
    byid = {p["id"]: p for p in picked}

    # ---------------- layout: item blocks packed into rows on A3 pages
    pages, page, x, y, row_h = [], [], MARGIN, MARGIN + 12, 0.0
    for it in items:
        par = byid[it["id"]]; v = versions[it["id"]]; lead = par["leading_pt"] / MM; w = par["width_mm"]
        h = 8 + max(v["lines_print"], v["lines_ours"]) * lead + 4
        bw = 2 * w + GAP_COLS
        if x + bw > PAGE_W - MARGIN:
            x, y, row_h = MARGIN, y + row_h + GAP_ITEMS, 0.0
        if y + h > PAGE_H - MARGIN:
            pages.append(page); page, x, y, row_h = [], MARGIN, MARGIN + 12, 0.0
        page.append((it, x, y)); x += bw + GAP_ITEMS + 6; row_h = max(row_h, h)
    if page:
        pages.append(page)
    pdf_imgs = []
    for pn, page in enumerate(pages, 1):
        RS._GLYPH_DEFS.clear()  # noqa: SLF001
        els = [f'<text x="{MARGIN}" y="{MARGIN + 4}" font-size="4.2" font-family="sans-serif" font-weight="bold">Blind review · round 1 · sheet {pn} of {len(pages)}</text>',
               f'<text x="{MARGIN}" y="{MARGIN + 9}" font-size="2.8" font-family="sans-serif">Print at 100 % (“Actual size”). For each item compare LEFT and RIGHT and fill in the score sheet. Same words, same font, same column width.</text>',
               f'<line x1="{MARGIN}" y1="{MARGIN + 11}" x2="{PAGE_W - MARGIN}" y2="{MARGIN + 11}" stroke="#000" stroke-width="0.3"/>']
        for it, x0, y0 in page:
            par = byid[it["id"]]; v = versions[it["id"]]; lead = par["leading_pt"] / MM; w = par["width_mm"]
            left, right = (v["ours"], v["replay"]) if it["pageinator_side"] == "L" else (v["replay"], v["ours"])
            els.append(f'<text x="{x0}" y="{y0 + 3.5}" font-size="3.6" font-family="sans-serif" font-weight="bold">Item {it["item"]:02d}</text>')
            for col, (lines, cx) in enumerate(((left, x0), (right, x0 + w + GAP_COLS))):
                els.append(f'<text x="{cx}" y="{y0 + 7.6}" font-size="2.8" font-family="sans-serif">{"LEFT" if col == 0 else "RIGHT"}</text>')
                g, _ = draw_column(lines, cx, y0 + 8.5, lead)
                els += g
            els.append(f'<line x1="{x0 + w + GAP_COLS / 2:.2f}" y1="{y0 + 6}" x2="{x0 + w + GAP_COLS / 2:.2f}" y2="{y0 + 8.5 + max(v["lines_print"], v["lines_ours"]) * lead:.2f}" stroke="#bbb" stroke-width="0.2"/>')
        svg = RS.svg_doc(els, PAGE_W, PAGE_H)
        f = out / f"round1_sheet_{pn:02d}.svg"; f.write_text(svg, encoding="utf-8"); pdf_imgs.append(f.name)
    html = out / "round1_proofs.print.html"
    html.write_text("<!doctype html><html><head><meta charset='utf-8'><style>@page{size:297mm 420mm;margin:0}html,body{margin:0}"
                    "img{display:block;width:297mm;height:420mm;page-break-after:always}</style></head><body>"
                    + "".join(f'<img src="{n}">' for n in pdf_imgs) + "</body></html>")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", "--no-pdf-header-footer",
                    "--virtual-time-budget=20000", f"--print-to-pdf={out / 'round1_proofs_A3.pdf'}", html.as_uri()], check=True, capture_output=True)
    html.unlink()

    # ---------------- score sheet (A4) + CSV template + sealed key + README
    rows = "".join(f"<tr><td class='c'>{it['item']:02d}</td><td>L&nbsp;&nbsp;/&nbsp;&nbsp;R&nbsp;&nbsp;/&nbsp;&nbsp;same</td>"
                   f"<td>1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td>1&nbsp;2&nbsp;3&nbsp;4&nbsp;5</td><td>Y&nbsp;/&nbsp;fix&nbsp;/&nbsp;N</td><td>Y&nbsp;/&nbsp;fix&nbsp;/&nbsp;N</td><td></td></tr>" for it in items)
    sheet = out / "round1_score.print.html"
    sheet.write_text(f"""<!doctype html><html><head><meta charset='utf-8'><style>@page{{size:A4;margin:12mm}}body{{font:10.5pt/1.35 -apple-system,Helvetica,Arial,sans-serif}}
h1{{font-size:14pt;margin:0 0 4mm}}table{{border-collapse:collapse;width:100%}}th,td{{border:0.3mm solid #444;padding:1.6mm 2mm;text-align:left}}th{{font-size:9pt;background:#eee}}
.c{{text-align:center;font-weight:bold}}td:last-child{{width:42mm}}p{{margin:1.5mm 0}}</style></head><body>
<h1>Blind review · round 1 · score sheet</h1>
<p>Name: ______________________ &nbsp; Role: sub-editor / designer / proofreader &nbsp; Date: __________</p>
<p>Each item shows the <b>same paragraph</b>, in the <b>same font and column width</b>, set two ways (LEFT and RIGHT). Judge only how the lines are broken and how the words are spaced:
uneven or very wide gaps, white “rivers”, crowded lines, awkward line ends. Do not discuss with other reviewers. Circle one answer per box.</p>
<p><b>Better:</b> which side would you rather print? &nbsp; <b>Spacing:</b> 1 = distracting gaps or crowding … 5 = even, no problem. &nbsp;
<b>OK to print?</b> Y = yes, fix = only with changes, N = no.</p>
<table><tr><th>Item</th><th>Better</th><th>Spacing LEFT</th><th>Spacing RIGHT</th><th>OK to print? LEFT</th><th>OK to print? RIGHT</th><th>Notes</th></tr>{rows}</table>
</body></html>""", encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={out / 'round1_score_sheet_A4.pdf'}", sheet.as_uri()],
                   check=True, capture_output=True)
    sheet.unlink()
    (out / "score_template.csv").write_text("rater,role,item,better(L/R/same),spacing_left(1-5),spacing_right(1-5),ok_left(Y/fix/N),ok_right(Y/fix/N),notes\n"
                                            + "".join(f",,{it['item']},,,,,,\n" for it in items), encoding="utf-8")
    key = {"seed": SEED, "chosen_policy": chosen, "composer": K3.COMPOSER_VERSION, "font": R.LABEL,
           "note": "A = the paper's published line breaks re-drawn in the stand-in font; B = Pageinator. HOLD THIS FILE AWAY FROM RATERS.",
           "items": [{**it, "width_mm": byid[it["id"]]["width_mm"], "edition_date": byid[it["id"]]["edition_date"],
                      "lines_print": versions[it["id"]]["lines_print"], "lines_pageinator": versions[it["id"]]["lines_ours"],
                      "size_pt": round(versions[it["id"]]["size"], 3), "replay_min_space_factor": round(versions[it["id"]]["replay_min_sf"], 3)} for it in items]}
    (out / "KEY_SEALED.json").write_text(json.dumps(key, indent=1, ensure_ascii=False) + "\n")
    (out / "README.txt").write_text(f"""Blind review, round 1 (PRIVATE: contains the newspaper's text)

What it is: {len(picked)} published paragraphs (from editions the settings were NOT tuned on) set two ways — the paper's own
line breaks and Pageinator's — in the same stand-in font, so reviewers judge only line breaking and word spacing.
{N_REPEAT} items are repeated with sides swapped to check consistency. This is a calibration round, not the G1 gate.

1. Print round1_proofs_A3.pdf on A3 at 100 % ("Actual size"; no "fit to page"). Optional: also on newsprint.
2. Give each reviewer (2 sub-editors + 1 page designer; not the person who keeps the key) a set of sheets and
   round1_score_sheet_A4.pdf. Reviewers work alone and do not discuss.
3. Give KEY_SEALED.json to someone who is not reviewing. Do not open it until all score sheets are back.
4. Type the answers into score_template.csv (one row per reviewer per item; copy the rows for each reviewer) and run:
   python3 experiments/phase0/compose3/analyze_round1.py "{out}"
""", encoding="utf-8")
    for f in out.iterdir():
        f.chmod(0o600)
    print("items", len(picked), "+ repeats", N_REPEAT, "| sheets", len(pages), "| chosen", chosen)
    print("bands", {b: sum(1 for p in picked if lo <= p["width_mm"] < hi) for b, lo, hi in BANDS})


if __name__ == "__main__":
    main()
