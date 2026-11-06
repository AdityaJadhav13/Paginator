"""`engine.layout` and `engine.measure` (plan §2.2, L2.3): the engine's `generate` and `measure`, each in a process group
of its own, watched as the Desk's JobManager and Measurer watch them, with the run's steps after it (JobManager._complete's,
through the Desk's own `render_page`, `check_pdfx`, `merge_pdfs` and `zip_pdfs`, unchanged), its files uploaded and its
progress written as it goes.

- **Before**: the profile's dataset and config, and the frozen request (layout: `runs/<run>/request.json`; measure: the
  edition's snapshot `editions/<edition>/measure.json`), each pinned by version and SHA-256, made into the home
  (home.materialise); an engine left running by a launcher that died (its pid file, `engine.pid`, in each run folder
  and edition folder of the home) is stopped first (the Desk's `stop_orphan`).
- **While it runs** (polled each second): `run.progress` when its state or a page's changes, and at least every 30 s
  (a heartbeat, kept up through the steps after it too); `run.page` as each page is done, once its previews are made
  and its PDF and previews are stored
  (`runs/<run>/pages/NN/page.pdf`, `preview.png`, `thumb.png`). A measure writes `measure.status` (`measuring`) as its
  count moves.
- **Stops**: a cancel (SIGTERM to the runner: the `cancel` event) stops the engine's group (SIGTERM, then SIGKILL after
  5 s) and answers `cancelled` (a measure: `stopped`); a layout whose engine-status.json has not changed for
  `PGN_ENGINE_STALL_S` (600 s) is stopped and fails with the Desk's words for a stopped engine. When stdout is closed
  (the queue died) the engine is stopped and nothing more is written (StdoutClosed).
- **After**: as the Desk: no page → failed with the engine's words (or m.run.noPages); else edition.pdf and
  press-files.zip, the independent PDF/X-1a check of every page (4 at a time; its report stored beside the page,
  `pdfx-check.txt`), and `run.finished` done with the Desk's own message (one, coded: check problems, else pages
  that failed, else pages made). An engine that fails is a run that fails with its own words (JobManager._failure): a
  finished job (`done`), never a worker fault."""
from __future__ import annotations

import hashlib
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Callable

from . import engine, home
from .desk import REPO, desk_text, messages as M, runs, util
from .keys import KeyGuard, uuid
from .media import Mismatch
from .storage import Storage

POLL_S = 1.0
HEARTBEAT_S = 30.0
KILL_AFTER_S = 5.0
CHECKS = 4                                  # page checks at once (the Desk's)
CHECKER_SHA256 = hashlib.sha256((REPO / runs.PDFX_CHECKER).read_bytes()).hexdigest()
ROLES = ("front", "inside", "back")
PAGE_STATES = ("waiting", "working", "done", "failed", "cancelled")
TYPES = {"pdf": "application/pdf", "png": "image/png", "txt": "text/plain; charset=utf-8", "zip": "application/zip"}

Progress = Callable[[dict], None]


class StdoutClosed(BaseException):
    """The queue went away (stdout closed): stop the engine, write nothing more (not an Exception: no handler takes it
    for a job's failure)."""


# ------------------------------------------------------------------------------------------- the engine's process


class Process:
    """The engine in a session (so a process group) of its own, its output in a log, its group's id in a pid file."""

    def __init__(self, argv: list[str], env: dict[str, str], log: Path, pid_file: Path):
        fd = os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, util.FILE_MODE)
        with os.fdopen(fd, "ab") as out:
            self.proc = subprocess.Popen(argv, cwd=REPO, env=env, stdin=subprocess.DEVNULL, stdout=out,
                                         stderr=subprocess.STDOUT, start_new_session=True)
        self.pid_file = pid_file
        util.write_bytes(pid_file, f"{self.proc.pid}\n".encode())

    def poll(self) -> int | None:
        rc = self.proc.poll()
        if rc is not None:
            self.pid_file.unlink(missing_ok=True)
        return rc

    def _signal(self, sig: int) -> None:
        try:
            os.killpg(self.proc.pid, sig)
        except ProcessLookupError:
            pass

    def stop(self) -> None:
        """The whole group: SIGTERM, then SIGKILL after KILL_AFTER_S (its workers too)."""
        if self.proc.poll() is None:
            self._signal(signal.SIGTERM)
            try:
                self.proc.wait(timeout=KILL_AFTER_S)
            except subprocess.TimeoutExpired:
                pass
        self._signal(signal.SIGKILL)                 # a worker the leader left behind, too
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            return                                   # the pid file stays: the next job's stop_orphan stops it
        self.pid_file.unlink(missing_ok=True)


def _engine_group(pgid: int) -> bool:
    """The Desk's check that process group pgid still runs the engine (its own process or its spawned workers), read
    from /proc: the worker's image (Debian slim) has no `ps`, which the Desk's own check runs."""
    for d in Path("/proc").iterdir():
        try:
            fields = (d / "stat").read_text().rsplit(")", 1)[1].split()       # after "pid (name)": state ppid pgrp
            command = (d / "cmdline").read_bytes().replace(b"\0", b" ").decode("utf-8", "replace")
        except (OSError, IndexError):
            continue
        if fields[2:3] == [str(pgid)] and ("desk_engine.py" in command or "multiprocessing.spawn" in command):
            return True
    return False


def stop_orphans(home_dir: Path) -> None:
    """Engines left running by a launcher that died (crash, SIGKILL): their whole groups, by their pid files (the
    Desk's stop_orphan where `ps` is; its steps, with /proc, where it is not)."""
    for pid_file in [*home_dir.glob("editions/*/engine.pid"), *home_dir.glob("editions/*/runs/*/engine.pid")]:
        if shutil.which("ps") or not Path("/proc/self/stat").exists():
            runs.stop_orphan(pid_file)
        else:
            try:
                pgid = int(pid_file.read_text().strip())
            except (OSError, ValueError):
                pgid = 0
            if pgid > 1 and _engine_group(pgid):
                for sig in (signal.SIGTERM, signal.SIGKILL):
                    try:
                        os.killpg(pgid, sig)
                    except OSError:
                        break
                    time.sleep(1.0)
        pid_file.unlink(missing_ok=True)


def _read(path: Path) -> tuple[bytes | None, dict | None]:
    try:
        raw = path.read_bytes()
    except OSError:
        return None, None
    try:
        doc = util.read_json(path)
    except util.DeskError:
        return raw, None
    return raw, doc if isinstance(doc, dict) else None


def _stored(storage: Storage, key: str, path: Path) -> dict:
    data = path.read_bytes()          # shortcut: whole files in memory (an edition PDF is tens of MB); stream past 1 GB
    version = storage.put(key, data, TYPES[path.suffix.lstrip(".")])
    return {"key": key, "version_id": version, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data)}


def _pinned(storage: Storage, key: str, version_id: str, sha256: str, what: str) -> bytes:
    data = storage.get(key, version_id)
    if hashlib.sha256(data).hexdigest() != sha256:
        raise Mismatch(f"the stored {what} is not the one this job names")
    return data


# ------------------------------------------------------------------------------------------- engine.layout


class Layout:
    def __init__(self, storage: Storage, args: dict, settings: engine.Settings, progress: Progress,
                 cancel: threading.Event):
        self.storage, self.args, self.settings, self.cancel = storage, args, settings, cancel
        lock = threading.Lock()                       # the heartbeat thread writes too (one line at a time)

        def locked(event: dict) -> None:
            with lock:
                progress(event)
        self.progress = locked
        self.last_said: tuple[str, object] = ("planning", None)
        self.guard = KeyGuard(args["org_id"], args["pub_id"])
        self.run_id = uuid(args["run_id"], "run_id")
        self.base = {"org_id": self.guard.org_id, "pub_id": self.guard.pub_id, "run_id": self.run_id,
                     "sha256": args["sha256"]}
        self.started = time.monotonic()
        self.status: dict = {}                        # the last engine-status.json that could be read
        self.files: dict[int, dict] = {}              # page → its stored files (run.page's)
        self.tries: dict[int, int] = {}
        self.checks: dict[int, dict] = {}

    # -------------------------------------------------------------------------------- what is said

    def _pages(self) -> list[dict]:
        """The engine's pages that are the contract's (a page 1–16 with a role and a state it knows), in order."""
        out = [p for p in self.status.get("pages") or [] if isinstance(p, dict)
               and isinstance(p.get("page"), int) and not isinstance(p["page"], bool) and 1 <= p["page"] <= 16
               and p.get("role") in ROLES and p.get("state") in PAGE_STATES]
        return sorted(out, key=lambda p: p["page"])

    def _text(self, text: object) -> dict | None:
        """The Desk's words (a Msg, or the engine's text with its status's "msgs" map); None for no words."""
        return desk_text(text, self.status.get("msgs")) if isinstance(text, str) and text.strip() else None

    def _elapsed(self) -> float:
        return round(time.monotonic() - self.started, 1)

    def _say(self, state: str, message: object = None) -> None:
        message = message if message is not None else self.status.get("message")
        self.last_said = (state, message)
        self.progress({"kind": "run.progress", **self.base, "state": state, "message": self._text(message),
                       "pages": [{k: p[k] for k in ("page", "role", "state")} for p in self._pages()],
                       "elapsed_s": self._elapsed()})

    def _page_facts(self, p: dict) -> dict:
        seconds = p.get("seconds")
        return {"page": p["page"], "role": p["role"],
                "articles": [a for a in p.get("articles") or [] if isinstance(a, str)
                             and util.ARTICLE_ID.fullmatch(a)][:200],
                **self.files[p["page"]],
                "seconds": float(seconds) if isinstance(seconds, (int, float)) and not isinstance(seconds, bool)
                and 0 <= seconds <= 1_000_000 else None,
                "warnings": [t for w in (p.get("warnings") or [])[:50] if (t := self._text(w))]}

    # ------------------------------------------------------------------------------------ pages

    def _store_pages(self) -> None:
        """Each page the engine has done: its previews made (the Desk's render_page; tried 3 times, then stored
        without), its PDF and previews stored, then run.page."""
        for p in self._pages():
            name, n = p.get("pdf"), p["page"]
            if p["state"] != "done" or n in self.files or not isinstance(name, str) or not runs.PAGE_PDF.fullmatch(name):
                continue
            pdf = self.run_dir / name
            png, thumb = pdf.with_suffix(".png"), pdf.with_name(f"{pdf.stem}.thumb.png")
            if not pdf.is_file():
                continue
            if not png.is_file() and self.tries.get(n, 0) < runs.RENDER_TRIES:
                try:
                    runs.render_page(pdf, png, thumb)
                except Exception:  # noqa: BLE001 — a page that cannot be drawn still prints: stored without previews
                    self.tries[n] = self.tries.get(n, 0) + 1
                    continue
            key = lambda f: self.guard.run_file(self.run_id, f, n)  # noqa: E731
            self.files[n] = {"pdf": _stored(self.storage, key("page.pdf"), pdf),
                             "png": _stored(self.storage, key("preview.png"), png) if png.is_file() else None,
                             "thumb": _stored(self.storage, key("thumb.png"), thumb) if thumb.is_file() else None}
            self.progress({"kind": "run.page", **self.base, **self._page_facts(p)})

    def _poll(self) -> bytes | None:
        raw, doc = _read(self.run_dir / "engine-status.json")
        if doc is not None:
            self.status = doc
        return raw

    # ------------------------------------------------------------------------------------ the run

    def run(self) -> dict:
        args = self.args
        home_dir, cfg = engine.profile_config(self.storage, self.guard, self.settings, args)
        request = _pinned(self.storage, self.guard.run_request(self.run_id), args["version_id"], args["sha256"],
                          "request")
        stop_orphans(home_dir)
        self.run_dir = home.materialise(self.storage, self.settings.homes, self.guard.org_id, self.guard.pub_id,
                                        args["edition_key"], args["run_key"], request, args["sha256"], cfg)
        if self.cancel.is_set():
            return self.finished("cancelled", message=M.msg("m.run.cancelledBefore"))
        client = engine.engine(self.settings, home_dir)
        try:
            proc = Process(client.generate_argv(args["edition_key"], args["run_key"]), client.env(),
                           self.run_dir / "engine.log", self.run_dir / "engine.pid")
        except OSError as e:
            return self.finished("failed", error=M.msg("m.run.engineNotStarted", error=M.data(str(e.strerror or e))))
        try:
            return self._watch(proc)
        finally:
            if proc.proc.poll() is None:
                proc.stop()

    def _watch(self, proc: Process) -> dict:
        self._say("planning", M.msg("m.run.engineStarted"))
        said, beat = None, time.monotonic()
        last_raw, changed = None, time.monotonic()
        while True:
            rc = proc.poll()
            raw = self._poll()
            now = time.monotonic()
            if raw != last_raw:
                last_raw, changed = raw, now
            if self.cancel.is_set():
                proc.stop()
                return self.finished("cancelled", message=M.msg("m.run.cancelled"))
            self._store_pages()
            if rc is not None:
                break
            if now - changed >= self.settings.stall_s:
                proc.stop()
                return self.finished("failed", error=M.data(f"The layout engine was stopped: it did nothing for "
                                                            f"{self.settings.stall_s:.0f} seconds."))
            state = runs.ENGINE_STATE.get(str(self.status.get("state")), "layout" if self.status else "planning")
            now_said = (state, str(self.status.get("message")), [(p["page"], p["state"]) for p in self._pages()])
            if now_said != said or now - beat >= HEARTBEAT_S:
                self._say(state)
                said, beat = now_said, now
            self.cancel.wait(POLL_S)
        if rc != 0:
            job = runs.Job(self.args["edition_key"], self.args["run_key"], self.run_dir)
            job.engine = self.status
            return self.finished("failed", error=runs.JobManager._failure(None, job, rc))   # the engine's own words
        return self._complete()

    def _complete(self) -> dict:
        """JobManager._complete's steps, with the heartbeat kept up while they run (previews, merge, checks, uploads
        take minutes on a full edition: the API's reconciler fails a run it has not heard from)."""
        stop = threading.Event()

        def beat() -> None:
            while not stop.wait(HEARTBEAT_S):
                try:
                    self._say(*self.last_said)
                except StdoutClosed:                 # the main thread's next line says so too
                    return
        ticker = threading.Thread(target=beat, name="heartbeat", daemon=True)
        ticker.start()
        try:
            return self._finish()
        finally:
            stop.set()
            ticker.join()

    def _finish(self) -> dict:
        """JobManager._complete's steps, with the files stored."""
        self._say("finishing", M.msg("m.run.putting"))
        for _ in range(runs.RENDER_TRIES):                   # a preview that failed is tried again, then left out
            self._store_pages()
        pages = self._pages()
        done = [p for p in pages if p["page"] in self.files]
        if not done:
            said = self.status.get("message")
            return self.finished("failed", error=said.strip() if isinstance(said, str) and said.strip()
                                 else M.msg("m.run.noPages"))
        pdfs = [self.run_dir / p["pdf"] for p in done]
        try:
            runs.merge_pdfs(pdfs, self.run_dir / "edition.pdf")
            runs.zip_pdfs(pdfs, self.run_dir / "press-files.zip")
        except Exception:  # noqa: BLE001 — the Desk's words for it
            traceback.print_exc(file=sys.stderr)                # the file error's own words: the worker's log
            return self.finished("failed", error=M.msg("m.run.notMerged"))
        if self.cancel.is_set():
            return self.finished("cancelled", message=M.msg("m.run.cancelled"))
        self._say("finishing", M.msg("m.run.checking"))
        with ThreadPoolExecutor(max_workers=CHECKS) as pool:
            verdicts = list(pool.map(lambda f: runs.check_pdfx(REPO, f), pdfs))
        for p, pdf, verdict in zip(done, pdfs, verdicts, strict=True):
            report = pdf.with_name(pdf.stem + ".pdfx-check.txt")
            self.checks[p["page"]] = {
                "passed": bool(verdict.get("passed")), "fails": verdict.get("fails"),
                "warnings": verdict.get("warnings"),
                "report": _stored(self.storage, self.guard.run_file(self.run_id, "pdfx-check.txt", p["page"]), report)
                if report.is_file() else None}
        if self.cancel.is_set():
            return self.finished("cancelled", message=M.msg("m.run.cancelled"))
        self.edition_pdf = _stored(self.storage, self.guard.run_file(self.run_id, "edition.pdf"),
                                   self.run_dir / "edition.pdf")
        self.press_zip = _stored(self.storage, self.guard.run_file(self.run_id, "press-files.zip"),
                                 self.run_dir / "press-files.zip")
        failed = sum(1 for p in pages if p["state"] == "failed")
        bad = [f"page-{n:02d}.pdf" for n, v in sorted(self.checks.items()) if not v["passed"]]
        # one coded message (a joined one has no code, so the web could not translate it): the most important;
        # the Pages board shows each page's state and check
        message = (M.msg("m.run.checkProblems", files=M.data(", ".join(bad))) if bad
                   else M.msg("m.run.madeFailed", n=failed) if failed
                   else M.msg("m.run.made1") if len(pdfs) == 1 else M.msg("m.run.madeN", n=len(pdfs)))
        return self.finished("done", message=message)

    def finished(self, state: str, message: object = None, error: object = None) -> dict:
        """run.finished. A page stored but not checked (a run that failed or was cancelled after it was laid out)
        is done with a check that did not run: passed false, fails and warnings null, no report."""
        ended = None if state == "done" else state
        pages = []
        for p in self._pages():
            n = p["page"]
            if n in self.files:
                check = self.checks.get(n) or {"passed": False, "fails": None, "warnings": None, "report": None}
                pages.append({**self._page_facts(p), "state": "done", "check": check})
            else:
                st = p["state"]
                if ended and st in ("waiting", "working", "done"):
                    st = ended                               # never a spinner on a run that has ended
                elif st == "done":
                    st = "failed"                            # done by the engine, but its PDF is not there
                pages.append({"page": n, "role": p["role"], "state": st, "message": self._text(p.get("message"))})
        not_placed = [{"article": x["article"], "reason": self._text(x.get("reason")) or desk_text("")}
                      for x in self.status.get("not_placed") or []
                      if isinstance(x, dict) and isinstance(x.get("article"), str)
                      and util.ARTICLE_ID.fullmatch(x["article"])][:400]
        timings = {str(k)[:40]: round(float(v), 3) for k, v in (self.status.get("timings") or {}).items()
                   if isinstance(v, (int, float)) and not isinstance(v, bool) and 0 <= v <= 1_000_000}
        return {"kind": "run.finished", **self.base, "state": state,
                "message": self._text(message), "error": self._text(error),
                "pages": pages, "not_placed": not_placed,
                "edition_pdf": getattr(self, "edition_pdf", None) if state == "done" else None,
                "press_zip": getattr(self, "press_zip", None) if state == "done" else None,
                "checker_sha256": CHECKER_SHA256, "engine_version": engine.ENGINE_VERSION,
                "timings": timings, "elapsed_s": self._elapsed()}


def layout(storage: Storage, args: dict, settings: engine.Settings, progress: Progress,
           cancel: threading.Event) -> dict:
    return Layout(storage, engine.check_args("engine.layout", args), settings, progress, cancel).run()


# ------------------------------------------------------------------------------------------- engine.measure


def measure(storage: Storage, args: dict, settings: engine.Settings, progress: Progress,
            cancel: threading.Event) -> dict:
    """The edition's stories measured ahead of a layout (the engine's cache in the home) → measure.status: done,
    stopped (a cancel: a layout takes the machine) or failed (the engine's error; logged in the home only)."""
    args = engine.check_args("engine.measure", args)
    guard = KeyGuard(args["org_id"], args["pub_id"])
    edition = uuid(args["edition_id"], "edition_id")
    home_dir, cfg = engine.profile_config(storage, guard, settings, args)
    snapshot = _pinned(storage, guard.edition_measure(edition), args["version_id"], args["sha256"], "snapshot")
    stop_orphans(home_dir)
    ed = home.materialise(storage, settings.homes, guard.org_id, guard.pub_id, args["edition_key"], None, snapshot,
                          args["sha256"], cfg)
    counts = {"measured": 0, "total": 0, "failed": 0}

    def status(state: str) -> dict:
        return {"kind": "measure.status", "org_id": guard.org_id, "pub_id": guard.pub_id, "edition_id": edition,
                "sha256": args["sha256"], "state": state, **counts}

    if cancel.is_set():
        return status("stopped")
    (ed / "measure-status.json").unlink(missing_ok=True)       # an earlier measure's
    client = engine.engine(settings, home_dir)
    log = ed / "measure.log"
    log.unlink(missing_ok=True)
    proc = Process(client.argv("measure", "--edition", args["edition_key"]), client.env(), log, ed / "engine.pid")
    try:
        said = None
        while (rc := proc.poll()) is None:
            if cancel.is_set():
                proc.stop()
                return status("stopped")
            _, doc = _read(ed / "measure-status.json")
            for k in ("measured", "total"):
                v = (doc or {}).get(k)
                if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 2 ** 31:
                    counts[k] = v
            if doc is not None and (counts["measured"], counts["total"]) != said:
                progress(status("measuring"))
                said = (counts["measured"], counts["total"])
            cancel.wait(POLL_S)
    finally:
        if proc.proc.poll() is None:
            proc.stop()
    result = util.last_json_object(runs._read_tail(log)) or {}
    if rc != 0 or result.get("error"):
        return status("failed")
    for k in counts:
        v = result.get(k)
        if isinstance(v, int) and not isinstance(v, bool) and 0 <= v < 2 ** 31:
            counts[k] = v
    return status("done")
