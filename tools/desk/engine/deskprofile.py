"""A paper's own house profile and script, put in place of the pilot's at run time.

gen1 (experiments/phase0/gen1) reads ONE house profile, the pilot's in the repository, when it is imported, and
compose_page.Context reads it too; both are frozen evidence. A dataset with its own house_profile.json (a paper
onboarded from its PDFs, tools/onboard) has its profile put in their place in every engine process, the main one
(desk_engine.config / setup) and each layout worker (deskfonts.worker_init), as deskfonts wraps the oracle. Without
one, the repository's values are put back exactly as gen1 imported them, so the pilot's pages never change.

This file is not part of the measurement cache's DESK_CODE (so the pilot's cache keys stay as they are): for a dataset
with its own profile or paper.json, the Context's inputs (in every cache key) carry those files' and this file's hashes.
"""
from __future__ import annotations

import hashlib
import json
import re
import statistics
from pathlib import Path

import deskfolio as DF
import deskgen as DG
from deskcommon import SCRIPT_RANGE, DamagedFile, paper

G, CP = DG.G, DG.CP
CODE_HASH = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()[:12]


REPO_GLOBALS = {k: getattr(G, k) for k in ("PROFILE", "G", "COL_W", "GUT", "ORIGIN", "NCOL", "PITCH", "SP", "DEVA",
                                           "BODY_INK_TEST")}
# gen1's spacing keys and defaults (its SP, copied: the test checks the copy gives gen1's SP from the repo's profile)
SP_DEFAULTS = (("rule_to_headline", 11.0), ("headline_to_body", 6.9), ("headline_to_deck", 10.2), ("deck_to_body", 6.8),
               ("body_to_rule", 2.5), ("photo_to_body", 5.5), ("headline_to_photo", 4.0), ("deck_to_photo", 3.5),
               ("headline_to_byline", 6.3), ("byline_to_body", 4.6), ("kicker_to_headline", 11.1), ("rule_to_photo", 1.4),
               ("rule_to_body", 5.6))
LATN_INK_TEST = "ÅÉÎ Ôbdfhkl"   # a Latin body's tallest ink (accented capitals): higher than the Devanagari test's


def house_profile_file(ds: Path) -> Path | None:
    f = ds / "house_profile.json"
    return f if f.is_file() else None


def _checked(hp: Path) -> dict:
    """The house profile, its grid checked as paper() checks paper.json (DamagedFile otherwise)."""
    try:
        prof = json.loads(hp.read_text(encoding="utf-8"))
        g = prof["grid"]
        ok = (type(g["columns"]) is int and 1 <= g["columns"] <= 20
              and all(isinstance(g[k], (int, float)) and not isinstance(g[k], bool) and 0 <= g[k] <= 1000
                      for k in ("column_width_mm", "gutter_mm", "origin_mm"))
              and g["column_width_mm"] > 0 and isinstance(prof["spacing"], dict))
    except (UnicodeDecodeError, ValueError, TypeError, KeyError):
        ok = False
    if not ok:
        raise DamagedFile("the file house_profile.json of this dataset is not a house profile the engine reads")
    return prof


def use_dataset(ds: Path) -> None:
    """gen1's grid, spacing and profile from the dataset's own house_profile.json (the repository's when it has none),
    and its script test (deva(): styles counted on stories of the paper's script) from its paper.json."""
    for k, v in REPO_GLOBALS.items():
        setattr(G, k, v)
    hp = house_profile_file(ds)
    if hp is not None:
        prof = _checked(hp)
        g = prof["grid"]
        G.PROFILE, G.G = prof, g
        G.COL_W, G.GUT, G.ORIGIN, G.NCOL = g["column_width_mm"], g["gutter_mm"], g["origin_mm"], g["columns"]
        G.PITCH = G.COL_W + G.GUT
        G.SP = {k: G._sp(k, d) for k, d in SP_DEFAULTS}
    if hasattr(G, "ST"):                                  # the Desk's copy (the frozen gen1 has no settings)
        import settings as LS
        LS.use(settings_for(ds))
    DF.ENGLISH = (paper(ds) or {}).get("script") == "latn"   # its running head's dates and numbers in English
    if DF.ENGLISH:
        G.DEVA, G.BODY_INK_TEST = SCRIPT_RANGE["latn"], LATN_INK_TEST


def settings_for(ds: Path) -> dict:
    """The layout settings (layout/settings.py) of a dataset: none (the defaults: the pilot's output exactly) unless its
    paper.json says "refined_layout": true; then the house profile's learned "layout" block, mapped."""
    lay = layout_block(ds)
    return {} if lay is None else {"refined": True} | _map_layout(lay, is_legacy(ds))


def layout_block(ds: Path) -> dict | None:
    """The house profile's learned "layout" block of a paper whose paper.json says "refined_layout": true ({} when its
    profile has none); None for every other dataset (the pilot's)."""
    if (paper(ds) or {}).get("refined_layout") is not True:
        return None
    hp = house_profile_file(ds)
    return _obj(_checked(hp).get("layout")) if hp is not None else {}


BAD_PROFILE = "the file house_profile.json of this dataset is not a house profile the engine reads"
PANEL_KINDS = ("strap", "tint", "reverse", "reverse_red", "box")
LOW_SHARE = 0.25                 # a part the paper prints on fewer stories than this is not on every story


def _num(v, lo: float, hi: float) -> float:
    """v, a number in [lo, hi] (DamagedFile otherwise: a learned value the engine cannot use is never guessed)."""
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
        raise DamagedFile(BAD_PROFILE)
    return float(v)


def _cmyk(v) -> tuple:
    if not isinstance(v, (list, tuple)) or len(v) != 4:
        raise DamagedFile(BAD_PROFILE)
    return tuple(_num(c, 0.0, 1.0) for c in v)


def _obj(v) -> dict:
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise DamagedFile(BAD_PROFILE)
    return v


def _pair(v) -> tuple:
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        raise DamagedFile(BAD_PROFILE)
    return tuple(v)


def _span_key(k: str, hi: int) -> bool:
    return re.fullmatch(r"[1-9][0-9]?", k) is not None and int(k) <= hi


def _shares(v, names: tuple) -> tuple:
    """The names (in this order) the paper was seen using: a count (or share) above 0. Unknown names refused."""
    v = _obj(v)
    if set(v) - set(names):
        raise DamagedFile(BAD_PROFILE)
    return tuple(n for n in names if n in v and _num(v[n], 0.0, 1e6) > 0)


def _present(v):
    """The learned block without its empty values (None, []): a value the paper did not show is absent."""
    if isinstance(v, dict):
        out = {k: _present(x) for k, x in v.items()}
        return {k: x for k, x in out.items() if x is not None and x != []}
    return v


def _map_layout(lay: dict, legacy: bool = False) -> dict:
    """The learned "layout" block (schema pageinator.layout/1, tools/onboard chain/house_profile.py) → settings keys
    (layout/settings.py). A missing key keeps its default; a value of the wrong type or out of range is a DamagedFile.
    Units: the generator and composer set head_sizes and body_size_pt as stand-in pt, as they are, so house sizes (in
    the legacy face's pt) are multiplied by body.visual_ratio (stand-in pt per house pt). Leadings are distances: the
    house's pt as they are."""
    lay = _present(_obj(lay))
    hd, bd, rl, ph, dn = (_obj(lay.get(k)) for k in ("headline", "body", "rules", "photos", "density"))
    out: dict = {"head_weight": int(_num(hd.get("weight", 700), 300, 900))}   # a house knob: Bold unless learned
    # house sizes in a legacy face's pt become stand-in pt; a Unicode paper's sizes are already the stand-in's
    ratio = _num(bd["visual_ratio"], 0.3, 2.0) if legacy and "visual_ratio" in bd else None
    hist = _obj(hd.get("lines_hist"))
    if any(not _span_key(k, 9) for k in hist):
        raise DamagedFile(BAD_PROFILE)
    seen = [int(k) for k, n in hist.items() if _num(n, 0, 1e9) > 0]
    if "max_lines" in hd or seen:
        out["head_max_lines"] = out["head_max_lines_1col"] = int(_num(hd["max_lines"], 1, 9)) if "max_lines" in hd else max(seen)
    if "tz_range" in hd:
        lo, hi = (_num(v, 0.3, 1.5) for v in _pair(hd["tz_range"]))
        if lo > hi:
            raise DamagedFile(BAD_PROFILE)
        out["head_tz_min"], out["head_tz_max"] = min(lo, 1.0), max(hi, 1.0)
    if "leading_em" in hd:
        out["head_leading_em"] = _num(hd["leading_em"], 0.8, 1.5)
    if "align" in hd:
        if hd["align"] not in ("centre", "center", "centred", "centred-fill", "fill", "justified", "left"):
            raise DamagedFile(BAD_PROFILE)
        if hd["align"].startswith("cent"):
            out["head_align"] = "centre"
    if hd.get("size_by_span") != {} and "size_by_span" in hd:   # {}: no headline on the grid
        sizes = _obj(hd["size_by_span"])
        if not sizes or any(not _span_key(k, 20) for k in sizes):
            raise DamagedFile(BAD_PROFILE)
        out["head_sizes"] = {int(k): round(_num(v, 6.0, 300.0) * (ratio or 1.0), 2) for k, v in sorted(sizes.items())}
    if "lead" in _obj(hd.get("lead_ratio")):
        out["lead_ratio_max"] = _num(_pair(hd["lead_ratio"]["lead"])[1], 1.0, 20.0)
    if "family" in bd:
        if bd["family"] not in ("sans", "serif"):
            raise DamagedFile(BAD_PROFILE)
        out["body_family"] = bd["family"]
    elif ratio is not None:                              # a legacy paper's stand-in body: the humanist sans (GAP §5)
        out["body_family"] = "sans"
    if "size_pt" in bd:
        out["body_size_pt"] = round(_num(bd["size_pt"], 4.0, 30.0) * (ratio or 1.0), 3)
        # one size for the edition: fitted by leading and by the width axis (the composer turns a fit into wdth only,
        # never size) within the horizontal scale the paper itself uses (≤ 4 %)
        lo, hi = (_num(v, 0.5, 1.5) for v in _pair(bd["hscale_range"])) if "hscale_range" in bd else (1.0, 1.0)
        out["body_fits"] = tuple(f for f in (1.04, 1.02, 1.0, 0.98, 0.96) if f == 1.0 or lo - 1e-9 <= f <= hi + 1e-9)
    if "leadings_pt" in bd:
        ld = bd["leadings_pt"]
        if not isinstance(ld, (list, tuple)) or not ld:
            raise DamagedFile(BAD_PROFILE)
        out["body_leadings_pt"] = tuple(sorted({_num(v, 4.0, 40.0) for v in ld}))
    if "run_in_bold_share" in _obj(lay.get("dateline")):
        out["dateline_bold"] = _num(lay["dateline"]["run_in_bold_share"], 0.0, 1.0) >= 0.5
    if "mode" in _obj(lay.get("byline")):
        if lay["byline"]["mode"] not in ("none", "line", "end"):
            raise DamagedFile(BAD_PROFILE)
        out["byline_mode"] = lay["byline"]["mode"]
    if "share" in _obj(lay.get("kicker")) and _num(lay["kicker"]["share"], 0.0, 1.0) < LOW_SHARE:
        out["kicker_mode"] = "lead"
    if "caption_share" in ph and _num(ph["caption_share"], 0.0, 1.0) < LOW_SHARE:
        out["caption_mode"] = "small"
    sep = _obj(rl.get("separator"))
    if "mode" in sep:
        if sep["mode"] not in ("tiers", "every"):
            raise DamagedFile(BAD_PROFILE)
        out["rule_mode"] = sep["mode"]
    if "weight_pt" in sep:
        out["rule_weight_pt"] = max(0.1, _num(sep["weight_pt"], 0.0, 5.0))   # a hairline prints at 0.1 pt
    if "cmyk" in sep:
        out["rule_cmyk"] = _cmyk(sep["cmyk"])
    if "white_max" in dn:
        out["white_max"] = int(_num(dn["white_max"], 0, 8))
    if "treatments" in ph and (shapes := tuple(s for s in _shares(ph["treatments"], ("rect", "ellipse", "cutout")) if s != "cutout")):
        out["photo_shapes"] = shapes                     # cut-outs need masks: not available, never chosen
    if "positions" in ph and (pos := _shares(ph["positions"], ("head", "inset", "centre"))):
        out["photo_positions"] = pos
    if "wrap_offset_mm" in ph:
        out["wrap_gap_mm"] = _num(ph["wrap_offset_mm"], 0.0, 10.0)
    if "panels" in lay:
        out["panels"] = _panels(lay["panels"])
    if "stories_per_page" in dn:
        spp = dn["stories_per_page"]
        if not isinstance(spp, (list, tuple)) or len(spp) != 3:
            raise DamagedFile(BAD_PROFILE)
        lo, mid, hi = (max(1, int(_num(v, 0, 40))) for v in spp)
        if not lo <= mid <= hi:
            raise DamagedFile(BAD_PROFILE)
        out["stories_per_page"] = (lo, hi)
    return out


def _panels(v) -> dict:
    """The learned panel treatments, each spec checked (its known fields only; layout/panels.py reads them)."""
    out = {}
    for kind, spec in sorted(_obj(v).items()):
        spec = _obj(spec)
        if kind not in PANEL_KINDS:
            raise DamagedFile(BAD_PROFILE)
        s = {k: _cmyk(spec[k]) for k in ("cmyk", "text_cmyk") if k in spec}
        if "fill" in spec:
            s["fill"] = spec["fill"] if spec["fill"] is None or isinstance(spec["fill"], bool) else _cmyk(spec["fill"])
        s |= {k: _num(spec[k], 0.0, hi) for k, hi in (("height_mm", 100.0), ("stroke_pt", 5.0), ("pad_mm", 20.0)) if k in spec}
        if "n" in spec:
            s["n"] = int(_num(spec["n"], 0, 1e9))
        out[kind] = s
    return out


def _context_init(real):
    def init(self, ds, size_mode="story"):
        real(self, ds, size_mode)
        hp = house_profile_file(Path(ds))
        if hp is not None:                                # as Context reads the repository's profile, from the paper's
            cd = json.loads(hp.read_text(encoding="utf-8")).get("composer_defaults", {})
            sp = cd.get("spacing", {})
            self.xh_above = (sp.get("crosshead_space_above") or {}).get("body_leadings", 1.0)
            self.xh_below = (sp.get("crosshead_space_below") or {}).get("body_leadings", 1.0)
            self.indent_mm = cd.get("roles", {}).get("body", {}).get("first_line_indent_mm", 5.0)
            self.inputs["house_profile.json"] = CP._sha(hp)   # in the measurement cache's key: papers never share options
        if hp is not None or paper(Path(ds)) is not None:
            self.inputs["desk_profile"] = CODE_HASH
            self.inputs["paper.json"] = CP._sha(Path(ds) / "paper.json")
    init.desk_profile = True
    return init


def _latin_paper_ratio(real):
    def ratio(self) -> float:
        """Context._paper_ratio, on the stories of a Latin-script paper (the frozen one counts Devanagari stories)."""
        if (paper(Path(self.ds)) or {}).get("script") != "latn":
            return real(self)
        lo, hi = SCRIPT_RANGE["latn"]
        ratios = []
        for f in sorted((self.ds / "report" / "page1" / "pages").glob("*.json")):
            m = json.loads(f.read_text(encoding="utf-8"))
            if m["split"] != "cal":
                continue
            ww = CP.make_words_width(m, self.frames(m["sample"], m["page"]))
            by_frame = {e["frame_id"]: e for e in m["elements"] if e["kind"] == "body_frame"}
            for s in m["stories"]:
                paras = [b for b in s["flow"] if b["type"] == "para" and b["text"].strip()]
                letters = [ch for ch in paras[0]["text"] if ch.isalpha()] if paras else []
                if not letters or not s.get("body_size_pt") or sum(lo <= ch <= hi for ch in letters) < 0.5 * len(letters):
                    continue
                w = pp = 0.0
                for b in paras:
                    try:
                        q = CP.per_pt(b["text"], CP.SERIF, CP.BODY_AXES, 400)
                    except Exception:  # noqa: BLE001 — as the frozen one
                        continue
                    for ln in b["lines"]:
                        fid, k = ln["line_ref"].rsplit(":", 1)
                        e = by_frame.get(fid)
                        if e:
                            w += ww(e["lines"][int(k)])
                    pp += q
                if w > 0 and pp > 0:
                    ratios.append((w / pp) / (s["body_size_pt"] * (s.get("body_hscale") or 1.0)))
        if not ratios:
            raise SystemExit("no calibration story in the paper's script to size the stand-in type by")
        return round(statistics.median(ratios), 5)
    return ratio


def _keep_lettering(tpl, model: dict) -> None:
    """Live text of masthead size at the page's head, outside the news, is the masthead's lettering, though the page
    model may call it a story part (a kicker) and the frozen rule then drops it. Kept, as printed (another paper only:
    the pilot's masthead is artwork)."""
    by_id = {e["id"]: e for e in model["elements"]}
    for i in list(tpl.dropped):
        e = by_id.get(i)
        if (e and e["kind"] in DG.STORY_KINDS and (e.get("size_pt") or 0) >= CP.MASTHEAD_PT
                and e["bbox_mm"][3] < min(0.25 * model["page_h_mm"], tpl.news_top)):
            tpl.keep.append(e)
            tpl.dropped.remove(i)


def _template_init(real):
    def init(self, ds, name, role):
        """Template, and for another paper (paper.json): when the news is taken down to the page's foot (no ad block
        in it), it stops 3 mm above the first thing printed below its lowest story: a foot rule, a narrow imprint line,
        or a band of ads each narrower than half the page (the frozen rule looks only at items wider than that)."""
        real(self, ds, name, role)
        if paper(Path(ds)) is None:
            return
        model = json.loads((Path(ds) / "report" / "page1" / "pages" / f"{name}.json").read_text(encoding="utf-8"))
        _keep_lettering(self, model)
        _keep_head_band(self, model)
        _drop_legacy_text(self, model, paper(Path(ds)))
        _drop_unpainted_graphics(self)
        if self.ad_block is not None:
            return
        hole, _ = G.newshole(model)
        low, x0, x1 = hole[1], G.ORIGIN, G.ORIGIN + G.span_mm(G.NCOL)
        tops = [b[1] for b in (e["bbox_mm"] for e in self.keep) if low - 0.5 < b[1] < self.news_bottom + 3.0 and min(b[2], x1) > max(b[0], x0)]
        bottom = max(low, min(tops, default=self.news_bottom + 3.0) - 3.0)
        if bottom < self.news_bottom:
            self.news_bottom = bottom
            self.regions = G.regions_for(self.news_top, bottom, None)
    init.desk_profile = True
    return init


def _head_bands(model: dict) -> list:
    """Running-head bands: a box or panel across the page's width at its head, lower than 8 % of the page."""
    w, h = model.get("page_w_mm"), model.get("page_h_mm")
    if not w or not h:
        return []
    return [e["bbox_mm"] for e in model["elements"] if e["kind"] in ("box", "graphic")
            and e["bbox_mm"][2] - e["bbox_mm"][0] >= 0.85 * w and e["bbox_mm"][1] < 0.08 * h
            and e["bbox_mm"][3] - e["bbox_mm"][1] < 0.08 * h]


def _within(bb, band) -> bool:
    return band[0] - 1 <= bb[0] and bb[2] <= band[2] + 1 and band[1] - 1.5 <= bb[1] and bb[3] <= band[3] + 1


def _keep_head_band(tpl, model: dict) -> None:
    """A running-head band (a box or panel across the page's width at its head, lower than 8 % of the page) is the
    paper's furniture, though the page model may hand its logo to the story below it: the news starts 2 mm under the
    band and everything printed inside the band stays (its text then follows the rules for kept text)."""
    bands = _head_bands(model)
    if not bands or tpl.news_top >= max(b[3] for b in bands):
        return
    band = (min(b[0] for b in bands), min(b[1] for b in bands), max(b[2] for b in bands), max(b[3] for b in bands))
    kept = {e["id"] for e in tpl.keep}
    inside = [e for e in model["elements"] if e["id"] not in kept and e["kind"] not in DG.STORY_KINDS and _within(e["bbox_mm"], band)]
    tpl.keep += inside
    tpl.dropped = sorted(set(tpl.dropped) - {e["id"] for e in inside})
    tpl.news_top = band[3] + 2.0
    tpl.regions = G.regions_for(tpl.news_top, tpl.news_bottom, tpl.ad_block)


def _drop_unpainted_graphics(tpl) -> None:
    """A vector graphic of another paper's template with no raster from the photo step (a shaded band) would print as a
    grey placeholder labelled "GRAPHIC" over its neighbours: it is left out (its boxes and rules still print)."""
    gone = {e["id"] for e in tpl.keep if e["kind"] == "graphic" and e["id"] not in tpl.photo_index}
    if gone:
        tpl.keep = [e for e in tpl.keep if e["id"] not in gone]
        tpl.dropped = sorted(set(tpl.dropped) | gone)


def _legacy_ratio(real):
    def ratio(self) -> float:
        """Context._paper_ratio of a refined paper set in a legacy font (tools/onboard: its text elements carry
        "legacy_text"): its extracted letters are not its words, so the stand-in is sized by the learned visual ratio
        (layout.body.visual_ratio: stand-in pt per house pt, measured on glyph outlines), never by that text."""
        lay = layout_block(Path(self.ds))
        if lay is None or not is_legacy(Path(self.ds)):
            return real(self)
        if "visual_ratio" not in _obj(lay.get("body")):
            raise DamagedFile(BAD_PROFILE)
        return round(_num(lay["body"]["visual_ratio"], 0.3, 2.0), 5)
    return ratio


def is_legacy(ds: Path) -> bool:
    """Does the paper's text come from a legacy font (tools/onboard marks it in paper.json, "legacy_text": true)?"""
    return (paper(ds) or {}).get("legacy_text") is True


def _drop_legacy_text(tpl, model: dict, pj: dict) -> None:
    """A legacy-font paper's printed text is never set again (its letters are a Latin map over Devanagari glyphs: the
    stand-in would print garbage). Its text elements leave the kept parts; rules, boxes, tints and pictures stay. The
    running head is drawn fresh at their places (fresh_folios), and the imprint only from paper.json's imprint_text."""
    legacy = [e for e in model["elements"] if e.get("legacy_text")]
    if not legacy:
        return
    ids = {e["id"] for e in legacy}
    gone = {e["id"] for e in tpl.keep if e["id"] in ids or e.get("legacy_text")}
    # a box below the running head that framed only that text (the strip under a masthead, an imprint band) would print
    # empty: it goes too,
    # unless paper.json gives the imprint's text, which is set again on those lines
    lb = [e["bbox_mm"] for e in legacy]
    rest = [e["bbox_mm"] for e in tpl.keep if e["id"] not in gone and e["kind"] not in ("box", "rule")]

    def holds(box, b):
        return box[0] - 0.5 <= (b[0] + b[2]) / 2 <= box[2] + 0.5 and box[1] - 0.5 <= (b[1] + b[3]) / 2 <= box[3] + 0.5
    for e in tpl.keep:
        bb = e["bbox_mm"]
        if (e["kind"] == "box" and e["id"] not in gone and not any(_within(bb, hb) for hb in _head_bands(model))   # drawn fresh
                and any(holds(bb, b) for b in lb) and not any(holds(bb, b) for b in rest)
                and not ((pj or {}).get("imprint_text") and bb[1] >= tpl.news_bottom - 1)):
            gone.add(e["id"])
    tpl.keep = [e for e in tpl.keep if e["id"] not in gone]
    tpl.dropped = sorted(set(tpl.dropped) | gone)
    tpl.legacy_text = legacy
    tpl.imprint_text = list((pj or {}).get("imprint_text") or [])


DATE_SAMPLE = ("सोमवार, १ जानेवारी २०००", "Monday, 1 January 2000")   # rewritten with deskfolio's words for the day


def fresh_folios(tpl, page: int, day) -> list:
    """[(slot element, [text])] a legacy paper's page draws afresh (geometry only, from the text elements it dropped):
    the date centred in the folio band, the page number where the printed one stood (at the band's right; not on the
    front page), and paper.json's imprint lines on the dropped lines below the news, one each (none: nothing)."""
    legacy = getattr(tpl, "legacy_text", None)
    if not legacy:
        return []
    out = []
    top = sorted((e for e in legacy if e["kind"] == "folio" and e["bbox_mm"][3] < 0.12 * tpl.page_h), key=lambda e: e["bbox_mm"][0])
    if top:
        y0, y1 = min(e["bbox_mm"][1] for e in top), max(e["bbox_mm"][3] for e in top)
        wide = [e["bbox_mm"] for e in tpl.keep if e["kind"] in ("box", "rule") and e["bbox_mm"][2] - e["bbox_mm"][0] >= 0.5 * tpl.page_w
                and e["bbox_mm"][1] <= y1 + 1.0 and e["bbox_mm"][3] >= y0 - 1.0]
        x0, x1 = (min(b[0] for b in wide), max(b[2] for b in wide)) if wide else (G.ORIGIN, G.ORIGIN + G.span_mm(G.NCOL))
        mid = (x0 + x1) / 2
        date_el = min(top, key=lambda e: (abs((e["bbox_mm"][0] + e["bbox_mm"][2]) / 2 - mid), e["bbox_mm"][0]))
        date = DF.rewrite(DATE_SAMPLE[DF.ENGLISH], day, page, 0)
        out.append(({"id": "fresh-date", "kind": "folio", "fresh": _slot(date_el, mid, "center", True, 0.5 * (x1 - x0))}, [date]))
        num_el = top[-1]
        if tpl.role != "front" and num_el is not date_el:
            nb = num_el["bbox_mm"]
            out.append(({"id": "fresh-page", "kind": "folio", "fresh": _slot(num_el, (nb[0] + nb[2]) / 2, "center", True, None)},
                        [str(page) if DF.ENGLISH else DF.digits_like("०", page)]))
    lines = sorted(((ln, e) for e in legacy if e["bbox_mm"][1] >= tpl.news_bottom - 1.0 for ln in e.get("lines") or []),
                   key=lambda le: (le[0]["baseline_mm"], le[0]["x0_mm"]))
    for k, (text, (ln, e)) in enumerate(zip(tpl.imprint_text, lines)):
        if text.strip():
            slot = {**_slot(e, ln["x0_mm"], "left", False, ln["x1_mm"] - ln["x0_mm"]), "baseline_mm": ln["baseline_mm"]}
            out.append(({"id": f"fresh-imprint-{k + 1}", "kind": "furniture", "fresh": slot}, [text]))
    return out


def _slot(e: dict, x: float, align: str, bold: bool, max_w) -> dict:
    lines = e.get("lines") or []
    return {"x_mm": x, "baseline_mm": lines[0]["baseline_mm"] if lines else e["bbox_mm"][3], "size_pt": e.get("size_pt") or 10.0,
            "align": align, "bold": bold, "max_w_mm": max_w, "colour": e.get("colour"), "colour_cmyk": e.get("colour_cmyk")}


def _folio_plan(real):
    def plan(tpl, page, pages, day, edition):
        keep, redo = real(tpl, page, pages, day, edition)
        return keep, redo + fresh_folios(tpl, page, day)
    plan.desk_profile = True
    return plan


def _draw_folios(real):
    def draw(B, tpl, cx, redo, rep):
        """The running head's changed lines (deskgen.draw_folios), then a legacy paper's fresh lines: the house size
        in stand-in pt (× the paper's ratio), the stand-in sans (Bold for the date and number), never wider than room."""
        done = real(B, tpl, cx, [r for r in redo if "fresh" not in r[0]], rep)
        for e, (text,) in (r for r in redo if "fresh" in r[0]):
            s = e["fresh"]
            family, axes, wt = CP.role_font("Bold" if s["bold"] else "", e["kind"])
            size = s["size_pt"] * (cx.r_cal or 1.0)
            width = CP.per_pt(text, family, axes, wt, spaces=True) / DG.MM * size
            if s["max_w_mm"] and width > s["max_w_mm"]:
                size *= s["max_w_mm"] / width
            B.text_line(text, B.font(family, axes, wt), round(size, 3), s["x_mm"], s["baseline_mm"], CP._colour(s, rep), s["align"],
                        meta={"page": tpl.model["page"], "role": e["kind"], "element": e["id"], "desk": "folio"})
            done.append(e["id"])
        return done
    draw.desk_profile = True
    return draw


if not getattr(CP.Context.__init__, "desk_profile", False):
    CP.Context.__init__ = _context_init(CP.Context.__init__)
    CP.Context._paper_ratio = _legacy_ratio(_latin_paper_ratio(CP.Context._paper_ratio))
    DG.Template.__init__ = _template_init(DG.Template.__init__)
    DG.folio_plan = _folio_plan(DG.folio_plan)
    DG.draw_folios = _draw_folios(DG.draw_folios)
