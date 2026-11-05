"""G-PY: the Python semantics the TypeScript port must emulate, as input → output vectors (EVIDENCE TOOLING).

Kinds (each record: {"kind", "input", "expected"}):
  float       for one double x: round(x) (int, half to even), round(x, n) for n = 0..9, f"{x:.{n}f}" for n = 1..6,
              f"{x:g}" and repr(x)                                          — signatures, ranking keys, PDF numbers,
              font_id axis text, json.dumps float text
  json        json.dumps(tree, separators=…, sort_keys=…, ensure_ascii=…)  — signatures, Policy.key, hashes
  pow3        x ** 3                                                       — Knuth–Plass demerits (libm pow)
  sum         sum(list of floats), left to right
  median      statistics.median(list of floats)
  sort        sorted(list of str)                                          — code-point order
  split       str.split() and str.split(" ")                                 — whitespace semantics
  stable_id   paginator.ids.stable_id(prefix, *parts)                      — ids (BLAKE2b, 8-byte digest)
Floats are float.hex() strings. JSON inputs are typed trees so ints and floats stay distinct:
  ["f", hex] ["i", "decimal"] ["s", text] ["b", bool] ["n"] ["l", [items]] ["d", [[key, value], …]] (insertion order).
"""
from __future__ import annotations

import json
import math
import random
import statistics
import struct

from golden import GOLDENS, REPO, SEED, Out, cli, environment, fhex, typed

from paginator.ids import stable_id


def rand_double(rng: random.Random) -> float:
    """Doubles spanning the whole range: random bit patterns (finite), plus typical layout magnitudes."""
    r = rng.random()
    if r < 0.4:
        while True:
            x = struct.unpack("<d", rng.getrandbits(64).to_bytes(8, "little"))[0]
            if math.isfinite(x):
                return x
    if r < 0.8:
        return rng.uniform(-1000, 1000)
    if r < 0.9:
        return rng.randint(-100000, 100000) / 1000  # values on a decimal grid (ties for round)
    return rng.randint(-4096, 4096) / 8  # exact binary ties: x.5, x.125 …


def records():
    rng = random.Random(SEED)
    specials = [0.0, -0.0, 0.5, 1.5, 2.5, -2.5, 0.125, 0.375, 1e16, 1e-5, 1e-7, 123456789.0, 5e-324, 1.7976931348623157e308,
                0.1, 0.2, 0.30000000000000004, 2.675, 1.005, 1e22, 1e21, 1e-4, 9.995, 10.848, 36.5, 4.19, 12.8154]
    xs = specials + [rand_double(rng) for _ in range(30_000)]
    for x in xs:
        # one record per number, all its expected texts together (keeps the file small)
        yield {"kind": "float", "input": {"x_hex": fhex(x)},
               "expected": {"round_int": str(round(x)) if abs(x) < 1e300 else None,
                            "round_hex": [fhex(round(x, n)) for n in range(10)],
                            "fixed": [format(x, f".{n}f") for n in range(1, 7)] if abs(x) < 1e18 else None,
                            "g": format(x, "g"), "repr": repr(x)}}
    for _ in range(20_000):
        x = rng.uniform(-1.0, 2.0) if rng.random() < 0.8 else rand_double(rng)
        if abs(x) < 1e100:
            yield {"kind": "pow3", "input": {"x_hex": fhex(x)}, "expected": {"x_hex": fhex(abs(x) ** 3)}}
    for _ in range(5_000):
        vals = [rng.uniform(-100, 100) for _ in range(rng.randint(1, 30))]
        yield {"kind": "sum", "input": {"xs_hex": [fhex(v) for v in vals]}, "expected": {"x_hex": fhex(sum(vals))}}
        yield {"kind": "median", "input": {"xs_hex": [fhex(v) for v in vals]},
               "expected": {"x_hex": fhex(float(statistics.median(vals)))}}
    alphabet = ["a", "B", "z", "Z", "é", "क", "ख", "्", "ष", "‍", "‌", "😀", "𝒜", "ß", "İ", "0", " ", " "]
    for _ in range(3_000):
        words = ["".join(rng.choice(alphabet) for _ in range(rng.randint(0, 5))) for _ in range(rng.randint(1, 8))]
        yield {"kind": "sort", "input": words, "expected": sorted(words)}
        text = rng.choice(["", " ", "  "]).join(words) + rng.choice(["", " ", " ", "\t", " ", "\x1c"])
        yield {"kind": "split", "input": text, "expected": {"split": text.split(), "split_space": text.split(" ")}}
    samples = [1, 1.0, -0.0, 0.1, 1e16, 1e-5, 2.5, float("inf"), "क्ष", "a\"b\\c\n", "é", "😀", True, None, [1, 2.5],
               {"b": 1, "a": [0.5, "x"]}, {"z": {"y": 1.25}, "a": None}]
    for v in samples:
        for seps in ((", ", ": "), (",", ":")):
            for sort_keys in (False, True):
                for ensure_ascii in (True, False):
                    yield {"kind": "json", "input": {"tree": typed(v), "separators": list(seps), "sort_keys": sort_keys,
                                                     "ensure_ascii": ensure_ascii},
                           "expected": json.dumps(v, separators=seps, sort_keys=sort_keys, ensure_ascii=ensure_ascii)}
    parts_pool = ["Noto Serif Devanagari", "400", "normal", "wdth=87.5,wght=400", "क्ष", "", "a\u001fb", "😀"]
    for _ in range(2_000):
        prefix = rng.choice(["fnt", "art", "stry", "pg"])
        parts = [rng.choice(parts_pool) for _ in range(rng.randint(0, 4))]
        yield {"kind": "stable_id", "input": {"prefix": prefix, "parts": parts}, "expected": stable_id(prefix, *parts)}


def main(root=REPO) -> dict:
    out = Out(root)
    recs = list(records())
    counts = {}
    for r in recs:
        counts[r["kind"]] = counts.get(r["kind"], 0) + 1
    # individual assertions: a float record checks 1 + 10 + 6 + 1 + 1 values
    counts["assertions"] = sum(19 if r["kind"] == "float" else 2 if r["kind"] in ("sum", "split") else 1 for r in recs)
    counts["records"] = len(recs)
    out.jsonl_gz(GOLDENS / "pyshim" / "vectors.jsonl.gz", recs)
    out.json(GOLDENS / "pyshim" / "info.json", {"schema": "pageinator.golden.pyshim/1", "seed": SEED, "counts": counts,
                                                "environment": environment()})
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
