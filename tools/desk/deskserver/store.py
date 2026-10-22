"""Storage (CONTRACT.md §1): editions, articles, photos and ads in the desk home. JSON files are written atomically,
directories are 0700 and files 0600. Each edition has its own lock; reads rely on the atomic writes."""
from __future__ import annotations

import os
import re
import shutil
import sys
import threading
import traceback
import unicodedata
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import deskarticles  # noqa: E402  (the engine's own text parser: the Desk counts words the way it lays them out)

from . import images  # noqa: E402
from .bundle import tombstone  # noqa: E402
from . import messages as M  # noqa: E402
from .press import edition_now, mark_damaged, recheck_status
from .util import (EDITION_ID, PHOTO_ID, RUN_ID, SLOT_ID, ARTICLE_ID, DeskError, clean_text, ensure_dir, new_id,
                   now_iso, path_id, read_json, remove_quietly, write_bytes, write_json)

EDITION_SCHEMA = "pageinator.desk.edition/1"
ARTICLES_SCHEMA = "pageinator.desk.articles/1"
PAGES = (4, 8, 16)
PRIORITIES = (1, 2, 3, 4)
BRIEF_WORDS = 60
LINE_LIMIT = 2000             # headline, kicker, deck, byline, caption, credit
BODY_LIMIT = 200_000
EDITION_TEXT_LIMIT = 200      # volume, issue, price
TEXT_FIELDS = (("headline", "headline", LINE_LIMIT), ("kicker", "kicker", LINE_LIMIT), ("deck", "deck", LINE_LIMIT),
               ("byline", "byline", LINE_LIMIT), ("body", "article text", BODY_LIMIT))
EDITION_TEXT = (("volume", "volume"), ("issue", "issue number"), ("price", "price"))
AD_BUSY = M.msg("m.store.adBusy")

PHOTO_FILE = re.compile(r"(p-[0-9a-f]{10})\.(?:orig\.[a-z0-9]{2,5}|jpg|cmyk\.gz)")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
_PARAGRAPHS = re.compile(r"\n\s*\n")
_SEPARATOR = re.compile(r"\s*-{3,}\s*")
_BYLINE = re.compile(r"\s*(?:byline|वार्ताहर)\s*[:：]\s*[-–—]?\s*(.*)", re.IGNORECASE)   # "वार्ताहर :- …" too
PRINTED = ("headline", "kicker", "deck", "byline", "body")          # what an article prints (and its photo)


# ------------------------------------------------------------------------------------------ article rules


def count_words(body: str) -> int:
    """Body words as the layout engine counts them (deskarticles.blocks): paragraphs only, subheadings not counted."""
    return deskarticles.body_words(body or "")


def decorate(article: dict) -> dict:
    """The article plus `words` and `is_brief` (1 to 60 body words and no photo, as the engine decides)."""
    words = count_words(article.get("body") or "")
    return {**article, "words": words, "is_brief": 0 < words <= BRIEF_WORDS and not article.get("photo")}


def parse_bulk(text: Any) -> list[dict]:
    """Pasted articles, separated by a line of only `---`. In each: the first non-empty line is the headline; the next
    non-empty line, when it starts with `Byline:` (any case) or `वार्ताहर:`, is the byline; the rest is the body.
    Chunks with nothing in them are skipped."""
    if not isinstance(text, str):
        raise DeskError(400, M.msg("m.store.pasteText"))
    text = unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))
    chunks: list[list[str]] = [[]]
    for line in text.split("\n"):
        if _SEPARATOR.fullmatch(line):
            chunks.append([])
        else:
            chunks[-1].append(line)
    items = []
    for lines in chunks:
        filled = [k for k, line in enumerate(lines) if line.strip()]
        if not filled:
            continue
        head, start, byline = filled[0], filled[0] + 1, ""
        if len(filled) > 1 and (m := _BYLINE.fullmatch(lines[filled[1]])):
            byline, start = m.group(1), filled[1] + 1
        items.append({"headline": lines[head], "byline": byline, "body": "\n".join(lines[start:])})
    return items


def _date(value: Any) -> str:
    if not isinstance(value, str) or not _DATE.fullmatch(value.strip()):
        raise DeskError(400, M.msg("m.store.dateFormat"))
    value = value.strip()
    try:
        date.fromisoformat(value)
    except ValueError:
        raise DeskError(400, M.msg("m.store.notADate", value=value)) from None
    return value


def _int(value: Any) -> Any:
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def parse_pages(value: Any) -> int:
    value = _int(value)
    if not isinstance(value, int) or isinstance(value, bool) or value not in PAGES:
        raise DeskError(400, M.msg("m.store.pages"))
    return value


def _bool(value: Any, message: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    raise DeskError(400, message)


def _priority(value: Any) -> int:
    value = _int(value)
    if not isinstance(value, int) or isinstance(value, bool) or value not in PRIORITIES:
        raise DeskError(400, M.msg("m.store.priority"))
    return value


def _page(value: Any, pages: int) -> int | None:
    if value is None or value == "":
        return None
    value = _int(value)
    if not isinstance(value, int) or isinstance(value, bool) or not 1 <= value <= pages:
        raise DeskError(400, M.msg("m.store.pageRange", pages=pages))
    return value


def _apply(article: dict, fields: dict, edition: dict) -> None:
    for key, label, limit in TEXT_FIELDS:
        if key in fields:
            article[key] = clean_text(fields[key], label, limit)
    if "priority" in fields:
        article["priority"] = _priority(fields["priority"])
    if "page" in fields:
        article["page"] = _page(fields["page"], edition.get("pages") if edition.get("pages") in PAGES else 16)
    if not article["headline"]:
        raise DeskError(400, M.msg("m.store.needHeadline"))
    if not article["body"]:
        raise DeskError(400, M.msg("m.store.needText"))


def _find(articles: list[dict], aid: str) -> dict:
    for a in articles:
        if a.get("id") == aid:
            return a
    raise DeskError(404, "There is no such article in this edition.")


def _mtime(path: Path) -> int | None:
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return None


def _order(summary: dict) -> tuple:
    eid = summary["id"]
    return eid[:10], int(eid[11:] or 1)


# ------------------------------------------------------------------------------------------------- store


class Store:
    def __init__(self, home: Path):
        self.home = Path(home)
        self.editions_dir = ensure_dir(self.home / "editions")
        self.trash_dir = self.home / "trash"
        self.is_active: Callable[[str], bool] = lambda eid: False      # set by the job manager
        self.articles_changed: Callable[[str], None] = lambda eid: None  # set by the measurer
        self.edition_closing: Callable[[str], None] = lambda eid: None   # likewise: stop work on a deleted edition
        self.is_saving: Callable[[str], bool] = lambda eid: False      # set by the app: a page of it is being saved
        self._locks: dict[str, threading.RLock] = {}
        self._guard = threading.Lock()
        self._summaries: dict[str, tuple[tuple, dict]] = {}
        self._preview_lock = threading.Lock()

    def lock(self, eid: str) -> threading.RLock:
        path_id(EDITION_ID, eid, "edition")
        with self._guard:
            return self._locks.setdefault(eid, threading.RLock())

    def edition_dir(self, eid: str) -> Path:
        return self.editions_dir / path_id(EDITION_ID, eid, "edition")

    def require(self, eid: str) -> Path:
        d = self.edition_dir(eid)
        if not (d / "edition.json").is_file():
            raise DeskError(404, "There is no such edition.")
        return d

    # ------------------------------------------------------------------------------------------ editions

    def list_editions(self) -> list[dict]:
        out = []
        for d in self.editions_dir.iterdir():
            if EDITION_ID.fullmatch(d.name) and (d / "edition.json").is_file():
                try:
                    out.append(self._summary(d))
                except DeskError as e:
                    out.append({"id": d.name, "date": d.name[:10], "pages": None, "articles": 0, "words": 0,
                                "photos": 0, "last_run": None, "error": e.message})
        out.sort(key=_order, reverse=True)
        return out

    def _summary(self, d: Path) -> dict:
        runs = self._run_ids(d)
        latest = runs[0] if runs else None
        stamp = (_mtime(d / "edition.json"), _mtime(d / "articles.json"), latest,
                 _mtime(d / "runs" / latest / "status.json") if latest else None)
        cached = self._summaries.get(d.name)
        if cached and cached[0] == stamp:
            return cached[1]
        edition = read_json(d / "edition.json")
        articles = self._doc(d)["articles"]
        summary = {"id": d.name, "date": edition.get("date"), "pages": edition.get("pages"),
                   "articles": len(articles), "words": sum(count_words(a.get("body") or "") for a in articles),
                   "photos": sum(1 for a in articles if a.get("photo")),
                   "last_run": self._run_entry(d, latest) if latest else None}
        self._summaries[d.name] = (stamp, summary)
        return summary

    def create_edition(self, fields: dict) -> dict:
        day = _date(fields.get("date"))
        pages = parse_pages(fields.get("pages", 8))
        back = _bool(fields.get("back_page_ads", True), "Say whether the back page has ads: true or false.")
        texts = {key: clean_text(fields.get(key, ""), label, EDITION_TEXT_LIMIT) for key, label in EDITION_TEXT}
        for n in range(1, 1000):
            eid = day if n == 1 else f"{day}-{n}"
            d = self.editions_dir / eid
            try:
                d.mkdir(mode=0o700)
            except FileExistsError:
                continue
            break
        else:
            raise DeskError(409, M.msg("m.store.tooManyEditions"))
        os.chmod(d, 0o700)
        for sub in ("photos", "ads", "runs"):
            ensure_dir(d / sub)
        now = now_iso()
        edition = {"schema": EDITION_SCHEMA, "id": eid, "date": day, "pages": pages, "back_page_ads": back,
                   **texts, "created": now, "updated": now}
        with self.lock(eid):
            write_json(d / "articles.json", {"schema": ARTICLES_SCHEMA, "articles": []})
            write_json(d / "edition.json", edition)
        return edition

    def get_edition(self, eid: str) -> dict:
        return read_json(self.require(eid) / "edition.json")

    def update_edition(self, eid: str, fields: dict) -> dict:
        with self.lock(eid):
            d = self.require(eid)
            edition = read_json(d / "edition.json")
            if "date" in fields and fields["date"] != edition.get("date"):
                raise DeskError(400, M.msg("m.store.dateFixed"))
            if "pages" in fields:
                edition["pages"] = parse_pages(fields["pages"])
            if "back_page_ads" in fields:
                edition["back_page_ads"] = _bool(fields["back_page_ads"],
                                                 "Say whether the back page has ads: true or false.")
            for key, label in EDITION_TEXT:
                if key in fields:
                    edition[key] = clean_text(fields[key], label, EDITION_TEXT_LIMIT)
            edition["updated"] = now_iso()
            write_json(d / "edition.json", edition)
            self._recheck_runs(d)                              # a new volume, issue or price changes the front page
            return edition

    def delete_edition(self, eid: str) -> str:
        """Moves the edition folder to <home>/trash/<id>-<timestamp>; returns that folder's name."""
        with self.lock(eid):
            d = self.require(eid)
            if self.is_active(eid):
                raise DeskError(409, M.msg("m.store.deleteRunning"))
            if self.is_saving(eid):
                raise DeskError(409, M.msg("m.store.deleteSaving"))
            self.edition_closing(eid)
            ensure_dir(self.trash_dir)
            stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
            target, n = self.trash_dir / f"{eid}-{stamp}", 2
            while target.exists():
                target, n = self.trash_dir / f"{eid}-{stamp}-{n}", n + 1
            os.rename(d, target)
            self._summaries.pop(eid, None)
            return target.name

    # ------------------------------------------------------------------------------------------ articles

    def _doc(self, d: Path) -> dict:
        doc = read_json(d / "articles.json", default=None)
        if doc is None:
            doc = {"schema": ARTICLES_SCHEMA, "articles": []}
        if not isinstance(doc, dict) or not isinstance(doc.get("articles"), list):
            raise DeskError(500, "The articles file of this edition is damaged and cannot be read.")
        doc["articles"] = [a for a in doc["articles"] if isinstance(a, dict)]
        return doc

    def _save(self, d: Path, doc: dict) -> None:
        doc.setdefault("schema", ARTICLES_SCHEMA)
        write_json(d / "articles.json", doc)

    def read_articles(self, eid: str) -> list[dict]:
        return self._doc(self.require(eid))["articles"]

    def require_article(self, eid: str, aid: str) -> dict:
        return _find(self.read_articles(eid), path_id(ARTICLE_ID, aid, "article"))

    @staticmethod
    def _new_article(articles: list[dict], fields: dict, edition: dict, source: str) -> dict:
        taken = {a.get("id") for a in articles}
        aid = new_id("a-")
        while aid in taken:
            aid = new_id("a-")
        now = now_iso()
        article = {"id": aid, "headline": "", "kicker": "", "deck": "", "byline": "", "body": "", "priority": 3,
                   "page": None, "photo": None, "source": source, "created": now, "updated": now}
        _apply(article, fields, edition)
        return article

    def create_article(self, eid: str, fields: dict) -> dict:
        source = fields.get("source") if fields.get("source") in ("typed", "pasted") else "typed"
        with self.lock(eid):
            d = self.require(eid)
            edition = read_json(d / "edition.json")
            doc = self._doc(d)
            article = self._new_article(doc["articles"], fields, edition, source)
            doc["articles"].append(article)
            self._save(d, doc)
            self.articles_changed(eid)
            return decorate(article)

    def update_article(self, eid: str, aid: str, fields: dict) -> dict:
        with self.lock(eid):
            d = self.require(eid)
            edition = read_json(d / "edition.json")
            doc = self._doc(d)
            article = _find(doc["articles"], aid)
            changed = dict(article)
            _apply(changed, fields, edition)
            changed["updated"] = now_iso()
            printed = any(changed.get(k) != article.get(k) for k in PRINTED)
            article.clear()
            article.update(changed)
            self._save(d, doc)
            if printed:
                self._recheck_runs(d)
            self.articles_changed(eid)
            return decorate(article)

    def delete_article(self, eid: str, aid: str) -> None:
        with self.lock(eid):
            d = self.require(eid)
            doc = self._doc(d)
            article = _find(doc["articles"], aid)
            doc["articles"].remove(article)
            if (gone := tombstone(article)) is not None:      # an imported story is never imported again (§6)
                doc.setdefault("bundle_deleted", []).append(gone)
            self._save(d, doc)
            self._recheck_runs(d)
            self.articles_changed(eid)
            self.gc_photos(eid)

    @staticmethod
    def _recheck_runs(d: Path) -> None:
        """The edition changed (an article's text or photo, a deletion, the folio fields, an ad): every finished
        layout of it is checked again, and a page whose PDF prints older content "needs saving" (press.refresh_stale).
        A run whose files cannot be read is left out (and said in the server log); the others are still checked."""
        now, unreadable = None, False
        for status_path in sorted((d / "runs").glob("r-*/status.json"), reverse=True):     # the newest first
            try:
                status = read_json(status_path, default=None)
                if not isinstance(status, dict) or status.get("state") != "done":
                    continue
                if now is None and not unreadable:
                    try:
                        now = edition_now(d)
                    except Exception as e:  # noqa: BLE001 — the edition cannot be read: none of its layouts is current
                        unreadable = True
                        print(f"[desk] {d.name}: its files cannot be read ({e})", file=sys.stderr)
                if unreadable:
                    mark_damaged(status, status_path.parent)
                else:
                    recheck_status(status, status_path.parent, now)
            except Exception as e:  # noqa: BLE001 — one damaged run never stops the others being checked
                print(f"[desk] {status_path.parent.name}: could not be checked against the edition ({e})", file=sys.stderr)

    def bulk_create(self, eid: str, text: Any) -> dict:
        return self.create_many(eid, parse_bulk(text), "pasted")

    def create_many(self, eid: str, items: list[dict], source: str) -> dict:
        """Several articles at once ({headline, byline, body} each); one that is not accepted is skipped and said."""
        with self.lock(eid):
            d = self.require(eid)
            edition = read_json(d / "edition.json")
            doc = self._doc(d)
            created, skipped = [], []
            for item in items:
                try:
                    article = self._new_article(doc["articles"], item, edition, source)
                except DeskError as e:
                    skipped.append({"headline": item["headline"].strip()[:200], "reason": e.message})
                    continue
                doc["articles"].append(article)
                created.append(article)
            if not created:
                if source == "word":
                    reasons = "; ".join(sorted({s["reason"] for s in skipped}))
                    raise DeskError(400, M.msg("m.store.wordNone", reasons=M.data(reasons)) if reasons
                                    else M.msg("m.store.wordNoneBare"))
                raise DeskError(400, M.join(M.msg("m.store.pasteNone"),
                                            M.msg("m.store.pasteParts", n=len(skipped)) if skipped else ""))
            self._save(d, doc)
            self.articles_changed(eid)
            return {"created": len(created), "articles": [decorate(a) for a in created], "skipped": skipped}

    def snapshot(self, eid: str) -> dict:
        """The frozen copy a run starts from (the caller holds the edition lock)."""
        d = self.require(eid)
        return {"edition": read_json(d / "edition.json"),
                "articles": [decorate(a) for a in self._doc(d)["articles"]],
                "ads": self.ads_summary(eid)}

    def measure_status(self, eid: str) -> dict | None:
        """The engine's measure-status.json of the edition (background measuring), or None."""
        try:
            status = read_json(self.require(eid) / "measure-status.json", default=None)
        except DeskError:
            return None
        return status if isinstance(status, dict) else None

    # -------------------------------------------------------------------------------------- photos, ads

    def _index_doc(self, d: Path, kind: str) -> dict:
        """A photos or ads folder's index.json. Missing: empty. Damaged, or not an index: a 500 (never read as empty,
        which would drop the other entries when it is written back, and could hide an ad from the checks)."""
        damaged = DeskError(500, f"The {kind} index of this edition ({kind}/index.json in its folder) is damaged and "
                                 f"cannot be read: put back a copy from a backup, or delete that file and add the "
                                 f"{kind} again.")
        try:
            doc = read_json(d / kind / "index.json", default=None)
        except DeskError:
            raise damaged from None
        if doc is None:
            return {"elements": {}}
        if not isinstance(doc, dict) or not isinstance(doc.get("elements"), dict):
            raise damaged
        return doc

    def attach_photo(self, eid: str, aid: str, conv: images.Converted, caption: Any, credit: Any) -> dict:
        """Stores a converted photo under a new photo id and points the article at it. The previous photo's files
        are removed by gc_photos (at once, or after the edition's run when one is in progress)."""
        with self.lock(eid):
            d = self.require(eid)
            doc = self._doc(d)
            article = _find(doc["articles"], aid)
            old = article.get("photo") if isinstance(article.get("photo"), dict) else {}
            photo_text = {key: old.get(key, "") if value is None else clean_text(value, key, LINE_LIMIT)
                          for key, value in (("caption", caption), ("credit", credit))}
            pdir = ensure_dir(d / "photos")
            index = self._index_doc(d, "photos")
            pid = new_id("p-")
            while pid in index["elements"] or any(pdir.glob(f"{pid}.*")):
                pid = new_id("p-")
            write_bytes(pdir / f"{pid}.orig.{conv.ext}", conv.original)
            write_bytes(pdir / f"{pid}.jpg", conv.preview)
            write_bytes(pdir / f"{pid}.cmyk.gz", conv.cmyk_gz)
            index["elements"][pid] = {"width_px": conv.width, "height_px": conv.height, "ppi": None}
            write_json(pdir / "index.json", index)
            photo = {"id": pid, **photo_text, "width_px": conv.width, "height_px": conv.height}
            article["photo"] = photo
            article["updated"] = now_iso()
            self._save(d, doc)
            self._recheck_runs(d)
            self.articles_changed(eid)
            self.gc_photos(eid)
            return photo

    def set_photo_text(self, eid: str, aid: str, fields: dict) -> dict:
        with self.lock(eid):
            d = self.require(eid)
            doc = self._doc(d)
            article = _find(doc["articles"], aid)
            photo = article.get("photo")
            if not isinstance(photo, dict):
                raise DeskError(404, "This article has no photo.")
            before = dict(photo)
            for key in ("caption", "credit"):
                if key in fields:
                    photo[key] = clean_text(fields[key], key, LINE_LIMIT)
            article["updated"] = now_iso()
            self._save(d, doc)
            if photo != before:
                self._recheck_runs(d)
            self.articles_changed(eid)
            return photo

    def remove_photo(self, eid: str, aid: str) -> None:
        with self.lock(eid):
            d = self.require(eid)
            doc = self._doc(d)
            article = _find(doc["articles"], aid)
            if article.get("photo") is not None:
                article["photo"] = None
                article["updated"] = now_iso()
                self._save(d, doc)
                self._recheck_runs(d)
                self.articles_changed(eid)
            self.gc_photos(eid)

    def gc_photos(self, eid: str, blocking: bool = True) -> bool:
        """Removes photo files and index entries no article points at, unless a run of the edition is queued or in
        progress (its frozen request may still need them). False when the edition was busy (blocking=False)."""
        lock = self.lock(eid)
        if not lock.acquire(blocking=blocking):
            return False
        try:
            d = self.edition_dir(eid)
            pdir = d / "photos"
            if not (d / "edition.json").is_file() or not pdir.is_dir() or self.is_active(eid):
                return True
            refs = {a["photo"].get("id") for a in self._doc(d)["articles"] if isinstance(a.get("photo"), dict)}
            for f in pdir.iterdir():
                m = PHOTO_FILE.fullmatch(f.name)
                if m and m.group(1) not in refs:
                    remove_quietly(f)
            index = self._index_doc(d, "photos")
            stale = [k for k in index["elements"] if PHOTO_ID.fullmatch(k) and k not in refs]
            if stale:
                for k in stale:
                    del index["elements"][k]
                write_json(pdir / "index.json", index)
        except Exception:                 # tidying up must never fail the request that triggered it
            traceback.print_exc(file=sys.stderr)
        finally:
            lock.release()
        return True

    def clean_staging(self) -> None:
        """At start: the staging folders (`.bundle-*`, photo originals) an import stopped part-way left are removed,
        then every edition's photos that no article names (an import's photos linked before its articles were
        written)."""
        for d in sorted(self.editions_dir.iterdir()):
            if not (EDITION_ID.fullmatch(d.name) and (d / "edition.json").is_file()):
                continue
            for left in d.glob(".bundle-*"):
                if left.is_dir() and not left.is_symlink():
                    shutil.rmtree(left, ignore_errors=True)
            self.gc_photos(d.name)

    def ads_summary(self, eid: str) -> dict:
        d = self.require(eid)
        out = {}
        for slot, entry in self._index_doc(d, "ads")["elements"].items():
            if isinstance(entry, dict) and SLOT_ID.fullmatch(slot):
                out[slot] = {**entry, "slot": slot, "w_px": entry.get("width_px"), "h_px": entry.get("height_px")}
        return out

    def put_ad(self, eid: str, slot: str, conv: images.Converted) -> dict:
        with self.lock(eid):
            d = self.require(eid)
            if self.is_active(eid):
                raise DeskError(409, AD_BUSY)
            adir = ensure_dir(d / "ads")
            index = self._index_doc(d, "ads")            # first: an index that cannot be read changes nothing
            try:
                for old in adir.glob(f"{slot}.orig.*"):
                    remove_quietly(old)
                write_bytes(adir / f"{slot}.orig.{conv.ext}", conv.original)
                write_bytes(adir / f"{slot}.jpg", conv.preview)
                write_bytes(adir / f"{slot}.cmyk.gz", conv.cmyk_gz)
                index["elements"][slot] = {"width_px": conv.width, "height_px": conv.height, "ppi": None}
                write_json(adir / "index.json", index)
            finally:
                self._touch(d)                           # also after a step that failed part-way
            return {"slot": slot, "w_px": conv.width, "h_px": conv.height}

    def remove_ad(self, eid: str, slot: str) -> None:
        with self.lock(eid):
            d = self.require(eid)
            if self.is_active(eid):
                raise DeskError(409, AD_BUSY)
            adir = d / "ads"
            index = self._index_doc(d, "ads")            # first: an index that cannot be read changes nothing
            had = index["elements"].pop(slot, None) is not None
            files = [f for f in [*adir.glob(f"{slot}.orig.*"), adir / f"{slot}.jpg", adir / f"{slot}.cmyk.gz"]
                     if f.exists()]
            try:
                for f in files:
                    remove_quietly(f)
                if had:
                    write_json(adir / "index.json", index)
            finally:
                if had or files:
                    self._touch(d)                       # also after a step that failed part-way

    def _touch(self, d: Path) -> None:
        """An ad changed: the edition changed after its layouts, and the pages that print the ad need saving (in the
        page editor, Update text or Save page sets the new ad)."""
        try:
            edition = read_json(d / "edition.json")
            edition["updated"] = now_iso()
            write_json(d / "edition.json", edition)
        finally:
            self._recheck_runs(d)                       # also when edition.json cannot be read (then nothing is current)

    def preview_path(self, eid: str, kind: str, key: str) -> Path:
        """The preview JPEG of a photo (kind "photos", key = photo id) or an ad ("ads", key = slot). A missing
        preview is made from the stored CMYK raster (the engine's import-sample writes none)."""
        d = self.require(eid)
        path = d / kind / f"{key}.jpg"
        if path.is_file():
            return path
        with self._preview_lock:
            if path.is_file():
                return path
            entry = self._index_doc(d, kind)["elements"].get(key)
            try:
                gz = (d / kind / f"{key}.cmyk.gz").read_bytes()
            except FileNotFoundError:
                gz = None
            if gz is None or not isinstance(entry, dict):
                raise DeskError(404, "There is no such picture.")
            write_bytes(path, images.preview_from_cmyk_gz(gz, entry.get("width_px"), entry.get("height_px")))
        return path

    # ---------------------------------------------------------------------------------------------- runs

    @staticmethod
    def _run_ids(d: Path) -> list[str]:
        runs = d / "runs"
        if not runs.is_dir():
            return []
        return sorted((p.name for p in runs.iterdir() if RUN_ID.fullmatch(p.name)), reverse=True)

    @staticmethod
    def _run_entry(d: Path, rid: str) -> dict | None:
        try:
            status = read_json(d / "runs" / rid / "status.json", default=None)
        except DeskError:
            return None
        if not isinstance(status, dict):
            return None
        return {"id": rid, "state": status.get("state"), "started": status.get("started") or status.get("created")}

    def list_runs(self, eid: str) -> list[dict]:
        d = self.require(eid)
        return [e for e in (self._run_entry(d, rid) for rid in self._run_ids(d)) if e]

    def run_dir(self, eid: str, rid: str) -> Path:
        return self.require(eid) / "runs" / path_id(RUN_ID, rid, "run")

    def run_status(self, eid: str, rid: str) -> dict:
        status = read_json(self.run_dir(eid, rid) / "status.json", default=None)
        if not isinstance(status, dict):
            raise DeskError(404, "There is no such run.")
        return status
