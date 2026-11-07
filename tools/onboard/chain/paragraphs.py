"""Complete published paragraphs with exact text (EXPERIMENTAL; PILOT DATA STAYS PRIVATE).

For every non-excluded sample and body frame, take each paragraph that STARTS with an indented line and ENDS with a
FINAL_PARAGRAPH_LINE inside the same frame, read its text with actualtext.py, and keep it only if every check passes:
  - each printed line's decoded word count equals the tool's geometric token count (text ↔ geometry agree);
  - no unmapped glyph; no excluded or SPECIAL_CASE line; no line-end hyphen break; ≥ 3 lines;
  - a single font in the paragraph (e.g. no bold dateline run), so one OFL stand-in can replace it.
Writes <dataset>/report/paragraphs.jsonl (private) and prints the exclusion counts.
Usage: .venv/bin/python paragraphs.py <dataset_dir>
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import actualtext as AT


def doc_of(work: Path) -> dict:
    f = work / "corrected.json"
    return json.loads((f if f.exists() else work / "measure.json").read_text())


def main():
    ds = Path(sys.argv[1]).expanduser()
    out = ds / "report" / "paragraphs.jsonl"
    reasons, kept = Counter(), []
    for work in sorted((ds / "work").iterdir()):
        doc = doc_of(work)
        if doc.get("excluded"):
            continue
        man = json.loads((ds / "samples" / work.name / "manifest.json").read_text())
        pdf = next((ds / "samples" / work.name).glob("*.pdf"))
        for pg in doc["pages"]:
            frames = [f for f in pg["frames"] if f["is_body_candidate"] and not f.get("excluded")]
            if not frames:
                continue
            glyphs = AT.page_glyphs(pdf, pg["page"])
            for fr in frames:
                sz = fr["size_pt"]; em_mm = sz / AT.MM
                lines = fr["lines"]
                k = 0
                while k < len(lines):
                    if lines[k]["left_offset_mm"] < 0.5 * em_mm:          # not a paragraph start
                        k += 1; continue
                    j = next((m for m in range(k, len(lines)) if lines[m]["class"] == "FINAL_PARAGRAPH_LINE"), None)
                    if j is None:
                        reasons["runs past frame end"] += 1; break
                    para = lines[k:j + 1]; k = j + 1
                    if len(para) < 3:
                        reasons["< 3 lines"] += 1; continue
                    if any(l.get("excluded") or l["class"] == "SPECIAL_CASE" for l in para):
                        reasons["excluded/special line"] += 1; continue
                    if any(l.get("break") for l in para[:-1]):
                        reasons["line-end hyphen break"] += 1; continue
                    if any(l["left_offset_mm"] >= 0.5 * em_mm for l in para[1:]):
                        reasons["indented line inside paragraph"] += 1; continue
                    dec = [AT.line_text(glyphs, l["baseline_pt"], l["x0_mm"] * AT.MM, l["x1_mm"] * AT.MM, sz) for l in para]
                    if any(d["unmapped"] for d in dec):
                        reasons["unmapped glyph"] += 1; continue
                    if any(len(d["text"].split()) != len(l["tokens"]) for d, l in zip(dec, para)):
                        reasons["text/geometry word mismatch"] += 1; continue
                    fonts = Counter()
                    for d in dec:
                        fonts.update(d["fonts"])
                    if len(fonts) != 1:
                        reasons["mixed fonts"] += 1; continue
                    pl = []
                    for d, l in zip(dec, para):
                        pu = l.get("gap_punct_adjacent") or [False] * len(l["gaps_pt"])
                        pl.append({"text": d["text"], "class": l["class"], "n_words": len(l["tokens"]),
                                   "word_width_pt": round(sum(t["x1"] - t["x0"] for t in l["tokens"]), 4),
                                   "gaps_pt": l["gaps_pt"], "gap_punct_adjacent": pu, "right_slack_mm": l["right_slack_mm"]})
                    kept.append({"id": f"{work.name}:{para[0]['id']}",
                                 "sample": work.name, "edition_date": man["edition_date"], "page": pg["page"], "frame": fr["id"],
                                 "width_mm": fr["width_mm"], "width_confidence": fr["width_confidence"], "size_pt": sz,
                                 "hscale": fr["hscale_median"], "leading_pt": fr["leading_pt"], "nominal_space_pt": fr["nominal_space_pt"],
                                 "font": next(iter(fonts)), "indent_mm": round(para[0]["left_offset_mm"], 3),
                                 "text": " ".join(d["text"] for d in dec), "lines": pl})
                    reasons["kept"] += 1
    with open(out, "w", encoding="utf-8") as fh:
        for p in kept:
            fh.write(json.dumps(p, ensure_ascii=False) + "\n")
    out.chmod(0o600)
    print(json.dumps(dict(reasons), indent=1, ensure_ascii=False))
    print("paragraphs kept:", len(kept), "lines:", sum(len(p["lines"]) for p in kept), "→", out)


if __name__ == "__main__":
    main()
