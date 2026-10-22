"""`params_hash` (plan §6.3): what makes a rendition's bytes, so a change of any of it makes new renditions and a run's
request names the exact ones. It covers:
- the colour profile's bytes, hashed from the very file `images.icc_path()` loads (never a hash the caller says);
- the Desk's photo code (`images.py`, by its file's SHA-256: it has no version number) and the worker's own rendition
  code (`media.py`: the thumbnail);
- the pinned environment (the worker's lock) and what is really loaded: Pillow's version, littleCMS's and
  libjpeg-turbo's, and the processor (`platform.machine()`: the same code can round differently elsewhere);
- the size limits."""
from __future__ import annotations

import hashlib
import json
import platform
from pathlib import Path

import PIL
from PIL import features

from .desk import DESK, images

WORKER = Path(__file__).resolve().parents[1]
LOCK = WORKER / "requirements.lock"
MEDIA = Path(__file__).resolve().with_name("media.py")
THUMB_MAX_PX = 400            # long side of the thumbnail JPEG (the media grid)


class ProfileError(RuntimeError):
    """The colour profile cannot be read, or is not the one the worker was given: the job fails, nothing is written."""


def file_sha256(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def profile_sha256(expected: str | None = None) -> str:
    """The SHA-256 of the profile file `images.icc_path()` names; with `expected`, it must be that one."""
    try:
        got = file_sha256(images.icc_path())
    except OSError:
        raise ProfileError("the colour profile cannot be read") from None
    if expected is not None and got != expected:
        raise ProfileError("the colour profile is not the one this worker was given (its SHA-256 differs)")
    return got


def runtime() -> dict:
    """What is loaded now, beside what the lock pins."""
    return {"pillow": PIL.__version__, "littlecms2": features.version("littlecms2"),
            "libjpeg_turbo": features.version("libjpeg_turbo"), "machine": platform.machine()}


def params_hash(expected_icc_sha256: str | None = None, lock: Path = LOCK) -> str:
    """32 hex characters of the SHA-256 of everything above (the profile checked against `expected_icc_sha256`)."""
    parts = {"icc": profile_sha256(expected_icc_sha256), "images_py": file_sha256(DESK / "deskserver" / "images.py"),
             "media_py": file_sha256(MEDIA), "lock": file_sha256(lock), "runtime": runtime(),
             "photo_max_px": images.PHOTO_MAX_PX, "preview_max_px": images.PREVIEW_MAX_PX,
             "preview_quality": images.PREVIEW_QUALITY, "thumb_max_px": THUMB_MAX_PX}
    return hashlib.sha256(json.dumps(parts, sort_keys=True).encode("utf-8")).hexdigest()[:32]
