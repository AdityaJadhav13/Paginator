"""The key guard (plan §2.2, test (e)): every storage key a job touches is under its own organisation and publication,
`orgs/<org>/pubs/<pub>/`, made from ids only. A job for organisation A can name no key of organisation B."""
from __future__ import annotations

import re

# the database's ids: uuidv7 (version 7, the RFC 9562 variant), written as PostgreSQL writes a uuid (lowercase)
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", re.ASCII)
CMYK_RASTER = re.compile(r"assets/(?P<asset>[^/]+)/r/cmyk-[0-9a-f]{32}\.cmyk\.gz", re.ASCII)
SEGMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", re.ASCII)      # one part of a key: no "/", "..", spaces or controls


class KeyRefused(ValueError):
    """A key outside the job's organisation and publication, or not made of plain parts: the job stops."""


def uuid(value: object, what: str) -> str:
    if not isinstance(value, str) or not UUID.fullmatch(value):
        raise KeyRefused(f"{what} is not an id")
    return value


class KeyGuard:
    """The keys of one organisation and publication."""

    def __init__(self, org_id: object, pub_id: object):
        self.org_id = uuid(org_id, "org_id")
        self.pub_id = uuid(pub_id, "pub_id")
        self.prefix = f"orgs/{self.org_id}/pubs/{self.pub_id}/"

    def key(self, *parts: str) -> str:
        """A key under the prefix, from plain parts (each checked)."""
        for part in parts:
            if not isinstance(part, str) or not SEGMENT.fullmatch(part) or part in (".", ".."):
                raise KeyRefused(f"not a plain key part: {part!r}")
        return self.prefix + "/".join(parts)

    def check(self, key: object) -> str:
        """A key given to the job: it must be under the prefix and made of plain parts."""
        if not isinstance(key, str) or not key.startswith(self.prefix):
            raise KeyRefused("a key outside this job's organisation and publication")
        rest = key[len(self.prefix):].split("/")
        self.key(*rest)
        return key

    def asset_original(self, asset_id: object) -> str:
        """Where the API keeps an asset's original (the database computes the same: media migration)."""
        return self.key("assets", uuid(asset_id, "asset_id"), "original")

    def cmyk_raster(self, key: object) -> str:
        """A key the engine may read a placed picture from: only a CMYK rendition, `assets/<uuid7>/r/cmyk-<32 hex>.cmyk.gz`
        (never an upload, an original or another rendition)."""
        rest = self.check(key)[len(self.prefix):]
        m = CMYK_RASTER.fullmatch(rest)
        if not m or not UUID.fullmatch(m.group("asset")):
            raise KeyRefused("not a CMYK rendition's key")
        return self.check(key)

    def rendition(self, asset_id: str, purpose: str, params_hash: str, ext: str) -> str:
        """`assets/<asset>/r/<purpose>-<params_hash>.<ext>` (plan §6.1)."""
        return self.key("assets", uuid(asset_id, "asset_id"), "r", f"{purpose}-{params_hash}.{ext}")
