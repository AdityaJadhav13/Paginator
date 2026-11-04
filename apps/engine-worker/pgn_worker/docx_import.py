"""`docx.import` (plan §2.2, §5.3; L2.2): a Word file's stories, read by the Desk's own `docx.articles_from_docx`,
unchanged. The file is read by its exact version and SHA-256 (`imports/<import>/original`, where the API copied it out
of quarantine) and never changed. The articles and the Desk's notes go to a result file beside it,
`imports/<import>/result-<the file's sha256>.json` (format pageinator.docx-result/1), and the event names that file by
its version and SHA-256: no story text is in the event. A file the Desk refuses is a finished job (`import.rejected`,
with the Desk's plain message).

Each note and refusal also gets a code, so the web can say it in its own words (English and Marathi); the codes are
read from the Desk's own sentences (tests pin every one). The key is fixed by the import and the file, so a job run
again (after a crash) writes the same key again and never a second result."""
from __future__ import annotations

import hashlib
import json
import re

from .desk import docx
from .keys import KeyGuard, uuid
from .media import Mismatch
from .storage import Storage

ARGS = ("org_id", "pub_id", "import_id", "version_id", "sha256")
RESULT_FORMAT = "pageinator.docx-result/1"

# the Desk's notes (docx.articles_from_docx), each to a code and its number
NOTES = (
    (re.compile(r"This file holds more than (\d+) stories"), "docx.too_many_stories"),
    (re.compile(r"(\d+) headings? had no text under"), "docx.empty_headings"),
    (re.compile(r"(\d+) tables? (?:was|were) not imported"), "docx.tables"),
    (re.compile(r"(\d+) text box(?:es)? (?:was|were) not imported"), "docx.text_boxes"),
    (re.compile(r"(\d+) pictures? (?:was|were) not imported"), "docx.pictures"),
    (re.compile(r"Formatting \(bold, italic, sizes\) is not kept"), "docx.formatting"),
)
# the Desk's refusals (DocxError), each to a code
REFUSALS = (
    (docx.NOT_WORD, "docx.not_word"),
    (docx.DAMAGED, "docx.damaged"),
    (docx.TOO_LARGE, "docx.too_large"),
    ("This Word file is larger than", "docx.over_size"),
    ("This Word file is protected with a password", "docx.protected"),
    ("No story was found in this Word file", "docx.no_story"),
)


def check_args(args: dict) -> dict:
    if not isinstance(args, dict) or set(args) != set(ARGS):
        raise ValueError(f"docx.import takes exactly {', '.join(ARGS)}")
    if not isinstance(args["version_id"], str) or not 0 < len(args["version_id"]) <= 1024:
        raise ValueError("docx.import: version_id is not valid")
    if not isinstance(args["sha256"], str) or not re.fullmatch(r"[0-9a-f]{64}", args["sha256"]):
        raise ValueError("docx.import: sha256 is not 64 lowercase hex characters")
    return args


def note(text: str) -> dict:
    """A Desk note → {code, count, text}; a sentence it does not know is docx.note (the web shows its text)."""
    for pattern, code in NOTES:
        if m := pattern.search(text):
            return {"code": code, "count": int(m.group(1)) if m.groups() else None, "text": text[:2000]}
    return {"code": "docx.note", "count": None, "text": text[:2000]}


def refusal_code(message: str) -> str:
    return next((code for start, code in REFUSALS if message.startswith(start)), "docx.refused")


def read(storage: Storage, args: dict) -> dict:
    """→ the event for the API: `import.parsed` naming the result file, or `import.rejected` with the Desk's words."""
    args = check_args(args)
    guard = KeyGuard(args["org_id"], args["pub_id"])
    import_id = uuid(args["import_id"], "import_id")
    data = storage.get(guard.key("imports", import_id, "original"), args["version_id"])
    if hashlib.sha256(data).hexdigest() != args["sha256"]:
        raise Mismatch("the stored Word file is not the one this job names")
    base = {"org_id": guard.org_id, "pub_id": guard.pub_id, "import_id": import_id, "sha256": args["sha256"]}
    try:
        got = docx.articles_from_docx(data)                    # the Desk's code, unchanged
    except docx.DocxError as e:
        message = str(e)[:2000]
        return {"kind": "import.rejected", **base, "code": refusal_code(message), "message": message, "status": 400}
    body = json.dumps({"format": RESULT_FORMAT, "articles": got["articles"], "notes": [note(n) for n in got["notes"]]},
                      ensure_ascii=False, sort_keys=True).encode("utf-8")
    key = guard.key("imports", import_id, f"result-{args['sha256']}.json")
    version = storage.put(key, body, "application/json")
    return {"kind": "import.parsed", **base, "result_key": key, "result_version_id": version,
            "result_sha256": hashlib.sha256(body).hexdigest(), "articles": len(got["articles"])}
