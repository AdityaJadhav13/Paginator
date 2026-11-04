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
                         "back": "fictional-p4"},
           "needs_per_role": {"front": {"stories": 5, "briefs": 1, "photos": 2, "words": 1500, "pages_measured": 3}}}
    write_atomic(home / "config.json", cfg)
    reply({"config": {k: v for k, v in cfg.items() if k != "dataset"}})
cfg = json.loads((home / "config.json").read_text()) if (home / "config.json").exists() else {}
if not cfg.get("templates") or not cfg.get("dataset") or not Path(cfg["dataset"]).is_dir():
    reply({"error": "the Desk is not set up yet: run setup"}, 1)
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
reply({"error": f"the fake engine has no {cmd}"}, 1)
