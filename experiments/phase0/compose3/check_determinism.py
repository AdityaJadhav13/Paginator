"""Re-run a 1-in-N sample of EXP-COMPOSE-3 compositions in a FRESH process and compare signatures (EXPERIMENTAL).
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 tools/oracle/v0/.venv/bin/python experiments/phase0/compose3/check_determinism.py <dataset_dir> [N]"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import run_compose3 as R  # noqa: E402

ds = Path(sys.argv[1]).expanduser(); N = int(sys.argv[2]) if len(sys.argv) > 2 else 10
sigs = json.loads((ds / "report" / "compose3" / "signatures.json").read_text())
pars = {p["id"]: p for p in (json.loads(l) for l in open(ds / "report" / "paragraphs.jsonl", encoding="utf-8"))}
cands = R.candidates()
keys = sorted(sigs)[::N]; mism = []; cache = {}
for key in keys:
    pid, name = key.rsplit("|", 1)
    if pid not in cache:
        cache[pid] = R.prepare_paragraph(pars[pid])
    p, size, n_nb, our_sp, house_sp = cache[pid]
    kind, prm = cands[name]
    if R.K3.signature(R.K3.compose(p, R.policy_for(name, kind, prm, house_sp / our_sp), pars[pid]["width_mm"])) != sigs[key]:
        mism.append(key)
res = {"checked": len(keys), "sample_every": N, "total": len(sigs), "mismatches": len(mism)}
(R.OUT / "determinism.json").write_text(json.dumps(res, indent=2) + "\n")
print(json.dumps(res))
