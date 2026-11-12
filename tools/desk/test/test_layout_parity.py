"""Layout parity: the Desk's copy of the page generator (tools/desk/engine/layout/) at its default settings sets every
page BYTE FOR BYTE as the frozen experiments/phase0/gen1, which deskgen imports instead with PGN_DESK_FROZEN_GEN1=1.

Each side is the engine's own `desk_engine.py generate`, as the worker calls it (tools/parity/layout_parity.py: a fixed
SOURCE_DATE_EPOCH, a bare environment), in its own fresh Desk home. The two homes share only read-only inputs (the
dataset) and identical copies of the font-instance cache (fontTools' bytes: no layout code makes them). Compared: every
page PDF and page manifest, plan.json, printed.json and the run status without its clock fields.

Fictional (always runs, about 1.5 min): a fictional Marathi paper (tools/onboard/fixtures/make_paper.py) onboarded and
the Desk set up on it once; a 4-page edition of text written for this test: three stories pinned to page 1 (the lead
with a kicker, deck, byline and a photo with its caption) and five short items, which the Desk stacks in page 1's "in
brief" column. One page is laid out; the other three have nothing and fail at once.

Private (skips without the data): PAGEINATOR_DESK_PARITY_RUN = a real run folder (<desk home>/editions/<id>/runs/<run>).
Its home is copied (layout_parity.make_home: config, the edition's articles, the run's own photos and ads, its
request.json, plus the home's font instances); the source home is only read. PAGEINATOR_DESK_PARITY_PAGES=4: only the
articles the run set on its first 4 pages, as a 4-page edition (faster). Keep TMPDIR private: the homes hold real pages.

    PGN_ENGINE_PYTHON=tools/oracle/v0/.venv/bin/python \
      experiments/phase0/pdfx1/.venv/bin/python -B -m unittest tools/desk/test/test_layout_parity.py
"""
from __future__ import annotations

import gzip
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
ENGINE_PY = Path(os.environ.get("PGN_ENGINE_PYTHON") or REPO / "tools" / "oracle" / "v0" / ".venv" / "bin" / "python").absolute()  # not resolve(): the venv
PRIVATE_RUN = os.environ.get("PAGEINATOR_DESK_PARITY_RUN")
sys.path.insert(0, str(REPO / "tools" / "parity"))
sys.path.insert(0, str(REPO / "tools" / "onboard" / "fixtures"))
from layout_parity import EPOCH, make_home  # noqa: E402
VOLATILE = {"started", "updated", "seconds", "timings"}


def generate(home: Path, eid: str, rid: str, frozen: bool) -> float:
    env = {"PATH": "/usr/bin:/bin", "HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8",
           "SOURCE_DATE_EPOCH": EPOCH, **({"PGN_DESK_FROZEN_GEN1": "1"} if frozen else {})}
    t0 = time.monotonic()
    r = subprocess.run([str(ENGINE_PY), "-B", "tools/desk/engine/desk_engine.py", "generate", "--home", str(home),
                        "--edition", eid, "--run", rid], cwd=REPO, env=env, capture_output=True, text=True, timeout=3600)
    if r.returncode:
        raise AssertionError(f"generate ({'frozen' if frozen else 'copy'}) failed: {r.stdout[-1000:]} {r.stderr[-2000:]}")
    return time.monotonic() - t0


def outputs(run: Path) -> dict[str, bytes]:
    out = {f.name: f.read_bytes() for f in sorted(run.iterdir())
           if (f.name.startswith("page-") and f.suffix in (".pdf", ".json")) or f.name in ("plan.json", "printed.json")}
    st = {k: v for k, v in json.loads((run / "engine-status.json").read_text(encoding="utf-8")).items() if k not in VOLATILE}
    st["pages"] = [{k: v for k, v in p.items() if k != "seconds"} for p in st["pages"]]
    out["engine-status.json"] = json.dumps(st, sort_keys=True, ensure_ascii=False).encode()
    return out


class Parity:
    def parity(self, what: str, make_home_at, eid: str, rid: str, min_pages: int) -> None:
        """make_home_at(home) builds a fresh home; generate in two of them, the copy's and the frozen gen1's."""
        with tempfile.TemporaryDirectory(prefix="layout-parity-") as t:
            got, secs = {}, {}
            for side in ("copy", "frozen"):
                home = Path(t) / side
                make_home_at(home)
                secs[side] = generate(home, eid, rid, side == "frozen")
                got[side] = outputs(home / "editions" / eid / "runs" / rid)
            a, b = got["copy"], got["frozen"]
            pdfs = sorted(n for n in a if n.endswith(".pdf"))
            sys.stderr.write(f"\nlayout parity ({what}): {len(pdfs)} pages; copy {secs['copy']:.1f} s, frozen {secs['frozen']:.1f} s\n")
            self.assertGreaterEqual(len(pdfs), min_pages, "pages laid out")
            self.assertEqual(sorted(a), sorted(b), "the same files")
            differ = [n for n in a if a[n] != b[n]]
            if differ:
                import layout_parity as LP                           # what differs, in categories (no text)
                pdiff = {n: sorted({d["what"] for d in LP.diff_pdfs(Path(t) / "copy" / "editions" / eid / "runs" / rid / n,
                                                                      Path(t) / "frozen" / "editions" / eid / "runs" / rid / n)["differences"]})
                         for n in differ if n.endswith(".pdf")}
                self.fail(f"differ: {differ} {pdiff}")


# ------------------------------------------------------------------------------------------- fictional
EID, RID, DAY = "2026-01-20", "r-20260120-090000", "2026-01-20"
SENTENCES = ["सह्याद्री नगर परिषदेने कल्पित नदीकाठी नवे वाचनालय उभारण्याचा निर्णय सोमवारी घेतला.",
             "या प्रकल्पासाठी चाळीस लाख रुपयांचा निधी मंजूर झाल्याचे नगराध्यक्षांनी सांगितले.",
             "वाचनालयात मुलांसाठी स्वतंत्र दालन आणि ज्येष्ठ नागरिकांसाठी शांत कोपरा असेल.",
             "शहरातील शाळांनी या उपक्रमाचे स्वागत केले असून विद्यार्थ्यांनी पुस्तके दान करण्याची तयारी दाखवली.",
             "काम येत्या पावसाळ्यापूर्वी पूर्ण करण्याचे उद्दिष्ट ठेवण्यात आले आहे.",
             "स्थानिक व्यापारी संघटनेनेही बांधकामासाठी मदतीचा हात पुढे केला आहे.",
             "दरम्यान, वाहतूक कोंडी टाळण्यासाठी बाजारपेठेतील रस्ता एकेरी करण्यात येणार आहे.",
             "पोलिसांनी नागरिकांना पर्यायी मार्गांचा वापर करण्याचे आवाहन केले आहे."]


def body(words: int, start: int) -> str:
    out, n, i = [], 0, start
    while n < words:
        para = " ".join(SENTENCES[(i + k) % len(SENTENCES)] for k in range(3))
        out.append(para)
        n, i = n + len(para.split()), i + 3
    return "\n\n".join(out)


def article(n: int, headline: str, words: int, **kw) -> dict:
    return {"id": f"a-{n:010x}", "headline": headline, "kicker": "", "deck": "", "byline": "", "body": body(words, n),
            "priority": 3, "page": 1, "photo": None, **kw}


ARTICLES = [article(1, "नदीकाठी उभे राहणार नवे वाचनालय", 330, priority=1, kicker="सह्याद्री नगर",
                    deck="चाळीस लाखांचा निधी मंजूर; पावसाळ्यापूर्वी काम पूर्ण करणार", byline="कल्पित प्रतिनिधी",
                    photo={"id": "p-00000000a1", "caption": "नदीकाठची प्रस्तावित जागा (कल्पित छायाचित्र)", "credit": "चाचणी"}),
            article(2, "बाजारपेठेतील रस्ता एकेरी होणार", 180, priority=2, byline="कल्पित वार्ताहर"),
            article(3, "शाळांनी केले उपक्रमाचे स्वागत", 140, priority=2)] + \
           [article(10 + k, h, 35, page=None) for k, h in enumerate(["पाणीपुरवठा दोन दिवस बंद", "क्रीडा स्पर्धेचे उद्घाटन",
                                                         "आरोग्य शिबिराला प्रतिसाद", "नव्या बसमार्गाची घोषणा", "वृक्षारोपण मोहीम"])]


def photo_raw(w: int = 960, h: int = 640) -> bytes:
    from PIL import Image
    g = Image.linear_gradient("L")
    return Image.merge("CMYK", (g, g.rotate(90), Image.new("L", g.size, 40), Image.new("L", g.size, 10))).resize((w, h)).tobytes()


@unittest.skipUnless(ENGINE_PY.is_file(), "the engine's environment (tools/oracle/v0/.venv) is not set up")
class FictionalParity(Parity, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix="layout-parity-paper-")
        t = Path(cls.tmp.name)
        import make_paper as MP
        MP.make_paper("mr", t / "papers")
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        r = subprocess.run([sys.executable, "-B", str(REPO / "tools" / "onboard" / "onboard.py"), "build", "--files", str(t / "papers" / "files.json"),
                            "--out", str(t / "ds"), "--status", str(t / "st.json"), "--masthead", str(t / "papers" / "masthead.png"),
                            "--engine-python", str(ENGINE_PY)], capture_output=True, text=True, env=env)
        assert r.returncode == 0 and json.loads(r.stdout)["outcome"] == "ready", r.stdout[-1000:] + r.stderr[-2000:]
        pj = t / "ds" / "paper.json"
        doc = json.loads(pj.read_text(encoding="utf-8"))
        doc.pop("refined_layout", None)                              # the defaults: the frozen output
        pj.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
        r = subprocess.run([str(ENGINE_PY), "-B", "tools/desk/engine/desk_engine.py", "setup", "--home", str(t / "base"),
                            "--dataset", str(t / "ds")], cwd=REPO, capture_output=True, text=True, env=env)
        assert r.returncode == 0, r.stdout[-1000:] + r.stderr[-2000:]
        cls.raw = photo_raw()

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def make(self, home: Path) -> None:
        ed = home / "editions" / EID
        run = ed / "runs" / RID
        run.mkdir(parents=True)
        shutil.copy2(Path(self.tmp.name) / "base" / "config.json", home / "config.json")
        (ed / "photos").mkdir()
        (ed / "photos" / "p-00000000a1.cmyk.gz").write_bytes(gzip.compress(self.raw, mtime=0))
        (ed / "photos" / "index.json").write_text(json.dumps({"elements": {"p-00000000a1": {"width_px": 960, "height_px": 640, "ppi": 300}}}))
        edition = {"schema": "pageinator.desk.edition/1", "id": EID, "date": DAY, "pages": 4, "back_page_ads": True,
                   "volume": "1", "issue": "12", "price": "5"}
        (run / "request.json").write_text(json.dumps({"edition": edition, "articles": ARTICLES, "ads": {}}, ensure_ascii=False), encoding="utf-8")
        if home.name == "frozen":                                   # the copy's run made them: the frozen side gets a copy
            shutil.copytree(home.parent / "copy" / "cache" / "instances", home / "cache" / "instances")

    def test_one_fictional_page_is_identical(self):
        self.parity("fictional", self.make, EID, RID, 1)


# ------------------------------------------------------------------------------------------- private
@unittest.skipUnless(PRIVATE_RUN and ENGINE_PY.is_file(), "PRIVATE: set PAGEINATOR_DESK_PARITY_RUN=<desk home>/editions/<id>/runs/<run>")
class PrivateParity(Parity, unittest.TestCase):
    def test_a_real_run_is_identical(self):
        run_src = Path(PRIVATE_RUN).expanduser().resolve()
        src_home, eid, rid = run_src.parents[3], run_src.parents[1].name, run_src.name
        pages = os.environ.get("PAGEINATOR_DESK_PARITY_PAGES")

        def make(home: Path) -> None:
            make_home(src_home, eid, rid, home, json.loads((src_home / "config.json").read_text(encoding="utf-8"))["dataset"])
            if (src_home / "cache" / "instances").is_dir():
                shutil.copytree(src_home / "cache" / "instances", home / "cache" / "instances")
            if pages:
                st = json.loads((run_src / "engine-status.json").read_text(encoding="utf-8"))
                keep = {aid for p in st["pages"] if p["page"] <= int(pages) for aid in p["articles"]}
                req_path = home / "editions" / eid / "runs" / rid / "request.json"
                req = json.loads(req_path.read_text(encoding="utf-8"))
                req["edition"]["pages"] = int(pages)
                req["articles"] = [a for a in req["articles"] if a.get("id") in keep]
                req_path.write_text(json.dumps(req, ensure_ascii=False), encoding="utf-8")
        n = int(pages) if pages else int(json.loads((run_src / "request.json").read_text(encoding="utf-8"))["edition"]["pages"])
        self.parity(f"private, {n} pages", make, eid, rid, n - 1)


if __name__ == "__main__":
    unittest.main()
