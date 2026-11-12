"""Photos and ads (CONTRACT.md §4): an upload becomes the original file, an RGB preview JPEG and a raw 8-bit CMYK
raster (gzip) converted with littleCMS to the newsprint profile, as experiments/phase0/page1/photos.py does."""
from __future__ import annotations

import gzip
import io
import os
import threading
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageCms, ImageOps

from . import messages as M
from .util import DeskError

MAX_UPLOAD_BYTES = 40 * 1024 * 1024
PHOTO_MAX_PX = 2000            # long side of the CMYK raster the engine places (never enlarged)
PREVIEW_MAX_PX = 1600          # long side of the preview JPEG for the UI
PREVIEW_QUALITY = 85
AD_PPI = 200                   # ads are fitted inside their slot at up to this resolution
DEFAULT_ICC = "~/PageinatorPrivate/icc/WAN-IFRAnewspaper26v5_TIC220.icc"

FORMATS = {"JPEG": "jpg", "MPO": "jpg", "PNG": "png", "WEBP": "webp"}   # MPO: JPEGs from some cameras and phones
TOO_MANY_PIXELS = M.msg("m.img.tooManyPixels")
MAX_PIXELS = 100_000_000                                  # 100 megapixels: far above any camera, far below a bomb
NOT_A_PICTURE = M.msg("m.img.notAPicture")
LANCZOS = Image.Resampling.LANCZOS

_xform_lock = threading.Lock()
_xform_cache: dict[tuple, ImageCms.ImageCmsTransform] = {}
_convert_slots = threading.BoundedSemaphore(2)   # big photos take memory: at most two conversions at once


@dataclass
class Converted:
    ext: str            # extension of the original file
    original: bytes     # the uploaded bytes, unchanged
    preview: bytes      # RGB JPEG, at most PREVIEW_MAX_PX on the long side
    cmyk_gz: bytes      # gzip (mtime 0) of raw C,M,Y,K bytes, row-major
    width: int          # size of the CMYK raster
    height: int


# ------------------------------------------------------------------------------------------- colour profile


def icc_path() -> Path:
    return Path(os.environ.get("PAGEINATOR_ICC") or DEFAULT_ICC).expanduser()


def icc_ok() -> bool:
    return icc_path().is_file()


def _transform() -> ImageCms.ImageCmsTransform:
    """sRGB -> newsprint CMYK, perceptual intent with black-point compensation. Built once per profile file."""
    path = icc_path()
    try:
        st = path.stat()
    except OSError:
        raise DeskError(500, M.msg("m.img.noProfile")) from None
    key = (str(path), st.st_mtime_ns, st.st_size)
    with _xform_lock:
        xform = _xform_cache.get(key)
        if xform is None:
            try:
                xform = ImageCms.buildTransform(
                    ImageCms.createProfile("sRGB"), ImageCms.getOpenProfile(str(path)), "RGB", "CMYK",
                    renderingIntent=ImageCms.Intent.PERCEPTUAL, flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
            except (ImageCms.PyCMSError, OSError) as e:
                raise DeskError(500, M.msg("m.img.badProfile", error=M.data(str(e)))) from None
            _xform_cache.clear()
            _xform_cache[key] = xform
        return xform


def rgb_to_cmyk(img: Image.Image) -> Image.Image:
    """sRGB image -> CMYK image for the press. (Tests replace this function: the real profile is private.)"""
    xform = _transform()
    with _xform_lock:
        return ImageCms.applyTransform(img, xform)


# ---------------------------------------------------------------------------------------------- decoding


def _open(data: bytes, min_long_side: int) -> tuple[Image.Image, str]:
    """Image.open + verify, then reopen and decode; EXIF orientation applied. Returns (sRGB RGB image, extension).
    JPEGs are decoded at a reduced DCT scale when that still leaves at least `min_long_side` pixels."""
    try:
        with Image.open(io.BytesIO(data)) as probe:
            fmt, size = probe.format, probe.size
            probe.verify()
    except Image.DecompressionBombError:
        raise DeskError(413, TOO_MANY_PIXELS) from None
    except MemoryError:                                  # the machine ran short, the picture may be fine
        raise
    except Exception:
        raise DeskError(400, NOT_A_PICTURE) from None
    if size[0] * size[1] > MAX_PIXELS:                   # before decoding: a small file can unpack to gigabytes
        raise DeskError(413, TOO_MANY_PIXELS)
    if fmt not in FORMATS:
        raise DeskError(400, M.msg("m.img.format", fmt=fmt))
    try:
        img = Image.open(io.BytesIO(data))
        if fmt in ("JPEG", "MPO"):
            w, h = img.size
            img.draft(img.mode, (min_long_side, 1) if w >= h else (1, min_long_side))
        img.load()
    except Image.DecompressionBombError:
        raise DeskError(413, TOO_MANY_PIXELS) from None
    except MemoryError:
        raise
    except Exception:
        raise DeskError(400, M.msg("m.img.damaged")) from None
    try:
        img = ImageOps.exif_transpose(img)
    except MemoryError:
        raise
    except Exception:          # damaged EXIF: keep the picture as stored
        pass
    return to_srgb(img), FORMATS[fmt]


def to_srgb(img: Image.Image) -> Image.Image:
    """Any decoded image -> 8-bit sRGB "RGB": transparency flattened onto white, an embedded colour profile
    (for example Display P3 from a phone) converted to sRGB, everything else converted directly."""
    icc = img.info.get("icc_profile")
    if img.mode in ("I;16", "I;16L", "I;16B", "I;16N", "I"):       # 16-bit greyscale PNG: scale, do not clip
        img = img.convert("I").point(lambda v: v * (1 / 256)).convert("L")
    if img.mode in ("RGBA", "LA", "PA", "RGBa", "La") or "transparency" in img.info:
        rgba = img.convert("RGBA")
        img = Image.alpha_composite(Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba).convert("RGB")
    elif img.mode not in ("RGB", "L", "CMYK"):
        img = img.convert("RGB")
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            space = src.profile.xcolor_space.strip()
            if (space, img.mode) in (("RGB", "RGB"), ("GRAY", "L"), ("CMYK", "CMYK")):
                return ImageCms.profileToProfile(img, src, ImageCms.createProfile("sRGB"),
                                                 renderingIntent=ImageCms.Intent.PERCEPTUAL, outputMode="RGB")
        except Exception:      # a broken embedded profile: treat the pixels as sRGB
            pass
    return img.convert("RGB")


def fit_long_side(img: Image.Image, max_px: int) -> Image.Image:
    """Scale down (never up) so the long side is at most max_px."""
    w, h = img.size
    long_side = max(w, h)
    if long_side <= max_px:
        return img
    s = max_px / long_side
    return img.resize((max(1, round(w * s)), max(1, round(h * s))), LANCZOS)


def _jpeg(img: Image.Image) -> bytes:
    """An RGB JPEG with no metadata: Pillow's JPEG writer copies a picture's comment (a JPEG COM segment, a PNG
    `comment` text) unless told not to, and a comment can hold a place or a name."""
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=PREVIEW_QUALITY, comment=b"")
    return buf.getvalue()


def _cmyk_gz(img: Image.Image) -> tuple[bytes, int, int]:
    cmyk = rgb_to_cmyk(img)
    raw = cmyk.tobytes()
    if cmyk.mode != "CMYK" or len(raw) != cmyk.width * cmyk.height * 4:
        raise DeskError(500, "The colour conversion did not give a CMYK picture.")
    return gzip.compress(raw, compresslevel=6, mtime=0), cmyk.width, cmyk.height


def _check_size(data: bytes) -> None:
    if not data:
        raise DeskError(400, M.msg("m.img.none"))
    if len(data) > MAX_UPLOAD_BYTES:
        raise DeskError(413, M.msg("m.img.tooLarge"))


# --------------------------------------------------------------------------------------------- pipelines


def convert_photo(data: bytes) -> Converted:
    _check_size(data)
    with _convert_slots:
        img, ext = _open(data, PHOTO_MAX_PX)
        img = fit_long_side(img, PHOTO_MAX_PX)
        preview = _jpeg(fit_long_side(img, PREVIEW_MAX_PX))
        gz, w, h = _cmyk_gz(img)
    return Converted(ext, data, preview, gz, w, h)


def ad_canvas(img: Image.Image, w_mm: float, h_mm: float) -> Image.Image:
    """The ad fitted inside the slot's shape, centred on white. The canvas is the slot at AD_PPI; a picture too small
    for that is not enlarged: the canvas keeps the slot's shape at the lower resolution the picture has."""
    cw, ch = max(1, round(w_mm / 25.4 * AD_PPI)), max(1, round(h_mm / 25.4 * AD_PPI))
    iw, ih = img.size
    s = min(cw / iw, ch / ih)
    if s < 1:
        iw, ih = max(1, min(cw, round(iw * s))), max(1, min(ch, round(ih * s)))
        img = img.resize((iw, ih), LANCZOS)
    else:
        cw, ch = max(iw, round(cw / s)), max(ih, round(ch / s))
    canvas = Image.new("RGB", (cw, ch), (255, 255, 255))
    canvas.paste(img, ((cw - iw) // 2, (ch - ih) // 2))
    return canvas


def convert_ad(data: bytes, w_mm: float, h_mm: float) -> Converted:
    _check_size(data)
    if not (isinstance(w_mm, (int, float)) and isinstance(h_mm, (int, float)) and w_mm > 0 and h_mm > 0):
        raise DeskError(500, "This ad space has no size in the page plan.")
    need = max(round(w_mm / 25.4 * AD_PPI), round(h_mm / 25.4 * AD_PPI), 1)
    with _convert_slots:
        img, ext = _open(data, need)
        canvas = ad_canvas(img, float(w_mm), float(h_mm))
        preview = _jpeg(fit_long_side(canvas, PREVIEW_MAX_PX))
        gz, w, h = _cmyk_gz(canvas)
    return Converted(ext, data, preview, gz, w, h)


def preview_from_cmyk_gz(gz_bytes: bytes, width: int, height: int) -> bytes:
    """A preview JPEG from a stored raster (the engine's import-sample writes photos without previews)."""
    if not (isinstance(width, int) and isinstance(height, int) and width > 0 and height > 0):
        raise DeskError(500, "The stored picture has no size in its index.")
    size = width * height * 4
    with gzip.GzipFile(fileobj=io.BytesIO(gz_bytes)) as gz:
        raw = gz.read(size + 1)
    if len(raw) != size:
        raise DeskError(500, "The stored picture does not match the size in its index.")
    img = Image.frombytes("CMYK", (width, height), raw).convert("RGB")
    return _jpeg(fit_long_side(img, PREVIEW_MAX_PX))
