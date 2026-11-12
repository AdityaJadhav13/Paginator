"""Work done in the engine's worker processes (one Phase-0 context per process): measuring stories, laying out pages."""
from __future__ import annotations

import os
import time
import traceback
from datetime import date
from pathlib import Path

import deskgen as DG

_STATE: dict = {}
_MEMO: dict = {}
MEMO_MAX = 20_000


def _memo_prepare(real):
    """composer3.prepare, remembered within one task. Measuring sets each paragraph at 35 sizes but 9 column widths,
    so most calls repeat. Shaping is a pure function of its arguments, and composer3 already shares prepared paragraphs
    across compositions (inword_points recomputes the only field a composition writes), so the results are unchanged."""
    def prepare(text, lang, script, family, size_pt, axes=None, weight=400):
        key = (text, lang, script, family, size_pt, None if axes is None else tuple(sorted(axes.items())), weight)
        p = _MEMO.get(key)
        if p is None:
            if len(_MEMO) >= MEMO_MAX:                     # a long editing session: start afresh, never grow without end
                _MEMO.clear()
            p = real(text, lang, script, family, size_pt, None if axes is None else dict(axes), weight)
            _MEMO[key] = p
        return p
    return prepare


def install_memo() -> None:
    K3 = DG.CP.K3
    if not getattr(K3.prepare, "desk_memo", False):
        K3.prepare = _memo_prepare(K3.prepare)
        K3.prepare.desk_memo = True


def init(ds: str, cal, nice: bool = True) -> None:
    if nice:
        os.nice(5)                                        # the Mac stays usable while pages are laid out
    install_memo()
    _STATE["ds"] = Path(ds)
    _STATE["cx"] = DG.CP.Context(Path(ds), "paper")
    _STATE["cal"] = cal
    _STATE["templates"] = {}


def template(name: str, role: str) -> DG.Template:
    key = (name, role)
    if key not in _STATE["templates"]:
        _STATE["templates"][key] = DG.Template(_STATE["ds"], name, role)
    return _STATE["templates"][key]


def measure_task(stories: list, elements: list, photo_dir: str, grid=None) -> dict:
    """grid: the grid the options are for (deskgen.on_grid; None: the paper's own)."""
    t0 = time.time()
    _MEMO.clear()
    try:
        with DG.on_grid(grid):
            out = DG.measure(_STATE["cx"], _STATE["cal"], stories, elements, Path(photo_dir))
        return {"ok": True, "options": out, "seconds": round(time.time() - t0, 1)}
    except Exception as ex:  # noqa: BLE001 — reported per story, never fatal for the run
        return {"ok": False, "error": f"{type(ex).__name__}: {ex}", "trace": traceback.format_exc()[-2000:]}


def layout_task(task: dict) -> dict:
    """task: page, pages, date, edition, template (name, role), grid (the template's: deskgen.on_grid), stories,
    elements, photo_dir, precomputed, regions, out_pdf, out_dir. Writes the PDF and returns the manifest (no PDF bytes
    through the pipe)."""
    t0 = time.time()
    _MEMO.clear()
    out_dir = Path(task["out_dir"])
    marker = out_dir / f"page-{task['page']:02d}.started"
    marker.write_text(str(os.getpid()))
    try:
        tpl = template(task["template"], task["role"])
        work = out_dir / "work" / f"page-{task['page']:02d}"
        work.mkdir(parents=True, exist_ok=True, mode=0o700)
        with DG.on_grid(task.get("grid") or tpl.grid):
            res = DG.layout_page(_STATE["cx"], _STATE["cal"], tpl, task["stories"], task["elements"], Path(task["photo_dir"]),
                                 task["precomputed"], task["page"], task["pages"], date.fromisoformat(task["date"]),
                                 task["edition"], work, regions=task.get("regions"))
        res["seconds"] = round(time.time() - t0, 1)
        if res.get("ok"):
            pdf = out_dir / task["out_pdf"]
            tmp = pdf.with_suffix(".pdf.tmp")
            tmp.write_bytes(res.pop("pdf"))
            tmp.chmod(0o600)
            os.replace(tmp, pdf)
        return res
    except Exception as ex:  # noqa: BLE001
        return {"ok": False, "status": "error", "message": f"{type(ex).__name__}: {ex}", "trace": traceback.format_exc()[-3000:],
                "seconds": round(time.time() - t0, 1)}
