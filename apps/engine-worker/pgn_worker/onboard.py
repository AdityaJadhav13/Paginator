"""`engine.onboard` (L4, docs/runbooks/onboard-a-new-paper.md): a publication's past edition PDFs → its engine dataset
bundle, made by `tools/onboard/onboard.py` (deterministic: no AI), stored for the existing engine.setup.

- **Before**: the inputs file (`onboarding/<id>/inputs.json`, OnboardInputs) pinned by version and SHA-256, and each
  PDF it names (`pdfs/NN.pdf`) streamed to disk by its version (at most 200 MiB) and its SHA-256 checked: other bytes
  are `worker.checksum`. Every key is made from the job's ids (keys.KeyGuard).
- **The work folder** is `<home>/onboarding/<id>/` (pgn_worker/home.py's folders: 0700, no link on the way), emptied
  first and removed afterwards, whatever the end: nothing of the paper's PDFs stays on the worker.
- **The tool** runs as the engine does: in a process group of its own (launcher.Process), from the repository's root,
  with the bare environment (never the store's keys), `<PGN_ONBOARD_PYTHON> tools/onboard/onboard.py build --files
  files.json --out dataset --status status.json --icc <the worker's colour profile> --engine-python
  <PGN_ENGINE_PYTHON>`. `onboard.progress` is written when status.json's step or count changes, and at least every
  30 s (a heartbeat, through the downloads, the packing and the upload too).
- **Stops**: a cancel (SIGTERM to the runner) stops the tool's group (SIGTERM, then SIGKILL after 5 s): failed,
  `worker.cancelled` (the API has recorded the cancel; the queue reports nothing). No change of status.json for
  `PGN_ENGINE_STALL_S` (600 s): stopped, failed `worker.stalled`. A tool that exits non-zero or answers no outcome:
  failed `worker.onboard`.
- **After**: rejected → `onboard.rejected` (the set's reason and each file's check: a finished job). Ready →
  `onboard.py pack`, the ZIP uploaded to `onboarding/<id>/dataset.zip` (streamed), `onboard.ready` with it pinned."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import engine, home, launcher
from .desk import REPO, images, runs, util
from .keys import KeyGuard, uuid
from .media import Mismatch
from .params import profile_sha256
from .storage import Storage

ARGS = ("org_id", "pub_id", "onboarding_id", "version_id", "sha256")
INPUTS_FORMAT = "pageinator.onboard-inputs/1"            # the contract's ONBOARD_INPUTS_FORMAT
MAX_PDF_BYTES = 200 * 1024 ** 2                           # MAX_ONBOARD_PDF_BYTES
MIN_FILES, MAX_FILES = 3, 40                              # MIN_ONBOARD_FILES, MAX_ONBOARD_FILES
STEPS = ("checking", "reading", "measuring", "learning", "pictures", "packing")   # ONBOARD_STEPS
REJECT_CODES = ("onboard.too_few_editions", "onboard.no_grid", "onboard.no_template", "onboard.too_many_excluded",
                "onboard.failed")
SCRIPT = REPO / "tools" / "onboard" / "onboard.py"
MAX_RESULT = 1024 * 1024                                  # the tail of the tool's log its answer is read from
COUNT = 2 ** 31


class Failed(Exception):
    """The onboarding cannot finish here: a failed result with this worker.… code (never run again: one attempt)."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


@dataclass(frozen=True)
class Settings:
    engine: engine.Settings
    python: Path            # the onboarding tool's Python
    script: Path            # tools/onboard/onboard.py (a test's fake through PAGEINATOR_ONBOARD_SCRIPT)

    @classmethod
    def from_env(cls, env: dict[str, str]) -> "Settings":
        python = Path(env.get("PGN_ONBOARD_PYTHON", ""))
        if not python.is_absolute() or not python.is_file() or not os.access(python, os.X_OK):
            raise engine.ConfigError("PGN_ONBOARD_PYTHON is not set to the onboarding tool's Python")
        script = Path(env.get("PAGEINATOR_ONBOARD_SCRIPT") or SCRIPT)
        if not script.is_file():
            raise engine.ConfigError("the onboarding tool's script is missing")
        return cls(engine.Settings.from_env(env), python, script)


def check_args(args: dict) -> dict:
    if not isinstance(args, dict) or set(args) != set(ARGS):
        raise ValueError(f"engine.onboard takes exactly {', '.join(ARGS)}")
    uuid(args["onboarding_id"], "onboarding_id")
    if not engine.SHA256.fullmatch(args["sha256"]):
        raise ValueError("engine.onboard: sha256 is not 64 lowercase hex characters")
    if not 0 < len(args["version_id"]) <= 1024:
        raise ValueError("engine.onboard: version_id is not valid")
    return args


def inputs(storage: Storage, guard: KeyGuard, onboarding: str, args: dict) -> list[dict]:
    """The inputs file's files, as the contract's OnboardInputs (home.BadRequest otherwise: worker.job)."""
    data = launcher._pinned(storage, guard.onboarding_inputs(onboarding), args["version_id"], args["sha256"],
                            "inputs file")
    try:
        doc = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        doc = None
    if not isinstance(doc, dict) or set(doc) != {"format", "files"} or doc["format"] != INPUTS_FORMAT:
        raise home.BadRequest("the onboarding's inputs file is not one the worker reads")
    files = doc["files"]
    if not isinstance(files, list) or not MIN_FILES <= len(files) <= MAX_FILES:
        raise home.BadRequest(f"an onboarding names {MIN_FILES} to {MAX_FILES} files")
    for f in files:
        whole = lambda v, top: isinstance(v, int) and not isinstance(v, bool) and 1 <= v <= top  # noqa: E731
        if (not isinstance(f, dict) or set(f) != {"n", "name", "version_id", "sha256", "bytes"}
                or not whole(f["n"], MAX_FILES) or not whole(f["bytes"], MAX_PDF_BYTES)
                or not isinstance(f["name"], str) or not 0 < len(f["name"]) <= 255
                or not isinstance(f["version_id"], str) or not 0 < len(f["version_id"]) <= 1024
                or not isinstance(f["sha256"], str) or not engine.SHA256.fullmatch(f["sha256"])):
            raise home.BadRequest("a file of the onboarding's inputs file is not valid")
    if len({f["n"] for f in files}) != len(files):
        raise home.BadRequest("the onboarding's inputs file names one file twice")
    return files


class Said:
    """onboard.progress, written on a change and re-said every HEARTBEAT_S by a thread of its own (the API's
    reconciler stops an onboarding it has not heard from), one line at a time."""

    def __init__(self, progress: Callable[[dict], None], base: dict):
        self.progress, self.base, self.lock, self.last = progress, base, threading.Lock(), None
        self.stop = threading.Event()
        self.ticker = threading.Thread(target=self._beat, name="heartbeat", daemon=True)

    def say(self, step: str, done: int, total: int) -> None:
        with self.lock:
            self.last = {"kind": "onboard.progress", **self.base, "step": step, "done": done, "total": total}
            self.progress(self.last)

    def _beat(self) -> None:
        while not self.stop.wait(launcher.HEARTBEAT_S):
            try:
                with self.lock:
                    self.progress(self.last)
            except launcher.StdoutClosed:              # the main thread's next line says so too
                return


def _status(doc: dict | None) -> tuple[str, int, int] | None:
    if not doc or doc.get("step") not in STEPS:
        return None
    counts = [doc.get(k) for k in ("done", "total")]
    if not all(isinstance(v, int) and not isinstance(v, bool) and 0 <= v < COUNT for v in counts):
        return None
    return doc["step"], counts[0], counts[1]


def _watch(proc: launcher.Process, status: Path | None, said: Said, stall_s: float, cancel: threading.Event) -> int:
    """Until the tool exits (its code); a cancel or a stall stops its group and is Failed."""
    last_raw, changed = None, time.monotonic()
    seen = tuple(said.last[k] for k in ("step", "done", "total")) if said.last else None   # never said twice
    while (rc := proc.poll()) is None:
        if cancel.is_set():
            proc.stop()
            raise Failed("worker.cancelled", "the onboarding was cancelled")
        if status is not None:
            raw, doc = launcher._read(status)
            if raw != last_raw:
                last_raw, changed = raw, time.monotonic()
                if (now := _status(doc)) and now != seen:
                    said.say(*now)
                    seen = now
        if time.monotonic() - changed >= stall_s:
            proc.stop()
            raise Failed("worker.stalled", f"the onboarding tool was stopped: it did nothing for {stall_s:.0f} seconds")
        cancel.wait(launcher.POLL_S)
    return rc


def _file_sha256(path: Path) -> tuple[str, int]:
    digest, size = hashlib.sha256(), 0
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def run(storage: Storage, args: dict, settings: Settings, icc_sha256: str, progress: Callable[[dict], None],
        cancel: threading.Event) -> dict:
    """→ onboard.ready or onboard.rejected; Failed (worker.…) when it cannot finish."""
    args = check_args(args)
    guard = KeyGuard(args["org_id"], args["pub_id"])
    onboarding = uuid(args["onboarding_id"], "onboarding_id")
    base = {"org_id": guard.org_id, "pub_id": guard.pub_id, "onboarding_id": onboarding, "sha256": args["sha256"]}
    files = inputs(storage, guard, onboarding, args)
    profile_sha256(icc_sha256)                               # the colour profile the tool reads is the worker's own
    work = home._folder(engine.home_of(settings.engine, guard), "onboarding", onboarding)
    home._empty(work)                                        # an earlier attempt's files
    said = Said(progress, base)
    said.say("checking", 0, len(files))
    said.ticker.start()
    try:
        return _run(storage, guard, onboarding, base, files, settings, work, said, cancel)
    finally:
        said.stop.set()
        said.ticker.join()
        shutil.rmtree(work, ignore_errors=True)


def _run(storage: Storage, guard: KeyGuard, onboarding: str, base: dict, files: list[dict], settings: Settings,
         work: Path, said: Said, cancel: threading.Event) -> dict:
    pdfs = home._folder(work, "pdfs")
    listed = []
    for f in sorted(files, key=lambda f: f["n"]):
        if cancel.is_set():
            raise Failed("worker.cancelled", "the onboarding was cancelled")
        path = pdfs / f"{f['n']:02d}.pdf"
        if storage.download(guard.onboarding_pdf(onboarding, f["n"]), f["version_id"], path, MAX_PDF_BYTES) \
                != f["sha256"]:
            raise Mismatch("a stored PDF is not the one the onboarding's inputs file names")
        listed.append({"n": f["n"], "name": f["name"], "path": str(path)})
    util.write_json(work / "files.json", {"files": listed})
    env = {k: os.environ[k] for k in engine.ENV_KEPT if k in os.environ}
    env = {**env, "HOME": str(work), "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8"}
    tool = [str(settings.python), str(settings.script)]
    out, log, status = work / "dataset", work / "onboard.log", work / "status.json"

    def step(argv: list[str], watched: Path | None) -> dict | None:
        try:
            proc = launcher.Process(tool + argv, env, log, work / "onboard.pid")
        except OSError as e:
            raise Failed("worker.onboard", f"the onboarding tool could not be started ({type(e).__name__})") from None
        try:
            rc = _watch(proc, watched, said, settings.engine.stall_s, cancel)
        finally:
            if proc.proc.poll() is None:
                proc.stop()
        if rc != 0:
            raise Failed("worker.onboard", f"the onboarding tool stopped (exit {rc})")
        answer = util.last_json_object(runs._read_tail(log, MAX_RESULT))
        log.unlink(missing_ok=True)                           # the next step's answer is its own
        return answer

    built = step(["build", "--files", str(work / "files.json"), "--out", str(out), "--status", str(status),
                  "--icc", str(images.icc_path()), "--engine-python", str(settings.engine.python)], status) or {}
    checks = built.get("files")
    if not isinstance(checks, list):
        raise Failed("worker.onboard", "the onboarding tool gave no outcome")
    if built.get("outcome") == "rejected" and built.get("code") in REJECT_CODES:
        params, message = built.get("params"), built.get("message")
        return {"kind": "onboard.rejected", **base, "code": built["code"],
                "params": params if isinstance(params, dict) else None, "files": checks,
                "message": message.strip()[:2000] if isinstance(message, str) and message.strip()
                else "The onboarding tool gave no reason."}
    if built.get("outcome") != "ready" or not isinstance(built.get("report"), dict):
        raise Failed("worker.onboard", "the onboarding tool gave no outcome")
    said.say("packing", 0, 1)
    bundle = work / "dataset.zip"
    step(["pack", "--dataset", str(out), "--zip", str(bundle)], None)
    if not bundle.is_file() or bundle.is_symlink():
        raise Failed("worker.onboard", "the onboarding tool made no bundle")
    sha256, size = _file_sha256(bundle)
    key = guard.onboarding_dataset(onboarding)
    version = storage.upload(key, bundle, sha256, "application/zip")
    said.say("packing", 1, 1)
    return {"kind": "onboard.ready", **base, "files": checks, "report": built["report"],
            "dataset": {"key": key, "version_id": version, "sha256": sha256, "bytes": size}}
