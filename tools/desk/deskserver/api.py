"""HTTP (CONTRACT.md §3): JSON over HTTP on 127.0.0.1 only, the UI's static files and the files of an edition.

Every request must name the server as Host (127.0.0.1:<port> or localhost:<port>: no DNS rebinding); every POST, PUT
and DELETE must carry `X-Desk: 1` (a cross-site page cannot send it without a CORS preflight, which is never granted)
and, when the browser sends an Origin, come from the Desk's own origin."""
from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import sys
import time
import traceback
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socketserver import TCPServer
from typing import TYPE_CHECKING, Any
from urllib.parse import parse_qs, unquote, urlsplit

from . import __version__, docx, editing, images
from .store import AD_BUSY, decorate, parse_pages
from .util import ARTICLE_ID, SLOT_ID, DeskError, path_id

if TYPE_CHECKING:
    from .app import Desk

JSON_LIMIT = 2 * 1024 * 1024
DRAIN_LIMIT = 256 * 1024 * 1024          # an over-large body is read and dropped (so the client sees the 413) up to this
# Only the Desk's own files: no other site is ever contacted, and no inline script runs (pasted text cannot become code).
CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
       "font-src 'self' data:; connect-src 'self'; frame-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; "
       "form-action 'self'")
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
                ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
                ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8"}
STATIC_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
FILE_TYPES = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".zip": "application/zip"}
RUN_FILE = re.compile(r"page-\d{2}\.(?:pdf|png|thumb\.png)|edition\.pdf|press-files\.zip")
PHOTO_JPG = re.compile(r"(p-[0-9a-f]{10})\.jpg")
AD_JPG = re.compile(r"([a-z0-9-]{1,40})\.jpg")
QUIET = re.compile(r"/api/editions/[^/]+/runs/[^/]+|/files/.*")    # polled by the UI: logged only when they fail
PLACEHOLDER = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Pageinator Desk</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#222}</style>
</head><body><h1>Pageinator Desk</h1>
<p>The Desk server is running, but the Desk's screens are not installed yet
(<code>tools/desk/static/index.html</code> is missing).</p>
<p>The server's status is at <a href="/api/status">/api/status</a>.</p>
</body></html>
""".encode("utf-8")

ROUTES = [(method, re.compile(pattern), name, body) for method, pattern, name, body in [
    ("GET", r"/", "index", None),
    ("GET", r"/static/(.+)", "static", None),
    ("GET", r"/api/status", "status", None),
    ("POST", r"/api/setup", "setup", "json"),
    ("GET", r"/api/plan", "plan", None),
    ("GET", r"/api/samples", "samples", None),
    ("GET", r"/api/editions", "list_editions", None),
    ("POST", r"/api/editions", "create_edition", "json"),
    ("GET", r"/api/editions/([^/]+)", "get_edition", None),
    ("PUT", r"/api/editions/([^/]+)", "update_edition", "json"),
    ("DELETE", r"/api/editions/([^/]+)", "delete_edition", None),
    ("POST", r"/api/editions/([^/]+)/articles", "create_article", "json"),
    ("POST", r"/api/editions/([^/]+)/articles/bulk", "bulk_articles", "json"),
    ("POST", r"/api/editions/([^/]+)/articles/import-docx", "import_docx", "docx"),
    ("PUT", r"/api/editions/([^/]+)/articles/([^/]+)", "update_article", "json"),
    ("DELETE", r"/api/editions/([^/]+)/articles/([^/]+)", "delete_article", None),
    ("PUT", r"/api/editions/([^/]+)/articles/([^/]+)/photo", "put_photo", "image"),
    ("DELETE", r"/api/editions/([^/]+)/articles/([^/]+)/photo", "delete_photo", None),
    ("PUT", r"/api/editions/([^/]+)/articles/([^/]+)/photo-text", "photo_text", "json"),
    ("POST", r"/api/editions/([^/]+)/import-sample", "import_sample", "json"),
    ("PUT", r"/api/editions/([^/]+)/ads/([^/]+)", "put_ad", "image"),
    ("DELETE", r"/api/editions/([^/]+)/ads/([^/]+)", "delete_ad", None),
    ("POST", r"/api/editions/([^/]+)/runs", "create_run", "json"),
    ("GET", r"/api/editions/([^/]+)/runs/([^/]+)", "run_status", None),
    ("POST", r"/api/editions/([^/]+)/runs/([^/]+)/cancel", "cancel_run", "json"),
    ("GET", r"/files/([^/]+)/photos/([^/]+)", "photo_file", None),
    ("GET", r"/files/([^/]+)/ads/([^/]+)", "ad_file", None),
    ("GET", r"/files/([^/]+)/runs/([^/]+)/([^/]+)", "run_file", None),
    ("POST", r"/api/editions/([^/]+)/runs/([^/]+)/pages/(\d{1,2})/edit", "edit_open", "json"),
    ("PUT", r"/api/editions/([^/]+)/runs/([^/]+)/pages/(\d{1,2})/edit", "edit_set", "json"),
    ("POST", r"/api/editions/([^/]+)/runs/([^/]+)/pages/(\d{1,2})/save", "edit_save", "json"),
    ("POST", r"/api/editions/([^/]+)/runs/([^/]+)/pages/(\d{1,2})/alternative", "edit_alternative", "json"),
    ("POST", r"/api/editions/([^/]+)/runs/([^/]+)/pages/(\d{1,2})/refresh", "edit_refresh", "json"),
    ("GET", r"/api/glyphs/([0-9a-f]{24})", "glyphs", None),
    ("GET", r"/files/rasters/([0-9a-f]{24})\.jpg", "raster_file", None),
]]


@dataclass
class Request:
    method: str
    path: str
    query: dict[str, list[str]]
    body: bytes
    args: tuple[str, ...]

    def q(self, name: str) -> str | None:
        values = self.query.get(name)
        return values[0] if values else None

    def json(self) -> dict:
        if not self.body.strip():
            return {}
        try:
            obj = json.loads(self.body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError, RecursionError):        # RecursionError: nested beyond reason
            raise DeskError(400, "The request is not valid JSON.") from None
        if not isinstance(obj, dict):
            raise DeskError(400, "The request must be a JSON object.")
        return obj


@dataclass
class Reply:
    body: bytes = b""
    content_type: str = "application/json; charset=utf-8"
    cache: str = "no-store"
    path: Path | None = None                   # stream this file instead of `body`
    headers: list[tuple[str, str]] = field(default_factory=list)


def _flag(value: str | None, default: bool) -> bool:
    if value is None or value == "":
        return default
    if value.lower() in ("1", "true", "yes"):
        return True
    if value.lower() in ("0", "false", "no"):
        return False
    raise DeskError(400, "back_ads must be 1 or 0.")


# ------------------------------------------------------------------------------------------- the actions


class Api:
    def __init__(self, desk: "Desk"):
        self.desk = desk
        self.store = desk.store
        self.engine = desk.engine
        self.jobs = desk.jobs

    # the UI

    def index(self, req: Request) -> Reply:
        page = self.desk.static_dir / "index.html"
        if page.is_file():
            return Reply(path=page, content_type=STATIC_TYPES[".html"])
        return Reply(PLACEHOLDER, STATIC_TYPES[".html"])

    def static(self, req: Request) -> Reply:
        parts = req.args[0].split("/")
        ctype = STATIC_TYPES.get(Path(parts[-1]).suffix.lower())
        if not ctype or not all(STATIC_NAME.fullmatch(p) for p in parts):
            raise DeskError(404, "There is no such file.")
        root = self.desk.static_dir.resolve()
        path = root.joinpath(*parts).resolve()
        if root not in path.parents or not path.is_file():
            raise DeskError(404, "There is no such file.")
        return Reply(path=path, content_type=ctype)

    # status, set-up and the engine's answers

    def status(self, req: Request) -> dict:
        engine_ok = self.engine.ok()
        config_ok, config_message = self.engine.config_state()
        icc_ok = images.icc_ok()
        if not engine_ok:
            message = self.engine.missing_message()
        elif not config_ok:
            message = config_message
        elif not icc_ok:
            message = ("Ready, but photos and ads cannot be converted for print until the newsprint colour profile is "
                       "in place (PAGEINATOR_ICC).")
        else:
            message = "Ready."
        return {"version": __version__, "engine_ok": engine_ok, "config_ok": config_ok, "home": str(self.desk.home),
                "cores": os.cpu_count() or 1, "message": message, "icc_ok": icc_ok}

    def setup(self, req: Request) -> dict:
        dataset = req.json().get("dataset")
        if dataset is not None:
            if not isinstance(dataset, str) or not dataset.strip():
                raise DeskError(400, "Give the dataset folder as text, or leave it out.")
            dataset = os.path.expanduser(dataset.strip())
            if dataset.startswith("-") or not os.path.isdir(dataset):
                raise DeskError(400, "There is no folder at that dataset path.")
        return self.engine.setup(dataset)

    def plan(self, req: Request) -> dict:
        return self.engine.plan(parse_pages(req.q("pages") or 8), _flag(req.q("back_ads"), True))

    def samples(self, req: Request) -> dict:
        return self.engine.samples()

    # editions

    def list_editions(self, req: Request) -> dict:
        return {"editions": self.store.list_editions()}

    def create_edition(self, req: Request) -> dict:
        return self.store.create_edition(req.json())

    def get_edition(self, req: Request) -> dict:
        eid = req.args[0]
        edition = self.store.get_edition(eid)
        articles = [decorate(a) for a in self.store.read_articles(eid)]
        plan, plan_error = None, None
        try:
            plan = self.engine.plan(parse_pages(edition.get("pages")), bool(edition.get("back_page_ads", True)))
        except DeskError as e:
            plan_error = e.message
        return {"edition": edition, "articles": articles, "ads": self.store.ads_summary(eid), "plan": plan,
                "plan_error": plan_error, "runs": self.store.list_runs(eid), "measure": self.store.measure_status(eid)}

    def update_edition(self, req: Request) -> dict:
        return self.store.update_edition(req.args[0], req.json())

    def delete_edition(self, req: Request) -> dict:
        self.store.delete_edition(req.args[0])
        return {"ok": True}

    # articles

    def create_article(self, req: Request) -> dict:
        return self.store.create_article(req.args[0], req.json())

    def bulk_articles(self, req: Request) -> dict:
        body = req.json()
        if "text" not in body:
            raise DeskError(400, "Paste the articles as text.")
        return self.store.bulk_create(req.args[0], body["text"])

    def import_docx(self, req: Request) -> dict:
        """A Word (.docx) file's stories as articles (the raw file is the request body)."""
        self.store.require(req.args[0])
        try:
            got = docx.articles_from_docx(req.body)
        except docx.DocxError as e:
            raise DeskError(400, str(e)) from None
        return {**self.store.create_many(req.args[0], got["articles"], "word"), "notes": got["notes"]}

    def update_article(self, req: Request) -> dict:
        return self.store.update_article(req.args[0], path_id(ARTICLE_ID, req.args[1], "article"), req.json())

    def delete_article(self, req: Request) -> dict:
        self.store.delete_article(req.args[0], path_id(ARTICLE_ID, req.args[1], "article"))
        return {"ok": True}

    def put_photo(self, req: Request) -> dict:
        eid, aid = req.args[0], path_id(ARTICLE_ID, req.args[1], "article")
        self.store.require_article(eid, aid)            # before the slow conversion
        converted = images.convert_photo(req.body)
        return self.store.attach_photo(eid, aid, converted, req.q("caption"), req.q("credit"))

    def photo_text(self, req: Request) -> dict:
        return self.store.set_photo_text(req.args[0], path_id(ARTICLE_ID, req.args[1], "article"), req.json())

    def delete_photo(self, req: Request) -> dict:
        self.store.remove_photo(req.args[0], path_id(ARTICLE_ID, req.args[1], "article"))
        return {"ok": True}

    def import_sample(self, req: Request) -> dict:
        eid = req.args[0]
        self.store.require(eid)
        names = req.json().get("samples")
        if not isinstance(names, list) or not names or not all(isinstance(n, str) and n.strip() for n in names):
            raise DeskError(400, "Choose at least one sample edition.")
        names = list(dict.fromkeys(n.strip() for n in names))
        if len(names) > 50:
            raise DeskError(400, "Choose at most 50 sample editions at a time.")
        known = {s.get("name") for s in self.engine.samples()["samples"] if isinstance(s, dict)}
        unknown = [n for n in names if n not in known or n.startswith("-")]
        if unknown:
            raise DeskError(400, f"There is no sample edition called {unknown[0]}.")
        with self.store.lock(eid):                      # the engine writes articles.json: no edits meanwhile
            self.store.require(eid)
            result = self.engine.import_sample(eid, names)
            self.store.articles_changed(eid)
            return result

    # ads

    def put_ad(self, req: Request) -> dict:
        eid, slot = req.args[0], path_id(SLOT_ID, req.args[1], "ad space")
        edition = self.store.get_edition(eid)
        plan = self.engine.plan(parse_pages(edition.get("pages")), bool(edition.get("back_page_ads", True)))
        size = next((s for p in plan["pages"] if isinstance(p, dict) for s in p.get("ad_slots") or []
                     if isinstance(s, dict) and s.get("slot") == slot), None)
        if size is None:
            raise DeskError(404, f"The pages of this edition have no ad space called {slot}.")
        if self.jobs.is_active(eid):
            raise DeskError(409, AD_BUSY)
        converted = images.convert_ad(req.body, size.get("w_mm"), size.get("h_mm"))
        return self.store.put_ad(eid, slot, converted)

    def delete_ad(self, req: Request) -> dict:
        self.store.remove_ad(req.args[0], path_id(SLOT_ID, req.args[1], "ad space"))
        return {"ok": True}

    # runs

    def create_run(self, req: Request) -> dict:
        return {"run": self.jobs.create_run(req.args[0])}

    def run_status(self, req: Request) -> dict:
        return self.store.run_status(req.args[0], req.args[1])

    def cancel_run(self, req: Request) -> dict:
        eid, rid = req.args
        self.store.run_dir(eid, rid)                    # checks both ids and that the edition exists
        self.jobs.cancel(eid, rid)
        return {"ok": True}

    # editing a laid-out page

    def _edit_page(self, req: Request) -> tuple[str, str, int]:
        eid, rid, page = req.args[0], req.args[1], int(req.args[2])
        status = self.store.run_status(eid, rid)              # checks the ids and that the run exists
        if self.jobs.is_active(eid) or status.get("state") != "done":
            raise DeskError(409, "Pages can be changed once their layout has finished.")
        if not any(isinstance(p, dict) and p.get("page") == page and p.get("state") == "done" for p in status.get("pages") or []):
            raise DeskError(404, "There is no such page in this layout.")
        run_dir = self.store.run_dir(eid, rid)
        if not all((run_dir / f).is_file() for f in ("plan.json", "printed.json", "request.json")):
            raise DeskError(409, "This layout was made by an older version of the Desk, which did not keep what its pages "
                                 "print, or some of its files are missing. Lay the edition out again to edit its pages.")
        return eid, rid, page

    @contextlib.contextmanager
    def _page_work(self, req: Request):
        """A request on a page of an edition: the edition is not deleted until it ends (the edit service writes into the
        run). Counted under the edition's lock once the edition is there, so a delete either comes first (404 here) or
        is refused (409)."""
        eid = req.args[0]
        with self.store.lock(eid):
            self.store.require(eid)
            work = editing.saving(eid)
            work.__enter__()
        try:
            yield
        finally:
            work.__exit__(None, None, None)

    def edit_open(self, req: Request) -> dict:
        with self._page_work(req):
            eid, rid, page = self._edit_page(req)
            return self._changed(eid, rid, page,
                                 self.desk.editing.open(eid, rid, page, reload=bool(req.json().get("reload"))))

    def _changed(self, eid: str, rid: str, page: int, res: dict) -> dict:
        """The engine's answer for a page: marked changed when its revision is not the one its PDF was made from."""
        with self.store.lock(eid):
            editing.note_rev(self.store.run_dir(eid, rid), page, res.get("rev"))
        return res

    @staticmethod
    def _rev(body: dict):
        """The page revision the editor's change was made on (None: not given)."""
        rev = body.get("rev")
        if rev is not None and (not isinstance(rev, int) or isinstance(rev, bool) or rev < 0):
            raise DeskError(400, "rev must be a whole number.")
        return rev

    def edit_set(self, req: Request) -> dict:
        with self._page_work(req):
            return self._set(req)

    def _set(self, req: Request) -> dict:
        eid, rid, page = self._edit_page(req)
        body = req.json()
        modules = body.get("modules")
        if not isinstance(modules, list) or len(modules) > 40 or not all(isinstance(m, dict) for m in modules):
            raise DeskError(400, "The page's stories are missing or not valid.")
        return self._changed(eid, rid, page, self.desk.editing.set_modules(f"{eid}/{rid}/{page}", modules, self._rev(body)))

    def edit_alternative(self, req: Request) -> dict:
        with self._page_work(req):
            return self._alternative(req)

    def _alternative(self, req: Request) -> dict:
        eid, rid, page = self._edit_page(req)
        body = req.json()
        variant = body.get("variant", 1)
        if variant not in (1, 2, 3):
            raise DeskError(400, "variant must be 1, 2 or 3.")
        return self._changed(eid, rid, page, self.desk.editing.alternative(f"{eid}/{rid}/{page}", variant, self._rev(body)))

    def edit_refresh(self, req: Request) -> dict:
        with self._page_work(req):
            eid, rid, page = self._edit_page(req)
            return self._changed(eid, rid, page, self.desk.editing.refresh(f"{eid}/{rid}/{page}", self._rev(req.json())))

    def edit_save(self, req: Request) -> dict:
        """The page's PDF, its check and the run's press files. The edition's lock is held only while status.json is
        read and written, so article saves go on during the slow parts; saves in one run go one at a time."""
        with self._page_work(req):
            return self._save(req)

    def _save(self, req: Request) -> dict:
        eid, rid, page = self._edit_page(req)
        session, base_rev = f"{eid}/{rid}/{page}", self._rev(req.json())
        run_dir = self.store.run_dir(eid, rid)
        with editing.save_lock(run_dir):
            state = self.desk.editing.state(session)               # the pages this save takes stories from
            if base_rev is not None and state.get("rev") != base_rev:
                raise DeskError(409, "The page could not be saved: it was changed in another window or tab; it is "
                                     "shown again as it is now.")
            held = editing.locked_elsewhere(state)               # before any page is marked: a refusal marks none
            if held:
                raise DeskError(400, held)
            others = sorted({n for n in (state.get("also_on_pages") or {}).values() if isinstance(n, int)})
            with self.store.lock(eid):
                editing.before_save(run_dir, page, others)
            res = self.desk.editing.export(session, base_rev)
            with self.store.lock(eid):
                pdfs = editing.saved_page(run_dir, page, res)
            verdict, error = editing.save_files(run_dir, page, self.desk.repo_root, pdfs)
            with self.store.lock(eid):
                done = editing.after_save(run_dir, page, res, verdict, error)
        return {**res, **done}

    def glyphs(self, req: Request) -> Reply:
        try:
            gids = [int(x) for x in (req.q("ids") or "").split(",") if x != ""]
        except ValueError:
            raise DeskError(400, "Glyph ids must be numbers.") from None
        body = json.dumps(self.desk.editing.glyphs(req.args[0], gids), separators=(",", ":")).encode("utf-8")
        return Reply(body=body, cache="private, max-age=31536000, immutable")     # a font instance never changes

    def raster_file(self, req: Request) -> Reply:
        return Reply(path=self.desk.editing.raster(req.args[0]), content_type="image/jpeg",
                     cache="private, max-age=31536000, immutable")

    # files

    def photo_file(self, req: Request) -> Reply:
        m = PHOTO_JPG.fullmatch(req.args[1])
        if not m:
            raise DeskError(404, "There is no such picture.")
        return Reply(path=self.store.preview_path(req.args[0], "photos", m.group(1)), content_type="image/jpeg",
                     cache="no-cache")

    def ad_file(self, req: Request) -> Reply:
        m = AD_JPG.fullmatch(req.args[1])
        if not m:
            raise DeskError(404, "There is no such picture.")
        return Reply(path=self.store.preview_path(req.args[0], "ads", m.group(1)), content_type="image/jpeg",
                     cache="no-cache")

    def run_file(self, req: Request) -> Reply:
        eid, rid, name = req.args
        if not RUN_FILE.fullmatch(name):
            raise DeskError(404, "There is no such file.")
        path = self.store.run_dir(eid, rid) / name
        disposition = "attachment" if req.q("download") == "1" else "inline"
        return Reply(path=path, content_type=FILE_TYPES[Path(name).suffix], cache="no-cache",
                     headers=[("Content-Disposition", f'{disposition}; filename="{eid}-{name}"')])


# ------------------------------------------------------------------------------------------ HTTP plumbing


class DeskServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, desk: "Desk", port: int):
        self.desk = desk
        super().__init__(("127.0.0.1", port), Handler)
        port = self.server_address[1]
        self.allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        self.allowed_origins = {f"http://{host}" for host in self.allowed_hosts}

    def server_bind(self) -> None:
        TCPServer.server_bind(self)                     # no reverse-DNS lookup of the address (HTTPServer does one)
        self.server_name, self.server_port = "127.0.0.1", self.server_address[1]


class Handler(BaseHTTPRequestHandler):
    server: DeskServer
    server_version = f"PageinatorDesk/{__version__}"
    sys_version = ""
    protocol_version = "HTTP/1.0"                       # one request per connection
    timeout = 120

    def do_GET(self) -> None:
        self._handle()

    do_POST = do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_GET

    # ------------------------------------------------------------------------------------------ flow

    def _handle(self) -> None:
        start = time.monotonic()
        self._code, self._replied = 0, False
        self._unread = self._content_length()
        url = urlsplit(self.path)
        method, path = self.command, url.path
        try:
            self._check(method)
            route, args = self._route(method, path)
            _, _, name, body_kind = route
            body = self._read_body(body_kind)
            query = parse_qs(url.query, keep_blank_values=True)
            result = getattr(self.server.desk.api, name)(Request(method, path, query, body, args))
            self._send(result if isinstance(result, Reply) else self._json_reply(result))
        except DeskError as e:
            self._fail(e.status, e.message)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:
            traceback.print_exc(file=sys.stderr)
            self._fail(500, "Something went wrong inside the Desk server. The details are in the server's window.")
        finally:
            self._log(method, path, start)

    def _check(self, method: str) -> None:
        host = (self.headers.get("Host") or "").strip().lower()
        if host not in self.server.allowed_hosts:
            raise DeskError(403, f"Open the Desk at http://127.0.0.1:{self.server.server_address[1]}/ "
                                 "(this address is not allowed).")
        if method not in ("GET", "POST", "PUT", "DELETE"):
            raise DeskError(405, "The Desk server accepts only GET, POST, PUT and DELETE requests.")
        if method != "GET":
            if (self.headers.get("X-Desk") or "").strip() != "1":
                raise DeskError(403, "This request was refused: it did not come from the Desk's own page.")
            origin = self.headers.get("Origin")
            if origin is not None and origin.strip().lower() not in self.server.allowed_origins:
                raise DeskError(403, "Requests from other web sites are refused.")

    @staticmethod
    def _route(method: str, path: str) -> tuple[tuple, tuple[str, ...]]:
        if len(path) > 1 and path.endswith("/"):
            path = path[:-1]
        known_path = False
        for route in ROUTES:
            m = route[1].fullmatch(path)
            if not m:
                continue
            if route[0] != method:
                known_path = True
                continue
            try:
                args = tuple(unquote(g, errors="strict") for g in m.groups())
            except UnicodeDecodeError:
                raise DeskError(404, "There is no such page.") from None
            return route, args
        if known_path:
            raise DeskError(405, "That action is not possible here.")
        raise DeskError(404, "There is no such page.")

    # ---------------------------------------------------------------------------------------- bodies

    def _content_length(self) -> int | None:
        value = self.headers.get("Content-Length")
        if value is None:
            return 0
        try:
            n = int(value)
        except ValueError:
            return None
        return n if n >= 0 else None

    def _read_body(self, kind: str | None) -> bytes:
        if kind is None:
            self._drain()
            return b""
        if self.headers.get("Transfer-Encoding"):
            raise DeskError(400, "Send the request with a Content-Length.")
        n = self._unread
        if n is None:
            raise DeskError(400, "The request's Content-Length is not a number.")
        if kind == "image" and n > images.MAX_UPLOAD_BYTES:
            raise DeskError(413, "This picture file is larger than 40 MB. Save it smaller and try again.")
        if kind == "docx" and n > docx.MAX_BYTES:
            raise DeskError(413, "This Word file is larger than 20 MB.")
        if kind == "json" and n > JSON_LIMIT:
            raise DeskError(413, "The request is too large (the most is 2 MB of text).")
        data = self.rfile.read(n) if n else b""
        self._unread = 0
        if len(data) != n:
            raise DeskError(400, "The request was cut off before it was complete.")
        return data

    def _drain(self) -> None:
        """Read and drop an unread request body, so that the client gets the answer instead of a reset connection."""
        n, self._unread = self._unread, 0
        if not n or n > DRAIN_LIMIT:
            return
        try:
            while n > 0:
                chunk = self.rfile.read(min(n, 1 << 20))
                if not chunk:
                    break
                n -= len(chunk)
        except OSError:
            pass

    # ------------------------------------------------------------------------------------- responses

    @staticmethod
    def _json_reply(obj: Any) -> Reply:
        return Reply((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))

    def _start(self, code: int, headers: list[tuple[str, str]]) -> None:
        self.send_response(code)
        for key, value in headers:
            self.send_header(key, value)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        self._replied = True

    def _send(self, reply: Reply) -> None:
        headers = [("Cache-Control", reply.cache), *reply.headers]
        if reply.content_type.startswith("text/html"):
            headers.append(("Content-Security-Policy", CSP))
        if reply.path is None:
            self._start(200, [("Content-Type", reply.content_type), ("Content-Length", str(len(reply.body))),
                              *headers])
            self.wfile.write(reply.body)
            return
        try:
            f = open(reply.path, "rb")
        except (FileNotFoundError, NotADirectoryError):
            raise DeskError(404, "This file does not exist (yet).") from None
        with f:
            st = os.fstat(f.fileno())
            etag = f'"{st.st_mtime_ns:x}-{st.st_size:x}"'
            match = [t.strip() for t in (self.headers.get("If-None-Match") or "").split(",")]
            if reply.cache != "no-store" and etag in match:
                self._start(304, [("ETag", etag), ("Cache-Control", reply.cache)])
                return
            self._start(200, [("Content-Type", reply.content_type), ("Content-Length", str(st.st_size)),
                              ("ETag", etag), *headers])
            shutil.copyfileobj(f, self.wfile, 1 << 20)

    def _fail(self, code: int, message: str) -> None:
        self._drain()
        if self._replied:                               # the answer had already started: just end the connection
            self.close_connection = True
            return
        try:
            body = (json.dumps({"error": message}, ensure_ascii=False) + "\n").encode("utf-8")
            self._start(code, [("Content-Type", "application/json; charset=utf-8"),
                               ("Content-Length", str(len(body))), ("Cache-Control", "no-store")])
            self.wfile.write(body)
        except OSError:
            self.close_connection = True

    # --------------------------------------------------------------------------------------- logging

    def log_request(self, code: Any = "-", size: Any = "-") -> None:
        try:
            self._code = int(code)
        except (TypeError, ValueError):
            pass

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("[desk] " + (format % args) + "\n")

    def _log(self, method: str, path: str, start: float) -> None:
        code = self._code
        if method == "GET" and code in (200, 304) and QUIET.fullmatch(path):
            return
        ms = (time.monotonic() - start) * 1000
        sys.stderr.write(f"[desk] {time.strftime('%H:%M:%S')} {method} {path[:200]} {code} {ms:.0f} ms\n")
