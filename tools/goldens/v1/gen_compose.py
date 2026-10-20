"""G-PREP / G-COMP: composer3's prepare() and compose(), dumped in full (EVIDENCE TOOLING).

experiments/phase0/compose3/composer3.py (with page1-compose 2.8.0's pattern_min and compound_breaks) is the body-text
composer of the press-accepted page and of the 28 generated pages. Recorded:
  compose/policies.json        every policy used below: its fields as a typed tree (golden.typed: ints, floats and
                               tuples exact) and Policy.key(); the TypeScript Policy must serialise to the same key
  compose/prepare.jsonl.gz     prepare(text, lang, script, family, size_pt, axes, weight): every GlyphRun field of the
                               shaped runs, the clusters, words, spaces, hyphen width, em and the face SHA-256
  compose/compose.jsonl.gz     compose(prepared, policy, measure): status, reason, cost, pieces, boundary types, every
                               Line field, and signature()
  compose/c2_grid.json         what the tracked compose2 signatures (experiments/phase0/results/compose2/
                               signatures.json) were computed from, so the TypeScript composer recomputes all 32,076
Cases (all inputs public: the synthetic corpus fixtures/typeset/v1/corpus/texts.json and OFL fonts):
  C2     run_compose2.policies() converted as run_compose3's Stage A does, on two corpus texts per compose2 font, at
         every size, width and policy of the grid; each signature is checked against signatures.json here
  C3     run_compose3.candidates() through policy_for() in house units (k as the press test computes it), on the
         Marathi body texts in the press body font and size at three measures (half with the press test's NBSP
         indent); the chosen candidate also with in-word breaks
  EN     page1's English policy: the chosen candidate + hyph-en-us rules, pattern minima, consecutive limit, compound
         breaks and its hyphen penalty (constants read from experiments/phase0/page1/compose_page.py), on the English
         body texts in page1's body font and in Source Serif 4
  HEAD   the press test's headline policy (RAGGED, token breaks) on the corpus headlines, 22 pt, 1–4 column spans
  PROBE  policies built here to reach every branch: greedy, constrained, ragged with rules, orthographic breaks, Latin
         tracking, no visible hyphen, no emergency breaks, asymmetric spacing, no hard limits, compound breaks — on
         every corpus text at a narrow (emergency breaks), a column and a wide measure
"""
from __future__ import annotations

import ast
import hashlib
import json
import statistics as st
import sys
from dataclasses import asdict, replace

from golden import EXPERIMENTS, GOLDENS, REPO, Out, cli, ensure_public, environment, fhex, typed

for _sub in ("compose3", "compose2", "typeset_harness", "compose1"):
    sys.path.insert(0, str(EXPERIMENTS / _sub))
import fontreg  # noqa: E402  (compose2 font registry: oracle OFL + compose2/fonts, as every composer run uses)

fontreg.install()
import common as C  # noqa: E402
import composer3 as K3  # noqa: E402
import run_compose2 as R2  # noqa: E402
import run_compose3 as R3  # noqa: E402

SIGNATURES = REPO / "experiments" / "phase0" / "results" / "compose2" / "signatures.json"
PAGE1 = EXPERIMENTS / "page1" / "compose_page.py"
BODY = ("Noto Serif Devanagari", {"wdth": 87.5}, 400)          # the press test's F1 / page1's body face
HEAD_FONT = ("Noto Sans Devanagari", {"wght": 700.0}, 700)     # the press test's F2
SERIF4 = ("Source Serif 4", {"wght": 400}, 400)
FIXTURE_DEVA = ("Noto Serif Devanagari", {"wght": 400}, 400)
HOUSE_BODY_PT, HOUSE_SPACE_EM, WIDTH_RATIO = 12.0, 0.25, 0.904  # make_press_test.py constants
BODY_PT = round(HOUSE_BODY_PT * WIDTH_RATIO, 3)
NBSP = " "
C3_MEASURES = (36.5, 50.06, 77.1)
SPANS = (36.5, 77.1, 117.7, 158.3)                             # make_press_test span_w(1..4)
PROBE_MEASURES = (25.0, 45.0, 80.0)


def page1_constants() -> dict:
    """EN_* constants of compose_page.py, read from its source (importing it would run its own setup)."""
    tree = ast.parse(PAGE1.read_text(encoding="utf-8"))
    out = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            if name in ("EN_HYPHEN_MIN", "EN_HYPHEN_PENALTY", "EN_MAX_CONSECUTIVE"):
                out[name] = ast.literal_eval(node.value)
    if len(out) != 3:
        raise SystemExit(f"compose_page.py constants not found: {sorted(out)}")
    return out


def probe_policies() -> list:
    P = K3.Policy
    return [
        P("PROBE_GREEDY_FULL_rules", "FULL", algorithm="GREEDY", inword="rules", inword_min=(2, 2)),
        P("PROBE_GREEDY_RAGGED", "RAGGED", algorithm="GREEDY"),
        P("PROBE_CONSTRAINED_rules", "CONSTRAINED", ws_max_hard=1.5, inword="rules", inword_min=(2, 2)),
        P("PROBE_RAGGED_rules", "RAGGED", inword="rules"),
        P("PROBE_HYBRID_ortho", "HYBRID", inword="ortho", inword_min=(2, 2)),
        P("PROBE_FULL_tracking", "FULL", tracking_max_milli_em=30.0),
        P("PROBE_FULL_rules_no_visible_hyphen", "FULL", inword="rules", visible_hyphen=False),
        P("PROBE_FULL_no_emergency", "FULL", emergency=False),
        P("PROBE_HYBRID_asym", "HYBRID", space_model="asym", ws_min_hard=0.7, shrink_scale=0.2, stretch_scale=0.5),
        P("PROBE_FULL_rules_no_hard_limits", "FULL", inword="rules", max_consecutive_inword=None,
          fallback_max_slack=None),
        P("PROBE_FULL_compound", "FULL", inword="rules", pattern_min=(2, 2), compound_breaks=True),
    ]


def house_k(family, axes, weight, size_pt, probe: str) -> float:
    """make_press_test.build_page: house word space (HOUSE_SPACE_EM of the house size) over our median space."""
    p = K3.prepare(probe, "mr", "Deva", family, size_pt, axes, weight)
    return (HOUSE_SPACE_EM * HOUSE_BODY_PT / R3.MM) / st.median(s for s in p.spaces if s)


def run_dump(r) -> dict:
    return {"font_id": r.font_id, "size_pt_hex": fhex(r.size_pt), "char_start": r.char_start, "char_end": r.char_end,
            "color_hex": [fhex(r.color.c), fhex(r.color.m), fhex(r.color.y), fhex(r.color.k)],   # paginator.color.CMYK
            "glyph_ids": list(r.glyph_ids), "cluster_map": list(r.cluster_map),
            "x_advances_mm_hex": [fhex(x) for x in r.x_advances_mm],
            "x_offsets_mm_hex": [fhex(x) for x in r.x_offsets_mm], "y_offsets_mm_hex": [fhex(x) for x in r.y_offsets_mm]}


def prep_dump(pid: str, p, inp: dict) -> dict:
    return {"schema": "pageinator.golden.prepare/1", "id": pid, "input": inp, "expected": {
        "runs": [run_dump(r) for r in p.runs],
        "clusters": [[c.start, c.end, fhex(c.width), [list(g) for g in c.glyphs], c.is_space] for c in p.clusters],
        "words": p.words, "spaces_hex": [None if s is None else fhex(s) for s in p.spaces],
        "hyphen_w_hex": fhex(p.hyphen_w), "em_mm_hex": fhex(p.em_mm),
        "face_sha256": hashlib.sha256(p.face_bytes).hexdigest()}}


def line_dump(ln) -> dict:
    return {"a": ln.a, "b": ln.b, "kind": ln.kind, "n_spaces": ln.n_spaces, "n_words": ln.n_words,
            "boxes_mm_hex": fhex(ln.boxes_mm), "spaces_mm_hex": fhex(ln.spaces_mm), "natural_mm_hex": fhex(ln.natural_mm),
            "measure_mm_hex": fhex(ln.measure_mm), "required_sf_hex": fhex(ln.required_sf),
            "applied_sf_hex": fhex(ln.applied_sf), "tracking_mm_per_gap_hex": fhex(ln.tracking_mm_per_gap),
            "slack_mm_hex": fhex(ln.slack_mm), "end_break": ln.end_break, "cost_hex": fhex(ln.cost),
            "within_policy": ln.within_policy, "flags": list(ln.flags)}


def compose_dump(case: str, pid: str, policy, measure: float, c) -> dict:
    return {"schema": "pageinator.golden.compose/1", "case": case, "prepare": pid, "policy": policy.name,
            "measure_mm_hex": fhex(measure), "expected": {
                "status": c.status, "reason": c.reason, "cost_hex": fhex(c.cost), "signature": K3.signature(c),
                "pieces": [[pc.word, pc.cl_from, pc.cl_to, fhex(pc.width), pc.n_clusters] for pc in c.pieces],
                "btype": list(c.btype), "lines": [line_dump(ln) for ln in c.lines]}}


class Cases:
    def __init__(self):
        self.preps, self.prep_records, self.compositions, self.policies = {}, [], [], {}

    def policy(self, pol):
        known = self.policies.get(pol.name)
        if known is not None and known is not pol and asdict(known) != asdict(pol):
            raise SystemExit(f"two different policies named {pol.name}")
        self.policies[pol.name] = pol
        return pol

    def prep(self, pid, text, lang, script, font, size):
        if pid not in self.preps:
            family, axes, weight = font
            p = K3.prepare(text, lang, script, family, size, axes, weight)
            inp = {"text": text, "lang": lang, "script": script, "family": family, "axes": axes, "weight": weight,
                   "size_pt_hex": fhex(size)}
            self.preps[pid] = p
            self.prep_records.append(prep_dump(pid, p, inp))
        return self.preps[pid]

    def compose(self, case, pid, pol, measure):
        c = K3.compose(self.preps[pid], self.policy(pol), measure)
        self.compositions.append(compose_dump(case, pid, pol, measure, c))
        return c


def c2_cases(cs: Cases, texts: dict) -> dict:
    sigs = json.loads(SIGNATURES.read_text())
    fonts = {lab: (fam, axes, wt) for lab, fam, axes, wt, _ in R2.FONTS}
    pols = {}
    for p2 in R2.policies():                                   # run_compose3.stage_a's conversion, unchanged
        d = asdict(p2)
        w = d.pop("weights")
        pols[p2.name] = K3.Policy(**d, weights=K3.Weights(**w))
    keys = [k.split("|") for k in sorted(sigs) if k.split("|")[4] in pols]
    labels = sorted({k[1] for k in keys})
    text_ids = sorted({k[0] for k in keys})
    chosen = {lab: {text_ids[(2 * i) % len(text_ids)], text_ids[(2 * i + 1) % len(text_ids)]}
              for i, lab in enumerate(labels)}
    checked = 0
    for tid, lab, size, width, pname in keys:
        if tid not in chosen[lab]:
            continue
        pid = f"C2:{tid}:{lab}:{size}"
        cs.prep(pid, texts[tid]["text"], "mr", "Deva", fonts[lab], float(size))
        c = cs.compose("C2", pid, pols[pname], float(width))
        if K3.signature(c) != sigs["|".join([tid, lab, size, width, pname])]:
            raise SystemExit(f"C2 {tid}|{lab}|{size}|{width}|{pname}: composer3 disagrees with signatures.json")
        checked += 1
    for pol in pols.values():
        cs.policy(pol)
    grid = {"schema": "pageinator.golden.c2-grid/1",
            "signatures": {"file": SIGNATURES.relative_to(REPO).as_posix(),
                           "sha256": hashlib.sha256(SIGNATURES.read_bytes()).hexdigest(),
                           "key": "text id|font label|size pt|width mm|policy name (C2_* = composer3 legacy policies)",
                           "c2_entries": len(keys)},
            "texts": "fixtures/typeset/v1/corpus/texts.json (lang mr, script Deva)",
            "fonts": {lab: {"family": fam, "axes": axes, "weight": wt} for lab, (fam, axes, wt) in sorted(fonts.items())},
            "policies": sorted(pols), "sizes_pt": sorted({k[2] for k in keys}, key=float),
            "widths_mm": sorted({k[3] for k in keys}, key=float), "dumped_here": checked}
    return grid


def main(root=REPO) -> dict:
    ensure_public()
    out = Out(root)
    texts = {t["id"]: t for t in C.load_corpus()}
    cs = Cases()
    grid = c2_cases(cs, texts)

    k = house_k(*BODY, BODY_PT, "क ख")
    chosen = json.loads((R3.OUT / "summary.json").read_text())["selection"]["chosen"]
    body_texts = [t for t in sorted(texts) if texts[t]["kind"] == "body" and texts[t]["lang"] == "mr"]
    for i, tid in enumerate(body_texts):
        indent = i % 2 == 0
        pid = f"C3:{tid}:{'indent' if indent else 'plain'}"
        cs.prep(pid, NBSP * 5 * indent + texts[tid]["text"], "mr", "Deva", BODY, BODY_PT)
        for name, (kind, prm) in R3.candidates().items():
            for m in C3_MEASURES:
                cs.compose("C3", pid, R3.policy_for(name, kind, prm, k), m)
        kind, prm = R3.candidates()[chosen]
        for m in C3_MEASURES:
            cs.compose("C3", pid, R3.policy_for(chosen + "_with_breaks", kind, prm, k, inword="rules"), m)

    en = page1_constants()
    kind, prm = R3.candidates()[chosen]
    for font, label in ((BODY, "body"), (SERIF4, "serif4")):
        k_en = house_k(*font, BODY_PT, "a b")
        pol = R3.policy_for(chosen, kind, prm, k_en)
        pol = replace(pol, name=f"EN_page1_{label}", inword="rules", inword_min=en["EN_HYPHEN_MIN"],
                      pattern_min=en["EN_HYPHEN_MIN"], max_consecutive_inword=en["EN_MAX_CONSECUTIVE"],
                      compound_breaks=True, weights=replace(pol.weights, hyphen=en["EN_HYPHEN_PENALTY"]))
        for tid in sorted(t for t in texts if texts[t]["kind"] == "body" and texts[t]["lang"] == "en"):
            pid = f"EN:{tid}:{label}"
            cs.prep(pid, texts[tid]["text"], "en", "Latn", font, BODY_PT)
            for m in C3_MEASURES[:2]:
                cs.compose("EN", pid, pol, m)

    head_pol = K3.Policy("HEADLINE_ragged", "RAGGED", inword="none", token_breaks=True, fallback_max_slack=None)
    for tid in sorted(t for t in texts if texts[t]["kind"] == "headline"):
        t = texts[tid]
        pid = f"HEAD:{tid}"
        cs.prep(pid, t["text"], t["lang"], t["script"], HEAD_FONT, 22.0)
        for m in SPANS:
            cs.compose("HEAD", pid, head_pol, m)

    probes = probe_policies()
    for tid in sorted(texts):
        t = texts[tid]
        font = SERIF4 if t["script"] == "Latn" else FIXTURE_DEVA
        pid = f"PROBE:{tid}"
        cs.prep(pid, t["text"], t["lang"], t["script"], font, 10.0)
        for pol in probes:
            for m in PROBE_MEASURES:
                cs.compose("PROBE", pid, pol, m)

    out.json(GOLDENS / "compose" / "policies.json", {
        "schema": "pageinator.golden.policies/1", "composer": K3.COMPOSER_VERSION,
        "policies": {n: {"tree": typed(asdict(p)), "key": p.key()} for n, p in sorted(cs.policies.items())}})
    out.jsonl_gz(GOLDENS / "compose" / "prepare.jsonl.gz", cs.prep_records)
    out.jsonl_gz(GOLDENS / "compose" / "compose.jsonl.gz", cs.compositions)
    out.json(GOLDENS / "compose" / "c2_grid.json", grid)
    by_case = {}
    for c in cs.compositions:
        by_case[c["case"]] = by_case.get(c["case"], 0) + 1
    counts = {"policies": len(cs.policies), "prepared": len(cs.prep_records), "compositions": len(cs.compositions),
              "by_case": dict(sorted(by_case.items())), "lines": sum(len(c["expected"]["lines"]) for c in cs.compositions),
              "c2_signatures_checked_here": grid["dumped_here"],
              "statuses": {s: sum(c["expected"]["status"] == s for c in cs.compositions) for s in ("OK", "OVERSET")}}
    out.json(GOLDENS / "compose" / "info.json", {"schema": "pageinator.golden.compose-info/1",
                                                 "composer": K3.COMPOSER_VERSION, "chosen_c3": chosen,
                                                 "house_k_hex": fhex(k), "body_pt_hex": fhex(BODY_PT),
                                                 "counts": counts, "environment": environment()})
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
