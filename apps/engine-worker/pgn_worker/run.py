"""The job runner as a command, for a queue outside Python (Graphile Worker spawns it) or by hand:

    python -B -m pgn_worker.run [--job FILE] < job.json        → one JSON result line on stdout

Settings from the environment: `PGN_S3_*` (the store, pgn_worker/storage_s3.py) and `PGN_ICC_SHA256` (the colour
profile the worker was given; `PAGEINATOR_ICC` names its file). Exit codes (sysexits):
  0   done: the result holds the event (`media.ready`, or `media.rejected` for a photo the Desk refuses)
  65  failed: the job is wrong (its shape, a key, the checksum, a missing version): do not run it again
  70  failed: a fault in the worker (its type only)
  74  the result could not be written (stdout closed): no line; the queue runs the job again
  75  retry: the colour profile could not be read, the store failed, or the worker ran out of memory (worker.memory):
      run the job again later
  78  failed: the worker's own settings are missing or not valid, or its colour profile is not the one it was given
      (worker.config): an operator fixes the worker; the job is not run again as it is
Nothing but the result line is written to stdout (UTF-8), and nothing to stderr: warnings and log records are
silenced (Pillow's decompression-bomb and damaged-EXIF warnings among them); no credential or endpoint is in either.
A death by a signal (the kernel's out-of-memory killer) writes no line: the queue treats it as a retry."""
from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import warnings
from pathlib import Path
from typing import Any, BinaryIO, Callable

from . import jobs
from .keys import KeyGuard
from .storage import Storage
from .storage_s3 import S3Settings, S3Storage, SettingsError

MAX_JOB = 64 * 1024
EXIT = {"done": 0, "worker.job": 65, "worker.key": 65, "worker.checksum": 65, "worker.missing": 65,
        "worker.internal": 70, "worker.profile": 75, "worker.store": 75, "worker.memory": 75, "worker.config": 78}


def _read(stream) -> bytes:
    data = stream.read(MAX_JOB + 1)
    return data if isinstance(data, bytes) else data.encode("utf-8")


def _job(raw: bytes) -> Any:
    if len(raw) > MAX_JOB:
        raise jobs.JobRefused(f"a job is at most {MAX_JOB} bytes")
    try:
        return json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError):
        raise jobs.JobRefused("a job is one JSON object in UTF-8") from None


def _settings(environ: dict[str, str]) -> tuple[Callable[[KeyGuard], Storage], str]:
    """The store for each job and the profile's hash, from the environment (ConfigError when not usable)."""
    icc = environ.get("PGN_ICC_SHA256", "")
    if not re.fullmatch(r"[0-9a-f]{64}", icc):
        raise jobs.ConfigError("PGN_ICC_SHA256 is not set to the colour profile's SHA-256")
    try:
        settings = S3Settings.from_env(environ)
    except SettingsError as e:
        raise jobs.ConfigError(str(e)) from None
    client = settings.client()
    return (lambda guard: S3Storage(client, settings.work_bucket, guard)), icc


# the one line written when even the result cannot be made (a fault outside every handler): fixed, nothing from the job
LAST_RESORT = (json.dumps({"format": jobs.RESULT_FORMAT, "job": None, "kind": None, "outcome": jobs.FAILED,
                           "error": {"code": "worker.internal", "message": "the worker failed"}}) + "\n").encode()


def quiet() -> None:
    """Nothing reaches stderr: no warning (Pillow's DecompressionBombWarning, damaged EXIF, a malformed MPO) and no log
    record (no last-resort handler; a root handler that drops them, so no "no handlers" notice either)."""
    warnings.simplefilter("ignore")
    logging.lastResort = None
    root = logging.getLogger()
    if not any(isinstance(h, logging.NullHandler) for h in root.handlers):
        root.addHandler(logging.NullHandler())


def main(argv: list[str] | None = None, stdin: Any = None, stdout: BinaryIO | None = None,
         environ: dict[str, str] | None = None,
         setup: Callable[[dict[str, str]], tuple[Callable[[KeyGuard], Storage], str]] = _settings) -> int:
    parser = argparse.ArgumentParser(prog="python -m pgn_worker.run", description=__doc__.split("\n\n")[0])
    parser.add_argument("--job", help="read the job from this file instead of stdin")
    args = parser.parse_args(argv)
    quiet()
    stdout = sys.stdout.buffer if stdout is None else stdout
    try:
        line = _answer(args, stdin, environ, setup)
    except Exception:  # noqa: BLE001 — a fault outside every handler: the fixed line
        line = LAST_RESORT
    try:
        stdout.write(line)
        stdout.flush()
    except BrokenPipeError:                                  # the queue went away: no line, it runs the job again
        if stdout is sys.stdout.buffer:                      # so the exit's own flush does not fail on stderr
            os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        return 74
    out = json.loads(line)
    return EXIT[out["error"]["code"]] if "error" in out else EXIT["done"]


def _answer(args: argparse.Namespace, stdin: Any, environ: dict[str, str] | None,
            setup: Callable[[dict[str, str]], tuple[Callable[[KeyGuard], Storage], str]]) -> bytes:
    environ = dict(os.environ if environ is None else environ)
    job: Any = None
    try:
        if args.job:
            with Path(args.job).open("rb") as f:
                job = _job(_read(f))
        else:
            job = _job(_read(sys.stdin.buffer if stdin is None else stdin))
        storage_for, icc = setup(environ)
        out = jobs.run(job, storage_for, icc)
    except jobs.JobRefused as e:
        out = jobs.result(job, jobs.FAILED, code="worker.job", message=str(e))
    except OSError:
        out = jobs.result(job, jobs.FAILED, code="worker.job", message="the job file cannot be read")
    except jobs.ConfigError as e:
        out = jobs.result(job, jobs.FAILED, code="worker.config", message=str(e))
    except Exception as e:  # noqa: BLE001 — a fault while setting up: its type only
        out = jobs.result(job, jobs.FAILED, code="worker.internal", message=f"the worker failed ({type(e).__name__})")
    return (json.dumps(out, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


if __name__ == "__main__":
    sys.exit(main())
