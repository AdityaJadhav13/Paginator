"""The Desk's own messages (the engine's deskmsg, shared): English text that also carries {code, params}, so the screens
can say it in the language chosen. See tools/desk/engine/deskmsg.py and messages.json."""
from __future__ import annotations

import sys
from pathlib import Path

_ENGINE = str(Path(__file__).resolve().parents[1] / "engine")
if _ENGINE not in sys.path:
    sys.path.insert(0, _ENGINE)

from deskmsg import Msg, annotate, data, from_wire, join, msg  # noqa: E402

from .util import write_json  # noqa: E402

__all__ = ["Msg", "annotate", "data", "from_wire", "join", "msg", "write_status"]


def write_status(path: Path, status: dict) -> None:
    """A run's status.json, its messages mapped to {code, params} ("msgs") for the screens."""
    write_json(path, annotate(status))
