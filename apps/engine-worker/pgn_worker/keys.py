"""The key guard (plan §2.2, test (e)): every storage key a job touches is under its own organisation and publication,
`orgs/<org>/pubs/<pub>/`, made from ids only. A job for organisation A can name no key of organisation B."""
from __future__ import annotations

import re

# the database's ids: uuidv7 (version 7, the RFC 9562 variant), written as PostgreSQL writes a uuid (lowercase)
UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", re.ASCII)
# an organisation's id is Better Auth's (gen_random_uuid(), version 4): any RFC 9562 version, lowercase
ORG_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", re.ASCII)
MM = r"(?:[1-9][0-9]{0,3}|0)(?:\.[0-9]{1,2})?"                           # a millimetre size as job text (media.ad)
# a photo's CMYK rendition, or an ad's (media.ad: fitted into its slot, the slot's size in its name)
CMYK_RASTER = re.compile(rf"assets/(?P<asset>[^/]+)/r/(?:cmyk-[0-9a-f]{{32}}|ad-cmyk-[0-9a-f]{{32}}-{MM}x{MM}mm)\.cmyk\.gz",
                         re.ASCII)
SEGMENT = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", re.ASCII)      # one part of a key: no "/", "..", spaces or controls


class KeyRefused(ValueError):
    """A key outside the job's organisation and publication, or not made of plain parts: the job stops."""


def uuid(value: object, what: str, pattern: re.Pattern = UUID) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise KeyRefused(f"{what} is not an id")
    return value


class KeyGuard:
    """The keys of one organisation and publication."""

    def __init__(self, org_id: object, pub_id: object):
        self.org_id = uuid(org_id, "org_id", ORG_UUID)
        self.pub_id = uuid(pub_id, "pub_id")
        self.prefix = f"orgs/{self.org_id}/pubs/{self.pub_id}/"

    def key(self, *parts: str) -> str:
        """A key under the prefix, from plain parts (each checked)."""
        for part in parts:
            if not isinstance(part, str) or not SEGMENT.fullmatch(part) or part in (".", ".."):
                raise KeyRefused("a key part is not plain")         # never the part itself: it may be a name
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
        or an ad's, `assets/<uuid7>/r/ad-cmyk-<32 hex>-<w>x<h>mm.cmyk.gz` (never an upload, an original or another
        rendition)."""
        rest = self.check(key)[len(self.prefix):]
        m = CMYK_RASTER.fullmatch(rest)
        if not m or not UUID.fullmatch(m.group("asset")):
            raise KeyRefused("not a CMYK rendition's key")
        return self.check(key)

    def rendition(self, asset_id: str, purpose: str, params_hash: str, ext: str) -> str:
        """`assets/<asset>/r/<purpose>-<params_hash>.<ext>` (plan §6.1)."""
        return self.key("assets", uuid(asset_id, "asset_id"), "r", f"{purpose}-{params_hash}.{ext}")

    # L2.3: the engine's keys, each made from ids (and fixed names), never taken from a job's text

    def profile_dataset(self, profile_id: object) -> str:
        """The dataset bundle the API copied out of quarantine (engine.setup reads it)."""
        return self.key("profiles", uuid(profile_id, "profile_id"), "dataset.zip")

    def profile_config(self, profile_id: object) -> str:
        """The config the setup wrote (its local dataset path taken out)."""
        return self.key("profiles", uuid(profile_id, "profile_id"), "config.json")

    def edition_measure(self, edition_id: object) -> str:
        """The snapshot a measure works on (the API writes it)."""
        return self.key("editions", uuid(edition_id, "edition_id"), "measure.json")

    def run_request(self, run_id: object) -> str:
        """A run's frozen request (the API writes it; the worker never does)."""
        return self.key("runs", uuid(run_id, "run_id"), "request.json")

    def run_file(self, run_id: object, name: str, page: int | None = None) -> str:
        """A run's output: `runs/<run>/edition.pdf`, `press-files.zip`, or a page's `runs/<run>/pages/NN/<name>` (the
        layout's files, or a save's from the page editor: `edit-<rev>.pdf`, `.png`, `.thumb.png`, `.pdfx-check.txt`)."""
        if name not in (RUN_FILES if page is None else PAGE_FILES) and (page is None or not EDIT_FILE.fullmatch(name)):
            raise KeyRefused("not a file a run writes")
        if page is None:
            return self.key("runs", uuid(run_id, "run_id"), name)
        if not isinstance(page, int) or isinstance(page, bool) or not 1 <= page <= 16:
            raise KeyRefused("not a page of a run")
        return self.key("runs", uuid(run_id, "run_id"), "pages", f"{page:02d}", name)


RUN_FILES = ("edition.pdf", "press-files.zip")
PAGE_FILES = ("page.pdf", "preview.png", "thumb.png", "pdfx-check.txt")
EDIT_FILE = re.compile(r"edit-(?:0|[1-9][0-9]{0,9})\.(?:pdf|png|thumb\.png|pdfx-check\.txt)", re.ASCII)
