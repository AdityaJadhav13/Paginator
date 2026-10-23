"""The engine worker image's files, checked (W4; fail closed). Reads the image as `docker export` writes it (a tar on
stdin) and refuses:
- under /opt/pageinator (the venv aside): any file that is not a file of the repository with exactly the bytes of its
  blob in git's index (in CI, the commit), and any such file of what the image takes that is missing; links there;
- any font, by its name or by its content (TrueType, OpenType, collections, WOFF, WOFF2), but the repository's 22 OFL
  stand-ins at their repository paths, and any colour profile, by its name or by its content (`acsp` at byte 36): a
  profile or a font renamed `house.bin` is still found;
- anything that looks private or like the dataset (PageinatorPrivate, published1, datasets/, .env, .git, node_modules).

    git add …   # the index must hold what the image was built from (CI: the commit)
    docker export "$(docker create IMAGE)" | python3 -B infra/docker/check_image_files.py"""
from __future__ import annotations

import hashlib
import re
import subprocess
import sys
import tarfile
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
FONT_DIRS = ("experiments/phase0/compose2/fonts", "tools/oracle/v0/assets/fonts")
TAKEN = ("tools/desk/deskserver/", "tools/desk/engine/", "apps/engine-worker/pgn_worker/", *(d + "/" for d in FONT_DIRS))
TAKEN_FILES = ("apps/engine-worker/requirements.lock",)
ROOT = "opt/pageinator/"
VENV = ROOT + "venv/"
FONT = re.compile(r"\.(ttf|otf|ttc|woff2?|pfb|pfa|dfont)$", re.IGNORECASE)
PROFILE = re.compile(r"\.(icc|icm)$", re.IGNORECASE)
PRIVATE = re.compile(r"PageinatorPrivate|published1|(^|/)datasets?/|(^|/)\.env|(^|/)\.git(/|$)|node_modules",
                     re.IGNORECASE)
FONT_MAGIC = (b"\x00\x01\x00\x00", b"OTTO", b"ttcf", b"wOFF", b"wOF2")
EXCLUDED = re.compile(r"(^|/)(__pycache__/|[^/]*\.pyc$|\.DS_Store$)")      # what the build's ignore file leaves out


@dataclass
class Entry:
    name: str                  # without a leading "./" or "/"
    kind: str                  # "file", "dir", "link" or "other"
    head: bytes = b""          # a file's first 64 bytes
    sha256: str | None = None  # a file's SHA-256, for the files under /opt/pageinator


def tracked(repo: Path = REPO) -> dict[str, str]:
    """The SHA-256 of every file of the repository the image takes, from git's index (staged or committed)."""
    listed = subprocess.run(["git", "-C", str(repo), "ls-files", "-s", "-z"], check=True, capture_output=True).stdout
    blobs: dict[str, str] = {}
    for item in listed.split(b"\0"):
        if not item:
            continue
        meta, path = item.split(b"\t", 1)
        name = path.decode("utf-8")
        if (name.startswith(TAKEN) or name in TAKEN_FILES) and not EXCLUDED.search(name):
            blobs[name] = meta.split()[1].decode("ascii")
    batch = subprocess.run(["git", "-C", str(repo), "cat-file", "--batch"], input="\n".join(blobs.values()).encode()
                           + b"\n", check=True, capture_output=True).stdout
    out, at = {}, 0
    for name, blob in blobs.items():
        eol = batch.index(b"\n", at)
        size = int(batch[at:eol].split()[2])
        out[name] = hashlib.sha256(batch[eol + 1:eol + 1 + size]).hexdigest()
        at = eol + 1 + size + 1
    return out


def entries(tar: tarfile.TarFile) -> list[Entry]:
    out = []
    for m in tar:
        name = m.name.removeprefix("./").lstrip("/")
        if m.isfile():
            f = tar.extractfile(m)
            if name.startswith(ROOT) and not name.startswith(VENV):
                data = f.read()
                out.append(Entry(name, "file", data[:64], hashlib.sha256(data).hexdigest()))
            else:
                out.append(Entry(name, "file", f.read(64)))
        else:
            out.append(Entry(name, "dir" if m.isdir() else "link" if m.issym() or m.islnk() else "other"))
    return out


def problems(found: list[Entry], repo_files: dict[str, str]) -> list[str]:
    fonts = {ROOT + p for p in repo_files if FONT.search(p)}
    out, seen = [], set()
    for e in found:
        n = e.name.rstrip("/")
        if FONT.search(n) and n not in fonts:
            out.append(f"a font that is not one of the repository's stand-ins: /{n}")
        if PROFILE.search(n):
            out.append(f"a colour profile built into the image: /{n}")
        if PRIVATE.search(n):
            out.append(f"a path that looks private or like the dataset: /{n}")
        if e.kind == "file":
            if e.head[36:40] == b"acsp":
                out.append(f"a colour profile (by its content) in the image: /{n}")
            if e.head[:4] in FONT_MAGIC and n not in fonts:
                out.append(f"a font (by its content) that is not one of the stand-ins: /{n}")
        if n.startswith(ROOT) and not n.startswith(VENV) and n + "/" != VENV:
            rel = n[len(ROOT):]
            if e.kind == "file":
                seen.add(rel)
                if rel not in repo_files:
                    out.append(f"not a file of the repository the image takes: /{n}")
                elif e.sha256 != repo_files[rel]:
                    out.append(f"not the repository's bytes: /{n}")
            elif e.kind != "dir":
                out.append(f"a link or special file where the repository's files are: /{n}")
    for rel in sorted(set(repo_files) - seen):
        out.append(f"a file of the repository the image takes is missing: /{ROOT}{rel}")
    if len(fonts) != 22:
        out.append(f"the repository has {len(fonts)} stand-in fonts, not 22: review the image's font list")
    return out


def main() -> int:
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|*") as tar:
        found = entries(tar)
    issues = problems(found, tracked())
    for p in issues:
        print(f"✗ {p}", file=sys.stderr)
    if issues:
        return 1
    print(f"✓ worker image: {len(found)} entries; under /opt/pageinator only the repository's files, byte for byte; "
          "the 22 stand-in fonts only; no colour profile; nothing private")
    return 0


if __name__ == "__main__":
    sys.exit(main())
