"""The edit gateway (plan §1 L2.4, §2.4; the contract: packages/contracts/src/editor.ts, "the gateway's wire"): the
API's signed calls to the page editor, one Desk EditService (tools/desk/deskserver/editing.py, unchanged) per
publication home, on the engine host's private port.

    python -B -m pgn_worker.gateway        (PGN_GATEWAY_HOST 127.0.0.1, PGN_GATEWAY_PORT 8790, PGN_GATEWAY_SECRET)

- **Every request is signed**: X-Pgn-Time (Unix seconds), X-Pgn-Nonce (32 hex, random) and X-Pgn-Signature = hex
  HMAC-SHA256(secret, "METHOD\\npath with query\\ntime\\nnonce\\nhex SHA-256 of the body"), the secret
  PGN_GATEWAY_SECRET (64+ hex characters, its bytes the key). A time more than 60 s from now, a signature that does not
  match, or a nonce seen within the window (a replay) is 401. Bodies are JSON, at most 8 MiB.
- **POST /v1/call** (EditCall → EditAnswer). Postgres wins: the call's `state` is written first (each page's
  page-NN.edit.json whose {rev, modules} differ; rev 0, the layout's own, leaves no file; edit-articles.json, none
  for null), and an engine session of a page whose file changed is opened again (reload). A page file whose rev is
  higher than the state's (a change whose answer the API has not kept yet) is never moved back: it is reported in
  `edits`, so the API catches up. refresh and save write the
  edition's `live` content first, its ads too (home.write_live: no run folder is touched; the engine's Update text
  brings them into the run). Every ok answer carries `edits`: each
  page file the call changed (this page's, a move's target, the pages a save took a story from, the engine's own
  changes), and `text` when edit-articles.json changed. A save stores the page's PDF and previews at
  runs/<run>/pages/NN/edit-<rev>.{pdf,png,thumb.png} and the run's edition.pdf and press-files.zip (made from the
  pages' PDFs Postgres holds, state.pdfs: a local one that differs is fetched again) and reports `ads`, the SHA-256
  of each ad raster the page prints (printed_ads: null when not provably that file); a check runs the
  independent PDF/X-1a checker on the stored PDF it names and stores its report beside it.
- **GET /v1/glyphs/<org>/<pub>/<face>?ids=…** and **GET /v1/raster/<org>/<pub>/<key>.jpg**: the engine's cache, as
  the Desk serves it (404 when unknown).
- **GET /v1/press-test**: the press test page (G2-1, deskserver/presstest.py) as {format "pageinator.press-test/1", pdf
  (base64), sha256, bytes, icc_sha256, check {passed, fails, warnings}, maker, page_mm}; made once per colour profile
  (the page is deterministic) and kept in memory; 500 {error} when it cannot be made.
Calls of one publication take turns (the engine is one process per home); a save, and a move, hold the run's save
lock (one at a time in a run, as the Desk). Errors are the Desk's words (DeskText), never a path or a credential.
Settings as the worker's (pgn_worker/engine.py Settings, PGN_S3_*); a setting missing or not valid exits 78."""
from __future__ import annotations

import base64
import contextlib
import hashlib
import hmac
import json
import os
import re
import stat
import sys
import tempfile
import threading
import time
import traceback
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable
from urllib.parse import parse_qs, urlsplit

from . import engine, home
from .desk import REPO, desk_text, editing, images, messages as M, presstest, runs, util
from .keys import ORG_UUID, KeyGuard, KeyRefused, uuid
from .launcher import CHECKER_SHA256, _stored
from .media import Mismatch
from .storage import MissingObject, Storage

FORMAT = "pageinator.edit-call/1"
WINDOW_S = 60
MAX_BODY = 8 * 1024 * 1024
COMMANDS = ("open", "state", "set", "alternative", "refresh", "move", "save", "check")
NEEDS = {"set": "modules", "alternative": "variant", "move": ("story", "to"), "check": "pdf", "refresh": "live",
         "save": "live"}
CALL_KEYS = {"format", "org_id", "pub_id", "run_id", "edition_key", "run_key", "page", "cmd", "base_rev", "state"}
OPTIONAL = {"modules", "variant", "story", "to", "pdf", "live"}
STORY = re.compile(r"d[0-9a-f]{10}|dbriefs[0-9]{1,3}", re.ASCII)
SLOT = re.compile(r"[A-Za-z0-9_-]{1,40}", re.ASCII)                  # the contract's DeskSlot
SHA256 = re.compile(r"[0-9a-f]{64}", re.ASCII)
NONCE = re.compile(r"[0-9a-f]{32}", re.ASCII)
FACE = re.compile(r"[0-9a-f]{24}", re.ASCII)
EDIT_FILE = re.compile(r"page-(\d{2})\.edit\.json", re.ASCII)
PDF_NAME = re.compile(r"page\.pdf|edit-(?:0|[1-9][0-9]{0,9})\.pdf", re.ASCII)
MAX_REV = 2 ** 31 - 1
PAGE_EDIT, EDIT_ARTICLES = "pageinator.desk.page-edit/1", "pageinator.desk.edit-articles/1"
# the Desk's words for a run without its working files (deskserver/api.py _edit_page; not one of messages.json)
RUN_MISSING = ("This layout was made by an older version of the Desk, which did not keep what its pages print, or some "
               "of its files are missing. Lay the edition out again to edit its pages.")
ENGINE_FAILED = "The page editor's engine stopped or took too long. Try again."
STALE = M.msg("m.save.notChanged", reason=M.msg("m.edit.stale"))


class Refused(ValueError):
    """A call the gateway does not take (400 refused), in plain words without the caller's values."""


class RunMissing(LookupError):
    """The run's working files are not in the home (409 run_missing)."""


def _answer_error(status: int, code: str, text: object) -> tuple[int, dict]:
    return status, {"ok": False, "status": status, "code": code, "error": desk_text(text)}


# ------------------------------------------------------------------------------------------- signatures


def signature(secret: bytes, method: str, path: str, stamp: str, nonce: str, body: bytes) -> str:
    text = f"{method.upper()}\n{path}\n{stamp}\n{nonce}\n{hashlib.sha256(body).hexdigest()}"
    return hmac.new(secret, text.encode("utf-8"), hashlib.sha256).hexdigest()


class Signatures:
    """The signature check, with the nonces seen within the window (a second use is a replay)."""

    def __init__(self, secret: bytes, clock: Callable[[], float] = time.time):
        self.secret, self.clock = secret, clock
        self.seen: dict[str, float] = {}
        self.lock = threading.Lock()

    def check(self, method: str, path: str, stamp: str | None, nonce: str | None, sig: str | None,
              body: bytes) -> bool:
        if not stamp or not nonce or not sig or not re.fullmatch(r"[0-9]{1,12}", stamp) \
                or not NONCE.fullmatch(nonce) or not SHA256.fullmatch(sig):
            return False
        now = self.clock()
        if abs(now - int(stamp)) > WINDOW_S:
            return False
        if not hmac.compare_digest(signature(self.secret, method, path, stamp, nonce, body), sig):
            return False
        with self.lock:
            self.seen = {s: until for s, until in self.seen.items() if until >= now}
            if nonce in self.seen:
                return False
            self.seen[nonce] = int(stamp) + WINDOW_S + 1
        return True


# ------------------------------------------------------------------------------------------- the call's shape


def _int(v: object, lo: int, hi: int, what: str) -> int:
    if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
        raise Refused(f"{what} is not a whole number from {lo} to {hi}")
    return v


def _mm(v: object, what: str) -> None:
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not -10_000 <= v <= 10_000:
        raise Refused(f"{what} is not a number of millimetres")


def _modules(v: object) -> list:
    if not isinstance(v, list) or len(v) > 40:
        raise Refused("modules is not a list of at most 40 stories")
    for m in v:
        if not isinstance(m, dict) or not isinstance(m.get("story"), str) or not STORY.fullmatch(m["story"]):
            raise Refused("a module has no story")
        for k in ("x", "y", "h"):
            _mm(m.get(k), f"a module's {k}")
        _int(m.get("w"), 1, 40, "a module's w")
        if "locked" in m and not isinstance(m["locked"], bool):
            raise Refused("a module's locked is not true or false")
    return v


def _stored_file(f: object, what: str) -> None:
    if (not isinstance(f, dict) or set(f) != {"key", "version_id", "sha256", "bytes"} or not isinstance(f["key"], str)
            or not isinstance(f["version_id"], str) or not 0 < len(f["version_id"]) <= 1024
            or not isinstance(f["sha256"], str) or not SHA256.fullmatch(f["sha256"])):
        raise Refused(f"{what} is not a stored file")
    _int(f["bytes"], 0, 2 ** 53, f"{what}'s bytes")


def check_call(c: object) -> dict:
    """The EditCall (packages/contracts editor.ts), strictly."""
    if not isinstance(c, dict) or not CALL_KEYS <= set(c) or set(c) - CALL_KEYS - OPTIONAL:
        raise Refused("the call does not have exactly the fields of an edit call")
    if c["format"] != FORMAT:
        raise Refused("the call is not an edit call")
    uuid(c["org_id"], "org_id", ORG_UUID)
    for k in ("pub_id", "run_id"):
        uuid(c[k], k)
    if not isinstance(c["edition_key"], str) or not home.EDITION_ID.fullmatch(c["edition_key"]):
        raise Refused("edition_key is not a Desk edition id")
    if not isinstance(c["run_key"], str) or not home.RUN_ID.fullmatch(c["run_key"]):
        raise Refused("run_key is not a Desk run id")
    _int(c["page"], 1, 16, "page")
    if c["cmd"] not in COMMANDS:
        raise Refused("cmd is not an edit command")
    if c["base_rev"] is not None:
        _int(c["base_rev"], 0, MAX_REV, "base_rev")
    if "modules" in c:
        _modules(c["modules"])
    if "variant" in c and (isinstance(c["variant"], bool) or c["variant"] not in (1, 2, 3)):
        raise Refused("variant is not 1, 2 or 3")
    if "story" in c and (not isinstance(c["story"], str) or not STORY.fullmatch(c["story"])):
        raise Refused("story is not a story's key")
    if "to" in c:
        _int(c["to"], 1, 16, "to")
    if "pdf" in c:
        _stored_file(c["pdf"], "pdf")
    if "live" in c:
        live = c["live"]
        # ads may be missing (an API older than this gateway): the edition's ads are then left as they are
        if (not isinstance(live, dict) or not {"edition", "articles"} <= set(live) <= {"edition", "articles", "ads"}
                or not isinstance(live["edition"], dict) or not isinstance(live["articles"], list)
                or len(live["articles"]) > 2000 or not isinstance(live.get("ads", {}), dict)):
            raise Refused("live is not an edition, its articles and its ads")
    state = c["state"]
    if not isinstance(state, dict) or not {"pages", "text"} <= set(state) <= {"pages", "text", "pdfs"} \
            or not isinstance(state["pages"], list) or len(state["pages"]) > 16:
        raise Refused("state is not the run's pages and text")
    if "pdfs" in state:
        if not isinstance(state["pdfs"], list) or len(state["pdfs"]) > 16:
            raise Refused("state's pdfs is not the run's page PDFs")
        for e in state["pdfs"]:
            if not isinstance(e, dict) or set(e) != {"page", "pdf"}:
                raise Refused("a page PDF of the state is not {page, pdf}")
            _int(e["page"], 1, 16, "a state PDF's page")
            _stored_file(e["pdf"], "a state PDF")
    seen = set()
    for p in state["pages"]:
        if not isinstance(p, dict) or set(p) != {"page", "rev", "modules"}:
            raise Refused("a page of the state is not {page, rev, modules}")
        n = _int(p["page"], 1, 16, "a state page")
        if n in seen:
            raise Refused("a page is twice in the state")
        seen.add(n)
        _int(p["rev"], 0, MAX_REV, "a state page's rev")
        _modules(p["modules"])
    text = state["text"]
    if text is not None and (not isinstance(text, dict) or not all(isinstance(k, str) and util.ARTICLE_ID.fullmatch(k)
                                                                   for k in text)):
        raise Refused("state's text is not the run's article overrides")
    needs = NEEDS.get(c["cmd"], ())
    for k in (needs,) if isinstance(needs, str) else needs:
        if k not in c:
            raise Refused(f"{c['cmd']} needs {k}")
    return c


# ------------------------------------------------------------------------------------------- the run's files


def _existing(base: Path, *parts: str) -> Path:
    """base/parts…, each an existing folder (RunMissing), never a link (Refused)."""
    path = Path(base)
    for part in parts:
        path = path / part
        try:
            mode = os.lstat(path).st_mode
        except FileNotFoundError:
            raise RunMissing() from None
        if not stat.S_ISDIR(mode):                                  # a link (lstat) or a file
            raise Refused("a folder of the home is a link or not a folder")
    return path


def page_edits(run_dir: Path) -> dict[int, dict]:
    """Every page-NN.edit.json that can be read: {page: {"rev", "modules"}}."""
    out = {}
    for f in run_dir.glob("page-*.edit.json"):
        m = EDIT_FILE.fullmatch(f.name)
        if not m or f.is_symlink():
            continue
        try:
            doc = util.read_json(f)
        except (OSError, util.DeskError):
            continue
        n = int(m.group(1))
        if isinstance(doc, dict) and doc.get("page") == n:
            out[n] = {"rev": doc.get("rev"), "modules": doc.get("modules")}
    return out


def text_overrides(run_dir: Path) -> object:
    """edit-articles.json's "articles" (None: no file, or one that cannot be read)."""
    try:
        doc = util.read_json(run_dir / "edit-articles.json", None)
    except util.DeskError:
        return None
    return doc.get("articles") if isinstance(doc, dict) else None


def sync(run_dir: Path, state: dict) -> tuple[set[int], set[int]]:
    """The API's state written into the run (Postgres wins), except a page file at a higher rev than the state's: never
    moved back (the API catches up on it). → (the pages whose edit file changed, the pages whose file is ahead)."""
    want = {p["page"]: p for p in state["pages"] if p["rev"] > 0}
    have = page_edits(run_dir)
    ahead = {n for n, e in have.items() if isinstance(e["rev"], int) and isinstance(e["modules"], list)
             and e["rev"] > (want[n]["rev"] if n in want else 0)}
    files = {int(m.group(1)) for f in run_dir.glob("page-*.edit.json") if (m := EDIT_FILE.fullmatch(f.name))}
    changed = set()
    for n in sorted((set(want) | files) - ahead):
        path = run_dir / f"page-{n:02d}.edit.json"
        if n not in want:                                         # rev 0: the layout's own, no file
            util.remove_quietly(path)
            changed.add(n)
        elif have.get(n) != {"rev": want[n]["rev"], "modules": want[n]["modules"]}:
            util.write_json(path, {"schema": PAGE_EDIT, "page": n, "modules": want[n]["modules"],
                                   "rev": want[n]["rev"]})
            changed.add(n)
    path = run_dir / "edit-articles.json"
    if state["text"] is None:
        util.remove_quietly(path)
    elif text_overrides(run_dir) != state["text"] or not path.is_file():
        util.write_json(path, {"schema": EDIT_ARTICLES, "articles": state["text"]})
    return changed, ahead


def printed_ads(run_dir: Path, printed: object) -> dict[str, str | None]:
    """{slot: the SHA-256 of runs/<run>/ads/<slot>.cmyk.gz} for each ad slot of a page's printed record (deskprinted),
    None when the page prints no ad there or the file now is not the one printed (its signature differs): fail closed."""
    ads = printed.get("ads") if isinstance(printed, dict) else None
    out: dict[str, str | None] = {}
    for slot, sig in ads.items() if isinstance(ads, dict) else ():
        if not isinstance(slot, str) or not SLOT.fullmatch(slot):   # not a slot the API takes: not reported
            continue
        path = run_dir / "ads" / f"{slot}.cmyk.gz"
        same = sig is not None and editing.deskprinted.file_sig(path) == sig
        out[slot] = hashlib.sha256(path.read_bytes()).hexdigest() if same else None
    return out


def edits_since(before: dict[int, dict], run_dir: Path) -> list[dict]:
    """The page files that changed since `before` (the contract's PageEditState)."""
    out = []
    for n, e in sorted(page_edits(run_dir).items()):
        if e != before.get(n) and 1 <= n <= 16 and isinstance(e["rev"], int) and isinstance(e["modules"], list):
            out.append({"page": n, "rev": e["rev"], "modules": e["modules"]})
    return out


# ------------------------------------------------------------------------------------------- the gateway


@dataclass
class Home:
    """One publication's EditService, its turn lock and the page sessions opened through it."""
    service: editing.EditService
    lock: threading.Lock = field(default_factory=threading.Lock)
    opened: set = field(default_factory=set)


class Gateway:
    def __init__(self, secret: bytes, settings: engine.Settings, storage_for: Callable[[KeyGuard], Storage],
                 clock: Callable[[], float] = time.time):
        self.signatures = Signatures(secret, clock)
        self.settings, self.storage_for = settings, storage_for
        self.homes: dict[tuple[str, str], Home] = {}
        self.lock = threading.Lock()
        self.press_lock = threading.Lock()                 # one press test page made at a time; the others wait for it
        self.press_cache: tuple[str, tuple[int, str, bytes]] | None = None   # (the profile's SHA-256, the answer)

    def close(self) -> None:
        with self.lock:
            for h in self.homes.values():
                h.service.close()

    def _home(self, guard: KeyGuard) -> tuple[Path, Home]:
        home_dir = _existing(self.settings.homes, guard.org_id, guard.pub_id)
        with self.lock:
            key = (guard.org_id, guard.pub_id)
            if key not in self.homes:
                self.homes[key] = Home(editing.EditService(engine.engine(self.settings, home_dir), home_dir))
            return home_dir, self.homes[key]

    # ---------------------------------------------------------------------------------------- HTTP

    def handle(self, method: str, target: str, headers: dict, body: bytes) -> tuple[int, str, bytes]:
        """One request → (status, content type, body)."""
        if not self.signatures.check(method, target, headers.get("x-pgn-time"), headers.get("x-pgn-nonce"),
                                     headers.get("x-pgn-signature"), body):
            return _json(401, {"error": "unauthorised"})
        if method == "POST" and "application/json" not in headers.get("content-type", ""):
            return _json(415, {"error": "JSON only"})
        url = urlsplit(target)
        parts = url.path.split("/")
        try:
            if method == "POST" and url.path == "/v1/call":
                status, answer = self.call(body)
                return _json(status, answer)
            if method == "GET" and len(parts) == 6 and parts[:3] == ["", "v1", "glyphs"]:
                return self.glyphs(parts[3], parts[4], parts[5], parse_qs(url.query).get("ids", [""])[0])
            if method == "GET" and len(parts) == 6 and parts[:3] == ["", "v1", "raster"]:
                return self.raster(parts[3], parts[4], parts[5])
            if method == "GET" and url.path == "/v1/press-test":
                return self.press_test()
        except (KeyRefused, RunMissing, Refused, util.DeskError):
            pass
        except Exception:  # noqa: BLE001 — a font or raster in the cache that cannot be read (logged here)
            traceback.print_exc(file=sys.stderr)
            return _json(500, {"error": "the engine's cache could not be read"})
        return _json(404, {"error": "not found"})

    def glyphs(self, org: str, pub: str, face: str, ids: str) -> tuple[int, str, bytes]:
        if not FACE.fullmatch(face) or not re.fullmatch(r"[0-9]{1,5}(,[0-9]{1,5}){0,3999}", ids):
            return _json(404 if not FACE.fullmatch(face) else 400, {"error": "bad glyph request"})
        _, h = self._home(KeyGuard(org, pub))
        return _json(200, h.service.glyphs(face, [int(x) for x in ids.split(",")]))

    def raster(self, org: str, pub: str, name: str) -> tuple[int, str, bytes]:
        if not name.endswith(".jpg") or not FACE.fullmatch(name[:-4]):
            return _json(404, {"error": "not found"})
        _, h = self._home(KeyGuard(org, pub))
        return 200, "image/jpeg", h.service.raster(name[:-4]).read_bytes()

    def press_test(self) -> tuple[int, str, bytes]:
        """The press test page, made again only when the colour profile changed (the page is deterministic)."""
        with self.press_lock:
            try:
                icc = hashlib.sha256(images.icc_path().read_bytes()).hexdigest()
            except OSError:
                return _json(500, {"error": presstest.NO_PROFILE})
            try:
                if self.press_cache is None or self.press_cache[0] != icc:
                    with tempfile.TemporaryDirectory(prefix="pgn-press-test-") as tmp:
                        made = presstest.make(REPO, self.settings.python, Path(tmp))
                    pdf = made["pdf"]
                    self.press_cache = (made["icc_sha256"], _json(200, {
                        "format": "pageinator.press-test/1", "pdf": base64.b64encode(pdf).decode("ascii"),
                        "sha256": made["sha256"], "bytes": len(pdf), "icc_sha256": made["icc_sha256"],
                        "check": made["check"], "maker": made["maker"], "page_mm": [347, 540]}))
                return self.press_cache[1]
            except util.DeskError as e:
                return _json(500, {"error": str(e.message)})
            except Exception:  # noqa: BLE001 — the engine host's fault, said without its details (logged here)
                traceback.print_exc(file=sys.stderr)
                return _json(500, {"error": presstest.ENGINE_FAILED})

    # ---------------------------------------------------------------------------------------- POST /v1/call

    def call(self, body: bytes) -> tuple[int, dict]:
        try:
            c = check_call(json.loads(body.decode("utf-8")))
            guard = KeyGuard(c["org_id"], c["pub_id"])
        except (UnicodeDecodeError, ValueError, RecursionError) as e:   # Refused and KeyRefused are ValueErrors
            return _answer_error(400, "refused", str(e) if isinstance(e, (Refused, KeyRefused))
                                 else "The call is not one JSON object.")
        try:
            if c["cmd"] == "check":
                return 200, self.check(guard, c)
            return 200, self.edit(guard, c)
        except RunMissing:
            return _answer_error(409, "run_missing", RUN_MISSING)
        except util.DeskError as e:
            if e.status == 409:
                return _answer_error(409, "stale", e.message)
            if e.status in (400, 404):
                return _answer_error(400, "refused", e.message)
            return _answer_error(503, "engine", e.message)
        except (Refused, KeyRefused, home.BadRequest, Mismatch, MissingObject) as e:
            return _answer_error(400, "refused", str(e))
        except Exception:  # noqa: BLE001 — the engine host's fault, said without its details (logged here)
            traceback.print_exc(file=sys.stderr)
            return _answer_error(503, "engine", ENGINE_FAILED)

    def edit(self, guard: KeyGuard, c: dict) -> dict:
        eid, rk, page, cmd, base = c["edition_key"], c["run_key"], c["page"], c["cmd"], c["base_rev"]
        home_dir, h = self._home(guard)
        run_dir = _existing(home_dir, "editions", eid, "runs", rk)
        needed = [run_dir / f for f in ("request.json", "plan.json", "printed.json", f"page-{page:02d}.manifest.json")]
        if not all(f.is_file() for f in [*needed, home_dir / "config.json"]):
            raise RunMissing()
        svc, session = h.service, f"{eid}/{rk}/{page}"
        saved = ads = None
        with editing.save_lock(run_dir) if cmd in ("save", "move") else contextlib.nullcontext():
            with h.lock:
                changed, ahead = sync(run_dir, c["state"])
                before, text_before = page_edits(run_dir), text_overrides(run_dir)
                for n in ahead:                               # reported in edits: the API catches up
                    before.pop(n, None)
                for n in sorted(changed):                     # an open page whose file changed: opened again
                    if f"{eid}/{rk}/{n}" in h.opened and not (cmd == "open" and n == page):
                        svc.open(eid, rk, n, reload=True)
                if cmd in ("refresh", "save"):
                    home.write_live(self.storage_for(guard), self.settings.homes, guard.org_id, guard.pub_id, eid,
                                    c["live"]["edition"], c["live"]["articles"], c["live"].get("ads"))
                h.opened.add(session)
                if cmd == "open":
                    result = svc.open(eid, rk, page, reload=page in changed)
                elif cmd == "state":
                    result = svc.state(session)
                elif cmd == "set":
                    result = svc.set_modules(session, c["modules"], base)
                elif cmd == "alternative":
                    result = svc.alternative(session, c["variant"], base)
                elif cmd == "refresh":
                    result = svc.refresh(session, base)
                elif cmd == "move":
                    h.opened.add(f"{eid}/{rk}/{c['to']}")      # the engine opens the page it goes to
                    result = svc.move(session, c["story"], c["to"], base)
                else:
                    state = svc.state(session)                 # the Desk's save (deskserver/api.py _save)
                    if base is not None and state.get("rev") != base:
                        raise util.DeskError(409, STALE)
                    held = editing.locked_elsewhere(state)
                    if held:
                        raise util.DeskError(400, held)
                    result = svc.export(session, base)
                    ads = printed_ads(run_dir, result.get("printed"))   # in the home's turn: no Update text between
                edits, text_after = edits_since(before, run_dir), text_overrides(run_dir)
            if cmd == "save":
                saved = {**self._save_files(guard, c, run_dir, result), "ads": ads}
        answer = {"ok": True, "result": result, "edits": edits,
                  "text": text_after if text_after != text_before else None}
        if saved is not None:
            answer["saved"] = saved
        return answer

    def _save_files(self, guard: KeyGuard, c: dict, run_dir: Path, res: dict) -> dict:
        """After the engine wrote the page's PDF (under the run's save lock): its previews, edition.pdf and
        press-files.zip made again from the run's page PDFs, all stored; what the page prints checked against the
        edition's live content (deskprinted.stale)."""
        page, run_id, storage = c["page"], c["run_id"], self.storage_for(guard)
        rev = _int(res.get("rev"), 0, MAX_REV, "the saved revision")
        key = lambda name: guard.run_file(run_id, name, page)  # noqa: E731
        pdf = run_dir / f"page-{page:02d}.pdf"
        png, thumb = pdf.with_suffix(".png"), pdf.with_name(f"{pdf.stem}.thumb.png")
        failed = lambda e: M.msg("m.save.filesNotFinished")  # noqa: E731
        error = None
        stored = {"pdf": None, "png": None, "thumb": None, "edition_pdf": None, "press_zip": None}
        try:
            stored["pdf"] = _stored(storage, key(f"edit-{rev}.pdf"), pdf)
        except Exception as e:  # noqa: BLE001 — the store failed: the page stays to save; the edits still go back
            traceback.print_exc(file=sys.stderr)
            error = failed(e)
        if stored["pdf"] is not None:
            for f in (png, thumb):
                util.remove_quietly(f)
            try:
                runs.render_page(pdf, png, thumb)
                stored["png"] = _stored(storage, key(f"edit-{rev}.png"), png)
                stored["thumb"] = _stored(storage, key(f"edit-{rev}.thumb.png"), thumb)
            except Exception as e:  # noqa: BLE001 — said on the page (the Desk's words); saved again later
                error = failed(e)
            try:
                pdfs = self._run_pdfs(guard, c, run_dir, pdf)
                runs.merge_pdfs(pdfs, run_dir / "edition.pdf")
                runs.zip_pdfs(pdfs, run_dir / "press-files.zip")
                stored["edition_pdf"] = _stored(storage, guard.run_file(run_id, "edition.pdf"),
                                                run_dir / "edition.pdf")
                stored["press_zip"] = _stored(storage, guard.run_file(run_id, "press-files.zip"),
                                              run_dir / "press-files.zip")
            except Exception as e:  # noqa: BLE001
                error = error or failed(e)
        printed = res.get("printed") if isinstance(res.get("printed"), dict) else None
        status = {"pages": [{"page": page, "state": "done", "printed": printed}]}
        editing.refresh_stale(status, run_dir)                 # against the live content just written
        problems = res.get("problems")
        kinds = editing.placement(problems)
        warnings = editing.deskprinted.unset(printed, editing._edition(run_dir)) + editing._warnings(
            [p for p in problems if isinstance(p, dict)] if isinstance(problems, list) else [])
        changed = res.get("pages_changed") if isinstance(res.get("pages_changed"), dict) else {}
        return {"rev": rev, **stored,
                "articles": [a for a in res.get("articles") or [] if isinstance(a, str)
                             and util.ARTICLE_ID.fullmatch(a)][:200],
                "pages_changed": {str(n): [a for a in v if isinstance(a, str)] for n, v in changed.items()
                                  if re.fullmatch(r"[1-9]|1[0-6]", str(n)) and isinstance(v, list)},
                "printed": printed,
                "layout_problems": ["unreadable"] if kinds is None else [str(k)[:40] for k in kinds][:20],
                "warnings": [desk_text(w) for w in warnings][:50],
                "stale": [desk_text(s) for s in status["pages"][0].get("stale") or []][:50],
                "error": desk_text(error) if error else None}

    def _run_pdfs(self, guard: KeyGuard, c: dict, run_dir: Path, saved: Path) -> list[Path]:
        """The run's page PDFs for edition.pdf and the ZIP: without state.pdfs every local one; with it, the page just
        saved and the pages it names, each local file that is not the stored one replaced by it (Postgres wins)."""
        if "pdfs" not in c["state"]:
            return sorted(p for p in run_dir.glob("page-*.pdf") if runs.PAGE_PDF.fullmatch(p.name) and p.is_file())
        out, storage = [saved], self.storage_for(guard)
        for e in c["state"]["pdfs"]:
            if e["page"] == c["page"]:
                continue
            f, local = e["pdf"], run_dir / f"page-{e['page']:02d}.pdf"
            _run_pdf_name(guard, c["run_id"], e["page"], f)
            mine = local.is_file() and not local.is_symlink()
            if not mine or hashlib.sha256(local.read_bytes()).hexdigest() != f["sha256"]:
                data = storage.get(f["key"], f["version_id"])
                if hashlib.sha256(data).hexdigest() != f["sha256"]:
                    raise Mismatch("a stored page PDF is not the one the state names")
                util.write_bytes(local, data)
            out.append(local)
        return sorted(out)

    def check(self, guard: KeyGuard, c: dict) -> dict:
        """The independent PDF/X-1a check of a stored page PDF of this run (pinned), its report stored beside it."""
        f, page, run_id = c["pdf"], c["page"], c["run_id"]
        name = _run_pdf_name(guard, run_id, page, f)
        storage = self.storage_for(guard)
        local = f"page-{page:02d}.pdf"
        try:
            data = (_existing(self.settings.homes, guard.org_id, guard.pub_id, "editions", c["edition_key"], "runs",
                              c["run_key"]) / local).read_bytes()
        except (RunMissing, OSError):
            data = b""
        if hashlib.sha256(data).hexdigest() != f["sha256"]:   # not the page's file now: the stored version
            data = storage.get(f["key"], f["version_id"])
            if hashlib.sha256(data).hexdigest() != f["sha256"]:
                raise Mismatch("the stored PDF is not the one the call names")
        with tempfile.TemporaryDirectory(prefix="pgn-check-") as tmp:
            pdf = Path(tmp) / local
            util.write_bytes(pdf, data)
            verdict = runs.check_pdfx(REPO, pdf)
            report = pdf.with_name(pdf.stem + ".pdfx-check.txt")
            report_name = "pdfx-check.txt" if name == "page.pdf" else name[:-4] + ".pdfx-check.txt"
            stored = _stored(storage, guard.run_file(run_id, report_name, page), report) if report.is_file() else None
        verdict = {"passed": bool(verdict.get("passed")), "fails": verdict.get("fails"),
                   "warnings": verdict.get("warnings")}
        return {"ok": True, "result": verdict, "edits": [], "text": None,
                "checked": {**verdict, "report": stored, "checker_sha256": CHECKER_SHA256}}


def _run_pdf_name(guard: KeyGuard, run_id: str, page: int, f: dict) -> str:
    """A stored page PDF of this run and page (page.pdf, or edit-<rev>.pdf) → its name; Refused otherwise."""
    name = guard.check(f["key"]).rsplit("/", 1)[1]
    if not PDF_NAME.fullmatch(name) or guard.run_file(run_id, name, page) != f["key"]:
        raise Refused("pdf is not a page PDF of this run")
    return name


def _json(status: int, doc: dict) -> tuple[int, str, bytes]:
    return status, "application/json", json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


# ------------------------------------------------------------------------------------------- the server


class Handler(BaseHTTPRequestHandler):
    server_version = "pgn-gateway"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def _serve(self, method: str) -> None:
        length = self.headers.get("Content-Length") or "0"
        if not length.isdigit() or int(length) > MAX_BODY:
            self._send(*_json(413, {"error": "the body is too large"}), close=True)
            return
        body = self.rfile.read(int(length))
        headers = {k.lower(): v for k, v in self.headers.items()}
        self._send(*self.server.gateway.handle(method, self.path, headers, body))

    def _send(self, status: int, ctype: str, data: bytes, close: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        if close:
            self.send_header("Connection", "close")
            self.close_connection = True
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        self._serve("GET")

    def do_POST(self) -> None:  # noqa: N802
        self._serve("POST")

    def log_message(self, format: str, *args) -> None:  # noqa: A002 — quiet: no ids or paths in the logs
        pass


def settings_from_env(env: dict[str, str]) -> tuple[bytes, str, int, engine.Settings, Callable[[KeyGuard], Storage]]:
    """(secret, host, port, engine settings, the store for a publication); engine.ConfigError when not usable."""
    from .storage_s3 import S3Settings, S3Storage, SettingsError
    secret = env.get("PGN_GATEWAY_SECRET", "")
    if len(secret) < 64 or len(secret) % 2 or not re.fullmatch(r"[0-9a-fA-F]+", secret):
        raise engine.ConfigError("PGN_GATEWAY_SECRET must be at least 64 hex characters (32 bytes)")
    port = env.get("PGN_GATEWAY_PORT", "8790")
    if not port.isdigit() or not 0 < int(port) < 65536:
        raise engine.ConfigError("PGN_GATEWAY_PORT must be a port number")
    try:
        s3 = S3Settings.from_env(env)
    except SettingsError as e:
        raise engine.ConfigError(str(e)) from None
    client = s3.client()
    return (bytes.fromhex(secret), env.get("PGN_GATEWAY_HOST", "127.0.0.1"), int(port), engine.Settings.from_env(env),
            lambda guard: S3Storage(client, s3.work_bucket, guard))


def serve(gateway: Gateway, host: str, port: int) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.gateway = gateway
    return server


def main() -> int:
    try:
        secret, host, port, settings, storage_for = settings_from_env(dict(os.environ))
    except engine.ConfigError as e:
        print(f"pgn-gateway: {e}", file=sys.stderr)
        return 78
    gateway = Gateway(secret, settings, storage_for)
    server = serve(gateway, host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        gateway.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
