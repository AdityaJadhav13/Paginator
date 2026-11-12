"""The press test page (G2-1; docs/product/11-fix-before-launch.md L2-545). A fictional photo and a fictional ad, drawn
here the same every time, are converted to CMYK by the Desk's own conversion with the press colour profile (images.py,
exactly as real photos and ads are); the engine's page writer lays them out with Marathi text, tints and marks on one
PDF/X-1a page of the pilot's format (engine/deskpresstest.py, in the engine's Python); the independent PDF/X-1a checker
reads it. Nothing in it depends on the day or the machine (a fixed date, pictures drawn the same way), so the same
software and profile give the same bytes (measured on the Mac and in the worker image) and the press accepts the file
by its SHA-256.

    cd tools/desk && <Desk python> -m deskserver.presstest OUT_DIR
        writes OUT_DIR/pageinator-press-test.pdf and its .pdfx-check.txt, prints a JSON summary (PAGEINATOR_ICC: the
        colour profile; PAGEINATOR_ORACLE_PY: the engine's Python, default tools/oracle/v0/.venv/bin/python)
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

from . import images, jobs
from .util import DeskError, last_json_object

ENGINE_SCRIPT = Path("tools/desk/engine/deskpresstest.py")
FONT = Path("tools/oracle/v0/assets/fonts/latin/Archivo[wdth,wght].ttf")     # OFL, shipped with the engine
SOURCE_DATE_EPOCH = "1767225600"     # 2026-01-01 00:00 UTC, the PDF's dates: fixed, so the bytes never depend on the day
PHOTO_PX = (1200, 800)               # 192 ppi at 4 columns (158.3 mm)
AD_MM = (320.7, 50.0)                # the page's 8 columns: the engine places the ad across them at its own aspect
TIMEOUT_S = 300
NO_PROFILE = "The press test page cannot be made: the newsprint colour profile is missing."
ENGINE_FAILED = "The press test page could not be made: the layout engine stopped or took too long."
NOT_CHECKED = "The press test page was made, but the independent PDF/X-1a check could not run."


# ------------------------------------------------------------------------------------------- the fictional pictures


def _gradient(size: tuple[int, int], top: tuple, bottom: tuple) -> Image.Image:
    return ImageOps.colorize(Image.linear_gradient("L").resize(size), top, bottom)


def fictional_photo() -> Image.Image:
    """A made-up landscape with what a news photo asks of the press: a sky gradient, a soft sun, hills, skin tones,
    saturated colours, a neutral ramp, fine detail and deep shadows. No real person or place."""
    w, h = PHOTO_PX
    canvas = Image.new("RGB", (w, h))
    canvas.paste(_gradient((w, 470), (28, 72, 150), (205, 224, 238)), (0, 0))
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse((830, 50, 1070, 290), fill=200)
    canvas.paste((255, 244, 214), mask=glow.filter(ImageFilter.GaussianBlur(40)))
    ImageDraw.Draw(canvas).ellipse((905, 125, 995, 215), fill=(255, 250, 225))
    far = Image.new("L", (w, h), 0)
    ImageDraw.Draw(far).polygon([(0, 400), (160, 330), (330, 380), (520, 300), (700, 370), (880, 320), (1050, 360),
                                 (w, 330), (w, h), (0, h)], fill=255)
    canvas.paste((112, 138, 150), mask=far.filter(ImageFilter.GaussianBlur(3)))
    near = Image.new("L", (w, h), 0)
    ImageDraw.Draw(near).polygon([(0, 470), (240, 430), (470, 480), (760, 420), (1000, 470), (w, 440), (w, h), (0, h)],
                                 fill=255)
    canvas.paste(_gradient((w, h), (84, 120, 52), (18, 26, 12)), mask=near)
    d = ImageDraw.Draw(canvas)
    for x in range(40, w - 40, 9):                                # a fence: fine posts and two thin wires
        d.line((x, 452, x, 492), fill=(58, 44, 30), width=2)
    for y in (462, 478):
        d.line((40, y, w - 40, y), fill=(40, 34, 28), width=1)
    skin = [(255, 224, 196), (241, 194, 160), (224, 172, 105), (198, 134, 66), (141, 85, 36), (90, 56, 37)]
    for i, tone in enumerate(skin):                               # skin tones, each with a soft light and shade
        x0 = 60 + i * 120
        oval = Image.new("L", (w, h), 0)
        ImageDraw.Draw(oval).ellipse((x0, 530, x0 + 90, 650), fill=255)
        canvas.paste(_gradient((w, h), tuple(min(255, c + 30) for c in tone), tuple(int(c * 0.7) for c in tone)),
                     mask=oval.filter(ImageFilter.GaussianBlur(1.5)))
    vivid = [(220, 30, 30), (245, 130, 20), (250, 215, 30), (40, 160, 60), (0, 170, 210), (30, 60, 190), (200, 40, 150),
             (110, 50, 140)]
    for i, rgb in enumerate(vivid):                               # saturated colours, two rows of four
        x0, y0 = 790 + (i % 4) * 95, 520 + (i // 4) * 95
        d.rectangle((x0, y0, x0 + 85, y0 + 85), fill=rgb)
    cx, cy, r = 110, 110, 75                                      # fine detail: a 36-spoke star in the sky
    for k in range(36):
        d.pieslice((cx - r, cy - r, cx + r, cy + r), k * 10, k * 10 + 5, fill=(15, 15, 15))
    for i, v in enumerate((0, 3, 6, 10, 14, 19, 25, 32)):         # deep shadows, step by step
        d.rectangle((40 + i * 40, 680, 40 + i * 40 + 38, 735), fill=(v, v, v))
    for i in range(11):                                           # a neutral ramp, 0–100 % in 10 % steps
        v = round(255 * i / 10)
        d.rectangle((400 + i * 34, 680, 400 + i * 34 + 33, 735), fill=(v, v, v))
    canvas.paste(Image.linear_gradient("L").rotate(90, expand=True).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
                 .resize((w - 80, 30)).convert("RGB"), (40, 750))
    return canvas


def fictional_ad(repo_root: Path) -> Image.Image:
    """A made-up display ad at the slot's size (AD_MM at images.AD_PPI, so the conversion does not resample it): flat
    colour areas, a large and a small line of Latin type and a frame. No real product, shop or offer."""
    w, h = round(AD_MM[0] / 25.4 * images.AD_PPI), round(AD_MM[1] / 25.4 * images.AD_PPI)

    def font(size: int, weight: int, width: int = 100) -> ImageFont.FreeTypeFont:
        f = ImageFont.truetype(str(repo_root / FONT), size, layout_engine=ImageFont.Layout.BASIC)
        f.set_variation_by_axes([weight, width])
        return f
    img = Image.new("RGB", (w, h), (255, 206, 0))
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, 560, h), fill=(0, 72, 152))
    d.text((280, h / 2), "TEST", font=font(150, 900), fill=(255, 255, 255), anchor="mm")
    d.rectangle((w - 330, 0, w, h), fill=(206, 17, 38))
    d.text((w - 165, h / 2 - 40), "PRESS", font=font(64, 800), fill=(255, 255, 255), anchor="mm")
    d.text((w - 165, h / 2 + 45), "CHECK", font=font(64, 800), fill=(255, 255, 255), anchor="mm")
    d.text((620, 70), "FICTIONAL TEST ADVERTISEMENT", font=font(118, 800, 62), fill=(24, 24, 24))
    d.text((624, 225), "No real product, shop or offer. Flat colour areas and small type, converted to CMYK like a real ad.",
           font=font(36, 500), fill=(24, 24, 24))
    d.text((624, 300), "Small print at 6 pt: the smallest type an advertisement may carry, to check that it stays sharp.",
           font=font(17, 400), fill=(24, 24, 24))
    d.rectangle((0, 0, w - 1, h - 1), outline=(0, 0, 0), width=4)
    return img


def _png(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


# ------------------------------------------------------------------------------------------- the page


def make(repo_root: Path, engine_python: Path, work_dir: Path) -> dict:
    """The press test page, made in `work_dir` (pageinator-press-test.pdf and its .pdfx-check.txt) and checked.
    → {"pdf": bytes, "sha256", "icc_sha256", "check": {"passed", "fails", "warnings"}, "maker"}; DeskError (500)."""
    try:
        icc_sha256 = hashlib.sha256(images.icc_path().read_bytes()).hexdigest()
    except OSError:
        raise DeskError(500, NO_PROFILE) from None
    pictures = {"photo": images.convert_photo(_png(fictional_photo())),
                "ad": images.convert_ad(_png(fictional_ad(repo_root)), *AD_MM)}
    work_dir.mkdir(parents=True, exist_ok=True)
    pdf = work_dir / "pageinator-press-test.pdf"
    args = [str(engine_python), "-B", str(repo_root / ENGINE_SCRIPT), "--icc-sha256", icc_sha256, "--out", str(pdf)]
    for name, c in pictures.items():
        (work_dir / f"{name}.cmyk.gz").write_bytes(c.cmyk_gz)
        args += [f"--{name}", str(work_dir / f"{name}.cmyk.gz"), f"--{name}-px", f"{c.width}x{c.height}"]
    env = {"PATH": os.environ.get("PATH", ""), "SOURCE_DATE_EPOCH": SOURCE_DATE_EPOCH, "PYTHONDONTWRITEBYTECODE": "1",
           "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    try:
        r = subprocess.run(args, cwd=repo_root, env=env, capture_output=True, text=True, timeout=TIMEOUT_S)
    except (OSError, subprocess.SubprocessError):
        raise DeskError(500, ENGINE_FAILED) from None
    finally:
        for name in pictures:
            (work_dir / f"{name}.cmyk.gz").unlink(missing_ok=True)
    said = last_json_object(r.stdout) or {}
    if r.returncode != 0 or not pdf.is_file():
        sys.stderr.write(r.stderr[-4000:])
        raise DeskError(500, ENGINE_FAILED)
    data = pdf.read_bytes()
    check = jobs.check_pdfx(repo_root, pdf)
    if check.get("error"):
        raise DeskError(500, NOT_CHECKED)
    return {"pdf": data, "sha256": hashlib.sha256(data).hexdigest(), "icc_sha256": icc_sha256,
            "check": {k: check[k] for k in ("passed", "fails", "warnings")}, "maker": str(said.get("maker", ""))}


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: python -m deskserver.presstest OUT_DIR", file=sys.stderr)
        return 2
    repo = Path(__file__).resolve().parents[3]
    engine = Path(os.environ.get("PAGEINATOR_ORACLE_PY") or repo / "tools/oracle/v0/.venv/bin/python").expanduser()
    try:
        made = make(repo, engine, Path(argv[0]).expanduser())
    except DeskError as e:
        print(e.message, file=sys.stderr)
        return 1
    print(json.dumps({**{k: v for k, v in made.items() if k != "pdf"}, "bytes": len(made["pdf"])}))
    return 0 if made["check"]["passed"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
