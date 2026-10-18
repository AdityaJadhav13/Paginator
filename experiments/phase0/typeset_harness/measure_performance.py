"""Phase 0 performance measurements of oracle-v0 (engine compute only).

EXPERIMENTAL / EVIDENCE TOOLING. Results are a BASELINE for EXP-ENGINE (docs/architecture/v2/16 §1),
not a verdict on any language.

A. Per-paragraph stage timings (cold + warm): shaping, node building, Knuth–Plass(+fallback).
B. Edition-scale throughput: ~1,200 paragraphs, with and without a shaping cache.
C. Server-authoritative interaction scenarios — ENGINE COMPUTE ONLY (no network, no frame flow,
   no justified positions, no display-list build: oracle-v0 lacks them → lower bound).
D. Payload size/serialisation of a display-list-like structure for a story and a page.

Usage: tools/oracle/v0/.venv/bin/python experiments/phase0/typeset_harness/measure_performance.py [--iters 50]
Writes experiments/phase0/results/performance/{env.json, paragraph_timings.csv, summary.json}
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import time

import common as C

OUT = C.REPO / "experiments" / "phase0" / "results" / "performance"
P0 = {"word_space_min": 0.75, "word_space_max": 1.5, "tolerance": 1.0}
FONT = {"Deva": "Noto Serif Devanagari", "Latn": "Source Serif 4"}


def pct(xs, p):
    return round(C.percentile(xs, p) * 1000, 4)  # ms


def stats_ms(xs):
    return {"n": len(xs), "p50_ms": pct(xs, .5), "p95_ms": pct(xs, .95), "p99_ms": pct(xs, .99),
            "max_ms": round(max(xs) * 1000, 4)}


def shape_break(text, lang, script, size=9.5, width=45.0, cache=None):
    fam = FONT[script]
    st = C.style(fam, size, round(size * 1.18, 3), P0)
    t0 = time.perf_counter()
    key = (text, lang, fam, size)
    if cache is not None and key in cache:
        runs = cache[key]
    else:
        runs = C.shape_paragraph(text, lang, fam, size).runs
        if cache is not None:
            cache[key] = runs
    t1 = time.perf_counter()
    nodes = C.build_nodes(runs, text, st)
    t2 = time.perf_counter()
    res = C.break_lines(nodes, [width], st)
    t3 = time.perf_counter()
    return runs, res, (t1 - t0, t2 - t1, t3 - t2)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--iters", type=int, default=50)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    corpus = C.load_corpus()
    body = [t for t in corpus if t["kind"] == "body"]
    heads = [t for t in corpus if t["kind"] == "headline"]
    summary = {"scope_note": "Engine compute on the measurement machine only. Excludes network, frame flow, "
                             "justified positions, display-list construction, serialization unless stated."}

    # A — cold: first shaping after fresh registry (includes font load + variable-font instancing)
    cold = {}
    for script, fam in FONT.items():
        C._REGISTRY = None  # noqa: SLF001 — fresh registry to measure cold path
        sample = next(t for t in body if t["script"] == script)
        t0 = time.perf_counter()
        shape_break(sample["text"], sample["lang"], script)
        cold[fam] = round((time.perf_counter() - t0) * 1000, 2)
    summary["A_cold_first_paragraph_ms"] = cold

    rows, by_script = [], {"Deva": ([], [], [], []), "Latn": ([], [], [], [])}
    for t in body:
        for _ in range(3):  # warm-up
            shape_break(t["text"], t["lang"], t["script"])
        for i in range(a.iters):
            _, res, (ts, tn, tb) = shape_break(t["text"], t["lang"], t["script"])
            s = by_script[t["script"]]
            s[0].append(ts); s[1].append(tn); s[2].append(tb); s[3].append(ts + tn + tb)
            rows.append({"text_id": t["id"], "lang": t["lang"], "chars": len(t["text"]), "iter": i,
                         "shape_ms": round(ts * 1000, 4), "nodes_ms": round(tn * 1000, 4),
                         "break_ms": round(tb * 1000, 4), "total_ms": round((ts + tn + tb) * 1000, 4),
                         "lines": res.line_count, "fallback": res.used_fallback})
    with (OUT / "paragraph_timings.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    summary["A_warm_per_paragraph"] = {
        sc: {"shape": stats_ms(v[0]), "nodes": stats_ms(v[1]), "break": stats_ms(v[2]), "total": stats_ms(v[3]),
             "mean_chars": round(sum(len(t["text"]) for t in body if t["script"] == sc) /
                                 max(1, sum(1 for t in body if t["script"] == sc)), 1)}
        for sc, v in by_script.items()}

    # B — edition scale: 1,200 paragraphs (cycled corpus; 85 % Devanagari)
    deva = [t for t in body if t["script"] == "Deva"]
    latn = [t for t in body if t["script"] == "Latn"]
    edition = [(deva[i % len(deva)] if i % 7 else latn[i % len(latn)]) for i in range(1200)]
    for label, cache in (("cold_shaping_each_paragraph", None), ("shaping_cached_rebreak_only", {})):
        if cache is not None:
            for t in edition:
                shape_break(t["text"], t["lang"], t["script"], cache=cache)
        t0 = time.perf_counter()
        for t in edition:
            shape_break(t["text"], t["lang"], t["script"], cache=cache)
        summary.setdefault("B_edition_1200_paragraphs_s", {})[label] = round(time.perf_counter() - t0, 3)

    # C — server-authoritative interaction scenarios (engine compute only)
    cache = {}
    story = [t for t in deva][:6]           # a 6-paragraph Marathi story
    page = (deva * 12)[:180]                # ~180 paragraphs on a broadsheet page
    head = next(h for h in heads if h["lang"] == "mr")

    def sc_headline_edit():
        txt = head["text"] + " आज"
        fam = "Noto Sans Devanagari"
        runs = C.shape_paragraph(txt, "mr", fam, 36, weight=700).runs
        st = C.style(fam, 36, 40, P0, algorithm="greedy")
        C.break_lines(C.build_nodes(runs, txt, st), [132.0], st)

    def sc_body_edit():  # one paragraph reshaped (edited), rest of story re-broken (flow lower bound)
        edited = story[0]["text"] + " नवीन"
        shape_break(edited, "mr", "Deva")
        for t in story[1:]:
            shape_break(t["text"], "mr", "Deva", cache=cache)

    def sc_frame_resize():
        for t in story:
            shape_break(t["text"], "mr", "Deva", width=52.0, cache=cache)

    def sc_column_resize_3_stories():
        for _ in range(3):
            for t in story:
                shape_break(t["text"], "mr", "Deva", width=38.0, cache=cache)

    def sc_image_move_wrap():  # per-line measures change around an image
        fam = FONT["Deva"]
        st = C.style(fam, 9.5, 11.21, P0)
        for t in story:
            runs = cache.get((t["text"], "mr", fam, 9.5)) or C.shape_paragraph(t["text"], "mr", fam, 9.5).runs
            C.break_lines(C.build_nodes(runs, t["text"], st), [30.0] * 6 + [45.0], st)

    def sc_continuation_change_2_stories():
        for t in story + story:
            shape_break(t["text"], "mr", "Deva", width=45.0, cache=cache)

    def sc_page_recompose_cached():
        for t in page:
            shape_break(t["text"], "mr", "Deva", width=38.0, cache=cache)

    def sc_page_recompose_uncached():
        for t in page:
            shape_break(t["text"] + " ", "mr", "Deva", width=38.0)

    scen = {"headline_edit": sc_headline_edit, "body_text_edit": sc_body_edit, "frame_resize": sc_frame_resize,
            "column_resize_3_stories": sc_column_resize_3_stories, "image_move_text_wrap": sc_image_move_wrap,
            "story_continuation_change_2_stories": sc_continuation_change_2_stories,
            "page_recompose_shaping_cached": sc_page_recompose_cached,
            "page_recompose_uncached": sc_page_recompose_uncached}
    for t in story:  # prime cache
        shape_break(t["text"], "mr", "Deva", cache=cache)
    res_c = {}
    for name, fn in scen.items():
        n = 20 if name.startswith("page_") else max(100, a.iters * 2)
        for _ in range(3):
            fn()
        xs = []
        for _ in range(n):
            t0 = time.perf_counter(); fn(); xs.append(time.perf_counter() - t0)
        res_c[name] = stats_ms(xs)
    summary["C_server_compute_scenarios"] = res_c

    # D — payload size of a display-list-like structure (glyph ids + int µpt positions per glyph)
    def payload(paras):
        out = []
        for t in paras:
            runs = C.shape_paragraph(t["text"], t["lang"], FONT[t["script"]], 9.5).runs
            for r in runs:
                x = 0.0; pos = []
                for adv in r.x_advances_mm:
                    pos.append(int(round(x / C.MM_PER_PT * 1000))); x += adv
                out.append({"f": r.font_id[:12], "g": list(r.glyph_ids), "x": pos, "c": list(r.cluster_map)})
        raw = json.dumps(out, separators=(",", ":")).encode()
        t0 = time.perf_counter(); json.dumps(out, separators=(",", ":")); enc = time.perf_counter() - t0
        return {"glyph_runs": len(out), "glyphs": sum(len(o["g"]) for o in out), "json_bytes": len(raw),
                "gzip_bytes": len(gzip.compress(raw)), "encode_ms": round(enc * 1000, 3)}
    summary["D_payload"] = {"story_6_paragraphs": payload(story), "page_180_paragraphs": payload(page)}

    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    (OUT / "env.json").write_text(json.dumps(C.environment({"experiment": "performance/1", "iters": a.iters,
                                                            "warm_definition": "3 warm-up runs then N timed runs, same process, fonts loaded"}),
                                             indent=2) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k != "scope_note"}, indent=1)[:4000])


if __name__ == "__main__":
    main()
