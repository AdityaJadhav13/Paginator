"""Runs (CONTRACT.md §3): at most one engine `generate` process at a time (other editions wait in a queue) and one run
at a time per edition. A watcher thread polls engine-status.json and keeps status.json, the file the UI reads: page
previews as pages finish (pypdfium2), then edition.pdf (pikepdf) and press-files.zip when the engine exits 0."""
from __future__ import annotations

import os
import re
import signal
import subprocess
import sys
import threading
import time
import traceback
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from pathlib import Path

import pikepdf
import pypdfium2 as pdfium
from PIL import Image

from .engine_client import EngineClient
from . import messages as M
from .press import DAMAGED, edition_now, mark_damaged, press_state, recheck_status, refresh_stale
from .store import Store
from .util import (EDITION_ID, FILE_MODE, RUN_ID, DeskError, atomic_file, ensure_dir, last_json_object, now_iso,
                   read_json, tail, write_bytes, write_json)

STATUS_SCHEMA = "pageinator.desk.run-status/1"
ACTIVE = ("queued", "planning", "layout", "finishing")
PAGE_PDF = re.compile(r"page-\d{2}\.pdf")
PREVIEW_LONG_PX = 1800
THUMB_LONG_PX = 360
RENDER_TRIES = 3
# engine-status state -> server state while the engine process is still running
ENGINE_STATE = {"starting": "planning", "planning": "planning", "layout": "layout", "done": "finishing",
                "failed": "finishing"}
RESTARTED = M.msg("m.run.restarted")
PDFIUM_LOCK = threading.Lock()          # pypdfium2 is not thread-safe


# ---------------------------------------------------------------------------------------- outputs of a run


def _save_png(img: Image.Image, path: Path) -> None:
    with atomic_file(path) as f:
        img.save(f, "PNG")


def render_page(pdf_path: Path, png_path: Path, thumb_path: Path) -> None:
    """page-NN.png (long side ~1800 px) and page-NN.thumb.png (~360 px) from a one-page PDF."""
    with PDFIUM_LOCK:
        doc = pdfium.PdfDocument(str(pdf_path))
        try:
            page = doc[0]
            try:
                w, h = page.get_size()
                bitmap = page.render(scale=PREVIEW_LONG_PX / max(w, h, 1.0))
                try:
                    img = bitmap.to_pil().convert("RGB")       # a copy: the bitmap's memory is freed below
                finally:
                    bitmap.close()
            finally:
                page.close()
        finally:
            doc.close()
    thumb = img.copy()
    thumb.thumbnail((THUMB_LONG_PX, THUMB_LONG_PX), Image.Resampling.LANCZOS)
    _save_png(thumb, thumb_path)
    _save_png(img, png_path)            # last: a page has its .png only once both previews exist


PDFX_CHECKER = Path("experiments/phase0/pdfx1/check_pdfx1a_independent.py")
PDFX_TIMEOUT_S = 300


def check_pdfx(repo_root: Path, pdf: Path) -> dict:
    """The independent PDF/X-1a:2003 checker (written from the ISO standard, sharing no code with the writer) on one
    page PDF. Its full report is kept beside the page (page-NN.pdfx-check.txt). → {"passed", "fails", "warnings"}."""
    try:
        r = subprocess.run([sys.executable, str(repo_root / PDFX_CHECKER), str(pdf)], cwd=repo_root, capture_output=True,
                           text=True, timeout=PDFX_TIMEOUT_S, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
    except (OSError, subprocess.SubprocessError) as e:
        return {"passed": False, "fails": None, "warnings": None, "error": f"the checker could not run ({e})"}
    lines = r.stdout.splitlines()
    try:
        write_bytes(pdf.with_name(pdf.stem + ".pdfx-check.txt"), (r.stdout + r.stderr).encode("utf-8", "replace"))
    except OSError:
        pass
    fails = sum(1 for ln in lines if ln.startswith("FAIL"))
    return {"passed": r.returncode == 0 and fails == 0, "fails": fails, "warnings": sum(1 for ln in lines if ln.startswith("WARN"))}


def merge_pdfs(paths: list[Path], out_path: Path) -> None:
    """All pages in one file, for reading and proofs (the press gets the page PDFs). Keeps the first page's
    OutputIntent so a proof shows the newsprint condition."""
    out = pikepdf.new()
    sources: list[pikepdf.Pdf] = []
    try:
        for p in paths:
            src = pikepdf.open(p)
            sources.append(src)
            out.pages.extend(src.pages)
        intents = sources[0].Root.get("/OutputIntents") if sources else None
        if intents is not None:
            try:
                if not intents.is_indirect:
                    intents = sources[0].make_indirect(intents)
                out.Root.OutputIntents = out.copy_foreign(intents)
            except Exception:           # optional: the merged file is still correct without it
                pass
        with atomic_file(out_path) as f:
            out.save(f, deterministic_id=True)
    finally:
        out.close()
        for src in sources:
            src.close()


def zip_pdfs(paths: list[Path], out_path: Path) -> None:
    """The page PDFs, stored (not compressed), in page order, with fixed dates: the same pages give the same zip."""
    with atomic_file(out_path) as f:
        with zipfile.ZipFile(f, "w", compression=zipfile.ZIP_STORED) as zf:
            for p in paths:
                info = zipfile.ZipInfo(p.name, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = (0o100000 | FILE_MODE) << 16
                zf.writestr(info, p.read_bytes())


def _read_tail(path: Path, size: int = 64 * 1024) -> str:
    try:
        with open(path, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - size))
            return f.read().decode("utf-8", "replace")
    except OSError:
        return ""


# --------------------------------------------------------------------------------------------------- jobs


class Job:
    def __init__(self, eid: str, rid: str, run_dir: Path):
        self.eid, self.rid, self.dir = eid, rid, run_dir
        self.created = now_iso()
        self.started: str | None = None
        self.started_t: float | None = None
        self.finished: str | None = None
        self.finished_t: float | None = None
        self.proc: subprocess.Popen | None = None
        self.log = None
        self.cancel_requested = False
        self.cancel_t = 0.0
        self.killed = False
        self.engine: dict | None = None            # the last engine-status.json that could be read
        self.render_tries: dict[str, int] = {}
        self.pdfx: dict[str, dict] = {}            # page PDF -> the independent PDF/X-1a checker's verdict


def _ours(pgid: int) -> bool:
    """Is process group pgid still the Desk engine's (its own process, or its spawned workers)? A pid can be reused
    after a reboot or a long time: only a group that runs the Desk engine is ever signalled."""
    try:
        out = subprocess.run(["ps", "-A", "-o", "pgid=,command="], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    for line in out.splitlines():
        head, _, command = line.strip().partition(" ")
        if head == str(pgid) and ("desk_engine.py" in command or "multiprocessing.spawn" in command):
            return True
    return False


def stop_orphan(pid_file: Path) -> None:
    """An engine left running by a server that died (crash, kill -9): stop its whole process group."""
    try:
        pgid = int(pid_file.read_text().strip())
    except (OSError, ValueError):
        return
    if pgid <= 1 or not _ours(pgid):
        return
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(pgid, sig)
        except (ProcessLookupError, PermissionError):
            return
        except OSError:
            return
        time.sleep(1.0)


class JobManager:
    def __init__(self, store: Store, engine: EngineClient, poll_interval: float = 1.0, kill_after: float = 5.0):
        self.store, self.engine = store, engine
        self.poll_interval, self.kill_after = poll_interval, kill_after
        self.lock = threading.RLock()
        self.jobs: dict[tuple[str, str], Job] = {}  # queued, running or finishing
        self.queue: list[Job] = []
        self.current: Job | None = None
        self._gc: set[str] = set()                  # editions whose unused photo files can be removed now
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.recovered = self.recover()

    # -------------------------------------------------------------------------------------- lifecycle

    def recover(self) -> int:
        """Runs left queued or in progress by an earlier server cannot finish: mark them failed. Finished runs are
        checked against their edition again (one laid out by an older Desk, or before an edition change this server
        did not see, must not offer its press files as current)."""
        n, editions = 0, {}
        for path in sorted(self.store.editions_dir.glob("*/runs/*/status.json")):
            if not (EDITION_ID.fullmatch(path.parent.parent.parent.name) and RUN_ID.fullmatch(path.parent.name)):
                continue
            try:
                status = read_json(path)
                if isinstance(status, dict) and status.get("state") in ACTIVE:
                    stop_orphan(path.parent / "engine.pid")
                    now = now_iso()
                    status.update(state="failed", error=RESTARTED, message=RESTARTED, finished=now, updated=now)
                    M.write_status(path, status)
                    n += 1
                elif isinstance(status, dict) and status.get("state") == "done":
                    ed_dir = path.parent.parent.parent
                    if ed_dir not in editions:
                        try:
                            editions[ed_dir] = edition_now(ed_dir)
                        except Exception as e:  # noqa: BLE001 — the edition cannot be read: none of its layouts is current
                            editions[ed_dir] = None
                            print(f"[desk] {ed_dir.name}: its files cannot be read ({e})", file=sys.stderr)
                    if editions[ed_dir] is None:
                        mark_damaged(status, path.parent)
                    else:
                        recheck_status(status, path.parent, editions[ed_dir])
            except Exception as e:  # noqa: BLE001 — one damaged run never stops the server starting
                print(f"[desk] {path.parent.name}: could not be checked at start-up ({e})", file=sys.stderr)
        return n

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="desk-runs", daemon=True)
            self._thread.start()

    def close(self) -> None:
        """Stops the watcher and the engine process (its run is marked failed by the next start)."""
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=30)
        with self.lock:
            job = self.current
        if job is not None and job.proc is not None:
            if job.proc.poll() is None:
                self._signal(job, signal.SIGTERM)
                try:
                    job.proc.wait(timeout=self.kill_after)
                except subprocess.TimeoutExpired:
                    self._signal(job, signal.SIGKILL)
                    try:
                        job.proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        print(f"[desk] the layout engine (pid {job.proc.pid}) did not stop", file=sys.stderr)
            self._close_log(job)

    def is_active(self, eid: str) -> bool:
        with self.lock:
            return any(j.eid == eid for j in self.jobs.values())

    def generating(self) -> bool:
        """A layout run is queued or running (or still stopping)."""
        with self.lock:
            return self.current is not None or bool(self.queue)

    # ------------------------------------------------------------------------------------- requests

    def create_run(self, eid: str) -> str:
        if not self.engine.ok():
            raise DeskError(500, self.engine.missing_message())
        with self.store.lock(eid):
            snapshot = self.store.snapshot(eid)
            if not snapshot["articles"]:
                raise DeskError(400, M.msg("m.run.noArticlesYet"))
            with self.lock:
                if any(j.eid == eid and not j.cancel_requested for j in self.jobs.values()):
                    raise DeskError(409, M.msg("m.run.alreadyRunning"))
                job = self._new_job(eid)
                write_json(job.dir / "request.json", snapshot)
                busy = self.current is not None or bool(self.queue)
                self._write_status(job, "queued", message=M.msg("m.run.waiting") if busy else M.msg("m.run.starting"))
                self.jobs[(eid, job.rid)] = job
                self.queue.append(job)
        self._wake.set()
        return job.rid

    def _new_job(self, eid: str) -> Job:
        runs = ensure_dir(self.store.edition_dir(eid) / "runs")
        t = datetime.now().replace(microsecond=0)
        while True:
            rid = t.strftime("r-%Y%m%d-%H%M%S")
            try:
                (runs / rid).mkdir(mode=0o700)
                break
            except FileExistsError:
                t += timedelta(seconds=1)
        os.chmod(runs / rid, 0o700)
        return Job(eid, rid, runs / rid)

    def cancel(self, eid: str, rid: str) -> None:
        with self.lock:
            job = self.jobs.get((eid, rid))
            if job is None:
                state = self.store.run_status(eid, rid).get("state")      # 404 when there is no such run
                if state == "cancelled":
                    return
                raise DeskError(409, M.msg("m.run.finished"))
            if not job.cancel_requested:
                job.cancel_requested = True
                job.cancel_t = time.monotonic()
                if job in self.queue:
                    self._finish_job(job, "cancelled", message=M.msg("m.run.cancelledBefore"))
                elif job.proc is not None and job.proc.poll() is None:
                    self._signal(job, signal.SIGTERM)
        self._wake.set()

    # -------------------------------------------------------------------------------------- watcher

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(self.poll_interval)
            self._wake.clear()
            if self._stop.is_set():
                break
            try:
                self._tick()
            except Exception:
                traceback.print_exc(file=sys.stderr)
            with self.lock:
                pending, self._gc = self._gc, set()
            for eid in pending:
                if not self.store.gc_photos(eid, blocking=False):
                    with self.lock:
                        self._gc.add(eid)                      # the edition was busy: try again next time

    def _tick(self) -> None:
        with self.lock:
            job = self.current
            if job is None and self.queue:
                job = self.current = self.queue.pop(0)
        if job is None:
            return
        if job.proc is None:
            self._launch(job)
        if self.current is job and job.proc is not None:
            self._poll(job)

    def _launch(self, job: Job) -> None:
        with self.lock:
            if job.cancel_requested:
                self._finish_job(job, "cancelled", message=M.msg("m.run.cancelledBefore"))
                return
            try:
                fd = os.open(job.dir / "engine.log", os.O_WRONLY | os.O_CREAT | os.O_APPEND, FILE_MODE)
                job.log = os.fdopen(fd, "ab")
                job.proc = subprocess.Popen(self.engine.generate_argv(job.eid, job.rid), cwd=self.engine.repo_root,
                                            env=self.engine.env(), stdin=subprocess.DEVNULL, stdout=job.log,
                                            stderr=subprocess.STDOUT, start_new_session=True)
            except OSError as e:
                self._close_log(job)
                self._finish_job(job, "failed", error=M.msg("m.run.engineNotStarted", error=M.data(str(e.strerror or e))))
                return
            job.started = now_iso()
            job.started_t = time.monotonic()
            try:                                    # its process group, so a later start can stop it if this server dies
                write_bytes(job.dir / "engine.pid", f"{job.proc.pid}\n".encode())
            except OSError:
                pass
            self._write_status(job, "planning", message=M.msg("m.run.engineStarted"))

    def _poll(self, job: Job) -> None:
        try:
            engine = read_json(job.dir / "engine-status.json", default=None)
        except DeskError:
            engine = None
        if isinstance(engine, dict):
            job.engine = engine
        rc = job.proc.poll()
        if job.cancel_requested:
            if rc is None:
                if not job.killed and time.monotonic() - job.cancel_t >= self.kill_after:
                    self._signal(job, signal.SIGKILL)
                    job.killed = True
                self._write_status(job, "cancelled", message=M.msg("m.run.cancelled"))   # the UI stops polling here; the
                return                                                         # process ends within kill_after
            self._close_log(job)
            with self.lock:
                self._finish_job(job, "cancelled", message=M.msg("m.run.cancelled"))
            return
        self._render(job)
        if rc is None:
            state = ENGINE_STATE.get(str((job.engine or {}).get("state")), "layout" if job.engine else "planning")
            self._write_status(job, state)
            return
        self._close_log(job)
        if rc == 0:
            self._complete(job)
        else:
            with self.lock:
                self._finish_job(job, "failed", error=self._failure(job, rc))

    def _render(self, job: Job) -> None:
        for page in (job.engine or {}).get("pages") or []:
            if not isinstance(page, dict) or page.get("state") != "done":
                continue
            name = page.get("pdf")
            if not isinstance(name, str) or not PAGE_PDF.fullmatch(name):
                continue
            pdf, png, thumb = job.dir / name, job.dir / f"{name[:-4]}.png", job.dir / f"{name[:-4]}.thumb.png"
            if png.is_file() or not pdf.is_file() or job.render_tries.get(name, 0) >= RENDER_TRIES:
                continue
            try:
                render_page(pdf, png, thumb)
            except Exception as e:
                job.render_tries[name] = job.render_tries.get(name, 0) + 1
                print(f"[desk] the preview of {job.eid} {job.rid} {name} failed: {e}", file=sys.stderr)

    def _complete(self, job: Job) -> None:
        """The engine exited 0: last previews, then edition.pdf and press-files.zip."""
        self._write_status(job, "finishing", message=M.msg("m.run.putting"))
        self._render(job)
        pages = [p for p in (job.engine or {}).get("pages") or [] if isinstance(p, dict)]
        pages.sort(key=lambda p: p["page"] if isinstance(p.get("page"), int) else 0)
        pdfs = [job.dir / p["pdf"] for p in pages if p.get("state") == "done" and isinstance(p.get("pdf"), str)
                and PAGE_PDF.fullmatch(p["pdf"]) and (job.dir / p["pdf"]).is_file()]
        if not pdfs:
            said = (job.engine or {}).get("message")
            with self.lock:
                self._finish_job(job, "failed", error=said.strip() if isinstance(said, str) and said.strip()
                                 else M.msg("m.run.noPages"))
            return
        try:
            merge_pdfs(pdfs, job.dir / "edition.pdf")
            zip_pdfs(pdfs, job.dir / "press-files.zip")
        except Exception:
            traceback.print_exc(file=sys.stderr)                # the file error's own words: here, not on the screen
            with self.lock:
                self._finish_job(job, "failed", error=M.msg("m.run.notMerged"))
            return
        self._write_status(job, "finishing", message=M.msg("m.run.checking"))
        with ThreadPoolExecutor(max_workers=4) as pool:
            for pdf, verdict in zip(pdfs, pool.map(lambda f: check_pdfx(self.engine.repo_root, f), pdfs), strict=True):
                job.pdfx[pdf.name] = verdict
        failed = sum(1 for p in pages if p.get("state") == "failed")
        made = M.msg("m.run.made1") if len(pdfs) == 1 else M.msg("m.run.madeN", n=len(pdfs))
        bad = [name for name, v in sorted(job.pdfx.items()) if not v.get("passed")]
        message = M.join(made, M.msg("m.run.madeFailed", n=failed) if failed else "",
                       M.msg("m.run.checkProblems", files=M.data(", ".join(bad))) if bad else "")
        # the edition's lock too: a page's "stale" marks are worked out and written with no article change in between
        # (a change made meanwhile is either seen here, or rechecks this run once its status says "done")
        with self.store.lock(job.eid), self.lock:
            if job.cancel_requested:
                self._finish_job(job, "cancelled", message=M.msg("m.run.cancelled"))
            else:
                self._finish_job(job, "done", message=message)

    def _failure(self, job: Job, rc: int) -> str:
        text = _read_tail(job.dir / "engine.log")
        result = last_json_object(text)
        if result and isinstance(result.get("error"), str) and result["error"].strip():
            return result["error"].strip()
        engine = job.engine or {}
        if engine.get("state") == "failed" and isinstance(engine.get("message"), str) and engine["message"].strip():
            return engine["message"].strip()
        how = f"was stopped (signal {-rc})" if rc < 0 else f"stopped with an error (exit code {rc})"
        detail = tail(text)
        return f"The layout engine {how}." + (f" Last output: {detail}" if detail else "")

    # ------------------------------------------------------------------------------------- helpers

    def _finish_job(self, job: Job, state: str, message: str | None = None, error: str | None = None) -> None:
        """Final state (the caller holds self.lock)."""
        job.finished = now_iso()
        job.finished_t = time.monotonic()
        self._write_status(job, state, message=message if message is not None else (error or ""), error=error)
        self.jobs.pop((job.eid, job.rid), None)
        if job in self.queue:
            self.queue.remove(job)
        if self.current is job:
            self.current = None
        self._gc.add(job.eid)
        self._wake.set()

    def _write_status(self, job: Job, state: str, message: str | None = None, error: str | None = None) -> None:
        """status.json: the engine status (article_warnings, timings … verbatim), plus per page "png" and "thumb",
        plus the server's own fields."""
        engine = job.engine or {}
        status = {k: v for k, v in engine.items() if k not in ("schema", "plan_log")}   # plan_log: large, unused
        pages = []
        ended = {"cancelled": "cancelled", "failed": "failed"}.get(state)
        for page in engine.get("pages") or []:
            if not isinstance(page, dict):
                continue
            page = dict(page)
            if ended and page.get("state") in ("waiting", "working"):
                page["state"] = ended                     # never a spinner on a run that has ended
            name, png, thumb = page.get("pdf"), None, None
            if isinstance(name, str) and PAGE_PDF.fullmatch(name):
                if (job.dir / f"{name[:-4]}.png").is_file():
                    png = f"{name[:-4]}.png"
                if (job.dir / f"{name[:-4]}.thumb.png").is_file():
                    thumb = f"{name[:-4]}.thumb.png"
            page["png"], page["thumb"] = png, thumb
            if isinstance(name, str) and name in job.pdfx:
                page["pdfx_check"] = job.pdfx[name]
            pages.append(page)
        end = job.finished_t if job.finished_t is not None else time.monotonic()
        status.update({
            "schema": STATUS_SCHEMA, "run": job.rid, "edition": job.eid, "state": state,
            "engine_state": engine.get("state"),
            "created": job.created, "started": job.started, "finished": job.finished, "updated": now_iso(),
            "elapsed_s": round(end - job.started_t, 1) if job.started_t is not None else 0.0,
            "message": message if message is not None else str(engine.get("message") or ""),
            "error": error, "pages": pages,
            "not_placed": engine["not_placed"] if isinstance(engine.get("not_placed"), list) else [],
            "edition_pdf": "edition.pdf" if (job.dir / "edition.pdf").is_file() else None,
            "zip": "press-files.zip" if (job.dir / "press-files.zip").is_file() else None,
        })
        if state == "done":                                # what each page prints, against the edition as it is now
            try:
                printed = read_json(job.dir / "printed.json", {}).get("pages") or {}
                for page in pages:
                    if isinstance(printed.get(str(page.get("page"))), dict):
                        page["printed"] = printed[str(page["page"])]
                refresh_stale(status, job.dir)
            except Exception as e:  # noqa: BLE001 — a file that cannot be read: the run ends, never "current"
                print(f"[desk] {job.eid} {job.rid}: could not be checked against the edition ({e})", file=sys.stderr)
                for page in pages:
                    if page.get("state") == "done":
                        page["stale"] = [DAMAGED]
        status.update(press_state(status))
        M.write_status(job.dir / "status.json", status)

    @staticmethod
    def _signal(job: Job, sig: int) -> None:
        """Signal the engine's whole process group (it was started in its own session), so its workers stop too."""
        if job.proc is None or job.proc.poll() is not None:
            return
        try:
            os.killpg(job.proc.pid, sig)
        except ProcessLookupError:
            pass
        except OSError:
            try:
                job.proc.send_signal(sig)
            except OSError:
                pass

    @staticmethod
    def _close_log(job: Job) -> None:
        if job.log is not None:
            try:
                job.log.close()
            finally:
                job.log = None
