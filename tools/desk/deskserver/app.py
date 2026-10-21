"""The Desk: wiring of storage, engine client, job runner and HTTP server, and the command line (server.py)."""
from __future__ import annotations

import argparse
import errno
import fcntl
import os
import signal
import sys
import threading
import webbrowser
from pathlib import Path

from . import __version__, images
from .api import Api, DeskServer
from .editing import EditService, is_saving
from .engine_client import EngineClient
from .jobs import JobManager
from .measure import DELAY_S, Measurer
from .store import Store
from .util import DeskError, ensure_dir

REPO_ROOT = Path(__file__).resolve().parents[3]           # tools/desk/deskserver/app.py -> the repository
DEFAULT_HOME = "~/PageinatorPrivate/desk"


class Desk:
    def __init__(self, home: str | Path, *, repo_root: Path = REPO_ROOT, static_dir: Path | None = None,
                 poll_interval: float = 1.0, kill_after: float = 5.0, measure_delay: float = DELAY_S):
        self.repo_root = Path(repo_root).resolve()
        self.home = Path(home).expanduser().resolve()
        if self.home == self.repo_root or self.repo_root in self.home.parents:
            raise DeskError(400, "The desk home must be outside the repository: it holds the newspaper's own work.")
        ensure_dir(self.home)
        self.static_dir = Path(static_dir) if static_dir else self.repo_root / "tools/desk/static"
        self.store = Store(self.home)
        self.engine = EngineClient.from_env(self.repo_root, self.home)
        self.jobs = JobManager(self.store, self.engine, poll_interval=poll_interval, kill_after=kill_after)
        self.store.is_active = self.jobs.is_active
        self.measurer = Measurer(self.engine, busy=self.jobs.generating, delay=measure_delay,
                                 poll=min(0.5, poll_interval), kill_after=kill_after)
        self.store.articles_changed = self.measurer.touch
        self.store.edition_closing = self.measurer.forget
        self.store.is_saving = is_saving
        self.measurer.resume(self.store.editions_dir)
        self.editing = EditService(self.engine, self.home)
        self.api = Api(self)

    def serve(self, port: int = 8765) -> DeskServer:
        """Binds 127.0.0.1:<port> (0 = any free port) and starts the job watcher."""
        server = DeskServer(self, port)
        self.jobs.start()
        self.measurer.start()
        return server

    def close(self) -> None:
        self.measurer.close()
        self.jobs.close()
        self.editing.close()


LOCK_NAME = ".desk.lock"


def claim_home(home: Path) -> tuple[int | None, str | None]:
    """One Desk per home: a second start (the launcher double-clicked again) must not touch the first one's runs.
    → (lock fd, None) for the only Desk, or (None, the running Desk's address or None)."""
    ensure_dir(home)
    fd = os.open(home / LOCK_NAME, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        try:
            port = int(os.read(fd, 64).decode("ascii", "replace").split()[1])
            url = f"http://127.0.0.1:{port}/"
        except (OSError, ValueError, IndexError):
            url = None
        os.close(fd)
        return None, url
    return fd, None


def note_address(fd: int, port: int) -> None:
    os.ftruncate(fd, 0)
    os.lseek(fd, 0, os.SEEK_SET)
    os.write(fd, f"{os.getpid()} {port}\n".encode("ascii"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="server.py", description="Pageinator Desk: the local server "
                                     "(listens on 127.0.0.1 only).")
    parser.add_argument("--port", type=int, default=8765, help="port on 127.0.0.1 (default 8765)")
    parser.add_argument("--home", help="the desk home (default: $PAGEINATOR_DESK_HOME, else ~/PageinatorPrivate/desk)")
    parser.add_argument("--open", action="store_true", help="open the Desk in the web browser")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("the port must be between 0 and 65535")
    home = args.home or os.environ.get("PAGEINATOR_DESK_HOME") or DEFAULT_HOME
    try:
        lock, running = claim_home(Path(home).expanduser().resolve())
    except OSError as e:
        print(f"Pageinator Desk: the desk home cannot be used ({e}).", file=sys.stderr)
        return 2
    if lock is None:
        print("Pageinator Desk is already running" + (f": {running}" if running else "") + ".", file=sys.stderr)
        if args.open and running:
            webbrowser.open(running)
        return 0
    try:
        desk = Desk(home)
    except DeskError as e:
        print(f"Pageinator Desk: {e.message}", file=sys.stderr)
        return 2
    except OSError as e:
        print(f"Pageinator Desk: the desk home cannot be used ({e}).", file=sys.stderr)
        return 2
    try:
        server = desk.serve(args.port)
    except OSError as e:
        desk.close()
        if e.errno == errno.EADDRINUSE:
            print(f"Pageinator Desk: port {args.port} is already in use. Is the Desk already running? "
                  "Choose another port with --port.", file=sys.stderr)
        else:
            print(f"Pageinator Desk: cannot listen on 127.0.0.1:{args.port} ({e}).", file=sys.stderr)
        return 1
    note_address(lock, server.server_address[1])
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    lines = [f"Pageinator Desk {__version__}: {url}", f"  home: {desk.home}",
             "  engine: " + ("found" if desk.engine.ok() else desk.engine.missing_message()),
             "  newsprint profile: " + ("found" if images.icc_ok() else
                                        "MISSING - photos and ads cannot be converted (set PAGEINATOR_ICC)")]
    if desk.jobs.recovered:
        lines.append(f"  {desk.jobs.recovered} unfinished run(s) from the last time were marked failed.")
    lines.append("  Press Ctrl+C to stop.")
    print("\n".join(lines), file=sys.stderr, flush=True)

    def stop(signum: int, frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGHUP, stop)                    # the Terminal window closed: stop the runs cleanly
    if args.open:
        threading.Timer(0.3, webbrowser.open, (url,)).start()
    try:
        server.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        print("\nPageinator Desk: stopping.", file=sys.stderr)
    finally:
        server.server_close()
        desk.close()
    return 0
