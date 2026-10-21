"""Font instances kept on disk, so a new engine process does not build them again.

The oracle's font registry makes a static instance of a variable font with fontTools' instancer the first time a
process needs it: about 1.4 s each, and a page needs about 18, so the first page an editor opens took about 25 s and
every layout worker paid the same at its start. The bytes depend only on the font file, the pinned axis values and
the fontTools version (the oracle saves them without a timestamp so that they do), so the Desk keeps each instance in
<home>/cache/instances, named by the hash of exactly those inputs, and reads it back: the same bytes, at once. The
oracle itself is not changed; its registry's instancing step is wrapped at run time, as deskworker wraps prepare."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

import fontTools

import deskgen  # noqa: F401 — puts the oracle and the experiments on the import path
from paginator.typeset import fonts as F  # noqa: E402

VERSION = "desk-instances/1"
FONT_MAGIC = (b"\x00\x01\x00\x00", b"OTTO", b"true")      # TrueType, CFF OpenType, Apple TrueType


def instance_key(file_sha: str, pinned: dict) -> str:
    blob = json.dumps([VERSION, fontTools.version, file_sha, sorted((str(k), float(v)) for k, v in pinned.items())])
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


def install(cache_dir: Path) -> None:
    """Wrap the registry's instancing with the disk cache in cache_dir (once per process)."""
    real = F.FontRegistry._instance_bytes
    if getattr(real, "desk_cache", None) is not None:
        return
    cache_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

    def instance_bytes(candidate, pinned):
        if not pinned:
            return real(candidate, pinned)                       # the font file itself
        path = cache_dir / f"{instance_key(candidate.file_sha, dict(pinned))}.ttf"
        try:
            data = path.read_bytes()
            if len(data) > 1024 and data[:4] in FONT_MAGIC:      # a font file, not an empty or damaged one
                return data
        except OSError:
            pass
        data = real(candidate, pinned)
        tmp = path.with_suffix(f".{os.getpid()}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, path)                                    # complete or absent, never half written
        return data

    instance_bytes.desk_cache = cache_dir
    instance_bytes.__wrapped__ = real
    F.FontRegistry._instance_bytes = staticmethod(instance_bytes)


def worker_init(instances: str, ds: str, cal) -> None:
    """A layout worker's start: the font-instance cache, then deskworker's own start."""
    install(Path(instances))
    import deskworker
    deskworker.init(ds, cal)
