"""The home materialiser (plan §2.2, l22-plan §1): a publication's engine home, `homes/<org>/<pub>/`, made from a run's
frozen request, so the Desk's engine runs unchanged on exactly the files the Desk itself would have written
(tools/desk/CONTRACT.md §1).

The hosted request is the Desk's own `request.json` (`Store.snapshot`: edition, articles, ads) plus, for each photo and
ad, where its CMYK raster is: `"raster": {"key", "version_id", "sha256", "width_px", "height_px"}` (the CMYK
rendition's facts from `media.ready`). Before anything is written the materialiser checks:
- the request's SHA-256, and that its edition is the job's (`edition_id`), with ids in ASCII digits only;
- every id against the Desk's patterns;
- every raster reference: only a CMYK rendition of this organisation and publication (`assets/<uuid7>/r/cmyk-<32 hex>
  .cmyk.gz`), the same reference wherever one photo id appears, its size the photo's or ad's (positive whole numbers),
  its SHA-256, and its gzip unpacking to exactly width × height × 4 bytes (read no further than one byte more);
- that no folder from `homes/<org>` down is a symbolic link (a link would let the writes and the sweep reach elsewhere).
Then it writes:
  editions/<edition>/edition.json, articles.json, photos/<p>.cmyk.gz + index.json, ads/<slot>.cmyk.gz + index.json
  editions/<edition>/runs/<run>/request.json (the Desk's shape, the raster references taken out), in a run folder
  emptied first, so nothing of an earlier attempt (a PDF, a ZIP) can be taken for this one's.
A photo or ad file of an earlier request that this one does not name is removed (links are left alone). write_live
writes the edition's live edition.json, articles.json and photos the same way (the page editor's gateway), never
touching a run folder or the ads. Both take the edition's lock (editions/<edition>/.lock, flock) while they write, so a
layout job and the editor's gateway (other processes) never write one edition's files at once. Folders 0700,
files 0600. The home holds no previews or originals: the engine reads only the rasters."""
from __future__ import annotations

import contextlib
import fcntl
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import stat
from pathlib import Path

from .desk import util
from .keys import KeyGuard
from .storage import Storage

ARTICLES_SCHEMA = "pageinator.desk.articles/1"      # deskserver/store.py's (a test keeps them equal)
DERIVED = ("words", "is_brief")                       # what Store.snapshot adds to an article (decorate)
EDITION_ID = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}(?:-[1-9][0-9]{0,2})?", re.ASCII)   # the Desk's, ASCII digits only
RUN_ID = re.compile(r"r-[0-9]{8}-[0-9]{6}", re.ASCII)
REF = ("key", "version_id", "sha256", "width_px", "height_px")


class BadRequest(ValueError):
    """A request (or a home) the materialiser does not take: the job stops before anything is written."""


def _id(pattern, value: object, what: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise BadRequest(f"{what} is not a Desk id")
    return value


def _size(value: object, what: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or not 0 < value <= 100_000:
        raise BadRequest(f"{what} is not a positive whole number of pixels")
    return value


def _raster(storage: Storage, guard: KeyGuard, ref: object, width: int, height: int, what: str) -> bytes:
    if not isinstance(ref, dict) or set(ref) != set(REF):
        raise BadRequest(f"{what}: its raster reference must have exactly {', '.join(REF)}")
    if (ref["width_px"], ref["height_px"]) != (width, height):
        raise BadRequest(f"{what}: its raster is {ref['width_px']}×{ref['height_px']}, not {width}×{height}")
    data = storage.get(guard.cmyk_raster(ref["key"]), ref["version_id"])
    if hashlib.sha256(data).hexdigest() != ref["sha256"]:
        raise BadRequest(f"{what}: the stored raster is not the one the request names")
    size = width * height * 4
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(data)) as gz:
            n = len(gz.read(size + 1))
    except (OSError, EOFError):
        raise BadRequest(f"{what}: its raster is not a gzip file that can be read") from None
    if n != size:
        raise BadRequest(f"{what}: its raster does not hold {width}×{height} CMYK pixels")
    return data


def _folder(base: Path, *parts: str) -> Path:
    """base/parts…, each folder made (0700) when missing; a symbolic link or a file anywhere on the way is refused."""
    path = Path(base)
    for part in parts:
        path = path / part
        try:
            mode = os.lstat(path).st_mode
        except FileNotFoundError:
            os.mkdir(path, util.DIR_MODE)
            os.chmod(path, util.DIR_MODE)
            continue
        if stat.S_ISLNK(mode) or not stat.S_ISDIR(mode):
            raise BadRequest(f"the home's folder {path.name} is a link or not a folder: refused")
    return path


def _sweep(folder: Path, keep: set[str]) -> None:
    """Removes the rasters and previews of an earlier request that this one does not name (never through a link)."""
    for f in folder.iterdir():
        if f.is_symlink() or not f.is_file() or f.name == "index.json":
            continue
        if f.name.split(".")[0] not in keep:
            util.remove_quietly(f)


@contextlib.contextmanager
def _locked(ed: Path):
    """The edition's lock, held across processes (released when the file is closed, or the process ends)."""
    fd = os.open(ed / ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, util.FILE_MODE)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        os.close(fd)


def _empty(folder: Path) -> None:
    for f in folder.iterdir():
        if f.is_dir() and not f.is_symlink():
            shutil.rmtree(f)
        else:
            f.unlink()


def _photos(storage: Storage, guard: KeyGuard, articles: list) -> tuple[list, dict, dict]:
    """Every article's ids and photo raster checked (one photo id, one raster) → (the articles without their raster
    references, {photo: raster bytes}, {photo: (width, height)})."""
    plain, photo_files, photo_index, photo_refs = [], {}, {}, {}
    for i, a in enumerate(articles):
        if not isinstance(a, dict):
            raise BadRequest(f"article {i} is not an object")
        _id(util.ARTICLE_ID, a.get("id"), f"article {i}")
        photo = a.get("photo")
        if photo is not None:
            if not isinstance(photo, dict):
                raise BadRequest(f"article {i}: its photo is not an object")
            pid = _id(util.PHOTO_ID, photo.get("id"), f"article {i}'s photo")
            w = _size(photo.get("width_px"), f"photo {pid}'s width")
            h = _size(photo.get("height_px"), f"photo {pid}'s height")
            ref = photo.get("raster")
            if pid in photo_refs:
                if ref != photo_refs[pid] or photo_index[pid][:2] != (w, h):     # one photo id, one raster
                    raise BadRequest(f"article {i}: photo {pid} is named with another raster")
            else:
                photo_files[pid] = _raster(storage, guard, ref, w, h, f"photo {pid}")
                photo_refs[pid], photo_index[pid] = ref, (w, h)
            photo = {k: v for k, v in photo.items() if k != "raster"}
        plain.append({**a, "photo": photo})
    return plain, photo_files, photo_index


def _write_live(ed: Path, pdir: Path, edition: dict, plain: list, photo_files: dict, photo_index: dict) -> None:
    """The edition's own files: its photos (an earlier request's swept), edition.json and articles.json."""
    _sweep(pdir, set(photo_files))
    for pid, data in photo_files.items():
        util.write_bytes(pdir / f"{pid}.cmyk.gz", data)
    util.write_json(pdir / "index.json", {"elements": {pid: {"width_px": w, "height_px": h, "ppi": None}
                                                       for pid, (w, h) in photo_index.items()}})
    util.write_json(ed / "edition.json", edition)
    util.write_json(ed / "articles.json", {"schema": ARTICLES_SCHEMA,
                                           "articles": [{k: v for k, v in a.items() if k not in DERIVED}
                                                        for a in plain]})


def write_live(storage: Storage, homes: Path, org_id: str, pub_id: str, edition_id: str, edition: object,
               articles: object) -> Path:
    """The edition's live content (the editor's Update text and save, gateway.py): edition.json, articles.json and
    their photo rasters, checked as materialise checks them, written WITHOUT touching any run folder or the ads. →
    the edition's folder."""
    guard = KeyGuard(org_id, pub_id)
    eid = _id(EDITION_ID, edition_id, "the edition")
    if not isinstance(edition, dict) or not isinstance(articles, list):
        raise BadRequest("the live edition or articles is not of its kind")
    if edition.get("id") != eid:
        raise BadRequest("the live content is for another edition")
    plain, photo_files, photo_index = _photos(storage, guard, articles)
    ed = _folder(util.ensure_dir(Path(homes)), guard.org_id, guard.pub_id, "editions", eid)
    with _locked(ed):
        _write_live(ed, _folder(ed, "photos"), edition, plain, photo_files, photo_index)
    return ed


def materialise(storage: Storage, homes: Path, org_id: str, pub_id: str, edition_id: str, run_key: str | None,
                request: bytes, request_sha256: str, config: dict | None = None) -> Path:
    """→ the run's folder in the publication's home, ready for `desk_engine.py generate`; with no run (a measure's
    snapshot, engine.measure), the edition's folder, its files only."""
    if hashlib.sha256(request).hexdigest() != request_sha256:
        raise BadRequest("the request is not the one the run names (its SHA-256 differs)")
    guard = KeyGuard(org_id, pub_id)
    eid = _id(EDITION_ID, edition_id, "the job's edition")
    rid = None if run_key is None else _id(RUN_ID, run_key, "the run")
    try:
        req = json.loads(request.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        raise BadRequest("the request cannot be read") from None
    if not isinstance(req, dict) or set(req) != {"edition", "articles", "ads"}:
        raise BadRequest("the request must have exactly edition, articles and ads")
    edition, articles, ads = req["edition"], req["articles"], req["ads"]
    if not isinstance(edition, dict) or not isinstance(articles, list) or not isinstance(ads, dict):
        raise BadRequest("the request's edition, articles or ads is not of its kind")
    if edition.get("id") != eid:
        raise BadRequest("the request is for another edition than the job's")

    plain, photo_files, photo_index = _photos(storage, guard, articles)    # every check and raster first, then writes
    ad_files, ad_index = {}, {}
    for slot, entry in ads.items():
        _id(util.SLOT_ID, slot, "an ad slot")
        if not isinstance(entry, dict):
            raise BadRequest(f"ad {slot} is not an object")
        w = _size(entry.get("width_px"), f"ad {slot}'s width")
        h = _size(entry.get("height_px"), f"ad {slot}'s height")
        ad_files[slot] = _raster(storage, guard, entry.get("raster"), w, h, f"ad {slot}")
        ad_index[slot] = {"width_px": w, "height_px": h, "ppi": entry.get("ppi")}

    home = _folder(util.ensure_dir(Path(homes)), guard.org_id, guard.pub_id)   # homes: the worker's own setting
    ed = _folder(home, "editions", eid)
    with _locked(ed):
        pdir, adir = _folder(ed, "photos"), _folder(ed, "ads")
        run = None if rid is None else _folder(ed, "runs", rid)
        if run is not None:
            _empty(run)
        _sweep(adir, set(ad_files))
        for slot, data in ad_files.items():
            util.write_bytes(adir / f"{slot}.cmyk.gz", data)
        util.write_json(adir / "index.json", {"elements": ad_index})
        _write_live(ed, pdir, edition, plain, photo_files, photo_index)
        desk_ads = {slot: {**ad_index[slot], "slot": slot, "w_px": ad_index[slot]["width_px"],
                           "h_px": ad_index[slot]["height_px"]} for slot in ads}
        if run is not None:
            util.write_json(run / "request.json", {"edition": edition, "articles": plain, "ads": desk_ads})
    if config is not None:
        util.write_json(home / "config.json", config)
    return ed if run is None else run
