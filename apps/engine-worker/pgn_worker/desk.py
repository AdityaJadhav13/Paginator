"""The Desk's code, as the worker uses it: `tools/desk/deskserver` imported unchanged from this repository (the worker's
image keeps the repository's layout, plan §2.2)."""
from __future__ import annotations

import re
import string
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[3]
DESK = REPO / "tools" / "desk"
if str(DESK) not in sys.path:
    sys.path.insert(0, str(DESK))

from deskserver import docx, engine_client, images, util, ziplimits  # noqa: E402
from deskserver import jobs as runs  # noqa: E402  (the Desk's run steps: previews, the check, merge, ZIP)
from deskserver import messages  # noqa: E402
from deskserver import editing  # noqa: E402  (the page editor's engine service and save steps: gateway.py)
from deskserver import presstest  # noqa: E402  (the press test page: gateway.py)
from deskmsg import MESSAGES  # noqa: E402  (the engine's folder is on the path: deskserver.messages)

__all__ = ["DESK", "REPO", "desk_text", "docx", "editing", "engine_client", "images", "messages", "presstest", "runs",
           "util", "ziplimits"]
M = messages


# the Desk's words, as the contract carries them (DeskText, packages/contracts layout.ts)
_FMT = string.Formatter()


def _english(wire: Any) -> Any:
    """A message's wire form as its English text (a number as it is)."""
    if isinstance(wire, (int, float)) and not isinstance(wire, bool):
        return wire
    if not isinstance(wire, dict):
        return str(wire)
    if "data" in wire:
        return str(wire["data"])
    if "parts" in wire:
        return " ".join(str(_english(p)) for p in wire.get("parts") or [])
    template, params, out = MESSAGES.get(str(wire.get("code")), ""), wire.get("params") or {}, []
    for literal, field, _spec, _conv in _FMT.parse(template):
        out.append(literal)
        if field is not None:
            out.append(str(_english(params.get(field, ""))))   # a value formatted by its template is sent as shown
    return "".join(out)


def desk_text(text: Any, msgs: Any = None) -> dict:
    """The contract's DeskText: the English text, and its code and parameters when it is one of the Desk's messages (a
    Msg, or a text that a document's "msgs" map names). A parameter is text or a number (a nested message: its
    English text)."""
    wire = text.wire if isinstance(text, M.Msg) else msgs.get(text) if isinstance(msgs, dict) else None
    said = str(text).strip()[:2000] or "The layout engine gave no reason."
    if isinstance(wire, dict) and isinstance(wire.get("code"), str) and re.fullmatch(r"m\.[A-Za-z0-9.]{1,120}",
                                                                                      wire["code"]):
        params = {str(k)[:40]: (v if isinstance(v := _english(p), (int, float)) else str(v)[:2000])
                  for k, p in (wire.get("params") or {}).items()}
        return {"text": said, "code": wire["code"], "params": params}
    return {"text": said, "code": None, "params": None}

