"""A daily sudoku: a seeded puzzle with exactly one solution, and its 9x9 grid drawn as vector lines on a page.

Deterministic: the same seed (e.g. the edition date "2026-11-11") gives the same puzzle, from a random.Random seeded by
the seed's SHA-256, never the global random. No AI. Standard library only.

Grids are 81-char strings, row by row; "0" marks an empty cell.
"""
from __future__ import annotations

import hashlib
import random

GIVENS = {"easy": (36, 40), "medium": (30, 34)}
ALL = 0x3FE                                             # bits 1..9: the digits a cell may hold
UNITS = [[r * 9 + c for c in range(9)] for r in range(9)] + [[r * 9 + c for r in range(9)] for c in range(9)] \
    + [[(br + r) * 9 + bc + c for r in range(3) for c in range(3)] for br in (0, 3, 6) for bc in (0, 3, 6)]
PEERS = [sorted({p for u in UNITS if i in u for p in u} - {i}) for i in range(81)]


class Budget(Exception):
    """The solver's node budget ran out (a hard or hostile puzzle from outside)."""


def _search(cells: list[int], limit: int, rng: random.Random | None = None, budget: int | None = None) -> list[str]:
    """Up to `limit` solutions of cells (0 = empty), by backtracking on the emptiest cell (fewest candidates) first.
    With rng, the candidates are tried in a shuffled order (to build a random full grid)."""
    found: list[str] = []
    left = [budget]

    def go() -> None:
        if left[0] is not None:
            left[0] -= 1
            if left[0] < 0:
                raise Budget()
        best, best_mask, best_n = -1, 0, 10
        for i in range(81):
            if cells[i]:
                continue
            mask = ALL
            for p in PEERS[i]:
                mask &= ~(1 << cells[p])
            n = bin(mask).count("1")
            if n < best_n:
                best, best_mask, best_n = i, mask, n
                if n <= 1:
                    break
        if best < 0:
            found.append("".join(map(str, cells)))
            return
        digits = [d for d in range(1, 10) if best_mask >> d & 1]
        if rng is not None:
            rng.shuffle(digits)
        for d in digits:
            cells[best] = d
            go()
            if len(found) >= limit:
                break
        cells[best] = 0

    go()
    return found


def solve(puzzle: str, budget: int | None = None) -> list[str]:
    """Up to 2 solutions of puzzle: one means the puzzle is unique, two that it is not, none that it has no solution."""
    if len(puzzle) != 81 or not puzzle.isdigit():
        raise ValueError("a sudoku is 81 digits, 0 for an empty cell")
    cells = [int(ch) for ch in puzzle]
    for i, v in enumerate(cells):                       # a clash among the givens: no solution
        if v and any(cells[p] == v for p in PEERS[i]):
            return []
    return _search(cells, 2, budget=budget)          # (Budget raised when budget nodes run out)


def make(seed: str, difficulty: str = "easy") -> dict:
    """A unique-solution puzzle for seed: a random full grid, then cells removed in a seeded order, each removal kept
    only when the puzzle still has exactly one solution, until the difficulty's target number of givens is reached."""
    if difficulty not in GIVENS:
        raise ValueError(f"difficulty must be one of {sorted(GIVENS)}")
    rng = random.Random(int.from_bytes(hashlib.sha256(seed.encode("utf-8")).digest(), "big"))
    solution = _search([0] * 81, 1, rng)[0]
    target = rng.randint(*GIVENS[difficulty])
    cells = list(solution)
    givens = 81
    order = list(range(81))
    rng.shuffle(order)
    for i in order:
        if givens <= target:
            break
        keep, cells[i] = cells[i], "0"
        if len(solve("".join(cells))) == 1:
            givens -= 1
        else:
            cells[i] = keep
    return {"puzzle": "".join(cells), "solution": solution, "givens": givens, "seed": seed, "difficulty": difficulty}


def draw(B, x_mm: float, y_mm: float, size_mm: float, grid: str, font_key: str, digit_pt: float,
         line_cmyk=(0, 0, 0, 1), thin_pt: float = 0.4, thick_pt: float = 1.2, meta=None) -> None:
    """The 9x9 grid at (x_mm, y_mm) (top-left, y down), size_mm square: thin cell lines, then the thick border and box
    lines over them, then each non-zero digit of grid centred in its cell. Uses B only through line_mm and text_line.
    meta is accepted for the callers' page-builder convention and not used."""
    cell = size_mm / 9
    for thick in (False, True):
        for k in range(10):
            if (k % 3 == 0) != thick:
                continue
            w = thick_pt if thick else thin_pt
            B.line_mm((x_mm + k * cell, y_mm), (x_mm + k * cell, y_mm + size_mm), w, line_cmyk)
            B.line_mm((x_mm, y_mm + k * cell), (x_mm + size_mm, y_mm + k * cell), w, line_cmyk)
    for i, ch in enumerate(grid):
        if ch != "0":
            r, c = divmod(i, 9)
            B.text_line(ch, font_key, digit_pt, x_mm + (c + 0.5) * cell, y_mm + (r + 0.68) * cell, line_cmyk, "center",
                        **({"meta": {**meta, "role": "other_text"}} if meta else {}))
