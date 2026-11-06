"""G1-2 (doc 08 §15.1 Track G): TYPO L3 measured on the 24 generated pages the owner–editor reviewed in round 3.

    python tools/parity/l3_spacing.py <dataset_dir> <out_dir>

The criterion (docs/architecture/v2/16_PHASE0_EVIDENCE_PLAN.md §3.2, 13_ROADMAP_AND_RISKS.md G1): "lines outside the
spacing policy (after fallbacks 1–4) ≤ 2 % of lines; no 3 consecutive loose lines".

Inputs (all under <dataset_dir>/report, private):
  review3_src/key.json         the round-3 pairs; the `"kind": "real"` ones name the 24 pages
  gen1/<page>.pdf              what Pageinator printed (gen1/2.10.0); THE MEASUREMENT IS MADE HERE
  gen1/<page>.manifest.json    the composer's self-report, used only to find body lines (role "body"), their story,
                               column, column box (stories_out/fixed_stories_out `columns`), final-vs-non-final, and
                               for the cross-check
  page1/pages/<page>.json      house body values of the few stories kept where print had them (fixed stories)
  paragraphs.jsonl             the printed paper's own lines (kept paragraphs only), for the context numbers

The policy in force is EXP-COMPOSE-3's `C3_floor0.66_stretch1.00` (docs/phase0/EXP_COMPOSE_3_REPORT.md §4–6): every
non-final body line is justified to its measure, no word space below 0.66 house spaces, no stretch ceiling (the paper
justifies every line). The composer's fallbacks (HYBRID ragged, semi, overfull) are outside the policy.
A house space is space_em × house body size × horizontal scale (compose_page.py: k = house space / our space). Generated
stories: gen1 passes space_em 0.25 and hscale 1.0 with the story's house size (stories_out `style`[0]); stories kept
where print had them use their page model's own space_em, body_size_pt and body_hscale. Set-as-printed table boxes
(manifest kind "natural", never composed) are not body text under the policy and are left out, and counted.

Measured from the PDF content stream: glyphs are drawn one by one (`a 0 0 1 x y Tm <cid> Tj` in BT…ET, `/Fn size Tf`);
a space glyph is a code the font's ToUnicode CMap maps to U+0020; advance = /W width / 1000 × size × a. A PDF line is
one BT…ET block; its baseline is its most common glyph y. It is matched to the manifest line with the same baseline
(±0.05 pt) whose x0 is at most 0.2 mm right of the line's left-most glyph and whose column holds it.
  gap        x of the glyph after a space glyph − x of the space glyph, in house spaces
  line end   the right-most glyph edge, max(x + advance) (the last glyph drawn can be a zero-advance mark)
  measure    the right edge of the line's column (the manifest's x1_mm is where the pen stopped, so a ragged line
             would trivially "reach" it); reaches = |end − measure| ≤ 0.15 mm, overfull = end > measure + 0.15 mm
  OUTSIDE    overfull, or a non-final line that does not reach its measure, or any gap < 0.66 − 0.005
  L3         outside lines / measured body lines, per page and in total; longest run of consecutive outside lines in
             one column (a story's column, lines in baseline order)
Context (a policy without a stretch ceiling makes L3 nearly automatic), with the definitions of
experiments/phase0/compose3/run_compose3.py agg(): over non-final lines with at least one gap, the share whose widest
gap is > 2× and > 3×, and the p95 widest gap; the share of non-final justified lines whose word space (median gap) is
< 0.8×; plus runs of ≥ 3 consecutive non-final lines with a gap > 3× (ours per column; print within a paragraph). The
same numbers for print come from paragraphs.jsonl on the same 24 pages: gaps_pt / nominal_space_pt, gaps next to
punctuation left out as in run_compose3.print_lines(); classes FULLY_ALIGNED and NEAR_ALIGNED count as justified.
Cross-check: manifest kind vs the PDF's (justified → reaches; ragged/semi → short; final → either; overfull → over),
manifest x1_mm vs the PDF line end (±0.15 mm), and space glyphs drawn vs spaces in the manifest line's text.

CAVEAT: the round-3 kit was rendered on 2026-10-19 from an earlier gen1 build and the kit itself is not on this machine;
these pages are gen1/2.10.0 of 2026-10-20, the closest existing outputs, not the exact images the owner–editor saw.
Writes private per-line and per-page JSON to <out_dir> (umask 077); prints aggregates only.
"""
from __future__ import annotations

import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pikepdf

MM = 72 / 25.4                      # PDF points per millimetre
FLOOR, FLOOR_TOL = 0.66, 0.005      # C3_floor0.66: narrowest word space, in house spaces
REACH_MM = 0.15
GEN_SPACE_EM = 0.25                 # gen1 logs "word space em: 0.25"; it passes body_hscale 1.0
EXPECT = {"justified": {"full"}, "final": {"full", "short"}, "ragged": {"short"}, "semi": {"short"}, "overfull": {"over"}}


def widths(w) -> dict[int, float]:
    """A CIDFont /W array (`c [w1 w2 …]` and `c_first c_last w` forms) → {cid: width in 1/1000 em}."""
    out, i = {}, 0
    while i < len(w):
        c = int(w[i])
        if isinstance(w[i + 1], pikepdf.Array):
            out.update((c + k, float(v)) for k, v in enumerate(w[i + 1]))
            i += 2
        else:
            out.update((k, float(w[i + 2])) for k in range(c, int(w[i + 1]) + 1))
            i += 3
    return out


def space_codes(cmap: bytes) -> set[int]:
    """Codes a ToUnicode CMap maps to U+0020 (bfchar, and bfrange with a single destination)."""
    out = set()
    for blk in re.findall(rb"beginbfchar(.*?)endbfchar", cmap, re.S):
        out.update(int(a, 16) for a, d in re.findall(rb"<(\w+)>\s*<(\w+)>", blk) if int(d, 16) == 0x20)
    # shortcut: bfrange entries with an array destination are skipped; the gen1 writer emits bfchar only
    for blk in re.findall(rb"beginbfrange(.*?)endbfrange", cmap, re.S):
        for a, b, d in re.findall(rb"<(\w+)>\s*<(\w+)>\s*<(\w+)>", blk):
            a, b, d = int(a, 16), int(b, 16), int(d, 16)
            if d <= 0x20 <= d + b - a:
                out.add(a + 0x20 - d)
    return out


def pdf_lines(path: Path) -> tuple[float, list[dict]]:
    """→ (page height pt, [{"y": baseline pt, "glyphs": [(x pt, advance pt, is_space)]}]), one per BT…ET block."""
    with pikepdf.open(path) as pdf:
        page = pdf.pages[0]
        fonts = {}
        for name, f in page.Resources.Font.items():
            d = f.DescendantFonts[0]
            fonts[name] = (widths(d.get("/W", [])), float(d.get("/DW", 1000)), space_codes(f.ToUnicode.read_bytes()))
        blocks, font, size, a, x, y = [], None, 0.0, 1.0, 0.0, 0.0
        # shortcut: text is assumed drawn with an identity CTM, as the gen1 writer does; a text `cm` would need tracking
        for ins in pikepdf.parse_content_stream(page):
            op, o = str(ins.operator), ins.operands
            if op == "BT":
                blocks.append([])
            elif op == "Tf":
                font, size = str(o[0]), float(o[1])
            elif op == "Tm":
                a, _, _, _, x, y = map(float, o)
            elif op == "Tj":
                w, dw, sp = fonts[font]
                b = bytes(o[0])
                for i in range(0, len(b), 2):
                    cid = int.from_bytes(b[i:i + 2], "big")
                    adv = w.get(cid, dw) / 1000 * size * a
                    blocks[-1].append((x, y, adv, cid in sp))
                    x += adv
            elif op in ("TJ", "'", '"', "Td", "TD", "T*", "Tz", "TL"):
                raise ValueError(f"{path.name}: text operator {op} is not handled")
        height = float(page.MediaBox[3]) - float(page.MediaBox[1])
    return height, [{"y": statistics.mode(round(g[1], 3) for g in b), "glyphs": [(g[0], g[2], g[3]) for g in b]}
                    for b in blocks if b]


def gaps_pt(glyphs) -> list[float]:
    """Word gaps of one line: from each space glyph to the glyph drawn after it."""
    return [nxt[0] - g[0] for g, nxt in zip(glyphs, glyphs[1:]) if g[2]]


def longest_run(flags) -> int:
    best = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return best


def runs_at_least(flags, n: int) -> int:
    """How many maximal runs of True are at least n long."""
    runs, cur = 0, 0
    for f in [*flags, False]:
        if f:
            cur += 1
        else:
            runs += cur >= n
            cur = 0
    return runs


def context(lines: list[dict], runs3: int) -> dict:
    """run_compose3.agg()'s spacing numbers over line dicts {final, justified, widest, space}."""
    nf = [ln for ln in lines if not ln["final"]]
    w = sorted(ln["widest"] for ln in nf if ln["widest"] is not None)
    sp = [ln["space"] for ln in nf if ln["justified"] and ln["space"] is not None]
    pct = lambda n, d: round(100 * n / max(1, d), 2)  # noqa: E731
    return {"nonfinal_lines": len(nf), "nonfinal_with_gap": len(w), "gt2_pct": pct(sum(x > 2 for x in w), len(w)),
            "gt3_pct": pct(sum(x > 3 for x in w), len(w)), "widest_p95": round(w[int(0.95 * (len(w) - 1))], 3) if w else None,
            "lt08_pct": pct(sum(x < 0.8 for x in sp), len(sp)), "runs_ge3_gt3": runs3}


def measure_page(rep: Path, page: str) -> tuple[list[dict], Counter]:
    man = json.loads((rep / "gen1" / f"{page}.manifest.json").read_text(encoding="utf-8"))
    model = {s["id"]: s for s in json.loads((rep / "page1" / "pages" / f"{page}.json").read_text(encoding="utf-8"))["stories"]}
    gen = {s["story"]: s for s in man["stories_out"]}
    cols = {s["story"]: s["columns"] for s in man["stories_out"] + man["fixed_stories_out"]}
    height, plines = pdf_lines(rep / "gen1" / f"{page}.pdf")
    out, n = [], Counter()
    for ml in man["lines"]:
        if ml["role"] != "body":
            continue
        if ml["kind"] == "natural":
            n["set_as_printed_left_out"] += 1
            continue
        if ml["story"] in gen:
            house = GEN_SPACE_EM * gen[ml["story"]]["style"][0]
        else:
            s = model[ml["story"]]
            house = s["space_em"] * s["body_size_pt"] * s["body_hscale"]
        # shortcut: the measure is the column's right edge; a line narrowed by a wrap would read as short (and show up
        # in kind_disagrees); none of the 24 pages has one
        col_x1 = cols[ml["story"]][ml["column"]][2]
        ye = height - ml["baseline_mm"] * MM
        cand = [p for p in plines if abs(p["y"] - ye) < 0.05
                and ml["x0_mm"] - 0.2 <= min(g[0] for g in p["glyphs"]) / MM <= col_x1]
        if len(cand) != 1:
            n["unmatched"] += 1
            continue
        glyphs = cand[0]["glyphs"]
        gaps = [round(g / house, 4) for g in gaps_pt(glyphs)]
        end = max(g[0] + g[1] for g in glyphs) / MM
        pdf_kind = "over" if end > col_x1 + REACH_MM else "full" if abs(end - col_x1) <= REACH_MM else "short"
        final = ml["kind"] == "final"
        outside = ("overfull" if pdf_kind == "over" else "short_of_measure" if not final and pdf_kind != "full"
                   else "below_floor" if gaps and min(gaps) < FLOOR - FLOOR_TOL else None)
        n["kind_disagrees"] += pdf_kind not in EXPECT.get(ml["kind"], ())
        n["x1_disagrees"] += abs(end - ml["x1_mm"]) > REACH_MM
        n["space_count_disagrees"] += len(gaps) != ml["text"].count(" ")
        n["final_full"] += final and pdf_kind == "full"
        out.append({"page": page, "story": ml["story"], "column": ml["column"], "baseline_mm": ml["baseline_mm"],
                    "manifest_kind": ml["kind"], "pdf_kind": pdf_kind, "final": final, "end_mm": round(end, 3),
                    "measure_x1_mm": col_x1, "gaps": gaps, "outside": outside,
                    "justified": not final and pdf_kind == "full", "widest": max(gaps) if gaps else None,
                    "space": statistics.median(gaps) if gaps else None})
    return out, n


def column_flags(lines: list[dict], key) -> list[list[bool]]:
    by_col = defaultdict(list)
    for ln in lines:
        by_col[(ln["page"], ln["story"], ln["column"])].append(ln)
    return [[key(ln) for ln in sorted(c, key=lambda ln: ln["baseline_mm"])] for c in by_col.values()]


def printed(path: Path, pages: set[str]) -> dict:
    lines, runs3 = [], 0
    for row in map(json.loads, path.read_text(encoding="utf-8").splitlines()):
        if f"{row['sample']}__p{row['page']}" not in pages:
            continue
        par = []
        for ln in row["lines"]:
            g = [x / row["nominal_space_pt"] for x, u in zip(ln["gaps_pt"], ln["gap_punct_adjacent"]) if not u]
            par.append({"final": ln["class"] == "FINAL_PARAGRAPH_LINE",
                        "justified": ln["class"] in ("FULLY_ALIGNED", "NEAR_ALIGNED"),
                        "widest": max(g) if g else None, "space": statistics.median(g) if g else None})
        runs3 += runs_at_least([not p["final"] and (p["widest"] or 0) > 3 for p in par], 3)
        lines += par
    return {"paragraphs_lines": len(lines), **context(lines, runs3)}


def main(ds: Path, out_dir: Path) -> int:
    os.umask(0o077)
    rep = ds / "report"
    key = json.loads((rep / "review3_src" / "key.json").read_text(encoding="utf-8"))
    pages = [p["page"] for p in key["pairs"] if p["kind"] == "real"]
    lines, counts, per_page = [], Counter(), {}
    for page in pages:
        pl, n = measure_page(rep, page)
        counts += n
        lines += pl
        runs = column_flags(pl, lambda ln: ln["outside"] is not None)
        per_page[page] = {"lines": len(pl), "outside": sum(ln["outside"] is not None for ln in pl),
                          "longest_outside_run": max(map(longest_run, runs), default=0)}
    out_n = sum(p["outside"] for p in per_page.values())
    total = {"pages": len(pages), "lines": len(lines), "outside": out_n, "outside_pct": round(100 * out_n / max(1, len(lines)), 3),
             "outside_by_reason": dict(Counter(ln["outside"] for ln in lines if ln["outside"])),
             "longest_outside_run": max(p["longest_outside_run"] for p in per_page.values()),
             "narrowest_gap": min(g for ln in lines for g in ln["gaps"]),
             "checks": {k: counts[k] for k in ("unmatched", "kind_disagrees", "x1_disagrees", "space_count_disagrees",
                                               "final_full", "set_as_printed_left_out")}}
    loose = column_flags(lines, lambda ln: not ln["final"] and (ln["widest"] or 0) > 3)
    ctx = {"ours": context(lines, sum(runs_at_least(f, 3) for f in loose)),
           "print": printed(rep / "paragraphs.jsonl", set(pages))}
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "l3_lines.json").write_text(json.dumps(lines), encoding="utf-8")
    summary = {"per_page": per_page, "total": total, "context": ctx}
    (out_dir / "l3_summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print("TOTAL", json.dumps(total))
    for k, v in ctx.items():
        print(k.upper(), json.dumps(v))
    return 1 if counts["unmatched"] else 0              # an unmatched line would leave the count: no number then


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__.split("\n\n")[1])
    out = Path(sys.argv[2]).expanduser().resolve()
    if out.is_relative_to(Path(__file__).resolve().parents[2]):
        sys.exit("the output folder holds private lines: put it outside the repository")
    sys.exit(main(Path(sys.argv[1]).expanduser(), out))
