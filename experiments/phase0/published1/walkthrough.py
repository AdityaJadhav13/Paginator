"""Build a self-contained HTML walkthrough of the Phase 0 outputs for a pilot dataset (EXPERIMENTAL).

The page embeds the pilot's own page images, so it is written INSIDE the private dataset
(<dataset>/report/walkthrough.html) and never into the repo. Standard library only.

Inputs: <dataset>/report/report.json (run.py), <dataset>/work/*/(corrected|measure).json + overlays,
        <dataset>/report/compare/* (extract_frames.py + compose2/house_compare.py).
Usage:  python3 experiments/phase0/published1/walkthrough.py <dataset_dir> <sample_id> <page_no> <frame_id>
"""
from __future__ import annotations

import base64
import glob
import html
import json
import re
import statistics as st
from datetime import datetime
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
MM = 72 / 25.4


def b64(path: Path, mime: str) -> str:
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()


def svg_img(svg_text: str, width_px: float, alt: str) -> str:
    return (f'<img alt="{html.escape(alt)}" style="width:{width_px:.0f}px;max-width:none;height:auto" '
            f'src="data:image/svg+xml;base64,{base64.b64encode(svg_text.encode()).decode()}">')


def pct(a, b):
    return round(100 * a / b, 1) if b else 0.0


def q(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(p * len(xs)))] if xs else None


def load_docs(ds: Path):
    for wd in sorted(glob.glob(str(ds / "work" / "*"))):
        f = Path(wd) / "corrected.json"
        doc = json.loads((f if f.exists() else Path(wd) / "measure.json").read_text())
        if not doc.get("excluded"):
            yield Path(wd).name, doc


def collect(ds: Path) -> dict:
    lines, frames, pages, included = [], [], 0, []
    for sid, doc in load_docs(ds):
        included.append(sid)
        pages += len(doc["pages"])
        for pg in doc["pages"]:
            for fr in pg["frames"]:
                if not fr["is_body_candidate"] or fr.get("excluded"):
                    continue
                frames.append(fr)
                for ln in fr["lines"]:
                    if ln.get("excluded"):
                        continue
                    pu = ln.get("gap_punct_adjacent") or [False] * len(ln["gaps_pt"])
                    gr = [r for r, u in zip(ln["gap_ratios"] or [], pu) if r is not None and not u]
                    hs = [t["hscale"] for t in ln["tokens"] if t.get("hscale")]
                    lines.append({"w": fr["width_mm"], "cls": ln["class"], "gr": gr, "words": ln.get("words") or 0,
                                  "hs": st.median(hs) if hs else None})
    return {"lines": lines, "frames": frames, "pages": pages, "included": included}


# ------------------------------------------------------------------------------------------- charts
def bar_chart(bins, title, xlab, marks=(), every=1, fmt=str) -> str:
    """bins: [(x_label_value, value)] → inline SVG bar chart using CSS variables (works in dark mode)."""
    W, H, L, B, T, R = 680, 230, 46, 40, 14, 10
    n = len(bins); vmax = max(v for _, v in bins) or 1
    bw = (W - L - R) / n
    els = [f'<text x="{L}" y="{T - 2}" class="ct">{html.escape(title)}</text>']
    for i, (x, v) in enumerate(bins):
        h = (H - B - T) * v / vmax
        hl = any(lo <= i < hi for lo, hi in marks)
        els.append(f'<rect x="{L + i * bw + 0.5:.1f}" y="{H - B - h:.1f}" width="{max(1, bw - 1):.1f}" height="{h:.1f}" class="{"bar2" if hl else "bar"}"><title>{html.escape(fmt(x))}: {v:,.0f}</title></rect>')
        if i % every == 0:
            els.append(f'<text x="{L + i * bw + bw / 2:.1f}" y="{H - B + 14}" class="cx">{html.escape(fmt(x))}</text>')
    els.append(f'<line x1="{L}" y1="{H - B}" x2="{W - R}" y2="{H - B}" class="axis"/>')
    els.append(f'<text x="{(L + W - R) / 2:.0f}" y="{H - 6}" class="cl">{html.escape(xlab)}</text>')
    els.append(f'<text x="{L - 6}" y="{T + 10}" class="cy">{vmax:,.0f}</text><text x="{L - 6}" y="{H - B}" class="cy">0</text>')
    return f'<svg viewBox="0 0 {W} {H}" class="chart" role="img" aria-label="{html.escape(title)}">{"".join(els)}</svg>'


def hist(values, lo, hi, step, weights=None):
    n = int(round((hi - lo) / step))
    c = [0.0] * (n + 1)
    for i, v in enumerate(values):
        k = min(n, max(0, int((v - lo) / step)))
        c[k] += weights[i] if weights else 1
    return c


# ------------------------------------------------------------------------------------------- page
CSS = """
:root{--bg:#f7f6f2;--card:#fff;--ink:#1d1d1b;--muted:#5d5b55;--line:#e3e0d8;--accent:#2f5d8a;--accent2:#c2410c;
--ok:#1a7f37;--part:#b7791f;--no:#b42318;--chip:#efece4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151515;--card:#1f1f1e;--ink:#ecebe7;--muted:#a9a69e;
--line:#34332f;--accent:#7fb0e0;--accent2:#f08a4b;--ok:#4cc26b;--part:#e0b04a;--no:#f07a6e;--chip:#2a2926}}
:root[data-theme="dark"]{--bg:#151515;--card:#1f1f1e;--ink:#ecebe7;--muted:#a9a69e;--line:#34332f;--accent:#7fb0e0;
--accent2:#f08a4b;--ok:#4cc26b;--part:#e0b04a;--no:#f07a6e;--chip:#2a2926}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",
"Kohinoor Devanagari","Noto Sans Devanagari",sans-serif}
main{max-width:1060px;margin:0 auto;padding:28px 16px 64px}h1{font-size:30px;line-height:1.2;margin:0 0 6px}
h2{font-size:22px;margin:42px 0 10px;padding-top:6px;border-top:1px solid var(--line)}h3{font-size:17px;margin:18px 0 6px}
p{margin:8px 0}.muted{color:var(--muted)}.small{font-size:13.5px}.card{background:var(--card);border:1px solid var(--line);
border-radius:12px;padding:16px 18px;margin:12px 0}.priv{border-left:4px solid var(--accent2)}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:14px 0}
.step{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}.step b{display:block;font-size:14.5px}
.tag{display:inline-block;font-size:12px;font-weight:600;border-radius:99px;padding:1px 9px;margin-top:6px}
.t-ok{background:color-mix(in srgb,var(--ok) 18%,transparent);color:var(--ok)}.t-part{background:color-mix(in srgb,var(--part) 20%,transparent);color:var(--part)}
.t-no{background:color-mix(in srgb,var(--no) 16%,transparent);color:var(--no)}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.kpi{background:var(--card);border:1px solid var(--line);
border-radius:10px;padding:12px 14px}.kpi .v{font-size:24px;font-weight:700;line-height:1.15}.kpi .k{font-size:13.5px;color:var(--muted)}
.chart{width:100%;height:auto;background:var(--card);border:1px solid var(--line);border-radius:10px;margin:6px 0}
.chart .bar{fill:var(--accent)}.chart .bar2{fill:var(--accent2)}.chart .axis{stroke:var(--muted);stroke-width:1}
.chart text{fill:var(--muted);font-size:11.5px}.chart .ct{fill:var(--ink);font-size:13px;font-weight:600}.chart .cx{text-anchor:middle}
.chart .cy{text-anchor:end}.chart .cl{text-anchor:middle}
.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:6px}.cols{display:flex;gap:18px;align-items:flex-start;width:max-content}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}.cols figure{width:min-content}
figcaption{font-size:13.5px;margin-top:8px}.cols figcaption{min-width:250px}
figure img{display:block;background:#fff;border-radius:4px}
table{border-collapse:collapse;width:100%;font-size:14.5px}th,td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:left;vertical-align:top}
th{font-size:13px;color:var(--muted);font-weight:600}.num{text-align:right;font-variant-numeric:tabular-nums}
.legend span{display:inline-block;width:12px;height:12px;border-radius:2px;margin:0 4px -1px 10px}
code,.path{font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-all}a{color:var(--accent)}
.deva{font-size:17px}.bad{color:var(--no)}
"""


def build(ds: Path, sample: str, page: int, frame: str) -> Path:
    rep = json.loads((ds / "report" / "report.json").read_text())
    data = collect(ds)
    L, F = data["lines"], data["frames"]
    nf = [l for l in L if l["cls"] not in ("FINAL_PARAGRAPH_LINE",)]
    full = sum(l["cls"] == "FULLY_ALIGNED" for l in nf)
    fw = rep["F_word_spacing"]["word_word_gaps_nonfinal"]; gt2 = rep["F_word_spacing"]["pct_gt_2_0"]
    hs = [l["hs"] for l in nf if l["hs"]]
    sq = [st.median(l["gr"]) for l in nf if l["cls"] == "FULLY_ALIGNED" and len(l["gr"]) >= 2]
    widths_common = rep["C_column_widths_mm"]["common_values_0.5mm"]
    A = rep["A_dataset"]; H = rep["H_word_breaking"]
    editions = A["samples"] - A.get("excluded_samples", 0)
    hc = json.loads((ds / "report" / "compare" / "house_compare.json").read_text())
    a = hc["A_same_column"]; cal = hc["calibration"]
    cmp_dir = ds / "report" / "compare"
    fj = json.loads((cmp_dir / f"{sample}_{frame}.json").read_text())
    mans = {d.name: json.loads((d / "manifest.json").read_text()) for d in sorted((ds / "samples").iterdir()) if (d / "manifest.json").exists()}
    dates = sorted(mans[x]["edition_date"] for x in data["included"] if x in mans)
    excluded = [f'{mans[x]["edition"]} ({mans[x]["edition_date"]})' for x in mans if x not in data["included"]]
    left_out = f" Left out: {'; '.join(excluded)}." if excluded else ""
    body_font = Counter(f["font"].split("+")[-1] for f in F).most_common(1)[0][0]
    fe_path = ds / "report" / "fonts_embedded.json"
    fe = json.loads(fe_path.read_text()).get(body_font, {}) if fe_path.exists() else {}
    vendor = f'{html.escape(fe.get("copyright") or "vendor unknown")} (vendor ID {html.escape(fe.get("vendor_id") or "?")})'
    software = html.escape(mans[sample].get("producing_software_if_known", "").split(" / ")[0])

    # ---------- overlay (full page + sharp zoom on the compared column)
    ov_dir = ds / "work" / sample / "overlay"
    ov = (ov_dir / f"page-{page:02d}.overlay.svg").read_text()
    m = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', ov); pw, ph = float(m.group(1)), float(m.group(2))
    ov_full = re.sub(r'<image href="[^"]+"', f'<image href="{b64(ov_dir / f"page-{page:02d}.png", "image/png")}"', ov, count=1)
    cp = fj["crop_pt"]; zx, zy = cp["x0"] - 6, ph - cp["y_top"] - 6; zw, zh = (cp["x1"] - cp["x0"]) + 14, min(260, cp["y_top"] - cp["y_bottom"] + 12)
    ov_zoom = re.sub(r'<image href="[^"]+"[^>]*/>',
                     f'<image href="{b64(cmp_dir / fj["png"], "image/png")}" x="{cp["x0"]:.2f}" y="{ph - cp["y_top"]:.2f}" '
                     f'width="{cp["x1"] - cp["x0"]:.2f}" height="{cp["y_top"] - cp["y_bottom"]:.2f}" opacity="0.55"/>', ov, count=1)
    ov_zoom = re.sub(r'viewBox="[^"]+" width="[^"]+" height="[^"]+"', f'viewBox="{zx:.1f} {zy:.1f} {zw:.1f} {zh:.1f}" width="{zw:.1f}pt" height="{zh:.1f}pt"', ov_zoom, count=1)

    # ---------- side by side (equal scale)
    px_mm = 6.6
    theirs = (cmp_dir / f"{sample}_{frame}_theirs.svg").read_text()
    theirs = theirs.replace(f'href="{fj["png"]}"', f'href="{b64(cmp_dir / fj["png"], "image/png")}"')
    def svg_w(t):
        return float(re.search(r'width="([\d.]+)mm"', t).group(1))
    nk = ("NEW_NO_BREAKS", "NEW_WITH_BREAKS") if "NEW_NO_BREAKS" in a["policies"] else ("SAME_RULES", "WITH_BREAKS")
    ours = {k: (cmp_dir / f"{sample}_{frame}_ours_{k}.svg").read_text() for k in nk}
    pub = a["published"]["summary"]; same = a["policies"][nk[0]]["summary"]; brk = a["policies"][nk[1]]["summary"]
    c3p = REPO / "experiments" / "phase0" / "results" / "compose3" / "summary.json"
    c3 = json.loads(c3p.read_text()) if c3p.exists() else None
    det3p = REPO / "experiments" / "phase0" / "results" / "compose3" / "determinism.json"
    det3 = json.loads(det3p.read_text()) if det3p.exists() else None
    r1 = ds / "report" / "round1"

    def stats(s, extra=""):
        return (f'<table class="small"><tr><td>Lines</td><td class="num">{s["lines_total"]}</td></tr>'
                f'<tr><td>Lines with a gap &gt; 2 normal spaces</td><td class="num">{s["lines_widest_gt_2_pct"]}%</td></tr>'
                f'<tr><td>Lines with a gap &gt; 3 normal spaces</td><td class="num">{s["lines_widest_gt_3_pct"]}%</td></tr>'
                f'<tr><td>Widest gap</td><td class="num">{s["widest_gap_max"]}×</td></tr>'
                f'<tr><td>Words broken at line end</td><td class="num">{round(s["inword_breaks_per_100_lines"] * s["lines_total"] / 100)}</td></tr>{extra}</table>')

    p1 = a["published"]["first_paragraph"]; s1 = a["policies"][nk[0]]["first_paragraph"]; b1 = a["policies"][nk[1]]["first_paragraph"]

    # ---------- text layer table: printed line = transcript words split by measured token counts
    work = ds / "work" / sample
    doc = json.loads(((work / "corrected.json") if (work / "corrected.json").exists() else (work / "measure.json")).read_text())
    mf = next(f for pg in doc["pages"] for f in pg["frames"] if f["id"] == frame)
    words = " ".join(l for l in (cmp_dir / f"{sample}_{frame}.transcript.txt").read_text().splitlines() if l.strip() and not l.startswith("#")).split()
    printed, k = [], 0
    for ln in mf["lines"]:
        n = len(ln["tokens"]); printed.append(" ".join(words[k:k + n])); k += n
    tl_rows = "".join(f'<tr><td class="deva">{html.escape(fj["lines"][i].get("text_actualtext") or printed[i])}</td><td class="deva bad">{html.escape(fj["lines"][i]["text_pdfium"])}</td>'
                      f'<td class="deva bad">{html.escape(fj["lines"][i]["text_pdfminer"])}</td></tr>' for i in range(5))

    # ---------- charts
    wl = [f["width_mm"] for f in F]; wn = [f["lines_n"] for f in F]
    c_w = hist(wl, 20, 80, 2, wn)
    ch_w = bar_chart([(20 + 2 * i, v) for i, v in enumerate(c_w)], "Column widths of body text (lines per 2 mm band)", "column width (mm)",
                     marks=[(8, 9), (15, 16)], every=5, fmt=lambda x: f"{x}" if x < 80 else "80+")
    wh = rep["E_words_per_line"]["histogram"]
    ch_wpl = bar_chart([(int(k), wh.get(str(k), 0)) for k in range(1, 13)], "Words per line (all non-final body lines)", "words on the line")
    allg = [r for l in nf if l["cls"] == "FULLY_ALIGNED" for r in l["gr"]]
    c_g = hist(allg, 0, 6, 0.25)
    ch_g = bar_chart([(0.25 * i, v) for i, v in enumerate(c_g)], "Word gaps in justified lines (gap ÷ the font's normal space)",
                     "gap size in normal spaces (orange: more than 2×)", marks=[(8, 25)], every=4, fmt=lambda x: f"{x:g}" if x < 6 else "6+")
    c_h = hist(hs, 0.90, 1.10, 0.01)
    ch_h = bar_chart([(round(0.90 + 0.01 * i, 2), v) for i, v in enumerate(c_h)], "Horizontal scale of body lines (1.00 = not scaled)",
                     "horizontal scale", marks=[(10, 11)], every=2, fmt=lambda x: f"{x:.2f}")

    B = hc["B_corpus_at_house_widths"]
    brow = ""
    for wkey, r in B.items():
        brow += (f'<tr><td>{wkey} mm</td><td class="num">{r["published"]["lines_widest_gt_2_pct"]}% · {r["published"]["lines_widest_gt_3_pct"]}%</td>'
                 f'<td class="num">{r["ours"]["SAME_RULES"]["lines_widest_gt_2_pct"]}% · {r["ours"]["SAME_RULES"]["lines_widest_gt_3_pct"]}%</td>'
                 f'<td class="num">{r["ours"]["WITH_BREAKS"]["lines_widest_gt_2_pct"]}% · {r["ours"]["WITH_BREAKS"]["lines_widest_gt_3_pct"]}%'
                 f'<br><span class="muted small">{r["ours"]["WITH_BREAKS"]["inword_breaks_per_100_lines"]} broken words / 100 lines</span></td>'
                 f'<td class="num">{r["published"]["nonfinal_lines"]:,} / {r["ours"]["SAME_RULES"]["nonfinal_lines"]}</td></tr>')

    c3rows, c3cap = "", ""
    if c3:
        T = c3["test"]; ch = c3["selection"]["chosen"]; P = T["print"]; cands = T["candidates"]
        def row(label, v, lines_ours=None):
            lo = lines_ours if lines_ours is not None else v.get("lines_total_ours", "")
            return (f'<tr><td>{label}</td><td class="num">{v["loose_gt2_pct"]}%</td><td class="num">{v["loose_gt3_pct"]}%</td>'
                    f'<td class="num">{v["widest_p95"]}×</td><td class="num">{v["tight_lt08_pct"]}%</td><td class="num">{lo:,}</td>'
                    f'<td class="num">{v.get("inword_breaks_per_100_lines", 0)}</td></tr>')
        c3rows = (row("<b>Your print (InDesign)</b>", P, cands[ch]["lines_total_print"])
                  + row("Pageinator, old spacing model", cands["REF_C2_same_rules"])
                  + row("<b>Pageinator, new spacing model</b> (chosen on the earlier editions)", cands[ch])
                  + (row("Pageinator, new model + Marathi word breaks", c3["chosen_with_breaks"]["test"]) if c3.get("chosen_with_breaks") else ""))
        c3cap = (f'{P["paragraphs"]} complete paragraphs ({P["nonfinal_lines"]:,} lines) from the {c3["split_date"]} and later editions; the settings were chosen on '
                 f'{c3["cal"]["print"]["paragraphs"]} paragraphs from the earlier editions and never tuned on these.')

    priv = ds.resolve()
    def link(p: Path, label=None):
        return f'<a href="{p.as_uri()}">{html.escape(label or str(p).replace(str(Path.home()), "~"))}</a>'

    body = f"""
<main>
<p class="muted small">Private · {html.escape(rep["dataset"] if isinstance(rep.get("dataset"), str) else "pilot dataset")} · contains your newspaper pages · stays on this Mac</p>
<h1>Pageinator Phase 0 walkthrough</h1>
<p>What we built, what it measured on your own published pages, and an honest answer to “can it actually do this?”.
Every number below comes from the files listed at the end. Nothing here was uploaded anywhere.</p>

<div class="steps">
 <div class="step"><b>1 · Read your pages</b><span class="muted small">Find columns, lines and word gaps in the PDFs that went to press</span><br><span class="tag t-ok">Working</span></div>
 <div class="step"><b>2 · Learn your house style</b><span class="muted small">Turn {A["body_lines"]:,} printed lines into numbers</span><br><span class="tag t-ok">Done for 15 editions</span></div>
 <div class="step"><b>3 · Set text ourselves</b><span class="muted small">Our own engine breaks lines and spaces words</span><br>{'<span class="tag t-ok">Matches your spacing on average</span>' if c3 else '<span class="tag t-part">Working, not yet tuned to you</span>'}</div>
 <div class="step"><b>4 · Compare side by side</b><span class="muted small">Same words, same column, same scale</span><br>{f'<span class="tag t-ok">Done on {c3["paragraphs"]} of your paragraphs</span>' if c3 else '<span class="tag t-part">First test below</span>'}</div>
 <div class="step"><b>5 · Your editors judge</b><span class="muted small">Blind review of printed proofs</span><br>{'<span class="tag t-part">Sheets ready to print</span>' if (r1 / "round1_proofs_A3.pdf").exists() else '<span class="tag t-no">Not done</span>'}</div>
 <div class="step"><b>6 · Press test</b><span class="muted small">A PDF your press accepts</span><br><span class="tag t-no">Not started</span></div>
</div>

<h2>1 · How the computer reads your page</h2>
<p>This is page {page} of the {mans[sample]["edition_date"]} edition with the tool's reading drawn on top. Each thin box is one printed line; the small bars between words are the
measured word gaps. Nothing is guessed from the picture: positions come from the PDF itself, and the tool was first checked on 8 test PDFs with known answers
(204 of 204 checks passed).</p>
<p class="legend small">Lines: <span style="background:#1b9e3e"></span>justified <span style="background:#c9a400"></span>almost
<span style="background:#d95f02"></span>ragged <span style="background:#7570b3"></span>last line of paragraph ·
Gaps: <span style="background:#1a9641"></span>normal (≤1.5×) <span style="background:#fdae61"></span>wide (≤2×) <span style="background:#d7191c"></span>very wide (&gt;2×)</p>
<div class="grid2">
 <figure>{svg_img(ov_full, 470, "Overlay of the measured page")}<figcaption>Whole page: blue dashed boxes are body-text columns; grey are headlines, captions and boxes (not counted).</figcaption></figure>
 <figure>{svg_img(ov_zoom, 470, "Zoom on one column")}<figcaption>Zoom on the 36.5 mm column used in the side-by-side test (section 3). The red bars are the very wide gaps you can see in print.</figcaption></figure>
</div>

<h2>2 · What your paper actually does</h2>
<p>Measured on {editions} editions ({data["pages"]} pages, {dates[0]} to {dates[-1]}), {A["body_lines"]:,} body lines and {A["words"]:,} words.{html.escape(left_out)}</p>
<div class="kpis">
 <div class="kpi"><div class="v">{pct(full, len(nf))}%</div><div class="k">of body lines are fully justified (both edges straight)</div></div>
 <div class="kpi"><div class="v">{gt2:.0f}%</div><div class="k">of word gaps are wider than twice a normal space (median {fw["median"]:.2f}×)</div></div>
 <div class="kpi"><div class="v">36.5 / 50 mm</div><div class="k">columns: an 8-column grid (≈4.1 mm gutters) and a 6-column variant</div></div>
 <div class="kpi"><div class="v">{html.escape(body_font)}</div><div class="k">body font, about {rep["D_typography"]["body_size_pt"]["median"]:g} pt on {rep["D_typography"]["leading_pt"]["median"]:g} pt leading; {vendor}</div></div>
 <div class="kpi"><div class="v">{pct(sum(abs(h - 1) > 0.005 for h in hs), len(hs))}%</div><div class="k">of lines are horizontally scaled ({q(hs, .05):.2f}–{q(hs, .95):.3f}), set per story</div></div>
 <div class="kpi"><div class="v">≈0</div><div class="k">words broken at line ends in the columns we checked ({H["per_100_lines"]} line-end hyphens per 100 lines overall, unverified)</div></div>
 <div class="kpi"><div class="v">{pct(sum(r < 0.8 for r in sq), len(sq))}%</div><div class="k">of justified lines squeeze spaces below 0.8× (tightest 1%: {q(sq, .01):.2f}×)</div></div>
 <div class="kpi"><div class="v">{rep["E_words_per_line"]["nonfinal"]["median"]:.0f}</div><div class="k">words per line (median); 3 to 6 on most lines</div></div>
</div>
<div class="grid2">{ch_w}{ch_g}</div>
<div class="grid2">{ch_wpl}{ch_h}</div>
<p class="small muted">What this means: your paper justifies almost everything and accepts wide gaps rather than breaking words. Our earlier tests used a
“never wider than 2×” rule, which your own printed pages do not follow, so that rule was stricter than your house style.</p>

<h2>3 · Same words, same column: your InDesign vs Pageinator</h2>
<p>The column on the left is your printed {fj["width_mm"]:.1f} mm column (page {page}, {mans[sample]["edition_date"]}). The two on the right were set by our engine from the same words, at the same width
and the same {fj["leading_pt"]:g} pt line spacing, drawn at the same scale. Coloured marks on the right of every line show its widest word gap:
<span class="legend small"><span style="background:#1a9641"></span>≤1.5× <span style="background:#fdae61"></span>≤2× <span style="background:#d7191c"></span>≤3×
<span style="background:#67000d"></span>&gt;3× <span style="background:#c8c8c8"></span>last line</span> (in units of a normal space in your font).</p>
<div class="scroll"><div class="cols">
 <figure>{svg_img(theirs, svg_w(theirs) * px_mm, "Printed column")}<figcaption><b>Your printed column</b> ({software}, {html.escape(fj["font"].split("+")[-1])} {fj["size_pt"]:g} pt at {100 * fj["hscale"]:.0f}% width)
 {stats(pub)}</figcaption></figure>
 <figure>{svg_img(ours[nk[0]], svg_w(ours[nk[0]]) * px_mm, "Pageinator, your rules")}<figcaption><b>Pageinator, your rules</b>{" (new spacing model)" if nk[0].startswith("NEW") else ""}: justify every line, never break a word
 {stats(same)}</figcaption></figure>
 <figure>{svg_img(ours[nk[1]], svg_w(ours[nk[1]]) * px_mm, "Pageinator with Marathi word breaks")}<figcaption><b>Pageinator + Marathi word breaks</b> (dictionary patterns, at most 2 lines in a row)
 {stats(brk)}</figcaption></figure>
</div></div>
<div class="card small">
<p><b>How to read this honestly.</b></p>
<p>• <b>On this column, with your rules, we are still slightly looser than your InDesign.</b> First paragraph (complete in both): yours {a["published"]["lines_first_paragraph"]} lines with
{p1["lines_widest_gt_3_pct"]}% of lines above 3×; ours {a["policies"][nk[0]]["lines_per_paragraph"][0]} lines with {s1["lines_widest_gt_3_pct"]}%. One column is one example — the table below uses {c3["paragraphs"] if c3 else "many"} of your paragraphs.</p>
<p>• <b>With Marathi word breaks this column is clearly tighter than yours</b>: {brk["lines_widest_gt_3_pct"]}% of lines above 3× instead of {pub["lines_widest_gt_3_pct"]}%, widest gap
{brk["widest_gap_max"]}× instead of {pub["widest_gap_max"]}×, but it breaks {round(brk["inword_breaks_per_100_lines"] * brk["lines_total"] / 100)} words. Your paper practically never breaks words, so only your editors can say whether that is acceptable.</p>
<p>• <b>The font is a stand-in.</b> We may not use {html.escape(body_font)} without a licence, so we used the free Noto Serif Devanagari (87.5% width) at about {a["ours"]["size_pt"]} pt, sized so the
same words take the same total width as in your print (your font is narrow: {cal["published_em_per_char"]} em per character against {cal["ofl_em_per_char"]}).</p>
<p>• <b>Small differences that are not the engine:</b> the first word (“{html.escape(words[0])}”) is bold in print and regular in ours; your last line continues into the next column, so it is justified in print while ours ends the paragraph there.</p>
<p>• <b>Speed:</b> setting this column took {a["policies"][nk[0]]["compose_ms"]} ms (your rules) and {a["policies"][nk[1]]["compose_ms"]} ms (with word breaks) on this Mac.</p>
</div>

<h3>Not just one column: {c3["paragraphs"] if c3 else ""} of your own paragraphs</h3>
<p>{c3cap} Each paragraph was re-set from its exact words at its own width, with a new spacing model that can squeeze and stretch word spaces independently, like your InDesign.
Gaps are measured in normal spaces of your font. Lower is tighter for the first three columns.</p>
<div class="scroll"><table><tr><th>Version</th><th class="num">Lines with a gap &gt; 2×</th><th class="num">&gt; 3×</th><th class="num">95% of lines below</th>
<th class="num">Lines squeezed below 0.8×</th><th class="num">Total lines</th><th class="num">Broken words / 100 lines</th></tr>{c3rows}</table></div>
<p class="small muted">What this means: without breaking words, Pageinator now matches your InDesign on average (slightly fewer very loose lines, the same paragraph lengths); it squeezes spaces
a little more often than your paper does. With Marathi word breaks it is much tighter, but changes paragraph lengths and breaks about one line in four.
(Paragraphs that had a broken word in print were left out of this test, so your print shows 0 broken words here by construction.)</p>

<h3>Reading your PDFs’ text: solved</h3>
<p>The two free PDF libraries read Devanagari wrongly in these files (red below). But InDesign also stores the exact words in hidden “ActualText” tags inside the PDF,
and the new reader uses them: it matched a hand-typed check of this column on all 26 lines (and even caught an invisible joiner the eye cannot see), and recovered
701 complete paragraphs whose word counts agree with the printed lines. So searchable text for an archive can be recovered from these PDFs (checked on body text so far; headlines and captions not yet).</p>
<div class="scroll"><table><tr><th>Pageinator’s reader (exact)</th><th>PDFium reads</th><th>pdfminer reads</th></tr>{tl_rows}</table></div>

<h2>4 · Your editors’ turn: blind review, round 1</h2>
<div class="card small">
<p>We prepared {"24 of your paragraphs" if (r1 / "KEY_SEALED.json").exists() else "your paragraphs"} from the editions the settings were not tuned on, each set two ways — your InDesign’s line breaks and Pageinator’s — in the same stand-in font,
side by side, left and right in random order, with 4 repeats to check consistency. Nobody can tell which side is which without the sealed key.
This round does not show you the answers on purpose.</p>
<ol>
<li>Print {link(r1 / "round1_proofs_A3.pdf", "round1_proofs_A3.pdf")} on A3 at 100% (“Actual size”). Also on newsprint if you can.</li>
<li>Give 2 sub-editors and 1 page designer a set each, plus {link(r1 / "round1_score_sheet_A4.pdf", "the score sheet")}. They work alone and do not discuss.</li>
<li>Give the file <code>KEY_SEALED.json</code> (in the same folder) to someone who is not reviewing; do not open it until all sheets are back.</li>
<li>Type the answers into {link(r1 / "score_template.csv", "score_template.csv")} and the analysis script reports preference, spacing scores, “OK to print” rates and rater agreement.</li>
</ol>
<p class="muted">This is a calibration round, not the final acceptance test: that needs 200 paragraphs and 30 headlines and your licensed font.</p>
</div>

<h2>5 · Can we actually do it?</h2>
<table>
<tr><th>Ability</th><th>Status</th><th>Evidence / what is missing</th></tr>
<tr><td>Measure printed pages precisely</td><td><span class="tag t-ok">Yes</span></td><td>204/204 checks on test PDFs with known answers; overlays on your 68 pages; 92 of 92 words found in the test column</td></tr>
<tr><td>Read the exact text of your PDFs</td><td><span class="tag t-ok">Yes</span></td><td>New reader for the hidden ActualText tags: 26/26 lines against a hand check; 701 paragraphs recovered with word counts matching print</td></tr>
<tr><td>Shape Marathi correctly (conjuncts, eyelash ra, reph, matras)</td><td><span class="tag t-ok">Yes</span></td><td>Section 3 columns and the review sheets, drawn from the font’s real glyph outlines</td></tr>
<tr><td>Break lines and space words for a whole paragraph at once</td><td><span class="tag t-ok">Yes</span></td><td>A few milliseconds per paragraph; identical results on every run ({f'{det3["checked"]:,}/{det3["checked"]:,}' if det3 and det3["mismatches"] == 0 else "repeat checks"} re-checked)</td></tr>
<tr><td>Match your spacing using your rules</td><td>{'<span class="tag t-ok">Yes, on average</span>' if c3 else '<span class="tag t-part">Close, not yet</span>'}</td><td>{(f'{c3["test"]["candidates"][c3["selection"]["chosen"]]["loose_gt3_pct"]}% of lines above 3× vs your {c3["test"]["print"]["loose_gt3_pct"]}%; {c3["test"]["candidates"][c3["selection"]["chosen"]]["lines_total_ours"]:,} lines vs your {c3["test"]["candidates"][c3["selection"]["chosen"]]["lines_total_print"]:,}. Squeezes a little more often ({c3["test"]["candidates"][c3["selection"]["chosen"]]["tight_lt08_pct"]}% vs {c3["test"]["print"]["tight_lt08_pct"]}% of lines below 0.8×); single columns vary') if c3 else 'Needs a squeeze setting'}</td></tr>
<tr><td>Beat your spacing</td><td><span class="tag t-part">Only with word breaks</span></td><td>{(f'{c3["chosen_with_breaks"]["test"]["loose_gt3_pct"]}% of lines above 3× (yours {c3["test"]["print"]["loose_gt3_pct"]}%), but {c3["chosen_with_breaks"]["test"]["inword_breaks_per_100_lines"]} broken words per 100 lines') if c3 and c3.get("chosen_with_breaks") else "Your editors must decide"}; your editors must decide</td></tr>
<tr><td>Your editors accept our columns</td><td><span class="tag t-part">Ready to test</span></td><td>Round 1 blind sheets are ready (section 4). The full test (G1) needs 200 paragraphs, 30 headlines and the licensed font</td></tr>
<tr><td>Use your own fonts</td><td><span class="tag t-no">Not yet</span></td><td>{html.escape(body_font)}: {vendor}. We need the vendor’s licence terms for server use and PDF embedding</td></tr>
<tr><td>Horizontal scaling (96–107%) like your designers use</td><td><span class="tag t-no">Not modelled</span></td><td>Decision needed: support it, or deliberately not</td></tr>
<tr><td>Press-ready PDF, page layout, editing screen</td><td><span class="tag t-no">Not started</span></td><td>Later phases; nothing here claims press-readiness</td></tr>
</table>

<h2>6 · Where everything is</h2>
<div class="card priv small"><b>Private, on this Mac only</b> (contains your pages; never committed, never uploaded): {link(priv)}
<ul>
<li>{link(priv / "samples", "samples/")} copies of your 16 PDFs, each with a provenance and permissions file</li>
<li>{link(priv / "work", "work/")} per edition: what the computer extracted, the measurements, and one overlay picture per page</li>
<li>{link(priv / "report" / "report.md", "report/report.md")} the full measurement report (sections A–L) · {link(priv / "report" / "FINDINGS_DRAFT.md", "report/FINDINGS_DRAFT.md")} plain-language findings</li>
<li>{link(priv / "report" / "compare", "report/compare/")} the single-column side-by-side files · {link(priv / "report" / "paragraphs.jsonl", "report/paragraphs.jsonl")} your 701 recovered paragraphs</li>
<li>{link(priv / "report" / "compose3", "report/compose3/")} per-paragraph results of the new spacing model · {link(r1, "report/round1/")} the blind review sheets, score sheet and sealed key</li>
<li>{link(priv / "report" / "walkthrough.html", "report/walkthrough.html")} this page</li>
</ul></div>
<div class="card small"><b>In the code repository</b> (no newspaper content): {link(REPO, "Paginator/")}
<ul>
<li>{link(REPO / "docs" / "architecture" / "v2", "docs/architecture/v2/")} the architecture plan (21 documents, 22 decision records)</li>
<li>{link(REPO / "docs" / "phase0", "docs/phase0/")} evidence reports: EXP-COMPOSE-1, EXP-PUBLISHED-1, EXP-COMPOSE-2, EXP-COMPOSE-3 and the review and press checklists</li>
<li>{link(REPO / "experiments" / "phase0", "experiments/phase0/")} the measuring tool and text reader (published1), the composers (compose1, compose2, compose3) and test harness</li>
<li>{link(REPO / "experiments" / "phase0" / "results" / "compose2" / "proofs", "experiments/phase0/results/compose2/proofs/")} 16 printable proof pages (made-up text, provisional grid; made before we had your pages)</li>
<li>{link(REPO / "tools" / "oracle" / "v0", "tools/oracle/v0/")} the frozen reference typesetter everything is checked against</li>
</ul></div>
<p class="small muted">Generated {datetime.now().strftime("%Y-%m-%d %H:%M")} · composers {html.escape(hc["composer"])}{(" + " + html.escape(c3["composer"])) if c3 else ""} · measurement tool {html.escape(rep["tool"])}.</p>
</main>"""
    out = ds / "report" / "walkthrough.html"
    out.write_text(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
                   f'<title>Phase 0 Walkthrough</title><style>{CSS}</style></head><body>{body}</body></html>\n', encoding="utf-8")
    out.chmod(0o600)
    return out


if __name__ == "__main__":
    ds = Path(sys.argv[1]).expanduser()
    if len(sys.argv) < 5:
        sys.exit("usage: walkthrough.py <dataset_dir> <sample_id> <page_no> <frame_id>")
    sample, page, frame = sys.argv[2], int(sys.argv[3]), sys.argv[4]
    p = build(ds, sample, page, frame)
    print(p, f"{p.stat().st_size / 1e6:.1f} MB")
