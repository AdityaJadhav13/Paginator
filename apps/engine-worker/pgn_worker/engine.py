"""The engine's kinds (plan §2.2, L2.3): `engine.setup` here, and what `engine.measure` and `engine.layout`
(pgn_worker/launcher.py) need first: the worker's engine settings, the publication's home, the profile's dataset and
config, and the Desk's words as the contract carries them (DeskText).

- **The engine** is the Desk's, unchanged: `<PGN_ENGINE_PYTHON> tools/desk/engine/desk_engine.py <command> --home <home>`
  from the repository's root, through the Desk's own `EngineClient` (setup and plan are one-shot calls). Its
  environment is the bare minimum (never the store's keys: the engine reads a paper's dataset, not the store).
- **The home** is `PGN_WORKER_HOMES/<org>/<pub>/` (pgn_worker/home.py's folders: no link on the way).
- **The dataset** is the profile's bundle, a ZIP pinned by version and SHA-256 (`profiles/<profile>/dataset.zip`),
  streamed to disk (never into memory: up to 4 GiB), its SHA-256 checked, and unpacked once per home into
  `datasets/<sha256>/` (a folder that exists is a whole one: it is renamed into place only once unpacked and checked).
  Refused, as `profile.rejected`, with the reason's code: not a ZIP the worker reads (`profile.not_zip`: damaged,
  encrypted, packed other than stored or deflated), over the limits (`profile.too_large`: the entry count and the
  central directory read from its end record first, as the Desk's bundle import does; the unpacked total; a file that
  unpacks to over 100 times its packed size), a link or a path outside its folder (`profile.unsafe_path`), or no page
  models in it (`profile.no_pages`). The engine's own refusal is `profile.setup`, in its words.
- **The config** is the one setup wrote (or the bundle's own `config.json`, the Desk's, kept as the Desk chose its
  templates), stored without its local dataset path (`profiles/<profile>/config.json`); each later job writes it into
  the home with `"dataset"` set to the local folder."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
import stat
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path

from . import home
from .desk import REPO, desk_text, engine_client, util, ziplimits
from .keys import KeyGuard, uuid
from .media import Mismatch
from .storage import Storage

from deskcommon import ENGINE_VERSION  # noqa: E402,I001  (the engine's folder is on the path: deskserver.messages)

PROFILE_FACTS = ("profile_id", "dataset_version_id", "dataset_sha256", "config_version_id", "config_sha256")
ARGS = {
    "engine.setup": ("org_id", "pub_id", "profile_id", "version_id", "sha256"),
    "engine.measure": ("org_id", "pub_id", "edition_id", "edition_key", "version_id", "sha256", *PROFILE_FACTS),
    "engine.layout": ("org_id", "pub_id", "run_id", "edition_key", "run_key", "version_id", "sha256", *PROFILE_FACTS),
}
SHA256 = re.compile(r"[0-9a-f]{64}", re.ASCII)
GIB = 1024 ** 3
MAX_DATASET_BYTES = 4 * GIB              # the contract's MAX_DATASET_BYTES: one presigned upload
MAX_UNPACKED = 16 * GIB                  # page models, template photos and masthead art, unpacked
MAX_FILES = 200_000
MAX_DIRECTORY = 64 * 1024 * 1024         # the central directory (200,000 entries need about 20 MB)
MAX_RATIO = 100                          # unpacked ÷ packed, for a file over 1 MB unpacked (as the Desk's bundles)
ZIP_TAIL = 2 ** 16 + ziplimits.EOCD_SIZE + ziplimits.LOCATOR64_SIZE + ziplimits.EOCD64_SIZE   # where its end records are
PLANS = ((4, True), (4, False), (8, True), (8, False), (16, True), (16, False))
HOUSE_PROFILE = REPO / "experiments" / "phase0" / "results" / "page1" / "house_profile.json"   # the engine reads it too
ENGINE_SCRIPT = REPO / "tools" / "desk" / "engine" / "desk_engine.py"
ENV_KEPT = ("PATH", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SOURCE_DATE_EPOCH")


class ConfigError(RuntimeError):
    """The worker's own settings are missing or not valid (never the job's fault)."""


class Refused(Exception):
    """A dataset bundle the worker does not take: `profile.rejected` with this code and message."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


# ------------------------------------------------------------------------------------------- settings


@dataclass(frozen=True)
class Settings:
    python: Path            # the engine env's Python (the frozen oracle lock)
    script: Path            # desk_engine.py (a test's fake engine through PAGEINATOR_DESK_ENGINE)
    homes: Path
    stall_s: float          # no change of engine-status.json for this long: the run is stopped

    @classmethod
    def from_env(cls, env: dict[str, str]) -> "Settings":
        python = Path(env.get("PGN_ENGINE_PYTHON", ""))
        if not python.is_absolute() or not python.is_file() or not os.access(python, os.X_OK):
            raise ConfigError("PGN_ENGINE_PYTHON is not set to the engine environment's Python")
        script = Path(env.get("PAGEINATOR_DESK_ENGINE") or ENGINE_SCRIPT)
        if not script.is_file():
            raise ConfigError("the layout engine's script is missing")
        try:
            stall = float(env.get("PGN_ENGINE_STALL_S", "600"))
        except ValueError:
            stall = 0.0
        if not 0 < stall <= 86_400:
            raise ConfigError("PGN_ENGINE_STALL_S must be a number of seconds, more than 0")
        return cls(python, script, Path(env.get("PGN_WORKER_HOMES", "/var/lib/pageinator/homes")), stall)


class Engine(engine_client.EngineClient):
    """The Desk's client, with an environment of its own: the engine never sees the worker's settings (the store's
    keys among them)."""

    def env(self) -> dict[str, str]:
        env = {k: os.environ[k] for k in ENV_KEPT if k in os.environ}
        return {**env, "HOME": str(self.home), "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8"}


def engine(settings: Settings, home_dir: Path) -> Engine:
    return Engine(REPO, home_dir, settings.python, settings.script)


def home_of(settings: Settings, guard: KeyGuard) -> Path:
    """The publication's home, its folders made 0700 (a link on the way is refused: home.BadRequest)."""
    return home._folder(util.ensure_dir(settings.homes), guard.org_id, guard.pub_id)


# ------------------------------------------------------------------------------------------- arguments


def check_args(kind: str, args: dict) -> dict:
    names = ARGS[kind]
    if not isinstance(args, dict) or set(args) != set(names):
        raise ValueError(f"{kind} takes exactly {', '.join(names)}")
    for key in names:
        if key.endswith("sha256") and not SHA256.fullmatch(args[key]):
            raise ValueError(f"{kind}: {key} is not 64 lowercase hex characters")
        if key.endswith("version_id") and not 0 < len(args[key]) <= 1024:
            raise ValueError(f"{kind}: {key} is not valid")
    if "edition_key" in args and not home.EDITION_ID.fullmatch(args["edition_key"]):
        raise ValueError(f"{kind}: edition_key is not a Desk edition id")
    if "run_key" in args and not home.RUN_ID.fullmatch(args["run_key"]):
        raise ValueError(f"{kind}: run_key is not a Desk run id")
    return args


# ------------------------------------------------------------------------------------------- the dataset


def _member(info: zipfile.ZipInfo) -> list[str]:
    """A member's path, as parts under the dataset folder; a link, or a path that leads outside, is refused."""
    name = info.filename
    if info.create_system == 3 and stat.S_ISLNK(info.external_attr >> 16):
        raise Refused("profile.unsafe_path", f"This dataset bundle holds a link ({name[:200]}): the file was refused.")
    parts = name.rstrip("/").split("/")
    if (not name or name.startswith("/") or "\\" in name or "\0" in name or ":" in parts[0]
            or any(p in ("", ".", "..") for p in parts)):
        raise Refused("profile.unsafe_path", f"This dataset bundle holds a path outside its folder ({name[:200]}): "
                                             "the file was refused.")
    return parts


def unpack(zip_path: Path, dest: Path) -> None:
    """The bundle into dest (an empty folder), after every check that needs no unpacking (Refused otherwise)."""
    not_zip = Refused("profile.not_zip", "This file is not a dataset bundle the Desk can read (a ZIP of the dataset "
                                         "folder, stored or deflated, not encrypted). Make the ZIP again.")
    too_large = Refused("profile.too_large", f"This dataset bundle holds more than the Desk takes (at most {MAX_FILES} "
                                             f"files, {MAX_UNPACKED // GIB} GB unpacked).")
    with open(zip_path, "rb") as f:
        f.seek(max(0, f.seek(0, os.SEEK_END) - ZIP_TAIL))
        listed = ziplimits.directory(f.read())        # before zipfile reads a central directory of any size
    if listed is None:
        raise not_zip
    if listed.entries > MAX_FILES or listed.size > MAX_DIRECTORY:
        raise too_large
    try:
        z = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, ValueError, NotImplementedError, OSError):
        raise not_zip from None
    with z:
        files, total, seen = [], 0, set()
        for info in z.infolist():
            parts = _member(info)
            if "/".join(parts) in seen:
                raise Refused("profile.unsafe_path", f"This dataset bundle lists {info.filename[:200]} twice: "
                                                     "the file was refused.")
            seen.add("/".join(parts))
            if info.flag_bits & 0x1 or info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                raise not_zip
            if info.file_size > 1024 * 1024 and info.file_size > MAX_RATIO * max(info.compress_size, 1):
                raise too_large
            total += info.file_size
            if total > MAX_UNPACKED:
                raise too_large
            files.append((info, parts))
        for info, parts in files:
            target = dest.joinpath(*parts)
            try:
                if info.is_dir():
                    home._folder(dest, *parts)
                    continue
                home._folder(dest, *parts[:-1])
                with z.open(info) as src, util.atomic_file(target) as out:
                    left = info.file_size + 1
                    while left > 0 and (chunk := src.read(min(left, 1024 * 1024))):
                        left -= len(chunk)
                        out.write(chunk)
                if left != 1:                             # longer or shorter than the ZIP says
                    raise not_zip
            except (home.BadRequest, FileExistsError, NotADirectoryError, IsADirectoryError):
                raise Refused("profile.unsafe_path", f"This dataset bundle holds {info.filename[:200]} where a "
                                                     "folder of the same name is: the file was refused.") from None
            except (zipfile.BadZipFile, EOFError, zlib.error):
                raise not_zip from None
    if not any((dest / "report" / "page1" / "pages").glob("*.json")):
        raise Refused("profile.no_pages", "This dataset bundle has no page models (report/page1/pages): it is not a "
                                          "dataset folder.")


def dataset(storage: Storage, guard: KeyGuard, home_dir: Path, profile_id: str, version_id: str, sha256: str) -> Path:
    """The profile's dataset, unpacked once in this home (datasets/<sha256>/): Refused, or Mismatch for other bytes."""
    folder = home._folder(home_dir, "datasets")
    done = folder / sha256
    if done.is_dir() and not done.is_symlink():
        return done
    part = folder / f".{sha256}.{secrets.token_hex(4)}.zip"
    tmp = folder / f".{sha256}.{secrets.token_hex(4)}.tmp"
    try:
        if storage.download(guard.profile_dataset(profile_id), version_id, part, MAX_DATASET_BYTES) != sha256:
            raise Mismatch("the stored dataset bundle is not the one this job names")
        os.mkdir(tmp, util.DIR_MODE)
        unpack(part, tmp)
        try:
            os.replace(tmp, done)                         # whole, or not there
        except OSError:
            if not done.is_dir():                         # else another worker on this volume unpacked it first
                raise
    finally:
        part.unlink(missing_ok=True)
        if tmp.exists():
            shutil.rmtree(tmp, ignore_errors=True)
    return done


def profile_config(storage: Storage, guard: KeyGuard, settings: Settings, args: dict) -> tuple[Path, dict]:
    """For a measure or a layout: the home, and the profile's config with `"dataset"` set to the local folder."""
    home_dir = home_of(settings, guard)
    try:
        ds = dataset(storage, guard, home_dir, args["profile_id"], args["dataset_version_id"], args["dataset_sha256"])
    except Refused:                                       # setup took these bytes: they cannot be refused now
        raise home.BadRequest("the profile's dataset is not one the worker takes") from None
    data = storage.get(guard.profile_config(args["profile_id"]), args["config_version_id"])
    if hashlib.sha256(data).hexdigest() != args["config_sha256"]:
        raise Mismatch("the stored config is not the one this job names")
    try:
        cfg = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        cfg = None
    if not isinstance(cfg, dict):
        raise home.BadRequest("the profile's config cannot be read")
    return home_dir, {**cfg, "dataset": str(ds)}


# ------------------------------------------------------------------------------------------- engine.setup


def _plan(pages: int, back: bool, got: dict) -> dict:
    """The engine's plan as the contract's (its fields named one by one)."""
    needs = got.get("needs") or {}
    counts = ("stories", "briefs", "photos", "words")
    return {"pages": pages, "back_page_ads": back,
            "page_plan": [{"page": p["page"], "role": p["role"], "template_role": p["template_role"],
                           "news_mm2": p["news_mm2"],
                           "ad_slots": [{k: s[k] for k in ("slot", "w_mm", "h_mm")} for s in p.get("ad_slots") or []]}
                          for p in got["pages"]],
            "needs": {**{k: int(needs.get(k, 0)) for k in counts},
                      "per_role": {r: {k: int(v.get(k, 0)) for k in counts}
                                   for r, v in (needs.get("per_role") or {}).items()},
                      "spare_share": float(needs.get("spare_share", 0))}}


def grid() -> dict:
    g = json.loads(HOUSE_PROFILE.read_text(encoding="utf-8"))["grid"]
    return {"columns": g["columns"], "column_width_mm": g["column_width_mm"], "gutter_mm": g["gutter_mm"]}


def setup(storage: Storage, args: dict, settings: Settings) -> dict:
    """→ `profile.ready` (the config stored, the six plans, the grid) or `profile.rejected` with the reason."""
    args = check_args("engine.setup", args)
    guard = KeyGuard(args["org_id"], args["pub_id"])
    profile = uuid(args["profile_id"], "profile_id")
    base = {"org_id": guard.org_id, "pub_id": guard.pub_id, "profile_id": profile, "sha256": args["sha256"]}
    home_dir = home_of(settings, guard)
    client = engine(settings, home_dir)
    try:
        ds = dataset(storage, guard, home_dir, profile, args["version_id"], args["sha256"])
        own = ds / "config.json"
        if own.is_file() and not own.is_symlink():        # the Desk's own choice of templates, kept
            try:
                cfg = json.loads(own.read_text(encoding="utf-8"))
            except (UnicodeDecodeError, ValueError):
                cfg = None
            if not isinstance(cfg, dict) or not isinstance(cfg.get("templates"), dict):
                raise Refused("profile.setup", "The config.json in this dataset bundle cannot be read.")
            util.write_json(home_dir / "config.json", {**cfg, "dataset": str(ds)})
        else:
            client.setup(str(ds))
        plans = [_plan(n, back, client.plan(n, back)) for n, back in PLANS]
    except Refused as e:
        return {"kind": "profile.rejected", **base, "code": e.code, "message": desk_text(e.message)}
    except engine_client.EngineError as e:                # the engine's own words (its setup or plan refused it)
        return {"kind": "profile.rejected", **base, "code": "profile.setup", "message": desk_text(e.message)}
    cfg = util.read_json(home_dir / "config.json")
    stored = {k: v for k, v in cfg.items() if k != "dataset"}
    body = (json.dumps(stored, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")
    key = guard.profile_config(profile)
    version = storage.put(key, body, "application/json")
    return {"kind": "profile.ready", **base,
            "config": {"key": key, "version_id": version, "sha256": hashlib.sha256(body).hexdigest(),
                       "bytes": len(body)},
            "engine_version": str(cfg.get("engine") or ENGINE_VERSION)[:200],
            "templates": {str(k)[:40]: str(v)[:400] for k, v in (cfg.get("templates") or {}).items()},
            "grid": grid(), "plans": plans}
