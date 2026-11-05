# A fake of tools/desk/engine/desk_engine.py for the worker's tests (the real engine needs the paper's private
# dataset): the same commands, files and answers, made quickly, on fictional data. Copied by the tests to a folder of
# their own as desk_engine.py (so the Desk's stop_orphan knows it), with ENGINE_DIR = the Desk's engine folder first.
# Its behaviour is chosen by the request: generate by the edition's "volume", measure by its "issue", setup by a file
# "fake-mode" in the dataset. Every page PDF is a real one-page PDF (pikepdf), as tools/desk/test/test_server.py's
# FAKE_ENGINE writes them.
import json, os, signal, sys, time
from pathlib import Path
sys.path.insert(0, ENGINE_DIR)                                   # noqa: F821 — set by the test
import deskmsg as DM                                             # the Desk's own messages, as the engine writes them

def first(name, default=None):
    a = sys.argv[2:]
    v = [a[i + 1] for i, x in enumerate(a) if x == name and i + 1 < len(a)]
    return v[0] if v else default

def reply(obj, code=0):
    sys.stdout.write(json.dumps(DM.annotate(obj)) + "\n")
    sys.stdout.flush()
    sys.exit(code)

def write_atomic(path, obj):
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(DM.annotate(obj)))
    os.replace(tmp, path)

def fake_candidates():
    o = {"page_w_mm": 330.0, "page_h_mm": 520.0, "news": [[12.0, 70.0, 318.0, 500.0]],
         "kept": [{"kind": "furniture", "box": [12.0, 10.0, 318.0, 60.0]}], "ad_slots": []}
    return {r: [{"name": f"fictional-{r}-{d}", "date": f"2026-01-0{d}", "page": 1, "outline": o} for d in (2, 1)]
            for r in ("front", "inside_imprint", "inside", "back")}
cmd = sys.argv[1]
home = Path(first("--home"))
with open(home / "fake-engine-calls.txt", "a") as f:
    f.write(cmd + " " + (first("--edition") or first("--dataset") or "-") + "\n")
if cmd == "setup":
    ds = Path(first("--dataset"))
    if not list((ds / "report" / "page1" / "pages").glob("*.json")):
        reply({"error": f"no page models in {ds / 'report' / 'page1' / 'pages'}"}, 1)
    if (ds / "fake-mode").exists() and (ds / "fake-mode").read_text() == "setupfail":
        reply({"error": "no page of the dataset can serve as the back template"}, 1)
    cfg = {"schema": "pageinator.desk.config/1", "engine": "desk-engine/0.1.0", "created": "x", "dataset": str(ds),
           "templates": {"front": "fictional-p1", "inside_imprint": "fictional-p2", "inside": "fictional-p3",
                         "back": "fictional-p4"}, "candidates": fake_candidates(),
           "needs_per_role": {"front": {"stories": 5, "briefs": 1, "photos": 2, "words": 1500, "pages_measured": 3}}}
    write_atomic(home / "config.json", cfg)
    reply({"config": {k: v for k, v in cfg.items() if k != "dataset"}})
cfg = json.loads((home / "config.json").read_text()) if (home / "config.json").exists() else {}
if not cfg.get("templates") or not cfg.get("dataset") or not Path(cfg["dataset"]).is_dir():
    reply({"error": "the Desk is not set up yet: run setup"}, 1)
if cmd == "candidates":
    cfg["candidates"] = fake_candidates()
    write_atomic(home / "config.json", cfg)
    reply({"candidates": cfg["candidates"]})
if cmd == "retemplate":
    role, page = first("--role") or "", first("--page") or ""
    for a in sys.argv[2:]:
        role = a[7:] if a.startswith("--role=") else role
        page = a[7:] if a.startswith("--page=") else page
    cands = cfg.get("candidates") or fake_candidates()
    if page not in [c["name"] for c in cands.get(role, [])]:
        reply({"error": f"the page {page} cannot serve as the {role.replace('_', ' ')} template"}, 1)
    cfg["candidates"], cfg["templates"] = cands, {**cfg["templates"], role: page}
    write_atomic(home / "config.json", cfg)
    reply({"templates": cfg["templates"]})
if cmd == "plan":
    pages, back = int(first("--pages")), first("--back-ads") == "1"
    out = []
    for n in range(1, pages + 1):
        role = "front" if n == 1 else "back" if n == pages and back else "inside"
        out.append({"page": n, "role": role, "template_role": "inside_imprint" if n == 2 else role, "news_mm2": 50000.0,
                    "ad_slots": [{"slot": "back-1", "w_mm": 100.0, "h_mm": 50.0}] if role == "back" else []})
    per = {"front": {"stories": 5, "briefs": 1, "photos": 2, "words": 1500}}
    reply({"pages": out, "needs": {"stories": 5 * pages, "briefs": pages, "photos": 2 * pages, "words": 1500 * pages,
                                   "per_role": per, "spare_share": 0.2}})
if cmd == "measure":
    ed = home / "editions" / first("--edition")
    mode = json.loads((ed / "edition.json").read_text()).get("issue", "")
    n = len(json.loads((ed / "articles.json").read_text())["articles"])
    if mode == "failmeasure":
        reply({"error": "The fake measure failed on purpose."}, 1)
    write_atomic(ed / "measure-status.json", {"state": "measuring", "measured": 0, "total": n, "updated": "x"})
    if mode in ("slowmeasure", "hangmeasure"):
        time.sleep(1.5 if mode == "slowmeasure" else 60)
    write_atomic(ed / "measure-status.json", {"state": "done", "measured": n, "total": n, "updated": "y"})
    reply({"measured": n, "total": n, "failed": 0})
if cmd == "generate":
    run = home / "editions" / first("--edition") / "runs" / first("--run")
    req = json.loads((run / "request.json").read_text())
    mode = req["edition"].get("volume", "")
    pages = [{"page": n, "role": "front" if n == 1 else "back", "state": "waiting", "articles": [], "pdf": None,
              "seconds": 0.0, "message": "", "warnings": []} for n in (1, 2)]
    status = {"schema": "pageinator.desk.engine-status/1", "state": "planning", "started": "", "updated": "",
              "message": "Planning the pages.", "pages": pages, "not_placed": [], "article_warnings": [],
              "timings": {"measure_s": 0.1, "plan_s": 0.2, "layout_s": 0.3}, "plan_log": [["a", 1]]}
    write_atomic(run / "engine-status.json", status)
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
    import pikepdf
    for p in pages:
        if mode == "half" and p["page"] == 2:
            p.update(state="failed", message="a fictional layout problem")
            continue
        pdf = pikepdf.new()
        pdf.add_blank_page(page_size=(400, 600))
        pdf.pages[0].Contents = pdf.make_stream(b"0 0 0 0.8 k 40 40 320 520 re f")
        name = "page-%02d.pdf" % p["page"]
        pdf.save(run / name, deterministic_id=True)
        p.update(state="done", pdf=name, seconds=0.01,
                 articles=[a["id"] for i, a in enumerate(req["articles"]) if i % 2 == p["page"] - 1],
                 warnings=[DM.msg("m.warn.charRemoved", what=DM.data("the headline"), code=8216)])
        status["state"] = "layout"
        write_atomic(run / "engine-status.json", status)
        if mode == "pagewait":                                   # the test cancels while page 1 is done
            time.sleep(60)
    status.update(state="done", message="Two pages.",
                  not_placed=[{"article": req["articles"][0]["id"], "reason": DM.msg("m.plan.needsText")}])
    write_atomic(run / "engine-status.json", status)
    reply({"pages": 2, "failed": 0})
if cmd == "edit-service":
    # deskedit's page sessions, faked (one JSON request per line): each page's modules and revision from its
    # page-NN.edit.json, else its manifest; every change writes the file. A story "dffffffffff" is one whose articles
    # are gone: opening its page takes it off (the engine's own change). An edition whose volume is "editfail" never
    # gets the service started.
    import hashlib as H, pikepdf, deskprinted as DPR
    def say(obj):
        sys.stdout.write(json.dumps(DM.annotate(obj)) + "\n")
        sys.stdout.flush()
    def read(path, default=None):
        return json.loads(path.read_text()) if path.exists() else default
    if any(read(e / "edition.json", {}).get("volume") == "editfail" for e in (home / "editions").glob("*")):
        sys.exit(2)
    say({"id": 0, "ok": True, "result": {"ready": True, "engine": "fake"}})
    sessions = {}
    def run_dir(eid, run):
        return home / "editions" / eid / "runs" / run
    def page_modules(rd, n):
        saved = read(rd / ("page-%02d.edit.json" % n), {})
        if saved.get("page") == n and saved.get("modules") is not None:
            return saved["modules"], int(saved.get("rev") or 0)
        man = read(rd / ("page-%02d.manifest.json" % n), {})
        return [{"story": p["story"], "x": p["x_mm"], "y": p["y_mm"], "w": p["w_cols"], "h": p["h_mm"], "locked": False,
                 "crop": None} for p in man.get("placed") or []], 0
    def save_edit(s):
        write_atomic(s["dir"] / ("page-%02d.edit.json" % s["page"]),
                     {"schema": "pageinator.desk.page-edit/1", "page": s["page"], "modules": s["modules"], "rev": s["rev"]})
    def load(eid, run, n):
        rd = run_dir(eid, run)
        mods, rev = page_modules(rd, n)
        s = {"dir": rd, "page": n, "modules": mods, "rev": rev, "key": "%s/%s/%d" % (eid, run, n),
             "pages": int(read(rd / "request.json")["edition"]["pages"])}
        if any(m["story"] == "dffffffffff" for m in mods):
            s["modules"] = [m for m in mods if m["story"] != "dffffffffff"]
            s["rev"] += 1
            save_edit(s)
        return s
    def others(s, locked):
        mine, out = {m["story"] for m in s["modules"]}, {}
        for n in range(1, s["pages"] + 1):
            if n != s["page"]:
                for m in page_modules(s["dir"], n)[0]:
                    if m["story"] in mine and (m.get("locked") or not locked):
                        out.setdefault(m["story"], n)
        return out
    def problems(s):
        seen = [(m["x"], m["y"]) for m in s["modules"]]
        return [{"kind": "overlap", "stories": []}] if len(set(seen)) < len(seen) else []
    def draw(s, items=True):
        out = {"session": s["key"], "page": s["page"], "role": "front", "rev": s["rev"], "modules": s["modules"],
               "notes": [], "problems": problems(s), "pool": [], "grid": {}, "also_on_pages": others(s, False),
               "locked_on_pages": others(s, True)}
        return {**out, "items": [], "fonts": {}, "fixed_items": 0} if items else out
    def check_rev(s, base):
        if base is not None and int(base) != s["rev"]:
            raise ValueError(DM.msg("m.edit.stale"))
    def articles_of(s):
        story_articles = {}
        for man in s["dir"].glob("page-*.manifest.json"):
            for p in read(man).get("placed") or []:
                story_articles[p["story"]] = p.get("articles") or []
        return [a for m in s["modules"] for a in story_articles.get(m["story"], [])]
    def changed(s):
        s["rev"] += 1
        save_edit(s)
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        req = json.loads(line)
        try:
            c = req["cmd"]
            if c == "open":
                key = "%s/%s/%d" % (req["edition"], req["run"], req["page"])
                if key not in sessions or req.get("reload"):
                    sessions[key] = load(req["edition"], req["run"], req["page"])
                with open(home / "fake-engine-calls.txt", "a") as f:
                    f.write("open %s reload=%s\n" % (key, bool(req.get("reload"))))
                res = draw(sessions[key])
            else:
                s = sessions.get(req["session"])
                if s is None:
                    raise ValueError(DM.msg("m.edit.notOpen"))
                base = req.get("base_rev")
                if c == "state":
                    res = draw(s, items=False)
                elif c == "set":
                    check_rev(s, base)
                    s["modules"] = req["modules"]
                    changed(s)
                    res = draw(s)
                elif c == "alternative":
                    check_rev(s, base)
                    s["modules"] = list(reversed(s["modules"]))
                    changed(s)
                    res = draw(s)
                elif c == "refresh":
                    check_rev(s, base)
                    live = {a["id"]: a for a in read(s["dir"].parent.parent / "articles.json")["articles"]}
                    laid = read(s["dir"] / "request.json")["articles"]
                    over = {a["id"]: live.get(a["id"]) for a in laid if live.get(a["id"]) != a}
                    write_atomic(s["dir"] / "edit-articles.json",
                                 {"schema": "pageinator.desk.edit-articles/1", "articles": over})
                    changed(s)
                    res = draw(s)
                elif c == "move":
                    check_rev(s, base)
                    m = next((x for x in s["modules"] if x["story"] == req["story"]), None)
                    if m is None:
                        raise ValueError(DM.msg("m.edit.moveNotHere", name=DM.data(req["story"])))
                    eid, run, _ = req["session"].split("/")
                    tkey = "%s/%s/%d" % (eid, run, req["page"])
                    t = sessions.get(tkey) or load(eid, run, req["page"])
                    sessions[tkey] = t
                    t["modules"] = t["modules"] + [{**m, "x": 0, "y": 0}]
                    changed(t)
                    s["modules"] = [x for x in s["modules"] if x["story"] != req["story"]]
                    changed(s)
                    res = {**draw(s), "moved": {"story": req["story"], "page": req["page"], "rev": t["rev"]}}
                elif c == "export":
                    check_rev(s, base)
                    pdf = pikepdf.new()
                    pdf.add_blank_page(page_size=(400, 600))
                    pdf.pages[0].Contents = pdf.make_stream(b"0 0 0 1 k 10 10 100 100 re f")
                    name = "page-%02d.pdf" % s["page"]
                    pdf.save(s["dir"] / name, deterministic_id=True)
                    mine, taken = {m["story"] for m in s["modules"]}, {}
                    for n in range(1, s["pages"] + 1):
                        if n == s["page"] or not (s["dir"] / ("page-%02d.manifest.json" % n)).exists():
                            continue
                        mods, rev = page_modules(s["dir"], n)
                        keep = [m for m in mods if m["story"] not in mine]
                        if len(keep) != len(mods):
                            o = sessions.get("%s/%d" % (req["session"].rsplit("/", 1)[0], n))
                            rev = max(rev, o["rev"] if o else 0) + 1
                            write_atomic(s["dir"] / ("page-%02d.edit.json" % n), {"schema": "pageinator.desk.page-edit/1",
                                         "page": n, "modules": keep, "rev": rev, "changed_by_page": s["page"]})
                            if o:
                                o["modules"], o["rev"] = keep, rev
                            taken[str(n)] = []
                    arts = articles_of(s)
                    over = (read(s["dir"] / "edit-articles.json", {}) or {}).get("articles") or {}
                    by_id = {a["id"]: over.get(a["id"], a) for a in read(s["dir"] / "request.json")["articles"]}
                    printed = {"v": DPR.VERSION, "articles": {a: DPR.article_sig(by_id[a], False) for a in arts
                                                              if by_id.get(a)}, "folio": None, "ads": {}}
                    res = {"pdf": name, "sha256": H.sha256((s["dir"] / name).read_bytes()).hexdigest(), "rev": s["rev"],
                           "problems": problems(s), "articles": arts, "pages_changed": taken, "printed": printed}
                else:
                    raise ValueError(DM.msg("m.edit.unknownCommand", cmd=c))
            say({"id": req.get("id"), "ok": True, "result": res})
        except ValueError as e:
            say({"id": req.get("id"), "ok": False, "error": e.args[0]})
    sys.exit(0)
reply({"error": f"the fake engine has no {cmd}"}, 1)
