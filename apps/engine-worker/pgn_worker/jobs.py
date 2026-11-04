"""The worker's job runner, whatever queue drives it (l22-plan W6; D-8 is open): one job in, one result out.

    job    {"format": "pageinator.worker-job/1", "id": "<the queue's job id>", "kind": "media.ingest" | "docx.import",
            "args": {…}}
    result {"format": "pageinator.worker-result/1", "job": id, "kind": kind, "outcome": "done" | "retry" | "failed",
            "event": {…} (done), "error": {"code", "message"} (retry, failed)}

- **done**: the task ran to its answer, which is the event for the API's inbox: `media.ready`, or `media.rejected`
  (a photo the Desk refuses is a finished job, not a failure); for docx.import, `import.parsed` or `import.rejected`
  (pgn_worker/docx_import.py).
- **retry**: nothing was decided and the job may be run again as it is: the colour profile cannot be read or the
  conversion's environment failed (`worker.profile`), the store failed or could not be reached (`worker.store`), or it
  ran out of memory (`worker.memory`).
- **failed**: running it again cannot help: the job is not one this runner takes (`worker.job`), a key is outside its
  organisation and publication (`worker.key`), the original is not the one it names (`worker.checksum`), or that
  version is not in the store (`worker.missing`); the worker's own settings are missing or not valid, or its colour
  profile is not the one it was given (`worker.config`: an operator must fix the worker, the same job would fail the
  same way); or the worker has a fault (`worker.internal`, its exception's type only).

Every queue option drives it the same way: Procrastinate or a queue of our own call `run()` in-process; Graphile
Worker (Node) runs `python -m pgn_worker.run` with the job on stdin and reads the result from stdout and the exit
code (pgn_worker/run.py). Messages are at most 2000 characters and never carry a credential, an endpoint, a stored
text or the job's own values (only its ids, in keys made from them)."""
from __future__ import annotations

import re
from typing import Any, Callable

from . import docx_import, media
from .keys import KeyGuard, KeyRefused
from .params import ProfileError, ProfileMismatch
from .storage import MissingObject, Storage
from .storage_s3 import StorageError
from .desk import util

JOB_FORMAT = "pageinator.worker-job/1"
RESULT_FORMAT = "pageinator.worker-result/1"
JOB_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", re.ASCII)
KINDS = {"media.ingest": media.ARGS, "docx.import": docx_import.ARGS}
CHECKS = {"media.ingest": media.check_args, "docx.import": docx_import.check_args}
RETRY, FAILED, DONE = "retry", "failed", "done"
MAX_MESSAGE = 2000


class JobRefused(ValueError):
    """A job that is not one this runner takes (its shape, its kind or its arguments)."""


class ConfigError(RuntimeError):
    """The worker's own settings are missing or not valid (never the job's fault)."""


def check(job: Any) -> dict:
    """The job, checked against the schema: exactly format, id, kind and args; a kind this runner knows; exactly that
    kind's arguments, as text (the task checks each one's form)."""
    if not isinstance(job, dict) or set(job) != {"format", "id", "kind", "args"}:
        raise JobRefused("a job has exactly format, id, kind and args")
    if job["format"] != JOB_FORMAT:
        raise JobRefused(f"a job's format must be {JOB_FORMAT}")
    if not isinstance(job["id"], str) or not JOB_ID.fullmatch(job["id"]):
        raise JobRefused("a job's id must be 1 to 128 letters, digits or . _ : -")
    if not isinstance(job["kind"], str) or job["kind"] not in KINDS:
        raise JobRefused("a kind this runner does not take")
    args = job["args"]
    if not isinstance(args, dict) or set(args) != set(KINDS[job["kind"]]):
        raise JobRefused(f"{job['kind']} takes exactly {', '.join(KINDS[job['kind']])}")
    if not all(isinstance(v, str) and 0 < len(v) <= 1024 and _utf8(v) for v in args.values()):
        raise JobRefused(f"{job['kind']}'s arguments are text")
    try:
        CHECKS[job["kind"]](args)
    except ValueError as e:
        raise JobRefused(str(e)) from None
    return job


def _utf8(text: str) -> bool:
    try:
        text.encode("utf-8")                                   # a lone surrogate is not text
        return True
    except UnicodeEncodeError:
        return False


def result(job: Any, outcome: str, event: dict | None = None, code: str | None = None, message: str = "") -> dict:
    out = {"format": RESULT_FORMAT, "job": job.get("id") if isinstance(job, dict) and isinstance(job.get("id"), str)
           and JOB_ID.fullmatch(job["id"]) else None,
           "kind": job["kind"] if isinstance(job, dict) and isinstance(job.get("kind"), str) and job["kind"] in KINDS
           else None, "outcome": outcome}
    if event is not None:
        out["event"] = event
    if code is not None:
        out["error"] = {"code": code, "message": message[:MAX_MESSAGE]}
    return out


def run(job: Any, storage_for: Callable[[KeyGuard], Storage], icc_sha256: str) -> dict:
    """One job → its result (never raises an Exception). `storage_for(guard)` gives the job's store view (S3Storage in production),
    `icc_sha256` is the colour profile the worker was given."""
    try:
        job = check(job)
        guard = KeyGuard(job["args"]["org_id"], job["args"]["pub_id"])
        if job["kind"] == "docx.import":
            event = docx_import.read(storage_for(guard), job["args"])
        else:
            event = media.ingest(storage_for(guard), job["args"], icc_sha256)
        return result(job, DONE, event=event)
    except JobRefused as e:
        return result(job, FAILED, code="worker.job", message=str(e))
    except KeyRefused as e:
        return result(job, FAILED, code="worker.key", message=str(e))
    except media.Mismatch as e:
        return result(job, FAILED, code="worker.checksum", message=str(e))
    except MissingObject:
        return result(job, FAILED, code="worker.missing", message="the original's version is not in the store")
    except ProfileMismatch as e:                              # the worker's settings, not the job: an operator fixes it
        return result(job, FAILED, code="worker.config", message=str(e))
    except ProfileError as e:
        return result(job, RETRY, code="worker.profile", message=str(e))
    except ConfigError as e:
        return result(job, FAILED, code="worker.config", message=str(e))
    except MemoryError:
        return result(job, RETRY, code="worker.memory", message="the worker ran out of memory")
    except util.DeskError:                                   # the Desk's 500s: the conversion's environment (its
        return result(job, RETRY, code="worker.profile",     # words may name the profile's file: not repeated)
                      message="the colour conversion could not run")
    except StorageError as e:
        return result(job, RETRY, code="worker.store", message=str(e))
    except Exception as e:  # noqa: BLE001 — a fault (another ValueError too): its type only, never its text
        return result(job, FAILED, code="worker.internal", message=f"the worker failed ({type(e).__name__})")
