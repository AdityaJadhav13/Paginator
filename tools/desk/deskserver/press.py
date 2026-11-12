"""When the press files of a finished layout are current (the rule the UI and the editor show).

A page's press file is current when the page is laid out, has not been changed since its PDF was made, passed the
PDF/X-1a check, and still prints what the edition holds: each page records what it printed (deskprinted: its articles'
text and photos, its folio fields, its ads), and a page whose record no longer matches the edition "needs saving" until
it is saved with the current content. No article may print on two pages, and no page may print stories over each
other or outside the news area (its saved check, or the editor's latest answer, says so)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine"))
import deskprinted  # noqa: E402  (the engine's own definition of what a page prints)

from . import messages as M  # noqa: E402
from .util import read_json  # noqa: E402


PLACEMENT = ("overlap", "outside")              # problems a print file must never have (deskedit.PageSession.problems)
OVERLAP_WORDS = M.msg("m.warn.overlap")
OUTSIDE_WORDS = M.msg("m.warn.outside")


def placement_problems(page: dict) -> bool:
    """Do the page's stories overlap, or stand outside the news area or over an ad: in its last saved check
    ("layout_problems") or the editor's latest answer for it ("layout_problems_now")? A list that cannot be read counts
    (fail closed); a page an older Desk saved, without the list, counts by the words of its saved warnings."""
    for key in ("layout_problems", "layout_problems_now"):
        kinds = page.get(key)
        if kinds is None:
            continue
        if not isinstance(kinds, list) or any(k in PLACEMENT for k in kinds):
            return True
    return "layout_problems" not in page and bool(page.get("edited")) and any(
        w in (OVERLAP_WORDS, OUTSIDE_WORDS) for w in (page.get("warnings") or []) if isinstance(w, str))


def press_state(status: dict) -> dict:
    """Are the press files current: a finished run, every page laid out, none changed since its PDF was made, every PDF
    checked, none printing older content than the edition holds, no article printed on two pages, and no page with
    stories over each other or outside the news area?"""
    pages = [p for p in status.get("pages") or [] if isinstance(p, dict)]
    unsaved = sorted(p["page"] for p in pages if p.get("needs_save") or p.get("edited_unsaved") or p.get("stale"))
    unchecked = sorted(p["page"] for p in pages if p.get("state") == "done" and not (p.get("pdfx_check") or {}).get("passed"))
    on: dict[str, list[int]] = {}
    for p in pages:
        if p.get("state") == "done":
            for a in set(p.get("articles") or []):
                on.setdefault(a, []).append(p["page"])
    repeats = sorted({n for where in on.values() if len(where) > 1 for n in where})
    overlaps = sorted(p["page"] for p in pages if p.get("state") == "done" and placement_problems(p))
    ready = (status.get("state") == "done" and bool(pages) and all(p.get("state") == "done" for p in pages)
             and not unsaved and not unchecked and not repeats and not overlaps)
    return {"press_ready": ready, "pages_to_save": unsaved, "pages_failing_check": unchecked, "pages_with_repeats": repeats,
            "pages_with_overlaps": overlaps}


OLDER_DESK = M.msg("m.press.olderDesk")        # (a record made another way: deskprinted.OLDER)
DAMAGED = M.msg("m.press.damaged")


def edition_now(ed_dir: Path) -> dict:
    """The edition as it is now, read once for any number of its runs: articles by id, fields, ads (deskprinted)."""
    doc = read_json(ed_dir / "articles.json", {"articles": []})
    articles = doc.get("articles") if isinstance(doc, dict) else None
    edition = read_json(ed_dir / "edition.json", {})
    return {"articles": {a.get("id"): a for a in articles or [] if isinstance(a, dict)},
            "edition": edition if isinstance(edition, dict) else {}, "ads": deskprinted.ad_sigs(ed_dir / "ads")}


def _layout_changed(run_dir: Path, edition: dict, pages: list[dict]) -> dict[int, list[str]]:
    """Pages a run can no longer print as the edition is set up now (another page count; back-page ads switched on or
    off): {page: reasons}. Only a new layout fixes these."""
    laid = read_json(run_dir / "request.json").get("edition") or {}            # missing: the run is damaged
    out: dict[int, list[str]] = {}
    then, now = laid.get("pages"), edition.get("pages")
    if then is not None and now is not None and then != now:
        why = M.msg("m.press.pagesChanged", now=now, then=then)
        for p in pages:
            out.setdefault(p.get("page"), []).append(why)
    ads_now = bool(edition.get("back_page_ads", True))                  # the engine's default too (page_roles)
    if bool(laid.get("back_page_ads", True)) != ads_now:
        why = M.msg("m.press.backAdsOn" if ads_now else "m.press.backAdsOff")
        last = max((p.get("page") for p in pages if isinstance(p.get("page"), int)), default=None)
        for p in pages:
            if p.get("page") == last:                                    # the back page, with or without ad spaces
                out.setdefault(p.get("page"), []).append(why)
    return out


def refresh_stale(status: dict, run_dir: Path, now: dict | None = None) -> None:
    """Each finished page's "stale" reasons: what its PDF prints that the edition no longer holds (deskprinted.stale).
    It fails closed: a page with no record of what it prints (an older Desk made it), a run laid out for another page
    count or back-page setting, and a run whose files cannot be read are all stale. now: edition_now() of its edition,
    when several runs are checked at once."""
    pages = [p for p in status.get("pages") or [] if isinstance(p, dict) and p.get("state") == "done"]
    if now is None:
        try:
            now = edition_now(run_dir.parent.parent)
        except Exception as e:  # noqa: BLE001 — the edition cannot be read: none of its pages is current
            print(f"[desk] {run_dir.parent.parent.name}: its files cannot be read ({e})", file=sys.stderr)
            for p in pages:
                p["stale"] = [DAMAGED]
            return
    try:
        plan = read_json(run_dir / "plan.json", {})
        briefs = deskprinted.briefs_of(plan.get("stories") or {})
        # every page of the run (one that failed too), so its last page is the back page whether or not it was made
        layout = _layout_changed(run_dir, now["edition"], [p for p in status.get("pages") or [] if isinstance(p, dict)])
    except Exception:  # noqa: BLE001 — a damaged plan or request: nothing this run says can be trusted
        for p in pages:
            p["stale"] = [DAMAGED]
        return
    for p in pages:
        reasons = list(layout.get(p.get("page"), []))
        if isinstance(p.get("printed"), dict):
            try:
                reasons += deskprinted.stale(p["printed"], now["articles"], briefs, now["edition"], now["ads"])
            except Exception:  # noqa: BLE001 — a record that cannot be compared: never "current"
                reasons.append(DAMAGED)
        else:
            reasons.append(OLDER_DESK)
        p["stale"] = reasons


PRESS_FIELDS = ("press_ready", "pages_to_save", "pages_failing_check", "pages_with_repeats", "pages_with_overlaps")


def recheck_status(status: dict, run_dir: Path, now: dict | None = None) -> bool:
    """A finished run's status checked against the edition as it is now: its pages' "stale" reasons and its press
    state, written back to status.json when either changed. → whether it was written."""
    def seen():
        return [p.get("stale") for p in status.get("pages") or [] if isinstance(p, dict)], [status.get(k) for k in PRESS_FIELDS]
    before = seen()
    refresh_stale(status, run_dir, now)
    status.update(press_state(status))
    if seen() == before:
        return False
    M.write_status(run_dir / "status.json", status)
    return True


def mark_damaged(status: dict, run_dir: Path) -> None:
    """A finished run whose edition cannot be read now: none of its pages is current (DAMAGED). Written back."""
    for p in status.get("pages") or []:
        if isinstance(p, dict) and p.get("state") == "done":
            p["stale"] = [DAMAGED]
    status.update(press_state(status))
    M.write_status(run_dir / "status.json", status)
