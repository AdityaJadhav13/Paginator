"""Tests for the Desk server (tools/desk/server.py, tools/desk/deskserver/).

Standard-library unittest. Fictional data only, a temporary desk home and a fake engine written into a temporary
folder; the newsprint colour conversion is replaced by Pillow's plain RGB->CMYK (the real profile is private).
Run from the repository root:
    experiments/phase0/pdfx1/.venv/bin/python -m unittest tools/desk/test/test_server.py -v
"""
from __future__ import annotations

import contextlib
import gzip
import http.client
import io
import json
import os
import shutil
import stat
import sys
import tempfile
import threading
import time
import unicodedata
import unittest
import unittest.mock
import zipfile
from pathlib import Path
from urllib.parse import quote

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))       # tools/desk
REPO = Path(__file__).resolve().parents[3]

import pikepdf                                                       # noqa: E402
from PIL import Image                                                # noqa: E402

from deskserver import api, editing, images, jobs                   # noqa: E402
from deskserver import store as store_module                        # noqa: E402
from deskserver.app import Desk                                      # noqa: E402
from deskserver import press                                         # noqa: E402
from deskserver.press import DAMAGED, OLDER_DESK, deskprinted        # noqa: E402
from deskserver.store import count_words, decorate, parse_bulk      # noqa: E402
from deskserver.util import DeskError, clean_text, ensure_dir, last_json_object, write_json  # noqa: E402

SYSTEM_PROFILES = Path("/System/Library/ColorSync/Profiles")
GENERIC_CMYK = SYSTEM_PROFILES / "Generic CMYK Profile.icc"         # ships with macOS; not private
DISPLAY_P3 = SYSTEM_PROFILES / "Display P3.icc"
ENV_KEYS = ("PAGEINATOR_ORACLE_PY", "PAGEINATOR_DESK_ENGINE", "PAGEINATOR_ICC")
REAL_RGB_TO_CMYK = images.rgb_to_cmyk                                # the littleCMS conversion


def fake_rgb_to_cmyk(img: Image.Image) -> Image.Image:
    """Stands in for the private newsprint profile: Pillow's plain RGB -> CMYK."""
    return img.convert("CMYK")

# A stand-in for tools/desk/engine/desk_engine.py: the same commands and JSON, fictional output. The edition's
# "volume" picks how `generate` behaves: "" works, "slow" waits, "stubborn" waits and ignores SIGTERM, "fail" exits 1
# with {"error"}, "crash" exits 3 with a traceback-like line, "allfail" exits 0 with every page failed (as the engine
# does), "half" makes page 1 and fails page 2. Its "issue" picks how `measure` behaves: "" works, "slowmeasure" takes
# 1.5 s, "failmeasure" exits 1 with {"error"}.
FAKE_ENGINE = r'''
import json, os, re, signal, sys, time
from pathlib import Path
sys.path.insert(0, ENGINE_DIR)                                   # set by the test: the Desk's engine folder
import deskprinted                                               # what a page prints, as the real engine records it

def values(name):
    a = sys.argv[2:]
    return [a[i + 1] for i, x in enumerate(a) if x == name and i + 1 < len(a)]

def first(name, default=None):
    v = values(name)
    return v[0] if v else default

def reply(obj, code=0):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()
    sys.exit(code)

def write_atomic(path, obj):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj))
    os.replace(tmp, path)

cmd = sys.argv[1]
home = Path(first("--home"))
with open(home / "fake-engine-calls.txt", "a") as f:
    f.write(cmd + " " + (first("--edition") or "-") + "\n")
if cmd == "setup":
    write_atomic(home / "config.json", {"dataset": first("--dataset", "none")})
    reply({"config": {"templates": 3}})
if not (home / "config.json").exists():
    reply({"error": "The Desk is not set up yet: run setup first."}, 1)
if cmd == "plan":
    pages, back = int(first("--pages")), first("--back-ads") == "1"
    out = []
    for n in range(1, pages + 1):
        role = "front" if n == 1 else "back" if n == pages else "inside"
        slots = [{"slot": "back-1", "w_mm": 100.0, "h_mm": 50.0}] if role == "back" and back else []
        out.append({"page": n, "role": role, "news_mm2": 50000.0, "ad_slots": slots})
    reply({"pages": out, "needs": {"stories": 10, "briefs": 2, "photos": 5, "words": 3000}})
if cmd == "samples":
    reply({"samples": [{"name": "sample-one", "date": "2001-02-03", "pages": 4, "stories": 1, "photos": 0,
                        "words": 6}]})
if cmd == "import-sample":
    path = home / "editions" / first("--edition") / "articles.json"
    doc = json.loads(path.read_text())
    for name in values("--sample"):
        doc["articles"].append({"id": "a-" + os.urandom(5).hex(), "headline": "An imported headline", "kicker": "",
                                "deck": "", "byline": "", "body": "Text of a fictional story.", "priority": 3,
                                "page": None, "photo": None, "source": "sample:" + name, "created": "",
                                "updated": ""})
    write_atomic(path, doc)
    reply({"imported": len(values("--sample")), "photos": 0})
if cmd == "measure":
    ed = home / "editions" / first("--edition")
    mode = json.loads((ed / "edition.json").read_text()).get("issue", "")
    n = len(json.loads((ed / "articles.json").read_text())["articles"])
    if mode == "failmeasure":
        print("fake engine: measuring went wrong", file=sys.stderr)
        reply({"error": "The fake measure failed on purpose."}, 1)
    write_atomic(ed / "measure-status.json", {"state": "measuring", "measured": 0, "total": n, "updated": "x"})
    if mode == "slowmeasure":
        time.sleep(1.5)
    write_atomic(ed / "measure-status.json", {"state": "done", "measured": n, "total": n, "updated": "y"})
    reply({"measured": n, "total": n, "failed": 0})
if cmd == "generate":
    run = home / "editions" / first("--edition") / "runs" / first("--run")
    req = json.loads((run / "request.json").read_text())
    mode = req["edition"].get("volume", "")
    back = "back" if req["edition"].get("back_page_ads", True) else "inside"     # as page_roles: the last page
    pages = [{"page": n, "role": "front" if n == 1 else back, "state": "waiting", "articles": [], "pdf": None,
              "seconds": 0.0, "message": "", "warnings": []} for n in (1, 2)]
    status = {"schema": "pageinator.desk.engine-status/1", "state": "planning", "started": "", "updated": "",
              "message": "Planning the pages.", "pages": pages, "not_placed": [],
              "article_warnings": [{"article": req["articles"][0]["id"], "warnings": ["a fictional warning"]}],
              "timings": {"measure_s": 0.1, "plan_s": 0.2, "layout_s": 0.3}, "plan_log": [["a", 1], ["b", 2]]}
    write_atomic(run / "engine-status.json", status)
    print("fake engine: planning", file=sys.stderr)
    if mode == "fail":
        reply({"error": "The fake engine failed on purpose."}, 1)
    if mode == "crash":
        print("ValueError: a fake crash", file=sys.stderr)
        sys.exit(3)
    if mode == "stubborn":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
    if mode in ("slow", "stubborn"):
        status["state"] = "layout"
        write_atomic(run / "engine-status.json", status)
        time.sleep(60)
    if mode == "allfail":
        for p in pages:
            p.update(state="failed", message="a fictional layout problem")
        status.update(state="failed", message="2 of 2 pages could not be laid out")
        write_atomic(run / "engine-status.json", status)
        reply({"pages": 2, "failed": 2})
    if mode == "waitgo":                                         # the test changes the edition while the run is on
        status["state"] = "layout"
        write_atomic(run / "engine-status.json", status)
        for _ in range(150):
            if (run / "go").exists():
                break
            time.sleep(0.1)
    import pikepdf
    for p in pages:
        if mode == "half" and p["page"] == 2:
            p.update(state="failed", message="a fictional layout problem")
            continue
        pdf = pikepdf.new()
        pdf.add_blank_page(page_size=(400, 600))
        pdf.pages[0].Contents = pdf.make_stream(b"0 0 0 0.8 k 40 40 320 520 re f")
        name = "page-%02d.pdf" % p["page"]
        pdf.save(run / name)
        p.update(state="done", pdf=name, seconds=0.01,                  # the articles go to the pages in turn
                 articles=[a["id"] for i, a in enumerate(req["articles"]) if i % 2 == p["page"] - 1])
        status["state"] = "layout"
        write_atomic(run / "engine-status.json", status)
    # the run's plan (one story per article) and what each page prints, as the real engine writes them
    write_atomic(run / "plan.json", {"stories": {"d" + a["id"][2:]: {"articles": [a["id"]], "order": i, "pin": None, "brief": False}
                                                 for i, a in enumerate(req["articles"])}})
    by_id = {a["id"]: a for a in req["articles"]}
    ads = deskprinted.ad_sigs(home / "editions" / first("--edition") / "ads")   # the ads as the run started
    write_atomic(run / "printed.json", {"pages": {str(p["page"]): {"v": deskprinted.VERSION,
        "articles": {a: deskprinted.article_sig(by_id[a], False) for a in p["articles"]},
        "folio": deskprinted.folio_sig(req["edition"]) if p["page"] == 1 else None,
        "ads": {"back-1": ads.get("back-1")} if p["role"] == "back" else {}}
        for p in pages if p["state"] == "done"}})
    if mode == "damagedprinted":
        (run / "printed.json").write_text("{damaged")
    status.update(state="done", message="Two pages.",
                  not_placed=[{"article": req["articles"][0]["id"], "reason": "a fictional reason"}])
    write_atomic(run / "engine-status.json", status)
    reply({"pages": 2, "failed": 0})
if cmd == "edit-service":
    # A page's stories are its articles in the run's status.json ("d" + the article id's hex, as the Desk keys them);
    # a story whose article is on another page there was brought from that page. Another page's stories are those of
    # its open page, else of its edit file, else its articles in status.json (as the real engine reads them), and a
    # save takes its stories off those (as the real engine does). Every change moves the revision on, and a change made
    # on an older revision is refused, as the real engine does. So are the changes its locks refuse: moving, resizing or
    # removing a locked story, bringing in one locked on another page and saving a page while one of its stories is
    # locked on another page. A move takes the story off the page at once and adds it to the other page (opened if need
    # be) at column 1, 400 mm from the top, unless it is there already, and is refused when a story is there; with
    # fake-move-stops in the run, the engine stops right after the other page took it (fake-move-slow: it takes 1 s).
    # Stories whose boxes are over each other are an "overlap" problem, as the real engine reports them.
    # A photo crop that is not one is refused, and a saved page records the crops it prints, as the real engine records
    # them.
    STALE = "this page was changed in another window or tab; it is shown again as it is now"
    def answer(obj):
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()
    def run_dir(s):
        return home / "editions" / s["edition"] / "runs" / s["run"]
    def on_pages(s):
        st = json.loads((run_dir(s) / "status.json").read_text())
        return {p["page"]: list(p.get("articles") or []) for p in st["pages"]}
    def others(s):
        out = {}
        for n, arts in on_pages(s).items():
            if n == s["page"]:
                continue
            other = sessions.get("%s/%s/%s" % (s["edition"], s["run"], n))
            edit = run_dir(s) / ("page-%02d.edit.json" % n)
            saved = json.loads(edit.read_text()) if edit.exists() else {}
            if other is not None:
                out[n] = other["modules"]
            elif saved.get("modules") is not None and saved.get("page") == n:
                out[n] = saved["modules"]
            else:
                out[n] = [{"story": "d" + a[2:], "locked": False} for a in arts]
        return out
    def where(s):                                  # story -> {page, locked}; locked on any other page counts
        w = {}
        for n, mods in sorted(others(s).items()):
            for m in mods:
                if not (m["story"] in w and w[m["story"]]["locked"]):
                    w[m["story"]] = {"page": n, "locked": bool(m.get("locked"))}
        return w
    def overlaps(mods):                            # as deskedit.PageSession.problems: boxes over each other
        def box(m):
            return (float(m["x"]), float(m["y"]), float(m["x"]) + m["w"] * 36.5 + (m["w"] - 1) * 4.19,
                    float(m["y"]) + float(m["h"]))
        out = []
        for i in range(len(mods)):
            for j in range(i + 1, len(mods)):
                a, b = box(mods[i]), box(mods[j])
                if min(a[2], b[2]) - max(a[0], b[0]) > 0.5 and min(a[3], b[3]) - max(a[1], b[1]) > 0.5:
                    out.append({"kind": "overlap", "stories": [mods[i]["story"], mods[j]["story"]], "mm": 1.0})
        return out
    def story_name(s, story):
        a = s["text"].get("a-" + story[1:]) or {}
        return "“%s”" % a["headline"] if a.get("headline") else "the column of short items"
    def draw(s):
        w = where(s)
        also = [m["story"] for m in s["modules"] if m["story"] in w]
        return {"page": s["page"], "role": "front", "rev": s["rev"], "modules": s["modules"],
                "notes": [{"story": m["story"], "fit": "fits", "by_mm": 0.0, "articles": ["a-" + m["story"][1:]],
                           "headline": (s["text"].get("a-" + m["story"][1:]) or {}).get("headline", "")} for m in s["modules"]],
                "problems": overlaps(s["modules"]),
                "pool": [], "grid": {"page_w_mm": 347.0, "page_h_mm": 540.0, "origin_mm": 12.82, "column_mm": 36.5,
                                     "gutter_mm": 4.19, "columns": 8, "news_top_mm": 30.0, "news_bottom_mm": 520.0, "snap_mm": 0.5},
                "items": [{"t": "rect", "x": 20.0, "y": 40.0, "w": 10.0, "h": 5.0, "c": [0, 0, 0, 1]}], "fonts": {},
                "also_on_pages": {k: w[k]["page"] for k in also},
                "locked_on_pages": {k: w[k]["page"] for k in also if w[k]["locked"]}}
    def session(req):
        s = sessions.get(req["session"])
        if s is None:
            raise ValueError("this page is not open: open it again")
        return s
    def check(s, req):
        if req.get("base_rev") is not None and req["base_rev"] != s["rev"]:
            raise ValueError(STALE)
    def same_place(a, b):
        return int(a["w"]) == int(b["w"]) and all(abs(float(a[k]) - float(b[k])) < 0.01 for k in ("x", "y", "h"))
    def check_locks(s, modules):                   # as deskedit.PageSession._check_locks
        first = {}
        for m in modules:
            first.setdefault(m["story"], m)
        for p in s["modules"]:
            if p.get("locked"):
                if p["story"] not in first:
                    raise ValueError("%s is locked: unlock it (Shift+L) to take it off the page" % story_name(s, p["story"]))
                if not same_place(p, first[p["story"]]):
                    raise ValueError("%s is locked: unlock it (Shift+L) to move it" % story_name(s, p["story"]))
        w, mine = where(s), {p["story"] for p in s["modules"]}
        for k in first:
            if k not in mine and k in w and w[k]["locked"]:
                raise ValueError("%s is locked on page %d: unlock it there to bring it here" % (story_name(s, k), w[k]["page"]))
    def check_crops(modules):                      # as deskedit.crop_value: none, or a photo, a focus and a zoom
        num = lambda v: isinstance(v, (int, float)) and not isinstance(v, bool)
        for m in modules:
            c = m.get("crop")
            if c is not None and not (isinstance(c, dict) and re.fullmatch(r"p-[0-9a-f]{10}", str(c.get("photo")))
                                      and isinstance(c.get("focus"), list) and len(c["focus"]) == 2
                                      and all(num(v) for v in c["focus"]) and num(c.get("zoom"))):
                raise ValueError("a photo crop must give the photo's id, a focus point (two numbers) and a zoom (a number)")
    def open_session(edition, run, page, reload=False):
        key = "%s/%s/%s" % (edition, run, page)
        if key not in sessions or reload:
            edit = home / "editions" / edition / "runs" / run / ("page-%02d.edit.json" % page)
            rev0 = json.loads(edit.read_text()).get("rev", 0) if edit.exists() else 0   # as the engine keeps it
            s = {"page": page, "edition": edition, "run": run, "rev": rev0}
            rq = json.loads((run_dir(s) / "request.json").read_text())
            s["text"] = {a["id"]: a for a in rq["articles"]}           # the run's text until Update text
            s["folio"] = {k: rq["edition"].get(k, "") for k in ("volume", "issue", "price")}
            s["modules"] = [{"story": "d" + a[2:], "x": 12.82 + 40.69 * (2 * k % 8), "y": 30.0, "w": 2, "h": 100.0,
                             "locked": False, "crop": None} for k, a in enumerate(on_pages(s).get(page, []))]
            sessions[key] = s
        return key, sessions[key]
    answer({"id": 0, "ok": True, "result": {"ready": True}})
    sessions = {}
    for line in sys.stdin:
        req = json.loads(line)
        rid, c = req.get("id"), req.get("cmd")
        try:
            if c == "open":
                if (home / "editions" / req["edition"] / "runs" / req["run"] / "fake-open-slow").exists():
                    time.sleep(1.0)
                key, s = open_session(req["edition"], req["run"], req["page"], req.get("reload"))
                res = dict(draw(s), session=key)
            elif c == "move":                             # as deskedit.PageSession.move_to
                s = session(req)
                check(s, req)
                story, to = req["story"], req["page"]
                m = next((x for x in s["modules"] if x["story"] == story), None)
                if m is None:
                    raise ValueError("%s is not on this page" % story_name(s, story))
                if not isinstance(to, int) or to not in on_pages(s):
                    raise ValueError("this layout has no page %s" % to)
                if to == s["page"]:
                    raise ValueError("%s is on this page already: choose another page" % story_name(s, story))
                if m.get("locked"):
                    raise ValueError("%s is locked: unlock it (Shift+L) to move it" % story_name(s, story))
                held = sorted(n for n, mods in others(s).items()
                              if n != to and any(x["story"] == story and x.get("locked") for x in mods))
                if held:
                    raise ValueError("%s is also on page %d, locked there: unlock it there to move it" % (story_name(s, story), held[0]))
                if (run_dir(s) / "fake-move-slow").exists():
                    time.sleep(1.0)
                _, t = open_session(s["edition"], s["run"], to)
                placed = "already" if any(x["story"] == story for x in t["modules"]) else "free"
                new = dict(m, x=12.82, y=400.0, locked=False)
                if placed == "free" and any(story in o["stories"] for o in overlaps(t["modules"] + [new])):
                    raise ValueError("there is no free place on page %d for %s (%d columns × %g mm): make room there, "
                                     "or narrow it here, then move it" % (to, story_name(s, story), m["w"], m["h"]))
                if placed == "free":                      # the page it goes to is written first
                    t["modules"] = t["modules"] + [new]
                    t["rev"] += 1
                if (run_dir(s) / "fake-move-stops").exists():
                    os._exit(3)
                s["modules"] = [x for x in s["modules"] if x["story"] != story]
                s["rev"] += 1
                res = dict(draw(s), moved={"story": story, "page": to, "rev": t["rev"], "placed": placed, "pinned": None,
                                           "module": next(x for x in t["modules"] if x["story"] == story)})
            elif c == "set":
                s = session(req)
                check(s, req)
                if (run_dir(s) / "fake-set-slow").exists():
                    time.sleep(1.0)
                check_locks(s, req["modules"])
                check_crops(req["modules"])
                s["modules"] = req["modules"]
                s["rev"] += 1
                res = draw(s)
            elif c == "state":
                res = draw(session(req))
                if (run_dir(session(req)) / "fake-state-hides-locks").exists():   # a lock made after the save looked
                    res["locked_on_pages"] = {}
            elif c == "alternative":                      # another layout: every story not locked moves to column 7
                s = session(req)
                check(s, req)
                if s["modules"] and all(m.get("locked") for m in s["modules"]):
                    raise ValueError("every story on this page is locked: unlock one to try another layout")
                s["modules"] = [m if m.get("locked") else dict(m, x=12.82 + 40.69 * 6) for m in s["modules"]]
                s["rev"] += 1
                res = draw(s)
            elif c == "refresh":                          # new text: what changed is read from fake-refresh.json
                s = session(req)
                check(s, req)
                f = run_dir(s) / "fake-refresh.json"
                said = json.loads(f.read_text()) if f.exists() else {}
                ed = home / "editions" / s["edition"]
                live = {a["id"]: a for a in json.loads((ed / "articles.json").read_text())["articles"]}
                mine = ["a-" + m["story"][1:] for m in s["modules"]]
                sig = lambda a: deskprinted.article_sig(a, False) if a else None   # what prints, as the engine compares
                took = [a for a in mine if sig(live.get(a)) != sig(s["text"].get(a))]
                for a in took:
                    s["text"][a] = live.get(a)
                s["modules"] = [m for m in s["modules"] if s["text"].get("a-" + m["story"][1:])]
                folio = {k: json.loads((ed / "edition.json").read_text()).get(k, "") for k in ("volume", "issue", "price")}
                took_folio, s["folio"] = folio != s["folio"], folio
                if said.get("changed") or said.get("dropped") or took or took_folio:
                    s["rev"] += 1
                res = dict(draw(s), changed=said.get("changed", []), dropped=said.get("dropped", []), removed=[], kind_changes=[])
            elif c == "export":
                s = session(req)
                check(s, req)
                held = sorted((v["page"], k) for k, v in where(s).items()
                              if v["locked"] and k in {m["story"] for m in s["modules"]})
                if held:                                  # before anything is written, as the real engine
                    raise ValueError("this page cannot be saved yet: %s is also on page %d, locked there. Unlock it on "
                                     "page %d, or take it off this page, then save" % (story_name(s, held[0][1]), held[0][0], held[0][0]))
                if (run_dir(s) / "fake-export-fails").exists():
                    raise RuntimeError("a fictional disk problem while saving")
                import pikepdf
                pdf = pikepdf.new()
                pdf.add_blank_page(page_size=(400, 600))
                name = "page-%02d.pdf" % s["page"]
                pdf.save(run_dir(s) / name)
                mine = ["a-" + m["story"][1:] for m in s["modules"]]
                stories = {m["story"] for m in s["modules"]}        # taken off what the other pages hold now
                changed = {str(n): ["a-" + x["story"][1:] for x in mods if x["story"] not in stories]
                           for n, mods in others(s).items() if any(x["story"] in stories for x in mods)}
                for n in changed:                         # those pages' editors lose the stories, as the real engine does
                    other = sessions.get("%s/%s/%s" % (s["edition"], s["run"], n))
                    if other is not None:
                        other["modules"] = [m for m in other["modules"] if "a-" + m["story"][1:] not in mine]
                        other["rev"] += 1
                printed = {"v": deskprinted.VERSION,
                           "articles": {a: deskprinted.article_sig(s["text"][a], False) for a in mine if s["text"].get(a)},
                           "folio": deskprinted.folio_sig(s["folio"]) if s["page"] == 1 else None, "ads": {}}
                crops = {"a-" + m["story"][1:]: deskprinted.crop_sig(m["crop"]["photo"], 2000, 1500, [0, 0, 1000, 750])
                         for m in s["modules"] if m.get("crop")}            # the crops it prints (a fictional window)
                if crops:
                    printed["crops"] = crops
                res = {"pdf": name, "sha256": "0" * 64, "rev": s["rev"], "problems": overlaps(s["modules"]), "articles": mine,
                       "pages_changed": changed,
                       "printed": printed}
                if (run_dir(s) / "fake-export-no-printed").exists():    # an engine that records nothing
                    del res["printed"]
            else:
                raise ValueError("unknown command %r" % c)
            answer({"id": rid, "ok": True, "result": res})
        except Exception as e:
            answer({"id": rid, "ok": False, "error": str(e)})
    sys.exit(0)
reply({"error": "unknown command " + cmd}, 1)
'''


def png_bytes(size: tuple[int, int], color=(200, 30, 30, 255), mode: str = "RGBA") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, color).save(buf, "PNG")
    return buf.getvalue()


def jpeg_bytes(size: tuple[int, int], color=(10, 120, 200), orientation: int | None = None) -> bytes:
    buf = io.BytesIO()
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    Image.new("RGB", size, color).save(buf, "JPEG", quality=90, exif=exif)
    return buf.getvalue()


def size_of(path_or_bytes) -> tuple[int, int]:
    src = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, bytes) else path_or_bytes
    with Image.open(src) as img:
        return img.size


def mode_of(path: Path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def words(n: int) -> str:
    return " ".join(["word"] * n)


class Response:
    def __init__(self, status: int, headers: list[tuple[str, str]], body: bytes):
        self.status = status
        self.headers = {k.lower(): v for k, v in headers}
        self.body = body

    def json(self):
        return json.loads(self.body.decode("utf-8"))


# ------------------------------------------------------------------------------------------- unit tests


class TextAndArticleRules(unittest.TestCase):
    def test_clean_text(self):
        self.assertEqual(clean_text("Café  \r\nline two \t\r\n\r\n", "x", 100), "Café\nline two")
        self.assertTrue(unicodedata.is_normalized("NFC", clean_text("क़", "x", 10)))
        self.assertEqual(clean_text("a\x00b\x07c‍d", "x", 10), "abc‍d")       # ZWJ is kept
        self.assertEqual(clean_text(None, "x", 10), "")
        self.assertEqual(clean_text(12, "x", 10), "12")
        with self.assertRaises(DeskError) as e:
            clean_text(["no"], "headline", 10)
        self.assertEqual(e.exception.status, 400)
        with self.assertRaises(DeskError):
            clean_text("x" * 11, "headline", 10)

    def test_word_count_is_the_engines(self):
        # the engine's parser (deskarticles.blocks): paragraphs only; a line starting with ## is a subheading
        self.assertEqual(count_words(""), 0)
        self.assertEqual(count_words("One two.\n\n## A subheading\n\nThree four five."), 5)
        self.assertEqual(count_words("पाऊस आला.\n\n\n## शहर\n\nबातमी"), 3)
        self.assertEqual(count_words("पहिला परिच्छेद.\n## शहर\nदुसरा परिच्छेद."), 4)   # pasted, one paragraph per line

    def test_brief_rule(self):
        self.assertTrue(decorate({"body": words(60), "photo": None})["is_brief"])
        self.assertFalse(decorate({"body": words(61), "photo": None})["is_brief"])
        self.assertFalse(decorate({"body": words(10), "photo": {"id": "p-0123456789"}})["is_brief"])
        self.assertEqual(decorate({"body": words(61), "photo": None})["words"], 61)

    def test_bulk_parser(self):
        text = ("\n\nFirst fictional headline\nByline: A. Writer\n\nFirst paragraph.\n\nSecond paragraph.\r\n"
                "---\n   \n---\n"
                "दुसरी बातमी\n\nवार्ताहर: लेखक\nपहिला परिच्छेद.\n\n## उपशीर्षक\n\nदुसरा.\n"
                " --- \nBYLINE : someone\n\nThe headline line above is the byline marker's headline.\n"
                "---\nOnly a headline\n")
        items = parse_bulk(text)
        self.assertEqual([i["headline"].strip() for i in items],
                         ["First fictional headline", "दुसरी बातमी", "BYLINE : someone", "Only a headline"])
        self.assertEqual(items[0]["byline"], "A. Writer")
        self.assertIn("Second paragraph.", items[0]["body"])
        self.assertEqual(items[1]["byline"], "लेखक")
        self.assertTrue(items[1]["body"].startswith("पहिला"))
        self.assertEqual(items[2]["byline"], "")          # the first line is always the headline
        self.assertEqual(items[3]["body"], "")
        self.assertEqual(parse_bulk("---\n\n---"), [])

    def test_last_json_object(self):
        self.assertEqual(last_json_object('{"a": 1}'), {"a": 1})
        self.assertEqual(last_json_object('noise\n{"error": "x"}\nmore noise'), {"error": "x"})
        self.assertIsNone(last_json_object("no json here"))

    def test_private_modes(self):
        with tempfile.TemporaryDirectory() as tmp:
            d = ensure_dir(Path(tmp) / "a" / "b")
            self.assertEqual(mode_of(d), 0o700)
            self.assertEqual(mode_of(d.parent), 0o700)
            write_json(d / "x.json", {"k": "मराठी"})
            self.assertEqual(mode_of(d / "x.json"), 0o600)
            self.assertEqual(json.loads((d / "x.json").read_text("utf-8")), {"k": "मराठी"})
            self.assertEqual([p.name for p in d.iterdir()], ["x.json"])      # no temporary file left


class ImagePipeline(unittest.TestCase):
    def setUp(self):
        self._icc = os.environ.get("PAGEINATOR_ICC")
        images.rgb_to_cmyk = fake_rgb_to_cmyk

    def tearDown(self):
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK
        if self._icc is None:
            os.environ.pop("PAGEINATOR_ICC", None)
        else:
            os.environ["PAGEINATOR_ICC"] = self._icc

    def test_to_srgb_flattens_and_scales(self):
        self.assertEqual(images.to_srgb(Image.new("RGBA", (2, 2), (255, 0, 0, 0))).getpixel((0, 0)), (255, 255, 255))
        self.assertEqual(images.to_srgb(Image.new("LA", (2, 2), (0, 0))).getpixel((0, 0)), (255, 255, 255))
        self.assertEqual(images.to_srgb(Image.new("I;16", (2, 2), 40000)).getpixel((0, 0)), (156, 156, 156))
        p = Image.new("P", (2, 2), 0)
        p.info["transparency"] = 0
        self.assertEqual(images.to_srgb(p).getpixel((0, 0)), (255, 255, 255))
        self.assertEqual(images.to_srgb(Image.new("CMYK", (2, 2), (0, 0, 0, 0))).mode, "RGB")

    @unittest.skipUnless(DISPLAY_P3.is_file(), "needs the macOS Display P3 profile")
    def test_embedded_profile_is_converted_to_srgb(self):
        plain = Image.new("RGB", (2, 2), (200, 60, 40))
        tagged = plain.copy()
        tagged.info["icc_profile"] = DISPLAY_P3.read_bytes()
        self.assertEqual(images.to_srgb(plain).getpixel((0, 0)), (200, 60, 40))
        self.assertNotEqual(images.to_srgb(tagged).getpixel((0, 0)), (200, 60, 40))   # P3 is wider than sRGB

    def test_previews_carry_no_comment_or_other_metadata(self):
        """Pillow's JPEG writer copies a picture's comment unless told not to: a JPEG COM segment or a PNG comment
        must not reach the preview (it can hold a place or a name)."""
        from PIL import PngImagePlugin
        jpeg = io.BytesIO()
        Image.new("RGB", (50, 40), (200, 30, 30)).save(jpeg, "JPEG", comment=b"fictional place 18.52 73.85")
        info = PngImagePlugin.PngInfo()
        info.add_text("comment", "fictional place 18.52 73.85")
        png = io.BytesIO()
        Image.new("RGB", (50, 40), (200, 30, 30)).save(png, "PNG", pnginfo=info)
        for data in (jpeg.getvalue(), png.getvalue()):
            preview = images.convert_photo(data).preview
            self.assertNotIn(b"18.52", preview)
            at, markers = 2, []                                          # the segments before the picture data
            while preview[at] == 0xFF and preview[at + 1] != 0xDA:
                markers.append(preview[at + 1])
                at += 2 + int.from_bytes(preview[at + 2:at + 4], "big")
            self.assertFalse({0xE1, 0xE2, 0xED, 0xFE} & set(markers), [hex(m) for m in markers])

    def test_photo_is_scaled_never_enlarged_and_rotated(self):
        big = images.convert_photo(jpeg_bytes((4400, 3000)))
        self.assertEqual((big.width, big.height), (2000, 1364))
        self.assertEqual(big.ext, "jpg")
        self.assertEqual(size_of(big.preview), (1600, 1091))
        self.assertEqual(len(gzip.decompress(big.cmyk_gz)), 2000 * 1364 * 4)
        self.assertEqual(big.cmyk_gz[4:8], b"\0\0\0\0")                    # gzip mtime 0
        small = images.convert_photo(png_bytes((300, 200)))
        self.assertEqual((small.width, small.height), (300, 200))
        turned = images.convert_photo(jpeg_bytes((300, 100), orientation=6))
        self.assertEqual((turned.width, turned.height), (100, 300))

    def test_running_out_of_memory_is_not_a_damaged_picture(self):
        from unittest import mock
        from PIL import ImageFile
        with mock.patch.object(ImageFile.ImageFile, "load", side_effect=MemoryError):
            with self.assertRaises(MemoryError):
                images.convert_photo(jpeg_bytes((300, 200)))

    def test_bad_uploads(self):
        for data, status in ((b"", 400), (b"not a picture at all", 400), (jpeg_bytes((50, 50))[:200], 400)):
            with self.assertRaises(DeskError) as e:
                images.convert_photo(data)
            self.assertEqual(e.exception.status, status)
        gif = io.BytesIO()
        Image.new("RGB", (4, 4)).save(gif, "GIF")
        with self.assertRaises(DeskError) as e:
            images.convert_photo(gif.getvalue())
        self.assertIn("GIF", e.exception.message)

    def test_ad_canvas_keeps_the_slot_shape(self):
        red = Image.new("RGB", (400, 400), (255, 0, 0))
        canvas = images.ad_canvas(red, 100.0, 50.0)                  # 100 x 50 mm at 200 ppi = 787 x 394
        self.assertEqual(canvas.size, (787, 394))
        self.assertEqual(canvas.getpixel((5, 197)), (255, 255, 255))
        self.assertEqual(canvas.getpixel((393, 197)), (255, 0, 0))
        tiny = images.ad_canvas(Image.new("RGB", (50, 50), (0, 0, 255)), 100.0, 50.0)
        self.assertEqual(tiny.size, (100, 50))                         # not enlarged: same shape, lower ppi
        self.assertEqual(tiny.getpixel((50, 25)), (0, 0, 255))
        self.assertEqual(tiny.getpixel((2, 25)), (255, 255, 255))

    def test_preview_from_a_stored_raster(self):
        raw = Image.new("CMYK", (30, 20), (0, 255, 255, 0)).tobytes()
        jpg = images.preview_from_cmyk_gz(gzip.compress(raw, mtime=0), 30, 20)
        with Image.open(io.BytesIO(jpg)) as img:
            self.assertEqual((img.format, img.size), ("JPEG", (30, 20)))
        with self.assertRaises(DeskError):
            images.preview_from_cmyk_gz(gzip.compress(raw, mtime=0), 31, 20)

    def test_a_raster_pruned_while_it_is_read_is_not_found(self):
        with tempfile.TemporaryDirectory() as home:
            d = Path(home) / "cache" / "rasters"
            d.mkdir(parents=True)
            key = "0123456789abcdef01234567"
            write_json(d / f"{key}.json", {"width_px": 3, "height_px": 2})
            (d / f"{key}.cmyk").write_bytes(bytes(24))
            service = editing.EditService(None, Path(home))
            self.assertEqual(service.raster(key).name, f"{key}.jpg")      # whole: its picture is made
            (d / f"{key}.jpg").unlink()
            real = Path.read_bytes
            def gone(path):                                            # deskedit.prune_rasters, after the check
                if path.suffix == ".cmyk":
                    raise FileNotFoundError(path)
                return real(path)
            with unittest.mock.patch.object(Path, "read_bytes", gone), self.assertRaises(DeskError) as e:
                service.raster(key)
            self.assertEqual(e.exception.status, 404)

    def test_missing_profile_is_a_clear_error(self):
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK
        os.environ["PAGEINATOR_ICC"] = str(Path(tempfile.gettempdir()) / "no-such-profile-for-desk-tests.icc")
        with self.assertRaises(DeskError) as e:
            images.convert_photo(png_bytes((20, 20)))
        self.assertEqual(e.exception.status, 500)
        self.assertIn("colour profile is missing", e.exception.message)

    @unittest.skipUnless(DISPLAY_P3.is_file(), "needs the macOS Display P3 profile")
    def test_a_non_cmyk_profile_is_refused(self):
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK
        os.environ["PAGEINATOR_ICC"] = str(DISPLAY_P3)
        with self.assertRaises(DeskError) as e:
            images.convert_photo(png_bytes((20, 20)))
        self.assertIn("CMYK printer profile", e.exception.message)

    @unittest.skipUnless(GENERIC_CMYK.is_file(), "needs the macOS Generic CMYK profile")
    def test_real_littlecms_transform(self):
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK
        os.environ["PAGEINATOR_ICC"] = str(GENERIC_CMYK)
        img = Image.new("RGB", (20, 10), (255, 255, 255))
        img.paste((0, 0, 0), (10, 0, 20, 10))
        buf = io.BytesIO()
        img.save(buf, "PNG")
        conv = images.convert_photo(buf.getvalue())
        cmyk = Image.frombytes("CMYK", (20, 10), gzip.decompress(conv.cmyk_gz))
        self.assertEqual(cmyk.getpixel((2, 5)), (0, 0, 0, 0))            # paper white stays unprinted
        self.assertGreater(cmyk.getpixel((15, 5))[3], 150)               # black has a strong K
        self.assertIs(images._transform(), images._transform())          # built once, then cached


class RunOutputs(unittest.TestCase):
    def test_merge_and_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            paths = []
            for n in (1, 2):
                pdf = pikepdf.new()
                pdf.add_blank_page(page_size=(200, 300))
                pdf.Root.OutputIntents = pikepdf.Array([pikepdf.Dictionary(
                    Type=pikepdf.Name.OutputIntent, S=pikepdf.Name.GTS_PDFX, OutputConditionIdentifier="Test")])
                pdf.save(tmp / f"page-0{n}.pdf")
                paths.append(tmp / f"page-0{n}.pdf")
            jobs.merge_pdfs(paths, tmp / "edition.pdf")
            with pikepdf.open(tmp / "edition.pdf") as merged:
                self.assertEqual(len(merged.pages), 2)
                self.assertIn("/OutputIntents", merged.Root)
            jobs.zip_pdfs(paths, tmp / "a.zip")
            time.sleep(0.01)
            jobs.zip_pdfs(paths, tmp / "b.zip")
            self.assertEqual((tmp / "a.zip").read_bytes(), (tmp / "b.zip").read_bytes())   # deterministic
            with zipfile.ZipFile(tmp / "a.zip") as zf:
                self.assertEqual(zf.namelist(), ["page-01.pdf", "page-02.pdf"])
                self.assertTrue(all(i.compress_type == zipfile.ZIP_STORED for i in zf.infolist()))
                self.assertEqual(zf.read("page-02.pdf"), paths[1].read_bytes())
            jobs.render_page(paths[0], tmp / "p.png", tmp / "p.thumb.png")
            self.assertEqual(size_of(tmp / "p.png"), (1200, 1800))
            self.assertEqual(size_of(tmp / "p.thumb.png"), (240, 360))
            self.assertEqual(mode_of(tmp / "edition.pdf"), 0o600)


# ------------------------------------------------------------------------------------ server test harness


class DeskCase(unittest.TestCase):
    """A Desk server for the test class: temporary home, fake engine, fake colour conversion, ephemeral port."""

    run_setup = True
    measure_delay = 3600.0          # background measuring stays out of the way unless a class wants it

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="desk-test-")).resolve()
        cls.home = cls.tmp / "home"
        engine = cls.tmp / "fake_engine.py"
        engine.write_text(f"ENGINE_DIR = {str(REPO / 'tools/desk/engine')!r}\n" + FAKE_ENGINE, encoding="utf-8")
        cls.static = cls.tmp / "static"
        (cls.static / "img").mkdir(parents=True)
        (cls.static / "index.html").write_text("<!doctype html><title>Desk test page</title>", encoding="utf-8")
        (cls.static / "app.js").write_text("console.log('desk');", encoding="utf-8")
        (cls.static / "app.css").write_text("body{}", encoding="utf-8")
        (cls.static / "img" / "mark.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>", encoding="utf-8")
        (cls.static / "icon.png").write_bytes(png_bytes((4, 4)))
        (cls.tmp / "secret.txt").write_text("outside the static folder", encoding="utf-8")
        (cls.static / "leak.txt").symlink_to(cls.tmp / "secret.txt")
        cls._env = {k: os.environ.get(k) for k in ENV_KEYS}
        os.environ["PAGEINATOR_ORACLE_PY"] = sys.executable
        os.environ["PAGEINATOR_DESK_ENGINE"] = str(engine)
        os.environ["PAGEINATOR_ICC"] = str(cls.tmp / "no-profile.icc")
        images.rgb_to_cmyk = fake_rgb_to_cmyk
        cls.pdfx_verdicts: dict[str, dict] = {}       # page PDF name -> verdict; the real checker needs real PDF/X files
        cls._check_pdfx = staticmethod(jobs.check_pdfx)
        jobs.check_pdfx = lambda root, pdf: cls.pdfx_verdicts.get(pdf.name, {"passed": True, "fails": 0, "warnings": 0})
        cls.logs: list[str] = []
        cls._log, cls._log_message = api.Handler._log, api.Handler.log_message
        api.Handler._log = lambda self, method, path, start: cls.logs.append(f"{method} {path} {self._code}")
        api.Handler.log_message = lambda self, fmt, *args: cls.logs.append(fmt % args)
        cls.desk = Desk(cls.home, static_dir=cls.static, poll_interval=0.1, kill_after=1.0,
                        measure_delay=cls.measure_delay)
        cls.measure_log: list[str] = []
        cls.desk.measurer.log = cls.measure_log.append
        cls.server = cls.desk.serve(0)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        cls.thread.start()
        if cls.run_setup:
            cls.call("POST", "/api/setup", {})

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.desk.close()
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK
        jobs.check_pdfx = cls._check_pdfx
        api.Handler._log, api.Handler.log_message = cls._log, cls._log_message
        for key, value in cls._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(cls.tmp, ignore_errors=True)

    @classmethod
    def call(cls, method: str, path: str, body=None, *, raw: bytes | None = None, headers: dict | None = None,
             host: str | None = None, expect: int | None = 200) -> Response:
        conn = http.client.HTTPConnection("127.0.0.1", cls.port, timeout=60)
        h = {"Host": f"127.0.0.1:{cls.port}" if host is None else host}
        if method != "GET":
            h["X-Desk"] = "1"
        data = raw
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        h = {k: v for k, v in h.items() if v is not None}
        conn.request(method, path, body=data, headers=h)
        resp = conn.getresponse()
        result = Response(resp.status, resp.getheaders(), resp.read())
        conn.close()
        if expect is not None and result.status != expect:
            raise AssertionError(f"{method} {path}: expected {expect}, got {result.status}: {result.body[:500]!r}")
        return result

    def edition(self, day: str, **fields) -> str:
        return self.call("POST", "/api/editions", {"date": day, "pages": 8, **fields}).json()["id"]

    def article(self, eid: str, **fields) -> dict:
        body = {"headline": "A fictional headline", "body": "Some fictional text.", **fields}
        return self.call("POST", f"/api/editions/{eid}/articles", body).json()

    def edition_dir(self, eid: str) -> Path:
        return self.home / "editions" / eid

    def engine_calls(self, command: str, eid: str | None = None) -> int:
        path = self.home / "fake-engine-calls.txt"
        lines = path.read_text().splitlines() if path.exists() else []
        return sum(1 for line in lines if line.split()[0] == command and (eid is None or line.split()[1] == eid))

    def measure_state(self, eid: str):
        return self.call("GET", f"/api/editions/{eid}").json()["measure"]

    def wait_for(self, check, timeout: float = 30.0, what: str = "a condition"):
        deadline = time.monotonic() + timeout
        while True:
            value = check()
            if value:
                return value
            if time.monotonic() > deadline:
                self.fail(f"timed out waiting for {what}")
            time.sleep(0.05)

    def run_status(self, eid: str, rid: str) -> dict:
        return self.call("GET", f"/api/editions/{eid}/runs/{rid}").json()

    def wait_run(self, eid: str, rid: str, states=("done", "failed", "cancelled"), finished: bool = True) -> dict:
        def check():
            st = self.run_status(eid, rid)
            return st if st["state"] in states and (not finished or st.get("finished")) else None
        return self.wait_for(check, what=f"run {rid} to reach {states}")


# ------------------------------------------------------------------------------------------- set-up flow


class SetupFlow(DeskCase):
    run_setup = False

    def test_status_plan_and_setup(self):
        st = self.call("GET", "/api/status").json()
        self.assertEqual(set(st) - {"icc_ok"}, {"version", "engine_ok", "config_ok", "home", "cores", "message"})
        self.assertTrue(st["engine_ok"])
        self.assertFalse(st["config_ok"])
        self.assertIn("setup", st["message"])
        self.assertEqual(st["home"], str(self.home))
        self.assertGreaterEqual(st["cores"], 1)
        self.assertFalse(st["icc_ok"])
        r = self.call("GET", "/api/plan?pages=8&back_ads=1", expect=500)
        self.assertIn("run setup first", r.json()["error"])
        eid = self.edition("2026-01-05")
        got = self.call("GET", f"/api/editions/{eid}").json()          # the edition still opens without a plan
        self.assertIsNone(got["plan"])
        self.assertIn("setup", got["plan_error"])
        self.call("POST", "/api/setup", {"dataset": str(self.tmp / "nowhere")}, expect=400)
        result = self.call("POST", "/api/setup", {"dataset": str(self.tmp)}).json()
        self.assertEqual(result, {"config": {"templates": 3}})
        self.assertEqual(json.loads((self.home / "config.json").read_text())["dataset"], str(self.tmp))
        st = self.call("GET", "/api/status").json()
        self.assertTrue(st["config_ok"])
        plan = self.call("GET", "/api/plan?pages=4&back_ads=0").json()
        self.assertEqual([p["role"] for p in plan["pages"]], ["front", "inside", "inside", "back"])

    def test_missing_engine(self):
        desk = Desk(self.tmp / "other-home", static_dir=self.static)
        try:
            desk.engine.script = self.tmp / "missing_engine.py"
            self.assertFalse(desk.engine.ok())
            self.assertIn("missing", desk.engine.missing_message())
            with self.assertRaises(DeskError) as e:
                desk.engine.plan(8, True)
            self.assertEqual(e.exception.status, 500)
        finally:
            desk.close()

    def test_home_inside_the_repository_is_refused(self):
        with self.assertRaises(DeskError):
            Desk(Path(__file__).resolve().parent / "not-a-home")


# --------------------------------------------------------------------------------------------- the API


class ApiTests(DeskCase):
    def test_editions_crud(self):
        made = self.call("POST", "/api/editions", {"date": "2026-10-21", "pages": 8, "back_page_ads": True,
                                                    "volume": "12", "issue": "345", "price": "5"}).json()
        self.assertEqual(made["id"], "2026-10-21")
        self.assertEqual(made["schema"], "pageinator.desk.edition/1")
        self.assertEqual((made["pages"], made["back_page_ads"], made["volume"], made["issue"], made["price"]),
                         (8, True, "12", "345", "5"))
        self.assertEqual(self.edition("2026-10-21"), "2026-10-21-2")
        self.assertEqual(self.edition("2026-10-21"), "2026-10-21-3")
        listed = [e for e in self.call("GET", "/api/editions").json()["editions"] if e["date"] == "2026-10-21"]
        self.assertEqual([e["id"] for e in listed], ["2026-10-21-3", "2026-10-21-2", "2026-10-21"])
        self.assertEqual(listed[0], {"id": "2026-10-21-3", "date": "2026-10-21", "pages": 8, "articles": 0,
                                     "words": 0, "photos": 0, "last_run": None})
        d = self.edition_dir("2026-10-21")
        self.assertEqual(mode_of(d), 0o700)
        self.assertEqual(mode_of(d / "edition.json"), 0o600)
        self.assertEqual(mode_of(d / "articles.json"), 0o600)
        changed = self.call("PUT", "/api/editions/2026-10-21", {"pages": 4, "volume": "13", "id": "ignored"}).json()
        self.assertEqual((changed["id"], changed["pages"], changed["volume"]), ("2026-10-21", 4, "13"))
        self.call("PUT", "/api/editions/2026-10-21", {"date": "2026-10-22"}, expect=400)
        self.call("PUT", "/api/editions/2026-10-21", {"pages": 12}, expect=400)
        got = self.call("GET", "/api/editions/2026-10-21").json()
        self.assertEqual(set(got), {"edition", "articles", "ads", "plan", "plan_error", "runs", "measure"})
        self.assertIsNone(got["measure"])
        self.assertEqual(len(got["plan"]["pages"]), 4)
        self.assertEqual((got["articles"], got["ads"], got["runs"]), ([], {}, []))
        self.assertEqual(self.call("DELETE", "/api/editions/2026-10-21-3").json(), {"ok": True})
        self.call("GET", "/api/editions/2026-10-21-3", expect=404)
        self.assertFalse(self.edition_dir("2026-10-21-3").exists())
        trash = [p.name for p in (self.home / "trash").iterdir()]
        self.assertEqual(len([n for n in trash if n.startswith("2026-10-21-3-")]), 1)
        self.call("GET", "/api/editions/2026-12-32", expect=404)

    def test_edition_validation(self):
        for body in ({"date": "2026-02-30"}, {"date": "21-10-2026"}, {"date": "20261021"}, {},
                     {"date": "2026-04-01", "pages": 5}, {"date": "2026-04-01", "pages": True},
                     {"date": "2026-04-01", "back_page_ads": "yes"}, {"date": "2026-04-01", "volume": ["x"]}):
            r = self.call("POST", "/api/editions", body, expect=400)
            self.assertIn("error", r.json())
        self.call("POST", "/api/editions", raw=b"[1, 2]", expect=400)
        self.call("POST", "/api/editions", raw=b"{not json", expect=400)
        self.call("POST", "/api/editions", raw=b"x" * (2 * 1024 * 1024 + 1), expect=413)
        self.assertEqual(self.call("POST", "/api/editions", {"date": "2026-04-01", "pages": "16"}).json()["pages"], 16)

    def test_articles_crud(self):
        eid = self.edition("2026-03-02")
        a = self.article(eid, headline="Café headline  ", kicker="  Kicker ",
                         body="First line   \r\nsame paragraph.\r\n\r\n## A subheading\r\n\r\nपाऊस आला.  ")
        self.assertRegex(a["id"], r"^a-[0-9a-f]{10}$")
        self.assertEqual(a["headline"], "Café headline")
        self.assertEqual(a["kicker"], "Kicker")
        self.assertEqual(a["body"], "First line\nsame paragraph.\n\n## A subheading\n\nपाऊस आला.")
        self.assertEqual((a["priority"], a["page"], a["photo"], a["source"]), (3, None, None, "typed"))
        self.assertEqual((a["words"], a["is_brief"]), (6, True))      # the subheading is not a body word
        self.call("POST", f"/api/editions/{eid}/articles", {"headline": "x"}, expect=400)
        self.call("POST", f"/api/editions/{eid}/articles", {"body": "x"}, expect=400)
        self.call("POST", f"/api/editions/{eid}/articles", {"headline": "x", "body": "y", "priority": 7}, expect=400)
        self.call("POST", f"/api/editions/{eid}/articles", {"headline": "x", "body": "y", "page": 9}, expect=400)
        long = self.article(eid, body=words(61), page="3", priority=1, source="pasted")
        self.assertEqual((long["page"], long["priority"], long["is_brief"], long["source"]), (3, 1, False, "pasted"))
        url = f"/api/editions/{eid}/articles/{a['id']}"
        changed = self.call("PUT", url, {"priority": 2, "page": 8, "words": 999}).json()
        self.assertEqual((changed["priority"], changed["page"], changed["headline"], changed["words"]),
                         (2, 8, "Café headline", 6))
        self.assertEqual(self.call("PUT", url, {"page": None}).json()["page"], None)
        self.call("PUT", url, {"headline": "   "}, expect=400)
        self.call("PUT", f"/api/editions/{eid}/articles/a-0000000000", {"priority": 2}, expect=404)
        self.call("PUT", f"/api/editions/{eid}/articles/not-an-id", {"priority": 2}, expect=404)
        got = self.call("GET", f"/api/editions/{eid}").json()
        self.assertEqual([x["id"] for x in got["articles"]], [a["id"], long["id"]])
        self.assertTrue(all("words" in x and "is_brief" in x for x in got["articles"]))
        self.assertEqual(self.call("DELETE", url).json(), {"ok": True})
        self.call("DELETE", url, expect=404)
        self.assertEqual([x["id"] for x in self.call("GET", f"/api/editions/{eid}").json()["articles"]], [long["id"]])
        summary = next(e for e in self.call("GET", "/api/editions").json()["editions"] if e["id"] == eid)
        self.assertEqual((summary["articles"], summary["words"], summary["photos"]), (1, 61, 0))

    def test_bulk_paste(self):
        eid = self.edition("2026-03-03")
        text = ("First fictional story\r\nByline: A. Writer\r\n\r\nIts text.\r\n---\r\n\r\n---\r\n"
                "दुसरी बातमी\n\nवार्ताहर: लेखक\nपहिला परिच्छेद.\n\n## उपशीर्षक\n\nदुसरा.\n---\nNo text here\n")
        r = self.call("POST", f"/api/editions/{eid}/articles/bulk", {"text": text}).json()
        self.assertEqual(r["created"], 2)
        self.assertEqual([(a["headline"], a["byline"], a["source"]) for a in r["articles"]],
                         [("First fictional story", "A. Writer", "pasted"), ("दुसरी बातमी", "लेखक", "pasted")])
        self.assertEqual(r["articles"][0]["body"], "Its text.")
        self.assertEqual(r["articles"][1]["words"], 3)
        self.assertEqual(r["skipped"], [{"headline": "No text here", "reason": "Every article needs some text."}])
        self.assertEqual(len(self.call("GET", f"/api/editions/{eid}").json()["articles"]), 2)
        self.call("POST", f"/api/editions/{eid}/articles/bulk", {"text": "---\n\n---\n"}, expect=400)
        self.call("POST", f"/api/editions/{eid}/articles/bulk", {}, expect=400)
        self.call("POST", f"/api/editions/{eid}/articles/bulk", {"text": 5}, expect=400)

    def test_photo_upload_replace_and_remove(self):
        eid = self.edition("2026-03-04")
        a = self.article(eid)
        url = f"/api/editions/{eid}/articles/{a['id']}/photo"
        img = Image.new("RGBA", (3000, 1500), (200, 30, 30, 255))
        img.paste((0, 0, 0, 0), (0, 0, 300, 1500))                     # a transparent strip
        buf = io.BytesIO()
        img.save(buf, "PNG")
        upload = buf.getvalue()
        caption = "चित्र: a fictional caption"
        photo = self.call("PUT", f"{url}?caption={quote(caption)}&credit=Desk%20test", raw=upload,
                          headers={"Content-Type": "image/png"}).json()
        pid = photo["id"]
        self.assertRegex(pid, r"^p-[0-9a-f]{10}$")
        self.assertEqual(photo, {"id": pid, "caption": caption, "credit": "Desk test", "width_px": 2000,
                                 "height_px": 1000})
        pdir = self.edition_dir(eid) / "photos"
        self.assertEqual((pdir / f"{pid}.orig.png").read_bytes(), upload)
        self.assertEqual(size_of(pdir / f"{pid}.jpg"), (1600, 800))
        gz = (pdir / f"{pid}.cmyk.gz").read_bytes()
        self.assertEqual(gz[4:8], b"\0\0\0\0")
        cmyk = Image.frombytes("CMYK", (2000, 1000), gzip.decompress(gz))
        self.assertEqual(cmyk.getpixel((50, 500)), (0, 0, 0, 0))          # transparent -> paper white
        self.assertEqual(cmyk.getpixel((1500, 500)), (55, 225, 225, 0))   # (200, 30, 30) under the stand-in transform
        index = json.loads((pdir / "index.json").read_text())
        self.assertEqual(index, {"elements": {pid: {"width_px": 2000, "height_px": 1000, "ppi": None}}})
        self.assertEqual({mode_of(p) for p in pdir.iterdir()}, {0o600})
        self.assertEqual(mode_of(pdir), 0o700)
        got = self.call("GET", f"/files/{eid}/photos/{pid}.jpg")
        self.assertEqual(got.headers["content-type"], "image/jpeg")
        art = self.call("GET", f"/api/editions/{eid}").json()["articles"][0]
        self.assertEqual((art["photo"]["id"], art["is_brief"]), (pid, False))
        self.assertTrue(all(caption not in line for line in self.logs))  # query strings are not logged
        # replace: a JPEG turned by its EXIF orientation; caption and credit are kept
        photo2 = self.call("PUT", url, raw=jpeg_bytes((300, 100), orientation=6)).json()
        pid2 = photo2["id"]
        self.assertNotEqual(pid2, pid)
        self.assertEqual((photo2["width_px"], photo2["height_px"], photo2["caption"]), (100, 300, caption))
        self.assertEqual(sorted(p.name for p in pdir.iterdir()),
                         sorted([f"{pid2}.orig.jpg", f"{pid2}.jpg", f"{pid2}.cmyk.gz", "index.json"]))
        self.assertEqual(list(json.loads((pdir / "index.json").read_text())["elements"]), [pid2])
        text = self.call("PUT", f"{url}-text", {"caption": "  New caption ", "credit": ""}).json()
        self.assertEqual((text["caption"], text["credit"], text["id"]), ("New caption", "", pid2))
        self.call("PUT", url, raw=b"this is not a picture", expect=400)
        self.call("PUT", url, raw=b"", expect=400)
        self.call("PUT", url, raw=b"\0" * (40 * 1024 * 1024 + 1), expect=413)
        self.call("PUT", f"/api/editions/{eid}/articles/a-0000000000/photo", raw=png_bytes((10, 10)), expect=404)
        self.assertEqual(self.call("DELETE", url).json(), {"ok": True})
        self.assertEqual([p.name for p in pdir.iterdir()], ["index.json"])
        self.assertEqual(json.loads((pdir / "index.json").read_text())["elements"], {})
        self.assertIsNone(self.call("GET", f"/api/editions/{eid}").json()["articles"][0]["photo"])
        self.call("PUT", f"{url}-text", {"caption": "x"}, expect=404)
        self.call("GET", f"/files/{eid}/photos/{pid2}.jpg", expect=404)
        # deleting an article removes its photo's files too
        self.call("PUT", url, raw=png_bytes((40, 30)))
        self.call("DELETE", f"/api/editions/{eid}/articles/{a['id']}")
        self.assertEqual([p.name for p in pdir.iterdir()], ["index.json"])

    def test_missing_colour_profile(self):
        eid = self.edition("2026-03-05")
        a = self.article(eid)
        images.rgb_to_cmyk = REAL_RGB_TO_CMYK                           # the real conversion, no profile
        try:
            r = self.call("PUT", f"/api/editions/{eid}/articles/{a['id']}/photo", raw=png_bytes((20, 20)), expect=500)
        finally:
            images.rgb_to_cmyk = fake_rgb_to_cmyk
        self.assertIn("colour profile is missing", r.json()["error"])
        self.assertEqual([p.name for p in (self.edition_dir(eid) / "photos").iterdir()], [])

    def test_ads(self):
        eid = self.edition("2026-03-06")
        r = self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=png_bytes((400, 400), (255, 0, 0, 255))).json()
        self.assertEqual(r, {"slot": "back-1", "w_px": 787, "h_px": 394})
        adir = self.edition_dir(eid) / "ads"
        self.assertEqual(sorted(p.name for p in adir.iterdir()),
                         ["back-1.cmyk.gz", "back-1.jpg", "back-1.orig.png", "index.json"])
        cmyk = Image.frombytes("CMYK", (787, 394), gzip.decompress((adir / "back-1.cmyk.gz").read_bytes()))
        self.assertEqual(cmyk.getpixel((5, 197)), (0, 0, 0, 0))            # white around the ad
        self.assertEqual(cmyk.getpixel((393, 197)), (0, 255, 255, 0))
        self.assertEqual(json.loads((adir / "index.json").read_text()),
                         {"elements": {"back-1": {"width_px": 787, "height_px": 394, "ppi": None}}})
        ads = self.call("GET", f"/api/editions/{eid}").json()["ads"]
        self.assertEqual((ads["back-1"]["w_px"], ads["back-1"]["h_px"], ads["back-1"]["slot"]), (787, 394, "back-1"))
        self.assertEqual(self.call("GET", f"/files/{eid}/ads/back-1.jpg").headers["content-type"], "image/jpeg")
        small = self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=jpeg_bytes((50, 50))).json()
        self.assertEqual((small["w_px"], small["h_px"]), (100, 50))
        self.assertEqual(sorted(p.name for p in adir.iterdir()),
                         ["back-1.cmyk.gz", "back-1.jpg", "back-1.orig.jpg", "index.json"])
        self.call("PUT", f"/api/editions/{eid}/ads/inside-9", raw=png_bytes((10, 10)), expect=404)
        self.call("PUT", f"/api/editions/{eid}/ads/Back_1", raw=png_bytes((10, 10)), expect=404)
        self.assertEqual(self.call("DELETE", f"/api/editions/{eid}/ads/back-1").json(), {"ok": True})
        self.assertEqual([p.name for p in adir.iterdir()], ["index.json"])
        self.call("GET", f"/files/{eid}/ads/back-1.jpg", expect=404)
        no_ads = self.edition("2026-03-07", back_page_ads=False)
        self.call("PUT", f"/api/editions/{no_ads}/ads/back-1", raw=png_bytes((10, 10)), expect=404)

    def test_lazy_preview_for_engine_imported_photos(self):
        eid = self.edition("2026-03-08")
        pdir = self.edition_dir(eid) / "photos"
        raw = Image.new("CMYK", (120, 80), (0, 200, 200, 0)).tobytes()
        (pdir / "p-00000000ab.cmyk.gz").write_bytes(gzip.compress(raw, mtime=0))
        write_json(pdir / "index.json", {"elements": {"p-00000000ab": {"width_px": 120, "height_px": 80, "ppi": None}}})
        r = self.call("GET", f"/files/{eid}/photos/p-00000000ab.jpg")
        self.assertEqual(r.headers["content-type"], "image/jpeg")
        self.assertEqual(size_of(r.body), (120, 80))
        self.assertTrue((pdir / "p-00000000ab.jpg").is_file())
        self.call("GET", f"/files/{eid}/photos/p-00000000ac.jpg", expect=404)

    def test_samples_and_import(self):
        self.assertEqual(self.call("GET", "/api/samples").json()["samples"][0]["name"], "sample-one")
        eid = self.edition("2026-03-09")
        r = self.call("POST", f"/api/editions/{eid}/import-sample", {"samples": ["sample-one"]}).json()
        self.assertEqual(r, {"imported": 1, "photos": 0})
        arts = self.call("GET", f"/api/editions/{eid}").json()["articles"]
        self.assertEqual([(a["source"], a["words"], a["is_brief"]) for a in arts], [("sample:sample-one", 5, True)])
        self.call("POST", f"/api/editions/{eid}/import-sample", {"samples": ["no-such-sample"]}, expect=400)
        self.call("POST", f"/api/editions/{eid}/import-sample", {"samples": ["--home"]}, expect=400)
        self.call("POST", f"/api/editions/{eid}/import-sample", {"samples": []}, expect=400)
        self.call("POST", "/api/editions/2026-01-01/import-sample", {"samples": ["sample-one"]}, expect=404)

    def test_plan_is_cached(self):
        p1 = self.call("GET", "/api/plan?pages=16&back_ads=1").json()
        before = self.engine_calls("plan")
        p2 = self.call("GET", "/api/plan?pages=16&back_ads=1").json()
        self.assertEqual(p1, p2)
        self.assertEqual(len(p1["pages"]), 16)
        self.assertEqual(p1["pages"][-1]["ad_slots"], [{"slot": "back-1", "w_mm": 100.0, "h_mm": 50.0}])
        self.assertEqual(self.engine_calls("plan"), before)                # the second answer came from the cache
        self.call("GET", "/api/plan?pages=5", expect=400)
        self.call("GET", "/api/plan?pages=8&back_ads=maybe", expect=400)

    def test_status(self):
        st = self.call("GET", "/api/status").json()
        self.assertTrue(st["engine_ok"] and st["config_ok"])
        self.assertIn("colour profile", st["message"])                  # no profile in the test home

    def test_security_checks(self):
        r = self.call("POST", "/api/editions", {"date": "2026-05-01"}, headers={"X-Desk": None}, expect=403)
        self.assertIn("error", r.json())
        self.call("POST", "/api/editions", {"date": "2026-05-01"}, headers={"X-Desk": "0"}, expect=403)
        self.call("DELETE", "/api/editions/2026-05-01", headers={"X-Desk": None}, expect=403)
        self.call("PUT", "/api/editions/2026-05-01", {"pages": 4}, headers={"X-Desk": None}, expect=403)
        for host in ("evil.example", f"evil.example:{self.port}", "127.0.0.1", f"127.0.0.1:{self.port + 1}",
                     f"127.0.0.1.evil.example:{self.port}", ""):
            r = self.call("GET", "/api/status", host=host, expect=403)
            self.assertIn("error", r.json())
        self.call("GET", "/api/status", host=f"localhost:{self.port}")
        self.call("GET", "/api/status", host=f"LOCALHOST:{self.port}")
        self.call("POST", "/api/editions", {"date": "2026-05-01"}, headers={"Origin": "http://evil.example"},
                  expect=403)
        self.call("POST", "/api/editions", {"date": "2026-05-01"}, headers={"Origin": f"http://localhost:{self.port}"})
        r = self.call("OPTIONS", "/api/editions", headers={"Origin": "http://evil.example",
                                                           "Access-Control-Request-Method": "POST"}, expect=405)
        self.assertNotIn("access-control-allow-origin", r.headers)
        r = self.call("OPTIONS", "/api/editions", expect=405)
        self.assertNotIn("access-control-allow-origin", r.headers)
        self.call("GET", "/api/editions", expect=200)
        self.call("POST", "/api/status", {}, expect=405)
        self.call("GET", "/api/nothing-here", expect=404)

    def test_path_traversal_is_refused(self):
        eid = self.edition("2026-05-02")
        self.article(eid)
        run_dir = self.edition_dir(eid) / "runs" / "r-20260101-000000"
        run_dir.mkdir()
        for name in ("request.json", "engine.log", "status.json"):
            (run_dir / name).write_text("{}")
        for path in (f"/files/{eid}/photos/../edition.json", f"/files/{eid}/photos/..%2Fedition.json",
                     f"/files/{eid}/photos/..%2F..%2F..%2Fconfig.json", "/files/..%2F..%2F/photos/p-0123456789.jpg",
                     f"/files/{eid}/../../config.json", f"/files/{eid}/runs/r-20260101-000000/request.json",
                     f"/files/{eid}/runs/r-20260101-000000/engine.log",
                     f"/files/{eid}/runs/r-20260101-000000/..%2Fedition.json",
                     f"/files/{eid}/runs/..%2F..%2F/edition.pdf", f"/files/{eid}/ads/..%2Fedition.json",
                     f"/files/{eid}/ads/back-1.jpg%00", f"/files/{eid}%2F..%2F..%2Fconfig.json/photos/p-0123456789.jpg",
                     "/static/../server.py", "/static/%2e%2e/%2e%2e/CONTRACT.md", "/static/..%2F..%2Fsecret.txt",
                     "/static/.hidden.js", "/static/leak.txt", "/static/img/../../secret.txt",
                     f"/api/editions/..%2F{eid}", f"/api/editions/{eid}%2F..%2F..%2Fconfig.json",
                     f"/api/editions/{eid}/runs/..%2F..%2Fedition.json", "/api/editions/2026-05-02%00"):
            r = self.call("GET", path, expect=None)
            self.assertIn(r.status, (404, 405), path)
            self.assertNotIn(b"outside the static folder", r.body)
        self.call("PUT", f"/api/editions/..%2F{eid}/articles/a-0123456789", {"priority": 1}, expect=404)
        self.call("DELETE", f"/api/editions/{eid}%2F..%2F{eid}", expect=404)

    def test_static_files(self):
        r = self.call("GET", "/")
        self.assertEqual(r.headers["content-type"], "text/html; charset=utf-8")
        self.assertEqual(r.headers["cache-control"], "no-store")
        self.assertIn("default-src 'self'", r.headers["content-security-policy"])
        self.assertIn("script-src 'self';", r.headers["content-security-policy"])     # no inline script
        self.assertIn(b"Desk test page", r.body)
        for path, ctype in (("/static/app.js", "text/javascript; charset=utf-8"),
                            ("/static/app.css", "text/css; charset=utf-8"), ("/static/img/mark.svg", "image/svg+xml"),
                            ("/static/icon.png", "image/png"), ("/static/index.html", "text/html; charset=utf-8")):
            r = self.call("GET", path)
            self.assertEqual((r.headers["content-type"], r.headers["cache-control"]), (ctype, "no-store"), path)
            self.assertEqual(r.headers["x-content-type-options"], "nosniff")
        self.call("GET", "/static/missing.js", expect=404)
        self.call("GET", "/static/app.exe", expect=404)
        saved = self.desk.static_dir
        self.desk.static_dir = self.tmp / "no-static-here"
        try:
            r = self.call("GET", "/")
            self.assertIn(b"not installed yet", r.body)
            self.call("GET", "/static/app.js", expect=404)
        finally:
            self.desk.static_dir = saved


# -------------------------------------------------------------------------------------------------- runs


class RunTests(DeskCase):
    def test_run_end_to_end(self):
        eid = self.edition("2026-06-01")
        a = self.article(eid, headline="Lead story", body=words(80), priority=1)
        self.call("PUT", f"/api/editions/{eid}/articles/{a['id']}/photo", raw=png_bytes((300, 200)))
        self.article(eid, headline="A brief")
        self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=png_bytes((100, 100)))
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.assertRegex(rid, r"^r-\d{8}-\d{6}$")
        st = self.wait_run(eid, rid)
        self.assertEqual(st["state"], "done", st)
        self.assertIsNone(st["error"])
        self.assertEqual(st["message"], "2 pages made.")
        self.assertEqual((st["edition_pdf"], st["zip"], st["engine_state"]), ("edition.pdf", "press-files.zip", "done"))
        self.assertEqual([(p["page"], p["state"], p["pdf"], p["png"], p["thumb"]) for p in st["pages"]],
                         [(1, "done", "page-01.pdf", "page-01.png", "page-01.thumb.png"),
                          (2, "done", "page-02.pdf", "page-02.png", "page-02.thumb.png")])
        self.assertEqual(st["not_placed"], [{"article": a["id"], "reason": "a fictional reason"}])
        self.assertEqual(st["article_warnings"], [{"article": a["id"], "warnings": ["a fictional warning"]}])
        self.assertEqual(st["timings"], {"measure_s": 0.1, "plan_s": 0.2, "layout_s": 0.3})
        self.assertEqual([p["pdfx_check"]["passed"] for p in st["pages"]], [True, True])
        self.assertNotIn("plan_log", st)
        self.assertGreaterEqual(st["elapsed_s"], 0)
        self.assertTrue(st["created"] and st["started"] and st["finished"])
        run = self.edition_dir(eid) / "runs" / rid
        request = json.loads((run / "request.json").read_text())
        self.assertEqual(set(request), {"edition", "articles", "ads"})
        self.assertEqual(request["edition"]["id"], eid)
        self.assertEqual([(x["headline"], x["is_brief"]) for x in request["articles"]],
                         [("Lead story", False), ("A brief", True)])
        self.assertEqual(request["articles"][0]["photo"]["width_px"], 300)
        self.assertEqual((request["ads"]["back-1"]["w_px"], request["ads"]["back-1"]["h_px"]), (200, 100))
        self.assertEqual(size_of(run / "page-01.png"), (1200, 1800))
        with Image.open(run / "page-01.png") as page:
            self.assertLess(page.convert("L").getpixel((600, 900)), 128)                # the dark box
        self.assertEqual(size_of(run / "page-02.thumb.png"), (240, 360))
        with pikepdf.open(run / "edition.pdf") as merged:
            self.assertEqual(len(merged.pages), 2)
        with zipfile.ZipFile(run / "press-files.zip") as zf:
            self.assertEqual(zf.namelist(), ["page-01.pdf", "page-02.pdf"])
            self.assertEqual(zf.read("page-01.pdf"), (run / "page-01.pdf").read_bytes())
        for name in ("status.json", "request.json", "edition.pdf", "press-files.zip", "page-01.png", "engine.log"):
            self.assertEqual(mode_of(run / name), 0o600, name)
        self.assertEqual(mode_of(run), 0o700)
        self.assertIn("fake engine: planning", (run / "engine.log").read_text())
        # what the UI lists and downloads
        got = self.call("GET", f"/api/editions/{eid}").json()
        self.assertEqual([(r["id"], r["state"]) for r in got["runs"]], [(rid, "done")])
        summary = next(e for e in self.call("GET", "/api/editions").json()["editions"] if e["id"] == eid)
        self.assertEqual((summary["last_run"]["id"], summary["last_run"]["state"], summary["photos"]), (rid, "done", 1))
        base = f"/files/{eid}/runs/{rid}"
        r = self.call("GET", f"{base}/edition.pdf")
        self.assertEqual(r.headers["content-type"], "application/pdf")
        self.assertTrue(r.headers["content-disposition"].startswith("inline"))
        self.assertEqual(r.body, (run / "edition.pdf").read_bytes())
        r = self.call("GET", f"{base}/press-files.zip?download=1")
        self.assertEqual(r.headers["content-type"], "application/zip")
        self.assertEqual(r.headers["content-disposition"], f'attachment; filename="{eid}-press-files.zip"')
        r = self.call("GET", f"{base}/page-01.thumb.png")
        self.assertEqual(r.headers["content-type"], "image/png")
        self.call("GET", f"{base}/page-01.png", headers={"If-None-Match": r.headers["etag"]})
        self.call("GET", f"{base}/page-01.thumb.png", headers={"If-None-Match": r.headers["etag"]}, expect=304)
        self.call("GET", f"{base}/page-02.pdf?download=1")
        self.call("GET", f"{base}/page-03.pdf", expect=404)
        self.call("POST", f"/api/editions/{eid}/runs/{rid}/cancel", expect=409)
        self.call("GET", f"/api/editions/{eid}/runs/r-20000101-000000", expect=404)

    def test_one_run_per_edition_cancel_and_photo_safety(self):
        eid = self.edition("2026-06-02", volume="slow")
        a = self.article(eid)
        url = f"/api/editions/{eid}/articles/{a['id']}/photo"
        old = self.call("PUT", url, raw=png_bytes((60, 40))).json()["id"]
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        st = self.wait_run(eid, rid, states=("layout",), finished=False)
        self.assertIsNone(st["finished"])
        self.call("POST", f"/api/editions/{eid}/runs", expect=409)
        self.call("DELETE", f"/api/editions/{eid}", expect=409)
        self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=png_bytes((10, 10)), expect=409)
        new = self.call("PUT", url, raw=png_bytes((80, 40))).json()["id"]          # allowed: text edits too
        pdir = self.edition_dir(eid) / "photos"
        self.assertTrue((pdir / f"{old}.cmyk.gz").is_file())            # the running run may still read it
        self.assertEqual(self.call("POST", f"/api/editions/{eid}/runs/{rid}/cancel").json(), {"ok": True})
        st = self.wait_run(eid, rid)
        self.assertEqual((st["state"], st["error"], st["message"]), ("cancelled", None, "Cancelled."))
        self.assertEqual(self.call("POST", f"/api/editions/{eid}/runs/{rid}/cancel").json(), {"ok": True})
        self.wait_for(lambda: not (pdir / f"{old}.cmyk.gz").exists(), what="the old photo to be removed")
        self.assertTrue((pdir / f"{new}.cmyk.gz").is_file())
        self.assertFalse(self.desk.jobs.is_active(eid))

    def test_stubborn_engine_is_killed(self):
        eid = self.edition("2026-06-03", volume="stubborn")
        self.article(eid)
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, rid, states=("layout",), finished=False)
        t0 = time.monotonic()
        self.call("POST", f"/api/editions/{eid}/runs/{rid}/cancel")
        stopping = self.wait_run(eid, rid, states=("cancelled",), finished=False)
        self.assertEqual(stopping["state"], "cancelled")
        st = self.wait_run(eid, rid)
        self.assertEqual(st["state"], "cancelled")
        self.assertGreaterEqual(time.monotonic() - t0, 0.9)              # SIGTERM was ignored: killed after 1 s

    def test_engine_errors(self):
        eid = self.edition("2026-06-04", volume="fail")
        self.article(eid)
        st = self.wait_run(eid, self.call("POST", f"/api/editions/{eid}/runs").json()["run"])
        self.assertEqual((st["state"], st["error"]), ("failed", "The fake engine failed on purpose."))
        self.assertIsNone(st["edition_pdf"])
        crash = self.edition("2026-06-05", volume="crash")
        self.article(crash)
        st = self.wait_run(crash, self.call("POST", f"/api/editions/{crash}/runs").json()["run"])
        self.assertEqual(st["state"], "failed")
        self.assertIn("exit code 3", st["error"])
        self.assertIn("ValueError: a fake crash", st["error"])
        empty = self.edition("2026-06-06")
        self.call("POST", f"/api/editions/{empty}/runs", expect=400)
        self.call("POST", "/api/editions/2026-01-01/runs", expect=404)

    def test_engine_page_failures(self):
        allfail = self.edition("2026-06-12", volume="allfail")
        self.article(allfail)
        st = self.wait_run(allfail, self.call("POST", f"/api/editions/{allfail}/runs").json()["run"])
        self.assertEqual((st["state"], st["error"]), ("failed", "2 of 2 pages could not be laid out"))
        half = self.edition("2026-06-13", volume="half")
        self.article(half)
        rid = self.call("POST", f"/api/editions/{half}/runs").json()["run"]
        st = self.wait_run(half, rid)
        self.assertEqual(st["state"], "done")
        self.assertEqual(st["message"], "1 page made. 1 could not be made: see the notes on those pages.")
        self.assertEqual([(p["state"], p["png"]) for p in st["pages"]], [("done", "page-01.png"), ("failed", None)])
        run = self.edition_dir(half) / "runs" / rid
        with pikepdf.open(run / "edition.pdf") as merged:
            self.assertEqual(len(merged.pages), 1)
        with zipfile.ZipFile(run / "press-files.zip") as zf:
            self.assertEqual(zf.namelist(), ["page-01.pdf"])

    def test_one_engine_at_a_time(self):
        slow = self.edition("2026-06-07", volume="slow")
        self.article(slow)
        quick = self.edition("2026-06-08")
        self.article(quick)
        r1 = self.call("POST", f"/api/editions/{slow}/runs").json()["run"]
        self.wait_run(slow, r1, states=("layout",), finished=False)
        r2 = self.call("POST", f"/api/editions/{quick}/runs").json()["run"]
        time.sleep(0.4)
        waiting = self.run_status(quick, r2)
        self.assertEqual(waiting["state"], "queued")
        self.assertIn("Waiting", waiting["message"])
        self.assertIsNone(waiting["started"])
        self.call("POST", f"/api/editions/{slow}/runs/{r1}/cancel")
        self.assertEqual(self.wait_run(slow, r1)["state"], "cancelled")
        self.assertEqual(self.wait_run(quick, r2)["state"], "done")

    def test_cancel_a_queued_run(self):
        slow = self.edition("2026-06-09", volume="slow")
        self.article(slow)
        other = self.edition("2026-06-10")
        self.article(other)
        r1 = self.call("POST", f"/api/editions/{slow}/runs").json()["run"]
        self.wait_run(slow, r1, states=("layout",), finished=False)
        r2 = self.call("POST", f"/api/editions/{other}/runs").json()["run"]
        self.call("POST", f"/api/editions/{other}/runs/{r2}/cancel")
        st = self.run_status(other, r2)
        self.assertEqual((st["state"], st["message"]), ("cancelled", "Cancelled before it started."))
        self.assertFalse((self.edition_dir(other) / "runs" / r2 / "engine.log").exists())
        self.call("POST", f"/api/editions/{slow}/runs/{r1}/cancel")
        self.wait_run(slow, r1)

    def test_restart_marks_unfinished_runs_failed(self):
        home = self.tmp / "restart-home"
        desk = Desk(home, static_dir=self.static)
        desk.close()
        run = home / "editions" / "2026-06-11" / "runs" / "r-20260611-101010"
        run.mkdir(parents=True)
        write_json(home / "editions" / "2026-06-11" / "edition.json", {"id": "2026-06-11"})
        write_json(run / "status.json", {"state": "layout", "pages": []})
        done = run.parent / "r-20260611-090000"
        done.mkdir()
        write_json(done / "status.json", {"state": "done"})
        again = Desk(home, static_dir=self.static)
        try:
            self.assertEqual(again.jobs.recovered, 1)
            st = json.loads((run / "status.json").read_text())
            self.assertEqual(st["state"], "failed")
            self.assertIn("restarted", st["error"])
            self.assertEqual(json.loads((done / "status.json").read_text())["state"], "done")
        finally:
            again.close()


# ------------------------------------------------------------------------------------- background measuring


class PdfxCheckTests(DeskCase):
    def test_a_page_failing_the_print_file_check_is_named(self):
        self.pdfx_verdicts["page-02.pdf"] = {"passed": False, "fails": 3, "warnings": 1}
        try:
            eid = self.edition("2026-06-09")
            self.article(eid, headline="Lead story", body=words(80), priority=1)
            rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
            st = self.wait_run(eid, rid)
        finally:
            self.pdfx_verdicts.clear()
        self.assertEqual(st["state"], "done", st)
        self.assertIn("The PDF/X-1a check found problems in page-02.pdf", st["message"])
        self.assertEqual([p["pdfx_check"]["passed"] for p in st["pages"]], [True, False])

    def test_the_real_checker_reads_its_verdict(self):
        """The real checker on a file that is not PDF/X: it runs and reports failures, never a pass."""
        with tempfile.TemporaryDirectory() as d:
            pdf = Path(d) / "page-01.pdf"
            with pikepdf.new() as doc:
                doc.add_blank_page(page_size=(200, 200))
                doc.save(pdf)
            verdict = self._check_pdfx(REPO, pdf)
        self.assertFalse(verdict["passed"])
        self.assertGreater(verdict["fails"], 0)


def word_file(paragraphs: list[tuple[str, str]]) -> bytes:
    """A minimal .docx: (style id or "", text) per paragraph."""
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = []
    for style, text in paragraphs:
        ppr = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
        body.append(f"<w:p>{ppr}<w:r><w:t>{text}</w:t></w:r></w:p>")
    xml = f'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="{ns}"><w:body>{"".join(body)}</w:body></w:document>'
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("word/document.xml", xml)
    return buf.getvalue()


class WordImportTests(DeskCase):
    def test_a_word_file_becomes_articles(self):
        eid = self.edition("2026-07-20")
        data = word_file([("Title", "पहिली काल्पनिक बातमी"), ("", "प्रतिनिधी, नवनगर"), ("", "पहिला परिच्छेद. दुसरे वाक्य."),
                     ("Heading1", "दुसरी काल्पनिक बातमी"), ("", "एकच परिच्छेद."), ("Heading1", "मजकूर नसलेला मथळा")])
        res = self.call("POST", f"/api/editions/{eid}/articles/import-docx", raw=data,
                        headers={"Content-Type": "application/octet-stream"}).json()
        self.assertEqual(res["created"], 2)
        self.assertEqual([a["byline"] for a in res["articles"]], ["प्रतिनिधी, नवनगर", ""])
        self.assertEqual({a["source"] for a in res["articles"]}, {"word"})
        self.assertEqual(len(res["notes"]), 1)                                  # the heading with no text under it
        self.assertEqual(res["msgs"][res["notes"][0]], {"code": "m.docx.emptyHeading1", "params": {}})   # (Marathi)
        self.assertEqual(len(self.call("GET", f"/api/editions/{eid}").json()["articles"]), 2)

    def test_files_that_are_not_word_files_are_refused(self):
        eid = self.edition("2026-07-21")
        url = f"/api/editions/{eid}/articles/import-docx"
        said = self.call("POST", url, raw=b"plain text", expect=400).json()
        self.assertIn("not a Word", said["error"])
        self.assertEqual(said["msgs"][said["error"]], {"code": "m.docx.notWord", "params": {}})   # the screen's code
        said = self.call("POST", url, raw=b"\0" * (20 * 1024 * 1024 + 1), expect=413).json()
        self.assertEqual(said["msgs"][said["error"]], {"code": "m.docx.overSize", "params": {}})
        said = self.call("POST", url, raw=word_file([("Title", "मजकूर नसलेला मथळा")]), expect=400).json()
        self.assertEqual(said["msgs"][said["error"]], {"parts": [{"code": "m.docx.noStory", "params": {}}]})
        self.call("POST", url, raw=b"PK", headers={"X-Desk": ""}, expect=403)
        self.call("POST", "/api/editions/2099-01-01/articles/import-docx", raw=b"PK", expect=404)


class EditTests(DeskCase):
    def finished_run(self, day: str) -> tuple[str, str]:
        eid = self.edition(day)
        self.article(eid, headline="Lead story", body=words(80), priority=1)
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.assertEqual(self.wait_run(eid, rid)["state"], "done")
        return eid, rid

    def test_open_change_and_save_a_page(self):
        eid, rid = self.finished_run("2026-07-01")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        self.assertEqual(opened["session"], f"{eid}/{rid}/1")
        self.assertEqual(opened["modules"][0]["w"], 2)
        moved = [{**opened["modules"][0], "w": 3}]
        self.assertEqual(self.call("PUT", f"{url}/edit", {"modules": moved}).json()["modules"][0]["w"], 3)
        saved = self.call("POST", f"{url}/save", {}).json()
        self.assertEqual((saved["pdf"], saved["page"], saved["pdfx_check"]["passed"]), ("page-01.pdf", 1, True))
        st = self.call("GET", f"/api/editions/{eid}/runs/{rid}").json()
        page = next(p for p in st["pages"] if p["page"] == 1)
        self.assertTrue(page["edited"])
        self.assertEqual(page["png"], "page-01.png")
        run = self.edition_dir(eid) / "runs" / rid
        self.assertTrue((run / "page-01.png").is_file() and (run / "edition.pdf").is_file())

    def status(self, eid: str, rid: str) -> dict:
        return self.call("GET", f"/api/editions/{eid}/runs/{rid}").json()

    @staticmethod
    def page_of(st: dict, n: int) -> dict:
        return next(p for p in st["pages"] if p["page"] == n)

    def test_a_change_marks_the_page_until_it_is_saved(self):
        eid, rid = self.finished_run("2026-07-03")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        self.assertEqual((self.status(eid, rid)["press_ready"], self.status(eid, rid)["pages_to_save"]), (True, []))
        opened = self.call("POST", f"{url}/edit", {}).json()
        self.assertTrue(self.status(eid, rid)["press_ready"])                     # opening a page changes nothing
        self.call("PUT", f"{url}/edit", {"modules": [{**opened["modules"][0], "w": 3}]})
        st = self.status(eid, rid)
        self.assertTrue(self.page_of(st, 1)["edited_unsaved"])
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        saved = self.call("POST", f"{url}/save", {}).json()
        self.assertEqual((saved["press_ready"], saved["pages_to_save"], saved["error"]), (True, [], None))
        p1 = self.page_of(self.status(eid, rid), 1)
        self.assertEqual((p1["edited_unsaved"], p1["needs_save"], p1["edited"]), (False, False, True))

    def two_page_run(self, day: str) -> tuple[str, str, str, str]:
        """A finished run with one article on each page (the fake lays the articles out in turn)."""
        eid = self.edition(day)
        first = self.article(eid, headline="Lead story", body=words(80), priority=1)["id"]
        second = self.article(eid, headline="Second story", body=words(60), priority=2)["id"]
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.assertEqual(self.wait_run(eid, rid)["state"], "done")
        return eid, rid, first, second

    def test_a_story_brought_from_another_page_leaves_it_at_save(self):
        eid, rid, first, second = self.two_page_run("2026-07-04")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        brought = {**opened["modules"][0], "story": "d" + second[2:], "x": 12.82 + 40.69 * 4}
        changed = self.call("PUT", f"{url}/edit", {"modules": [opened["modules"][0], brought], "rev": opened["rev"]}).json()
        self.assertEqual(changed["also_on_pages"], {"d" + second[2:]: 2})
        saved = self.call("POST", f"{url}/save", {"rev": changed["rev"]}).json()
        self.assertEqual(saved["pages_changed"], {"2": []})
        self.assertEqual((saved["press_ready"], saved["pages_to_save"]), (False, [2]))
        st = self.status(eid, rid)
        p2 = self.page_of(st, 2)
        self.assertTrue(p2["needs_save"])
        self.assertIn("to page 1", p2["needs_save_reason"])
        self.assertEqual(p2["articles"], [])
        self.assertEqual(self.page_of(st, 1)["articles"], [first, second])
        self.assertEqual(st["not_placed"], [])                                     # both articles are on page 1 now
        url2 = f"/api/editions/{eid}/runs/{rid}/pages/2"
        page2 = self.call("POST", f"{url2}/edit", {}).json()
        self.assertEqual(page2["modules"], [])                                     # its editor lost the story too
        done = self.call("POST", f"{url2}/save", {"rev": page2["rev"]}).json()
        self.assertEqual((done["press_ready"], done["pages_to_save"]), (True, []))
        self.assertFalse(self.page_of(self.status(eid, rid), 2)["needs_save"])

    def test_a_save_that_stops_part_way_leaves_both_pages_marked(self):
        eid, rid, first, second = self.two_page_run("2026-07-10")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        brought = {**opened["modules"][0], "story": "d" + second[2:], "x": 12.82 + 40.69 * 4}
        changed = self.call("PUT", f"{url}/edit", {"modules": [opened["modules"][0], brought]}).json()
        flag = self.edition_dir(eid) / "runs" / rid / "fake-export-fails"
        flag.write_text("x")
        try:
            self.call("POST", f"{url}/save", {"rev": changed["rev"]}, expect=400)
        finally:
            flag.unlink()
        st = self.status(eid, rid)
        self.assertTrue(self.page_of(st, 1)["needs_save"])
        self.assertTrue(self.page_of(st, 2)["needs_save"])                         # marked before the save began
        self.assertIn("taking a story", self.page_of(st, 2)["needs_save_reason"])
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1, 2]))
        saved = self.call("POST", f"{url}/save", {"rev": changed["rev"]}).json()
        self.assertEqual((saved["press_ready"], saved["pages_to_save"]), (False, [2]))

    def test_a_change_made_on_an_older_view_is_refused(self):
        eid, rid = self.finished_run("2026-07-11")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        moved = [{**opened["modules"][0], "w": 3}]
        first = self.call("PUT", f"{url}/edit", {"modules": moved, "rev": opened["rev"]}).json()
        self.assertEqual(first["rev"], opened["rev"] + 1)
        stale = self.call("PUT", f"{url}/edit", {"modules": moved, "rev": opened["rev"]}, expect=409).json()
        self.assertIn("another window or tab", stale["error"])
        self.call("POST", f"{url}/alternative", {"variant": 1, "rev": opened["rev"]}, expect=409)
        self.call("POST", f"{url}/save", {"rev": opened["rev"]}, expect=409)
        self.call("PUT", f"{url}/edit", {"modules": moved, "rev": "1"}, expect=400)
        self.assertEqual(self.call("POST", f"{url}/save", {"rev": first["rev"]}).json()["error"], None)

    def test_a_page_the_engine_changed_on_its_own_is_marked_when_opened(self):
        eid, rid = self.finished_run("2026-07-12")
        run = self.edition_dir(eid) / "runs" / rid
        (run / "page-01.edit.json").write_text(json.dumps({"page": 1, "rev": 2, "modules": []}))   # e.g. text set elsewhere
        self.assertTrue(self.status(eid, rid)["press_ready"])
        self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {})
        st = self.status(eid, rid)
        self.assertTrue(self.page_of(st, 1)["edited_unsaved"])
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        saved = self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/1/save", {"rev": 2}).json()
        self.assertEqual((saved["press_ready"], self.page_of(self.status(eid, rid), 1)["pdf_rev"]), (True, 2))
        self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {})               # same revision: not marked
        self.assertTrue(self.status(eid, rid)["press_ready"])

    def test_an_article_changed_or_deleted_after_the_layout_marks_the_pages_printing_it(self):
        eid, rid, first, second = self.two_page_run("2026-07-13")
        url = f"/api/editions/{eid}/articles"
        self.call("PUT", f"{url}/{first}", {"priority": 2})                                # not printed: no mark
        self.assertTrue(self.status(eid, rid)["press_ready"])
        self.call("PUT", f"{url}/{first}", {"body": words(90)})
        st = self.status(eid, rid)
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        self.assertIn("changed since the page's PDF was made", self.page_of(st, 1)["stale"][0])
        self.call("DELETE", f"{url}/{second}")
        st = self.status(eid, rid)
        self.assertEqual(st["pages_to_save"], [1, 2])
        self.assertIn("deleted from the edition", self.page_of(st, 2)["stale"][0])

    def test_a_save_without_the_new_text_leaves_the_page_to_save(self):
        eid, rid, first, _ = self.two_page_run("2026-07-14")
        self.call("PUT", f"/api/editions/{eid}/articles/{first}", {"body": words(70)})       # a correction after layout
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        page = self.call("POST", f"{url}/edit", {}).json()
        saved = self.call("POST", f"{url}/save", {"rev": page["rev"]}).json()              # saved with the old text
        self.assertEqual((saved["press_ready"], saved["pages_to_save"]), (False, [1]))
        self.assertTrue(saved["stale"])
        fresh = self.call("POST", f"{url}/refresh", {}).json()                             # Update text
        done = self.call("POST", f"{url}/save", {"rev": fresh["rev"]}).json()
        self.assertEqual((done["press_ready"], done["pages_to_save"], done["stale"]), (True, [], []))

    def test_a_change_made_while_the_layout_runs_marks_the_finished_pages(self):
        eid = self.edition("2026-07-15", volume="waitgo")
        first = self.article(eid, headline="Lead story", body=words(80), priority=1)["id"]
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        run = self.edition_dir(eid) / "runs" / rid
        self.wait_for(lambda: self.status(eid, rid).get("state") in ("layout", "finishing") or None, what="the run to start")
        self.call("PUT", f"/api/editions/{eid}/articles/{first}", {"body": words(85)})
        (run / "go").write_text("x")
        st = self.wait_run(eid, rid)
        self.assertEqual(st["state"], "done")
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        self.assertTrue(self.page_of(st, 1)["stale"])

    def test_a_new_issue_number_marks_the_front_page(self):
        eid, rid = self.finished_run("2026-07-16")
        self.call("PUT", f"/api/editions/{eid}", {"issue": "241"})
        st = self.status(eid, rid)
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        self.assertIn("volume, issue or price", self.page_of(st, 1)["stale"][0])
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        self.call("POST", f"{url}/edit", {})
        fresh = self.call("POST", f"{url}/refresh", {}).json()
        self.assertEqual(self.call("POST", f"{url}/save", {"rev": fresh["rev"]}).json()["press_ready"], True)

    def test_an_editor_save_keeps_the_front_pages_issue_warning_until_the_issue_is_set(self):
        eid, rid = self.finished_run("2026-07-18")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        self.call("POST", f"{url}/edit", {})
        self.call("POST", f"{url}/save", {})
        self.assertEqual(self.page_of(self.status(eid, rid), 1)["warnings"], [deskprinted.ISSUE_NOT_SET])
        self.call("PUT", f"/api/editions/{eid}", {"issue": "242"})
        fresh = self.call("POST", f"{url}/refresh", {}).json()
        self.call("POST", f"{url}/save", {"rev": fresh["rev"]})
        self.assertEqual(self.page_of(self.status(eid, rid), 1)["warnings"], [])

    def test_an_article_saved_while_the_run_finishes_marks_its_page(self):
        eid = self.edition("2026-07-24", volume="waitgo")
        aid = self.article(eid, headline="Lead story", body=words(80), priority=1)["id"]
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        real, saver = jobs.refresh_stale, []

        def finishing(status, run_dir, *rest):
            real(status, run_dir, *rest)               # the run reads the edition here …
            if status.get("state") == "done" and not saver:
                saver.append(threading.Thread(target=self.desk.store.update_article, args=(eid, aid, {"body": words(95)})))
                saver[0].start()                       # … and an article save comes in before its status is written
                saver[0].join(0.5)
        jobs.refresh_stale = finishing
        try:
            (self.edition_dir(eid) / "runs" / rid / "go").write_text("x")
            self.wait_run(eid, rid)
        finally:
            jobs.refresh_stale = real
        saver[0].join(10)
        st = self.status(eid, rid)
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        self.assertIn("changed since the page's PDF was made", self.page_of(st, 1)["stale"][0])

    def test_a_run_from_an_older_desk_is_not_current_and_cannot_be_edited(self):
        eid, rid = self.finished_run("2026-07-25")
        home = self.tmp / "older-desk-home"
        shutil.copytree(self.edition_dir(eid), home / "editions" / eid)
        run = home / "editions" / eid / "runs" / rid
        (run / "printed.json").unlink()
        st = json.loads((run / "status.json").read_text())
        for p in st["pages"]:
            p.pop("printed", None)
            p.pop("stale", None)
        st["press_ready"] = True                                            # as an older Desk left it
        write_json(run / "status.json", st)
        desk = Desk(home, static_dir=self.static)                           # its start checks the run again
        try:
            st = json.loads((run / "status.json").read_text())
            self.assertFalse(st["press_ready"])
            self.assertTrue(all(OLDER_DESK in p["stale"] for p in st["pages"] if p["state"] == "done"))
        finally:
            desk.close()
        (self.edition_dir(eid) / "runs" / rid / "printed.json").unlink()
        said = self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {}, expect=409).json()
        self.assertIn("older version of the Desk", said["error"])

    def test_a_new_page_count_or_back_page_setting_needs_a_new_layout(self):
        eid, rid = self.finished_run("2026-07-26")
        self.assertTrue(self.status(eid, rid)["press_ready"])
        self.call("PUT", f"/api/editions/{eid}", {"pages": 16})
        st = self.status(eid, rid)
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1, 2]))
        self.assertIn("now has 16 pages", self.page_of(st, 1)["stale"][0])
        self.call("PUT", f"/api/editions/{eid}", {"pages": 8})
        self.assertTrue(self.status(eid, rid)["press_ready"])                # as it was laid out again
        ads = self.call("GET", f"/api/editions/{eid}").json()["edition"].get("back_page_ads")
        self.call("PUT", f"/api/editions/{eid}", {"back_page_ads": not ads})
        self.assertEqual(self.status(eid, rid)["pages_to_save"], [2])         # the back page

    def test_update_text_on_an_older_view_of_the_page_is_refused(self):
        eid, rid = self.finished_run("2026-07-27")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        b = self.call("POST", f"{url}/edit", {}).json()                       # a tab shows revision 0 …
        self.call("PUT", f"{url}/edit", {"modules": [{**b["modules"][0], "w": 5}], "rev": b["rev"]})   # … another changes it
        said = self.call("POST", f"{url}/refresh", {"rev": b["rev"]}, expect=409).json()
        self.assertIn("another window or tab", said["error"])
        self.call("POST", f"{url}/refresh", {"rev": b["rev"] + 1})

    def test_a_damaged_run_does_not_stop_the_others_being_checked(self):
        eid = self.edition("2026-07-28")
        a = self.article(eid, headline="Lead story", body=words(80), priority=1)
        old = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, old)
        new = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, new)
        (self.edition_dir(eid) / "runs" / old / "plan.json").write_text("{damaged")
        self.call("PUT", f"/api/editions/{eid}/articles/{a['id']}", {"body": words(85)})
        self.assertEqual(self.status(eid, new)["pages_to_save"], [1])
        self.assertEqual(self.page_of(self.status(eid, old), 1)["stale"], [DAMAGED])
        (self.edition_dir(eid) / "runs" / old / "status.json").write_text("{damaged")
        self.call("PUT", f"/api/editions/{eid}/articles/{a['id']}", {"body": words(80)})   # still saved, still checked
        self.assertEqual(self.status(eid, new)["pages_to_save"], [])

    def test_a_change_seen_during_a_save_keeps_the_page_unsaved(self):
        eid, rid = self.finished_run("2026-07-29")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        moved = self.call("PUT", f"{url}/edit", {"modules": [{**opened["modules"][0], "w": 3}]}).json()
        with self.desk.store.lock(eid):                                       # another tab's change, seen meanwhile
            editing.note_rev(self.edition_dir(eid) / "runs" / rid, 1, moved["rev"] + 1)
        self.call("POST", f"{url}/save", {"rev": moved["rev"]})
        st = self.status(eid, rid)
        self.assertEqual((self.page_of(st, 1)["edited_unsaved"], st["press_ready"]), (True, False))

    def test_back_page_ads_switched_on_after_a_layout_without_them_marks_the_back_page(self):
        eid = self.edition("2026-07-30", back_page_ads=False)
        self.article(eid, headline="Lead story", body=words(80), priority=1)
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.assertEqual(self.page_of(self.wait_run(eid, rid), 2)["role"], "inside")
        self.call("PUT", f"/api/editions/{eid}", {"back_page_ads": True})
        st = self.status(eid, rid)
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [2]))
        self.assertIn("switched on", self.page_of(st, 2)["stale"][0])

    def test_a_damaged_record_at_the_end_of_a_layout_ends_it_not_current(self):
        eid = self.edition("2026-07-31", volume="damagedprinted")
        self.article(eid, headline="Lead story", body=words(80), priority=1)
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        st = self.wait_run(eid, rid)
        self.assertEqual((st["state"], st["press_ready"]), ("done", False))
        self.assertTrue(all(p["stale"] == [DAMAGED] for p in st["pages"]))

    def test_a_caption_a_new_photo_or_another_ad_marks_the_pages_printing_them(self):
        eid, rid = self.finished_run("2026-08-01")
        aid = self.call("GET", f"/api/editions/{eid}").json()["articles"][0]["id"]
        self.call("PUT", f"/api/editions/{eid}/articles/{aid}/photo", raw=jpeg_bytes((640, 480)), headers={"Content-Type": "image/jpeg"})
        self.assertEqual(self.status(eid, rid)["pages_to_save"], [1])               # a new photo
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, rid)
        self.assertEqual(self.status(eid, rid)["pages_to_save"], [])
        self.call("PUT", f"/api/editions/{eid}/articles/{aid}/photo-text", {"caption": "एक काल्पनिक ओळ", "credit": ""})
        self.assertEqual(self.status(eid, rid)["pages_to_save"], [1])               # a new caption
        self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=jpeg_bytes((400, 300)), headers={"Content-Type": "image/jpeg"})
        self.assertEqual(self.status(eid, rid)["pages_to_save"], [1, 2])            # another ad on the back page
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, rid)
        self.assertEqual(self.status(eid, rid)["pages_to_save"], [])
        self.call("DELETE", f"/api/editions/{eid}/articles/{aid}/photo")
        self.assertEqual(self.status(eid, rid)["pages_to_save"], [1])               # the photo taken off

    def test_article_saves_go_on_while_a_page_is_saved_and_saves_in_a_run_take_turns(self):
        eid, rid = self.finished_run("2026-08-02")
        aid = self.call("GET", f"/api/editions/{eid}").json()["articles"][0]["id"]
        for n in (1, 2):
            self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/{n}/edit", {})
        release, checking, second, inside, most = threading.Event(), threading.Event(), threading.Event(), [0], [0]
        quick = jobs.check_pdfx

        def slow_check(root, pdf):                    # the PDF/X check of a save, held until the test lets it go
            inside[0] += 1
            most[0] = max(most[0], inside[0])
            checking.set()
            if inside[0] > 1:
                second.set()
            release.wait(10)
            inside[0] -= 1
            return quick(root, pdf)
        jobs.check_pdfx = slow_check
        try:
            saves = [threading.Thread(target=self.call, args=("POST", f"/api/editions/{eid}/runs/{rid}/pages/{n}/save", {}))
                     for n in (1, 2)]
            for t in saves:
                t.start()
            self.assertTrue(checking.wait(10))
            t0 = time.monotonic()
            self.call("PUT", f"/api/editions/{eid}/articles/{aid}", {"priority": 2})   # not held up by the save
            self.assertLess(time.monotonic() - t0, 2.0)
            said = self.call("DELETE", f"/api/editions/{eid}", expect=409).json()      # nor deleted under it
            self.assertIn("being changed or saved", said["error"])
            second.wait(1.5)                          # the other save gets there only if saves do not take turns
            release.set()
            for t in saves:
                t.join(30)
        finally:
            jobs.check_pdfx = quick
            release.set()
        self.assertEqual(most[0], 1)                                                     # one save at a time
        self.call("DELETE", f"/api/editions/{eid}")                                      # and nothing left counted

    def test_a_record_that_cannot_be_compared_is_never_current(self):
        eid, rid = self.finished_run("2026-08-03")
        status_file = self.edition_dir(eid) / "runs" / rid / "status.json"
        st = json.loads(status_file.read_text())
        st["pages"][0]["printed"]["ads"] = 5                                  # not a record the check can read
        write_json(status_file, st)
        self.call("PUT", f"/api/editions/{eid}", {"volume": "7"})
        st = self.status(eid, rid)
        self.assertEqual((self.page_of(st, 1)["stale"], st["press_ready"]), ([DAMAGED], False))

    def test_a_save_that_records_nothing_is_not_current(self):
        eid, rid = self.finished_run("2026-08-04")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        self.call("POST", f"{url}/edit", {})
        (self.edition_dir(eid) / "runs" / rid / "fake-export-no-printed").write_text("x")
        saved = self.call("POST", f"{url}/save", {}).json()
        self.assertEqual((saved["stale"], saved["press_ready"]), ([OLDER_DESK], False))

    def test_an_edition_or_a_run_whose_files_cannot_be_read_has_no_current_layout(self):
        eid, rid = self.finished_run("2026-08-05")
        articles = self.edition_dir(eid) / "articles.json"
        kept = articles.read_bytes()
        articles.write_text("{damaged")
        try:
            self.call("PUT", f"/api/editions/{eid}", {"issue": "777"})
            st = self.status(eid, rid)
            self.assertEqual((st["press_ready"], self.page_of(st, 1)["stale"]), (False, [DAMAGED]))
        finally:
            articles.write_bytes(kept)
        self.call("PUT", f"/api/editions/{eid}", {"issue": ""})
        self.assertTrue(self.status(eid, rid)["press_ready"])
        edition = self.edition_dir(eid) / "edition.json"
        self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=jpeg_bytes((400, 300)), headers={"Content-Type": "image/jpeg"})
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, rid)
        kept = edition.read_bytes()
        edition.write_text("{damaged")
        try:
            self.call("DELETE", f"/api/editions/{eid}/ads/back-1", expect=500)       # the ad is gone all the same …
            self.assertFalse(self.status(eid, rid)["press_ready"])                    # … and nothing is current
        finally:
            edition.write_bytes(kept)
        (self.edition_dir(eid) / "runs" / rid / "request.json").unlink()             # a run that lost its request
        self.call("PUT", f"/api/editions/{eid}", {"volume": "8"})
        self.assertTrue(all(p["stale"] == [DAMAGED] for p in self.status(eid, rid)["pages"]))
        self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {}, expect=409)

    def test_an_ad_index_that_cannot_be_read_changes_nothing(self):
        eid = self.edition("2026-08-06")
        self.article(eid, headline="Lead story", body=words(80), priority=1)
        self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=jpeg_bytes((400, 300)), headers={"Content-Type": "image/jpeg"})
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, rid)
        ads = self.edition_dir(eid) / "ads"
        raster, index = (ads / "back-1.cmyk.gz").read_bytes(), (ads / "index.json").read_bytes()
        (ads / "index.json").write_text("{damaged")
        try:
            self.call("DELETE", f"/api/editions/{eid}/ads/back-1", expect=500)
            self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=jpeg_bytes((300, 200)),
                      headers={"Content-Type": "image/jpeg"}, expect=500)
            self.assertEqual((ads / "back-1.cmyk.gz").read_bytes(), raster)          # the ad as it was …
            self.assertTrue(self.status(eid, rid)["press_ready"])                     # … so its pages are current
        finally:
            (ads / "index.json").write_bytes(index)

    def test_a_layout_of_an_edition_that_cannot_be_read_at_start_up_is_not_current(self):
        eid, rid = self.finished_run("2026-08-07")
        home = self.tmp / "damaged-edition-home"
        shutil.copytree(self.edition_dir(eid), home / "editions" / eid)
        (home / "editions" / eid / "articles.json").write_text("{damaged")
        desk = Desk(home, static_dir=self.static)                                     # its start checks the run again
        try:
            st = json.loads((home / "editions" / eid / "runs" / rid / "status.json").read_text())
            self.assertEqual((st["press_ready"], [p["stale"] for p in st["pages"]]), (False, [[DAMAGED], [DAMAGED]]))
        finally:
            desk.close()

    def test_an_edition_is_not_deleted_while_a_page_of_it_is_opened(self):
        eid, rid = self.finished_run("2026-08-08")
        (self.edition_dir(eid) / "runs" / rid / "fake-open-slow").write_text("x")
        opened = []
        t = threading.Thread(target=lambda: opened.append(
            self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {}).status))
        t.start()
        time.sleep(0.4)
        self.assertIn("being changed or saved", self.call("DELETE", f"/api/editions/{eid}", expect=409).json()["error"])
        t.join(10)
        self.assertEqual(opened, [200])
        self.call("DELETE", f"/api/editions/{eid}")                                   # then it can be
        self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {}, expect=404)
        self.assertFalse(self.edition_dir(eid).exists())                              # and nothing made it again

    def test_the_back_page_rule_marks_the_last_page_even_when_it_failed(self):
        eid = self.edition("2026-08-09", volume="half")                               # page 2 (the last) fails
        self.article(eid, headline="Lead story", body=words(80), priority=1)
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, rid)
        ads = self.call("GET", f"/api/editions/{eid}").json()["edition"].get("back_page_ads")
        self.call("PUT", f"/api/editions/{eid}", {"back_page_ads": not ads})
        self.assertEqual(self.page_of(self.status(eid, rid), 1)["stale"], [])        # not the front page instead

    def ad_layout(self, day: str, with_ad: bool) -> tuple[str, str]:
        eid = self.edition(day)
        self.article(eid, headline="Lead story", body=words(80), priority=1)
        if with_ad:
            self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=jpeg_bytes((400, 300)), headers={"Content-Type": "image/jpeg"})
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.wait_run(eid, rid)
        return eid, rid

    def test_a_damaged_ad_index_never_makes_a_page_current(self):
        eid, rid = self.ad_layout("2026-08-10", with_ad=False)                      # the back page prints no ad …
        self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=jpeg_bytes((400, 300)), headers={"Content-Type": "image/jpeg"})
        self.assertEqual(self.status(eid, rid)["pages_to_save"], [2])               # … and the edition now has one
        index = self.edition_dir(eid) / "ads" / "index.json"
        kept = index.read_bytes()
        for damaged in ("{damaged", '{"elements": []}'):
            with self.subTest(damaged):
                index.write_text(damaged)
                try:
                    self.call("PUT", f"/api/editions/{eid}", {"price": ""})         # a recheck that changes nothing printed
                    self.assertFalse(self.status(eid, rid)["press_ready"])
                    self.assertTrue(self.page_of(self.status(eid, rid), 2)["stale"])
                    self.call("DELETE", f"/api/editions/{eid}/ads/back-1", expect=500)   # and it changes nothing
                    self.assertTrue((self.edition_dir(eid) / "ads" / "back-1.cmyk.gz").exists())
                finally:
                    index.write_bytes(kept)

    def test_an_ad_deleted_after_its_index_went_missing_is_checked_again(self):
        eid, rid = self.ad_layout("2026-08-15", with_ad=True)
        (self.edition_dir(eid) / "ads" / "index.json").unlink()                     # gone out of band
        self.call("DELETE", f"/api/editions/{eid}/ads/back-1")                       # its raster goes too …
        self.assertFalse(self.status(eid, rid)["press_ready"])                        # … and the back page is marked

    def test_a_save_while_the_edition_cannot_be_read_says_so(self):
        eid, rid = self.ad_layout("2026-08-14", with_ad=True)
        url = f"/api/editions/{eid}/runs/{rid}/pages/2"
        self.call("POST", f"{url}/edit", {})
        index = self.edition_dir(eid) / "ads" / "index.json"
        kept = index.read_bytes()
        index.write_text("{damaged")
        try:
            saved = self.call("POST", f"{url}/save", {}).json()                       # answered, not a 500
            self.assertEqual((saved["stale"], saved["press_ready"]), ([DAMAGED], False))
        finally:
            index.write_bytes(kept)

    def test_an_ad_change_that_fails_part_way_still_checks_the_pages_again(self):
        eid, rid = self.ad_layout("2026-08-11", with_ad=True)
        self.assertTrue(self.status(eid, rid)["press_ready"])
        real = store_module.write_json

        def failing(path, data):
            if path.name == "index.json" and path.parent.name == "ads":
                raise OSError("a fictional full disk")
            return real(path, data)
        store_module.write_json = failing
        try:
            self.call("PUT", f"/api/editions/{eid}/ads/back-1", raw=jpeg_bytes((300, 200)),
                      headers={"Content-Type": "image/jpeg"}, expect=500)              # the raster changed, not the index
            self.assertFalse(self.status(eid, rid)["press_ready"])
        finally:
            store_module.write_json = real
        rid2 = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]          # laid out with that ad: current
        self.wait_run(eid, rid2)
        self.assertTrue(self.status(eid, rid2)["press_ready"])
        store_module.write_json = failing
        try:
            self.call("DELETE", f"/api/editions/{eid}/ads/back-1", expect=500)        # the files go, the index stays
            self.assertFalse(self.status(eid, rid2)["press_ready"])
        finally:
            store_module.write_json = real

    def test_a_page_recorded_in_an_older_format_is_current_once_saved(self):
        eid, rid = self.finished_run("2026-08-12")
        status_file = self.edition_dir(eid) / "runs" / rid / "status.json"
        st = json.loads(status_file.read_text())
        st["pages"][0]["printed"]["v"] = 2
        write_json(status_file, st)
        self.call("PUT", f"/api/editions/{eid}", {"volume": "3"})
        self.assertEqual(self.page_of(self.status(eid, rid), 1)["stale"], [deskprinted.OLDER])
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        self.call("POST", f"{url}/edit", {})
        fresh = self.call("POST", f"{url}/refresh", {}).json()
        saved = self.call("POST", f"{url}/save", {"rev": fresh["rev"]}).json()
        self.assertEqual((saved["stale"], saved["press_ready"]), ([], True))

    def test_an_edition_is_not_deleted_while_a_page_of_it_is_changed(self):
        eid, rid = self.finished_run("2026-08-13")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        (self.edition_dir(eid) / "runs" / rid / "fake-set-slow").write_text("x")
        done = []
        t = threading.Thread(target=lambda: done.append(self.call(
            "PUT", f"{url}/edit", {"modules": [{**opened["modules"][0], "w": 3}]}).status))
        t.start()
        time.sleep(0.4)
        self.call("DELETE", f"/api/editions/{eid}", expect=409)
        t.join(10)
        self.assertEqual(done, [200])

    def test_back_page_ads_count_as_on_when_a_run_or_an_edition_does_not_say(self):
        with tempfile.TemporaryDirectory() as d:
            run = Path(d)
            write_json(run / "request.json", {"edition": {"pages": 4}})               # no back_page_ads: on
            pages = [{"page": n, "state": "done"} for n in (1, 2, 3, 4)]
            self.assertEqual(press._layout_changed(run, {"pages": 4, "back_page_ads": True}, pages), {})
            self.assertEqual(list(press._layout_changed(run, {"pages": 4, "back_page_ads": False}, pages)), [4])
            self.assertEqual(press._layout_changed(run, {"pages": 4}, pages), {})

    def test_a_layout_made_before_runs_kept_their_plan_cannot_be_edited(self):
        eid, rid = self.finished_run("2026-07-17")
        (self.edition_dir(eid) / "runs" / rid / "plan.json").unlink()
        said = self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {}, expect=409).json()
        self.assertIn("older version of the Desk", said["error"])

    def test_press_files_are_not_current_with_an_article_on_two_pages_or_an_unfinished_run(self):
        def page(n, arts, **kw):
            return {"page": n, "state": "done", "articles": arts, "pdfx_check": {"passed": True}, **kw}
        ok = {"state": "done", "pages": [page(1, ["a-1"]), page(2, ["a-2"])]}
        self.assertEqual(jobs.press_state(ok), {"press_ready": True, "pages_to_save": [], "pages_failing_check": [],
                                                "pages_with_repeats": [], "pages_with_overlaps": []})
        twice = {"state": "done", "pages": [page(1, ["a-1", "a-2"]), page(2, ["a-2"]), page(3, ["a-3"])]}
        self.assertEqual((jobs.press_state(twice)["press_ready"], jobs.press_state(twice)["pages_with_repeats"]), (False, [1, 2]))
        self.assertFalse(jobs.press_state({**ok, "state": "cancelled"})["press_ready"])
        self.assertFalse(jobs.press_state({**ok, "pages": [page(1, ["a-1"]), page(2, ["a-2"], edited_unsaved=True)]})["press_ready"])
        self.assertFalse(jobs.press_state({**ok, "pages": [page(1, ["a-1"]), {**page(2, []), "pdfx_check": {"passed": False}}]})["press_ready"])

    def test_articles_taken_off_every_page_are_listed_as_not_placed(self):
        eid = self.edition("2026-07-05")
        self.article(eid, headline="Lead story", body=words(80), priority=1)
        self.article(eid, headline="Second story", body=words(60), priority=2)
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        before = self.wait_run(eid, rid)
        self.assertEqual(before["state"], "done")
        first = before["not_placed"][0]["article"]                 # the fake layout lists it as not placed …
        status_file = self.edition_dir(eid) / "runs" / rid / "status.json"
        st = json.loads(status_file.read_text())
        for p in st["pages"]:                                       # … so it is on no page either
            p["articles"] = [a for a in p["articles"] if a != first]
        status_file.write_text(json.dumps(st))
        for n in (1, 2):
            url = f"/api/editions/{eid}/runs/{rid}/pages/{n}"
            self.call("POST", f"{url}/edit", {})
            self.call("PUT", f"{url}/edit", {"modules": []})
            self.call("POST", f"{url}/save", {})
        st = self.status(eid, rid)
        ids = [a["id"] for a in self.call("GET", f"/api/editions/{eid}").json()["articles"]]
        reasons = {x["article"]: x["reason"] for x in st["not_placed"]}
        self.assertEqual(sorted(reasons), sorted(ids))
        self.assertEqual(reasons.pop(first), "a fictional reason")                # the layout's own reason is kept
        self.assertEqual(list(reasons.values()), ["Taken off the pages in the editor, or moved to a page not saved yet: "
                                                  "bring it back onto a page, or save the page it moved to."])

    def test_a_save_that_cannot_finish_leaves_the_page_needing_a_save(self):
        eid, rid = self.finished_run("2026-07-06")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        self.call("POST", f"{url}/edit", {})
        real = jobs.render_page

        def broken(*_args, **_kwargs):
            raise OSError("a fictional disk problem")
        jobs.render_page = broken
        try:
            with contextlib.redirect_stderr(io.StringIO()) as logged:
                saved = self.call("POST", f"{url}/save", {}).json()
        finally:
            jobs.render_page = real
        self.assertEqual(saved["error"], "The page was saved, but its files could not be finished.")   # no English
        self.assertIn("OSError: a fictional disk problem", logged.getvalue())    # the error's own words: the log
        self.assertEqual(saved["msgs"][saved["error"]], {"code": "m.save.filesNotFinished", "params": {}})
        self.assertEqual((saved["press_ready"], saved["pages_to_save"]), (False, [1]))
        p1 = self.page_of(self.status(eid, rid), 1)
        self.assertTrue(p1["needs_save"])
        self.assertIn("could not be finished", p1["needs_save_reason"])
        again = self.call("POST", f"{url}/save", {}).json()
        self.assertEqual((again["error"], again["press_ready"]), (None, True))

    def test_another_layout_and_new_text(self):
        eid, rid = self.finished_run("2026-07-07")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        alt = self.call("POST", f"{url}/alternative", {"variant": 1}).json()
        self.assertNotEqual(alt["modules"][0]["x"], opened["modules"][0]["x"])
        self.assertTrue(self.page_of(self.status(eid, rid), 1)["edited_unsaved"])
        self.call("POST", f"{url}/alternative", {"variant": 4}, expect=400)
        eid2, rid2 = self.finished_run("2026-07-08")
        url2 = f"/api/editions/{eid2}/runs/{rid2}/pages/1"
        self.call("POST", f"{url2}/edit", {})
        same = self.call("POST", f"{url2}/refresh", {}).json()
        self.assertEqual((same["changed"], same["dropped"]), ([], []))
        self.assertFalse(self.page_of(self.status(eid2, rid2), 1).get("edited_unsaved"))   # no new text: no change
        (self.edition_dir(eid2) / "runs" / rid2 / "fake-refresh.json").write_text(json.dumps({"changed": ["d0000000001"]}))
        fresh = self.call("POST", f"{url2}/refresh", {}).json()
        self.assertEqual(fresh["changed"], ["d0000000001"])
        self.assertTrue(self.page_of(self.status(eid2, rid2), 1)["edited_unsaved"])

    def test_a_stopped_engine_is_started_again_and_the_page_opened_again(self):
        eid, rid = self.finished_run("2026-07-09")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        proc = self.desk.editing.proc
        proc.kill()
        proc.wait(timeout=10)
        moved = self.call("PUT", f"{url}/edit", {"modules": [{**opened["modules"][0], "w": 4}]}).json()
        self.assertEqual(moved["modules"][0]["w"], 4)
        self.assertIsNot(self.desk.editing.proc, proc)

    def test_editing_is_refused_where_it_cannot_work(self):
        eid, rid = self.finished_run("2026-07-02")
        self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/9/edit", {}, expect=404)
        self.call("PUT", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {"modules": "no"}, expect=400)
        self.call("PUT", f"/api/editions/{eid}/runs/{rid}/pages/1/edit", {"modules": []}, headers={"X-Desk": ""}, expect=403)
        self.call("POST", f"/api/editions/{eid}/runs/r-20990101-000000/pages/1/edit", {}, expect=404)

    def test_glyph_outlines_and_page_pictures(self):
        cache = self.home / "cache"
        (cache / "fonts").mkdir(parents=True, exist_ok=True)
        face = "ab" * 12
        src = REPO / "tools/oracle/v0/assets/fonts/devanagari/Mukta-Regular.ttf"
        (cache / "fonts" / f"{face}.ttf").write_bytes(src.read_bytes())
        g = self.call("GET", f"/api/glyphs/{face}?ids=1,2,99999").json()
        self.assertEqual(g["upem"], 1000)
        self.assertEqual(sorted(g["glyphs"]), ["1", "2"])
        self.call("GET", f"/api/glyphs/{face}?ids=x", expect=400)
        self.call("GET", f"/api/glyphs/{'cd' * 12}?ids=1", expect=404)
        self.call("GET", "/api/glyphs/../fonts", expect=404)
        (cache / "rasters").mkdir(parents=True, exist_ok=True)
        key = "ef" * 12
        (cache / "rasters" / f"{key}.cmyk").write_bytes(bytes([0, 0, 0, 255]) * 12)
        (cache / "rasters" / f"{key}.json").write_text(json.dumps({"width_px": 4, "height_px": 3}))
        r = self.call("GET", f"/files/rasters/{key}.jpg")
        self.assertEqual(r.headers.get("content-type"), "image/jpeg")
        self.call("GET", f"/files/rasters/{'01' * 12}.jpg", expect=404)

    # ---- locks: a locked story keeps its place; a page holding a story locked on another page is not saved

    def run_files(self, eid: str, rid: str) -> dict:
        """The run's status and page files as bytes (a refused change writes none of them)."""
        run = self.edition_dir(eid) / "runs" / rid
        return {p.name: p.read_bytes() for p in sorted(run.iterdir()) if p.name == "status.json" or p.suffix == ".pdf"}

    def test_a_lock_is_kept_and_a_locked_story_cannot_be_moved(self):
        eid, rid = self.finished_run("2026-07-20")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        m = opened["modules"][0]
        locked = self.call("PUT", f"{url}/edit", {"modules": [{**m, "locked": True}], "rev": opened["rev"]}).json()
        self.assertEqual((locked["modules"][0]["locked"], locked["rev"]), (True, opened["rev"] + 1))
        st = self.status(eid, rid)
        self.assertTrue(self.page_of(st, 1)["edited_unsaved"])                    # a lock is a change of the page
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        before = self.run_files(eid, rid)
        for change, why in (([{**m, "locked": True, "x": m["x"] + 40.69}], "move it"),
                            ([{**m, "locked": True, "w": 3}], "move it"),
                            ([{**m, "locked": False, "h": m["h"] + 5}], "move it"),       # unlocked and moved at once
                            ([], "take it off the page")):
            with self.subTest(why=why, change=change):
                said = self.call("PUT", f"{url}/edit", {"modules": change, "rev": locked["rev"]}, expect=400).json()
                self.assertEqual(said["error"], f"The page could not be changed: “Lead story” is locked: unlock it "
                                                f"(Shift+L) to {why}.")
                self.assertEqual(self.run_files(eid, rid), before)               # nothing marked or written
        again = self.call("POST", f"{url}/edit", {}).json()
        self.assertEqual((again["rev"], again["modules"]), (locked["rev"], locked["modules"]))
        unlocked = self.call("PUT", f"{url}/edit", {"modules": [{**m, "locked": False}], "rev": locked["rev"]}).json()
        self.assertFalse(unlocked["modules"][0]["locked"])                         # unlocked where it is
        moved = self.call("PUT", f"{url}/edit", {"modules": [{**m, "x": m["x"] + 40.69}], "rev": unlocked["rev"]}).json()
        self.assertEqual(moved["rev"], unlocked["rev"] + 1)
        saved = self.call("POST", f"{url}/save", {"rev": moved["rev"]}).json()
        self.assertEqual((saved["error"], saved["press_ready"]), (None, True))

    def test_a_crop_goes_through_to_the_engine_and_marks_the_page_until_saved(self):
        eid, rid = self.finished_run("2026-07-24")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        opened = self.call("POST", f"{url}/edit", {}).json()
        m = opened["modules"][0]
        self.assertIsNone(m["crop"])
        crop = {"photo": "p-0000000001", "focus": [0.25, 0.75], "zoom": 2.0}
        cropped = self.call("PUT", f"{url}/edit", {"modules": [{**m, "crop": crop}], "rev": opened["rev"]}).json()
        self.assertEqual((cropped["modules"][0]["crop"], cropped["rev"]), (crop, opened["rev"] + 1))
        st = self.status(eid, rid)
        self.assertTrue(self.page_of(st, 1)["edited_unsaved"])                    # a crop is a change of the page
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1]))
        before = self.run_files(eid, rid)
        for bad in ("centre", {"photo": "p-0000000001"}, {**crop, "zoom": "2"}, {**crop, "photo": "../p-0000000001"}):
            with self.subTest(bad=bad):
                said = self.call("PUT", f"{url}/edit", {"modules": [{**m, "crop": bad}], "rev": cropped["rev"]},
                                 expect=400).json()
                self.assertEqual(said["error"], "The page could not be changed: a photo crop must give the photo's id, "
                                                "a focus point (two numbers) and a zoom (a number).")
                self.assertEqual(self.run_files(eid, rid), before)               # nothing marked or written
        saved = self.call("POST", f"{url}/save", {"rev": cropped["rev"]}).json()
        self.assertEqual((saved["error"], saved["stale"], saved["press_ready"]), (None, [], True))   # never compared
        page = self.page_of(self.status(eid, rid), 1)
        self.assertEqual((list(page["printed"]["crops"]), page["edited_unsaved"]), (["a-" + m["story"][1:]], False))

    def test_a_page_cannot_be_saved_while_a_story_on_it_is_locked_on_another_page(self):
        eid, rid, first, second = self.two_page_run("2026-07-21")
        url1, url2 = (f"/api/editions/{eid}/runs/{rid}/pages/{n}" for n in (1, 2))
        story = "d" + second[2:]
        page1 = self.call("POST", f"{url1}/edit", {}).json()
        brought = {**page1["modules"][0], "story": story, "x": 12.82 + 40.69 * 4}
        page1 = self.call("PUT", f"{url1}/edit", {"modules": [page1["modules"][0], brought], "rev": page1["rev"]}).json()
        self.assertEqual((page1["also_on_pages"], page1["locked_on_pages"]), ({story: 2}, {}))
        page2 = self.call("POST", f"{url2}/edit", {}).json()
        page2 = self.call("PUT", f"{url2}/edit", {"modules": [{**page2["modules"][0], "locked": True}],
                                                  "rev": page2["rev"]}).json()             # locked on page 2 meanwhile
        page1 = self.call("POST", f"{url1}/edit", {}).json()
        self.assertEqual(page1["locked_on_pages"], {story: 2})
        before = self.run_files(eid, rid)
        said = self.call("POST", f"{url1}/save", {"rev": page1["rev"]}, expect=400).json()
        self.assertEqual(said["error"], "This page cannot be saved yet: “Second story” is also on page 2, locked there. "
                                        "Unlock it on page 2, or take it off this page, then save.")
        self.assertEqual(self.run_files(eid, rid), before)                         # no page marked, no file written
        st = self.status(eid, rid)
        self.assertEqual([bool(self.page_of(st, n).get("needs_save")) for n in (1, 2)], [False, False])
        # taken off page 1, the story cannot be brought back while it is locked on page 2
        page1 = self.call("PUT", f"{url1}/edit", {"modules": [page1["modules"][0]], "rev": page1["rev"]}).json()
        before = self.run_files(eid, rid)
        said = self.call("PUT", f"{url1}/edit", {"modules": [page1["modules"][0], brought], "rev": page1["rev"]},
                         expect=400).json()
        self.assertEqual(said["error"], "The page could not be changed: “Second story” is locked on page 2: unlock it "
                                        "there to bring it here.")
        self.assertEqual(self.run_files(eid, rid), before)
        # unlocked on page 2, it comes to page 1, and page 1's save takes it off page 2
        page2 = self.call("PUT", f"{url2}/edit", {"modules": [{**page2["modules"][0], "locked": False}],
                                                  "rev": page2["rev"]}).json()
        page1 = self.call("PUT", f"{url1}/edit", {"modules": [page1["modules"][0], brought], "rev": page1["rev"]}).json()
        saved = self.call("POST", f"{url1}/save", {"rev": page1["rev"]}).json()
        self.assertEqual((saved["pages_changed"], saved["articles"], saved["error"]), ({"2": []}, [first, second], None))
        self.assertEqual(self.page_of(self.status(eid, rid), 2)["articles"], [])

    def test_a_lock_made_while_a_page_is_saved_refuses_the_save_and_leaves_both_pages_marked(self):
        # the server looked before the story was locked on the other page; the engine refuses at the save itself,
        # before it writes anything, and both pages stay "needs saving" (fail closed)
        eid, rid, first, second = self.two_page_run("2026-07-22")
        url1, url2 = (f"/api/editions/{eid}/runs/{rid}/pages/{n}" for n in (1, 2))
        page1 = self.call("POST", f"{url1}/edit", {}).json()
        brought = {**page1["modules"][0], "story": "d" + second[2:], "x": 12.82 + 40.69 * 4}
        page1 = self.call("PUT", f"{url1}/edit", {"modules": [page1["modules"][0], brought], "rev": page1["rev"]}).json()
        page2 = self.call("POST", f"{url2}/edit", {}).json()
        self.call("PUT", f"{url2}/edit", {"modules": [{**page2["modules"][0], "locked": True}], "rev": page2["rev"]})
        run = self.edition_dir(eid) / "runs" / rid
        pdfs = {n: (run / n).read_bytes() for n in ("page-01.pdf", "page-02.pdf")}
        (run / "fake-state-hides-locks").write_text("x")
        try:
            said = self.call("POST", f"{url1}/save", {"rev": page1["rev"]}, expect=400).json()
        finally:
            (run / "fake-state-hides-locks").unlink()
        self.assertIn("this page cannot be saved yet: “Second story” is also on page 2, locked there", said["error"])
        self.assertEqual({n: (run / n).read_bytes() for n in pdfs}, pdfs)
        st = self.status(eid, rid)
        self.assertEqual([self.page_of(st, n)["needs_save"] for n in (1, 2)], [True, True])
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1, 2]))

    def test_another_layout_keeps_a_locked_story(self):
        eid, rid, first, second = self.two_page_run("2026-07-23")
        url = f"/api/editions/{eid}/runs/{rid}/pages/1"
        page = self.call("POST", f"{url}/edit", {}).json()
        lead = page["modules"][0]
        other = {**lead, "story": "d" + second[2:], "x": 12.82 + 40.69 * 3}
        page = self.call("PUT", f"{url}/edit", {"modules": [{**lead, "locked": True}, other], "rev": page["rev"]}).json()
        alt = self.call("POST", f"{url}/alternative", {"variant": 1, "rev": page["rev"]}).json()
        self.assertEqual(alt["modules"][0], {**lead, "locked": True})                 # where it was, still locked
        self.assertNotEqual(alt["modules"][1]["x"], other["x"])                       # the other one laid out again
        self.assertTrue(self.page_of(self.status(eid, rid), 1)["edited_unsaved"])
        both = self.call("PUT", f"{url}/edit", {"modules": [dict(m, locked=True) for m in alt["modules"]],
                                                "rev": alt["rev"]}).json()
        before = self.run_files(eid, rid)
        said = self.call("POST", f"{url}/alternative", {"variant": 1, "rev": both["rev"]}, expect=400).json()
        self.assertEqual(said["error"], "The page could not be changed: every story on this page is locked: unlock one "
                                        "to try another layout.")
        self.assertEqual(self.run_files(eid, rid), before)

    def test_the_save_refusal_names_the_story_and_fails_closed_on_a_list_it_cannot_read(self):
        notes = [{"story": "d0000000001", "headline": "Fictional lead"}, {"story": "dbriefs1", "headline": ""}]
        self.assertIsNone(editing.locked_elsewhere({"locked_on_pages": {}, "notes": notes}))
        self.assertIsNone(editing.locked_elsewhere({"notes": notes}))                  # an engine without locks
        one = editing.locked_elsewhere({"locked_on_pages": {"d0000000001": 3}, "notes": notes})
        self.assertEqual(one, "This page cannot be saved yet: “Fictional lead” is also on page 3, locked there. Unlock "
                              "it on page 3, or take it off this page, then save.")
        two = editing.locked_elsewhere({"locked_on_pages": {"d0000000001": 3, "dbriefs1": 2}, "notes": notes})
        self.assertTrue(two.startswith("This page cannot be saved yet: the column of short items is also on page 2"))
        self.assertTrue(two.endswith(" 1 more story on this page is locked on another page too."))
        for bad in ([], {"d0000000001": "3"}, {"d0000000001": True}, "x"):
            with self.subTest(bad=bad):
                self.assertIn("cannot be read", editing.locked_elsewhere({"locked_on_pages": bad, "notes": notes}))


    # ---- moving a story to another page (push): it leaves its page at once; each page prints it once it is saved

    NOT_PLACED = ("Taken off the pages in the editor, or moved to a page not saved yet: bring it back onto a page, or "
                  "save the page it moved to.")

    def move(self, eid, rid, page, story, to, rev, expect=200):
        return self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/{page}/move-story",
                         {"story": story, "to": to, "rev": rev}, expect=expect).json()

    def moved_run(self, day: str):
        """A two-page run whose second story was moved from page 2 to page 1, neither page saved since."""
        eid, rid, first, second = self.two_page_run(day)
        page2 = self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/2/edit", {}).json()
        moved = self.move(eid, rid, 2, "d" + second[2:], 1, page2["rev"])
        return eid, rid, first, second, page2, moved

    def test_moving_a_story_marks_both_pages_until_both_are_saved(self):
        eid, rid, first, second, page2, moved = self.moved_run("2026-07-24")
        url1, url2 = (f"/api/editions/{eid}/runs/{rid}/pages/{n}" for n in (1, 2))
        story = "d" + second[2:]
        self.assertEqual((moved["modules"], moved["rev"]), ([], page2["rev"] + 1))         # it left page 2 at once
        self.assertEqual({k: moved["moved"][k] for k in ("story", "page", "placed")}, {"story": story, "page": 1,
                                                                                       "placed": "free"})
        st = self.status(eid, rid)
        p1, p2 = self.page_of(st, 1), self.page_of(st, 2)
        self.assertTrue(p2["edited_unsaved"])
        self.assertEqual((p1["needs_save"], p1["needs_save_reason"], p1["edited_unsaved"], p1["rev_seen"]),
                         (True, "A story was moved here from page 2: check its place and save the page.", True,
                          moved["moved"]["rev"]))                                   # both pages from the one answer
        self.assertEqual((st["press_ready"], st["pages_to_save"], st["pages_with_repeats"]), (False, [1, 2], []))
        # the page it left saved first: the article prints nowhere yet and is listed so; the other page is still to save
        saved2 = self.call("POST", f"{url2}/save", {"rev": moved["rev"]}).json()
        self.assertEqual((saved2["articles"], saved2["pages_changed"], saved2["press_ready"], saved2["pages_to_save"]),
                         ([], {}, False, [1]))
        self.assertEqual(self.status(eid, rid)["not_placed"], [{"article": second, "reason": self.NOT_PLACED}])
        # the page it went to holds it; saved, it prints it once and the press files are current
        page1 = self.call("POST", f"{url1}/edit", {}).json()
        self.assertEqual(([m["story"] for m in page1["modules"]], page1["rev"]),
                         (["d" + first[2:], story], moved["moved"]["rev"]))
        saved1 = self.call("POST", f"{url1}/save", {"rev": page1["rev"]}).json()
        self.assertEqual((saved1["articles"], saved1["press_ready"], saved1["pages_to_save"], saved1["pages_with_repeats"]),
                         ([first, second], True, [], []))
        st = self.status(eid, rid)
        self.assertEqual((st["not_placed"], [self.page_of(st, n)["needs_save"] for n in (1, 2)]), ([], [False, False]))

    def test_saving_the_target_first_shows_the_article_on_two_pages_until_the_source_is_saved(self):
        eid, rid, first, second, page2, moved = self.moved_run("2026-07-25")
        url1, url2 = (f"/api/editions/{eid}/runs/{rid}/pages/{n}" for n in (1, 2))
        page1 = self.call("POST", f"{url1}/edit", {}).json()
        saved1 = self.call("POST", f"{url1}/save", {"rev": page1["rev"]}).json()
        self.assertEqual((saved1["articles"], saved1["pages_changed"]), ([first, second], {}))   # it left page 2 already
        self.assertEqual((saved1["press_ready"], saved1["pages_to_save"], saved1["pages_with_repeats"]),
                         (False, [2], [1, 2]))                                      # page 2's PDF still prints it
        self.assertEqual(self.page_of(self.status(eid, rid), 2)["articles"], [second])
        saved2 = self.call("POST", f"{url2}/save", {"rev": moved["rev"]}).json()
        self.assertEqual((saved2["press_ready"], saved2["pages_to_save"], saved2["pages_with_repeats"]), (True, [], []))

    def test_messages_carry_their_codes_for_the_screens(self):
        """Beside its English text (unchanged), an answer or a run status maps each of the Desk's own messages to its
        code and values ("msgs"), so the screens can say it in Marathi (tools/desk/engine/deskmsg.py)."""
        # a story moved to another page: that page's mark, in the run's status
        eid, rid, first, second, page2, moved = self.moved_run("2026-07-30")
        status = self.call("GET", f"/api/editions/{eid}/runs/{rid}").json()
        reason = next(p for p in status["pages"] if p["page"] == 1)["needs_save_reason"]
        self.assertEqual(reason, "A story was moved here from page 2: check its place and save the page.")
        self.assertEqual(status["msgs"][reason], {"code": "m.save.movedHere", "params": {"page": 2}})
        # the server's own refusal of a move
        url2 = f"/api/editions/{eid}/runs/{rid}/pages/2"
        said = self.call("POST", f"{url2}/move-story", {"story": "d" + first[2:], "to": 2}, expect=400).json()
        self.assertEqual(said["msgs"][said["error"]], {"code": "m.move.samePage", "params": {}})
        # the engine's refusal (a locked story): the server's sentence, with the engine's words inside it
        eid2, rid2, _, second2 = self.two_page_run("2026-08-01")
        url = f"/api/editions/{eid2}/runs/{rid2}/pages/2"
        page = self.call("POST", f"{url}/edit", {}).json()
        locked = self.call("PUT", f"{url}/edit", {"modules": [{**page["modules"][0], "locked": True}],
                                                  "rev": page["rev"]}).json()
        said = self.call("POST", f"{url}/move-story", {"story": "d" + second2[2:], "to": 1, "rev": locked["rev"]},
                         expect=400).json()
        self.assertEqual(said["error"], "The page could not be changed: “Second story” is locked: unlock it (Shift+L) to "
                                        "move it.")
        form = said["msgs"][said["error"]]
        self.assertEqual(form["code"], "m.save.notChanged")
        self.assertIn(form["params"]["reason"].get("code", "data"), ("m.edit.lockedMove", "data"))
        # a run asked for an edition without articles
        empty = self.edition("2026-07-31")
        said = self.call("POST", f"/api/editions/{empty}/runs", expect=400).json()
        self.assertEqual(said, {"error": "There are no articles in this edition yet.",
                                "msgs": {"There are no articles in this edition yet.": {"code": "m.run.noArticlesYet",
                                                                                        "params": {}}}})

    def test_a_move_is_refused_for_a_locked_story_the_same_page_a_page_not_laid_out_or_an_older_view(self):
        eid, rid, first, second = self.two_page_run("2026-07-26")
        url1, url2 = (f"/api/editions/{eid}/runs/{rid}/pages/{n}" for n in (1, 2))
        story = "d" + second[2:]
        page2 = self.call("POST", f"{url2}/edit", {}).json()
        locked = self.call("PUT", f"{url2}/edit", {"modules": [{**page2["modules"][0], "locked": True}],
                                                   "rev": page2["rev"]}).json()
        before = self.run_files(eid, rid)
        for body, code, says in (
                ({"story": story, "to": 1, "rev": locked["rev"]}, 400,
                 "The page could not be changed: “Second story” is locked: unlock it (Shift+L) to move it."),
                ({"story": story, "to": 1, "rev": page2["rev"]}, 409, "another window or tab"),    # an older view
                ({"story": "d" + first[2:], "to": 1, "rev": locked["rev"]}, 400, "“Lead story” is not on this page"),
                ({"story": story, "to": 2, "rev": locked["rev"]}, 400, "The story is on this page already"),
                ({"story": story, "to": 3, "rev": locked["rev"]}, 400, "This layout has no page 3."),
                ({"story": "x", "to": 1}, 400, "Say which story to move."),
                ({"story": story, "to": "1"}, 400, "Say which page"),
                ({"story": story, "to": True}, 400, "Say which page"),
                ({"story": story, "to": 1, "rev": "3"}, 400, "rev must be a whole number.")):
            with self.subTest(body=body):
                said = self.call("POST", f"{url2}/move-story", body, expect=code).json()
                self.assertIn(says, said["error"])
                self.assertEqual(self.run_files(eid, rid), before)                   # nothing marked or written
        again = self.call("POST", f"{url2}/edit", {}).json()
        self.assertEqual((again["rev"], again["modules"]), (locked["rev"], locked["modules"]))
        self.assertEqual([m["story"] for m in self.call("POST", f"{url1}/edit", {}).json()["modules"]], ["d" + first[2:]])
        # a page that was not laid out
        eid2 = self.edition("2026-07-27", volume="half")
        self.article(eid2, headline="Lead story", body=words(80), priority=1)
        self.article(eid2, headline="Second story", body=words(60), priority=2)
        rid2 = self.call("POST", f"/api/editions/{eid2}/runs").json()["run"]
        self.wait_run(eid2, rid2)
        page = self.call("POST", f"/api/editions/{eid2}/runs/{rid2}/pages/1/edit", {}).json()
        before = self.run_files(eid2, rid2)
        said = self.move(eid2, rid2, 1, page["modules"][0]["story"], 2, page["rev"], expect=400)
        self.assertEqual(said["error"], "Page 2 was not laid out in this layout: a story cannot move there.")
        self.assertEqual(self.run_files(eid2, rid2), before)

    def test_a_move_makes_the_target_pages_older_view_stale(self):
        eid, rid, first, second = self.two_page_run("2026-07-28")
        url1 = f"/api/editions/{eid}/runs/{rid}/pages/1"
        page1 = self.call("POST", f"{url1}/edit", {}).json()                       # page 1 open in another tab
        page2 = self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/2/edit", {}).json()
        moved = self.move(eid, rid, 2, "d" + second[2:], 1, page2["rev"])
        self.assertEqual(moved["moved"]["rev"], page1["rev"] + 1)
        self.call("POST", f"{url1}/save", {"rev": page1["rev"]}, expect=409)
        self.call("PUT", f"{url1}/edit", {"modules": page1["modules"], "rev": page1["rev"]}, expect=409)
        now = self.call("POST", f"{url1}/edit", {}).json()
        self.assertEqual([m["story"] for m in now["modules"]], ["d" + first[2:], "d" + second[2:]])

    def test_undo_after_a_move_brings_the_story_back_and_a_save_takes_it_off_the_target(self):
        eid, rid, first, second, page2, moved = self.moved_run("2026-07-29")
        url1, url2 = (f"/api/editions/{eid}/runs/{rid}/pages/{n}" for n in (1, 2))
        story = "d" + second[2:]
        undone = self.call("PUT", f"{url2}/edit", {"modules": page2["modules"], "rev": moved["rev"]}).json()
        self.assertEqual(undone["also_on_pages"], {story: 1})                       # in both pages' edits now
        saved2 = self.call("POST", f"{url2}/save", {"rev": undone["rev"]}).json()
        self.assertEqual((saved2["pages_changed"], saved2["press_ready"], saved2["pages_to_save"]), ({"1": [first]}, False, [1]))
        self.assertIn("to page 2", self.page_of(self.status(eid, rid), 1)["needs_save_reason"])
        page1 = self.call("POST", f"{url1}/edit", {}).json()
        self.assertEqual([m["story"] for m in page1["modules"]], ["d" + first[2:]])
        done = self.call("POST", f"{url1}/save", {"rev": page1["rev"]}).json()
        self.assertEqual((done["press_ready"], done["pages_to_save"], done["pages_with_repeats"]), (True, [], []))

    def test_an_engine_that_stops_mid_move_leaves_the_page_it_was_going_to_marked(self):
        eid, rid, first, second = self.two_page_run("2026-07-30")
        page2 = self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/2/edit", {}).json()
        run = self.edition_dir(eid) / "runs" / rid
        pdfs = {n: (run / n).read_bytes() for n in ("page-01.pdf", "page-02.pdf")}
        (run / "fake-move-stops").write_text("x")
        try:
            said = self.move(eid, rid, 2, "d" + second[2:], 1, page2["rev"], expect=500)
        finally:
            (run / "fake-move-stops").unlink()
        self.assertIn("Page 1 stays marked “needs saving” until it is saved", said["error"])
        self.assertEqual({n: (run / n).read_bytes() for n in pdfs}, pdfs)
        st = self.status(eid, rid)
        self.assertEqual((self.page_of(st, 1)["needs_save"], st["press_ready"], st["pages_to_save"]), (True, False, [1]))
        for n in (1, 2):                                                            # checked and saved again: current
            url = f"/api/editions/{eid}/runs/{rid}/pages/{n}"
            page = self.call("POST", f"{url}/edit", {}).json()
            done = self.call("POST", f"{url}/save", {"rev": page["rev"]}).json()
        self.assertEqual((done["press_ready"], done["pages_to_save"]), (True, []))

    def test_one_answer_marks_both_pages_and_a_refused_move_takes_its_mark_back(self):
        run = self.tmp / "unit-run"
        run.mkdir(exist_ok=True)

        def page(n, **kw):
            return {"page": n, "state": "done", "articles": [f"a-{n:010x}"], "pdfx_check": {"passed": True}, **kw}
        status = {"state": "done", "pages": [page(1), page(2, pdf_rev=7, rev_seen=7)]}
        status.update(jobs.press_state(status))
        write_json(run / "status.json", status)
        raw = (run / "status.json").read_bytes()
        mark = editing.before_move(run, 2, 1)
        st = json.loads((run / "status.json").read_text())
        self.assertEqual((st["pages"][0]["needs_save"], st["press_ready"], st["pages_to_save"]), (True, False, [1]))
        editing.unmark_move(run, mark)
        self.assertEqual((run / "status.json").read_bytes(), raw)                   # as it was, byte for byte
        mark = editing.before_move(run, 2, 1)                                       # marked again by something else
        st = json.loads((run / "status.json").read_text())
        st["pages"][0]["needs_save_reason"] = editing.UNFINISHED
        write_json(run / "status.json", st)
        editing.unmark_move(run, mark)
        self.assertEqual(json.loads((run / "status.json").read_text())["pages"][0]["needs_save"], True)
        write_json(run / "status.json", status)
        editing.note_revs(run, {1: 3, 2: 8, 3: 1, 4: True})
        st = json.loads((run / "status.json").read_text())
        self.assertEqual([(p["rev_seen"], p["edited_unsaved"]) for p in st["pages"]], [(3, True), (8, True)])
        self.assertEqual(st["pages_to_save"], [1, 2])

    # ---- the fixes after review: moves and saves take turns; no move to a full page; overlaps are never ready

    def four_article_run(self, day: str) -> tuple[str, str, list[str]]:
        """A finished run of four articles: the first and third on page 1, the second and fourth on page 2."""
        eid = self.edition(day)
        ids = [self.article(eid, headline=f"Story {i + 1}", body=words(60 - i), priority=2)["id"] for i in range(4)]
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.assertEqual(self.wait_run(eid, rid)["state"], "done")
        return eid, rid, ids

    def test_a_move_waits_for_a_save_in_the_run_and_the_page_it_goes_to_stays_marked(self):
        eid, rid, first, second = self.two_page_run("2026-08-10")
        url1, url2 = (f"/api/editions/{eid}/runs/{rid}/pages/{n}" for n in (1, 2))
        page1 = self.call("POST", f"{url1}/edit", {}).json()
        page2 = self.call("POST", f"{url2}/edit", {}).json()
        release, checking, quick = threading.Event(), threading.Event(), jobs.check_pdfx

        def slow_check(root, pdf):                    # the save of page 1, held in its PDF/X check (its save lock held)
            checking.set()
            release.wait(10)
            return quick(root, pdf)
        jobs.check_pdfx = slow_check
        out = {}
        try:
            save = threading.Thread(target=lambda: out.update(save=self.call("POST", f"{url1}/save", {"rev": page1["rev"]})))
            save.start()
            self.assertTrue(checking.wait(10))
            move = threading.Thread(target=lambda: out.update(move=self.move(eid, rid, 2, "d" + second[2:], 1, page2["rev"])))
            move.start()
            move.join(1.0)
            self.assertTrue(move.is_alive())                                        # it waits for the save …
            self.assertEqual(self.page_of(self.status(eid, rid), 1)["needs_save_reason"], editing.UNFINISHED)
            release.set()
            save.join(30)
            move.join(30)
        finally:
            jobs.check_pdfx = quick
            release.set()
        self.assertEqual(out["move"]["moved"]["placed"], "free")
        st = self.status(eid, rid)                    # … so the save ending never clears the mark the move made
        self.assertEqual((self.page_of(st, 1)["needs_save"], self.page_of(st, 1)["needs_save_reason"]),
                         (True, "A story was moved here from page 2: check its place and save the page."))
        self.assertEqual((st["press_ready"], st["pages_to_save"]), (False, [1, 2]))

    def test_two_windows_moving_at_once_take_turns(self):
        eid, rid, ids = self.four_article_run("2026-08-11")
        url2 = f"/api/editions/{eid}/runs/{rid}/pages/2"
        page2 = self.call("POST", f"{url2}/edit", {}).json()
        run = self.edition_dir(eid) / "runs" / rid
        events, real = [], {}
        for name in ("before_move", "unmark_move", "note_revs"):      # what each move does to the status, in order
            real[name] = getattr(editing, name)

            def logged(*a, _name=name, **k):
                events.append((threading.current_thread().name, _name))
                return real[_name](*a, **k)
            setattr(editing, name, logged)
        (run / "fake-move-slow").write_text("x")
        said = {}
        try:
            windows = [threading.Thread(name=f"w{i}", target=lambda i=i, aid=aid: said.update({i: self.call(
                "POST", f"{url2}/move-story", {"story": "d" + aid[2:], "to": 1, "rev": page2["rev"]}, expect=None)}))
                for i, aid in enumerate((ids[1], ids[3]))]
            for t in windows:
                t.start()
            for t in windows:
                t.join(30)
        finally:
            (run / "fake-move-slow").unlink()
            for name, fn in real.items():
                setattr(editing, name, fn)
        self.assertEqual(sorted(r.status for r in said.values()), [200, 409])      # the second window's view was older
        handlers = list(dict.fromkeys(t for t, _ in events))                     # the server's thread of each move
        self.assertEqual(len(handlers), 2)
        self.assertEqual([t for t, _ in events], [handlers[0]] * 2 + [handlers[1]] * 2)   # one move, then the other
        self.assertEqual(sorted([e for t, e in events if t == h] for h in handlers),
                         [["before_move", "note_revs"], ["before_move", "unmark_move"]])
        st = self.status(eid, rid)
        self.assertEqual((self.page_of(st, 1)["needs_save"], st["press_ready"]), (True, False))

    def test_a_move_to_a_page_with_no_free_place_is_refused_and_writes_nothing(self):
        eid, rid, first, second = self.two_page_run("2026-08-12")
        url1 = f"/api/editions/{eid}/runs/{rid}/pages/1"
        page1 = self.call("POST", f"{url1}/edit", {}).json()
        full = self.call("PUT", f"{url1}/edit", {"modules": [{**page1["modules"][0], "y": 400.0}], "rev": page1["rev"]}).json()
        page2 = self.call("POST", f"/api/editions/{eid}/runs/{rid}/pages/2/edit", {}).json()
        before = self.run_files(eid, rid)
        said = self.move(eid, rid, 2, "d" + second[2:], 1, page2["rev"], expect=400)
        self.assertEqual(said["error"], "The page could not be changed: there is no free place on page 1 for “Second "
                                        "story” (2 columns × 100 mm): make room there, or narrow it here, then move it.")
        self.assertEqual(self.run_files(eid, rid), before)                          # marked and written: nothing
        self.assertEqual(self.call("POST", f"{url1}/edit", {}).json()["modules"], full["modules"])

    def test_a_page_with_stories_over_each_other_is_never_press_ready(self):
        eid, rid, ids = self.four_article_run("2026-08-13")
        url1 = f"/api/editions/{eid}/runs/{rid}/pages/1"
        page = self.call("POST", f"{url1}/edit", {}).json()
        a, b = page["modules"]
        over = self.call("PUT", f"{url1}/edit", {"modules": [a, {**b, "x": a["x"]}], "rev": page["rev"]}).json()  # dragged
        self.assertEqual([p["kind"] for p in over["problems"]], ["overlap"])
        st = self.status(eid, rid)
        self.assertEqual((st["press_ready"], st["pages_with_overlaps"]), (False, [1]))
        saved = self.call("POST", f"{url1}/save", {"rev": over["rev"]}).json()
        self.assertEqual((saved["press_ready"], saved["pages_to_save"], saved["pages_with_overlaps"]), (False, [], [1]))
        self.assertIn("stories overlap on the page", self.page_of(self.status(eid, rid), 1)["warnings"])
        apart = self.call("PUT", f"{url1}/edit", {"modules": [a, b], "rev": over["rev"]}).json()
        self.assertEqual(apart["problems"], [])
        done = self.call("POST", f"{url1}/save", {"rev": apart["rev"]}).json()
        self.assertEqual((done["press_ready"], done["pages_with_overlaps"]), (True, []))

    def test_overlaps_and_stories_outside_count_from_the_saved_check_and_the_latest_answer(self):
        def page(n, **kw):
            return {"page": n, "state": "done", "articles": [f"a-{n:010x}"], "pdfx_check": {"passed": True}, **kw}
        for kw, ready in (({"layout_problems": ["outside"]}, False), ({"layout_problems_now": ["overlap"]}, False),
                          ({"layout_problems": "x"}, False), ({"layout_problems": [], "layout_problems_now": []}, True),
                          ({"edited": True, "warnings": [press.OVERLAP_WORDS]}, False),     # saved by an older Desk
                          ({"edited": True, "warnings": [press.OUTSIDE_WORDS]}, False),
                          ({"edited": True, "warnings": []}, True), ({}, True)):
            with self.subTest(kw=kw):
                st = press.press_state({"state": "done", "pages": [page(1), page(2, **kw)]})
                self.assertEqual((st["press_ready"], st["pages_with_overlaps"]), (ready, [] if ready else [2]))
        self.assertEqual(editing.placement([{"kind": "outside"}, {"kind": "overlap"}, {"kind": "short"}]),
                         ["outside", "overlap"])
        self.assertEqual((editing.placement(None), editing.placement("x"), editing.placement([3])),
                         (None, ["unreadable"], ["unreadable"]))


class MeasureTests(DeskCase):
    measure_delay = 0.3

    def wait_measured(self, eid: str, n: int, calls: int) -> dict:
        def check():
            st = self.measure_state(eid)
            ok = st and st["state"] == "done" and st["measured"] == n and self.engine_calls("measure", eid) == calls
            return st if ok else None
        return self.wait_for(check, what=f"{eid} to be measured ({n} stories, {calls} measure runs)")

    def test_measured_after_changes_debounced(self):
        eid = self.edition("2026-08-01")
        self.assertIsNone(self.measure_state(eid))
        for n in range(3):
            self.article(eid, headline=f"Story {n}")
        st = self.wait_measured(eid, 3, calls=1)                        # three quick changes: one measure
        self.assertEqual((st["total"], st["updated"]), (3, "y"))
        time.sleep(0.6)
        self.assertEqual(self.engine_calls("measure", eid), 1)
        art = self.call("GET", f"/api/editions/{eid}").json()["articles"][0]
        self.call("PUT", f"/api/editions/{eid}/articles/{art['id']}", {"priority": 1})
        self.wait_measured(eid, 3, calls=2)
        self.call("PUT", f"/api/editions/{eid}/articles/{art['id']}/photo", raw=png_bytes((40, 30)))
        self.wait_measured(eid, 3, calls=3)
        self.call("PUT", f"/api/editions/{eid}/articles/{art['id']}/photo-text", {"caption": "x"})
        self.wait_measured(eid, 3, calls=4)
        self.call("DELETE", f"/api/editions/{eid}/articles/{art['id']}/photo")
        self.wait_measured(eid, 3, calls=5)
        self.call("POST", f"/api/editions/{eid}/articles/bulk", {"text": "A pasted story\n\nIts text."})
        self.wait_measured(eid, 4, calls=6)
        self.call("POST", f"/api/editions/{eid}/import-sample", {"samples": ["sample-one"]})
        self.wait_measured(eid, 5, calls=7)
        self.call("DELETE", f"/api/editions/{eid}/articles/{art['id']}")
        self.wait_measured(eid, 4, calls=8)
        self.call("PUT", f"/api/editions/{eid}", {"price": "6"})            # not an article change
        time.sleep(0.8)
        self.assertEqual(self.engine_calls("measure", eid), 8)

    def test_changes_while_measuring_measure_again(self):
        eid = self.edition("2026-08-02", issue="slowmeasure")
        self.article(eid)
        self.wait_for(lambda: (self.measure_state(eid) or {}).get("state") == "measuring", what="measuring")
        self.article(eid, headline="Another story")
        self.wait_measured(eid, 2, calls=2)

    def test_no_measuring_beside_a_layout_run(self):
        busy = self.edition("2026-08-03", volume="slow")
        self.article(busy)
        self.wait_measured(busy, 1, calls=1)
        rid = self.call("POST", f"/api/editions/{busy}/runs").json()["run"]
        self.wait_run(busy, rid, states=("layout",), finished=False)
        other = self.edition("2026-08-04")
        self.article(other)
        time.sleep(1.0)                                                  # well past the delay
        self.assertEqual(self.engine_calls("measure", other), 0)
        self.call("POST", f"/api/editions/{busy}/runs/{rid}/cancel")
        self.wait_run(busy, rid)
        self.wait_measured(other, 1, calls=1)

    def test_a_run_stops_a_measure_and_it_is_redone(self):
        eid = self.edition("2026-08-05", issue="slowmeasure")
        self.article(eid)
        self.wait_for(lambda: (self.measure_state(eid) or {}).get("state") == "measuring", what="measuring")
        rid = self.call("POST", f"/api/editions/{eid}/runs").json()["run"]
        self.assertEqual(self.wait_run(eid, rid)["state"], "done")
        self.wait_measured(eid, 1, calls=2)
        self.assertEqual(self.measure_log, [])                          # a stopped measure is not a failure

    def test_measure_failures_are_only_logged(self):
        eid = self.edition("2026-08-06", issue="failmeasure")
        self.article(eid)
        self.wait_for(lambda: self.measure_log, what="the failure to be logged")
        self.assertEqual(self.measure_log, [f"measuring {eid} failed: The fake measure failed on purpose."])
        got = self.call("GET", f"/api/editions/{eid}").json()
        self.assertIsNone(got["measure"])
        self.measure_log.clear()

    def test_a_measure_left_unfinished_is_redone_at_start(self):
        home = self.tmp / "resume-home"
        for eid, state in (("2026-08-08", "measuring"), ("2026-08-09", "done")):
            ensure_dir(home / "editions" / eid)
            write_json(home / "editions" / eid / "edition.json", {"id": eid})
            write_json(home / "editions" / eid / "measure-status.json", {"state": state, "measured": 1, "total": 2})
        ensure_dir(home / "editions" / "not-an-edition")
        write_json(home / "editions" / "not-an-edition" / "measure-status.json", {"state": "measuring"})
        desk = Desk(home, static_dir=self.static)
        try:
            self.assertEqual(sorted(desk.measurer.due), ["2026-08-08"])
        finally:
            desk.close()

    def test_deleting_an_edition_stops_its_measure(self):
        eid = self.edition("2026-08-07", issue="slowmeasure")
        self.article(eid)
        self.wait_for(lambda: (self.measure_state(eid) or {}).get("state") == "measuring", what="measuring")
        self.call("DELETE", f"/api/editions/{eid}")
        time.sleep(2.0)                                                  # the fake would have finished by now
        self.assertFalse(self.edition_dir(eid).exists())                 # nothing wrote into the old folder
        trashed = [p for p in (self.home / "trash").iterdir() if p.name.startswith(f"{eid}-")]
        self.assertEqual(json.loads((trashed[0] / "measure-status.json").read_text())["state"], "measuring")


if __name__ == "__main__":
    unittest.main()
