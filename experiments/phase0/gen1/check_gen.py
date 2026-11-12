"""EXP-GEN-1 checks: is a page Pageinator laid out itself complete, clean and printable? (EXPERIMENTAL; PRIVATE OUTPUT
except aggregates.)

For every generated page (<dataset>/report/gen1/<page>.pdf + .manifest.json from generate.py), independent of the
generator's own bookkeeping where possible:
  printable    the independent PDF/X-1a checker (EXP-PDF-1), bound to the PDF by sha256
  complete     every story's body text, character for character and in order (manifest lines vs the page model's
               paragraphs), every headline / deck / crosshead word, every photo; no overset, no composer problems
  clean        ink collisions between text lines from the real glyph outlines (inkcheck.py; the fixed parts' own excluded;
               the printed page's PDFium count beside it), overlapping line boxes,
               modules overlapping each other or leaving the newshole, text outside its module, body text over a photo,
               generated text over the page's fixed parts (ads, furniture)
  house style  span of the lead story, lead at the top of the newshole, headline hierarchy (no story with a bigger
               headline than a more important one), tombstones, white space at module feet, body type styles used
  print beside the generated page: side-by-side image (private)
Gates (all must hold for "passes"): checker_fail, problems (generated parts), overset, integrity (every paragraph),
accounting (headline with its parts, deck, kicker, byline, caption, crossheads, loose story text, jump lines), page_text_lost
(any text element of the page, outside ads, not drawn), page_photos_lost (any photo of the page not drawn), photos_missing, parts_not_set (second
photos, jump lines, loose story text), module_overlap, outside_newshole, outside_module, over_photo, over_fixed (text,
ads, images, graphics, filled boxes), glyph_collisions (any involving display text; body–body more than the printed page's own), overlaps (any).
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/gen1/check_gen.py <dataset_dir>
"""
from __future__ import annotations

import hashlib
import json
import statistics as st
import subprocess
import sys
from collections import Counter
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "page1"))
sys.path.insert(0, str(HERE))
import compare_page as CMP  # noqa: E402
import inkcheck  # noqa: E402
from textfix import fix_bullet, only_bullets  # noqa: E402

OUT = HERE.parent / "results" / "gen1"
TEXT_KINDS = ("headline", "deck", "kicker", "byline", "crosshead", "caption", "jump_line", "other_text", "furniture", "folio")
TOL = 0.6                                         # mm
_G = json.loads((HERE.parent / "results" / "page1" / "house_profile.json").read_text())["grid"]
COL_W, GUT = _G["column_width_mm"], _G["gutter_mm"]


def inside(box, outer, tol=TOL):
    return box[0] >= outer[0] - tol and box[1] >= outer[1] - tol and box[2] <= outer[2] + tol and box[3] <= outer[3] + tol


def overlap(a, b, m=1.0):
    return min(a[2], b[2]) - max(a[0], b[0]) > m and min(a[3], b[3]) - max(a[1], b[1]) > m


def check(ds: Path, name: str, man: dict, model: dict, pdf: Path, cmp_dir: Path) -> dict:
    els = {e["id"]: e for e in model["elements"]}
    sid = {s["id"]: s for s in model["stories"] + man.get("synthetic_stories", [])}     # + loose items made stories
    els = {**els, **{e["id"]: e for e in man.get("synthetic_elements", [])}}           # + pull quotes made elements
    sid.update({s["id"]: s for s in man.get("stories_used", [])})                       # as laid out (loose items attached)
    lines = [l for l in man["lines"] if l.get("role") not in ("placeholder", "slug") and "x1_mm" in l]
    gen_ids = {p["story"] for p in man["placed"]}
    mod = {p["story"]: (p["x"], p["y"], p["x"] + CMP_span(p["w"]), p["y"] + p["h"]) for p in man["placed"]}
    hole = man["newshole_box_mm"]
    out: dict = {"page": name}

    # printable
    chk_json = cmp_dir / f"{name}.check.json"; chk_json.unlink(missing_ok=True)
    subprocess.run([sys.executable, str(CMP.CHECKER), str(pdf), "--json", str(chk_json)], capture_output=True)
    chk = json.loads(chk_json.read_text()); chk_json.chmod(0o600)
    if chk.get("sha256") != man["sha256"]:
        sys.exit(f"{name}: checker result is not for this PDF")
    out["checker"] = {k: sum(1 for r in chk["results"] if r.get("status") == k) for k in ("PASS", "WARN", "FAIL")}

    # complete: body text character for character; every display part word for word; nothing left unset
    integ, acct, missing_photos, not_set = [], [], 0, Counter()
    expected_chars = 0                                 # characters the generated stories hold: drawn text may not exceed them
    nchar = lambda t: len("".join(t.split()))          # (characters, not words: a compound may break after its hyphen)
    so = {s["story"]: s for s in man["stories_out"]}
    got = Counter()
    for l in lines:
        if l.get("story") in gen_ids and l.get("element"):
            got[l["element"]] += len(l["text"].split())

    def el_text(e):                                   # a body frame's text is its body lines'
        if e["kind"] == "body_frame":
            return " ".join(l.get("text", "") for l in e.get("lines") or [] if not l.get("excluded") and l.get("use", "body") == "body")
        return e.get("text", "")

    def words(ids):
        return sum(len(el_text(els[i]).split()) for i in ids if i in els)
    for story in sorted(gen_ids):
        ms, s = sid[story], so[story]
        paras = [b for b in ms["flow"] if b["type"] == "para" and b["text"].strip()]
        src = "".join(" ".join(fix_bullet(b["text"]) for b in paras).split())          # every paragraph, none excused
        ours = "".join(" ".join(l["text"] for l in lines if l.get("role") == "body" and l.get("story") == story).split())
        integ.append(ours == src)
        expected_chars += sum(nchar(fix_bullet(b["text"])) for b in paras)
        want = {}
        if man["head_ids"].get(story):
            want[f"gen-h-{story}"] = words(man["head_ids"][story])
        if man["deck_ids"].get(story):
            want[f"gen-d-{story}"] = words(man["deck_ids"][story])
        if man.get("caption_ids", {}).get(story):
            want[f"gen-c-{story}"] = words(man["caption_ids"][story])
        for k in ("kicker", "byline"):
            if ms.get(k) in els and not els[ms[k]].get("run_in"):      # a run-in dateline is part of the paragraph
                want[ms[k]] = words([ms[k]])
        for k in ("other_elements", "jump_lines"):                 # loose story text and jump lines are set too
            for x in ms.get(k) or []:
                i = x if isinstance(x, str) else x.get("id")
                if i in els and el_text(els[i]).strip() and not only_bullets(el_text(els[i])) and not els[i].get("run_in"):
                    # (a bullet column is decoration; a run-in dateline or jump line is part of its paragraph)
                    want[i] = words([i])
        for b in ms["flow"]:
            if b["type"] == "crosshead" and b.get("element") in els:
                want[b["element"]] = words([b["element"]])
        acct += [k for k, v in want.items() if got.get(k, 0) != v]
        expected_chars += sum(nchar(CP_fix(el_text(els[i]) if i in els else "")) for i in want_ids(want, story, man))
        if ms.get("images") and not s.get("photo_box"):
            missing_photos += 1
        for k, v in (s.get("not_set") or {}).items():
            not_set[k] += len(v)
    for fs in man.get("fixed_stories_out", []):          # stories kept where print had them: every character too
        ms = sid.get(fs["story"])
        if ms is None or fs["story"] in gen_ids:
            continue
        paras = [b for b in ms["flow"] if b["type"] == "para" and b["text"].strip()]
        src = "".join(" ".join(fix_bullet(b["text"]) for b in paras).split())
        ours = "".join(" ".join(l["text"] for l in lines if l.get("role") == "body" and l.get("story") == fs["story"]).split())
        integ.append(ours == src)
    out["integrity_ok"], out["accounting_mismatches"], out["photos_missing"] = all(integ), acct, missing_photos
    drawn_chars = sum(nchar(l["text"]) for l in lines if l.get("story") in gen_ids)
    out["duplicate_words"] = max(0, drawn_chars - expected_chars)          # characters set twice (e.g. a run-in dateline)
    out["parts_not_set"] = dict(not_set)
    # stories the generator keeps where print had them (fixed parts) must fit too
    out["overset_lines"] = sum(s.get("overset_lines", 0) for s in man["stories_out"] + man.get("fixed_stories_out", []))
    out["overset_crosshead_words"] = sum(s.get("overset_crosshead_words", 0) for s in man["stories_out"])
    out["problems"] = len(man["problems"]) - man.get("fixed_problems", 0)

    # clean
    boxes = list(mod.values())
    out["module_overlaps"] = sum(overlap(boxes[i], boxes[j], 0.3) for i in range(len(boxes)) for j in range(i + 1, len(boxes)))
    regions = man.get("regions_mm") or [hole]                 # the newshole, or its rectangles around an ad block
    out["outside_newshole"] = sum(not any(inside(b, r) for r in regions) for b in boxes)
    area = sum((b[2] - b[0]) * (b[3] - b[1]) for b in boxes)
    out["newshole_filled_pct"] = round(100 * area / sum((r[2] - r[0]) * (r[3] - r[1]) for r in regions), 1)
    gl = [l for l in lines if l.get("story") in gen_ids]
    lb = [CMP.line_box(l["x0_mm"], l["x1_mm"], l["baseline_mm"], l["size_pt"]) for l in gl]
    out["outside_module"] = sum(not inside(b, mod[l["story"]], 1.0) for l, b in zip(gl, lb))
    photo_boxes = [s["photo_box"] for s in man["stories_out"] if s.get("photo_box")] + [b for s in man["stories_out"] for b in s.get("extra_photo_boxes") or []]
    out["over_photo"] = sum(1 for l, b in zip(gl, lb) if any(overlap(b, p) for p in photo_boxes))     # any text role
    fixed = [l for l in lines if l.get("story") not in gen_ids]
    fb = [CMP.line_box(l["x0_mm"], l["x1_mm"], l["baseline_mm"], l["size_pt"]) for l in fixed]
    fixed_boxes = fb + [b for _, b in man["fixed_boxes_mm"]]
    out["over_fixed"] = sum(1 for b in lb if any(overlap(b, f) for f in fixed_boxes))
    out["overlaps"] = CMP.boxes_overlapping(lb)
    # ink collisions from the glyph outlines (inkcheck); the fixed parts' own (e.g. the masthead) are not the generator's
    fpdf = pdf.with_name(f"{name}.fixed.pdf")
    ink, ink_fixed = inkcheck.collisions(pdf), (inkcheck.collisions(fpdf) if fpdf.exists() else [])
    fixed_pairs = {(tuple(a), tuple(b)) for _, a, b in ink_fixed}
    gen_pairs = [c for c in ink if (tuple(c[1]), tuple(c[2])) not in fixed_pairs]
    out["glyph_collisions"] = len(gen_pairs)
    out["glyph_collisions_mm2"] = [c[0] for c in gen_pairs]
    page_h = model["page_h_mm"]

    def role_at(bb):                                   # the manifest line drawn at an inkcheck line box (pt, y up)
        x0, top, bot = bb[0] / CMP.MM, page_h - bb[3] / CMP.MM, page_h - bb[1] / CMP.MM
        cands = [l for l in man["lines"] if "x1_mm" in l and abs(l["x0_mm"] - x0) < 3 and top - 1 <= l["baseline_mm"] <= bot + 2]
        return min(cands, key=lambda l: abs(l["x0_mm"] - x0) + abs(l["baseline_mm"] - (bot - 0.25 * (bot - top)))).get("role") if cands else "?"
    roles = [(role_at(a), role_at(b)) for _, a, b in gen_pairs]
    out["glyph_collisions_display"] = sum(1 for r in roles if r != ("body", "body"))
    out["glyph_collisions_body"] = sum(1 for r in roles if r == ("body", "body"))
    out["glyph_collisions_fixed_parts"] = len(ink_fixed)
    out["glyph_collisions_pdfium"] = CMP.glyph_collisions(pdf, 0)          # the EXP-PAGE-1 measure, for comparison
    out["glyph_collisions_print"] = CMP.glyph_collisions(CMP.source_pdf(ds, model["sample"]), model["page"] - 1)

    # house style
    pl = sorted(man["placed"], key=lambda p: p["rank"])
    lead = pl[0]
    out["lead_span"], out["lead_at_top"] = lead["w"], abs(lead["y"] - hole[1]) < 0.5
    head = {p["story"]: next((l["size_pt"] for l in lines if l.get("element") == f"gen-h-{p['story']}"), None) for p in pl}
    out["hierarchy_breaks"] = sum(1 for a in pl for b in pl if a["rank"] < b["rank"] and head[a["story"]] and head[b["story"]]
                                  and head[a["story"]] < head[b["story"]] - 0.5)
    # tombstone: two modules starting at the same height, side by side, with headlines within 6 pt
    out["tombstones"] = sum(1 for a in pl for b in pl if a is not b and abs(a["y"] - b["y"]) < 0.5 and abs(a["x"] + CMP_span(a["w"]) + GUT - b["x"]) < 1.0
                            and head[a["story"]] and head[b["story"]] and abs(head[a["story"]] - head[b["story"]]) < 6.0)
    ws = []
    for p in pl:
        bl = [l["baseline_mm"] for l in gl if l.get("story") == p["story"]]
        if bl:
            ws.append(round(p["y"] + p["h"] - max(bl), 2))
    out["white_at_foot_mm"] = {"median": round(st.median(ws), 2), "max": max(ws)} if ws else None
    # empty lines at column feet: per story column, the rows between its last body line and the module's last row
    empty = 0
    for so_ in man["stories_out"]:
        cols = so_.get("columns") or []
        lead = (so_.get("style") or [0, 13.0])[1] / CMP.MM
        body = [l for l in gl if l.get("story") == so_["story"] and l.get("role") == "body"]
        if not cols or not body or not lead:
            continue
        last_row = max(l["baseline_mm"] for l in body)
        for c in cols:
            inc = [l["baseline_mm"] for l in body if c[0] - 0.5 <= l["x0_mm"] <= c[2] + 0.5]
            if inc:
                empty += max(0, round((last_row - max(inc)) / lead))
    out["empty_lines_at_column_feet"] = empty
    out["spans"] = [p["w"] for p in pl]
    out["styles"] = [tuple(s.get("style") or ()) for s in man["stories_out"]]
    # printed lead for reference (span in grid columns, at the top?)
    plead = max((s for s in model["stories"] if s.get("headline") in els and s.get("bbox_mm")), key=lambda s: els[s["headline"]]["size_pt"])
    out["print_lead_span"] = max(1, min(8, round((plead["bbox_mm"][2] - plead["bbox_mm"][0] + GUT) / (COL_W + GUT))))

    # the whole page: every text element (outside ads) is drawn somewhere — by element id, or as the body text of a story
    # whose text was verified above — and every photo of the page is drawn
    ads = [e["bbox_mm"] for e in model["elements"] if e["kind"] == "ad"]

    def in_ad(bb):
        return any(a[0] - 0.5 <= bb[0] and bb[2] <= a[2] + 0.5 and a[1] - 0.5 <= bb[1] and bb[3] <= a[3] + 0.5 for a in ads)
    drawn_ids = {l.get("element") for l in man["lines"]}
    body_src = {f for so_ in man.get("synthetic_stories", []) for c in so_.get("columns") or [] for f in c.get("frame_ids") or []}
    frame_owner = {fid for so_ in list(sid.values()) for c in so_.get("columns") or [] for fid in c.get("frame_ids") or []}
    frame_owner |= {f"bf-{fid}" for fid in frame_owner}
    for so_ in sid.values():
        for b in so_.get("flow") or []:
            for ln in b.get("lines") or []:
                if ":" in str(ln.get("line_ref", "")):
                    frame_owner.add("bf-" + ln["line_ref"].split(":")[0])
    # a body frame of no story (it would vanish silently): text in body frames must belong to some story
    out["body_frames_unowned"] = [e["id"] for e in model["elements"] if e["kind"] == "body_frame" and not in_ad(e["bbox_mm"])
                                  and any(not l.get("excluded") and l.get("use", "body") == "body" and l.get("text", "").strip() for l in e.get("lines") or [])
                                  and e["id"] not in frame_owner and e["id"] not in body_src]
    out["page_text_lost"] = [e["id"] for e in model["elements"] if e["kind"] in TEXT_KINDS and e.get("text", "").split() and not e.get("run_in")
                             and not only_bullets(e["text"]) and not in_ad(e["bbox_mm"]) and e["id"] not in drawn_ids and e["id"] not in body_src
                             and e["id"] not in set((man.get("masthead") or {}).get("ids", []))      # drawn as the paper's artwork
                             and not any(e["id"] in (sid[st].get("headline_parts") or []) or e["id"] in (man["head_ids"].get(st) or [])
                                         or e["id"] in (man["deck_ids"].get(st) or []) or e["id"] in (man.get("caption_ids", {}).get(st) or [])
                                         for st in gen_ids)]
    idx = ds / "report" / "page1" / "photos" / name / "index.json"
    photo_ids = set(json.loads(idx.read_text())["elements"]) if idx.exists() else set()
    out["page_photos_lost"] = [e["id"] for e in model["elements"] if e["id"] in photo_ids and e["kind"] == "image" and not in_ad(e["bbox_mm"])
                               and e["id"] not in set(man.get("photos_drawn", [])) and e["id"] not in set(man.get("icons_not_set", []))
                               and e["id"] not in set(man.get("decoration_removed", []))]
    out["decoration_removed"] = len(man.get("decoration_removed", []))
    out["icons_not_set"] = len(man.get("icons_not_set", []))          # small decorative images of no story: reported, not a gate
    gates = {"checker_fail": out["checker"]["FAIL"] > 0, "problems": out["problems"] > 0,
             "page_text_lost": bool(out["page_text_lost"]) or bool(out["body_frames_unowned"]), "page_photos_lost": bool(out["page_photos_lost"]),
             "duplicate_text": out["duplicate_words"] > 0,
             "overset": out["overset_lines"] > 0 or out["overset_crosshead_words"] > 0, "integrity": not out["integrity_ok"],
             "accounting": bool(acct), "photos_missing": missing_photos > 0, "parts_not_set": sum(not_set.values()) > 0,
             "module_overlap": out["module_overlaps"] > 0,
             "outside_newshole": out["outside_newshole"] > 0, "outside_module": out["outside_module"] > 0,
             "over_photo": out["over_photo"] > 0, "over_fixed": out["over_fixed"] > 0,
             # display text never touches; body lines touch no more often than on the printed page (print by PDFium boxes,
             # which miss marks: a conservative comparison)
             "glyph_collisions": out["glyph_collisions_display"] > 0 or out["glyph_collisions_body"] > out["glyph_collisions_print"],
             "overlaps": out["overlaps"] > 0}
    out["gates_failed"] = [k for k, v in gates.items() if v]

    orig = CMP.render(CMP.source_pdf(ds, model["sample"]), model["page"] - 1)
    ours = CMP.render(pdf, 0)
    side = Image.new("RGB", (orig.width + ours.width + 16, max(orig.height, ours.height)), "white")
    side.paste(orig, (0, 0)); side.paste(ours, (orig.width + 16, 0))
    f = cmp_dir / f"{name}.side.png"; side.save(f); f.chmod(0o600)
    return out


def CP_fix(t: str) -> str:
    """Display text as the generator sets it: bullets decoded, run-together bullet lists too."""
    from textfix import fix_bullets_all
    return fix_bullets_all(" ".join(t.split()))


def want_ids(want, story, man):
    """The source element ids behind a story's accounting entries (gen-h/-d/-c stand for headline, deck, caption parts)."""
    src = {f"gen-h-{story}": man["head_ids"].get(story) or [], f"gen-d-{story}": man["deck_ids"].get(story) or [],
           f"gen-c-{story}": man.get("caption_ids", {}).get(story) or []}
    return [i for k in want for i in (src[k] if k in src else [k])]


def CMP_span(w: int) -> float:
    return w * COL_W + (w - 1) * GUT


def main():
    ds = Path(sys.argv[1]).expanduser()
    gdir = ds / "report" / "gen1"
    cmp_dir = gdir / "check"; cmp_dir.mkdir(parents=True, exist_ok=True)
    models = ds / "report" / "page1" / "pages"
    pages = []
    for mf in sorted(gdir.glob("*.manifest.json")):
        name = mf.name[: -len(".manifest.json")]
        man = json.loads(mf.read_text(encoding="utf-8"))
        pdf = gdir / f"{name}.pdf"
        if hashlib.sha256(pdf.read_bytes()).hexdigest() != man["sha256"]:
            sys.exit(f"{name}: PDF does not match its manifest (stale)")
        r = check(ds, name, man, json.loads((models / f"{name}.json").read_text(encoding="utf-8")), pdf, cmp_dir)
        pages.append(r)
        print(name, "PASS" if not r["gates_failed"] else f"FAIL {r['gates_failed']}", {k: r[k] for k in (
            "glyph_collisions", "glyph_collisions_print", "overlaps", "lead_span", "print_lead_span", "lead_at_top", "hierarchy_breaks", "tombstones")})
    (cmp_dir / "pages.json").write_text(json.dumps(pages, ensure_ascii=False, indent=1) + "\n"); (cmp_dir / "pages.json").chmod(0o600)
    n = len(pages)
    gen_summary = json.loads((OUT / "summary.json").read_text()) if (OUT / "summary.json").exists() else {}
    agg = {"schema": "pageinator.gen1.check/2", "generator": gen_summary.get("generator"), "pages_generated": n,
           "pages_attempted": gen_summary.get("pages"), "attempt_status": gen_summary.get("status"),
           "pages_passing_all_gates": sum(1 for p in pages if not p["gates_failed"]),
           "gate_failures": dict(Counter(g for p in pages for g in p["gates_failed"])),
           "checker_fail_pages": sum(p["checker"]["FAIL"] > 0 for p in pages),
           "text_complete_pages": sum(p["integrity_ok"] and not p["accounting_mismatches"] and not p["overset_lines"] for p in pages),
           "glyph_collisions": sum(p["glyph_collisions"] for p in pages),
           "glyph_collisions_display": sum(p["glyph_collisions_display"] for p in pages), "glyph_collisions_body": sum(p["glyph_collisions_body"] for p in pages), "glyph_collisions_print": sum(p["glyph_collisions_print"] for p in pages),
           "overlaps": sum(p["overlaps"] for p in pages), "photos_missing": sum(p["photos_missing"] for p in pages),
           "glyph_collisions_fixed_parts": sum(p["glyph_collisions_fixed_parts"] or 0 for p in pages),
           "duplicate_words": sum(p["duplicate_words"] for p in pages),
           "icons_not_set": sum(p["icons_not_set"] for p in pages), "decoration_removed": sum(p["decoration_removed"] for p in pages),
           "page_text_lost": sum(len(p["page_text_lost"]) for p in pages), "page_photos_lost": sum(len(p["page_photos_lost"]) for p in pages),
           "parts_not_set": dict(sum((Counter(p["parts_not_set"]) for p in pages), Counter())),
           "newshole_filled_pct_min": min((p["newshole_filled_pct"] for p in pages), default=None),
           "lead_at_top": sum(p["lead_at_top"] for p in pages), "lead_span_ge_print": sum(p["lead_span"] >= p["print_lead_span"] for p in pages),
           "hierarchy_breaks": sum(p["hierarchy_breaks"] for p in pages), "tombstones": sum(p["tombstones"] for p in pages),
           "empty_lines_at_column_feet": sum(p.get("empty_lines_at_column_feet", 0) for p in pages),
           "white_at_foot_mm_median": st.median([p["white_at_foot_mm"]["median"] for p in pages if p["white_at_foot_mm"]]) if pages else None}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "check.json").write_text(json.dumps(agg, indent=1) + "\n")
    print(json.dumps(agg))


if __name__ == "__main__":
    main()
