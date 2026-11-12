"""The worker's health (the image's HEALTHCHECK, W4): healthy when
- the task core and the store adapter import;
- the homes folder is a folder (not a link), owned by the user the worker runs as, mode 0700, and writable;
- `PGN_ICC_SHA256` is set and the colour profile mounted at run time (`PAGEINATOR_ICC`) is exactly that one.
Exit 0 when healthy; else 1, with the reasons. It never prints a setting's value or a secret, and changes nothing.

    python -B -m pgn_worker.health"""
from __future__ import annotations

import os
import re
import stat
import sys
import tempfile
from pathlib import Path

HOMES = "/var/lib/pageinator/homes"
PROFILE = "/run/pageinator/newsprint.icc"


def problems(env: dict[str, str] | None = None) -> list[str]:
    env = dict(os.environ if env is None else env)
    try:
        from . import home, media, storage_s3  # noqa: F401  (the task core and the store adapter import)
        from .params import ProfileError, profile_sha256
    except Exception as e:  # noqa: BLE001 — any import failure is the answer
        return [f"the task core does not import ({type(e).__name__})"]
    out: list[str] = []
    homes = Path(env.get("PGN_WORKER_HOMES", HOMES))
    try:
        st = os.lstat(homes)
        if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode):
            out.append("the homes folder is a link or not a folder")
        elif st.st_uid != os.geteuid() or stat.S_IMODE(st.st_mode) != 0o700:
            out.append("the homes folder is not the worker's own, mode 0700")
        else:
            with tempfile.NamedTemporaryFile(dir=homes):
                pass
    except OSError:
        out.append("the homes folder is missing or cannot be written")
    expected = env.get("PGN_ICC_SHA256", "")
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        out.append("PGN_ICC_SHA256 is not set to the colour profile's SHA-256")
    else:
        try:
            profile_sha256(expected, Path(env.get("PAGEINATOR_ICC", PROFILE)))
        except ProfileError as e:
            out.append(str(e))
    return out


def main() -> int:
    found = problems()
    for p in found:
        print(f"unhealthy: {p}", file=sys.stderr)
    if not found:
        print("healthy")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main())
