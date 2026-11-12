"""Background measuring: `engine measure --edition <id>` a few seconds after an edition's articles last changed, so a
later layout run finds its stories already measured (the engine caches the results; it writes
<edition>/measure-status.json itself). One measure process at a time, server-wide, and never while a layout run is
queued or running: a measure that falls due then waits, and one in progress is stopped and redone afterwards (cheap:
what it finished is cached). Failures are only logged."""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from typing import IO, Callable

from .engine_client import EngineClient
from .util import EDITION_ID, last_json_object, read_json, tail, write_json

DELAY_S = 8.0                    # after the last change
TIMEOUT_S = 15 * 60.0
KILL_AFTER_S = 5.0


def _signal(proc: subprocess.Popen, sig: int) -> None:
    """Signal the measure's process group (it was started in its own session, so its workers stop too)."""
    if proc.poll() is not None:
        return
    try:
        os.killpg(proc.pid, sig)
    except ProcessLookupError:
        pass
    except OSError:
        try:
            proc.send_signal(sig)
        except OSError:
            pass


class Measurer:
    def __init__(self, engine: EngineClient, busy: Callable[[], bool], delay: float = DELAY_S, poll: float = 0.5,
                 timeout: float = TIMEOUT_S, kill_after: float = KILL_AFTER_S):
        self.engine, self.busy = engine, busy                 # busy(): a layout run is queued or running
        self.delay, self.poll, self.timeout, self.kill_after = delay, poll, timeout, kill_after
        self.lock = threading.Lock()
        self.due: dict[str, float] = {}                       # edition -> when its measure may start (monotonic)
        self.eid: str | None = None                           # the edition being measured
        self.proc: subprocess.Popen | None = None
        self.out: IO[bytes] | None = None                     # its stdout + stderr (an unlinked temporary file)
        self.started_t = 0.0
        self.stop_t: float | None = None                      # when it was asked to stop
        self.started = 0                                      # measure processes started so far
        self.log: Callable[[str], None] = lambda msg: print(f"[desk] {msg}", file=sys.stderr, flush=True)
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ---------------------------------------------------------------------------------------- requests

    def touch(self, eid: str) -> None:
        """The edition's articles changed: measure it `delay` seconds after the last change (again, if a measure of it
        is running now)."""
        with self.lock:
            self.due[eid] = time.monotonic() + self.delay
        self._wake.set()

    def resume(self, editions_dir) -> int:
        """At start: editions whose measure-status.json still says "measuring" (the server stopped during a measure)
        are measured again, so the status does not stay stale."""
        n = 0
        for status in editions_dir.glob("*/measure-status.json"):
            try:
                stale = json.loads(status.read_text("utf-8")).get("state") == "measuring"
            except (OSError, ValueError, AttributeError):
                continue
            if stale and EDITION_ID.fullmatch(status.parent.name) and (status.parent / "edition.json").is_file():
                self.touch(status.parent.name)
                n += 1
        return n

    def forget(self, eid: str) -> None:
        """The edition is being deleted: drop its pending measure and stop one in progress, waiting until it has
        ended (so it cannot write into the folder after the folder has moved)."""
        with self.lock:
            self.due.pop(eid, None)
            proc = self.proc if self.eid == eid else None
            if proc is not None:
                self.stop_t = time.monotonic()
        if proc is not None:
            self._end(proc)

    # --------------------------------------------------------------------------------------- lifecycle

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._loop, name="desk-measure", daemon=True)
            self._thread.start()

    def close(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout=30)
        with self.lock:
            proc, out = self.proc, self.out
            self.proc = self.out = self.eid = None
        if proc is not None:
            self._end(proc)
        if out is not None:
            out.close()

    def _end(self, proc: subprocess.Popen) -> None:
        _signal(proc, signal.SIGTERM)
        try:
            proc.wait(timeout=self.kill_after)
        except subprocess.TimeoutExpired:
            _signal(proc, signal.SIGKILL)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.log(f"a measure process (pid {proc.pid}) did not stop")

    # ------------------------------------------------------------------------------------------ worker

    def _loop(self) -> None:
        while not self._stop.is_set():
            self._wake.wait(self._next_wait())
            self._wake.clear()
            if self._stop.is_set():
                break
            try:
                self._tick()
            except Exception:
                traceback.print_exc(file=sys.stderr)

    def _next_wait(self) -> float:
        with self.lock:
            if self.proc is not None:
                return self.poll
            if not self.due:
                return 5.0
            ahead = min(self.due.values()) - time.monotonic()
        return self.poll if ahead <= 0 else min(ahead, 5.0)

    def _tick(self) -> None:
        now = time.monotonic()
        with self.lock:
            proc, eid = self.proc, self.eid
        if proc is not None:
            rc = proc.poll()
            if rc is None:
                self._watch(proc, eid, now)
                return
            self._finished(eid, rc)
        if self.busy():
            return
        with self.lock:                                       # pick and launch together: forget() sees either
            ready = [(t, e) for e, t in self.due.items() if t <= now]
            if ready and self.proc is None:
                eid = min(ready)[1]
                del self.due[eid]
                self._launch(eid)

    def _watch(self, proc: subprocess.Popen, eid: str, now: float) -> None:
        with self.lock:
            stop_t = self.stop_t
        if stop_t is None:
            if self.busy():                                   # a layout run started: it has the machine now
                with self.lock:
                    self.stop_t = now
                    self.due.setdefault(eid, now)             # redo it after the run
                _signal(proc, signal.SIGTERM)
            elif now - self.started_t > self.timeout:
                self.log(f"measuring {eid} took longer than {self.timeout:.0f} s and was stopped")
                with self.lock:
                    self.stop_t = now
                _signal(proc, signal.SIGTERM)
        elif now - stop_t > self.kill_after:
            _signal(proc, signal.SIGKILL)

    def _launch(self, eid: str) -> None:
        """Starts the measure (the caller holds self.lock)."""
        if not self.engine.ok() or not (self.engine.home / "editions" / eid / "edition.json").is_file():
            return
        out = tempfile.TemporaryFile(dir=self.engine.home)
        try:
            proc = subprocess.Popen(self.engine.argv("measure", "--edition", eid), cwd=self.engine.repo_root,
                                    env=self.engine.env(), stdin=subprocess.DEVNULL, stdout=out,
                                    stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as e:
            out.close()
            self.log(f"measuring {eid} could not start: {e.strerror or e}")
            return
        self.proc, self.eid, self.out = proc, eid, out
        self.started_t, self.stop_t = time.monotonic(), None
        self.started += 1

    def _settle(self, eid: str, state: str) -> None:
        """A measure that was stopped or failed never leaves "measuring" behind (the UI would wait on it forever)."""
        path = self.engine.home / "editions" / eid / "measure-status.json"
        try:
            status = read_json(path)
        except Exception:  # noqa: BLE001 — missing or unreadable: nothing to settle
            return
        if isinstance(status, dict) and status.get("state") == "measuring":
            status.update(state=state)
            try:
                write_json(path, status)
            except OSError:
                pass

    def _finished(self, eid: str, rc: int) -> None:
        with self.lock:
            out, stopped = self.out, self.stop_t is not None
            self.proc = self.eid = self.out = None
            self.stop_t = None
        text = ""
        if out is not None:
            try:
                out.seek(max(0, out.seek(0, os.SEEK_END) - 64 * 1024))
                text = out.read().decode("utf-8", "replace")
            finally:
                out.close()
        if stopped:
            self._settle(eid, "stopped")
            return
        result = last_json_object(text)
        problem = result.get("error") if isinstance(result, dict) else None
        if rc != 0 or problem:
            detail = problem if isinstance(problem, str) and problem.strip() else tail(text) or f"exit code {rc}"
            self.log(f"measuring {eid} failed: {detail}")
            self._settle(eid, "failed")
