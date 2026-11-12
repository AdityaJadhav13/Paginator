"""Past editions of the paper (the private dataset's page models) as Desk articles, for trying the Desk out with real
news without typing it. The text and photos stay in the private desk home."""
from __future__ import annotations

import json
import secrets
import shutil
from pathlib import Path

from deskarticles import BRIEF_WORDS, body_words
from deskcommon import SCRIPT_RANGE, now_iso, one_line, paper, write_json


def _text(el) -> str:
    if el["kind"] == "body_frame":
        return " ".join(l.get("text", "") for l in el.get("lines") or [] if not l.get("excluded") and l.get("use", "body") == "body")
    return el.get("text", "")


def sample_pages(ds: Path) -> dict:
    """{sample: [page model, …]} in page order."""
    out = {}
    for f in sorted((ds / "report" / "page1" / "pages").glob("*.json")):
        m = json.loads(f.read_text(encoding="utf-8"))
        out.setdefault(m["sample"], []).append((m["page"], f.stem, m))
    return {k: [(p, n, m) for p, n, m in sorted(v)] for k, v in out.items()}


def stories_of(m: dict) -> list[dict]:
    """The page's stories that have a headline and body text, most important first (printed headline size)."""
    els = {e["id"]: e for e in m["elements"]}
    out = []
    for s in m["stories"]:
        if s.get("parent_story") or not s.get("headline") or s["headline"] not in els:
            continue
        paras = []
        for b in s["flow"]:
            if b["type"] == "para" and b["text"].strip():
                paras.append(" ".join(b["text"].split()))
            elif b["type"] == "crosshead" and b.get("element") in els and _text(els[b["element"]]).strip():
                paras.append("## " + " ".join(_text(els[b["element"]]).split()))
        if not any(not p.startswith("## ") for p in paras):
            continue
        head = " ".join(" ".join(_text(els[x]).split()) for x in [s["headline"], *(s.get("headline_parts") or [])] if x in els)
        deck = " ".join(" ".join(_text(els[d]).split()) for d in s.get("decks") or [] if d in els)
        by = els.get(s.get("byline")) if s.get("byline") else None
        ki = els.get(s.get("kicker")) if s.get("kicker") else None
        caps = " ".join(" ".join(_text(els[c]).split()) for c in s.get("captions") or [] if c in els)
        out.append({"size": els[s["headline"]].get("size_pt") or 0.0, "headline": head, "deck": deck,
                    "byline": "" if not by or by.get("run_in") else " ".join(_text(by).split()),
                    "kicker": "" if not ki or ki.get("run_in") else " ".join(_text(ki).split()),
                    "body": "\n\n".join(paras), "images": list(s.get("images") or []), "caption": caps})
    out.sort(key=lambda r: -r["size"])
    return out


def deva_share(text: str, script: str = "deva") -> float:
    """The share of the text's letters in the paper's script (Devanagari unless its paper.json says otherwise)."""
    lo, hi = SCRIPT_RANGE[script]
    letters = [ch for ch in text if ch.isalpha()]
    return sum(lo <= ch <= hi for ch in letters) / len(letters) if letters else 0.0


def script_of(ds: Path) -> str:
    return (paper(ds) or {}).get("script", "deva")


def list_samples(ds: Path) -> list[dict]:
    rows, script = [], script_of(ds)
    for sample, pages in sample_pages(ds).items():
        n = photos = words = 0
        for _p, _name, m in pages:
            for s in stories_of(m):
                if deva_share(s["body"], script) < 0.5:
                    continue
                n += 1
                photos += bool(s["images"])
                words += body_words(s["body"])
        rows.append({"name": sample, "date": _date_of(sample), "pages": len(pages), "stories": n, "photos": photos, "words": words})
    return sorted(rows, key=lambda r: (r["date"], r["name"]))


def _date_of(sample: str) -> str:
    digits = "".join(ch for ch in sample.split("-", 1)[-1][:8] if ch.isdigit())
    return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}" if len(digits) == 8 else ""


def import_samples(ds: Path, edition_dir: Path, names: list[str]) -> dict:
    """Appends the samples' stories in the paper's script (Marathi for the pilot) to the edition's articles, photos included (the extracted newsprint
    rasters, as gen1 uses them). Priority from the printed page: page 1's lead → Lead, its next two → Top, the rest Normal."""
    allp, script = sample_pages(ds), script_of(ds)
    arts_path = edition_dir / "articles.json"
    data = json.loads(arts_path.read_text(encoding="utf-8")) if arts_path.exists() else {"schema": "pageinator.desk.articles/1", "articles": []}
    photos_dir = edition_dir / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    idx_path = photos_dir / "index.json"
    index = json.loads(idx_path.read_text()) if idx_path.exists() else {"elements": {}}
    added = photos = skipped = 0
    seen = {headline_key(a.get("headline", "")) for a in data["articles"]}
    for name in names:
        if name not in allp:
            raise ValueError(f"no past edition called {name!r}")
        for p, page_name, m in allp[name]:
            src_dir = ds / "report" / "page1" / "photos" / page_name
            src_idx = json.loads((src_dir / "index.json").read_text())["elements"] if (src_dir / "index.json").exists() else {}
            for rank, s in enumerate(stories_of(m)):
                if deva_share(s["body"], script) < 0.5:
                    continue
                if headline_key(s["headline"]) in seen:      # the same story printed again on another day
                    skipped += 1
                    continue
                seen.add(headline_key(s["headline"]))
                prio = (1 if rank == 0 else 2 if rank <= 2 else 3) if p == 1 else 3
                art = {"id": "a-" + secrets.token_hex(5), "headline": one_line(s["headline"]), "kicker": s["kicker"], "deck": s["deck"],
                       "byline": s["byline"], "body": s["body"], "priority": prio, "page": None, "photo": None,
                       "source": f"sample:{name}", "created": now_iso(), "updated": now_iso()}
                for img in s["images"]:
                    rec = src_idx.get(img)
                    if rec and (src_dir / f"{img}.cmyk.gz").exists() and min(rec["width_px"], rec["height_px"]) >= 80:
                        pid = "p-" + secrets.token_hex(5)
                        shutil.copyfile(src_dir / f"{img}.cmyk.gz", photos_dir / f"{pid}.cmyk.gz")
                        (photos_dir / f"{pid}.cmyk.gz").chmod(0o600)
                        index["elements"][pid] = {"width_px": rec["width_px"], "height_px": rec["height_px"], "ppi": rec.get("ppi")}
                        art["photo"] = {"id": pid, "caption": one_line(s["caption"]), "credit": "", "width_px": rec["width_px"],
                                        "height_px": rec["height_px"]}
                        photos += 1
                        break
                if not art["photo"] and body_words(art["body"]) <= BRIEF_WORDS:
                    art["priority"] = max(art["priority"], 3)
                data["articles"].append(art)
                added += 1
    write_json(idx_path, index)
    write_json(arts_path, data)
    return {"imported": added, "photos": photos, "skipped_repeats": skipped}


def headline_key(text: str) -> str:
    """A headline compared as words only (spacing and punctuation ignored)."""
    return " ".join("".join(ch for ch in w if ch.isalnum() or "\u0900" <= ch <= "\u097f") for w in one_line(text).split()).strip()
