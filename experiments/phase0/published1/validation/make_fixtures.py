"""Build GROUND-TRUTH TOOL VALIDATION FIXTURES for EXP-PUBLISHED-1 (EXPERIMENTAL).

Each fixture = an HTML page with KNOWN geometry (page size, column x/width, font, size, leading,
alignment, word-spacing, letter-spacing, horizontal scaling, manual hyphenation), printed to PDF by
headless Chrome, plus a DOM-derived ground-truth JSON (word rectangles) from the SAME layout.

These fixtures validate the MEASUREMENT TOOL only. They are NOT published newspaper evidence and must
never enter a pilot dataset. Text = Phase 0 internally-authored corpus (fictional).

Fonts: static OFL fonts from the frozen oracle assets (read-only): Mukta, Tiro Devanagari Hindi.

Usage: experiments/phase0/published1/.venv/bin/python experiments/phase0/published1/validation/make_fixtures.py
"""
from __future__ import annotations

import hashlib
import html
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
BUILD = HERE / "build"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FONTS = REPO / "tools/oracle/v0/assets/fonts/devanagari"
CORPUS = json.loads((REPO / "fixtures/typeset/v1/corpus/texts.json").read_text())["texts"]
MR = [t["text"] for t in CORPUS if t["kind"] == "body" and t["lang"] == "mr"]
CLASS = "GROUND_TRUTH_TOOL_VALIDATION_FIXTURE"


def words_html(text: str, shy: bool = False) -> str:
    out = []
    for w in text.split(" "):
        e = html.escape(w)
        if shy:
            # deterministic manual break opportunity: after the 2nd Devanagari base letter of long words
            bases = [m.start() for m in re.finditer(r"[क-हअ-औ]", w)]
            if len(bases) >= 5:
                k = bases[2]
                e = html.escape(w[:k]) + "&shy;" + html.escape(w[k:])
        out.append(f'<span class="w">{e}</span>')
    return " ".join(out)


def page(name, page_mm, columns, css_extra="", text_fn=None) -> dict:
    """columns: list of dicts with x,y,w,h (mm), font, size_pt, lead_pt, align, ws_ratio, ls_pt, sx, shy, paras."""
    cols_html = []
    for i, c in enumerate(columns):
        paras = "".join(f"<p>{words_html(p, c.get('shy', False))}</p>" for p in c["paras"])
        style = (f"left:{c['x']}mm;top:{c['y']}mm;width:{c['w']}mm;height:{c['h']}mm;"
                 f"font-family:'{c['font']}';font-size:{c['size_pt']}pt;line-height:{c['lead_pt']}pt;"
                 f"text-align:{c['align']};letter-spacing:{c.get('ls_pt', 0)}pt;"
                 f"hyphens:{'manual' if c.get('shy') else 'none'};"
                 + (f"transform:scaleX({c['sx']});transform-origin:0 0;" if c.get("sx") else ""))
        cols_html.append(f'<div class="col" id="c{i}" data-wsratio="{c.get("ws_ratio", 1.0)}" style="{style}">{paras}</div>')
    doc = f"""<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{{font-family:'Mukta';src:url('{(FONTS / 'Mukta-Regular.ttf').as_uri()}');}}
@font-face{{font-family:'Tiro Devanagari Hindi';src:url('{(FONTS / 'TiroDevanagariHindi-Regular.ttf').as_uri()}');}}
@page{{size:{page_mm[0]}mm {page_mm[1]}mm;margin:0}}
html,body{{margin:0;padding:0}}
.col{{position:absolute;overflow:visible;font-kerning:normal}}
.col p{{margin:0;padding:0;text-indent:0}}
#gt{{display:none}}
{css_extra}
</style></head><body>{''.join(cols_html)}<pre id="gt"></pre>
<script>
const PX2MM=25.4/96;
function natSpace(col){{const s=document.createElement('span');s.style.whiteSpace='pre';s.style.letterSpacing='0';
 s.textContent='\\u0020';col.appendChild(s);const w=s.getBoundingClientRect().width;s.remove();return w;}}
document.fonts.ready.then(()=>{{
 const cols=[...document.querySelectorAll('.col')];
 // apply requested word-spacing ratio: extra = (ratio-1) * natural space
 cols.forEach(c=>{{const r=parseFloat(c.dataset.wsratio);if(r!==1){{c.style.wordSpacing=((r-1)*natSpace(c))+'px';}}}});
 const out={{fixture:'{name}',class:'{CLASS}',columns:[]}};
 cols.forEach(c=>{{
  const cr=c.getBoundingClientRect(); const words=[];
  c.querySelectorAll('span.w').forEach(sp=>{{const rs=[...sp.getClientRects()].map(r=>[r.left*PX2MM,r.top*PX2MM,r.right*PX2MM,r.bottom*PX2MM]);words.push({{t:sp.textContent,rects:rs}});}});
  out.columns.push({{id:c.id,rect_mm:[cr.left*PX2MM,cr.top*PX2MM,cr.right*PX2MM,cr.bottom*PX2MM],natural_space_mm:natSpace(c)*PX2MM,words}});
 }});
 document.getElementById('gt').textContent=JSON.stringify(out);
}});
</script></body></html>"""
    BUILD.mkdir(parents=True, exist_ok=True)
    hp = BUILD / f"{name}.html"
    hp.write_text(doc, encoding="utf-8")
    pdf = BUILD / f"{name}.pdf"
    common = [CHROME, "--headless=new", "--disable-gpu", "--allow-file-access-from-files", "--no-pdf-header-footer",
              "--virtual-time-budget=8000", "--run-all-compositor-stages-before-draw"]
    subprocess.run(common + [f"--print-to-pdf={pdf}", hp.as_uri()], check=True, capture_output=True)
    dom = subprocess.run(common + ["--dump-dom", hp.as_uri()], check=True, capture_output=True, text=True).stdout
    m = re.search(r'<pre id="gt">(.*?)</pre>', dom, re.S)
    gt = json.loads(html.unescape(m.group(1))) if m and m.group(1).strip() else None
    spec = {"fixture": name, "class": CLASS, "page_mm": page_mm,
            "columns": [{k: v for k, v in c.items() if k != "paras"} | {"n_paras": len(c["paras"])} for c in columns],
            "pdf_sha256": hashlib.sha256(pdf.read_bytes()).hexdigest(), "dom_ground_truth": gt}
    (BUILD / f"{name}.truth.json").write_text(json.dumps(spec, ensure_ascii=False, indent=1))
    return spec


def main():
    ver = subprocess.run([CHROME, "--version"], capture_output=True, text=True).stdout.strip()
    specs = []
    base = dict(font="Mukta", size_pt=9.5, lead_pt=11.2, h=400)
    specs.append(page("GT-A_left_natural", (210, 297), [dict(base, x=20, y=20, w=45, align="left", paras=MR[:6])]))
    specs.append(page("GT-B_left_ws1.5", (210, 297), [dict(base, x=20, y=20, w=45, align="left", ws_ratio=1.5, paras=MR[:6])]))
    specs.append(page("GT-C_justify_tiro", (210, 297), [dict(base, font="Tiro Devanagari Hindi", size_pt=9.0, lead_pt=10.8,
                                                              x=20, y=20, w=52, align="justify", paras=MR[6:12])]))
    cols = [dict(base, size_pt=9.0, lead_pt=10.6, x=24 + i * (30.25 + 4), y=30, w=30.25, align="justify",
                 paras=MR[(i * 2) % 18:(i * 2) % 18 + 2]) for i in range(8)]
    specs.append(page("GT-D_broadsheet_8col_justify", (318, 510), cols))
    specs.append(page("GT-E_manual_hyphen_justify", (210, 297), [dict(base, x=20, y=20, w=38, align="justify", shy=True, paras=MR[:5])]))
    mixed = [t["text"] for t in CORPUS if t["id"] in ("mr-body-07", "mr-body-13", "mr-body-14", "mr-body-17")]
    specs.append(page("GT-F_mixed_script_left", (210, 297), [dict(base, x=20, y=20, w=45, align="left", paras=mixed)]))
    specs.append(page("GT-G_letterspacing_0.3pt", (210, 297), [dict(base, x=20, y=20, w=45, align="left", ls_pt=0.3, paras=MR[:4])]))
    specs.append(page("GT-H_hscale_0.9", (210, 297), [dict(base, x=20, y=20, w=45, align="left", sx=0.9, paras=MR[:4])]))
    (BUILD / "INDEX.json").write_text(json.dumps({"class": CLASS, "chrome": ver, "fixtures": [s["fixture"] for s in specs],
                                                  "note": "Validates measurement tooling only. NOT newspaper evidence."}, indent=1))
    for s in specs:
        gt = s["dom_ground_truth"]
        print(s["fixture"], "gt:", "OK" if gt else "MISSING", "words:", sum(len(c["words"]) for c in gt["columns"]) if gt else 0)


if __name__ == "__main__":
    main()
