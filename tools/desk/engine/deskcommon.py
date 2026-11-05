"""Pageinator Desk engine: shared helpers (paths, ids, JSON files). Runs in the frozen oracle environment.

The Desk is an internal tool for the owner's own paper (tools/desk/CONTRACT.md). Its data lives outside the
repository, in PAGEINATOR_DESK_HOME (default ~/PageinatorPrivate/desk).
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
EXPERIMENTS = REPO / "experiments" / "phase0"
ENGINE_VERSION = "desk-engine/0.1.0"

EDITION_ID = re.compile(r"^\d{4}-\d{2}-\d{2}(-\d{1,3})?$")
ARTICLE_ID = re.compile(r"^a-[0-9a-f]{10}$")
PHOTO_ID = re.compile(r"^p-[0-9a-f]{10}$")
RUN_ID = re.compile(r"^r-\d{8}-\d{6}(-\d{1,3})?$")
SLOT_ID = re.compile(r"^[a-z0-9-]{1,40}$")


def desk_home(arg: str | None = None) -> Path:
    home = Path(arg or os.environ.get("PAGEINATOR_DESK_HOME") or Path.home() / "PageinatorPrivate" / "desk").expanduser()
    if REPO in home.resolve().parents or home.resolve() == REPO:
        raise SystemExit("the desk home must be outside the repository (private data)")
    return home


def check_id(pattern: re.Pattern, value: str, what: str) -> str:
    if not isinstance(value, str) or not pattern.match(value):
        raise ValueError(f"not a valid {what}: {value!r}")
    return value


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


class DamagedFile(ValueError):
    """A Desk file that cannot be read (its message is said to the user as it is)."""


def error_text(e: BaseException) -> str:
    """What the newsroom is told about a failure: a damaged file in plain words, anything else with its kind."""
    return str(e) if isinstance(e, DamagedFile) else f"{type(e).__name__}: {e}"


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        if default is not None:
            return default
        raise
    except (UnicodeDecodeError, ValueError, RecursionError) as e:     # RecursionError: nested beyond reason
        raise DamagedFile(f"the file {path.name} is damaged and cannot be read") from e


def write_json(path: Path, obj) -> None:
    """Atomic write (temp file + rename), private file mode."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass
        raise


def nfc(text: str | None) -> str:
    if not text:
        return ""
    t = unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))
    return "\n".join(line.rstrip() for line in t.split("\n")).strip()


def one_line(text: str | None) -> str:
    return " ".join(nfc(text).split())


def log(*parts) -> None:
    print(*parts, file=sys.stderr, flush=True)


# letters of a paper's script (paper.json "script"): Devanagari, or Latin with its accented letters
SCRIPT_RANGE = {"deva": ("ऀ", "ॿ"), "latn": ("A", "ɏ")}


def paper(ds: Path) -> dict | None:
    """The dataset's paper.json (tools/onboard writes it for a paper onboarded from its PDFs), checked; None when the
    dataset has none (the pilot's): every rule then stays the pilot's, unchanged."""
    f = ds / "paper.json"
    if not f.is_file():
        return None
    pj = read_json(f)
    sizes = pj.get("edition_sizes") if isinstance(pj, dict) else None
    imprint = pj.get("imprint_text") if isinstance(pj, dict) else None
    if (not isinstance(pj, dict) or pj.get("format") != "pageinator.paper/1" or pj.get("script") not in SCRIPT_RANGE
            or not isinstance(sizes or [], list) or not all(type(n) is int and 3 <= n <= 64 for n in sizes or [])
            or not isinstance(imprint or [], list) or not all(isinstance(t, str) for t in imprint or [])):
        raise DamagedFile("the file paper.json of this dataset is not a paper description the engine reads")
    return pj
