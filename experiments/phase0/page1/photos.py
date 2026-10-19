"""EXP-PAGE-1 photo step: the printed page's photos and ads as newsprint-CMYK rasters (EXPERIMENTAL; PRIVATE OUTPUT).

For every page model (page_model.py) and every element of kind "image" or "ad":
  image  the matching PDFium image object of the printed page (same placement, ±2 mm) is rendered at its native
         resolution with its masks applied, cropped to the element's VISIBLE box (clip), flattened onto paper white
         (PDF/X-1a allows no transparency; a cut-out photo is flattened onto the colour printed behind it), reduced to at most MAX_PPI at the printed size (never enlarged) and converted
         from sRGB to the output condition's CMYK with littleCMS (PIL ImageCms; perceptual intent, black-point
         compensation) using the newsprint ICC profile given with --profile (the profile of the PDFs' OutputIntent)
  ad     the element's box of the printed page rendered by PDFium at AD_DPI (an ad is supplied artwork: rasterising it
         from the printed page is a test stand-in for placing the advertiser's PDF), converted the same way
Total ink is reported per raster (max and 99th percentile). Graphics (vector art) stay placeholders.
Output: <dataset>/report/page1/photos/<page>/<element>.cmyk.gz (raw 8-bit CMYK, gzip) + <page>/index.json (private).
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/page1/photos.py
                     <dataset_dir> --profile <newsprint CMYK .icc> [<sample>__p<page> ...]
"""
from __future__ import annotations

import gzip
import hashlib
import json
import sys
from pathlib import Path

import pypdfium2 as pdfium
import pypdfium2.raw as PR
from PIL import Image, ImageCms

MM = 72 / 25.4
MAX_PPI = 200
AD_DPI = 200
BG_DPI = 50                                   # page render used only to sample the colour behind cut-out photos
TOOL = "page1-photos/1.1.0"


def source_pdf(ds: Path, sample: str) -> Path:
    d = ds / "samples" / sample
    return d / "source.pdf" if (d / "source.pdf").exists() else sorted(d.glob("*.pdf"))[0]


def backdrop(page_img: Image.Image, scale: float, box_mm, alpha: Image.Image) -> tuple:
    """The colour printed behind a cut-out photo: median RGB of the printed page where the photo is fully transparent
    (a cut-out on a coloured panel must keep the panel colour, not become a white rectangle). White if too few pixels."""
    x0, t0, x1, b1 = box_mm
    region = page_img.crop((round(x0 * scale), round(t0 * scale), round(x1 * scale), round(b1 * scale))).convert("RGB")
    a = alpha.resize(region.size, Image.NEAREST).tobytes()
    px = region.tobytes()
    clear = [i for i in range(len(a)) if a[i] == 0]
    if len(clear) < 0.01 * len(a) or len(clear) < 20:
        return (255, 255, 255)
    return tuple(sorted(px[3 * i + c] for i in clear)[len(clear) // 2] for c in range(3))


def to_cmyk(img: Image.Image, xform, bg_rgb=(255, 255, 255)) -> Image.Image:
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGBA", img.size, (*bg_rgb, 255))
        img = Image.alpha_composite(bg, img)
    img = img.convert("RGB")
    return ImageCms.applyTransform(img, xform)


def ink(img: Image.Image) -> dict:
    data = img.tobytes()
    tot = sorted(sum(data[i:i + 4]) for i in range(0, len(data), 4 * 7))     # every 7th pixel: enough for a summary
    return {"max_pct": round(100 * tot[-1] / 255, 1), "p99_pct": round(100 * tot[int(0.99 * (len(tot) - 1))] / 255, 1)}


def main():
    args = sys.argv[1:]
    i = args.index("--profile"); profile = Path(args[i + 1]).expanduser(); del args[i:i + 2]
    ds = Path(args[0]).expanduser()
    names = args[1:]
    models = ds / "report" / "page1" / "pages"
    out_root = ds / "report" / "page1" / "photos"
    prof_hash = hashlib.sha256(profile.read_bytes()).hexdigest()[:12]
    srgb = ImageCms.createProfile("sRGB")
    xform = ImageCms.buildTransform(srgb, ImageCms.getOpenProfile(str(profile)), "RGB", "CMYK",
                                    renderingIntent=ImageCms.Intent.PERCEPTUAL, flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
    files = [models / f"{n}.json" for n in names] if names else sorted(models.glob("*.json"))
    total = {"pages": 0, "images": 0, "ads": 0, "unmatched": 0, "cutouts": 0}
    for f in files:
        m = json.loads(f.read_text(encoding="utf-8"))
        out = out_root / f.stem; out.mkdir(parents=True, exist_ok=True)
        page = pdfium.PdfDocument(str(source_pdf(ds, m["sample"])))[m["page"] - 1]
        H = page.get_height()
        objs = []
        for o in page.get_objects(filter=[PR.FPDF_PAGEOBJ_IMAGE], max_depth=8):
            l, b, r, t = o.get_pos()
            objs.append((o, (l / MM, (H - t) / MM, r / MM, (H - b) / MM)))
        index, ad_page, bg_page = {}, None, None
        for e in m["elements"]:
            if e["kind"] not in ("image", "ad"):
                continue
            x0, t0, x1, b1 = e["bbox_mm"]
            if e["kind"] == "image":
                # the object whose placement contains the visible box best (largest overlap)
                best, area = None, 0.0
                for o, (ox0, ot, ox1, ob) in objs:
                    ov = max(0.0, min(x1, ox1) - max(x0, ox0)) * max(0.0, min(b1, ob) - max(t0, ot))
                    if ov > area and ox0 - 2 <= x0 and x1 <= ox1 + 2 and ot - 2 <= t0 and b1 <= ob + 2:
                        best, area = (o, (ox0, ot, ox1, ob)), ov
                if best is None:
                    total["unmatched"] += 1
                    continue
                o, (ox0, ot, ox1, ob) = best
                im = o.get_bitmap(render=False).to_pil()                         # native pixels (no mask applied)
                masked = o.get_bitmap(render=True).to_pil()                     # display size, mask applied
                if masked.mode == "RGBA" and masked.getchannel("A").getextrema()[0] < 255:
                    alpha = masked.getchannel("A").resize(im.size, Image.BILINEAR)
                    im = im.convert("RGB"); im.putalpha(alpha)
                sx, sy = im.width / (ox1 - ox0), im.height / (ob - ot)            # px per mm of the placement
                crop = (round(max(0, (x0 - ox0) * sx)), round(max(0, (t0 - ot) * sy)),
                        round(min(im.width, (x1 - ox0) * sx)), round(min(im.height, (b1 - ot) * sy)))
                im = im.crop(crop)
                bg_rgb = (255, 255, 255)
                if im.mode == "RGBA" and im.getchannel("A").getextrema()[0] < 255:
                    if bg_page is None:
                        bg_page = page.render(scale=BG_DPI / 72).to_pil()
                    bg_rgb = backdrop(bg_page, BG_DPI / 25.4, e["bbox_mm"], im.getchannel("A"))
                    total["cutouts"] += 1
                total["images"] += 1
            else:
                if ad_page is None:
                    ad_page = page.render(scale=AD_DPI / 72).to_pil()
                s = AD_DPI / 25.4
                im = ad_page.crop((round(x0 * s), round(t0 * s), round(x1 * s), round(b1 * s)))
                total["ads"] += 1
                bg_rgb = (255, 255, 255)
            w_mm, h_mm = x1 - x0, b1 - t0
            max_w, max_h = round(w_mm / 25.4 * MAX_PPI), round(h_mm / 25.4 * MAX_PPI)
            if im.width > max_w or im.height > max_h:
                im = im.resize((min(im.width, max_w), min(im.height, max_h)), Image.LANCZOS)
            cm = to_cmyk(im, xform, bg_rgb)
            data = cm.tobytes()
            (out / f"{e['id']}.cmyk.gz").write_bytes(gzip.compress(data, 6, mtime=0))
            index[e["id"]] = {"kind": e["kind"], "bbox_mm": e["bbox_mm"], "width_px": cm.width, "height_px": cm.height,
                              "ppi": round(cm.width / (w_mm / 25.4)), "ink": ink(cm), "backdrop_rgb": list(bg_rgb), "sha256": hashlib.sha256(data).hexdigest()[:16]}
        (out / "index.json").write_text(json.dumps({"tool": TOOL, "profile_sha256": prof_hash, "max_ppi": MAX_PPI, "ad_dpi": AD_DPI,
                                                    "elements": index}, indent=1) + "\n")
        for p in out.iterdir():
            p.chmod(0o600)
        total["pages"] += 1
        print(f.stem, len(index), "rasters")
    print(json.dumps({**total, "profile_sha256": prof_hash}))


if __name__ == "__main__":
    main()
