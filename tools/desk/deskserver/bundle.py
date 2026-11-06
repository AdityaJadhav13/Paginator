"""Pageinator story bundles (CONTRACT.md §6): the hosted newsroom's stories for one edition (and, from /2, its settings
and back-page ad artwork), as a ZIP the owner downloads and imports with "Pageinator stories…". Read with the standard
library, with zip limits as docx.py's; photos and ads go through the Desk's own pipelines (images.py) and texts through
the same cleaning as typed articles.

All or nothing: a bundle that is not sound (the zip, its format, a field, a photo's or ad's SHA-256, a missing colour
profile) is refused before anything is written. A sound bundle's stories are each added, replaced, left as they are
(unchanged, or kept because they were changed in the Desk since their last import), or refused with the reason a typed
article would get; its ads and settings fill only what the Desk's edition has empty; the edition's files are written
once, under its lock."""
from __future__ import annotations

import hashlib
import json
import re
import shutil
import stat
import zipfile
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from pathlib import Path
from typing import Any

from . import images
from . import messages as M
from .ziplimits import directory
from .util import SLOT_ID, DeskError, clean_text, ensure_dir, new_id, now_iso, write_bytes, write_json

FORMAT = "pageinator.story-bundle/2"                 # what the hosted product makes
FORMATS = ("pageinator.story-bundle/1", FORMAT)      # what the Desk reads: /2 is /1 plus the edition's settings and ads
BODY_FORMAT = "desk-text/1"
MAX_BYTES = 200 * 1024 * 1024          # the ZIP
MAX_UNPACKED = 300 * 1024 * 1024       # all its files unpacked
MAX_JSON = 32 * 1024 * 1024            # bundle.json unpacked
MAX_STORIES = 200
MAX_ADS = 16
MAX_FILES = MAX_STORIES + MAX_ADS + 3  # bundle.json, a photo a story, an ad a slot, "photos/" and "ads/" folder entries
MAX_DIRECTORY = 1024 * 1024            # the central directory (219 entries need a few tens of KB)
MAX_RATIO = 100                        # unpacked ÷ packed, for a file over 1 MB unpacked (photos hardly pack at all)
PHOTO_FILE = re.compile(r"photos/([0-9a-f]{64})\.(jpg|jpeg|png|webp)")
AD_FILE = re.compile(r"ads/([0-9a-f]{64})\.(jpg|jpeg|png|webp)")
AD_SLOT = re.compile(r"[A-Za-z0-9_-]{1,40}")                     # a hosted slot's name (the Desk takes its own plan's)
TOKEN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")          # ids the hosted product gives (UUIDs and the like)
LANGUAGE = re.compile(r"[a-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}")   # a BCP 47 tag: "mr", "en", "mr-IN"
SOURCE = "bundle"

TOP = ("format", "bundle", "source", "edition", "stories")
STORY = ("id", "revision", "headline", "kicker", "deck", "byline", "body", "body_format", "section", "priority", "page",
         "language", "photo")
PHOTO = ("file", "sha256", "filename", "caption", "credit")
EDITION = ("date", "pages")
SETTINGS = ("volume", "issue", "price")
AD = ("slot", "page", "file", "sha256", "filename")


# ------------------------------------------------------------------------------------------------ reading


def _refuse(code: str, status: int = 400, **params: Any) -> DeskError:
    return DeskError(status, M.msg(code, **params))


def _named(text: str) -> M.Msg:
    """A name from the file (a member's name, a field's path) as a message shows it: at most 200 characters."""
    return M.data(text if len(text) <= 200 else text[:199] + "…")


def _members(z: zipfile.ZipFile) -> dict[str, zipfile.ZipInfo]:
    """The ZIP's files by name, after every check that needs no unpacking (names, kinds, sizes, packing)."""
    infos = z.infolist()
    if len(infos) > MAX_FILES:
        raise _refuse("m.bundle.tooManyFiles", max=MAX_FILES)
    out: dict[str, zipfile.ZipInfo] = {}
    total = 0
    for info in infos:
        name = info.filename
        if info.create_system == 3 and stat.S_ISLNK(info.external_attr >> 16):      # a symbolic link (Unix)
            raise _refuse("m.bundle.badMember", name=_named(name))
        if name in ("photos/", "ads/") and info.is_dir() and info.file_size == 0:
            continue
        if name in out or (name != "bundle.json" and not _picture(name)) or info.flag_bits & 0x1:
            raise _refuse("m.bundle.badMember", name=_named(name))       # anything else: "../x", "/x", a repeat, encrypted
        if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
            raise _refuse("m.bundle.damaged")                            # bzip2, lzma: unpacked whole, however large
        if info.file_size > (MAX_JSON if name == "bundle.json" else images.MAX_UPLOAD_BYTES):
            raise _refuse("m.bundle.memberTooLarge", 413, name=_named(name))
        if info.file_size > 1024 * 1024 and info.file_size > MAX_RATIO * max(info.compress_size, 1):
            raise _refuse("m.bundle.packed", 413, name=_named(name))
        total += info.file_size
        if total > MAX_UNPACKED:
            raise _refuse("m.bundle.unpacksTooLarge", 413)
        out[name] = info
    return out


def _picture(name: str) -> re.Match[str] | None:
    """A photo's or an ad's file name (its SHA-256 the first group), or None."""
    return PHOTO_FILE.fullmatch(name) or AD_FILE.fullmatch(name)


def _read(z: zipfile.ZipFile, info: zipfile.ZipInfo) -> bytes:
    """A file's bytes, bounded by the size the ZIP lists (which _members checked): a file that is longer or shorter
    than it says, or fails its checksum, is damaged."""
    try:
        with z.open(info) as f:
            raw = f.read(info.file_size + 1)
    except Exception:  # noqa: BLE001 — bad checksum, cut-off or garbled data (zipfile and zlib raise several kinds)
        raise _refuse("m.bundle.damaged") from None
    if len(raw) != info.file_size:
        raise _refuse("m.bundle.damaged")
    return raw


# ------------------------------------------------------------------------------------------------- schema


def _check(value: Any, where: str, ok: bool) -> Any:
    if not ok:
        raise _refuse("m.bundle.badField", field=_named(where))
    return value


def _object(value: Any, where: str, keys: tuple[str, ...]) -> dict:
    """An object with exactly these keys (each present; null where the format allows it)."""
    _check(value, where, isinstance(value, dict))
    for key in value:
        if key not in keys:
            raise _refuse("m.bundle.unknownField", field=_named(f"{where}.{key}" if where else key))
    for key in keys:
        _check(None, f"{where}.{key}" if where else key, key in value)
    return value


def _text(value: Any, where: str, pattern: re.Pattern[str] | None = None) -> Any:
    return _check(value, where, isinstance(value, str) and (pattern is None or bool(pattern.fullmatch(value))))


def _int(value: Any, where: str, ok) -> Any:
    return _check(value, where, isinstance(value, int) and not isinstance(value, bool) and ok(value))


def _utf8(text: str) -> bool:
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:                        # a lone surrogate ("\ud800" in the JSON): not a character
        return False
    return True


def _characters(value: Any, where: str) -> None:
    """Every text in bundle.json, keys included, is Unicode characters (JSON can escape a lone surrogate, which is not
    one): else the field is refused by name (a key that is not names the object holding it)."""
    if isinstance(value, str):
        _check(value, where, _utf8(value))
    elif isinstance(value, dict):
        for key, item in value.items():
            _check(key, where or "bundle.json", _utf8(key))
            _characters(item, f"{where}.{key}" if where else key)
    elif isinstance(value, list):
        for i, item in enumerate(value):
            _characters(item, f"{where}[{i}]")


SUBHEADING = re.compile(r"## [^\s#][^\n]*")


def desk_text(body: str) -> bool:
    r"""Whether a body is desk-text/1 (CONTRACT.md §6): blocks separated by exactly one empty line ("\n\n"), none
    empty or holding a line break; a block that starts with "##" (spaces before it included) is a subheading, exactly
    "## " and its text. No carriage returns. An empty body is left to the Desk's own rule (it needs text)."""
    if body == "":
        return True
    if "\r" in body:
        return False
    for block in body.split("\n\n"):
        if not block.strip() or "\n" in block:
            return False
        if block.lstrip().startswith("##") and not SUBHEADING.fullmatch(block):
            return False
    return True


def parse(doc: Any) -> dict:
    """bundle.json, checked against the format (CONTRACT.md §6). Every key is required; an unknown key, a wrong type
    or a value outside the format refuses the whole bundle (the field is named)."""
    from .store import EDITION_TEXT_LIMIT

    _check(doc, "bundle.json", isinstance(doc, dict))
    _characters(doc, "")
    if doc.get("format") not in FORMATS:                  # first: a later format may have other fields
        raise _refuse("m.bundle.version", format=M.data(str(doc.get("format"))[:80]))
    v2 = doc["format"] == FORMAT
    _object(doc, "", TOP + ("ads",) if v2 else TOP)
    meta = _object(doc["bundle"], "bundle", ("id", "created"))
    _text(meta["id"], "bundle.id", TOKEN)
    _check(meta["created"], "bundle.created", isinstance(meta["created"], str) and 0 < len(meta["created"]) <= 64)
    source = _object(doc["source"], "source", ("organisation_id", "publication_id"))
    _text(source["organisation_id"], "source.organisation_id", TOKEN)
    _text(source["publication_id"], "source.publication_id", TOKEN)
    edition = _object(doc["edition"], "edition", EDITION + ("back_page_ads",) + SETTINGS if v2 else EDITION)
    _check(edition["date"], "edition.date", isinstance(edition["date"], str) and _is_date(edition["date"]))
    _int(edition["pages"], "edition.pages", lambda v: v in (4, 8, 16))
    if v2:
        _check(edition["back_page_ads"], "edition.back_page_ads", isinstance(edition["back_page_ads"], bool))
        for key in SETTINGS:
            _check(edition[key], f"edition.{key}", isinstance(edition[key], str)
                   and len(edition[key]) <= EDITION_TEXT_LIMIT)
        ads = _check(doc["ads"], "ads", isinstance(doc["ads"], list) and len(doc["ads"]) <= MAX_ADS)
        for i, a in enumerate(ads):
            w = f"ads[{i}]"
            _object(a, w, AD)
            _text(a["slot"], f"{w}.slot", AD_SLOT)
            _check(a["slot"], f"{w}.slot", all(b["slot"] != a["slot"] for b in ads[:i]))      # a slot once
            _int(a["page"], f"{w}.page", lambda v: 1 <= v <= 16)
            m = AD_FILE.fullmatch(a["file"]) if isinstance(a["file"], str) else None
            _check(a["file"], f"{w}.file", m is not None)
            _check(a["sha256"], f"{w}.sha256", isinstance(a["sha256"], str) and a["sha256"] == m.group(1))
            _check(a["filename"], f"{w}.filename", isinstance(a["filename"], str) and len(a["filename"]) <= 255)
    stories = _check(doc["stories"], "stories", isinstance(doc["stories"], list))
    if len(stories) > MAX_STORIES:
        raise _refuse("m.bundle.tooManyStories", max=MAX_STORIES)
    seen: set[str] = set()
    for i, s in enumerate(stories):
        w = f"stories[{i}]"
        _object(s, w, STORY)
        _text(s["id"], f"{w}.id", TOKEN)
        if s["id"] in seen:
            raise _refuse("m.bundle.storyTwice", story=_named(s["id"]))
        seen.add(s["id"])
        _int(s["revision"], f"{w}.revision", lambda v: v >= 1)
        for key in ("headline", "kicker", "deck", "byline", "body"):
            _text(s[key], f"{w}.{key}")
        _check(s["body"], f"{w}.body", desk_text(s["body"]))
        _check(s["body_format"], f"{w}.body_format", s["body_format"] == BODY_FORMAT)
        _check(s["section"], f"{w}.section", s["section"] is None or (isinstance(s["section"], str)
                                                                         and len(s["section"]) <= 200))
        _int(s["priority"], f"{w}.priority", lambda v: v in (1, 2, 3, 4))
        if s["page"] is not None:
            _int(s["page"], f"{w}.page", lambda v: 1 <= v <= 16)
        _text(s["language"], f"{w}.language", LANGUAGE)
        if s["photo"] is not None:
            p = _object(s["photo"], f"{w}.photo", PHOTO)
            m = PHOTO_FILE.fullmatch(p["file"]) if isinstance(p["file"], str) else None
            _check(p["file"], f"{w}.photo.file", m is not None)
            _check(p["sha256"], f"{w}.photo.sha256", isinstance(p["sha256"], str) and p["sha256"] == m.group(1))
            _check(p["filename"], f"{w}.photo.filename", isinstance(p["filename"], str) and len(p["filename"]) <= 255)
            _text(p["caption"], f"{w}.photo.caption")
            _text(p["credit"], f"{w}.photo.credit")
    return doc


def _is_date(value: str) -> bool:
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        date.fromisoformat(value)
    except ValueError:
        return False
    return True


def open_bundle(data: bytes) -> tuple[zipfile.ZipFile, dict, dict[str, zipfile.ZipInfo]]:
    """The ZIP, its checked bundle.json and its photo and ad files by name. Every photo a story names and every ad's
    file is in it, and every file in it is named so (else the bundle is refused)."""
    if len(data) > MAX_BYTES:
        raise _refuse("m.bundle.tooLarge", 413)
    listed = directory(data)                          # before zipfile reads a central directory of any size
    if listed is not None and listed.zip64:
        raise _refuse("m.bundle.zip64")
    if listed is not None and (listed.entries > MAX_FILES or listed.size > MAX_DIRECTORY):
        raise _refuse("m.bundle.tooManyFiles", max=MAX_FILES)
    try:
        z = zipfile.ZipFile(BytesIO(data))
    except (zipfile.BadZipFile, ValueError, NotImplementedError, OSError):  # not a zip, or a cut-off or garbled one
        raise _refuse("m.bundle.damaged" if data.startswith(b"PK") else "m.bundle.notZip") from None
    members = _members(z)
    if "bundle.json" not in members:
        raise _refuse("m.bundle.noJson")
    try:
        doc = json.loads(_read(z, members.pop("bundle.json")).decode("utf-8"))
    except DeskError:
        raise
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise _refuse("m.bundle.badJson") from None
    doc = parse(doc)
    named = {s["photo"]["file"] for s in doc["stories"] if s["photo"] is not None}
    ads = {a["file"] for a in doc.get("ads", [])}
    for name in sorted(named - set(members)):
        raise _refuse("m.bundle.photoMissing", name=_named(name))
    for name in sorted(ads - set(members)):
        raise _refuse("m.bundle.adMissing", name=_named(name))
    for name in sorted(set(members) - named - ads):
        raise _refuse("m.bundle.badMember", name=_named(name))
    return z, doc, members


# ------------------------------------------------------------------------------------------------- import


@dataclass
class Staged:
    """A picture converted for print, in the staging folder (files <name>.orig.<ext>, <name>.jpg, <name>.cmyk.gz)."""
    name: str
    ext: str
    width: int
    height: int


def signature(article: dict) -> str:
    """What the Desk may change of an imported article: a change since its import keeps it at the next import."""
    photo = article.get("photo") if isinstance(article.get("photo"), dict) else None
    sig = [article.get(k) for k in ("headline", "kicker", "deck", "byline", "body", "priority", "page")]
    sig.append([photo.get("id"), photo.get("caption"), photo.get("credit")] if photo else None)
    return hashlib.sha256(json.dumps(sig, ensure_ascii=False).encode("utf-8")).hexdigest()


def _key(source: dict, story_id: str) -> tuple[str, str, str]:
    return source["organisation_id"], source["publication_id"], story_id


def _imported(articles: list[dict]) -> dict[tuple[str, str, str], dict]:
    out = {}
    for a in articles:
        rec = a.get("bundle")
        if isinstance(rec, dict) and all(isinstance(rec.get(k), str) for k in ("organisation_id", "publication_id", "story")):
            out.setdefault((rec["organisation_id"], rec["publication_id"], rec["story"]), a)
    return out


def _deleted(doc: dict) -> set[tuple[str, str, str]]:
    """The source stories whose imported article was deleted in the Desk (articles.json "bundle_deleted"): never
    added again by an import."""
    out = set()
    for t in doc.get("bundle_deleted") or []:
        if isinstance(t, dict) and all(isinstance(t.get(k), str) for k in ("organisation_id", "publication_id", "story")):
            out.add((t["organisation_id"], t["publication_id"], t["story"]))
    return out


def tombstone(article: dict) -> dict | None:
    """What articles.json keeps of an imported article deleted in the Desk (store.delete_article), or None."""
    rec = article.get("bundle")
    if not (isinstance(rec, dict) and all(isinstance(rec.get(k), str) for k in ("organisation_id", "publication_id",
                                                                                 "story"))):
        return None
    return {"organisation_id": rec["organisation_id"], "publication_id": rec["publication_id"], "story": rec["story"],
            "article": article.get("id"), "deleted": now_iso()}


def decide(story: dict, article: dict | None, deleted: bool = False) -> tuple[str, Any]:
    """add, replace, unchanged, kept (with why) or deleted for a story of the bundle, the article it was imported as,
    and whether such an article was deleted in the Desk."""
    if article is None:
        return ("deleted", M.msg("m.bundle.deletedInDesk")) if deleted else ("add", None)
    rec = article["bundle"]
    if signature(article) != rec.get("sig"):
        return "kept", M.msg("m.bundle.keptEdited")
    old = rec.get("revision") if isinstance(rec.get("revision"), int) else 0
    if story["revision"] < old:
        return "kept", M.msg("m.bundle.keptNewer", revision=old)
    return ("unchanged", None) if story["revision"] == old else ("replace", None)


def _keeps_photo(story: dict, article: dict | None) -> bool:
    """Whether a replaced article keeps the photo it has (the same original as at its last import)."""
    photo = article.get("photo") if article else None
    rec = article.get("bundle") if article else None
    return (story["photo"] is not None and isinstance(photo, dict) and isinstance(rec, dict)
            and rec.get("photo_sha256") == story["photo"]["sha256"] and rec.get("photo_id") == photo.get("id"))


def _checked(z: zipfile.ZipFile, info: zipfile.ZipInfo, sha: str) -> bytes:
    """A photo's or ad's bytes, which must have the SHA-256 the bundle gives (else it was changed or damaged)."""
    raw = _read(z, info)
    if hashlib.sha256(raw).hexdigest() != sha:
        raise _refuse("m.bundle.badSha", name=_named(info.filename))
    return raw


def _stage(convert, raw: bytes, name: str, folder: Path) -> Staged | DeskError:
    """A picture converted as an upload is (images.convert_photo, or convert_ad for its slot), written to the staging
    folder; or why it cannot be (not a picture, damaged, too many pixels), which refuses only its story or ad. A fault
    of the Desk itself (5xx: no colour profile) refuses the whole bundle."""
    try:
        conv = convert(raw)
    except DeskError as e:
        if e.status >= 500:
            raise
        return e
    write_bytes(folder / f"{name}.orig.{conv.ext}", conv.original)
    write_bytes(folder / f"{name}.jpg", conv.preview)
    write_bytes(folder / f"{name}.cmyk.gz", conv.cmyk_gz)
    return Staged(name, conv.ext, conv.width, conv.height)


def _slots(plan, edition: dict) -> dict[str, tuple]:
    """The ad spaces of the Desk's own page plan for the edition's pages and back-page ads: {slot: (w_mm, h_mm)}."""
    from .store import parse_pages

    got = plan(parse_pages(edition.get("pages")), bool(edition.get("back_page_ads", True)))
    return {s["slot"]: (s.get("w_mm"), s.get("h_mm")) for p in got["pages"] if isinstance(p, dict)
            for s in p.get("ad_slots") or [] if isinstance(s, dict) and isinstance(s.get("slot"), str)
            and SLOT_ID.fullmatch(s["slot"])}


def _ad_decision(adir: Path, index: dict, ad: dict, slots: dict) -> tuple[str, Any]:
    """add, unchanged, kept or refused (with why) for an ad of the file, against the Desk's plan and its own ad."""
    slot = ad["slot"]
    if slot not in slots:
        return "refused", M.msg("m.bundle.adNoSlot", slot=M.data(slot))
    origs = list(adir.glob(f"{slot}.orig.*"))
    if not origs and slot not in index["elements"] and not (adir / f"{slot}.cmyk.gz").exists():
        return "add", None
    if (len(origs) == 1 and slot in index["elements"]
            and hashlib.sha256(origs[0].read_bytes()).hexdigest() == ad["sha256"]):
        return "unchanged", None
    return "kept", M.msg("m.bundle.adKept", slot=M.data(slot))


def _link(src: Path, dst: Path) -> None:
    try:
        dst.hardlink_to(src)
    except OSError:
        shutil.copyfile(src, dst)
        dst.chmod(0o600)


def import_bundle(store, eid: str, data: bytes, plan) -> dict:
    """The bundle's stories, ads and settings into the edition (module docstring); plan(pages, back_page_ads) is the
    Desk's page plan (Engine.plan), asked only for a file with ads. → {"bundle", "added", "replaced", "unchanged",
    "kept", "deleted", "refused", "notes", "articles", "ads", "settings"}."""
    from .store import LINE_LIMIT, _apply, _find, decorate          # the store's own article rules

    d = store.require(eid)
    z, doc, members = open_bundle(data)
    folder: Path | None = None
    try:
        edition = store.get_edition(eid)
        sent = doc["edition"]
        if sent["date"] != edition.get("date"):
            raise _refuse("m.bundle.otherDate", date=M.data(sent["date"]), edition=M.data(str(edition.get("date"))))
        source, stories = doc["source"], doc["stories"]
        first = store._doc(d)                                       # a first look: the photos to convert (none for a
        before, gone = _imported(first["articles"]), _deleted(first)    # story that stays, or keeps its photo)
        need = {s["photo"]["sha256"]: s["photo"]["file"] for s in stories
                if s["photo"] is not None
                and decide(s, before.get(_key(source, s["id"])), _key(source, s["id"]) in gone)[0] in ("add", "replace")
                and not _keeps_photo(s, before.get(_key(source, s["id"])))}
        for name, info in sorted(members.items()):                  # every checksum, before any conversion
            _checked(z, info, _picture(name).group(1))
        folder = ensure_dir(d / f".bundle-{new_id('')}")            # beside photos/ (same disk), never read as one
        staged: dict[str, Staged | DeskError] = {}
        for sha, name in need.items():
            staged[sha] = _stage(images.convert_photo, _checked(z, members[name], sha), sha, folder)
        ads = doc.get("ads", [])                                    # (a file without ads asks nothing of the ads)
        slots, ad_index = (_slots(plan, edition), store._index_doc(d, "ads")) if ads else ({}, {"elements": {}})
        staged_ads: dict[str, tuple] = {}                           # slot -> (its size, Staged | DeskError)
        for a in ads:
            if _ad_decision(d / "ads", ad_index, a, slots)[0] != "add":
                continue
            size = slots[a["slot"]]
            staged_ads[a["slot"]] = size, _stage(lambda raw: images.convert_ad(raw, *size),
                                                 _checked(z, members[a["file"]], a["sha256"]), a["slot"],
                                                 ensure_dir(folder / "ads"))
        return _commit(store, eid, doc, staged, staged_ads, plan, folder, LINE_LIMIT, _apply, _find, decorate)
    finally:
        if folder is not None:
            shutil.rmtree(folder, ignore_errors=True)
        z.close()


def _settings(sent: dict, edition: dict, notes: list) -> dict:
    """The file's volume, issue and price the edition has empty ("set"), and those it has otherwise ("kept", each noted
    with both values: a Desk value is never overwritten); a different back-page ads choice is noted. /1 has none."""
    out: dict[str, dict] = {"set": {}, "kept": {}}
    if "back_page_ads" not in sent:
        return out
    for key, code in zip(SETTINGS, ("m.bundle.keptVolume", "m.bundle.keptIssue", "m.bundle.keptPrice")):
        theirs, ours = clean_text(sent[key], key, 10**9), str(edition.get(key) or "")
        if not theirs or theirs == ours:
            continue
        if ours:
            out["kept"][key] = {"file": theirs, "desk": ours}
            notes.append(M.msg(code, sent=M.data(theirs), desk=M.data(ours)))
        else:
            out["set"][key] = theirs
    if sent["back_page_ads"] != bool(edition.get("back_page_ads", True)):
        notes.append(M.msg("m.bundle.backAdsOn" if sent["back_page_ads"] else "m.bundle.backAdsOff"))
    return out


def _place_ads(busy: bool, d: Path, ads: list | None, staged_ads: dict, slots: dict, index: dict, folder: Path,
               notes: list) -> tuple[dict, list[tuple[Path, Path]]]:
    """Each ad of the file (None: a /1 file, which says nothing of ads) decided on the edition's ads as they are now
    (index gets the added ones): the answer's lists, and the staged files to link into ads/. An ad kept or refused is
    also noted, by its slot, and so is an ad of the Desk's plan the file does not name (kept: never removed here)."""
    out: dict[str, list] = {k: [] for k in ("added", "unchanged", "kept", "refused")}
    adir, links = d / "ads", []
    named = {a["slot"] for a in ads or []}
    for slot in sorted(index["elements"]):                      # before any is added: the Desk's own
        if slot in slots and slot not in named:
            notes.append(M.msg("m.bundle.adNotInFile", slot=M.data(slot)))
    for a in ads or []:
        slot = a["slot"]
        what, why = _ad_decision(adir, index, a, slots)
        if what == "add":
            size, got = staged_ads.get(slot, (None, None))
            if busy:                                                # as an upload: not while the pages are being made
                what, why = "refused", M.msg("m.store.adBusy")
            elif got is None or size != slots[slot]:                # it changed in the Desk while the file was read
                what, why = "refused", M.msg("m.bundle.retry")
            elif isinstance(got, DeskError):
                what, why = "refused", got.message
            else:
                index["elements"][slot] = {"width_px": got.width, "height_px": got.height, "ppi": None}
                links += [(folder / "ads" / f"{slot}{tail}", adir / f"{slot}{tail}")
                          for tail in (f".orig.{got.ext}", ".jpg", ".cmyk.gz")]
        out["added" if what == "add" else what].append({"slot": slot, "reason": why} if why else {"slot": slot})
        if what == "kept":
            notes.append(why)
        elif what == "refused":
            notes.append(M.msg("m.bundle.adRefused", slot=M.data(slot), reason=why))
    return out, links


def _commit(store, eid, doc, staged, staged_ads, plan, folder, line_limit, apply, find, decorate) -> dict:
    """Under the edition's lock: each story, ad and setting decided again on the edition as it is, then one write."""
    source, stories, meta = doc["source"], doc["stories"], doc["bundle"]
    out: dict[str, list] = {k: [] for k in ("added", "replaced", "unchanged", "kept", "deleted", "refused")}
    with store.lock(eid):
        d = store.require(eid)
        edition = store.get_edition(eid)
        notes = []
        if doc["edition"]["pages"] != edition.get("pages"):
            notes.append(M.msg("m.bundle.otherPages", sent=doc["edition"]["pages"], pages=edition.get("pages")))
        settings = _settings(doc["edition"], edition, notes)
        sent_ads = doc.get("ads")                                   # None: a /1 file
        ad_index = store._index_doc(d, "ads") if sent_ads is not None else {"elements": {}}  # unreadable: no write
        ad_before = json.loads(json.dumps(ad_index))
        ads, ad_links = _place_ads(store.is_active(eid), d, sent_ads, staged_ads,
                                   _slots(plan, edition) if sent_ads or ad_index["elements"] else {}, ad_index,
                                   folder, notes)
        art_doc = store._doc(d)
        articles = art_doc["articles"]
        current, gone = _imported(articles), _deleted(art_doc)
        index = store._index_doc(d, "photos")                       # first: an index that cannot be read writes nothing
        index_before = json.loads(json.dumps(index))
        pdir = d / "photos"
        links: list[tuple[Path, Path]] = []
        changed: list[dict] = []
        for s in stories:
            key = _key(source, s["id"])
            article = current.get(key)
            what, why = decide(s, article, key in gone)
            # the headline as the Desk has it (a story left as it is) or would set it (cleaned as a typed one)
            shown = str(article.get("headline") or "") if what in ("kept", "unchanged") else clean_text(
                s["headline"], "headline", 10**9)
            entry = {"story": s["id"], "headline": _clip(shown)}
            if article is not None:
                entry["article"] = article["id"]
            if what in ("kept", "unchanged", "deleted"):
                out[what].append({**entry, "reason": why} if why else entry)
                continue
            fields = {k: s[k] for k in ("headline", "kicker", "deck", "byline", "body", "priority", "page")}
            try:
                if what == "add":
                    new = store._new_article(articles, fields, edition, SOURCE)
                else:
                    new = dict(article)
                    apply(new, fields, edition)
                    new["updated"] = now_iso()
                photo, used = _photo(s, article, staged, line_limit, index, pdir, folder)
            except DeskError as e:
                out["refused"].append({**entry, "reason": e.message})
                continue
            new["photo"] = photo
            links += used
            new["bundle"] = {"organisation_id": source["organisation_id"], "publication_id": source["publication_id"],
                             "story": s["id"], "revision": s["revision"], "bundle_id": meta["id"],
                             "imported": now_iso(), "section": s["section"], "language": s["language"],
                             "photo_sha256": s["photo"]["sha256"] if s["photo"] else None,
                             "photo_id": photo["id"] if photo else None,
                             "photo_filename": s["photo"]["filename"] if s["photo"] else None}
            new["bundle"]["sig"] = signature(new)
            if what == "add":
                articles.append(new)
            else:
                old = find(articles, article["id"])
                old.clear()
                old.update(new)
                new = old
            out["added" if what == "add" else "replaced"].append({**entry, "headline": _clip(new["headline"]),
                                                                  "article": new["id"]})
            changed.append(new)
        if changed or ad_links or settings["set"]:
            adir = d / "ads"
            try:
                if settings["set"]:                                 # as a typed change: finished layouts checked again
                    store.update_edition(eid, settings["set"])
                for where, made in ((pdir, links), (adir, ad_links)):
                    if made:
                        ensure_dir(where)
                    for src, dst in made:
                        _link(src, dst)
                if links:
                    write_json(pdir / "index.json", index)
                if ad_links:
                    write_json(adir / "index.json", ad_index)
                if changed:
                    store._save(d, art_doc)
            except BaseException:
                for _, dst in links + ad_links:                     # nothing written stays: articles.json is atomic,
                    dst.unlink(missing_ok=True)                     # the photos and ads it added are removed and the
                if links:                                           # indexes are put back (also while a layout runs,
                    write_json(pdir / "index.json", index_before)   # when gc_photos waits), and the settings
                if ad_links:
                    write_json(adir / "index.json", ad_before)
                if settings["set"]:
                    write_json(d / "edition.json", edition)
                    store._recheck_runs(d)
                raise
            if changed:
                store._recheck_runs(d)                              # a replaced article may print on a laid-out page
                store.articles_changed(eid)
                store.gc_photos(eid)                                # a replaced photo's files
            if ad_links:
                store._touch(d)                                     # as an upload: the edition changed after layouts
    return {"bundle": {"id": meta["id"], "edition": doc["edition"]["date"], "stories": len(stories)}, **out,
            "notes": notes, "articles": [decorate(a) for a in changed], "ads": ads, "settings": settings}


def _clip(text: str) -> str:
    return text if len(text) <= 200 else text[:199] + "…"


def _photo(story, article, staged, line_limit, index, pdir, folder) -> tuple[dict | None, list[tuple[Path, Path]]]:
    """The article's photo record for a story, and the staged files to link into photos/ for it (a new photo id)."""
    p = story["photo"]
    if p is None:
        return None, []
    text = {k: clean_text(p[k], k, line_limit) for k in ("caption", "credit")}
    if _keeps_photo(story, article):
        return {**article["photo"], **text}, []
    got = staged.get(p["sha256"])
    if got is None:                                                 # the article changed while the photos were read
        raise DeskError(409, M.msg("m.bundle.retry"))
    if isinstance(got, DeskError):
        raise got
    pid = new_id("p-")
    while pid in index["elements"] or any(pdir.glob(f"{pid}.*")):
        pid = new_id("p-")
    index["elements"][pid] = {"width_px": got.width, "height_px": got.height, "ppi": None}
    files = [(folder / f"{got.name}{tail}", pdir / f"{pid}{tail}") for tail in (f".orig.{got.ext}", ".jpg", ".cmyk.gz")]
    return {"id": pid, **text, "width_px": got.width, "height_px": got.height}, files
