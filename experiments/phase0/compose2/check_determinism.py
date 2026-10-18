"""Re-run a deterministic 1-in-N sample of EXP-COMPOSE-2 compositions in a FRESH process and compare
composition signatures with results/compose2/signatures.json. EXPERIMENTAL.
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose2/check_determinism.py [N]"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE.parent / "typeset_harness"))
import fontreg  # noqa: E402

fontreg.install()
import common as C  # noqa: E402
import composer2 as K2  # noqa: E402
import run_compose2 as R  # noqa: E402

K1 = R.K1
N = int(sys.argv[1]) if len(sys.argv) > 1 else 10
sigs = json.loads((R.OUT / "signatures.json").read_text())
texts = {t["id"]: t for t in C.load_corpus()}
fonts = {f[0]: (f[1], f[2], f[3]) for f in R.FONTS}
pols = {p.name: p for p in R.policies()}
keys = sorted(sigs)[::N]
cache, mism = {}, []
for k in keys:
    tid, lab, size, w, pn = k.split("|")
    fam, axes, wt = fonts[lab]
    ref = pn == R.REF_C1.name
    ck = (tid, lab, size, ref)
    if ck not in cache:
        cache[ck] = (K1 if ref else K2).prepare(texts[tid]["text"], "mr", "Deva", fam, float(size), axes, wt)
    s = K1.signature(K1.compose(cache[ck], R.REF_C1, float(w))) if ref else K2.signature(K2.compose(cache[ck], pols[pn], float(w)))
    if s != sigs[k]:
        mism.append(k)
res = {"checked": len(keys), "sample_every": N, "total": len(sigs), "mismatches": len(mism), "examples": mism[:10]}
(R.OUT / "determinism.json").write_text(json.dumps(res, indent=2) + "\n")
print(json.dumps(res))
