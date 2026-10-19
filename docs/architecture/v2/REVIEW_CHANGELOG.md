# Architecture v2: Review Change Log

## 2026-10-07: Second-pass critical review (revision 1 → revision 2)

### Method
- **Full re-read.** All 15 documents and 16 ADRs were re-read.
- **Audit claims re-checked against source.**
  - Codebase A: `text_impl.cpp`, `pdf_exporter.cpp`.
  - Codebase B: `typeset/*.py`, tests.
- **Tests executed.** B's typesetting tests were run read-only: **182 passed**. B's git status was unchanged afterwards.
- **Benchmark.** A micro-benchmark of B's engine ran in the scratchpad. Nothing was written to any repository.
- **External facts verified by web search:**
  - veraPDF scope;
  - PDFBox preflight scope;
  - HarfRust status;
  - WAN-IFRAnewspaper26v5 TIC;
  - DPDP Rules and the missing journalism exemption;
  - Better Auth CVEs;
  - Skia PDF CMYK;
  - callas and PitStop availability and pricing;
  - pdf-lib forks;
  - legacy Shree-Lipi usage;
  - typical newspaper ad specs.

### Changes

| # | Change | Why | Evidence |
|---|---|---|---|
| 1 | ADR-002 **superseded** by ADR-017: single authoritative kernel; client composition must prove it is needed | Preview = PDF is satisfied by construction with one resolver. Removes a premature port, cross-engine determinism risk and font-binary delivery | B's engine runs (182/182); about 1 ms/paragraph measured; font EULA analysis (`19`) |
| 2 | ADR-001 kernel and backend language → **EXPERIMENTAL**; EXP-ENGINE pre-registered | No evidence existed for TypeScript as kernel language | `16` §1 |
| 3 | "B's K-P is correct" refined to "**correct algorithm, no viable newspaper justification policy**" | Measured 0/240 synthetic paragraphs feasible under default spacing at 30–60 mm. Traced a genuine infeasibility (6.9 mm needed vs 0.41 mm available) | Scratchpad benchmark (`16` §0) |
| 4 | Phase plan P0–P5 replaced by **gates G0–G7** (ADR-018) | Revision 1 put SaaS breadth before the first printed page | `13` r2 |
| 5 | **TAC ~240% → from the press**; the 26v5 default is 220% | Factual correction | WAN-IFRA 26v5 sources |
| 6 | TrueType-only MVP → **PROVE** | Typical ad specs forbid TrueType; the press's RIP must confirm | Ad specification sources; `17` F2 |
| 7 | Better Auth → **PROPOSED** with mandatory hardening | CVE-2026-53514 (default-config invitation) and CVE-2026-53515 | NVD / GitLab advisories |
| 8 | DPDP archive and bylines → **legal unknown** | The Act and Rules have no journalism exemption; the Editors Guild has sought clarification | SFLC; news reports |
| 9 | Skia PDF backend recorded as **unusable** for press | CMYK was removed from Skia PDF | pdfium/skia sources |
| 10 | Font rights model + four preview modes (ADR-019, `19` §1) | Desktop EULAs may forbid server use or web delivery; revision 1 had two sentences | Analysis; counsel L2 pending |
| 11 | Legacy Marathi conversion pipeline (`19` §2) | Adoption risk for existing papers (Shree-Lipi/Shree Dev in wide use) | Web sources; P0-12 to confirm |
| 12 | AI-independent production + degraded modes + emergency package (ADR-020) | Deadline-night reality; server-kernel availability coupling | `15` §12 |
| 13 | Commercial preflight strategy matched to the press's own profile (ADR-022) | No open-source PDF/X validator; late press rejections are the worst outcome | `18` §2 |
| 14 | Decision status discipline (ADR-021); "DECIDED" retired | Revision 1 marked hypotheses as settled | — |
| 15 | Generation: top-5 / beam 24 → parameters; AI out of the search loop; depth curves + finalists; front page manual until G6 | Numbers had no source; AI in the loop breaks determinism and cost | `15` §6 |
| 16 | Parity test → three levels (structural / draw log / raster); SSIM threshold removed | An arbitrary threshold cannot tell a layout mismatch from rasterisation noise | `12` §6 |
| 17 | Press-accepted fixtures as permanent regression assets with a revalidation policy | Prevents silent breakage of accepted output | `12` §7 |
| 18 | E-paper → after G4 (ADR-011's DF05 revision withdrawn) | Must not compete with the press milestones | — |
| 19 | Archive staged: G2–G4 hash manifest → G5 package → G7 tiers | Must not threaten the first press milestone | — |
| 20 | AWS/ECS/OpenTofu → hypothesis/detail; India region → decision | Over-specified for the current stage; residency is a commercial expectation, not a proven legal requirement | DPDP cross-border provisions; counsel L5 |
| 21 | Postgres queue: thresholds for a dedicated broker defined | Was asserted without limits | `15` §8 |
| 22 | Tenancy proof tests specified (catalog meta-test, per table, per endpoint, storage, jobs, search, export) | Principle needed falsifiable tests | `15` §8 |
| 23 | Security threats re-ranked for Pageinator-specific risks (unpublished leakage, embargo, ad PDFs, fonts, press-output tampering) | Revision 1 was generic STRIDE | `15` §10 |
| 24 | Phase 0 rewritten as an evidence phase (16 tasks with dependencies); TS port tasks deferred or conditional | Revision 1's list was mostly porting | `16` §7 |
| 25 | Press questionnaire, licence register, PDF capability map, MCP/tool least-privilege review added | Missing deliverables | `17`, `18` |
| 26 | Agent safeguards: task card, plan-to-commit flow, PR size limits, evidence-attached PRs, verify external claims | The previous process let implementation outrun validation | `14` §12–16 |
| 27 | Current-repo test triage (keep / consolidate / rewrite / remove) | No target count; value hierarchy | `15` §11 |
| 28 | UI work boundary by gate | Avoid UI ahead of engine evidence | `15` §14, `13` |

### Preserved, not rewritten
- ADR-001 to ADR-016 keep their original text below dated post-review status blocks.
- Docs 01–12 keep their revision-1 bodies under review banners. Inline fixes are marked "Revised 2026-10-07".
- Doc 13 was rewritten, with revision 1 summarised in its appendix.
- Doc 14's original Phase 0 list is kept, marked as superseded.
