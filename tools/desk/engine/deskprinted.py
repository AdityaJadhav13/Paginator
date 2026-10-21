"""What a page prints, as short signatures, so the Desk can tell when a page's PDF no longer matches the edition.

A page records, when it is laid out and each time it is saved from the editor, what it printed: for each article the
text and photo it printed, for a front page the folio's volume, issue and price, and for a page with ads the ads. When
the edition changes later (an article corrected or deleted, a new issue number, another ad), the page "needs saving"
until it is saved with the new content; a save that still prints the old content leaves it so. The engine and the
Desk's server both use this module, so they always agree on what "changed" means.

What counts is what prints: an article's text line by line as the engine reads it (spacing inside a line and extra
empty lines print the same, so they are no change), and for a short item only its headline and text (the rest never
prints)."""
from __future__ import annotations

import hashlib
import json
import unicodedata
from pathlib import Path

from deskarticles import is_subheading
from deskcommon import DamagedFile, nfc

EDITION_FIELDS = ("volume", "issue", "price")
VERSION = 3                       # how signatures are made: a record made another way is never compared (3: the
                                  # folio as it prints, spaces included)
OLDER = ("This page was made by an older version of the Desk, which recorded what its PDF prints in another way: "
         "open it in the page editor and save it (or lay out again).")
ISSUE_NOT_SET = "Issue number (अंक) not set in step 1: the front page keeps the old number"


def _n(v) -> str:
    return " ".join(unicodedata.normalize("NFC", str(v or "")).split())


def _sig(obj) -> str:
    return hashlib.sha256(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:20]


def _lines(body, brief: bool) -> list[str]:
    """The body as the engine reads it, line by line: spaces inside a line collapsed, a run of empty lines kept as one,
    and in a short item a subheading as a bare "##" (it never prints there, but it still ends a paragraph). Finer than
    the paragraphs on purpose: the engine first removes characters the fonts lack, and one removed at the end of a line
    can change which lines join into a paragraph, so two texts with one signature must have the same lines."""
    out = []
    for ln in nfc(str(body or "")).split("\n"):
        s = " ".join(ln.split())
        if brief and is_subheading(s):
            s = "##"
        if s or (out and out[-1]):
            out.append(s)
    return out


def article_sig(article: dict, brief: bool) -> str:
    """What an article prints: a story its kicker, headline, deck, byline, text and photo (with caption and credit); a
    short item its headline and text."""
    out = {"headline": _n(article.get("headline")), "body": _lines(article.get("body"), brief)}
    if not brief:
        photo = article.get("photo") if isinstance(article.get("photo"), dict) else None
        out.update(kicker=_n(article.get("kicker")), deck=_n(article.get("deck")), byline=_n(article.get("byline")),
                   photo=[str(photo.get("id") or ""), _n(photo.get("caption")), _n(photo.get("credit"))] if photo else None)
    return _sig(out)


def folio_sig(edition: dict) -> str:
    """The edition fields a front-page folio prints (volume, issue, price), as it prints them (spaces included)."""
    return _sig([unicodedata.normalize("NFC", str(edition.get(k) or "")) for k in EDITION_FIELDS])


def file_sig(path: Path) -> str | None:
    """A raster file's signature (None: no such file)."""
    try:
        return _sig(hashlib.sha256(path.read_bytes()).hexdigest())
    except OSError:
        return None


class AdIndexDamaged(DamagedFile):
    """An ads folder's index.json that cannot be read, or is not an index ({"elements": {…}})."""


def ad_elements(ads_dir: Path) -> dict:
    """An ads folder's index entries ({slot: record}). No index.json: no ads. One that cannot be read, or is not an
    index, raises AdIndexDamaged: it is never read as "no ads" (that could make a page that needs saving current)."""
    path = ads_dir / "index.json"
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError, RecursionError) as e:
        raise AdIndexDamaged(f"the ads index of {ads_dir.parent.name} cannot be read") from e
    elements = doc.get("elements") if isinstance(doc, dict) else None
    if not isinstance(elements, dict):
        raise AdIndexDamaged(f"the ads index of {ads_dir.parent.name} is not an index")
    return elements


def ad_sigs(ads_dir: Path) -> dict[str, str]:
    """The ads a folder holds as the engine places them, an entry in its index.json and the raster beside it:
    {slot: signature}. A raster without its entry (or the other way round) is no ad, as on the page. A damaged index
    raises (ad_elements)."""
    out = {}
    for slot in ad_elements(ads_dir):
        sig = file_sig(ads_dir / f"{slot}.cmyk.gz")
        if sig is not None:
            out[slot] = sig
    return out


def unset(printed: dict | None, edition: dict) -> list[str]:
    """The page card's warnings for what the page prints from the edition's own fields that is not set: a folio's issue
    number (the layout run says the same)."""
    if isinstance(printed, dict) and printed.get("folio") is not None and not _n(edition.get("issue")):
        return [ISSUE_NOT_SET]
    return []


def briefs_of(plan: dict) -> set[str]:
    """Article ids a run's plan sets as short items."""
    return {aid for f in (plan or {}).values() if isinstance(f, dict) and f.get("brief") for aid in f.get("articles") or []}


def stale(printed: dict, articles: dict, briefs: set[str], edition: dict, ads: dict) -> list[str]:
    """Why a page's PDF no longer prints what the edition holds now ([] when it does). printed: the page's record
    ({"v": VERSION, "articles": {id: sig}, "folio": sig or None, "ads": {slot: sig or None}}); articles: the edition's articles by
    id; briefs: the run's short items; ads: the edition's ads now (ad_sigs)."""
    if printed.get("v") != VERSION:
        return [OLDER]
    out = []
    recorded = printed.get("articles") or {}
    gone = [a for a in recorded if a not in articles]
    changed = [a for a, s in recorded.items() if a in articles and article_sig(articles[a], a in briefs) != s]
    if changed:
        out.append(f"{_count(changed, 'article')} changed since the page's PDF was made: open the page and save it "
                   "(Save page sets the current text first).")
    if gone:
        out.append(f"{_count(gone, 'article')} deleted from the edition: open the page and save it (Save page takes "
                   f"{'it' if len(gone) == 1 else 'them'} off first).")
    if printed.get("folio") is not None and printed["folio"] != folio_sig(edition):
        out.append("The volume, issue or price changed: open the page and save it.")
    if any(ads.get(slot) != s for slot, s in (printed.get("ads") or {}).items()):
        out.append("An advertisement on this page changed: open the page and save it (Save page sets the new one first).")
    return out


def _count(ids: list, word: str) -> str:
    return f"An {word} on this page was" if len(ids) == 1 else f"{len(ids)} {word}s on this page were"
