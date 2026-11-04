"""`media.ingest` (plan §2.2, §6.3): an uploaded photo's renditions, made by the Desk's own `images.convert_photo`,
unchanged: the RGB preview (at most 1600 px), the CMYK raster the engine places (at most 2000 px, newsprint profile),
and a thumbnail made from the preview. The original is read by its exact version and SHA-256 and never changed.

Renditions carry no metadata: no EXIF (so no GPS, L2-109), no XMP, no comment, no colour profile; the CMYK raster is
raw bytes. Sizes are after the EXIF orientation is applied (L2-123), as the Desk applies it.

What is refused is what the Desk refuses: junk *before* the picture is not a picture. Data *after* the picture (a JPEG
with a ZIP appended, a PNG with HTML after its end) is accepted, as the Desk accepts it: it stays in the original only and
never reaches a rendition, which is made from the decoded pixels (L2-120 stays open for the originals).

Keys are fixed by the asset and the params hash, so a job run again (after a crash) writes the same keys again and
never a second set."""
from __future__ import annotations

import hashlib
import io
import re

from PIL import Image

from .desk import desk_text, images, util
from . import keys
from .keys import KeyGuard, uuid
from .params import THUMB_MAX_PX, ProfileError, params_hash
from .storage import Storage

ARGS = ("org_id", "pub_id", "asset_id", "version_id", "sha256")     # ids only: the original's key is made from them
AD_ARGS = ("org_id", "pub_id", "artwork_id", "asset_id", "version_id", "sha256", "w_mm", "h_mm")
MAX_SIDE_PX = 100_000         # the contract's widest side (packages/contracts engine.ts Pixels): wider is refused
MIME = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}
SWAPS = (5, 6, 7, 8)          # EXIF orientations that turn the picture a quarter: width and height change places


class Mismatch(ValueError):
    """The stored original is not the one the job names (its SHA-256 differs): the job stops, nothing is written."""


def check_args(args: dict) -> dict:
    if not isinstance(args, dict) or set(args) != set(ARGS):
        raise ValueError(f"media.ingest takes exactly {', '.join(ARGS)}")
    for key in ("version_id", "sha256"):
        if not isinstance(args[key], str) or not args[key] or len(args[key]) > 1024:
            raise ValueError(f"media.ingest: {key} is not valid")
    if len(args["sha256"]) != 64 or any(c not in "0123456789abcdef" for c in args["sha256"]):
        raise ValueError("media.ingest: sha256 is not 64 lowercase hex characters")
    return args


def oriented_size(data: bytes) -> tuple[int, int]:
    """The original's width and height as it is seen: after its EXIF orientation (the Desk applies it too)."""
    with Image.open(io.BytesIO(data)) as img:
        w, h = img.size
        try:
            turn = img.getexif().get(0x0112)
        except Exception:  # noqa: BLE001 — damaged EXIF: the Desk keeps the picture as stored
            turn = None
    return (h, w) if turn in SWAPS else (w, h)


def thumbnail(preview: bytes) -> tuple[bytes, int, int]:
    """A small JPEG from the preview: no metadata, at most THUMB_MAX_PX on the long side."""
    with Image.open(io.BytesIO(preview)) as img:
        small = images.fit_long_side(img.convert("RGB"), THUMB_MAX_PX)
        buf = io.BytesIO()
        small.save(buf, "JPEG", quality=images.PREVIEW_QUALITY, comment=b"")      # no comment copied (as _jpeg)
        return buf.getvalue(), small.width, small.height


def _refusal(e: util.DeskError) -> dict:
    """The Desk's refusal, as it says it (its code too, where the Desk's message has one)."""
    wire = getattr(e.message, "wire", None)
    return {"code": wire.get("code") if isinstance(wire, dict) else None, "message": str(e.message), "status": e.status}


def ingest(storage: Storage, args: dict, icc_sha256: str) -> dict:
    """→ the event for the API: `media.ready` with the renditions, or `media.rejected` with the Desk's reason.
    `icc_sha256` is the profile the worker was given: the file `images.icc_path()` loads must be exactly that one,
    before and after the conversion (ProfileError otherwise). A profile that cannot be used (ProfileError, the Desk's
    500s) raises and nothing is rejected or written: the runner tries the job again, except for a profile file that is not
    the given one (ProfileMismatch: the worker's settings, final)."""
    args = check_args(args)
    guard = KeyGuard(args["org_id"], args["pub_id"])
    asset = uuid(args["asset_id"], "asset_id")
    data = storage.get(guard.asset_original(asset), args["version_id"])
    if hashlib.sha256(data).hexdigest() != args["sha256"]:
        raise Mismatch("the stored original is not the one this job names")
    base = {"org_id": guard.org_id, "pub_id": guard.pub_id, "asset_id": asset, "sha256": args["sha256"]}
    ph = params_hash(icc_sha256)                                # the profile checked before any work
    try:
        conv = images.convert_photo(data)                       # the Desk's code, unchanged
    except util.DeskError as e:
        if e.status >= 500:
            raise
        return {"kind": "media.rejected", **base, **_refusal(e)}
    width, height = oriented_size(data)
    if max(width, height) > MAX_SIDE_PX:                        # a strip the Desk takes, but no page can use
        return {"kind": "media.rejected", **base, **_refusal(util.DeskError(413, images.TOO_MANY_PIXELS))}
    thumb, tw, th = thumbnail(conv.preview)
    if params_hash(icc_sha256) != ph:                           # the profile file changed while it was converting
        raise ProfileError("the colour profile changed during the conversion")
    renditions = []
    for purpose, body, ext, mime, w, h in (
            ("preview", conv.preview, "jpg", "image/jpeg", *_size(conv.preview)),
            ("thumb", thumb, "jpg", "image/jpeg", tw, th),
            ("cmyk", conv.cmyk_gz, "cmyk.gz", "application/gzip", conv.width, conv.height)):
        key = guard.rendition(asset, purpose, ph, ext)
        version = storage.put(key, body, mime)
        renditions.append({"purpose": purpose, "key": key, "version_id": version,
                           "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "mime": mime,
                           "width_px": w, "height_px": h})
    return {"kind": "media.ready", **base, "bytes": len(data), "mime": MIME[conv.ext], "width_px": width,
            "height_px": height, "raster": {"width_px": conv.width, "height_px": conv.height}, "params_hash": ph,
            "renditions": renditions}


def _size(jpeg: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(jpeg)) as img:
        return img.size


# ------------------------------------------------------------------------------------------- media.ad (L2.3)


def check_ad_args(args: dict) -> dict:
    if not isinstance(args, dict) or set(args) != set(AD_ARGS):
        raise ValueError(f"media.ad takes exactly {', '.join(AD_ARGS)}")
    check_args({k: args[k] for k in ARGS})
    for key in ("w_mm", "h_mm"):                     # the contract's MmText: a positive decimal, at most two places
        if not re.fullmatch(keys.MM, args[key]) or float(args[key]) <= 0:
            raise ValueError(f"media.ad: {key} is not a size in millimetres")
    return args


def ad(storage: Storage, args: dict, icc_sha256: str) -> dict:
    """An ad's artwork fitted into its slot by the Desk's own `images.convert_ad` (at up to 200 ppi, centred on white),
    unchanged → `ad.ready` with its CMYK raster and preview (purposes ad-cmyk and ad-preview, the slot's size in their
    names: `assets/<asset>/r/ad-cmyk-<params_hash>-<w>x<h>mm.cmyk.gz` and `ad-preview-….jpg`), or `ad.rejected` with
    the Desk's words. The profile is checked as for a photo (ingest)."""
    args = check_ad_args(args)
    guard = KeyGuard(args["org_id"], args["pub_id"])
    asset, artwork = uuid(args["asset_id"], "asset_id"), uuid(args["artwork_id"], "artwork_id")
    data = storage.get(guard.asset_original(asset), args["version_id"])
    if hashlib.sha256(data).hexdigest() != args["sha256"]:
        raise Mismatch("the stored original is not the one this job names")
    base = {"org_id": guard.org_id, "pub_id": guard.pub_id, "artwork_id": artwork, "asset_id": asset,
            "sha256": args["sha256"]}
    ph = params_hash(icc_sha256)
    try:
        conv = images.convert_ad(data, float(args["w_mm"]), float(args["h_mm"]))     # the Desk's code, unchanged
    except util.DeskError as e:
        if e.status >= 500:
            raise
        return {"kind": "ad.rejected", **base, "message": desk_text(e.message), "status": e.status}
    if params_hash(icc_sha256) != ph:
        raise ProfileError("the colour profile changed during the conversion")
    size = f"{ph}-{args['w_mm']}x{args['h_mm']}mm"
    out = {}
    for name, purpose, body, ext, mime, (w, h) in (
            ("raster", "ad-cmyk", conv.cmyk_gz, "cmyk.gz", "application/gzip", (conv.width, conv.height)),
            ("preview", "ad-preview", conv.preview, "jpg", "image/jpeg", _size(conv.preview))):
        key = guard.rendition(asset, purpose, size, ext)
        out[name] = {"key": key, "version_id": storage.put(key, body, mime), "sha256": hashlib.sha256(body).hexdigest(),
                     "bytes": len(body), "width_px": w, "height_px": h}
    return {"kind": "ad.ready", **base, **out, "params_hash": ph}
