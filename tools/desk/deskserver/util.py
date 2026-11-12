"""Shared helpers: the error type, id patterns, text cleaning and private (0700/0600) atomic file writes."""
from __future__ import annotations

import contextlib
import json
import os
import re
import secrets
import unicodedata
from datetime import datetime
from pathlib import Path
from typing import Any, BinaryIO, Iterator

DIR_MODE = 0o700
FILE_MODE = 0o600

# CONTRACT.md §1: every id from a request is checked against its pattern before it touches the file system.
EDITION_ID = re.compile(r"\d{4}-\d{2}-\d{2}(?:-[1-9][0-9]{0,2})?")
ARTICLE_ID = re.compile(r"a-[0-9a-f]{10}")
PHOTO_ID = re.compile(r"p-[0-9a-f]{10}")
RUN_ID = re.compile(r"r-\d{8}-\d{6}")
SLOT_ID = re.compile(r"[a-z0-9-]{1,40}")

# C0 control characters other than tab and newline (carriage returns are turned into newlines first).
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class DeskError(Exception):
    """An error with an HTTP status and a plain-language message for the person at the desk."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


def path_id(pattern: re.Pattern[str], value: str, what: str) -> str:
    """An id taken from a URL path. A malformed id cannot name anything, so it is reported as not found."""
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise DeskError(404, f"There is no such {what}.")
    return value


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def new_id(prefix: str) -> str:
    return prefix + secrets.token_hex(5)


def clean_text(value: Any, field: str, limit: int) -> str:
    """Text as typed: NFC, CR/CRLF -> LF, control characters dropped, trailing spaces of each line trimmed and the
    surrounding blank space removed."""
    if value is None:
        return ""
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise DeskError(400, f"The {field} must be text.")
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL.sub("", unicodedata.normalize("NFC", text))
    text = "\n".join(line.rstrip() for line in text.split("\n")).strip()
    if len(text) > limit:
        raise DeskError(400, f"The {field} is too long ({len(text)} characters; the most is {limit}).")
    return text


# ---------------------------------------------------------------------------------------------------- files


def ensure_dir(path: Path) -> Path:
    """Create a directory (and missing parents) with mode 0700."""
    path = Path(path)
    if path.is_dir():
        return path
    ensure_dir(path.parent)
    try:
        path.mkdir(mode=DIR_MODE)
    except FileExistsError:
        if not path.is_dir():
            raise
    else:
        os.chmod(path, DIR_MODE)
    return path


@contextlib.contextmanager
def atomic_file(path: Path) -> Iterator[BinaryIO]:
    """Write a file atomically: a hidden temporary file (mode 0600) in the same folder, then os.replace."""
    path = Path(path)
    tmp = path.with_name(f".{path.name}.{secrets.token_hex(4)}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, FILE_MODE)
    try:
        with os.fdopen(fd, "wb") as f:
            yield f
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(tmp)
        raise


def write_bytes(path: Path, data: bytes) -> None:
    with atomic_file(path) as f:
        f.write(data)


def write_json(path: Path, obj: Any) -> None:
    write_bytes(path, (json.dumps(obj, ensure_ascii=False, indent=1) + "\n").encode("utf-8"))


_MISSING = object()


def read_json(path: Path, default: Any = _MISSING) -> Any:
    """Read a JSON file. A missing file gives `default` (or FileNotFoundError); a damaged one is a 500, never
    silently replaced (that would lose the newsroom's work)."""
    try:
        data = Path(path).read_bytes()
    except FileNotFoundError:
        if default is _MISSING:
            raise
        return default
    try:
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError, RecursionError) as e:   # RecursionError: nested beyond reason
        raise DeskError(500, f"The file {Path(path).name} is damaged and cannot be read.") from e


def remove_quietly(path: Path) -> None:
    with contextlib.suppress(FileNotFoundError):
        os.unlink(path)


def tail(text: str, lines: int = 6, chars: int = 600) -> str:
    """The last few non-empty lines of some output, for error messages."""
    kept = [ln.rstrip() for ln in text.strip().splitlines() if ln.strip()][-lines:]
    out = "\n".join(kept)
    return out[-chars:]


def last_json_object(text: str) -> dict | None:
    """The single JSON object printed on stdout (or, when stdout and stderr share a log, the last line that is one)."""
    text = text.strip()
    if not text:
        return None
    with contextlib.suppress(ValueError):
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    for line in reversed(text.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            with contextlib.suppress(ValueError):
                obj = json.loads(line)
                if isinstance(obj, dict):
                    return obj
    return None
