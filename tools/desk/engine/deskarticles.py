"""Desk articles → the story and element records the Phase-0 generator (gen1) lays out.

gen1 reads a page model: elements (headline, deck, byline, caption, crosshead … with text and size) and stories
(which elements belong to them, and the body flow: paragraphs and crossheads). An article typed into the Desk is
turned into exactly those records. Nothing printed is copied: the generator chooses every size and position.
"""
from __future__ import annotations

from deskcommon import nfc, one_line

BRIEF_WORDS = 60                 # gen1.BRIEF_WORDS: a short item has at most this many body words and no photo
HOUSE_BODY_BOLD = "HouseBody-Bold"   # role_font(): "Body" + "Bold" → the serif stand-in, bold (the house's own body face)
INDENT = 5.0                     # any value > 0.5: gen1 then applies the house's first-line indent (nearly every printed
                                 # paragraph is indented, the first one included)
KICKER_PT, BYLINE_PT, CAPTION_PT, CROSSHEAD_PT = 22.8, 13.0, 13.0, 12.0   # house medians (page models)


SENTENCE_END = ".!?।॥:;\"'”’)"


def is_subheading(line: str) -> bool:
    return line.strip().startswith("##")


def blocks(body: str) -> list[tuple[str, str]]:
    """Body text → [("para", text) | ("crosshead", text)].
    - A line that starts with "##" is a subheading, wherever it stands.
    - Paragraphs are separated by empty lines; the lines inside one are joined with spaces.
    - Text pasted from WhatsApp or a word processor often has no empty line at all, one paragraph per line: when most
      of its lines end a sentence, every line is a paragraph (lines broken at the margin end mid-sentence: joined).
    The server and the UI count words with this same parser (tools/desk/deskserver imports it)."""
    raw = nfc(body).split("\n")
    text = [ln.strip() for ln in raw if ln.strip() and not is_subheading(ln)]
    blank_inside = any(not ln.strip() for ln in raw)
    per_line = not blank_inside and len(text) > 1 and sum(ln[-1] in SENTENCE_END for ln in text) >= 0.6 * len(text)
    out, cur = [], []

    def flush():
        if cur:
            out.append(("para", " ".join(" ".join(cur).split())))
            cur.clear()
    for ln in raw:
        s = ln.strip()
        if not s:
            flush()
        elif is_subheading(s):
            flush()
            head = " ".join(s.lstrip("#").split())
            if head:
                out.append(("crosshead", head))
        else:
            cur.append(s)
            if per_line:
                flush()
    flush()
    return out


def body_words(body: str) -> int:
    return sum(len(t.split()) for kind, t in blocks(body) if kind == "para")


def is_brief(article: dict) -> bool:
    return not article.get("photo") and 0 < body_words(article.get("body", "")) <= BRIEF_WORDS


def story_id(article_id: str) -> str:
    return "d" + article_id[2:]


def caption_text(photo: dict | None) -> str:
    if not photo:
        return ""
    cap, credit = one_line(photo.get("caption")), one_line(photo.get("credit"))
    if cap and credit:
        return f"{cap} (छाया: {credit})"
    return cap or (f"छाया: {credit}" if credit else "")


def _el(eid: str, kind: str, text: str, size_pt: float, font: str = HOUSE_BODY_BOLD, **extra) -> dict:
    return {"id": eid, "kind": kind, "text": text, "size_pt": size_pt, "font": font, "bbox_mm": [0.0, 0.0, 0.0, 0.0],
            "lines": [], "synthetic": True, **extra}


def _crosshead(eid: str, text: str) -> dict:
    # gen1 re-anchors a crosshead to the generated columns from its first printed line (neutral_els): one line is enough
    return _el(eid, "crosshead", text, CROSSHEAD_PT, lines=[{"text": text, "baseline_mm": 0.0, "x0_mm": 0.0, "x1_mm": 30.0}],
               bbox_mm=[0.0, 0.0, 30.0, 5.0])


def _para(text: str) -> dict:
    return {"type": "para", "text": text, "indent_mm": INDENT, "lines": [{"line_ref": "gen:0", "col": 0, "text": text}]}


def to_story(article: dict, rank_size: float, photo_ids: set) -> tuple[dict, list[dict]]:
    """One article → (story, elements). rank_size orders the stories (gen1 ranks by headline size: the larger, the
    more important); the size the headline is set at comes from the house's size-by-span table."""
    sid = story_id(article["id"])
    els, flow = [], []
    head = _el(f"{sid}-h", "headline", one_line(article.get("headline")), rank_size)
    els.append(head)
    story = {"id": sid, "synthetic": True, "desk_article": article["id"], "headline": head["id"], "headline_parts": [],
             "kicker": None, "decks": [], "byline": None, "captions": [], "images": [], "jump_lines": [],
             "other_elements": [], "parent_story": None, "columns": [], "flow": flow}
    if one_line(article.get("kicker")):
        els.append(_el(f"{sid}-k", "kicker", one_line(article["kicker"]), KICKER_PT))
        story["kicker"] = f"{sid}-k"
    if one_line(article.get("deck")):
        els.append(_el(f"{sid}-d", "deck", one_line(article["deck"]), 22.0))
        story["decks"] = [f"{sid}-d"]
    if one_line(article.get("byline")):
        els.append(_el(f"{sid}-b", "byline", one_line(article["byline"]), BYLINE_PT))
        story["byline"] = f"{sid}-b"
    photo = article.get("photo")
    if photo and photo.get("id") in photo_ids:
        story["images"] = [photo["id"]]
        cap = caption_text(photo)
        if cap:
            els.append(_el(f"{sid}-c", "caption", cap, CAPTION_PT))
            story["captions"] = [f"{sid}-c"]
    for n, (kind, text) in enumerate(blocks(article.get("body", ""))):
        if kind == "crosshead":
            els.append(_crosshead(f"{sid}-x{n}", text))
            flow.append({"type": "crosshead", "element": f"{sid}-x{n}"})
        else:
            flow.append(_para(text))
    return story, els


def briefs_story(articles: list[dict], key: str) -> tuple[dict, list[dict]]:
    """Short items of one page → one "news in brief" module: each item's headline as a crosshead before its text (as
    gen1 stacks printed briefs, merge_briefs)."""
    sid = f"dbriefs{key}"
    els, flow = [], []
    for k, a in enumerate(articles):
        xid = f"{sid}-x{k}"
        els.append(_crosshead(xid, one_line(a.get("headline"))))
        flow.append({"type": "crosshead", "element": xid})
        for kind, text in blocks(a.get("body", "")):
            if kind == "para":
                flow.append(_para(text))
    story = {"id": sid, "synthetic": True, "desk_briefs": [a["id"] for a in articles], "headline": None, "headline_parts": [],
             "kicker": None, "decks": [], "byline": None, "captions": [], "images": [], "jump_lines": [], "other_elements": [],
             "parent_story": None, "columns": [], "flow": flow}
    return story, els
