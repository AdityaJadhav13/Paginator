"""Tests for the worker's task core: media.ingest, the key guard and params_hash (apps/engine-worker/pgn_worker).
Fictional pictures made here; the newsprint conversion is replaced by Pillow's plain RGB -> CMYK, as in the Desk's own
tests (the real profile is private). Run from the repository root:
    experiments/phase0/pdfx1/.venv/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import gzip
import hashlib
import io
import os
import sys
import tempfile
import unittest
import warnings
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PIL import Image  # noqa: E402

from pgn_worker import keys, media, params  # noqa: E402
from pgn_worker.desk import images, util  # noqa: E402
from pgn_worker.storage import FolderStorage, MissingObject  # noqa: E402

ORG = "01890a5d-ac96-774b-bcce-b302099a8057"
PUB = "01890a5d-ac96-774b-bcce-b302099a8058"
ASSET = "01890a5d-ac96-774b-bcce-b302099a8059"
OTHER_ORG = "01890a5d-ac96-774b-bcce-b302099a8060"
PROFILE = b"a fictional colour profile (the real one is private)"      # only hashed: the conversion is stood in for
ICC = hashlib.sha256(PROFILE).hexdigest()
REAL_RGB_TO_CMYK = images.rgb_to_cmyk
GPS = {1: "N", 2: (18.0, 31.0, 12.0), 3: "E", 4: (73.0, 51.0, 0.0)}      # a fictional place
XMP = (b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
       b'<rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="18,31.2N"/></rdf:RDF>'
       b'</x:xmpmeta>')


def picture(fmt: str = "JPEG", size=(300, 200), orientation: int | None = None, gps: bool = False,
            xmp: bool = False, icc: bool = False, comment: bytes | None = None) -> bytes:
    """A fictional picture: a red left half and a blue right half (so a turn shows), with the metadata asked for."""
    img = Image.new("RGB", size, (200, 20, 20))
    img.paste((20, 20, 200), (size[0] // 2, 0, size[0], size[1]))
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if gps:
        exif[0x8825] = GPS
    kw: dict = {"exif": exif} if (orientation or gps) else {}
    if xmp:
        kw["xmp"] = XMP
    if icc:
        from PIL import ImageCms
        kw["icc_profile"] = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    if comment is not None and fmt == "JPEG":
        kw["comment"] = comment
    elif comment is not None and fmt == "PNG":
        from PIL import PngImagePlugin
        kw["pnginfo"] = PngImagePlugin.PngInfo()
        kw["pnginfo"].add_text("comment", comment.decode())
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    return buf.getvalue()


def jpeg_segments(data: bytes) -> list[int]:
    """The markers of a JPEG's segments before its picture data (SOS), walked by their lengths."""
    assert data[:2] == b"\xff\xd8", "not a JPEG"
    at, out = 2, []
    while data[at] == 0xFF and data[at + 1] != 0xDA:
        out.append(data[at + 1])
        at += 2 + int.from_bytes(data[at + 2:at + 4], "big")
    return out


class Case(unittest.TestCase):
    def setUp(self):
        images.rgb_to_cmyk = lambda img: img.convert("CMYK")
        self.tmp = Path(tempfile.mkdtemp(prefix="worker-test-"))
        self.store = FolderStorage(self.tmp / "bucket")
        self.guard = keys.KeyGuard(ORG, PUB)
        self.profile = self.tmp / "profile.icc"
        self.profile.write_bytes(PROFILE)
        self.saved_icc = os.environ.get("PAGEINATOR_ICC")
        os.environ["PAGEINATOR_ICC"] = str(self.profile)

    def tearDown(self):
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK
        if self.saved_icc is None:
            os.environ.pop("PAGEINATOR_ICC", None)
        else:
            os.environ["PAGEINATOR_ICC"] = self.saved_icc
        import shutil
        shutil.rmtree(self.tmp, ignore_errors=True)

    def upload(self, data: bytes, asset: str = ASSET) -> dict:
        key = self.guard.asset_original(asset)
        version = self.store.put(key, data, "application/octet-stream")
        return {"org_id": ORG, "pub_id": PUB, "asset_id": asset, "version_id": version,
                "sha256": hashlib.sha256(data).hexdigest()}

    def keys_stored(self) -> list[str]:
        root = self.tmp / "bucket"
        return sorted(str(p.relative_to(root)) for p in root.rglob("*") if p.is_file() and
                      not p.name.endswith(".meta.json"))


class IngestTests(Case):
    def test_a_photo_becomes_the_desks_renditions_with_its_turned_size(self):
        data = picture(size=(3000, 2000), orientation=6, gps=True)      # a phone photo held upright
        ev = media.ingest(self.store, self.upload(data), ICC)
        self.assertEqual(ev["kind"], "media.ready")
        self.assertEqual((ev["width_px"], ev["height_px"]), (2000, 3000))          # L2-123: after the EXIF turn
        self.assertEqual(ev["raster"], {"width_px": 1333, "height_px": 2000})       # what prints: at most 2000 px
        self.assertEqual((ev["mime"], ev["bytes"], ev["sha256"]), ("image/jpeg", len(data),
                                                                   hashlib.sha256(data).hexdigest()))
        conv = images.convert_photo(data)                                            # the Desk's code, as the Desk runs it
        got = {r["purpose"]: r for r in ev["renditions"]}
        self.assertEqual(sorted(got), ["cmyk", "preview", "thumb"])
        ph = params.params_hash(ICC)
        for r in got.values():
            self.assertTrue(r["key"].startswith(f"orgs/{ORG}/pubs/{PUB}/assets/{ASSET}/r/{r['purpose']}-{ph}."))
            body = self.store.get(r["key"], r["version_id"])
            self.assertEqual((hashlib.sha256(body).hexdigest(), len(body)), (r["sha256"], r["bytes"]))
        self.assertEqual(self.store.get(got["preview"]["key"], got["preview"]["version_id"]), conv.preview)
        self.assertEqual(self.store.get(got["cmyk"]["key"], got["cmyk"]["version_id"]), conv.cmyk_gz)
        self.assertEqual((got["cmyk"]["width_px"], got["cmyk"]["height_px"]), (1333, 2000))
        self.assertEqual((got["preview"]["width_px"], got["preview"]["height_px"]), (1066, 1600))  # from the raster
        self.assertEqual(max(got["thumb"]["width_px"], got["thumb"]["height_px"]), params.THUMB_MAX_PX)
        with Image.open(io.BytesIO(self.store.get(got["thumb"]["key"], got["thumb"]["version_id"]))) as thumb:
            self.assertLess(thumb.size[0], thumb.size[1])                            # upright, as the preview
        original = self.store.get(self.guard.asset_original(ASSET), hashlib.sha256(data).hexdigest())
        self.assertEqual(original, data)                                             # never changed (GPS and all)

    def test_a_job_run_again_writes_the_same_keys_and_never_a_second_set(self):
        args = self.upload(picture())
        first = media.ingest(self.store, args, ICC)
        stored = self.keys_stored()
        again = media.ingest(self.store, args, ICC)
        self.assertEqual(first, again)
        self.assertEqual(self.keys_stored(), stored)
        self.assertEqual(len(stored), 4)                                             # the original and three renditions

    def test_renditions_carry_no_gps_or_other_metadata(self):                        # L2-109
        for fmt in ("JPEG", "PNG", "WEBP"):
            with self.subTest(fmt=fmt):
                data = picture(fmt, gps=True, xmp=fmt != "PNG", icc=True, orientation=1)
                with Image.open(io.BytesIO(data)) as src:
                    self.assertEqual(dict(src.getexif().get_ifd(0x8825)), GPS)       # the original has it
                ev = media.ingest(self.store, self.upload(data), ICC)
                for r in ev["renditions"]:
                    body = self.store.get(r["key"], r["version_id"])
                    if r["purpose"] == "cmyk":
                        raw = gzip.decompress(body)
                        self.assertEqual(len(raw), r["width_px"] * r["height_px"] * 4)   # raw C,M,Y,K only
                        continue
                    for marker in (b"Exif\x00\x00", b"GPS", b"xmpmeta", b"ICC_PROFILE", b"http://ns.adobe.com"):
                        self.assertNotIn(marker, body, (fmt, r["purpose"], marker))
                    with Image.open(io.BytesIO(body)) as out:
                        self.assertEqual(len(out.getexif()), 0)
                        self.assertFalse({"exif", "xmp", "icc_profile"} & set(out.info), out.info.keys())

    def test_bad_files_are_refused_with_the_desks_words_and_codes(self):
        cases = [(b"not a picture, only fictional bytes", 400, "m.img.notAPicture"),
                 (picture()[:400], 400, "m.img.notAPicture"),                        # only its first bytes
                 (picture(size=(600, 400))[:2000], 400, "m.img.damaged"),            # cut off in its picture data
                 (picture(size=(64, 64), fmt="GIF"), 400, "m.img.format")]          # a format the Desk does not take
        bomb = io.BytesIO()
        Image.new("L", (10_050, 10_050)).save(bomb, "PNG")                           # 101 megapixels, a small file
        cases.append((bomb.getvalue(), 413, "m.img.tooManyPixels"))
        for data, status, code in cases:
            with self.subTest(code=code):
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", Image.DecompressionBombWarning)
                    ev = media.ingest(self.store, self.upload(data), ICC)
                    with self.assertRaises(util.DeskError) as e:
                        images.convert_photo(data)
                self.assertEqual((ev["kind"], ev["status"], ev["code"]), ("media.rejected", status, code))
                self.assertEqual(e.exception.message.wire["code"], code)                 # the Desk's own code
                self.assertEqual(ev["message"], str(e.exception.message))               # and its words, exactly
                self.assertFalse([k for k in self.keys_stored() if "/r/" in k])           # no rendition written

    def test_a_profile_missing_or_not_the_given_one_fails_the_job_and_writes_nothing(self):
        args = self.upload(picture())
        stored = self.keys_stored()
        with self.assertRaises(params.ProfileError):                       # not the profile the worker was given
            media.ingest(self.store, args, "b" * 64)
        self.profile.write_bytes(PROFILE + b" changed")                    # the file changed under the worker
        with self.assertRaises(params.ProfileError):
            media.ingest(self.store, args, ICC)
        self.profile.unlink()
        with self.assertRaises(params.ProfileError):
            media.ingest(self.store, args, ICC)
        self.assertEqual(self.keys_stored(), stored)

    def test_a_profile_changed_during_the_conversion_fails_the_job(self):
        convert = images.convert_photo
        def swap(data):
            out = convert(data)
            self.profile.write_bytes(b"another fictional profile")
            return out
        images.convert_photo = swap
        try:
            with self.assertRaises(params.ProfileError):
                media.ingest(self.store, self.upload(picture()), ICC)
        finally:
            images.convert_photo = convert
        self.assertFalse([k for k in self.keys_stored() if "/r/" in k])

    def test_no_comment_or_metadata_segment_reaches_a_jpeg_rendition(self):    # without a colour profile too
        cases = {"jpeg comment": picture(comment=b"fictional place 18.52 73.85"),
                 "jpeg comment, turned": picture(comment=b"fictional place 18.52 73.85", orientation=6),
                 "png comment": picture("PNG", comment=b"fictional place 18.52 73.85"),
                 "png gps": picture("PNG", gps=True, orientation=1),
                 "webp gps and xmp": picture("WEBP", gps=True, xmp=True, orientation=1),
                 "jpeg gps and xmp": picture(gps=True, xmp=True, orientation=1)}
        for name, data in cases.items():
            with self.subTest(name):
                ev = media.ingest(self.store, self.upload(data), ICC)
                for r in ev["renditions"]:
                    if r["purpose"] == "cmyk":
                        continue
                    body = self.store.get(r["key"], r["version_id"])
                    self.assertFalse({0xE1, 0xE2, 0xED, 0xFE} & set(jpeg_segments(body)),   # APP1, APP2, APP13, COM
                                     (name, r["purpose"], [hex(m) for m in jpeg_segments(body)]))
                    self.assertNotIn(b"18.52", body)
                    self.assertNotIn(b"GPS", body)

    def test_the_thumbnail_drops_a_comment_itself(self):                   # not only because the preview has none
        thumb, _, _ = media.thumbnail(picture(comment=b"fictional place 18.52 73.85"))
        self.assertNotIn(0xFE, jpeg_segments(thumb))
        self.assertNotIn(b"18.52", thumb)

    def test_data_after_the_picture_reaches_the_original_only(self):        # as the Desk: L2-120 stays open
        zip_tail = b"PK\x03\x04" + b"fictional appended archive" * 10
        html_tail = b"<html><script>fictional</script></html>"
        for name, data in (("jpeg+zip", picture() + zip_tail), ("png+html", picture("PNG") + html_tail)):
            with self.subTest(name):
                ev = media.ingest(self.store, self.upload(data), ICC)
                self.assertEqual(ev["kind"], "media.ready")
                self.assertEqual(self.store.get(self.guard.asset_original(ASSET), ev["sha256"]), data)
                for r in ev["renditions"]:
                    body = self.store.get(r["key"], r["version_id"])
                    raw = gzip.decompress(body) if r["purpose"] == "cmyk" else body
                    self.assertNotIn(b"fictional", raw)
        ev = media.ingest(self.store, self.upload(b"junk before the picture" + picture()), ICC)
        self.assertEqual((ev["kind"], ev["code"]), ("media.rejected", "m.img.notAPicture"))

    def test_a_job_names_only_its_own_asset_and_its_exact_bytes(self):
        args = self.upload(picture())
        stored = self.keys_stored()
        for bad, error in (({"org_id": OTHER_ORG}, MissingObject),       # the key is made from the ids: another
                           ({"asset_id": "../" + ASSET}, keys.KeyRefused),  # organisation's original is not reached
                           ({"original_key": self.guard.asset_original(ASSET)}, ValueError),     # ids only
                           ({"org_id": ORG.upper()}, keys.KeyRefused),
                           ({"sha256": "0" * 64}, media.Mismatch),                           # not the stored bytes
                           ({"version_id": "f" * 64}, MissingObject),
                           ({"extra": 1}, ValueError)):
            with self.subTest(bad=bad):
                with self.assertRaises(error):
                    media.ingest(self.store, {**args, **bad}, ICC)
                self.assertEqual(self.keys_stored(), stored)                                 # nothing written


class KeyTests(unittest.TestCase):
    def test_the_guard_refuses_any_key_outside_the_job(self):
        g = keys.KeyGuard(ORG, PUB)
        self.assertEqual(g.asset_original(ASSET), f"orgs/{ORG}/pubs/{PUB}/assets/{ASSET}/original")
        self.assertEqual(g.check(g.asset_original(ASSET)), g.asset_original(ASSET))
        for key in (f"orgs/{OTHER_ORG}/pubs/{PUB}/assets/{ASSET}/original", f"uploads/orgs/{ORG}/pubs/{PUB}/x",
                    f"orgs/{ORG}/pubs/{PUB}/../../{OTHER_ORG}/pubs/{PUB}/x", f"orgs/{ORG}/pubs/{PUB}/a//b",
                    f"orgs/{ORG}/pubs/{PUB}/", f"orgs/{ORG}/pubs/{PUB}/a/ b", f"orgs/{ORG}/pubs/{PUB}/a\nb",
                    f"/orgs/{ORG}/pubs/{PUB}/x", None, 7):
            with self.subTest(key=key):
                with self.assertRaises(keys.KeyRefused):
                    g.check(key)
        for org in (ORG.upper(), "not-an-id", "", None, ORG + "0",
                    "01890a5d-ac96-074b-bcce-b302099a8057",                  # version 0
                    "01890a5d-ac96-774b-ccce-b302099a8057",                  # not the RFC variant
                    "01890a5d-ac96-774b-bcce-b302099a805\u0967"):            # a Devanagari digit
            with self.subTest(org=org), self.assertRaises(keys.KeyRefused):
                keys.KeyGuard(org, PUB)
        # an organisation's id is Better Auth's, a version 4 UUID; a publication's is the database's, version 7 only
        v4 = "9b2f4c1e-5d3a-4f6b-8c7d-0e1f2a3b4c5d"
        self.assertEqual(keys.KeyGuard(v4, PUB).asset_original(ASSET), f"orgs/{v4}/pubs/{PUB}/assets/{ASSET}/original")
        with self.assertRaises(keys.KeyRefused):
            keys.KeyGuard(ORG, v4)

    def test_only_a_cmyk_rendition_can_be_a_raster(self):
        g = keys.KeyGuard(ORG, PUB)
        good = g.key("assets", ASSET, "r", "cmyk-" + "0" * 32 + ".cmyk.gz")
        self.assertEqual(g.cmyk_raster(good), good)
        for key in (g.asset_original(ASSET), g.key("assets", ASSET, "r", "preview-" + "0" * 32 + ".jpg"),
                    g.key("assets", ASSET, "r", "cmyk-" + "0" * 31 + ".cmyk.gz"),
                    g.key("assets", "not-an-asset", "r", "cmyk-" + "0" * 32 + ".cmyk.gz"),
                    g.key("rasters", "cmyk-" + "0" * 32 + ".cmyk.gz"), f"uploads/orgs/{ORG}/pubs/{PUB}/x",
                    keys.KeyGuard(OTHER_ORG, PUB).key("assets", ASSET, "r", "cmyk-" + "0" * 32 + ".cmyk.gz")):
            with self.subTest(key=key), self.assertRaises(keys.KeyRefused):
                g.cmyk_raster(key)


class ParamsTests(Case):
    def test_the_hash_changes_with_the_profile_the_code_or_the_environment(self):
        base = params.params_hash(ICC)
        self.assertRegex(base, r"^[0-9a-f]{32}$")
        self.assertEqual(params.params_hash(), base)                        # from the file itself, not the caller
        self.assertEqual(params.params_hash(ICC), base)
        self.profile.write_bytes(b"another fictional profile")
        self.assertNotEqual(params.params_hash(), base)                     # the profile the code loads
        with self.assertRaises(params.ProfileError):
            params.params_hash(ICC)
        self.profile.write_bytes(PROFILE)
        with tempfile.TemporaryDirectory() as tmp:
            lock = Path(tmp) / "requirements.lock"
            lock.write_bytes(params.LOCK.read_bytes() + b"\n# another environment\n")
            self.assertNotEqual(params.params_hash(ICC, lock), base)
        facts = params.runtime()
        self.assertEqual(set(facts), {"pillow", "littlecms2", "libjpeg_turbo", "machine"})
        self.assertTrue(all(facts.values()), facts)
        for key in facts:
            saved = params.runtime
            params.runtime = lambda key=key: {**facts, key: "another"}
            try:
                self.assertNotEqual(params.params_hash(ICC), base, key)
            finally:
                params.runtime = saved
        saved = params.THUMB_MAX_PX
        try:
            params.THUMB_MAX_PX = 401
            self.assertNotEqual(params.params_hash(ICC), base)
        finally:
            params.THUMB_MAX_PX = saved
        self.assertEqual(params.params_hash(ICC), base)


if __name__ == "__main__":
    unittest.main()
