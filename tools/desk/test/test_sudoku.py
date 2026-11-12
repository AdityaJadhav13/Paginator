"""The daily sudoku (layout/sudoku.py): seeded, unique, in the difficulty's givens range, drawn as lines and digits.
Run from the repository root:

  PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python -m unittest tools/desk/test/test_sudoku.py -v
"""
from __future__ import annotations

import sys
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "engine" / "layout"))

import sudoku  # noqa: E402

SEEDS = ["2026-11-11", "2026-11-12", "2026-12-25", "2027-01-01", "fictional"]


def valid(grid: str) -> bool:
    return all(sorted(grid[i] for i in u) == list("123456789") for u in sudoku.UNITS)


class FakeB:
    def __init__(self):
        self.lines, self.texts = [], []

    def line_mm(self, a, b, width_pt, cmyk):
        self.lines.append((a, b, width_pt, cmyk))

    def text_line(self, text, font_key, size_pt, x_mm, baseline_mm, cmyk, align):
        self.texts.append((text, font_key, size_pt, x_mm, baseline_mm, cmyk, align))


class Make(unittest.TestCase):
    def test_same_seed_same_output_different_seed_different_puzzle(self):
        self.assertEqual(repr(sudoku.make("2026-11-11")), repr(sudoku.make("2026-11-11")))
        self.assertEqual(sudoku.make("2026-11-11", "medium"), sudoku.make("2026-11-11", "medium"))
        self.assertEqual(len({sudoku.make(s)["puzzle"] for s in SEEDS}), len(SEEDS))

    def test_solution_valid_unique_and_givens_in_range(self):
        for diff, (lo, hi) in sudoku.GIVENS.items():
            for seed in SEEDS:
                with self.subTest(seed=seed, difficulty=diff):
                    t = time.perf_counter()
                    m = sudoku.make(seed, diff)
                    self.assertLess(time.perf_counter() - t, 2.0)
                    p, s = m["puzzle"], m["solution"]
                    self.assertEqual((len(p), len(s), m["seed"], m["difficulty"]), (81, 81, seed, diff))
                    self.assertTrue(valid(s))
                    self.assertTrue(all(a in ("0", b) for a, b in zip(p, s)))
                    self.assertEqual(sudoku.solve(p), [s])
                    self.assertEqual(m["givens"], 81 - p.count("0"))
                    self.assertTrue(lo <= m["givens"] <= hi, m["givens"])

    def test_solve_counts_to_two(self):
        self.assertEqual(len(sudoku.solve("0" * 81)), 2)
        self.assertEqual(sudoku.solve("11" + "0" * 79), [])
        with self.assertRaises(ValueError):
            sudoku.solve("12")
        with self.assertRaises(ValueError):
            sudoku.make("x", "hard")


class Draw(unittest.TestCase):
    def test_lines_and_digits(self):
        B, m = FakeB(), sudoku.make("2026-11-11")
        x, y, size = 20.0, 30.0, 63.0
        sudoku.draw(B, x, y, size, m["puzzle"], "latin", 14.0)
        self.assertEqual(len(B.lines), 20)
        vertical = [ln for ln in B.lines if ln[0][0] == ln[1][0]]
        horizontal = [ln for ln in B.lines if ln[0][1] == ln[1][1]]
        self.assertEqual((len(vertical), len(horizontal)), (10, 10))
        for group in (vertical, horizontal):
            self.assertEqual(sum(ln[2] == 1.2 for ln in group), 4)   # border (2) + box lines (2)
            self.assertEqual(sum(ln[2] == 0.4 for ln in group), 6)
        widths = [ln[2] for ln in B.lines]
        self.assertEqual(widths, sorted(widths))                      # thick after thin
        self.assertEqual(len(B.texts), m["givens"])
        self.assertEqual([t[0] for t in B.texts], [ch for ch in m["puzzle"] if ch != "0"])
        for t in B.texts:
            self.assertEqual((t[1], t[2], t[6]), ("latin", 14.0, "center"))
            self.assertTrue(x < t[3] < x + size and y < t[4] < y + size)


if __name__ == "__main__":
    unittest.main()
