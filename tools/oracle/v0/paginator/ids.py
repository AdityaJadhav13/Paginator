"""Deterministic identifiers for the engine.

INVARIANT 3: identical input produces a byte-identical document. Random or
time-derived ids make that impossible and break golden-file testing, so the
engine derives every id from the content it names.

Random identifiers are permitted only in `paginator/db/`, where ids identify
rows rather than content. `test_determinism.py` greps this package for that
module name and fails if it appears anywhere else — which is why this docstring
does not spell it out.

Spec §2.5.
"""

from __future__ import annotations

import hashlib

__all__ = ["stable_id"]

# blake2b truncated to 8 bytes -> 16 hex chars. Collision risk is negligible at
# the scale of one edition, and short ids keep the RLD readable.
_DIGEST_SIZE = 8

# Unit Separator. Joining with a character that cannot occur in the inputs keeps
# stable_id("art", "ab", "c") distinct from stable_id("art", "a", "bc").
_SEP = "\x1f"


def stable_id(prefix: str, *parts: str) -> str:
    """Return a deterministic id of the form ``{prefix}_{16 hex chars}``.

    The same prefix and parts always yield the same id, in this process and in
    every future one. Ordering of ``parts`` is significant.

    >>> stable_id("art", "Headline", "Body text") == stable_id(
    ...     "art", "Headline", "Body text"
    ... )
    True
    """
    digest = hashlib.blake2b(
        _SEP.join(parts).encode("utf-8"), digest_size=_DIGEST_SIZE
    )
    return f"{prefix}_{digest.hexdigest()}"
