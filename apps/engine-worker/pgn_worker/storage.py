"""What a task needs of object storage: read one version of a key, write a key. The S3 adapter comes with the queue
(W3); `FolderStorage` keeps keys as files under a folder, for tests and local runs."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Protocol

from .desk import util


class MissingObject(LookupError):
    """No such key, or not that version of it."""


class Storage(Protocol):
    def get(self, key: str, version_id: str) -> bytes: ...

    def put(self, key: str, data: bytes, content_type: str) -> str:
        """Writes the key; → the new version's id."""
        ...

    def download(self, key: str, version_id: str, dest: Path, max_bytes: int) -> str:
        """Streams one version of a key to the file dest (made 0600; never held in memory: a dataset bundle is up to
        4 GiB), refused when larger than max_bytes; → the SHA-256 of the bytes written."""
        ...


class FolderStorage:
    """Keys as files under root (0700 folders, 0600 files), each with one version: the SHA-256 of its bytes."""

    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root.resolve() not in path.parents:
            raise MissingObject(key)
        return path

    def get(self, key: str, version_id: str) -> bytes:
        try:
            data = self._path(key).read_bytes()
        except (FileNotFoundError, IsADirectoryError):
            raise MissingObject(key) from None
        if hashlib.sha256(data).hexdigest() != version_id:
            raise MissingObject(f"{key} (version {version_id})")
        return data

    def download(self, key: str, version_id: str, dest: Path, max_bytes: int) -> str:
        try:
            src = self._path(key).open("rb")
        except (FileNotFoundError, IsADirectoryError):
            raise MissingObject(key) from None
        digest, size = hashlib.sha256(), 0
        with src, util.atomic_file(dest) as out:
            while chunk := src.read(1024 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise ValueError(f"{key} is larger than the worker reads")
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != version_id:                  # a version is its bytes' SHA-256 here
            Path(dest).unlink()
            raise MissingObject(f"{key} (version {version_id})")
        return digest.hexdigest()

    def put(self, key: str, data: bytes, content_type: str) -> str:
        path = self._path(key)
        util.ensure_dir(path.parent)
        util.write_bytes(path, data)
        util.write_bytes(path.with_name(path.name + ".meta.json"),
                         json.dumps({"content_type": content_type}).encode("utf-8"))
        return hashlib.sha256(data).hexdigest()
