# Preflight research — Phase 7

Research date: 2026-09-15. Input: [PDF/prepress research](PDF_PREPRESS_RESEARCH.md), read from disk. Recommendation: HYBRID — BUILD deterministic Pageinator domain checks and user guidance; BUY/WRAP professional final-PDF inspection subject to evaluation and SaaS/OEM terms.

## Two distinct validation stages

Source-model checks can identify overset, missing story ranges, wrong ad reservations or stale revisions that a PDF checker cannot infer. Final-file checks must inspect the actual candidate PDF after all export/conversion operations. A source-model pass cannot certify PDF/X, embedding or final colour behavior. Conversely, a compliant PDF can omit a story or violate an ad contract.

| Check | Pageinator owns | Mature engine / external validation |
|---|---|---|
| Missing content/assets/fonts, source rights | Reference integrity, usage policy, approved revision | Font technical embedding flags can assist; legal rights remain separately recorded |
| Overset and missing glyphs | Logical range coverage, shaping diagnostics, unresolved frames | PDF alone cannot reliably reveal text omitted upstream |
| Frame geometry, illegal overlaps, ad reservations | Typed rules using resolved physical geometry | Cross-check resulting page bounds and placements |
| Effective image PPI | Crop/transform-aware resolution against profile | Inspect actual embedded images/transforms in final file |
| Page boxes/count/order | Edition and profile constraints | Final PDF box/structure validation |
| Fonts/subsets, colour spaces, output intents, spot/overprint/transparency | Declare permitted policy and adapter diagnostics | Professional final-file preflight strongly recommended |
| PDF/X conformance, damaged/unsupported structures | Treat profile as explicit required check | Professional engine and press workflow validation |
| Newspaper visual quality, editorial truth, actual press acceptance | Human approval and recorded evidence | Qualified newsroom/prepress/press operators; not solely machine checks |

## Candidate findings

callas pdfToolbox provides desktop, server/CLI and SDK paths and profile-based checks/corrections, including PDF/X and industry specifications. It is the leading evaluation candidate for a headless adapter, conditional on platform support, concurrency/OEM pricing and diagnostic mapping. Do not confuse a desktop seat with a SaaS redistribution license. [Product](https://callassoftware.com/products/pdftoolbox/), [integration options](https://help.callassoftware.com/m/110901/l/1552422-what-exactly-is-pdftoolbox).

Enfocus PitStop Server is a serious automated preflight/correction alternative, especially where a pilot press already uses its profiles. Confirm supported deployment OS, automation interface, isolation and license scope with the vendor. PitStop Pro is a desktop/plugin review tool, not an assumed backend SDK. [PitStop Server](https://www.enfocus.com/en/pitstop-server), [PitStop Pro](https://www.enfocus.com/en/pitstop-pro).

qpdf is useful structural support but not comprehensive professional preflight. veraPDF focuses on PDF/A and PDF/UA; it must not be described as a PDF/X validator. Ghostscript rendering/conversion and visual comparisons can reveal issues but do not replace a profile-aware preflight system. [qpdf](https://qpdf.readthedocs.io/en/stable/overview.html), [veraPDF scope](https://verapdf.org/), [Ghostscript](https://ghostscript.com/about/).

Independent specifications/test material can strengthen evaluation: PDFX-ready and Ghent Workgroup resources are candidates, with fixture/license terms checked before reuse. No test suites were downloaded into this repository. [PDFX-ready](https://www.pdfx-ready.ch/), [Ghent Workgroup](https://gwg.org/).

## Domain-owned UX and report contract

Every result includes rule ID/version, source (internal/external), severity, pass/fail/not-run/error, page/frame/asset references where available, measured and allowed values, profile version, input revision, PDF digest and engine identity. Keep raw vendor report for provenance; map known findings to stable user categories without hiding unmapped errors. The UI groups Typography, Images, Colour, Layout, Advertisements and Print; each issue offers a location and permitted corrective action.

“Ready for print” means the exact release candidate passed all mandatory checks for the specified press profile and has required approvals. Missing engine results, timeouts, malformed reports and expired licenses are errors, never green checks. Advisory warnings can require acknowledgment under profile policy. Mandatory failures cannot be waived merely by role or AI advice. Changing policy creates a newly approved profile and rerun, not a silent bypass.

Fixups are off by default in the automated validation path. If approved conversion/repair changes bytes, save a new candidate, regenerate the proof as needed, show material differences, and rerun all final checks. Bind the human approval to the new hash. Maintain last known good released bytes separately.

## Procurement and feasibility gate

Provide each vendor the same expected workload and corpus: fonts/ligatures, Urdu and Devanagari, image PPI/crop, invalid output intents, spot/overprint/white-overprint, transparency, page boxes, corrupted and hostile PDFs, imported ads. Evaluate false negatives/positives, machine-readable reporting, cancellation/timeouts, offline/DR behavior, profile portability, tenant isolation and cost at burst load. Record supported exact versions and maximum licensed concurrency.

Exit requires detection of all deliberately seeded blocking defects, acceptable false-positive review, one approved press profile and operational/legal approval of the chosen engine. Vendor prices, licenses and trials were not obtained here. If commercial procurement fails, narrow supported output and obtain a documented equivalent validation route; do not relabel a partial open-source checker as comprehensive preflight.
