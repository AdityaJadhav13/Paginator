"""EXP-PAGE-1 brand step: the paper's masthead artwork as a newsprint-CMYK raster (EXPERIMENTAL; PRIVATE OUTPUT).

The owner's masthead image (any format PIL reads; supplied by the paper, never committed) is flattened onto paper white
and converted from sRGB to the output condition's CMYK exactly as photos.py converts photos (littleCMS, perceptual,
black-point compensation, the newsprint ICC profile given with --profile). compose_page.build then draws it in place of
the masthead's lettering on pages that carry a masthead (see compose_page.masthead_box). A raster below MIN_PPI at the
masthead's printed size is marked "review only".
Output: <dataset>/report/page1/brand/masthead.cmyk.gz (raw 8-bit CMYK, gzip) + masthead.json (private).
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/page1/brand.py
                     <dataset_dir> --profile <newsprint CMYK .icc> --masthead <image>
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sys
from pathlib import Path

from PIL import Image, ImageCms

from photos import ink, to_cmyk

TOOL = "page1-brand/1.0.0"


def main():
    args = sys.argv[1:]
    i = args.index("--profile"); profile = Path(args[i + 1]).expanduser(); del args[i:i + 2]
    i = args.index("--masthead"); src = Path(args[i + 1]).expanduser(); del args[i:i + 2]
    ds = Path(args[0]).expanduser()
    out = ds / "report" / "page1" / "brand"
    os.umask(0o077)                                     # the paper's artwork: never world-readable
    out.mkdir(parents=True, exist_ok=True)
    srgb = ImageCms.createProfile("sRGB")
    xform = ImageCms.buildTransform(srgb, ImageCms.getOpenProfile(str(profile)), "RGB", "CMYK",
                                    renderingIntent=ImageCms.Intent.PERCEPTUAL, flags=ImageCms.Flags.BLACKPOINTCOMPENSATION)
    img = Image.open(src)
    img.load()
    cmyk = to_cmyk(img, xform)
    (out / "masthead.cmyk.gz").write_bytes(gzip.compress(cmyk.tobytes(), mtime=0))
    meta = {"tool": TOOL, "source_sha256": hashlib.sha256(src.read_bytes()).hexdigest(), "width_px": cmyk.width,
            "height_px": cmyk.height, "profile_sha256": hashlib.sha256(profile.read_bytes()).hexdigest()[:12], "ink": ink(cmyk)}
    (out / "masthead.json").write_text(json.dumps(meta, indent=1) + "\n")
    print(json.dumps(meta))


if __name__ == "__main__":
    main()
