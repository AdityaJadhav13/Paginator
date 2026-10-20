"""G-HEAD: the EXP-HEAD-1 headline composer on fictional headlines (EVIDENCE TOOLING).

experiments/phase0/head1/headliner.py (head1/1.3.1) breaks headlines without hyphenation, keeps words together by its
HARD and STRONG rules, scores layouts (balance or fill) with soft penalties, and copyfits. Its tuned inputs (the c7 word
pairs and line-end penalties) are derived from the pilot's print and stay private; here the default policy and its
variants run on the corpus headlines and on fictional headlines written to reach every rule (honorifics, initials,
numbers with units and multiplier chains, ranges, dates and times, quotes, spaced dashes, coordinators, auxiliaries,
postpositions, determiners, genitives, end punctuation), with two synthetic word pairs standing in for c7. Recorded:
  headline/policies.json      every HeadPolicy (typed tree)
  headline/links.jsonl.gz     links(text) and glue(text) with STRONG and HARD-only rules, with and without the pairs
  headline/compose.jsonl.gz   compose(): the glued text, lines, widths, fit, cost, penalties, layout count, rule hits,
                              relaxation, broken STRONG links; the five best ranked layouts for the default policy;
                              forced line counts; copyfit() between 18 and 60 pt, with and without page1's anchor
"""
from __future__ import annotations

import sys
from dataclasses import asdict

from golden import EXPERIMENTS, GOLDENS, REPO, Out, cli, ensure_public, environment, fhex, typed

sys.path.insert(0, str(EXPERIMENTS / "head1"))
import headliner as H  # noqa: E402  (installs the compose2 font registry, as head1 does)

import common as C  # noqa: E402

COL, GUTTER = 36.5, 4.19                                        # the house grid (docs/product: 8 × 36.5 mm, 4.19 mm)
SPANS = (2, 3, 4, 6)
FONT_SIZES = [  # (family, axes, weight, size): page1 sets display type in Noto Sans Devanagari, width axis first
    ("Noto Sans Devanagari", {"wght": 700.0}, 700, 36.0),
    ("Noto Sans Devanagari", {"wght": 700.0, "wdth": 87.5}, 700, 48.0),
    ("Noto Sans Devanagari", {"wght": 800.0, "wdth": 75.0}, 800, 24.0),
]
PAIRS = frozenset({("पाणीपुरवठा", "योजनेला"), ("वाहतूक", "कोंडी")})
END_PEN = (("शहरात", 0.08), ("कामाला", 0.05))
FICTIONAL = [
    "शहरात पावसाचा जोर वाढला – नदीकाठच्या गावांना सतर्कतेचा इशारा",
    "पाणीपुरवठा योजनेला मंजुरी : कामाला पुढील महिन्यात सुरुवात",
    "शाळांच्या निकालात मुलींची आघाडी; जिल्ह्याचा निकाल ९४ टक्के",
    "“रस्ते दुरुस्ती लवकरच पूर्ण करू” – महापौरांचे आश्वासन",
    "बाजार समितीत कांद्याचे दर (प्रति क्विंटल) पुन्हा घसरले",
    "भाग- दोन : जुन्या वाड्यांचे जतन कसे करावे",
    "डॉ. अनिता देशपांडे यांना राज्यस्तरीय शिक्षक पुरस्कार",
    "श्री. रमेश कुलकर्णी यांची सहकारी बँकेच्या अध्यक्षपदी निवड",
    "व्ही. के. सावंत यांचे रविवारी विज्ञानावर व्याख्यान",
    "प्रा. सुनील गायकवाड यांचे विज्ञान प्रदर्शनात मार्गदर्शन",
    "महापालिकेचा ५० हजार कोटी रुपयांचा अर्थसंकल्प सादर",
    "शेतकऱ्यांना १२ लाख रुपयांची मदत जाहीर",
    "₹ ५०० च्या नोटांचा तुटवडा नाही : बँकेचा खुलासा",
    "तापमान ४२ अंश सेल्सिअसवर; उष्णतेची लाट कायम",
    "१० ते २० जून दरम्यान जोरदार पावसाचा अंदाज",
    "२५-३० किलोमीटरचा प्रवास आता अर्ध्या तासात",
    "३ तासांच्या चर्चेनंतर संपावर तोडगा",
    "दि. १२ नोव्हेंबर २०२६ पासून नवे वेळापत्रक लागू",
    "सायं. ६ वाजता शहरात दिवाळी पहाट कार्यक्रम",
    "मार्च २०२७ पर्यंत पूल वाहतुकीसाठी खुला होणार",
    "शहरातील रस्ते आणि पदपथ यांच्या दुरुस्तीचे काम सुरू",
    "नवीन धोरणामुळे लघुउद्योगांना दिलासा मिळणार नाही",
    "जिल्ह्यात सर्व शाळा सोमवारपासून पुन्हा सुरू होणार आहेत",
    "या वर्षी ऊस उत्पादनात वाढ होण्याची शक्यता",
    "क्रीडा स्पर्धेत गावच्या संघाची चमकदार कामगिरी",
    "“आम्ही हरणार नाही” असे कर्णधाराने सांगितले",
    "पाऊस",
    "शहर, गाव आणि वाडी — सर्वत्र स्वच्छता मोहीम",
    "उड्डाणपुलाच्या कामामुळे वाहतूक कोंडी वाढली; पर्यायी मार्ग खुले",
    "विद्यार्थ्यांसाठी मोफत बस प्रवास योजना पुन्हा सुरू करण्याची मागणी",
    "नदीकाठच्या गावात पूर",
    "शहर पाणीपुरवठा योजनेचे काम अंतिम टप्प्यात",
    "ग्रामपंचायत निवडणुकीसाठी आज मतदान; १,२५० उमेदवार रिंगणात",
    "आरोग्य शिबिरात ३०० हून अधिक रुग्णांची तपासणी",
    "खेळाडू सचिन मोरे याची राष्ट्रीय संघात निवड",
    "ऑनलाइन फसवणुकीपासून सावध राहा : पोलिसांचे आवाहन",
    "पुण्यात ‘हरित शहर’ उपक्रमाला सुरुवात",
    "शेतमालाला हमीभाव मिळावा म्हणून शेतकऱ्यांचे आंदोलन",
    "अ‍ॅड. मीना शिंदे यांची सरकारी वकील म्हणून नियुक्ती",
    "राज्य सरकारच्या नव्या शैक्षणिक धोरणानुसार जिल्ह्यातील सर्व माध्यमिक शाळांमध्ये पुढील वर्षापासून मराठी विषय अनिवार्य",
    "आय. टी. पार्कमध्ये नव्या कंपन्यांची गुंतवणूक",
    "ता. ५ रोजी शहराचा पाणीपुरवठा बंद",
    "स. १० वाजता परीक्षेला सुरुवात",
    "बस स्थानकावर प्रवाशांची गर्दी, जादा गाड्या सोडणार",
]


def span(n: int) -> float:
    return round(n * COL + (n - 1) * GUTTER, 2)


def policies() -> list:
    P = H.HeadPolicy
    return [P(), P(name="HEAD_fill", shape="fill"), P(name="HEAD_greedy", balance=False),
            P(name="HEAD_no_glue", glue=False), P(name="HEAD_pairs", extra_glue_pairs=PAIRS, word_end_pen=END_PEN),
            P(name="HEAD_s10", weights=H.Weights(s10_first_shorter=0.05))]


def policy_tree(pol) -> list:
    d = asdict(pol)
    d["extra_glue_pairs"] = sorted(list(p) for p in pol.extra_glue_pairs)   # a frozenset: given sorted
    return typed(d)


def result_dump(r) -> dict:
    if r is None:
        return {"none": True}
    return {"text_glued": r.text_glued, "size_pt_hex": fhex(r.size_pt), "measure_mm_hex": fhex(r.measure_mm),
            "lines": [list(x) for x in r.lines], "widths_mm_hex": [fhex(w) for w in r.widths_mm], "fits": r.fits,
            "cost_hex": fhex(r.cost), "penalties_hex": {k: fhex(v) for k, v in sorted(r.penalties.items())},
            "n_layouts": r.n_layouts, "hits": r.hits, "relaxed": r.relaxed, "broken_strong": r.broken_strong}


def main(root=REPO) -> dict:
    ensure_public()
    out = Out(root)
    corpus = [t["text"] for t in C.load_corpus() if t["kind"] == "headline" and t["script"] == "Deva"]
    texts = list(dict.fromkeys(corpus + FICTIONAL))
    pols = policies()
    links = []
    for text in texts:
        links.append({"text": text,
                      "links": H.links(text), "links_pairs": H.links(text, PAIRS),
                      "glue_strong": H.glue(text), "glue_hard": H.glue(text, strong=False),
                      "glue_pairs": H.glue(text, PAIRS)})
    records = []
    default, fill = pols[0], pols[1]
    for text in texts:
        for fi, (family, axes, weight, size) in enumerate(FONT_SIZES):
            for n in SPANS:
                m = span(n)
                for pol in pols if fi == 0 else (default, fill):
                    r = H.compose(text, family, axes, weight, size, m, pol)
                    records.append({"kind": "compose", "text": text, "font": [family, axes, weight],
                                    "size_pt_hex": fhex(size), "measure_mm_hex": fhex(m), "policy": pol.name,
                                    "expected": result_dump(r)})
        family, axes, weight, size = FONT_SIZES[0]
        m = span(3)
        r = H.compose(text, family, axes, weight, size, m, default)
        if r.p is not None and r.fits:
            widths, spaces, wtexts = H._words(r.p)  # noqa: SLF001  (the composer's own word list)
            ranked = H.ranked_layouts(widths, spaces, wtexts, m, default, len(r.lines))[:5]
            records.append({"kind": "ranked", "text": text, "font": [family, axes, weight], "size_pt_hex": fhex(size),
                            "measure_mm_hex": fhex(m), "policy": default.name, "lines": len(r.lines),
                            "expected": [{"key": typed(list(x[0])), "layout": [list(y) for y in x[1]],
                                          "cost_hex": fhex(x[2]), "hits": x[5]} for x in ranked]})
        for n_lines in (2, 3):
            r = H.compose(text, family, axes, weight, size, m, default, n_lines=n_lines)
            records.append({"kind": "n_lines", "text": text, "font": [family, axes, weight], "size_pt_hex": fhex(size),
                            "measure_mm_hex": fhex(m), "policy": default.name, "n_lines": n_lines,
                            "expected": result_dump(r)})
        for n, max_lines in ((2, 2), (4, 3)):
            m = span(n)
            for anchor in (None, 14.0 + 5.0 * n):              # page1: house headline size ≈ 14 + 5 × columns
                r = H.copyfit(text, family, axes, weight, m, 18.0, 60.0, max_lines, policy=fill, anchor=anchor)
                records.append({"kind": "copyfit", "text": text, "font": [family, axes, weight],
                                "measure_mm_hex": fhex(m), "policy": fill.name, "size_min_hex": fhex(18.0),
                                "size_max_hex": fhex(60.0), "max_lines": max_lines, "step_hex": fhex(0.5),
                                "anchor_hex": None if anchor is None else fhex(anchor), "expected": result_dump(r)})
    out.json(GOLDENS / "headline" / "policies.json", {"schema": "pageinator.golden.head-policies/1",
                                                      "headliner": H.HEADLINER_VERSION,
                                                      "policies": {p.name: policy_tree(p) for p in pols}})
    out.jsonl_gz(GOLDENS / "headline" / "links.jsonl.gz", links)
    out.jsonl_gz(GOLDENS / "headline" / "compose.jsonl.gz", records)
    kinds = {}
    for r in records:
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
    counts = {"headlines": len(texts), "fictional": len(FICTIONAL), "corpus": len(corpus), "policies": len(pols),
              "records": len(records), "by_kind": dict(sorted(kinds.items())),
              "relaxed": sum(r["kind"] == "compose" and r["expected"].get("relaxed", False) for r in records),
              "not_fitting": sum(r["kind"] == "compose" and not r["expected"].get("fits", True) for r in records)}
    out.json(GOLDENS / "headline" / "info.json", {"schema": "pageinator.golden.headline-info/1",
                                                  "headliner": H.HEADLINER_VERSION, "counts": counts,
                                                  "environment": environment()})
    return {"files": out.files, "counts": counts}


if __name__ == "__main__":
    cli(main)
