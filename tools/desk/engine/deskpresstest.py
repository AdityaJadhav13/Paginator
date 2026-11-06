"""The press test page (G2-1; docs/product/11-fix-before-launch.md L2-545): one PDF/X-1a:2003 page of the pilot's
format (347 × 540 mm), written by the engine's own page writer (experiments/phase0/pdfx1, imported read only, as the
Desk's page generator imports it). On it: two Marathi stories composed by Pageinator (the synthetic corpus and the body
policy of the press test the press already accepted, make_press_test.build_page), a fictional photo 4 columns wide and
a fictional ad across the page (CMYK rasters made by the Desk's own conversion with the press colour profile:
deskserver/presstest.py), a print-control strip, registration marks and TEST slugs. Black text and 100 K rules
overprint; everything else knocks out. The same inputs and SOURCE_DATE_EPOCH always give the same bytes.

    <engine python> -B tools/desk/engine/deskpresstest.py --photo P.cmyk.gz --photo-px WxH --ad A.cmyk.gz --ad-px WxH \\
        --icc-sha256 HEX --out OUT.pdf          → one JSON line {"sha256", "bytes", "maker"}
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import statistics as st
import sys
from pathlib import Path

from deskcommon import EXPERIMENTS

sys.path.insert(0, str(EXPERIMENTS / "pdfx1"))
import make_press_test as MP  # noqa: E402  (installs the OFL font registry)

X, K3, R3, C = MP.X, MP.K3, MP.R3, MP.C
MAKER_VERSION = "press-test/1.0.0"
POLICY = "C3_floor0.66_stretch1.00"      # EXP-COMPOSE-3's chosen body policy (results/compose3/summary.json), as build_page
CONF = MP.PDFX["X-1a:2003"]
L, R, W, H = MP.MARGIN_L, MP.RIGHT, MP.PAGE_W, MP.PAGE_H
BLACK, WHITE, CMY = MP.BLACK, MP.WHITE, (1, 1, 1, 0)
CONTENT_TOP, STRIP = 50.0, 444.0
SLUG_MR = "चाचणी पान — प्रसिद्धीसाठी नाही"


def raster(path: str, px: str) -> tuple[bytes, int, int]:
    w, h = (int(v) for v in px.split("x"))
    return gzip.decompress(Path(path).read_bytes()), w, h


def image(x: float, y: float, w: float, pic: tuple[bytes, int, int]) -> tuple[X.Image, float]:
    """The raster `w` mm wide at (x, y) (top left, y down), at its own aspect. → (item, height in mm)."""
    data, pw, ph = pic
    h = w * ph / pw
    return X.Image(x * X.MM, (H - y - h) * X.MM, w * X.MM, h * X.MM, pw, ph, data), h


def registration(B: MP.PageBuilder, cx: float, cy: float) -> None:
    """A registration target (a crosshair, an open square, a solid centre) on all four plates: drawn in C100 M100 Y100,
    knocking out, then again in 100 K, overprinting it. The writer overprints black only, and one 400 % object fails the
    checker's coverage rule (> 300 %); on the plates the mark is the same as registration colour."""
    for cmyk, overprint in ((CMY, False), (BLACK, True)):
        B.hline(cx - 4.0, cx + 4.0, cy, 0.25, cmyk, overprint)
        B.vline(cx, cy - 4.0, cy + 4.0, 0.25, cmyk, overprint)
        for d in (-2.2, 2.2):
            B.hline(cx - 2.2, cx + 2.2, cy + d, 0.25, cmyk, overprint)
            B.vline(cx + d, cy - 2.2, cy + 2.2, 0.25, cmyk, overprint)
        B.rect(cx - 0.6, cy - 0.6, 1.2, 1.2, cmyk, overprint)


def build(photo: tuple[bytes, int, int], ad: tuple[bytes, int, int], icc_sha256: str) -> tuple[MP.PageBuilder, str]:
    B = MP.PageBuilder(actualtext=True)
    story_a, story_b, ratio, space_em, indent_mm, source = MP.synthetic_source()
    body_pt = round(MP.HOUSE_BODY_PT * ratio, 3)
    lead = MP.HOUSE_LEADING_PT / X.MM
    fam, axes, _, _ = MP.FONTS["F1"]
    k = (space_em * MP.HOUSE_BODY_PT / X.MM) / st.median(s for s in B.prepare("क ख", "F1", body_pt).spaces if s)
    kind, prm = R3.candidates()[POLICY]
    body_pol = R3.policy_for(POLICY, kind, prm, k)
    head_pol = K3.Policy("HEADLINE_ragged", "RAGGED", inword="none", token_breaks=True, fallback_max_slack=None)
    n_nb = max(1, round(indent_mm / C.shape_paragraph(MP.NBSP, "mr", fam, body_pt, axes=axes).runs[0].x_advances_mm[0]))
    for fk in ("F2", "F3"):
        B.prepare("क", fk, 10.0)                  # every font registered up front, so its bytes enter the build id
    build_id = hashlib.sha256(json.dumps([story_a, story_b, body_pt, POLICY, body_pol.key(), head_pol.key(),
                                          sorted(B.face_hash.items()), hashlib.sha256(photo[0]).hexdigest(), photo[1:],
                                          hashlib.sha256(ad[0]).hexdigest(), ad[1:], icc_sha256, X.WRITER_VERSION,
                                          MAKER_VERSION, K3.COMPOSER_VERSION], ensure_ascii=False).encode()).hexdigest()[:10]
    meta = lambda role: {"role": role}  # noqa: E731

    # slugs, title band and registration marks (inside the page: MediaBox = TrimBox)
    for cx in (6.5, W - 6.5):
        for cy in (6.5, H - 6.5):
            registration(B, cx, cy)
    B.natural(f"PAGEINATOR PRESS TEST — NOT FOR PUBLICATION — {CONF['label']} — build {build_id}", "F3", 7.0, L, 10.0,
              meta=meta("slug"))
    B.natural(SLUG_MR, "F3", 7.0, R, 10.0, align="right", meta=meta("slug"))
    B.natural("पेजिनेटर मुद्रण चाचणी", "F2", 44.0, L, 30.0, meta=meta("title"))
    B.natural(f"Pageinator press test · 347 × 540 mm · 8 columns × 36.5 mm · body text composed by Pageinator · "
              f"fictional photo and ad in CMYK · {CONF['label']}", "F3", 10.0, L, 38.5, meta=meta("subtitle"))
    B.hline(L, R, 42.5, 3.0, (0, 1, 1, 0), overprint=False)
    B.hline(L, R, 45.0, 0.5)

    # the ad across the page above the strip, then the stories and the photo above it
    ad_top = STRIP - 4.0 - (R - L) * ad[2] / ad[1]
    ad_item, _ = image(L, ad_top, R - L, ad)
    content_bottom = ad_top - 9.5

    def headline(text, c0, y_top):
        p = B.prepare(text, "F2", 22.0)
        c = K3.compose(p, head_pol, MP.span_w(4))
        if len(c.lines) > 2:
            raise ValueError(f"headline needs {len(c.lines)} lines (max 2): {text!r}")
        y = y_top + 7.5
        for ln in c.lines:
            B.composed_line(p, c, ln, MP.col_x(c0), y, "F2", meta=meta("headline"))
            y += 25.0 / X.MM
        return y - 25.0 / X.MM + 4.5

    def flow(texts, cols, y_top, story):
        ci, y = 0, y_top + 0.8 * lead
        for t in texts:
            p = B.prepare(MP.NBSP * n_nb + t, "F1", body_pt)
            c = K3.compose(p, body_pol, MP.COL_W)
            if c.status != "OK":
                continue
            for ln in c.lines:
                if y > content_bottom:
                    ci, y = ci + 1, y_top + 0.8 * lead
                    if ci >= len(cols):
                        return
                B.composed_line(p, c, ln, MP.col_x(cols[ci]), y, "F1", meta={"role": "body", "story": story})
                y += lead

    ya = headline(MP.HEADLINES[0], 0, CONTENT_TOP)
    yb = headline(MP.HEADLINES[1], 4, CONTENT_TOP)
    photo_item, photo_h = image(MP.col_x(4), yb + 1.0, MP.span_w(4), photo)
    B.items.append(photo_item)
    cap = yb + 1.0 + photo_h
    B.natural("काल्पनिक चाचणी छायाचित्र : खरी व्यक्ती, जागा किंवा घटना नाही", "F1", 9.0, MP.col_x(4), cap + 4.6,
              meta=meta("caption"))
    B.natural("Fictional test picture drawn by software · converted to CMYK with the press colour profile, as real "
              "photos are", "F3", 7.0, MP.col_x(4), cap + 8.6, meta=meta("caption"))
    flow(story_a, [0, 1, 2, 3], ya, "A")
    flow(story_b, [4, 5, 6, 7], cap + 11.5, "B")
    B.vline(MP.col_x(4) - MP.GUTTER / 2, CONTENT_TOP, content_bottom + 1.5, 0.4, (0, 0, 0, 0.6), overprint=False)
    B.hline(L, R, content_bottom + 3.5, 0.5)
    w = B.natural("काल्पनिक चाचणी जाहिरात", "F3", 6.5, L, ad_top - 2.0, meta=meta("ad-label"))
    B.natural("FICTIONAL TEST ADVERTISEMENT · not a real product, shop or offer · converted to CMYK with the press "
              "colour profile, as real ads are", "F3", 6.5, L + w + 3.0, ad_top - 2.0, meta=meta("ad-label"))
    B.items.append(ad_item)

    # print-control strip
    B.hline(L, R, STRIP, 0.5)
    B.natural("मुद्रण नियंत्रण पट्टी", "F2", 10.0, L, STRIP + 6.0, meta=meta("strip"))
    B.natural("Print control strip — black 100K overprints; tints, colours and white text knock out", "F3", 7.5,
              L + 33.0, STRIP + 6.0, meta=meta("strip"))
    pw = (R - L - 11 * 1.0) / 12

    def patches(row: list, top: float, size: float = 6.0) -> None:
        for i, (cmyk, label) in enumerate(row):
            x = L + i * (pw + 1.0)
            B.rect(x, top, pw, 8.0, cmyk)
            if not any(cmyk):                                     # paper white: outlined
                for yy in (top, top + 8.0):
                    B.hline(x, x + pw, yy, 0.25)
                B.vline(x, top, top + 8.0, 0.25)
                B.vline(x + pw, top, top + 8.0, 0.25)
            B.natural(label, "F3", size, x + pw / 2, top + 11.2, align="center", meta=meta("strip"))

    patches([((0, 0, 0, t / 100), f"K {t}%") for t in (0, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100)], STRIP + 9.0, 6.5)
    patches([(tuple(t / 100 if j == n else 0 for j in range(4)), f"{ink} {t}%") for n, ink in enumerate("CMY")
             for t in (10, 30, 50, 70)], STRIP + 22.5)
    patches([((1, 0, 0, 0), "C 100"), ((0, 1, 0, 0), "M 100"), ((0, 0, 1, 0), "Y 100"), ((0, 0, 0, 1), "K 100"),
             ((0, 1, 1, 0), "M100 Y100 (red)"), ((0.4, 0.3, 0.3, 1), "C40 M30 Y30 K100 = 200%"),
             ((0.5, 0.4, 0.4, 0), "C50 M40 Y40 (grey)"), ((0, 0, 0, 0.5), "K 50 (compare)")], STRIP + 36.0)
    lx = L + 8 * (pw + 1.0) + 4.0
    for j, lw in enumerate((0.1, 0.25, 0.5, 1.0, 2.0)):
        y = STRIP + 36.5 + j * 2.6
        B.natural(f"{lw:g} pt", "F3", 6.0, lx, y + 0.8, meta=meta("strip"))
        B.hline(lx + 12.0, R, y, lw)
    yl = STRIP + 53.5
    for size in (6, 7, 8, 9, 10, 12):
        B.natural(f"{size} pt  " + MP.LADDER, "F1", float(size), L, yl, meta=meta("ladder"))
        yl += size / X.MM * 1.25
    rx = MP.col_x(5)
    B.rect(rx, STRIP + 49.5, R - rx, 17.0, BLACK)
    B.natural("उलट मजकूर चाचणी : पांढरी अक्षरे", "F2", 12.0, rx + 4.0, STRIP + 57.0, cmyk=WHITE, overprint=False,
              meta=meta("reverse"))
    B.natural("पांढरी अक्षरे काळ्या पार्श्वभूमीवर — White text on 100K, knockout", "F1", 8.0, rx + 4.0, STRIP + 63.0,
              cmyk=WHITE, overprint=False, meta=meta("reverse"))
    B.natural(f"Fonts: Noto Serif Devanagari (wdth 87.5; body {body_pt:g} pt on {MP.HOUSE_LEADING_PT:g} pt), Noto Sans "
              f"Devanagari Bold/Regular — SIL OFL · Body: {source}; spacing policy {POLICY}; no word breaks", "F3", 6.5,
              L, STRIP + 75.5, meta=meta("strip"))
    B.natural(f"Output intent {MP.OUTPUT_INTENTS['IFRA26']['OutputConditionIdentifier']} (registered characterization) · "
              f"writer {X.WRITER_VERSION} · composer {K3.COMPOSER_VERSION} · page {MAKER_VERSION} · black text 100K "
              f"overprint", "F3", 6.5, L, STRIP + 79.0, meta=meta("strip"))
    B.natural(f"Photo and ad are FICTIONAL, drawn by software: no real person, place, product or offer · sRGB to CMYK "
              f"with the press colour profile, ICC SHA-256 {icc_sha256[:12]} (perceptual, black point compensation)",
              "F3", 6.5, L, STRIP + 82.5, meta=meta("strip"))
    B.natural(f"PAGEINATOR PRESS TEST — NOT FOR PUBLICATION — build {build_id}", "F3", 6.5, L, STRIP + 89.0,
              meta=meta("slug"))
    B.natural(SLUG_MR, "F3", 6.5, R, STRIP + 89.0, align="right", meta=meta("slug"))
    return B, build_id


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("photo", "ad"):
        ap.add_argument(f"--{name}", required=True, help=f"the {name}'s CMYK raster (gzip of raw C,M,Y,K bytes)")
        ap.add_argument(f"--{name}-px", required=True, help="its size in pixels, WxH")
    ap.add_argument("--icc-sha256", required=True, help="the SHA-256 of the colour profile the rasters were made with")
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    B, build_id = build(raster(a.photo, a.photo_px), raster(a.ad, a.ad_px), a.icc_sha256)
    data, _ = X.build_pdf([X.Page(W * X.MM, H * X.MM, B.items)], B.fonts,
                          title=f"Pageinator press test {build_id} (TEST - not for publication)",
                          output_intent=MP.OUTPUT_INTENTS["IFRA26"], actualtext=True, pdf_version=CONF["pdf_version"],
                          pdfx_info=CONF["info"], creator=f"Pageinator press test ({MAKER_VERSION})")
    a.out.write_bytes(data)
    print(json.dumps({"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                      "maker": f"{MAKER_VERSION} (writer {X.WRITER_VERSION}, composer {K3.COMPOSER_VERSION})"}))


if __name__ == "__main__":
    main()
