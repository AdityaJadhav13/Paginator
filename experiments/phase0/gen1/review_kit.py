"""EXP-GEN-1 editor review kit: an OFFLINE, blind, side-by-side review of generated vs printed page layouts
(EXPERIMENTAL; the kit and its key contain private newspaper content and stay outside git).

Pairs (all pages rendered from Pageinator PDFs in the same stand-in fonts, so the type never tells which is which):
  real    the page laid out by Pageinator (report/gen1) vs the printed layout rebuilt (report/page1/rebuilt)
  check   both sides of one kind: two Pageinator layouts (the second with the lead on the other side, made with
          generate.py --out <src>/gen_alt --lead-side left), or the printed layout rebuilt twice (story-level and
          paper-level text size, compose_page.py --size paper --out <src>/rebuilt_paper). A confident pick here shows
          memory or chance, not layout.
The check pairs are listed in <dataset>/report/<review>_src/checks.json ([["ours"|"theirs", page], …]).
Order and sides are shuffled with a fixed seed (the generated page on side A in half of the real pairs). The rebuild's "TEST" slug strip (the bottom SLUG_MM of the page) is
blanked on every image. The key (which side is which) is written to <dataset>/report/<review>_src/key.json, never into
the kit. The kit is one index.html (Marathi + English, no internet, answers saved in the browser and downloaded as a
JSON file) and img/.
Usage (repo root): PYTHONDONTWRITEBYTECODE=1 experiments/phase0/pdfx1/.venv/bin/python experiments/phase0/gen1/review_kit.py
                   <dataset_dir> <kit_dir> [--review review1] [--seed 20261018]
"""
from __future__ import annotations

import json
import random
import sys
from pathlib import Path

import pypdfium2 as pdfium
from PIL import ImageDraw

DPI = 150
SLUG_MM = 10.0
QUALITY = 82


def render(pdf: Path, out: Path):
    page = pdfium.PdfDocument(str(pdf))[0]
    im = page.render(scale=DPI / 72).to_pil().convert("RGB")
    cut = round(SLUG_MM / 25.4 * DPI)
    ImageDraw.Draw(im).rectangle([0, im.height - cut, im.width, im.height], fill="white")
    im.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
    out.chmod(0o600)


def main():
    args = sys.argv[1:]
    opt = {}
    for flag in ("--review", "--seed"):
        if flag in args:
            i = args.index(flag); opt[flag] = args[i + 1]; del args[i:i + 2]
    ds, kit = Path(args[0]).expanduser(), Path(args[1]).expanduser()
    review, seed = opt.get("--review", "review1"), int(opt.get("--seed", "20261018"))
    src = ds / "report" / f"{review}_src"
    gen, rebuilt = ds / "report" / "gen1", ds / "report" / "page1" / "rebuilt"
    real = sorted(p.name[:-4] for p in gen.glob("*.pdf") if not p.name.endswith(".fixed.pdf"))
    items = [{"kind": "real", "page": n, "files": {"generated": gen / f"{n}.pdf", "printed": rebuilt / f"{n}.pdf"}} for n in real]
    checks = json.loads((src / "checks.json").read_text()) if (src / "checks.json").exists() else []   # [[ours|theirs, page]]
    for kind, n in checks:
        files = ({"generated": gen / f"{n}.pdf", "generated_alt": src / "gen_alt" / f"{n}.pdf"} if kind == "ours"
                 else {"printed": rebuilt / f"{n}.pdf", "printed_paper": src / "rebuilt_paper" / f"{n}.pdf"})
        items.append({"kind": f"check_{kind}", "page": n, "files": files})
    for it in items:
        for f in it["files"].values():
            if not f.exists():
                sys.exit(f"missing {f}")
    rng = random.Random(seed)
    rng.shuffle(items)
    (kit / "img").mkdir(parents=True, exist_ok=True)
    key, pairs = [], []
    real_idx = [k for k, it in enumerate(items) if it["kind"] == "real"]
    gen_on_a = set(rng.sample(real_idx, len(real_idx) // 2 + rng.randint(0, len(real_idx) % 2)))   # sides balanced
    for k, it in enumerate(items, 1):
        pid = f"P{k:02d}"
        sides = list(it["files"].items())
        if it["kind"] == "real":
            sides.sort(key=lambda kv: (kv[0] != "generated") if (k - 1) in gen_on_a else (kv[0] == "generated"))
        else:
            rng.shuffle(sides)
        for (label, f), side in zip(sides, "AB"):
            render(f, kit / "img" / f"{pid}-{side}.jpg")
        key.append({"pair": pid, "kind": it["kind"], "page": it["page"], "A": sides[0][0], "B": sides[1][0]})
        pairs.append(pid)
        print(pid, "rendered")
    src.mkdir(parents=True, exist_ok=True)
    (src / "key.json").write_text(json.dumps({"review": review, "seed": seed, "dpi": DPI, "pairs": key}, indent=1) + "\n")
    (src / "key.json").chmod(0o600)
    html = PAGE.replace("__PAIRS__", json.dumps(pairs)).replace("__REVIEW__", review)
    (kit / "index.html").write_text(html, encoding="utf-8")
    (kit / "README.txt").write_text(README, encoding="utf-8")
    print(f"kit: {kit} ({len(pairs)} pairs); key: {src / 'key.json'}")


README = """Pageinator page review / पान पुनरावलोकन

1. Open index.html in Google Chrome (double-click; no internet needed).
   index.html हे Google Chrome मध्ये उघडा (डबल-क्लिक करा; इंटरनेटची गरज नाही).
2. Follow the instructions on the screen. / पडद्यावरील सूचनांप्रमाणे करा.
3. At the end press "Download answers" and send the downloaded file back by WhatsApp or email.
   शेवटी "उत्तरे डाउनलोड करा" दाबा आणि डाउनलोड झालेली फाइल WhatsApp किंवा ईमेलने परत पाठवा.
"""

PAGE = r"""<!doctype html>
<html lang="mr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Page Review</title>
<style>
:root { --bg:#f6f5f2; --ink:#1d1d1b; --muted:#6b6a66; --line:#d9d6cf; --card:#ffffff; --accent:#1f5f8b; --accent-ink:#ffffff; --pick:#e8f1f8; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 system-ui, -apple-system, "Segoe UI", "Noto Sans Devanagari", sans-serif; }
header { position:sticky; top:0; z-index:5; background:var(--card); border-bottom:1px solid var(--line); padding:10px 16px; display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
header .t { font-weight:700; }
header .prog { color:var(--muted); }
header .sp { flex:1; }
button { font:inherit; padding:8px 14px; border-radius:8px; border:1px solid var(--line); background:var(--card); color:var(--ink); cursor:pointer; }
button.primary { background:var(--accent); color:var(--accent-ink); border-color:var(--accent); }
button:disabled { opacity:.4; cursor:default; }
main { max-width:1400px; margin:0 auto; padding:16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; margin-bottom:16px; }
.en { color:var(--muted); font-size:.92em; }
.pages { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
.pages figure { margin:0; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:8px; }
.pages figcaption { font-weight:700; font-size:1.3em; text-align:center; padding:4px 0 8px; }
.pages img { width:100%; height:auto; display:block; cursor:zoom-in; border:1px solid var(--line); }
.q { margin:14px 0 6px; font-weight:600; }
.choices { display:flex; gap:10px; flex-wrap:wrap; }
.choices label { border:1px solid var(--line); border-radius:8px; padding:8px 14px; cursor:pointer; background:var(--card); }
.choices input { margin-right:6px; }
.choices label.on { background:var(--pick); border-color:var(--accent); }
textarea { width:100%; min-height:110px; font:inherit; padding:8px; border:1px solid var(--line); border-radius:8px; }
.nav { display:flex; gap:10px; justify-content:space-between; margin-top:14px; flex-wrap:wrap; }
.note { color:var(--muted); font-size:.9em; }
input[type=text] { font:inherit; padding:8px; border:1px solid var(--line); border-radius:8px; width:min(420px,100%); }
#zoom { position:fixed; inset:0; background:rgba(0,0,0,.92); display:none; z-index:20; overflow:auto; }
#zoom img { display:block; width:200%; max-width:none; cursor:zoom-out; }
#zoom .bar { position:fixed; top:10px; right:16px; display:flex; gap:8px; z-index:21; }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(70px,1fr)); gap:6px; }
.grid button { padding:6px; }
.grid button.done { background:var(--pick); border-color:var(--accent); }
@media (max-width: 800px) { .pages { grid-template-columns:1fr; } }
</style>
</head>
<body>
<header>
  <span class="t">पान पुनरावलोकन <span class="en">/ Page review</span></span>
  <span class="prog" id="prog"></span>
  <span class="sp"></span>
  <button id="dl1">उत्तरे डाउनलोड करा <span class="en">/ Download answers</span></button>
</header>
<main id="app"></main>
<div id="zoom"><div class="bar"><button id="zin">+</button><button id="zout">−</button><button id="zclose">✕</button></div><img id="zimg" alt=""></div>
<script>
const PAIRS = __PAIRS__;
const KEY = "pageinator-__REVIEW__";
let S = { name: "", started: null, answers: {} };
let cur = -1, zoomW = 200;
// answers are kept per reviewer name, so two people can use the same laptop
const store = {
  all() { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } },
  load(name) { const a = store.all(); S = a[name] || { name: name, started: null, answers: {} }; },
  save() { if (!S.name) return; try { const a = store.all(); a[S.name] = S; localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
};
function esc(t) { return String(t).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c])); }
function done(p) { const a = S.answers[p]; return a && a.pick; }
function prog() { const n = PAIRS.filter(done).length; document.getElementById("prog").textContent = n + " / " + PAIRS.length + " पूर्ण (done)"; }
function download() {
  const blob = new Blob([JSON.stringify({ review: "__REVIEW__", name: S.name, started: S.started, saved: new Date().toISOString(), answers: S.answers }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "answers-" + (S.name || "reviewer").replace(/[^\wऀ-ॿ-]+/g, "_") + ".json";
  document.body.appendChild(a); a.click(); a.remove();
}
document.getElementById("dl1").onclick = download;
function start() {
  const app = document.getElementById("app");
  app.innerHTML = `
  <div class="card">
    <h2>नमस्कार <span class="en">/ Welcome</span></h2>
    <p>प्रत्येक जोडीत <b>एकाच पानाच्या दोन मांडण्या</b> (लेआउट) आहेत: पान A आणि पान B. दोन्हींमध्ये बातम्या, फोटो आणि जाहिराती सारख्याच आहेत; फक्त मांडणी वेगळी आहे.<br>
    <span class="en">Each pair shows two layouts of the same page, A and B. The stories, photos and ads are the same; only the layout differs.</span></p>
    <p>अक्षरांचा फॉन्ट <b>तात्पुरता</b> आहे आणि दोन्ही पानांवर सारखाच आहे — फॉन्टकडे लक्ष देऊ नका, फक्त <b>मांडणी</b> पाहा: बातम्या कुठे आहेत, मथळे, फोटो, जागा, वाचायला सोपे आहे का.<br>
    <span class="en">The typeface is temporary and the same on both pages. Please ignore it and judge only the layout: where stories sit, headlines, photos, spacing, ease of reading.</span></p>
    <p>लोगो आणि काही चिन्हांच्या जागी राखाडी चौकटी दिसू शकतात — त्याकडेही दुर्लक्ष करा.<br>
    <span class="en">Grey boxes may stand in for logos and small symbols. Please ignore them too.</span></p>
    <p>चित्रावर क्लिक करून ते मोठे करून पाहा. <span class="en">Click a page to enlarge it.</span></p>
    <p>तुमची उत्तरे आपोआप जतन होतात; तुम्ही कधीही थांबून नंतर पुढे करू शकता. शेवटी <b>"उत्तरे डाउनलोड करा"</b> दाबा आणि ती फाइल WhatsApp किंवा ईमेलने पाठवा.<br>
    <span class="en">Your answers are saved as you go; you can stop and continue later. At the end press "Download answers" and send the file by WhatsApp or email.</span></p>
    <p class="q">तुमचे नाव <span class="en">/ Your name</span></p>
    <input type="text" id="nm" value="${esc(S.name)}">
    <div class="nav"><span></span><button class="primary" id="go">सुरू करा <span class="en">/ Start</span></button></div>
  </div>
  <div class="card"><p class="q">जोड्या <span class="en">/ Pairs</span></p><div class="grid">${PAIRS.map((p, i) => `<button class="${done(p) ? "done" : ""}" data-i="${i}">${i + 1}</button>`).join("")}</div></div>`;
  document.getElementById("go").onclick = () => {
    const nm = document.getElementById("nm").value.trim();
    if (!nm) { alert("कृपया तुमचे नाव लिहा / Please enter your name"); return; }
    if (nm !== S.name) store.load(nm);
    if (!S.started) S.started = new Date().toISOString();
    store.save();
    const first = PAIRS.findIndex(p => !done(p));
    show(first < 0 ? 0 : first);
  };
  app.querySelectorAll(".grid button").forEach(b => b.onclick = () => {
    const nm = document.getElementById("nm").value.trim();
    if (!nm) { alert("कृपया तुमचे नाव लिहा / Please enter your name"); return; }
    if (nm !== S.name) store.load(nm);
    store.save(); show(+b.dataset.i);
  });
  prog();
}
function show(i) {
  cur = i;
  const p = PAIRS[i], a = S.answers[p] || {};
  const opts = [["A", "पान A", "Page A"], ["B", "पान B", "Page B"], ["both", "दोन्ही चालतील", "Both are fine"], ["neither", "एकही नाही", "Neither"]];
  const app = document.getElementById("app");
  app.innerHTML = `
  <div class="card"><b>जोडी ${i + 1} / ${PAIRS.length}</b> <span class="en">Pair ${i + 1} of ${PAIRS.length}</span></div>
  <div class="pages">
    <figure><figcaption>A</figcaption><img src="img/${p}-A.jpg" alt="Page A" data-src="img/${p}-A.jpg"></figure>
    <figure><figcaption>B</figcaption><img src="img/${p}-B.jpg" alt="Page B" data-src="img/${p}-B.jpg"></figure>
  </div>
  <div class="card">
    <p class="q">१. तुम्ही कोणते पान छापाल? <span class="en">Which page would you print?</span></p>
    <div class="choices">${opts.map(([v, m, e]) => `<label class="${a.pick === v ? "on" : ""}"><input type="radio" name="pick" value="${v}" ${a.pick === v ? "checked" : ""}>${m} <span class="en">/ ${e}</span></label>`).join("")}</div>
    <p class="q">२. पान A मध्ये तुम्ही काय बदलाल? <span class="en">What would you change on page A?</span></p>
    <textarea id="cA">${esc(a.changeA || "")}</textarea>
    <p class="q">३. पान B मध्ये तुम्ही काय बदलाल? <span class="en">What would you change on page B?</span></p>
    <textarea id="cB">${esc(a.changeB || "")}</textarea>
    <p class="note">उत्तरे आपोआप जतन होतात. <span class="en">Answers save automatically.</span></p>
    <div class="nav">
      <button id="prev" ${i === 0 ? "disabled" : ""}>← मागे <span class="en">/ Back</span></button>
      <button id="home">सर्व जोड्या <span class="en">/ All pairs</span></button>
      ${i < PAIRS.length - 1 ? `<button class="primary" id="next">पुढे → <span class="en">/ Next</span></button>`
                             : `<button class="primary" id="fin">पूर्ण <span class="en">/ Finish</span></button>`}
    </div>
  </div>`;
  const rec = () => {
    const pk = app.querySelector("input[name=pick]:checked");
    S.answers[p] = { pick: pk ? pk.value : (a.pick || null), changeA: document.getElementById("cA").value, changeB: document.getElementById("cB").value, at: new Date().toISOString() };
    store.save(); prog();
  };
  app.querySelectorAll("input[name=pick]").forEach(r => r.onchange = () => { app.querySelectorAll(".choices label").forEach(l => l.classList.toggle("on", l.querySelector("input").checked)); rec(); });
  ["cA", "cB"].forEach(id => document.getElementById(id).oninput = rec);
  app.querySelectorAll(".pages img").forEach(im => im.onclick = () => openZoom(im.dataset.src));
  const nav = j => { rec(); show(j); window.scrollTo(0, 0); };
  document.getElementById("prev").onclick = () => nav(i - 1);
  document.getElementById("home").onclick = () => { rec(); start(); window.scrollTo(0, 0); };
  const nx = document.getElementById("next");
  if (nx) nx.onclick = () => { if (!app.querySelector("input[name=pick]:checked")) { alert("कृपया एक पर्याय निवडा / Please choose an option"); return; } nav(i + 1); };
  const fn = document.getElementById("fin");
  if (fn) fn.onclick = () => { rec(); finish(); };
  prog();
}
function finish() {
  const left = PAIRS.map((p, i) => done(p) ? null : i + 1).filter(Boolean);
  document.getElementById("app").innerHTML = `
  <div class="card">
    <h2>धन्यवाद! <span class="en">/ Thank you!</span></h2>
    ${left.length ? `<p>अजून बाकी जोड्या: ${left.join(", ")} <span class="en">/ Pairs still open: ${left.join(", ")}</span></p>` : ""}
    <p>खालील बटण दाबा आणि डाउनलोड झालेली फाइल WhatsApp किंवा ईमेलने पाठवा.<br><span class="en">Press the button below and send the downloaded file by WhatsApp or email.</span></p>
    <div class="nav"><button id="back2">← मागे <span class="en">/ Back</span></button><button class="primary" id="dl2">उत्तरे डाउनलोड करा <span class="en">/ Download answers</span></button></div>
  </div>`;
  document.getElementById("dl2").onclick = download;
  document.getElementById("back2").onclick = () => start();
}
function openZoom(src) {
  const z = document.getElementById("zoom"), im = document.getElementById("zimg");
  im.src = src; im.style.width = zoomW + "%"; z.style.display = "block"; z.scrollTo(0, 0);
}
document.getElementById("zimg").onclick = () => document.getElementById("zoom").style.display = "none";
document.getElementById("zclose").onclick = () => document.getElementById("zoom").style.display = "none";
document.getElementById("zin").onclick = () => { zoomW = Math.min(400, zoomW + 50); document.getElementById("zimg").style.width = zoomW + "%"; };
document.getElementById("zout").onclick = () => { zoomW = Math.max(100, zoomW - 50); document.getElementById("zimg").style.width = zoomW + "%"; };
document.addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("zoom").style.display = "none"; });
start();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    main()
