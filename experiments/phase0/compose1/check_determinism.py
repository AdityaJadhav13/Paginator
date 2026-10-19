"""Re-run a deterministic 1-in-N sample of EXP-COMPOSE-1 compositions in a FRESH process and compare
composition signatures with results/compose1/signatures.json (prompt §33). EXPERIMENTAL."""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import common as C  # noqa: E402
import composer as K  # noqa: E402
import run_matrix as R  # noqa: E402

N = int(sys.argv[1]) if len(sys.argv) > 1 else 10
sigs = json.loads((R.OUT / "signatures.json").read_text())
texts = {t["id"]: t for t in C.load_corpus()}
fonts = {lab: (fam, axes, wt) for fl in R.FONTS.values() for lab, fam, axes, wt in fl}
keys = sorted(sigs)[::N]
cache, mism = {}, []
for k in keys:
    tid, lab, size, w, pol_name = k.split("|")
    t = texts[tid]; fam, axes, wt = fonts[lab]
    ck = (tid, lab, size)
    if ck not in cache:
        cache[ck] = K.prepare(t["text"], t["lang"], t["script"], fam, float(size), axes, wt)
    pol = next(p for p in R.policies(t["script"]) if p.name == pol_name)
    s = K.signature(K.compose(cache[ck], pol, float(w)))
    if s != sigs[k]:
        mism.append(k)
res = {"checked": len(keys), "sample_every": N, "mismatches": len(mism), "examples": mism[:10]}
(R.OUT / "determinism.json").write_text(json.dumps(res, indent=2) + "\n")
print(json.dumps(res))
