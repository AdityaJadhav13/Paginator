"""The Desk's code, as the worker uses it: `tools/desk/deskserver` imported unchanged from this repository (the worker's
image keeps the repository's layout, plan §2.2)."""
from __future__ import annotations

import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DESK = REPO / "tools" / "desk"
if str(DESK) not in sys.path:
    sys.path.insert(0, str(DESK))

from deskserver import images, util  # noqa: E402

__all__ = ["DESK", "REPO", "images", "util"]
