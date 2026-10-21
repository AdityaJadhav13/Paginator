"""Pageinator Desk: the local server (internal tool; spec: tools/desk/CONTRACT.md).

Usage (from the repository root):
    experiments/phase0/pdfx1/.venv/bin/python tools/desk/server.py [--port 8765] [--home DIR] [--open]

Environment: PAGEINATOR_DESK_HOME (desk home, default ~/PageinatorPrivate/desk), PAGEINATOR_ICC (newsprint CMYK
profile), PAGEINATOR_ORACLE_PY (the engine's Python, default tools/oracle/v0/.venv/bin/python) and
PAGEINATOR_DESK_ENGINE (the engine script, default tools/desk/engine/desk_engine.py).
"""
import sys

sys.dont_write_bytecode = True          # no __pycache__ in the repository

from pathlib import Path  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deskserver.app import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
