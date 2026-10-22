"""Editing a laid-out page by hand (the engine's edit-service, tools/desk/engine/deskedit.py).

One long-lived engine process serves every open page: the server sends one JSON request per line and reads one JSON
answer per line (matched by id). Requests go one at a time. A crashed or stuck service is started again on the next
request, and an open page is opened again from its saved edits.

Pages and the press files:
- every change marks the page "changed, not saved"; the press files are not offered while any page is;
- saving an edited page first marks it, and every page it takes a story from, "needs saving" (so a save that stops
  part-way never leaves a story on two pages unnoticed); then writes its PDF/X-1a file over the run's page file (the
  automatic layout is kept as page-NN.auto.pdf), takes the stories brought from other pages off those pages, makes the
  page's previews again, merges edition.pdf and press-files.zip again, runs the independent PDF/X-1a check on the
  page and records all of it in the run's status.json. If any step fails, the page stays marked "needs saving";
- a page is not saved while one of its stories is also on another page and locked there (the save would take it off
  that page): the save is refused before any page is marked, and the engine refuses it too, before it writes anything;
- a story moved to another page leaves its page at once and prints on the other page only once that page is saved:
  the other page is marked "needs saving" before the engine is asked (an engine or server that stops part-way leaves
  it marked; a move the engine refuses takes the mark back), and both pages are marked from the engine's one answer;
- the press files count as current only when no article is printed on two pages and every page prints what the
  edition holds now (press.py);
- every change carries the page's revision: a change made on an older view of the page (another window or tab
  changed it since) is refused with 409, and the editor shows the page again as it is.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont
from PIL import Image

from . import jobs
from .engine_client import EngineClient
from . import messages as M
from .press import OUTSIDE_WORDS, OVERLAP_WORDS, PLACEMENT
from .press import deskprinted  # the engine's own record of what a page prints (press puts the engine on the path)
from .util import DeskError, atomic_file, read_json, write_json

FACE = re.compile(r"[0-9a-f]{24}")
STALE_MARK = "changed in another window or tab"            # the engine's refusal of a change made on an older view
OPEN_TIMEOUT_S = 900            # the first open of a page may measure its stories
CALL_TIMEOUT_S = 120
ALT_TIMEOUT_S = 180             # another layout: the search over at most 11 stories
START_TIMEOUT_S = 120
PREVIEW_LONG_PX = 1600


class EditService:
    def __init__(self, engine: EngineClient, home: Path):
        self.engine, self.home = engine, home
        self.lock = threading.Lock()
        self.proc: subprocess.Popen | None = None
        self.next_id = 1
        self._faces: dict[str, tuple] = {}
        self._glyphs: dict[tuple[str, int], str] = {}
        self._glyph_lock = threading.Lock()
        self._raster_lock = threading.Lock()

    # ---- the engine process
    def _start(self) -> None:
        self._discard()                                     # a stopped engine: its pipes are closed first
        fd = os.open(self.home / "edit-service.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "ab") as log:
            self.proc = subprocess.Popen(self.engine.argv("edit-service"), cwd=self.engine.repo_root, env=self.engine.env(),
                                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, start_new_session=True)
        timer = threading.Timer(START_TIMEOUT_S, self._kill)
        timer.start()
        try:
            line = self.proc.stdout.readline()
        finally:
            timer.cancel()
        try:
            ready = json.loads(line) if line else {}
        except ValueError:
            ready = {}
        if not (ready.get("ok") and (ready.get("result") or {}).get("ready")):
            self._discard()
            why = ready.get("error") if isinstance(ready, dict) else None
            raise DeskError(500, M.msg("m.save.engineNotStarted", why=M.data(why)) if why else M.msg("m.save.engineNotStartedLog"))

    def _call(self, req: dict, timeout: float) -> dict:
        with self.lock:
            if self.proc is None or self.proc.poll() is not None:
                self._start()
            rid = self.next_id
            self.next_id += 1
            data = (json.dumps({**req, "id": rid}, ensure_ascii=False) + "\n").encode("utf-8")
            try:
                self.proc.stdin.write(data)
                self.proc.stdin.flush()
            except OSError:
                self._discard()
                raise DeskError(500, M.msg("m.save.engineStopped")) from None
            timer = threading.Timer(timeout, self._kill)
            timer.start()
            try:
                while True:
                    line = self.proc.stdout.readline()
                    if not line:
                        self._discard()
                        raise DeskError(500, M.msg("m.save.engineSlow"))
                    ans = json.loads(line)
                    if ans.get("id") == rid:
                        break
            finally:
                timer.cancel()
        if not ans.get("ok"):
            err = M.from_wire(str(ans.get("error") or ""), ans.get("msgs"))   # the engine's refusal, with its code
            raise DeskError(409 if STALE_MARK in err else 400, M.msg("m.save.notChanged", reason=err if isinstance(err, M.Msg) else M.data(err)))
        return ans["result"]

    def _kill(self) -> None:
        proc = self.proc
        if proc is not None and proc.poll() is None:
            proc.kill()

    def _discard(self) -> None:
        """Forget the engine process (with the lock held): stopped if it still runs, its pipes closed, reaped."""
        proc, self.proc = self.proc, None
        if proc is None:
            return
        if proc.poll() is None:
            proc.kill()
        for pipe in (proc.stdin, proc.stdout):
            try:
                if pipe is not None:
                    pipe.close()
            except OSError:
                pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

    def close(self) -> None:
        self._kill()                                        # never wait on a long request when the server stops
        if self.lock.acquire(timeout=5):
            try:
                self._discard()
            finally:
                self.lock.release()

    def _session_call(self, session: str, req: dict, timeout: float) -> dict:
        """A request on an open page; the page is opened again first if the engine service was restarted."""
        try:
            return self._call({**req, "session": session}, timeout)
        except DeskError as e:
            if "not open" not in e.message:
                raise
        eid, rid, page = session.split("/")
        self.open(eid, rid, int(page))
        return self._call({**req, "session": session}, timeout)

    # ---- page sessions
    def open(self, eid: str, rid: str, page: int, reload: bool = False) -> dict:
        return self._call({"cmd": "open", "edition": eid, "run": rid, "page": page, "reload": reload}, OPEN_TIMEOUT_S)

    def set_modules(self, session: str, modules: list, base_rev=None) -> dict:
        return self._session_call(session, {"cmd": "set", "modules": modules, "base_rev": base_rev}, CALL_TIMEOUT_S)

    def state(self, session: str) -> dict:
        return self._session_call(session, {"cmd": "state"}, CALL_TIMEOUT_S)

    def export(self, session: str, base_rev=None) -> dict:
        return self._session_call(session, {"cmd": "export", "base_rev": base_rev}, CALL_TIMEOUT_S)

    def alternative(self, session: str, variant: int, base_rev=None) -> dict:
        return self._session_call(session, {"cmd": "alternative", "variant": variant, "base_rev": base_rev}, ALT_TIMEOUT_S)

    def refresh(self, session: str, base_rev=None) -> dict:
        return self._session_call(session, {"cmd": "refresh", "base_rev": base_rev}, OPEN_TIMEOUT_S)

    def move(self, session: str, story: str, to: int, base_rev=None) -> dict:
        """A story of the page moved to page to (the engine opens that page if need be: the open timeout)."""
        return self._session_call(session, {"cmd": "move", "story": story, "page": to, "base_rev": base_rev},
                                  OPEN_TIMEOUT_S)

    # ---- what the browser draws with
    def glyphs(self, face: str, gids: list[int]) -> dict:
        """Outlines of the glyphs (SVG path data in font units, y up) of a font instance the engine cached."""
        if not FACE.fullmatch(face):
            raise DeskError(404, "There is no such font.")
        with self._glyph_lock:                             # a fontTools glyph set is not safe across threads
            if face not in self._faces:
                path = self.home / "cache" / "fonts" / f"{face}.ttf"
                if not path.is_file():
                    raise DeskError(404, "There is no such font.")
                tt = TTFont(io.BytesIO(path.read_bytes()), lazy=True)
                self._faces[face] = (tt.getGlyphSet(), tt.getGlyphOrder(), tt["head"].unitsPerEm)
            gs, order, upem = self._faces[face]
            out = {}
            for gid in gids[:4000]:
                if not 0 <= gid < len(order):
                    continue
                key = (face, gid)
                if key not in self._glyphs:
                    pen = SVGPathPen(gs)
                    gs[order[gid]].draw(pen)
                    self._glyphs[key] = pen.getCommands()
                out[str(gid)] = self._glyphs[key]
        return {"upem": upem, "glyphs": out}

    def raster(self, key: str) -> Path:
        """A picture of the page as a JPEG for the screen, made once from the engine's CMYK raster."""
        if not FACE.fullmatch(key):
            raise DeskError(404, "There is no such picture.")
        d = self.home / "cache" / "rasters"
        jpg = d / f"{key}.jpg"
        if jpg.is_file():
            return jpg
        with self._raster_lock:
            if jpg.is_file():
                return jpg
            meta = read_json(d / f"{key}.json", default=None)
            raw = d / f"{key}.cmyk"
            if not isinstance(meta, dict) or not raw.is_file():
                raise DeskError(404, "There is no such picture.")
            img = Image.frombytes("CMYK", (int(meta["width_px"]), int(meta["height_px"])), raw.read_bytes()).convert("RGB")
            img.thumbnail((PREVIEW_LONG_PX, PREVIEW_LONG_PX), Image.Resampling.LANCZOS)
            with atomic_file(jpg) as f:
                img.save(f, "JPEG", quality=82)
        return jpg


# ------------------------------------------------------------------------------------------- the run's status

def _pages(status: dict) -> list[dict]:
    return sorted((p for p in status.get("pages") or [] if isinstance(p, dict)), key=lambda p: p.get("page") or 0)


press_state = jobs.press_state
refresh_stale = jobs.refresh_stale


UNFINISHED = M.msg("m.save.unfinished")
NOT_PLACED_EDITED = M.msg("m.save.notPlacedEdited")
_save_locks: dict[str, threading.Lock] = {}
_saving: dict[str, int] = {}                         # edition id → saves in progress (it is not deleted meanwhile)
_save_guard = threading.Lock()


def save_lock(run_dir: Path) -> threading.Lock:
    """One save at a time in a run: every save makes the run's edition.pdf and press-files.zip again."""
    with _save_guard:
        return _save_locks.setdefault(str(run_dir), threading.Lock())


@contextlib.contextmanager
def saving(eid: str):
    """A page of the edition is being saved (is_saving says so until it ends)."""
    with _save_guard:
        _saving[eid] = _saving.get(eid, 0) + 1
    try:
        yield
    finally:
        with _save_guard:
            _saving[eid] -= 1
            if not _saving[eid]:
                del _saving[eid]


def is_saving(eid: str) -> bool:
    with _save_guard:
        return eid in _saving


def placement(problems) -> list | None:
    """The kinds of problem in an answer of the engine that a print file must never have (press.PLACEMENT): [] when
    there are none, None when the answer has no list of problems (nothing to note)."""
    if problems is None:
        return None
    if not isinstance(problems, list):
        return ["unreadable"]                            # fail closed: counts as a problem (press.placement_problems)
    return sorted({p.get("kind") for p in problems if isinstance(p, dict) and p.get("kind") in PLACEMENT}) + (
        ["unreadable"] if not all(isinstance(p, dict) for p in problems) else [])


def note_rev(run_dir: Path, page: int, rev, problems=None) -> None:
    """Every answer of the editor carries the page's revision (the caller holds the edition's lock). Another revision
    than the one the page's PDF was made from (0: the automatic layout) means the page changed since, by the editor or
    by the engine itself (text another page set, a story whose articles were deleted): the page is marked "changed, not
    saved". The newest revision seen is kept too ("rev_seen"), so a save of an older one leaves the mark. problems: the
    answer's problems; stories over each other or outside the news area are kept ("layout_problems_now"), so the press
    files are never current while the page shows them."""
    note_revs(run_dir, {page: rev}, {page: problems})


def note_revs(run_dir: Path, revs: dict, problems: dict | None = None) -> None:
    """note_rev for every {page: revision} of one answer of the engine (a move changes two pages), with status.json
    read and written once (the caller holds the edition's lock). problems: {page: the answer's problems} for the
    pages the answer shows."""
    status = read_json(run_dir / "status.json")
    pages = _pages(status)
    changed = False
    for page, kinds in ((page, placement(probs)) for page, probs in (problems or {}).items()):
        entry = next((p for p in pages if p.get("page") == page), None)
        if entry is not None and kinds is not None and entry.get("layout_problems_now") != kinds:
            entry["layout_problems_now"] = kinds
            changed = True
    for page, rev in revs.items():
        if not isinstance(rev, int) or isinstance(rev, bool):
            continue
        entry = next((p for p in pages if p.get("page") == page), None)
        if entry is None:
            continue
        if rev > int(entry.get("rev_seen") or 0):
            entry["rev_seen"] = rev
            changed = True
        if not entry.get("edited_unsaved") and rev != int(entry.get("pdf_rev") or 0):
            entry["edited_unsaved"] = changed = True
    if changed:
        status.update(press_state(status))
        M.write_status(run_dir / "status.json", status)


MOVED_HERE = "m.save.movedHere"                  # a message of messages.json: M.msg(MOVED_HERE, page=…)
MARK_KEYS = ("needs_save", "needs_save_reason")


def before_move(run_dir: Path, page: int, to: int) -> dict | None:
    """Before the engine moves a story from page to page to (the caller holds the edition's lock): page to is marked
    "needs saving" with why (the editor says it when that page is opened), so an engine that stops part-way, or a
    server that stops before the answer is marked, leaves it marked: the engine writes that page first, and the story
    prints there only once it is saved. → what unmark_move needs to take the mark back if the engine refuses the move
    (None: no such page in the status)."""
    status = read_json(run_dir / "status.json")
    pages = _pages(status)
    entry = next((p for p in pages if p.get("page") == to), None)
    if entry is None:
        return None
    before = {k: M.from_wire(entry[k], status.get("msgs")) for k in MARK_KEYS if k in entry}   # an earlier reason keeps its code
    mark = {"page": to, "reason": M.msg(MOVED_HERE, page=page), "before": before}
    entry.update(needs_save=True, needs_save_reason=mark["reason"])      # the entry itself: the list keeps its order
    status.update(press_state(status))
    M.write_status(run_dir / "status.json", status)
    return mark


def unmark_move(run_dir: Path, mark: dict | None) -> None:
    """The engine refused the move, so it changed neither page: before_move's mark is taken back (the caller holds the
    edition's lock), unless something else marked the page since (its reason is not the move's any more)."""
    if not mark:
        return
    status = read_json(run_dir / "status.json")
    entry = next((p for p in _pages(status) if p.get("page") == mark["page"]), None)
    if entry is None or entry.get("needs_save") is not True or entry.get("needs_save_reason") != mark["reason"]:
        return
    for k in MARK_KEYS:
        if k in mark["before"]:
            entry[k] = mark["before"][k]
        else:
            entry.pop(k, None)
    status.update(press_state(status))
    M.write_status(run_dir / "status.json", status)


def _warnings(problems: list) -> list[str]:
    """The page card's warnings after a save from the editor (the same words as a layout run's)."""
    out = []
    lines = sum(int(p.get("lines") or 0) for p in problems if p.get("kind") == "overset")
    if lines:
        out.append(M.msg("m.warn.overset", n=lines))
    if any(p.get("kind") == "unset" for p in problems):
        out.append(M.msg("m.warn.unset"))
    if any(p.get("kind") == "touch" for p in problems):
        out.append(M.msg("m.warn.touch"))
    if any(p.get("kind") == "overlap" for p in problems):
        out.append(OVERLAP_WORDS)
    if any(p.get("kind") == "outside" for p in problems):
        out.append(OUTSIDE_WORDS)
    for p in problems:
        if p.get("kind") == "empty":
            out.append(M.msg("m.warn.emptyArea", n=round((p.get("mm2") or 0) / 100)))
    return out


def locked_elsewhere(state: dict) -> str | None:
    """Why the page cannot be saved now, or None: a story on it is also on another page and locked there, and the save
    would take it off that page (the engine refuses that save too, before it writes anything). A list that is there but
    cannot be read refuses (fail closed)."""
    held = state.get("locked_on_pages")
    if held is None:
        return None
    if not isinstance(held, dict) or not all(isinstance(n, int) and not isinstance(n, bool) for n in held.values()):
        return M.msg("m.save.heldUnreadable")
    if not held:
        return None
    story, n = min(held.items(), key=lambda kv: (kv[1], str(kv[0])))
    head = next((x.get("headline") for x in state.get("notes") or [] if isinstance(x, dict) and x.get("story") == story), "")
    name = M.data(f"“{head}”") if isinstance(head, str) and head else M.msg("m.name.shortColumn")
    more = len(held) - 1
    said = M.msg("m.save.held", name=name, page=n)
    if not more:
        return said
    return M.join(said, M.msg("m.save.heldMore1") if more == 1 else M.msg("m.save.heldMoreN", n=more))


def before_save(run_dir: Path, page: int, others: list[int]) -> None:
    """Before an edited page is saved: it, and every page it takes a story from, are marked "needs saving", so a save
    that stops part-way (a failure, the engine stopped, the server stopped) leaves them marked."""
    status = read_json(run_dir / "status.json")
    pages = _pages(status)
    for p in pages:
        if p.get("page") == page:
            p.update(pdfx_check=None, needs_save=True, needs_save_reason=UNFINISHED)
        elif p.get("page") in others:
            p.update(needs_save=True, needs_save_reason=M.msg("m.save.taking", page=page))
    status["pages"] = pages
    status.update(press_state(status))
    M.write_status(run_dir / "status.json", status)


def saved_page(run_dir: Path, page: int, saved: dict) -> list[Path]:
    """Right after the engine wrote an edited page's PDF (the caller holds the edition's lock): the pages a story left
    take their new article lists and stay "needs saving", and so does this page until its files are finished. saved:
    the engine's export result. → the run's page PDFs, in page order, for edition.pdf and the press ZIP."""
    status = read_json(run_dir / "status.json")
    pages = _pages(status)
    for p in pages:
        if p.get("page") == page:
            p.update(pdfx_check=None, needs_save=True, needs_save_reason=UNFINISHED)
    for n, articles in (saved.get("pages_changed") or {}).items():
        for p in pages:
            if p.get("page") == int(n):
                p.update(articles=articles, needs_save=True,
                         needs_save_reason=M.msg("m.save.movedFrom", page=page))
    status["pages"] = pages
    status.update(press_state(status))
    M.write_status(run_dir / "status.json", status)
    return [run_dir / p["pdf"] for p in pages if p.get("state") == "done" and isinstance(p.get("pdf"), str)
            and jobs.PAGE_PDF.fullmatch(p["pdf"]) and (run_dir / p["pdf"]).is_file()]


def save_files(run_dir: Path, page: int, repo_root: Path, pdfs: list[Path]) -> tuple[dict, str | None]:
    """The saved page's previews and its independent PDF/X-1a check, then edition.pdf and press-files.zip made again.
    The slow part of a save: done without the edition's lock (article saves go on meanwhile), under save_lock. →
    (the check's verdict, the error to say or None)."""
    pdf = run_dir / f"page-{page:02d}.pdf"
    verdict = {"passed": False, "fails": None, "warnings": None}
    try:
        jobs.render_page(pdf, run_dir / f"page-{page:02d}.png", run_dir / f"page-{page:02d}.thumb.png")
        verdict = jobs.check_pdfx(repo_root, pdf)
        jobs.merge_pdfs(pdfs, run_dir / "edition.pdf")
        jobs.zip_pdfs(pdfs, run_dir / "press-files.zip")
    except Exception as e:  # noqa: BLE001 — said on the page; the files are made again by the next save
        return verdict, M.msg("m.save.filesNotFinished", error=M.data(str(e)))
    return verdict, None


def after_save(run_dir: Path, page: int, saved: dict, verdict: dict, error: str | None) -> dict:
    """The run's status once an edited page was saved and its files made (the caller holds the edition's lock): the
    page records what its PDF prints and the check's verdict, and is checked against the edition as it is now (text
    corrected meanwhile leaves it "needs saving"). If a step failed, the page stays "needs saving" and error says why."""
    status = read_json(run_dir / "status.json")
    pages = _pages(status)
    entry = next(p for p in pages if p.get("page") == page)
    rev = saved.get("rev", entry.get("pdf_rev", 0))
    entry.update(pdfx_check=verdict, edited=True, png=f"page-{page:02d}.png", thumb=f"page-{page:02d}.thumb.png",
                 edited_unsaved=int(entry.get("rev_seen") or 0) > rev,      # changed again meanwhile (another tab)
                 edited_at=time.strftime("%Y-%m-%dT%H:%M:%S%z"), articles=saved.get("articles") or [], pdf_rev=rev,
                 warnings=deskprinted.unset(saved.get("printed"), _edition(run_dir)) + _warnings(saved.get("problems") or []))
    entry["printed"] = saved["printed"] if isinstance(saved.get("printed"), dict) else None   # none: never "current"
    kinds = placement(saved.get("problems"))
    entry["layout_problems"] = entry["layout_problems_now"] = ["unreadable"] if kinds is None else kinds
    if error:
        entry.update(needs_save=True, needs_save_reason=error)
    else:
        entry.update(needs_save=False, needs_save_reason="")
    try:
        _recount_not_placed(run_dir, status, pages)
    except DeskError:  # the edition's articles cannot be read: the list stays as it was (the page is marked anyway)
        pass
    status["pages"] = pages
    refresh_stale(status, run_dir)                          # still printing older content? then it stays to save
    status.update(press_state(status))
    M.write_status(run_dir / "status.json", status)
    return {"page": page, "pdfx_check": verdict, "error": error, "stale": entry.get("stale") or [], **press_state(status)}


def _edition(run_dir: Path) -> dict:
    """The run's edition fields now ({} when edition.json cannot be read: the page is then marked as not checked)."""
    try:
        return read_json(run_dir.parent.parent / "edition.json", {})
    except DeskError:
        return {}


def _recount_not_placed(run_dir: Path, status: dict, pages: list[dict]) -> None:
    """Articles of the run on no page after the edits are listed as not placed (with what the layout said, or that the
    editor took them off); articles back on a page leave the list."""
    req = read_json(run_dir / "request.json", {})
    live = {a.get("id") for a in read_json(run_dir.parent.parent / "articles.json", {"articles": []}).get("articles", [])
            if isinstance(a, dict)}
    placed = {a for p in pages for a in p.get("articles") or []}
    before = {x.get("article"): x for x in status.get("not_placed") or [] if isinstance(x, dict)}
    out = []
    for a in req.get("articles") or []:
        aid = a.get("id")
        if aid and aid not in placed:
            out.append({"article": aid, "reason": M.msg("m.save.deletedAfter")} if aid not in live else
                       before.get(aid) or {"article": aid, "reason": NOT_PLACED_EDITED})
    status["not_placed"] = out
