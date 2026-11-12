"""The story bundle against the Desk's own code (test/db/desk-bundle.test.ts): tools/desk/deskserver/bundle.py, read-only,
as the owner's Desk runs it. Three commands, each printing one JSON value:

    <the Desk's Python> -B apps/api/test/support/desk_roundtrip.py import <repo> <home> <date> <pages> <bundle.zip>...
        the bundles imported, in turn, into a throwaway Desk home: each import's answer (what was added, replaced,
        unchanged, kept or refused, and its ads and settings) and the articles, settings and ads the edition then has.
        The Desk's page plan has the ad spaces DESK_BACK_SLOTS (JSON [{"slot", "w_mm", "h_mm"}], none by default) on
        the back page;
    ... open <repo> <bundle.zip>
        bundle.open_bundle on the file: {"ok": true, "stories": n} or {"refused": "<the Desk's message code>"};
    ... desk_text <repo> <bodies.json>
        bundle.desk_text on each body of the JSON list: a list of true or false.

The Desk's Python is experiments/phase0/pdfx1/.venv (Pillow), or PAGEINATOR_DESK_PY. The newsprint conversion is
replaced by Pillow's plain RGB -> CMYK, as the Desk's own tests do (the real profile is private).
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True

command, repo, *rest = sys.argv[1:]
sys.path.insert(0, str(Path(repo) / "tools" / "desk"))

from deskserver import bundle, images  # noqa: E402
from deskserver.util import DeskError  # noqa: E402


def code_of(error: DeskError) -> str:
    wire = getattr(error.message, "wire", None)
    return wire.get("code", str(error.message)) if isinstance(wire, dict) else str(error.message)


if command == "open":
    try:
        z, doc, _members = bundle.open_bundle(Path(rest[0]).read_bytes())
        z.close()
        print(json.dumps({"ok": True, "stories": len(doc["stories"])}))
    except DeskError as error:
        print(json.dumps({"refused": code_of(error)}))
elif command == "desk_text":
    bodies = json.loads(Path(rest[0]).read_text(encoding="utf-8"))
    print(json.dumps([bundle.desk_text(body) for body in bodies]))
elif command == "import":
    home, day, pages, *zips = rest
    os.environ["PAGEINATOR_ICC"] = str(Path(home) / "no-profile.icc")
    from deskserver.store import Store  # noqa: E402

    images.rgb_to_cmyk = lambda img: img.convert("CMYK")
    store = Store(Path(home))
    eid = store.create_edition({"date": day, "pages": int(pages)})["id"]
    slots = json.loads(os.environ.get("DESK_BACK_SLOTS", "[]"))

    def plan(pages: int, back: bool) -> dict:
        return {"pages": [{"page": pages, "ad_slots": slots if back else []}]}

    imports = []
    for path in zips:
        answer = bundle.import_bundle(store, eid, Path(path).read_bytes(), plan)
        imports.append({**{key: [{k: v for k, v in item.items() if k in ("story", "article", "headline", "reason")}
                                 for item in answer[key]]
                           for key in ("added", "replaced", "unchanged", "kept", "refused")},
                        "ads": answer["ads"], "settings": answer["settings"]})
    articles = json.loads((Path(home) / "editions" / eid / "articles.json").read_text(encoding="utf-8"))["articles"]
    photos = Path(home) / "editions" / eid / "photos"
    edition = store.get_edition(eid)
    print(json.dumps({
        "edition": {k: edition.get(k) for k in ("volume", "issue", "price")},
        "ads": {f.name: hashlib.sha256(f.read_bytes()).hexdigest()
                for f in sorted((Path(home) / "editions" / eid / "ads").glob("*.orig.*"))},
        "imports": imports,
        "articles": [{"id": a["id"], "headline": a["headline"], "body": a["body"], "story": a["bundle"]["story"],
                      "revision": a["bundle"]["revision"], "photo": a.get("photo"),
                      "photo_file": bool(a.get("photo")) and any(photos.glob(f"{a['photo']['id']}.*"))}
                     for a in articles],
    }, ensure_ascii=False, default=str))
else:
    raise SystemExit(f"unknown command {command}")
