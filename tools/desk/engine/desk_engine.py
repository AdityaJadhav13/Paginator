"""Pageinator Desk engine — command line (tools/desk/CONTRACT.md §2). Runs in the frozen oracle environment:

  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python tools/desk/engine/desk_engine.py <command> --home DIR …

Commands: setup, plan, samples, import-sample, generate. Each prints one JSON object on stdout.
An internal tool for the owner's own paper; the page layout is gen1's (EXP-GEN-1), imported read-only. No AI.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import os
import pickle
import select
import shutil
import signal
import statistics
import sys
import time
import traceback
import unicodedata
from concurrent.futures import FIRST_COMPLETED, ProcessPoolExecutor, wait
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import deskarticles as DA  # noqa: E402
import deskfonts  # noqa: E402
import deskprinted  # noqa: E402
import deskgen as DG  # noqa: E402
import deskplan as DP  # noqa: E402
import desksamples as DS  # noqa: E402
import deskworker as DW  # noqa: E402
from deskcommon import (ARTICLE_ID, EDITION_ID, ENGINE_VERSION, PHOTO_ID, RUN_ID, SLOT_ID, check_id, desk_home,  # noqa: E402
                        error_text, log, now_iso, read_json, write_json)

G = DG.G
ROLES = ("front", "inside_imprint", "inside", "back")
DEFAULT_DATASET = Path.home() / "PageinatorPrivate" / "published1"


# ------------------------------------------------------------------------------------------- config
def config(home: Path) -> dict:
    cfg = read_json(home / "config.json", {})
    if not cfg.get("templates") or not cfg.get("dataset"):
        raise SystemExit("the Desk is not set up yet: run setup")
    return cfg


def find_dataset(arg: str | None) -> Path:
    if arg:
        return Path(arg).expanduser()
    env = os.environ.get("PAGEINATOR_DESK_DATASET")
    if env:
        return Path(env).expanduser()
    found = sorted(p.parent.parent.parent for p in DEFAULT_DATASET.glob("*/report/page1/pages"))
    if len(found) != 1:
        raise SystemExit("cannot tell which dataset to use: pass --dataset DIR (a folder with report/page1/pages)")
    return found[0]


def sample_date(sample: str) -> str:
    return DS._date_of(sample) or sample


def page_role_counts(models_by_sample) -> dict:
    """Measured needs per page role: medians over the paper's printed pages (aggregates only)."""
    rows = {"front": [], "inside": [], "back": []}
    for pages in models_by_sample.values():
        last = max(p for p, _, _ in pages)
        for p, _, m in pages:
            stories = [s for s in DS.stories_of(m) if DS.deva_share(s["body"]) >= 0.5]
            if not stories:
                continue
            ads = sum((e["bbox_mm"][2] - e["bbox_mm"][0]) * (e["bbox_mm"][3] - e["bbox_mm"][1]) for e in m["elements"] if e["kind"] == "ad")
            role = "front" if p == 1 else "back" if p == last and ads >= 0.15 * m["page_w_mm"] * m["page_h_mm"] else "inside"
            briefs = [s for s in stories if not s["images"] and DA.body_words(s["body"]) <= DA.BRIEF_WORDS]
            rows[role].append({"stories": len(stories) - len(briefs), "briefs": len(briefs),
                               "photos": sum(len(s["images"]) > 0 for s in stories),
                               "words": sum(DA.body_words(s["body"]) for s in stories)})
    out = {}
    for role, rs in rows.items():
        if rs:
            out[role] = {k: int(round(statistics.median(r[k] for r in rs))) for k in ("stories", "briefs", "photos", "words")}
            out[role]["pages_measured"] = len(rs)
    return out


def cmd_setup(home: Path, args) -> dict:
    ds = find_dataset(args.dataset)
    pages_dir = ds / "report" / "page1" / "pages"
    if not pages_dir.exists():
        raise SystemExit(f"no page models in {pages_dir}")
    by_sample = DS.sample_pages(ds)
    last_page = {s: max(p for p, _, _ in v) for s, v in by_sample.items()}
    cands = {r: [] for r in ROLES}
    for sample, pages in by_sample.items():
        for p, name, m in pages:
            if DS.deva_share(" ".join(b["text"] for s in m["stories"] for b in s["flow"] if b["type"] == "para")) < 0.5:
                continue
            last = p == last_page[sample]
            for role in ROLES:
                if role == "front" and p != 1 or role == "back" and not last or role in ("inside", "inside_imprint") and (p == 1 or last):
                    continue
                try:
                    tpl = DG.Template(ds, name, role)
                except Exception as ex:  # noqa: BLE001
                    log("template", name, role, "rejected:", ex)
                    continue
                imprint = any("मुद्रक" in (e.get("text") or "") and e["bbox_mm"][1] >= tpl.news_bottom - 1 for e in tpl.keep)
                ok = tpl.intruders == 0 and tpl.kept_stories_dropped == 0 and len(tpl.regions) == 1
                if role == "front":
                    ok &= tpl.news_top > 60 and not tpl.ad_slots
                elif role == "back":
                    ok &= bool(tpl.ad_slots) and tpl.news_bottom < 0.75 * tpl.page_h
                elif role == "inside_imprint":
                    ok &= p == 2 and imprint and not tpl.ad_slots
                else:
                    ok &= not imprint and not tpl.ad_slots and tpl.news_top < 50 and tpl.news_bottom > 0.9 * tpl.page_h
                if ok:                                     # inside pages: a page 3 or later (page 2 carries the imprint)
                    cands[role].append((role != "inside" or p >= 3, sample_date(sample), name))
    templates = {}
    for role in ROLES:
        if not cands[role]:
            raise SystemExit(f"no page of the dataset can serve as the {role.replace('_', ' ')} template")
        templates[role] = max(cands[role])[-1]              # the paper's most recent design
    cal = DG.Calibration(ds)
    cx = DG.CP.Context(ds, "paper")
    cfg = {"schema": "pageinator.desk.config/1", "engine": ENGINE_VERSION, "created": now_iso(), "dataset": str(ds),
           "templates": templates, "needs_per_role": page_role_counts(by_sample),
           "calibration": {"styles": {f"{a}/{b}": n for (a, b), n in sorted(cal.styles.items())}, "lead_side": cal.lead_side,
                           "space_em": cal.space_em, "r_cal": cx.r_cal},
           "template_summary": {r: DG.Template(ds, n, r).summary() for r, n in templates.items()}}
    home.mkdir(parents=True, exist_ok=True, mode=0o700)
    write_json(home / "config.json", cfg)
    return {"config": {k: v for k, v in cfg.items() if k != "dataset"}}


# ------------------------------------------------------------------------------------------- plan
def page_roles(pages: int, back_ads: bool) -> list[str]:
    if pages not in (4, 8, 16):
        raise ValueError("pages must be 4, 8 or 16")
    roles = ["front", "inside_imprint"] + ["inside"] * (pages - 3) + ["back" if back_ads else "inside"]
    return roles


def needs(cfg: dict, roles: list[str]) -> dict:
    per = cfg.get("needs_per_role") or {}
    use = {"front": "front", "inside_imprint": "inside", "inside": "inside", "back": "back"}
    tot = {k: 0 for k in ("stories", "briefs", "photos", "words")}
    for r in roles:
        rec = per.get(use[r]) or per.get("inside") or {}
        for k in tot:
            tot[k] += int(rec.get(k, 0))
    return {**tot, "per_role": {k: {kk: v.get(kk, 0) for kk in ("stories", "briefs", "photos", "words")} for k, v in per.items()},
            "spare_share": 0.2}


def cmd_plan(home: Path, args) -> dict:
    cfg = config(home)
    roles = page_roles(int(args.pages), bool(int(args.back_ads)))
    ds = Path(cfg["dataset"])
    tpls = {r: DG.Template(ds, cfg["templates"][r], r) for r in set(roles)}
    pages = [{"page": i + 1, "role": "back" if r == "back" else "front" if r == "front" else "inside",
              "template_role": r, "news_mm2": round(tpls[r].news_mm2(), 1),
              "ad_slots": [{k: s[k] for k in ("slot", "w_mm", "h_mm")} for s in tpls[r].ad_slots]} for i, r in enumerate(roles)]
    return {"pages": pages, "needs": needs(cfg, roles)}


def cmd_samples(home: Path, args) -> dict:
    cfg = config(home)
    return {"samples": DS.list_samples(Path(cfg["dataset"]))}


def cmd_import(home: Path, args) -> dict:
    cfg = config(home)
    eid = check_id(EDITION_ID, args.edition, "edition id")
    ed = home / "editions" / eid
    if not (ed / "edition.json").exists():
        raise SystemExit(f"no edition {eid}")
    return DS.import_samples(Path(cfg["dataset"]), ed, args.sample or [])


# ------------------------------------------------------------------------------------------- generate
class Status:
    def __init__(self, run_dir: Path):
        self.path = run_dir / "engine-status.json"
        self.data = {"schema": "pageinator.desk.engine-status/1", "state": "starting", "started": now_iso(), "updated": now_iso(),
                     "message": "", "pages": [], "not_placed": [], "article_warnings": []}
        self.save()

    def save(self):
        self.data["updated"] = now_iso()
        write_json(self.path, self.data)

    def set(self, **kw):
        self.data.update(kw)
        self.save()

    def page(self, n: int) -> dict:
        return next(p for p in self.data["pages"] if p["page"] == n)


def clean_text(text: str, warn: list, what: str) -> str:
    """NFC text without characters the stand-in fonts lack (reported). Curly quotes and dashes the faces lack become
    their plain forms."""
    t = unicodedata.normalize("NFC", text or "")
    bad = DG.unsupported_chars(t)
    if not bad:
        return t
    plain = {"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", " ": " "}
    for ch in sorted(bad):
        rep = plain.get(ch, "")
        if rep and not DG.unsupported_chars(rep):
            t = t.replace(ch, rep)
        else:
            t = t.replace(ch, "")
            warn.append(f"{what}: removed a character the fonts do not have (U+{ord(ch):04X})")
    return t


def order_key(a: dict, i: int):
    return (int(a.get("priority") or 3), i)


# the Desk's own code that shapes a story's options (a change to it makes every cached option stale)
DESK_CODE = hashlib.sha256(b"".join((Path(__file__).resolve().parent / f).read_bytes()
                                    for f in ("deskgen.py", "deskarticles.py", "deskworker.py"))).hexdigest()[:16]


def options_cache_key(story: dict, elements: list, photo: dict | None, cal, cx) -> str:
    """The story's content, photo, house calibration and code versions (gen1's, compose_page's, the Desk's). Not its
    rank size (the headline element's size_pt only orders the stories; the options do not depend on it)."""
    els = sorted(({**e, "size_pt": 0.0} if e["kind"] == "headline" else e for e in elements), key=lambda e: e["id"])
    blob = json.dumps([story, els, photo, sorted(cal.styles.items()), cal.space_em, cx.inputs, cx.r_cal, ENGINE_VERSION, G.GEN,
                       DG.RANK_CLASSES, DESK_CODE], sort_keys=True, ensure_ascii=False, default=str)
    return hashlib.sha256(blob.encode()).hexdigest()[:32]


def keep_copy(src: Path, dst: Path) -> None:
    """dst as a second name of src's file (a hard link; a copy where the folders are on different disks): a later
    change or removal of src never reaches dst (the store replaces files by renaming, so a link keeps the old file)."""
    if dst.exists():
        return
    try:
        os.link(src, dst)
    except OSError:
        tmp = dst.with_name(f".{dst.name}.{os.getpid()}.tmp")
        shutil.copyfile(src, tmp)
        os.chmod(tmp, 0o600)
        os.replace(tmp, dst)


def run_pictures(ed_dir: Path, run_dir: Path, articles: list) -> None:
    """The run's own pictures: the photos its articles use and the edition's ads, kept in run_dir/photos and
    run_dir/ads (with their index entries), so a photo or ad changed or removed in the edition later never changes or
    breaks this run's pages, in the editor or in its print files."""
    wanted = {str(a["photo"].get("id")) for a in articles if isinstance(a, dict) and isinstance(a.get("photo"), dict)}
    for kind, keep in (("photos", lambda k: PHOTO_ID.match(k) and k in wanted), ("ads", lambda k: SLOT_ID.match(k))):
        src_dir, dst_dir = ed_dir / kind, run_dir / kind
        dst_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        out = {}
        # the ads index is read as everywhere else: a damaged one stops the layout, never reads as "no ads"
        index = deskprinted.ad_elements(src_dir) if kind == "ads" else read_json(src_dir / "index.json", {"elements": {}}).get("elements", {})
        for key, rec in index.items():
            src = src_dir / f"{key}.cmyk.gz"
            if keep(key) and src.is_file():
                keep_copy(src, dst_dir / f"{key}.cmyk.gz")
                out[key] = rec
        write_json(dst_dir / "index.json", {"elements": out})


def adopt_photo(ed_dir: Path, run_dir: Path, pid: str) -> bool:
    """An edition photo the run did not have (new text came with a new photo) added to the run's own pictures."""
    src, idx_path = ed_dir / "photos" / f"{pid}.cmyk.gz", run_dir / "photos" / "index.json"
    rec = read_json(ed_dir / "photos" / "index.json", {"elements": {}}).get("elements", {}).get(pid)
    if not PHOTO_ID.match(pid) or rec is None or not src.is_file():
        return False
    keep_copy(src, run_dir / "photos" / f"{pid}.cmyk.gz")
    idx = read_json(idx_path, {"elements": {}})
    idx.setdefault("elements", {})[pid] = rec
    write_json(idx_path, idx)
    return True


OWN_STORY_ORDER = 10_000          # order of short items set as stories of their own (more short items than pages)


class Built:
    """The edition's articles as gen1 stories: cleaned for the fonts, in order of importance, short items grouped.

    frozen: a layout's plan (plan() of the Built the run was laid out from). Within a run every article keeps the
    story it was laid out in, its own or a column of short items, and every story keeps its place in the order of
    importance, whatever the new text or priority: a short item that grows stays in its column and a story cut to a few
    words stays a story, so new text never moves an article to another page or changes which story leads. Articles of
    a frozen story that are gone (deleted, or no longer with a headline and text) leave it."""

    def __init__(self, edition: dict, articles: list, ed_dir: Path, frozen: dict | None = None):
        """ed_dir: the folder whose photos/ the stories' photos come from (an edition's, or a run's own)."""
        pages_n = int(edition["pages"])
        self.source = {a.get("id"): a for a in articles or [] if isinstance(a, dict)}   # as given (deskprinted)
        self.warn, arts, self.skipped = [], [], []
        for i, a in enumerate(articles or []):
            if not ARTICLE_ID.match(str(a.get("id", ""))):
                continue
            if not (a.get("headline") or "").strip() or not any(k == "para" for k, _ in DA.blocks(a.get("body") or "")):
                self.skipped.append({"article": a["id"], "reason": "It needs a headline and some body text"})
                continue
            w = []
            a = {**a, **{k: clean_text(a.get(k) or "", w, f"{(a.get('headline') or '')[:40]} ({k})")
                         for k in ("headline", "kicker", "deck", "byline", "body")}}
            if a.get("photo"):
                a["photo"] = {**a["photo"], "caption": clean_text(a["photo"].get("caption") or "", w, "caption"),
                              "credit": clean_text(a["photo"].get("credit") or "", w, "credit")}
            if w:
                self.warn.append({"article": a["id"], "warnings": w})
            arts.append((order_key(a, i), a))
        arts.sort(key=lambda t: t[0])
        arts = [a for _, a in arts]
        first = {}
        for a in arts:                                # the same headline twice in one edition (EDT004): say so
            k = DS.headline_key(a["headline"])
            if k in first:
                self.warn.append({"article": a["id"], "warnings": [f"Same headline as another article ({first[k]}) — is it the same story twice?"]})
            else:
                first[k] = a["id"]
        self.photo_dir = ed_dir / "photos"
        self.photos_idx = read_json(ed_dir / "photos" / "index.json", {"elements": {}}).get("elements", {})
        self.photo_ids = {pid for pid in self.photos_idx if PHOTO_ID.match(pid) and (ed_dir / "photos" / f"{pid}.cmyk.gz").exists()}
        for a in arts:
            if a.get("photo") and a["photo"].get("id") not in self.photo_ids:
                a["photo"] = None
            if a.get("photo"):
                rec = self.photos_idx[a["photo"]["id"]]
                min_ppi = min(G.MIN_PPI, 0.95 * (rec.get("ppi") or G.MIN_PPI))     # as gen1.Story allows
                if rec["width_px"] / (G.COL_W / 25.4) < min_ppi:
                    self.warn.append({"article": a["id"], "warnings": [
                        f"Photo too small to print even one column wide ({rec['width_px']} pixels across) — the story runs without it"]})
                    a["photo"] = None
            if a.get("page") is not None and not (isinstance(a["page"], int) and 1 <= a["page"] <= pages_n):
                a["page"] = None
        self.items, self.story_of, self.els_of, self.photo_of, self.article_of = [], {}, {}, {}, {}
        self.headline_of = {a["id"]: a["headline"] for a in arts}
        brief_pages = [1] + [p for p in range(2, pages_n)]
        if frozen is not None:
            self._frozen(arts, frozen)
            return
        briefs = [a for a in arts if DA.is_brief(a) and int(a.get("priority") or 3) >= 3 and a.get("page") is None]
        stories_a = [a for a in arts if a not in briefs]
        groups = [briefs[k:k + DP.BRIEFS_FRONT] for k in range(0, len(briefs), DP.BRIEFS_FRONT)]
        for n, a in enumerate(stories_a):
            self._story(a, n)
        for k, grp in enumerate(groups):
            if k >= len(brief_pages):                 # more short items than pages: set them as stories of their own
                for a in grp:
                    st, els = DA.to_story(a, 1.0, self.photo_ids)
                    self.add({"key": st["id"], "order": OWN_STORY_ORDER + len(self.items), "pin": None, "brief": False}, st, els, [a["id"]], None)
                continue
            self._briefs(grp, str(k + 1), k, brief_pages[k])

    def _story(self, a: dict, n: int, order: int | None = None, pin=None) -> None:
        st, els = DA.to_story(a, 1000.0 - n, self.photo_ids)
        self.add({"key": st["id"], "order": n if order is None else order, "pin": a.get("page") if order is None else pin,
                  "brief": False}, st, els, [a["id"]], self.photos_idx.get(a["photo"]["id"]) if a.get("photo") else None)

    def _briefs(self, grp: list, suffix: str, k: int, pin) -> None:
        st, els = DA.briefs_story(grp, suffix)
        self.add({"key": st["id"], "order": 20_000 + k, "pin": pin, "brief": True}, st, els, [a["id"] for a in grp], None)

    def plan(self) -> dict:
        """This grouping and order, to freeze a run's stories: {story key: {"articles", "order", "pin", "brief"}}."""
        return {it["key"]: {"articles": list(self.article_of[it["key"]]), "order": it["order"], "pin": it["pin"],
                            "brief": it["brief"]} for it in self.items}

    def _frozen(self, arts: list, frozen: dict) -> None:
        """The stories of a laid-out run, each with the articles, order and pin it was laid out with (class docstring)."""
        by_id = {a["id"]: a for a in arts}

        def own(f):                                     # a short item set as a story of its own: the layout adds those last
            return f["order"] >= OWN_STORY_ORDER and not f["brief"]

        for key, f in sorted(frozen.items(), key=lambda kv: (own(kv[1]), kv[1]["order"])):
            grp = [by_id[aid] for aid in f["articles"] if aid in by_id]
            if f["brief"]:
                if grp:
                    suffix = key[len("dbriefs"):]
                    st, els = DA.briefs_story(grp, suffix)
                    self.add({"key": st["id"], "order": f["order"], "pin": f["pin"], "brief": True}, st, els, [a["id"] for a in grp], None)
            elif own(f):                                 # a short item set as a story of its own, as the layout set it
                if grp:
                    st, els = DA.to_story(grp[0], 1.0, self.photo_ids)
                    self.add({"key": st["id"], "order": f["order"], "pin": f["pin"], "brief": False}, st, els, [grp[0]["id"]], None)
            elif grp:                                    # every article gone: the story leaves; the others keep their rank
                self._story(grp[0], f["order"], order=f["order"], pin=f["pin"])

    def kind_changes(self, other: Built, ids) -> list[dict]:
        """Articles (of ids) that this grouping (a run's, frozen) keeps as a story but other would set as a short
        item, or the other way round: they change only when the edition is laid out again."""
        mine = {aid: key for key, arts in self.article_of.items() for aid in arts}
        theirs = {aid: key for key, arts in other.article_of.items() for aid in arts}
        out = []
        for aid in ids:
            if aid in mine and aid in theirs and mine[aid].startswith("dbriefs") != theirs[aid].startswith("dbriefs"):
                out.append({"article": aid, "now": "short item" if theirs[aid].startswith("dbriefs") else "story",
                            "headline": self.headline_of.get(aid, "")})
        return out

    def add(self, item, story, els, articles, photo):
        self.items.append(item)
        k = item["key"]
        self.story_of[k], self.els_of[k], self.article_of[k], self.photo_of[k] = story, els, articles, photo


def write_printed(run_dir: Path, pages: list, articles: dict, briefs: set, edition: dict, tpls: dict, roles: list,
                  day: date) -> None:
    """runs/<rid>/printed.json: what each laid-out page prints (deskprinted), so the Desk can tell when the edition no
    longer matches a page (an article corrected or deleted, a new issue number, another ad)."""
    import deskedit as DE                                   # here: deskedit imports this module's neighbours
    out, ads = {}, deskprinted.ad_sigs(run_dir / "ads")
    for p in pages:
        if p.get("state") != "done":
            continue
        n, tpl = p["page"], tpls[roles[p["page"] - 1]]
        out[str(n)] = {"v": deskprinted.VERSION,
                       "articles": {a: deskprinted.article_sig(articles[a], a in briefs) for a in p.get("articles") or []
                                    if a in articles},
                       "folio": deskprinted.folio_sig(edition) if DE.prints_folio(tpl, n, len(roles), day) else None,
                       "ads": {s["slot"]: ads.get(s["slot"]) for s in tpl.ad_slots}}
    write_json(run_dir / "printed.json", {"schema": "pageinator.desk.printed/1", "pages": out})


def instances_dir(home: Path) -> Path:
    """Font instances made once and read back by every later engine process (deskfonts)."""
    return home / "cache" / "instances"


def make_pool(home: Path, ds: Path, cal, n_tasks: int, on_stop=None):
    """The worker pool (each worker reads font instances from the home's cache). SIGTERM / SIGINT / SIGHUP (the server
    cancelling, or the Terminal closing) stop the workers too; on_stop() then records the stop before the process ends."""
    workers = max(1, min((os.cpu_count() or 2) - 1, n_tasks))
    ex = ProcessPoolExecutor(max_workers=workers, mp_context=mp.get_context("spawn"), initializer=deskfonts.worker_init,
                             initargs=(str(instances_dir(home)), str(ds), cal))

    def stop(*_):
        for p in list(getattr(ex, "_processes", {}).values()):
            try:
                p.terminate()
            except Exception:  # noqa: BLE001
                pass
        if on_stop:
            try:
                on_stop()
            except Exception:  # noqa: BLE001 — never block the exit
                pass
        os._exit(130)
    for sig in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(sig, stop)
    return ex


def measure_items(ex, home: Path, ds: Path, cfg: dict, cal, b: Built, mphotos: Path, progress) -> tuple[dict, dict]:
    """Module options of every item, from the cache (content-keyed) or measured in the pool. → (options, failed)."""
    cx_inputs = DG.CP.Context(ds, "story")                 # cache keys only (inputs and code hashes)
    cx_inputs.r_cal = cfg.get("calibration", {}).get("r_cal")
    cache = home / "cache" / "options"
    cache.mkdir(parents=True, exist_ok=True, mode=0o700)
    options, todo = {}, {}
    for it in b.items:
        k = it["key"]
        f = cache / f"{options_cache_key(b.story_of[k], b.els_of[k], b.photo_of[k], cal, cx_inputs)}.pkl"
        if f.exists():
            try:
                options[k] = pickle.loads(f.read_bytes())
                continue
            except Exception:  # noqa: BLE001 — a damaged cache entry is measured again
                pass
        todo[ex.submit(DW.measure_task, [b.story_of[k]], b.els_of[k], str(mphotos))] = (k, f)
    failed = {}
    progress(len(options), len(b.items))
    while todo:
        done, _ = wait(list(todo), timeout=2.0, return_when=FIRST_COMPLETED)
        for fut in done:
            k, f = todo.pop(fut)
            r = fut.result()
            if not r.get("ok"):
                failed[k] = r.get("error", "measuring failed")
                log("measure failed", k, r.get("trace", ""))
                continue
            log(f"measured {k} in {r.get('seconds')} s")
            by = {}
            for key, opts in r["options"].items():
                _, w, cls = key.rsplit("|", 2)
                by.setdefault(int(cls), {})[int(w)] = opts
            options[k] = by
            tmp = f.with_suffix(f".{os.getpid()}.tmp")
            tmp.write_bytes(pickle.dumps(by))
            os.replace(tmp, f)
        if done:
            progress(len(options) + len(failed), len(b.items))
    return options, failed


def cmd_measure(home: Path, args) -> dict:
    """Measures the edition's stories ahead of a layout (the Desk runs this in the background as articles change)."""
    cfg = config(home)
    eid = check_id(EDITION_ID, args.edition, "edition id")
    ed_dir = home / "editions" / eid
    edition = read_json(ed_dir / "edition.json")
    articles = read_json(ed_dir / "articles.json", {"articles": []}).get("articles", [])
    ds = Path(cfg["dataset"])
    b = Built(edition, articles, ed_dir)
    status_path = ed_dir / "measure-status.json"

    last = {"done": 0, "total": len(b.items)}

    def progress(done, total):
        last.update(done=done, total=total)
        write_json(status_path, {"state": "measuring" if done < total else "done", "measured": done, "total": total, "updated": now_iso()})

    def ended(state):                                      # stopped or failed: never leave "measuring" behind
        write_json(status_path, {"state": state, "measured": last["done"], "total": last["total"], "updated": now_iso()})
    if not b.items:
        progress(0, 0)
        return {"measured": 0, "total": 0, "failed": 0}
    mphotos = DG.link_photo_dir(home / "cache" / "measure" / eid / "photos", [(ed_dir / "photos", {p: b.photos_idx[p] for p in b.photo_ids})])
    cal = DG.Calibration(ds)
    ex = make_pool(home, ds, cal, len(b.items), on_stop=lambda: ended("stopped"))
    try:
        options, failed = measure_items(ex, home, ds, cfg, cal, b, mphotos, progress)
    except BaseException:
        ended("failed")
        raise
    finally:
        ex.shutdown(wait=False, cancel_futures=True)
    return {"measured": len(options), "total": len(b.items), "failed": len(failed)}


def cmd_generate(home: Path, args) -> dict:
    cfg = config(home)
    eid = check_id(EDITION_ID, args.edition, "edition id")
    rid = check_id(RUN_ID, args.run, "run id")
    ed_dir = home / "editions" / eid
    run_dir = ed_dir / "runs" / rid
    req = read_json(run_dir / "request.json")
    status = Status(run_dir)
    ds = Path(cfg["dataset"])
    edition = req["edition"]
    pages_n = int(edition["pages"])
    roles = page_roles(pages_n, bool(edition.get("back_page_ads", True)))
    day = date.fromisoformat(edition["date"])
    status.data["pages"] = [{"page": i + 1, "role": "back" if r == "back" else "front" if r == "front" else "inside", "state": "waiting",
                             "articles": [], "pdf": None, "seconds": None, "message": "", "warnings": []} for i, r in enumerate(roles)]
    status.set(state="planning", message="Reading the articles")
    run_pictures(ed_dir, run_dir, req.get("articles") or [])
    b = Built(edition, req.get("articles") or [], run_dir)                 # the run's own photos
    write_json(run_dir / "plan.json", {"schema": "pageinator.desk.run-plan/1", "stories": b.plan()})   # frozen for the editor
    status.set(article_warnings=b.warn)
    if not b.items:
        status.set(state="failed", message="No articles with a headline and body text")
        return {"pages": 0, "failed": pages_n}
    mphotos = DG.link_photo_dir(run_dir / "work" / "photos", [(b.photo_dir, {p: b.photos_idx[p] for p in b.photo_ids})])
    cal = DG.Calibration(ds)
    ex = make_pool(home, ds, cal, max(len(b.items), pages_n),
                   on_stop=lambda: status.set(state="failed", message="Stopped before it finished"))
    try:
        return generate_with(ex, cfg, ds, home, ed_dir, run_dir, status, edition, roles, day, b, mphotos, cal)
    except Exception as e:  # noqa: BLE001
        status.set(state="failed", message=error_text(e))
        log(traceback.format_exc())
        raise
    finally:
        ex.shutdown(wait=False, cancel_futures=True)


def generate_with(ex, cfg, ds, home, ed_dir, run_dir, status, edition, roles, day, b: Built, mphotos, cal):
    t0 = time.time()
    items, story_of, els_of, article_of = b.items, b.story_of, b.els_of, b.article_of
    photos_idx, photo_ids = b.photos_idx, b.photo_ids

    # 1. measure every story (cached by content; usually measured in the background already)
    def progress(done, total):
        status.set(state="planning", message=f"Measured {done} of {total} stories")
    options, failed_measure = measure_items(ex, home, ds, cfg, cal, b, mphotos, progress)
    t_measured = time.time()

    # 2. plan the pages
    status.set(message="Choosing the stories for each page")
    tpls = {r: DG.Template(ds, cfg["templates"][r], r) for r in set(roles)}
    live = [it for it in items if it["key"] in options]
    per = cfg.get("needs_per_role") or {}
    use = {"front": "front", "inside_imprint": "inside", "inside": "inside", "back": "back"}
    pages = [{"page": i + 1, "regions": tpls[r].regions,
              "target": int((per.get(use[r]) or per.get("inside") or {}).get("stories", 6))
              + sum(1 for it in live if it["brief"] and it["pin"] == i + 1)} for i, r in enumerate(roles)]
    planner = DP.Planner(live, options, pages)
    plan, left, dropped = planner.plan()
    not_placed = list(b.skipped)
    for k, reason in dropped.items():
        for aid in article_of[k]:
            not_placed.append({"article": aid, "reason": reason})
    for k, why in failed_measure.items():
        for aid in article_of[k]:
            not_placed.append({"article": aid, "reason": f"could not be measured ({why})"})
    full_page = [(0, G.NCOL, tpls["inside"].news_top, tpls["inside"].news_bottom)]
    for k in left:
        alone = planner.status([k], full_page)[0] if planner.has_options(k, 0) else "lead-less"
        reason = ("Its headline is too long to set (at most four lines) — shorten the headline" if not planner.placeable(k) else
                  "Too long for a whole page — shorten it" if alone == "over" else
                  "No room left — add pages, lower another story's priority, or pin it to a page")
        for aid in article_of[k]:
            not_placed.append({"article": aid, "reason": reason})
    t_planned = time.time()
    status.set(not_placed=not_placed, plan_log=[list(x) for x in planner.log],
               timings={"measure_s": round(t_measured - t0, 1), "plan_s": round(t_planned - t_measured, 1)})

    # 3. lay out every page in parallel
    status.set(state="layout", message="Laying out the pages")
    futs = {}
    for pg, role in zip(plan, roles, strict=True):
        n = pg["page"]
        ps = status.page(n)
        keys = pg["keys"]
        ps["articles"] = [aid for k in keys for aid in article_of[k]]
        if not keys:
            ps.update(state="failed", message="No stories left for this page")
            continue
        if role == "front" and not str(edition.get("issue") or "").strip():
            ps["warnings"].append(deskprinted.ISSUE_NOT_SET)
        if pg["shrink_units"] is None:
            ps["warnings"].append("These stories do not fill the page exactly; the layout may fail")
        tpl = tpls[role]
        regions = tpl.regions
        if pg["shrink_units"]:
            c0, w, top, _ = regions[0]
            Hs = DP.region_heights(regions)[0]
            regions = [(c0, w, top, top + (Hs - pg["shrink_units"]) * G.UNIT + 0.01)]
            ps["warnings"].append(f"About {round(pg['shrink_units'] * G.UNIT)} mm of the page is left empty at the foot — add a short item or a photo")
        srcs = [(tpl.photo_dir, {e["id"]: tpl.photo_index[e["id"]] for e in tpl.keep if e["kind"] == "image" and e["id"] in tpl.photo_index}),
                (b.photo_dir, {p: photos_idx[p] for p in photo_ids})]
        renames = {}
        ads_dir = run_dir / "ads"                                       # the run's own ads (run_pictures)
        ads_idx = read_json(ads_dir / "index.json", {"elements": {}}).get("elements", {})
        for slot in tpl.ad_slots:
            if slot["slot"] in ads_idx and (ads_dir / f"{slot['slot']}.cmyk.gz").exists():
                renames[slot["element"]] = (ads_dir, slot["slot"], ads_idx[slot["slot"]])
        pdir = DG.link_photo_dir(run_dir / "work" / f"page-{n:02d}" / "photos", srcs, renames)
        pre = {f"{k}|{w}|{cls}": opts for k in keys for cls, byw in options[k].items() for w, opts in byw.items()}
        rank_size = {k: 1000.0 - i for i, k in enumerate(keys)}      # gen1 ranks by headline size: the planner's order
        page_els = [{**e, "size_pt": rank_size[k]} if e["kind"] == "headline" else e for k in keys for e in els_of[k]]
        task = {"page": n, "pages": len(roles), "date": day.isoformat(), "edition": {k: edition.get(k, "") for k in ("volume", "issue", "price")},
                "template": tpl.name, "role": role, "stories": [story_of[k] for k in keys],
                "elements": page_els, "photo_dir": str(pdir), "precomputed": pre, "regions": regions,
                "out_pdf": f"page-{n:02d}.pdf", "out_dir": str(run_dir)}
        futs[ex.submit(DW.layout_task, task)] = n
    status.save()
    while futs:
        done, _ = wait(list(futs), timeout=1.0, return_when=FIRST_COMPLETED)
        for n in futs.values():
            ps = status.page(n)
            if ps["state"] == "waiting" and (run_dir / f"page-{n:02d}.started").exists():
                ps["state"] = "working"
        for fut in done:
            n = futs.pop(fut)
            ps = status.page(n)
            try:
                r = fut.result()
            except Exception as e:  # noqa: BLE001 — a worker that died
                r = {"ok": False, "message": error_text(e)}
            ps["seconds"] = r.get("seconds")
            if r.get("ok"):
                write_json(run_dir / f"page-{n:02d}.manifest.json", {**r["manifest"], "sha256": r["sha256"], "warnings": r.get("warnings", [])})
                ps.update(state="done", pdf=f"page-{n:02d}.pdf", message="", warnings=ps["warnings"] + r.get("warnings", []))
            else:
                log(f"page {n} failed:", r.get("message"), r.get("trace", ""))
                ps.update(state="failed", message=r.get("message") or "layout failed")
                for aid in ps["articles"]:
                    status.data["not_placed"].append({"article": aid, "reason": f"Page {n} could not be laid out: {r.get('message')}"})
        status.save()
    failed = sum(p["state"] != "done" for p in status.data["pages"])
    status.data["timings"]["layout_s"] = round(time.time() - t_planned, 1)
    write_printed(run_dir, status.data["pages"], b.source, deskprinted.briefs_of(b.plan()), edition, tpls, roles, day)
    status.set(state="done" if failed < len(roles) else "failed", seconds=round(time.time() - t0, 1),
               message="All pages laid out" if not failed else f"{failed} of {len(roles)} pages could not be laid out")
    return {"pages": len(roles), "failed": failed}


# ------------------------------------------------------------------------------------------- editing
class EditEngine:
    """What a page-editing session needs, shared by every page open in the edit service (one process)."""

    def __init__(self, home: Path, cfg: dict):
        self.home, self.cfg = home, cfg
        self.ds = Path(cfg["dataset"])
        self.cal = DG.Calibration(self.ds)
        deskfonts.install(instances_dir(home))
        DW.init(str(self.ds), self.cal, nice=False)          # an editor answers at once: full priority
        self.cx = DW._STATE["cx"]
        self.cx_inputs = DG.CP.Context(self.ds, "story")
        self.cx_inputs.r_cal = cfg.get("calibration", {}).get("r_cal")
        self._tpl: dict = {}
        self.sessions: dict = {}                              # open pages, shared so a move can update another page

    def template(self, role: str) -> DG.Template:
        if role not in self._tpl:
            self._tpl[role] = DG.Template(self.ds, self.cfg["templates"][role], role)
        return self._tpl[role]

    def built(self, edition: dict, articles: list, ed_dir: Path, frozen: dict | None = None) -> Built:
        return Built(edition, articles, ed_dir, frozen)

    def cache_dir(self, name: str) -> Path:
        d = self.home / "cache" / name
        d.mkdir(parents=True, exist_ok=True, mode=0o700)
        return d

    def _options_file(self, b: Built, key: str) -> Path:
        return self.cache_dir("options") / f"{options_cache_key(b.story_of[key], b.els_of[key], b.photo_of[key], self.cal, self.cx_inputs)}.pkl"

    def cached_options(self, b: Built, key: str) -> dict | None:
        """A story's module options as a layout run (or the editor) measured them: {class: {w: [option]}}, or None."""
        try:
            return pickle.loads(self._options_file(b, key).read_bytes())
        except FileNotFoundError:
            return None
        except Exception:  # noqa: BLE001 — a damaged entry is measured again
            return None

    def store_options(self, b: Built, key: str, by: dict) -> None:
        f = self._options_file(b, key)
        tmp = f.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_bytes(pickle.dumps(by))
        os.replace(tmp, f)

    adopt_photo = staticmethod(adopt_photo)
    keep_copy = staticmethod(keep_copy)

    @staticmethod
    def story_photos(b: Built, key: str) -> Path:
        """The photos a generator measuring a story reads (the folder the stories' photos come from)."""
        return b.photo_dir

    def session_for(self, eid, run, page, reload: bool = False):
        """A page's editing session: opened when it is not open yet (or again, with reload) and made the most recently
        used; the least recently used page closes when more than MAX_SESSIONS are open (it opens again on its next
        request). The ids are checked first. → (the session's key, the session)."""
        import deskedit as DE
        eid = check_id(EDITION_ID, eid, "edition id")
        run = check_id(RUN_ID, run, "run id")
        page = int(page)
        key = f"{eid}/{run}/{page}"
        ed_dir = self.home / "editions" / eid
        if key not in self.sessions or reload:
            self.sessions[key] = DE.PageSession(self, self.home, ed_dir, ed_dir / "runs" / run, page)
        self.touch(key)
        while len(self.sessions) > MAX_SESSIONS:               # the oldest page closes (it reopens on use)
            self.sessions.pop(next(iter(self.sessions)))
        return key, self.sessions[key]

    def touch(self, key: str) -> None:
        """The open page key is the most recently used (last): idle measuring follows it, and it closes last."""
        self.sessions[key] = self.sessions.pop(key)


MAX_SESSIONS = 12                                         # open pages kept in the edit service (each holds its typesetting)
IDLE_AFTER_S = 2.0                                        # quiet time before the service measures in the background


def cmd_edit_service(home: Path, args) -> dict:
    """Serves page-editing sessions: one JSON request per line on stdin, one JSON answer per line on stdout:
    {"id", "cmd": "open"|"set"|"state"|"draw"|"export"|"alternative"|"refresh"|"move"|"close"|"ping", …} →
    {"id", "ok", "result"|"error"}. A move opens the page the story goes to if it is not open."""
    import deskedit as DE
    cfg = config(home)
    eng = EditEngine(home, cfg)
    sessions = eng.sessions

    def answer(obj):
        sys.stdout.write(DE.dumps(obj) + "\n")
        sys.stdout.flush()
    answer({"id": 0, "ok": True, "result": {"ready": True, "engine": ENGINE_VERSION}})
    last = time.monotonic()
    while True:
        # idle time: measure one more setting of a story whose text changed (about a second each), once no request
        # has come for IDLE_AFTER_S, so a change that follows soon (typing) never waits behind it
        current = list(sessions.values())[-1:]            # only the page last asked for: pages left alone wait
        if any(s.partial for s in current):
            wait = max(0.0, IDLE_AFTER_S - (time.monotonic() - last))
            if not select.select([sys.stdin], [], [], wait)[0] and current[0].complete_one():
                continue
        line = sys.stdin.readline()
        if not line:
            break
        last = time.monotonic()
        if not line.strip():
            continue
        rid = None
        try:
            req = json.loads(line)
            rid, cmd = req.get("id"), req.get("cmd")
            if cmd == "ping":
                res = {"pong": True}
            elif cmd == "open":
                DE.request_ok(req, ("edition", "run", "page"))
                key, s = eng.session_for(req["edition"], req["run"], req["page"], bool(req.get("reload")))
                s.sync()
                res = {"session": key, **s.draw()}
            elif cmd in ("set", "state", "draw", "export", "close", "alternative", "refresh", "move"):
                DE.request_ok(req, ("session",))
                s = sessions.get(req["session"])
                if s is None:
                    raise ValueError("this page is not open: open it again")
                if cmd != "close":
                    s.sync()                                            # text another page set reaches this one first
                if cmd == "move":                                       # to another page of the run, opened if need be
                    DE.request_ok(req, ("story", "page"))
                    eid, run, _ = req["session"].split("/")
                    eng.touch(req["session"])                           # opening the other page never closes this one
                    try:
                        res = s.move_to(req["story"], req["page"], req.get("base_rev"),
                                        lambda n: eng.session_for(eid, run, n)[1])
                    finally:
                        if req["session"] in sessions:
                            eng.touch(req["session"])                   # the page asked for is the last used again
                elif cmd == "set":
                    res = s.apply(req.get("modules") or [], req.get("base_rev"))
                elif cmd == "state":
                    res = s.state()
                elif cmd == "draw":
                    res = s.draw()
                elif cmd == "export":
                    res = s.export(req.get("base_rev"))
                elif cmd == "alternative":
                    res = s.alternative(int(req.get("variant") or 1), req.get("base_rev"))
                elif cmd == "refresh":
                    res = s.refresh_text(req.get("base_rev"))
                else:
                    sessions.pop(req["session"], None)
                    res = {"closed": True}
            else:
                raise ValueError(f"unknown command {cmd!r}")
            answer({"id": rid, "ok": True, "result": res})
        except (ValueError, KeyError) as e:                             # the request cannot be done: said plainly
            log(traceback.format_exc())
            answer({"id": rid, "ok": False, "error": str(e).strip("'") or "the request is not valid"})
        except Exception as e:  # noqa: BLE001 — one bad request never ends the service
            log(traceback.format_exc())
            answer({"id": rid, "ok": False, "error": f"something went wrong in the engine ({type(e).__name__}: {e})"})
    return {"stopped": True}


# ------------------------------------------------------------------------------------------- main
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="desk_engine")
    ap.add_argument("command", choices=("setup", "plan", "samples", "import-sample", "measure", "generate", "edit-service"))
    ap.add_argument("--home")
    ap.add_argument("--dataset")
    ap.add_argument("--pages", default="4")
    ap.add_argument("--back-ads", default="1")
    ap.add_argument("--edition")
    ap.add_argument("--run")
    ap.add_argument("--sample", action="append")
    args = ap.parse_args(argv)
    os.umask(0o077)                                       # everything the engine writes is private
    try:
        home = desk_home(args.home)
        if args.command != "setup":
            deskfonts.install(instances_dir(home))       # this process (planning, samples) reads font instances too
        fn = {"setup": cmd_setup, "plan": cmd_plan, "samples": cmd_samples, "import-sample": cmd_import, "measure": cmd_measure,
              "generate": cmd_generate, "edit-service": cmd_edit_service}[args.command]
        out = fn(home, args)
        print(json.dumps(out, ensure_ascii=False))
        return 0
    except SystemExit as e:
        if isinstance(e.code, str):
            print(json.dumps({"error": e.code}, ensure_ascii=False))
            return 1
        raise
    except Exception as e:  # noqa: BLE001
        log(traceback.format_exc())
        print(json.dumps({"error": error_text(e)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
