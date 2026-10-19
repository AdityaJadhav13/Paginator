"""EXP-PAGE-1: compare rebuilt pages with the printed originals (EXPERIMENTAL; PRIVATE OUTPUT except aggregates).

For every rebuilt page (<dataset>/report/page1/rebuilt[_paper]/*.pdf + .manifest.json from compose_page.py):
  render     printed page and rebuild side by side, and an overlay (printed page grey, rebuild red) → compare[_paper]/
  PDF/X      the independent PDF/X-1a checker (pdfx1/check_pdfx1a_independent.py), fresh JSON per run, bound to the
             rebuild by its sha256
  stories    printed vs our body lines, overset, story depth within G1 A7 (±max(1, printed // 20) lines), paragraphs
             whose breaks equal print, and a character-level integrity check (every character of the story's body is
             placed in order or counted as overset; unset paragraphs reported separately)
  geometry   body lines outside their column box; body lines over images/graphics/ads beyond what print itself does;
             text lines overlapping each other beyond the printed page's own overlaps
  collisions glyph-level: pairs of different lines whose tight glyph boxes overlap (PDFium), ours vs print's own
  accounting every other text element (headline, deck, crosshead, kicker, byline, caption, folio, furniture …) set
             with exactly its words (ads and run-in leads excluded)
  headlines  breaks equal to print GIVEN the printed number of lines; reported on multi-line items, failures as misses
Selection of the page to print (rule stated before the results are read; the Marathi-only clause was added after a
first run showed that the English flip pages hyphenate in print — see EXP_PAGE_1_REPORT.md): Marathi test-edition
page passing every gate (0 checker FAILs, 0 problems, 0 overset lines or crosshead words, 0 geometry violations,
0 accounting mismatches, every story's characters in order); among those the most body lines in complete
high-confidence stories; ties → more body lines → page id. If no page passes, the one with the fewest gate failures,
flagged.
Writes experiments/phase0/results/page1/summary[_paper].json (aggregates only: no text, ids, dates or names) and the
private compare[_paper]/summary_private.json + walkthrough.html.
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/page1/compare_page.py <dataset_dir> [--variant paper]
"""
from __future__ import annotations

import ctypes
import hashlib
import html
import json
import statistics as st
import subprocess
import sys
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as PR
from PIL import Image, ImageChops, ImageOps

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from textfix import fix_bullet  # noqa: E402

REPO = HERE.parents[2]
OUT = REPO / "experiments" / "phase0" / "results" / "page1"
CHECKER = HERE.parent / "pdfx1" / "check_pdfx1a_independent.py"
SCALE = 1.2
MM = 72 / 25.4
TEXT_KINDS = ("headline", "deck", "kicker", "byline", "crosshead", "caption", "jump_line", "folio", "furniture", "other_text")
OBSTACLE_KINDS = ("image", "graphic", "ad")


def depth_ok(printed: int, ours: int) -> bool:
    return abs(ours - printed) <= max(1, printed // 20)


def render(pdf: Path, index: int, scale: float = SCALE) -> Image.Image:
    return pdfium.PdfDocument(str(pdf))[index].render(scale=scale).to_pil().convert("RGB")


def overlay(orig: Image.Image, ours: Image.Image) -> Image.Image:
    w, h = min(orig.width, ours.width), min(orig.height, ours.height)
    o = ImageOps.grayscale(orig.crop((0, 0, w, h)))
    u = ImageOps.grayscale(ours.crop((0, 0, w, h)))
    base = Image.merge("RGB", [o.point(lambda v: 255 - (255 - v) // 3)] * 3)
    red = Image.merge("RGB", [Image.new("L", (w, h), 255), u, u])
    return ImageChops.multiply(base, red)


def boxes_overlapping(boxes) -> int:
    """Pairs of line boxes (x0, top, x1, bottom) that overlap by > 1 mm across and > 25 % of the smaller height."""
    b = sorted(boxes, key=lambda t: t[1])
    n = 0
    for i in range(len(b)):
        x0, t, x1, bo = b[i]
        for j in range(i + 1, len(b)):
            X0, T, X1, BO = b[j]
            if T >= bo:
                break
            if min(x1, X1) - max(x0, X0) > 1.0 and min(bo, BO) - max(t, T) > 0.25 * min(bo - t, BO - T):
                n += 1
    return n


def glyph_collisions(pdf: Path, index: int) -> int:
    """Pairs of DIFFERENT text lines (baselines >= 1 mm apart) whose tight glyph boxes overlap (PDFium char boxes;
    the method of the independent verifier). Lines = glyphs on one baseline (±0.35 mm), similar size, x-contiguous."""
    page = pdfium.PdfDocument(str(pdf))[index]
    _, H = page.get_size()
    tp = page.get_textpage()
    pt = 25.4 / 72
    chars = []
    for i in range(PR.FPDFText_CountChars(tp.raw)):
        l, r, b, t = ctypes.c_double(), ctypes.c_double(), ctypes.c_double(), ctypes.c_double()
        if not PR.FPDFText_GetCharBox(tp.raw, i, l, r, b, t) or r.value - l.value <= 0.01 or t.value - b.value <= 0.01:
            continue
        if PR.FPDFText_GetUnicode(tp.raw, i) in (32, 0xA0, 10, 13):
            continue
        ox, oy = ctypes.c_double(), ctypes.c_double()
        PR.FPDFText_GetCharOrigin(tp.raw, i, ox, oy)
        chars.append(((l.value * pt, (H - t.value) * pt, r.value * pt, (H - b.value) * pt), (H - oy.value) * pt, ox.value * pt,
                      PR.FPDFText_GetFontSize(tp.raw, i)))
    chars.sort(key=lambda c: (round(c[1], 1), c[2]))
    lines = []                                   # [base, size, x0, x1]
    lid = []
    for box, base, x, sz in chars:
        for k in range(len(lines) - 1, max(-1, len(lines) - 41), -1):
            L = lines[k]
            if abs(L[0] - base) < 0.35 and abs(L[1] - sz) < 0.6 and x - L[3] < 4 and x > L[2] - 4:
                L[2], L[3] = min(L[2], box[0]), max(L[3], box[2]); lid.append(k); break
        else:
            lines.append([base, sz, box[0], box[2]]); lid.append(len(lines) - 1)
    items = sorted(zip((c[0] for c in chars), lid), key=lambda t: t[0][1])
    pairs, active = set(), []
    for box, k in items:
        active = [a for a in active if a[0][3] > box[1]]
        for ob, ok in active:
            if ok != k and abs(lines[ok][0] - lines[k][0]) >= 1.0 and ob[0] < box[2] and box[0] < ob[2] and ob[1] < box[3] and box[1] < ob[3]:
                pairs.add((min(ok, k), max(ok, k)))
        active.append((box, k))
    return len(pairs)


def line_box(x0, x1, base, size_pt):
    em = size_pt / MM
    return (x0, base - 0.70 * em, x1, base + 0.20 * em)


def hits(box, obstacles) -> bool:
    return any(min(box[2], o[2]) - max(box[0], o[0]) > 1.0 and min(box[3], o[3]) - max(box[1], o[1]) > 1.0 for o in obstacles)


def source_pdf(ds: Path, sample: str) -> Path:
    d = ds / "samples" / sample
    return d / "source.pdf" if (d / "source.pdf").exists() else sorted(d.glob("*.pdf"))[0]


def check_page(model: dict, m: dict) -> dict:
    """Geometry and accounting checks of one rebuild against its page model."""
    ads = [e["bbox_mm"] for e in model["elements"] if e["kind"] == "ad"]
    obstacles = [e["bbox_mm"] for e in model["elements"] if e["kind"] in OBSTACLE_KINDS
                 and e["bbox_mm"][2] - e["bbox_mm"][0] > 3 and e["bbox_mm"][3] - e["bbox_mm"][1] > 3]
    cols_of = {s["story"]: s.get("columns", []) for s in m["stories"]}
    ours = [l for l in m["lines"] if l.get("role") not in ("placeholder", "slug") and "x1_mm" in l]
    body = [l for l in ours if l.get("role") == "body"]
    outside = 0
    for l in body:
        cols = cols_of.get(l.get("story")) or []
        c = cols[l["column"]] if l.get("column") is not None and l["column"] < len(cols) else None
        if c is None or l["x0_mm"] < c[0] - 0.5 or l["x1_mm"] > c[2] + 0.5 or l["baseline_mm"] > c[3] + 0.5 or l["baseline_mm"] < c[1] - 1.0:
            outside += 1
    printed_boxes, printed_body = [], []
    for e in model["elements"]:
        if e["kind"] in TEXT_KINDS or e["kind"] == "body_frame":
            for ln in e.get("lines", []):
                if e["kind"] == "body_frame" and (ln.get("excluded") or ln.get("use", "body") != "body"):
                    continue
                bx = line_box(ln["x0_mm"], ln["x1_mm"], ln["baseline_mm"], e.get("size_pt") or 12.0)
                printed_boxes.append(bx)
                if e["kind"] == "body_frame":
                    printed_body.append(bx)
    our_boxes = [line_box(l["x0_mm"], l["x1_mm"], l["baseline_mm"], l["size_pt"]) for l in ours]
    over_obst_ours = sum(hits(line_box(l["x0_mm"], l["x1_mm"], l["baseline_mm"], l["size_pt"]), obstacles) for l in body)
    over_obst_print = sum(hits(b, obstacles) for b in printed_body)
    ov_ours, ov_print = boxes_overlapping(our_boxes), boxes_overlapping(printed_boxes)
    emitted: dict = {}
    for l in m["lines"]:
        if l.get("element"):
            emitted[l["element"]] = emitted.get(l["element"], 0) + len(l["text"].split())

    def in_ad(e):
        x0, t, x1, b = e["bbox_mm"]
        return any(a[0] - 0.5 <= x0 and x1 <= a[2] + 0.5 and a[1] - 0.5 <= t and b <= a[3] + 0.5 for a in ads)
    mism = []
    for e in model["elements"]:
        if e["kind"] in TEXT_KINDS and not in_ad(e) and not e.get("run_in"):
            want = sum(len(fix_bullet(" ".join(ln["text"].split())).split()) for ln in e["lines"])
            if want and emitted.get(e["id"], 0) != want:
                mism.append({"element": e["id"], "kind": e["kind"], "want": want, "got": emitted.get(e["id"], 0)})
    return {"body_lines_outside_column": outside, "body_lines_over_obstacles": over_obst_ours, "print_body_lines_over_obstacles": over_obst_print,
            "excess_over_obstacles": max(0, over_obst_ours - over_obst_print), "overlaps_ours": ov_ours, "overlaps_print": ov_print,
            "excess_overlaps": max(0, ov_ours - ov_print), "element_word_mismatches": len(mism), "mismatches": mism}


def main():
    args = sys.argv[1:]
    variant = "paper" if "--variant" in args and args[args.index("--variant") + 1] == "paper" else "story"
    args = [a for a in args if a not in ("--variant", "paper", "story")]
    ds = Path(args[0]).expanduser()
    suffix = "" if variant == "story" else "_paper"
    rb, models = ds / "report" / "page1" / f"rebuilt{suffix}", ds / "report" / "page1" / "pages"
    cmp_dir = ds / "report" / "page1" / f"compare{suffix}"; cmp_dir.mkdir(parents=True, exist_ok=True)
    pages = []
    for man in sorted(rb.glob("*.manifest.json")):
        m = json.loads(man.read_text(encoding="utf-8"))
        name = man.name[: -len(".manifest.json")]
        model = json.loads((models / f"{name}.json").read_text(encoding="utf-8"))
        pdf = rb / f"{name}.pdf"
        if hashlib.sha256(pdf.read_bytes()).hexdigest() != m["sha256"]:
            sys.exit(f"{name}: PDF does not match its manifest (stale rebuild)")
        chk_json = cmp_dir / f"{name}.check.json"
        chk_json.unlink(missing_ok=True)
        subprocess.run([sys.executable, str(CHECKER), str(pdf), "--json", str(chk_json)], capture_output=True)
        chk = json.loads(chk_json.read_text())
        if chk.get("sha256") != m["sha256"]:
            sys.exit(f"{name}: checker result is not for this PDF")
        counts = {k: sum(1 for r in chk["results"] if r.get("status") == k) for k in ("PASS", "WARN", "FAIL")}
        orig, ours = render(source_pdf(ds, model["sample"]), model["page"] - 1), render(pdf, 0)
        side = Image.new("RGB", (orig.width + ours.width + 16, max(orig.height, ours.height)), "white")
        side.paste(orig, (0, 0)); side.paste(ours, (orig.width + 16, 0))
        side.save(cmp_dir / f"{name}.side.png"); overlay(orig, ours).save(cmp_dir / f"{name}.overlay.png")
        sid = {s["id"]: s for s in model["stories"]}
        els = {e["id"]: e for e in model["elements"]}
        stories = []
        for s in m["stories"]:
            ms = sid.get(s["story"])
            if ms is not None:
                paras = [b for b in ms["flow"] if b["type"] == "para" and b["text"].strip()]
                skip = set(s.get("unset_para_index", []))
                src_words = " ".join(fix_bullet(b["text"]) for i, b in enumerate(paras) if i not in skip).split()
            else:
                fr = els.get(s["story"][len("frame-"):], {})
                src_words = " ".join(fix_bullet(l["text"]) for l in fr.get("lines", []) if not l.get("excluded") and l.get("use", "body") == "body").split()
            our_words = " ".join(l["text"] for l in m["lines"] if l.get("role") == "body" and l.get("story") == s["story"]).split()
            o_chars, s_chars = "".join(our_words), "".join(src_words)
            words_ok = o_chars == s_chars[:len(o_chars)] and len(o_chars) + s.get("overset_chars", 0) == len(s_chars)
            stories.append({**s, "complete": bool(ms and ms.get("complete")), "confidence": (ms or {}).get("confidence"),
                            "words_in_order": words_ok, "depth_ok": depth_ok(s["printed_lines"], s["our_lines"]) if s["printed_lines"] else None})
        geo = check_page(model, m)
        geo["glyph_collisions_ours"] = glyph_collisions(pdf, 0)
        geo["glyph_collisions_print"] = glyph_collisions(source_pdf(ds, model["sample"]), model["page"] - 1)
        geo["excess_glyph_collisions"] = max(0, geo["glyph_collisions_ours"] - geo["glyph_collisions_print"])
        good = [s for s in stories if s["complete"] and s["confidence"] == "high"]
        letters = [ch for st_ in model["stories"] for b in st_["flow"] if b["type"] == "para" for ch in b["text"] if ch.isalpha()]
        script = "marathi" if letters and sum("\u0900" <= ch <= "\u097f" for ch in letters) >= 0.5 * len(letters) else "english"
        sm = m["summary"]
        gates = {"checker_fail": counts["FAIL"] > 0, "problems": sm["problems"] > 0,
                 "overset": sm["overset_lines"] > 0 or sm.get("overset_crosshead_words", 0) > 0,
                 "outside_column": geo["body_lines_outside_column"] > 0, "over_obstacles": geo["excess_over_obstacles"] > 0,
                 "overlaps": geo["excess_overlaps"] > 0, "accounting": geo["element_word_mismatches"] > 0,
                 "glyph_collisions": geo["excess_glyph_collisions"] > 0,
                 "integrity": not all(s["words_in_order"] for s in stories if s["printed_lines"])}
        pages.append({"name": name, "split": model["split"], "page": model["page"], "script": script, "checker": counts, "problems": sm["problems"],
                      "stories": stories, "display": m["display"], "summary": sm, "geometry": {k: v for k, v in geo.items() if k != "mismatches"},
                      "mismatches": geo["mismatches"], "gates_failed": [k for k, v in gates.items() if v],
                      "lines_in_good_stories": sum(s["printed_lines"] for s in good)})
        for f in (cmp_dir / f"{name}.side.png", cmp_dir / f"{name}.overlay.png", chk_json):
            f.chmod(0o600)

    def pct(a, n):
        return round(100 * a / n, 1) if n else None

    def agg(P):
        S = [s for p in P for s in p["stories"] if s["printed_lines"]]
        D = [d for p in P for d in p["display"]]
        Dm = [d for d in D if d["lines"] > 1]
        good = [s for s in S if s["complete"] and s["confidence"] == "high"]
        G = [p["geometry"] for p in P]
        return {"pages": len(P), "checker_fail_pages": sum(1 for p in P if p["checker"]["FAIL"]),
                "checker_warn_median": st.median(p["checker"]["WARN"] for p in P) if P else None,
                "stories": len(S), "stories_complete_high": len(good),
                "body_lines_printed": sum(s["printed_lines"] for s in S), "body_lines_ours": sum(s["our_lines"] for s in S),
                "overset_lines": sum(s["overset_lines"] for s in S), "overset_crosshead_words": sum(s.get("overset_crosshead_words", 0) for s in S),
                "unset_paragraphs": sum(s.get("unset_paragraphs", 0) for s in S),
                "story_depth_ok_pct": pct(sum(bool(s["depth_ok"]) for s in S), len(S)),
                "story_depth_ok_pct_complete_high": pct(sum(bool(s["depth_ok"]) for s in good), len(good)),
                "stories_chars_in_order_pct": pct(sum(bool(s["words_in_order"]) for s in S), len(S)),
                "paragraphs": sum(s["paragraphs"] for s in S),
                "paragraphs_same_breaks_pct": pct(sum(s["paragraphs_same_breaks"] for s in S), sum(s["paragraphs"] for s in S)),
                "display_items": len(D), "display_multiline": len(Dm), "display_failed": sum(bool(d.get("failed")) for d in D),
                "display_multiline_same_breaks_given_line_count_pct": pct(sum(bool(d["same_breaks"]) for d in Dm), len(Dm)),
                "body_lines_outside_column": sum(g["body_lines_outside_column"] for g in G),
                "body_lines_over_obstacles": sum(g["body_lines_over_obstacles"] for g in G),
                "print_body_lines_over_obstacles": sum(g["print_body_lines_over_obstacles"] for g in G),
                "excess_overlaps": sum(g["excess_overlaps"] for g in G), "overlaps_print": sum(g["overlaps_print"] for g in G),
                "element_word_mismatches": sum(g["element_word_mismatches"] for g in G),
                "glyph_collisions_ours": sum(g["glyph_collisions_ours"] for g in G),
                "glyph_collisions_print": sum(g["glyph_collisions_print"] for g in G),
                "pages_with_excess_glyph_collisions": sum(1 for g in G if g["excess_glyph_collisions"] > 0),
                "pages_passing_all_gates": sum(1 for p in P if not p["gates_failed"]),
                "problems": sum(p["problems"] for p in P)}
    mr = [p for p in pages if p["script"] == "marathi"]
    cands = [p for p in mr if p["split"] == "test"]
    pick = sorted(cands, key=lambda p: (len(p["gates_failed"]), -p["lines_in_good_stories"], -p["summary"]["printed_body_lines"], p["name"]))[:1]
    summary = {"schema": "pageinator.page1.summary/2", "variant": variant, "all": agg(pages), "marathi": agg(mr),
               "marathi_test": agg([p for p in mr if p["split"] == "test"]), "marathi_cal": agg([p for p in mr if p["split"] == "cal"]),
               "english": agg([p for p in pages if p["script"] == "english"]),
               "note_english": "English (flip-format) pages use hyphenation in print; the Marathi body policy never breaks words",
               "depth_rule": "G1 A7: |our lines - printed lines| <= max(1, printed // 20) per story",
               "display_rule": "headline/deck breaks equal to print GIVEN the printed number of lines; multi-line items; failures count as misses",
               "print_candidate_rule": "Marathi test-edition page passing every gate; most body lines in complete high-confidence stories",
               "print_candidate_passes_all_gates": bool(pick and not pick[0]["gates_failed"])}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"summary{suffix}.json").write_text(json.dumps(summary, indent=1) + "\n")
    priv = {"pages": pages, "print_candidate": pick[0]["name"] if pick else None,
            "print_candidate_gates_failed": pick[0]["gates_failed"] if pick else None, **summary}
    (cmp_dir / "summary_private.json").write_text(json.dumps(priv, indent=1, ensure_ascii=False) + "\n")
    (cmp_dir / "summary_private.json").chmod(0o600)
    a = summary["marathi_test"]                     # the owner-facing figures are the held-out editions'
    rows = "".join(
        f"<tr><td>{html.escape(p['name'])}</td><td>{p['split']}</td><td>{p['script']}</td><td>{p['checker']['PASS']}/{p['checker']['WARN']}/{p['checker']['FAIL']}</td>"
        f"<td>{p['summary']['printed_body_lines']}</td><td>{p['summary']['our_body_lines']}</td><td>{p['summary']['overset_lines']}</td>"
        f"<td>{sum(bool(s['depth_ok']) for s in p['stories'] if s['printed_lines'])}/{sum(1 for s in p['stories'] if s['printed_lines'])}</td>"
        f"<td>{html.escape(', '.join(p['gates_failed']) or 'all passed')}</td>"
        f"<td><a href='{html.escape(p['name'])}.side.png'>side by side</a> · <a href='{html.escape(p['name'])}.overlay.png'>overlay</a></td></tr>"
        for p in pages)
    (cmp_dir / "walkthrough.html").write_text(f"""<!doctype html><html><head><meta charset="utf-8"><title>Page rebuild walkthrough</title>
<style>body{{font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;max-width:1200px;margin:24px auto;padding:0 16px;color:#222}}
table{{border-collapse:collapse;width:100%;font-size:13px}}td,th{{border-bottom:1px solid #ddd;padding:4px 6px;text-align:left}}
.big{{font-size:20px}}img{{max-width:100%;border:1px solid #ccc}}</style></head><body>
<h1>Your pages, rebuilt by Pageinator{' (held-out sizing)' if variant == 'paper' else ''}</h1>
<p class="big">Held-out editions: {a['pages']} printed Marathi pages rebuilt from their own stories: {a['stories']} stories, {a['body_lines_printed']} printed body
lines → {a['body_lines_ours']} Pageinator lines ({a['overset_lines']} did not fit). Story depth within ±1 line per 20 lines:
<b>{a['story_depth_ok_pct']}%</b> of stories. Multi-line headlines and decks with exactly the printed breaks, given the printed
number of lines: <b>{a['display_multiline_same_breaks_given_line_count_pct']}%</b>. Every page is a PDF/X-1a file; pages with checker
failures: {a['checker_fail_pages']}. Pages passing every check: {a['pages_passing_all_gates']}.</p>
<p>Left: the printed page. Right: Pageinator's rebuild with free stand-in fonts. Photos, graphics and ads are grey placeholders
(the image step comes later). The overlay shows the printed page in grey and the rebuild in red.</p>
<p>Page chosen for the press: <b>{html.escape(priv['print_candidate'] or 'none')}</b>
{'(passes every check)' if summary['print_candidate_passes_all_gates'] else '(does NOT pass every check: ' + html.escape(', '.join(priv['print_candidate_gates_failed'] or [])) + ')'}</p>
{"".join(f"<h2>{html.escape(p['name'])}</h2><img src='{html.escape(p['name'])}.side.png'>" for p in pages if p['name'] == priv['print_candidate'])}
<h2>All pages</h2><table><tr><th>page</th><th>editions</th><th>script</th><th>checker P/W/F</th><th>printed lines</th><th>our lines</th><th>overset</th>
<th>stories depth OK</th><th>checks failed</th><th>images</th></tr>{rows}</table></body></html>""", encoding="utf-8")
    (cmp_dir / "walkthrough.html").chmod(0o600)
    print(json.dumps({"marathi": a, "print_candidate": priv["print_candidate"], "gates_failed": priv["print_candidate_gates_failed"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
