"""The engine worker's task core (docs/product/10-l2-newsroom-plan.md §2.2): plain functions over a storage, a
publication's home and a job's arguments. No queue, no database yet (W6 adds the queue that calls them).

The Desk's own code does the work, imported unchanged from tools/desk (`desk.py`); the Desk's engine files that key the
measurement cache (`deskgen.py`, `deskarticles.py`, `deskworker.py`) are never edited or imported here."""

__version__ = "0.1.0"
