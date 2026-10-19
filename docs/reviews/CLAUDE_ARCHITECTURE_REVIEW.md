# Independent second-architect review — Pageinator

Reviewer role: second independent principal product + software architect.
Review date: 2026-09-16.
Subject: the 24-phase pre-implementation architecture and research program produced by the first architect ("Astra"), as recorded in `docs/MASTER_BUILD_SPEC.md`, `docs/architecture/`, `docs/research/`, `docs/IMPLEMENTATION_ROADMAP.md` and `specs/INITIAL_IMPLEMENTATION_BACKLOG.md`.

Status of this document: review only. No implementation is proposed, authorized or performed. No file other than this one was modified.

---

## 0. Method, scope and independence statement

**Primary targets read in full:** `docs/MASTER_BUILD_SPEC.md`, `docs/architecture/DECISION_REGISTER.md`, `docs/architecture/PRODUCT_OWNER_QUESTIONS.md`, `docs/reviews/ASTRA_ARCHITECTURE_REVIEW.md`, `docs/IMPLEMENTATION_ROADMAP.md`, `specs/INITIAL_IMPLEMENTATION_BACKLOG.md`.

**Supporting artifacts read in full where required to verify or challenge a claim:** Phase 1 (requirements analysis), Phase 2 (system architecture), Phase 3 (publishing engine), Phase 11 (data/revision/archive), Phase 12 (security/tenancy), Phase 13 (AI architecture), Phase 14 (testing/validation), Phase 15 (UI-first), Phase 16 (repository/development), Phase 17 (risk register); and the research set: typography, browser editor, PDF/prepress, preflight, image/colour, news intelligence, dependency candidates.

**Original product context consulted selectively** (`docs/context/ORIGINAL_PRODUCT_CONTEXT.md`, 2550 lines): sections 1–3 (customer, users, problem), 7–9 (strategic IP, differentiation, scope), 21–24 (editor, AI, images, workflow), 27–31 (archive, retrieval, search), 55–61 (output priorities, phased roadmap, immediate UI priorities). The purpose of consulting it was strictly fidelity checking: omission, distortion, invention, misclassification, contradiction.

**Independent external verification performed:** one. The `news-please` package metadata was re-verified directly against the PyPI JSON API rather than accepted from Astra's recorded observation. Result reported in M03. No other third-party claim in the corpus was independently re-verified; where I could not verify, I say so rather than assert.

**Independence posture:** I did not attempt to agree or disagree with Astra as a target. Where Astra is right I say so explicitly (Section B, which is long, because Astra is right about a great deal). Where Astra is wrong I state precisely why and what the correction is. Where the evidence in the corpus is insufficient to decide, I classify the item unresolved rather than manufacture a conclusion.

**Severity definitions used throughout:**

| Severity | Meaning |
|---|---|
| CRITICAL | Will cause a wrong architecture, an unbuildable invariant, an unshippable newspaper, or a legally/commercially unsafe position if not corrected before implementation authorization. |
| HIGH | Will cause significant rework, a blocked gate, or a product-fidelity failure if not corrected before the relevant workstream begins. |
| MEDIUM | Materially improves correctness, cost, or decision efficiency; safe to correct during the relevant workstream. |
| LOW | Hygiene, traceability or clarity; no architectural consequence. |

**Headline verdict, stated up front so the rest can be read against it.** This corpus is better than most pre-implementation architecture I have reviewed. Its epistemic discipline is unusually strong: it separates decided from open from researched from rejected, it refuses to assert feasibility it has not tested, it names the physical-press acceptance criterion as the real one, and it repeatedly resists the temptation to let a plausible library choice become a silent commitment. Those are the hardest habits to instill and they are already present.

It is nonetheless **not yet sufficient as an implementation blueprint**, for three reasons:

1. **Its most important invariant is undefined, and as written it contradicts interactive editing.** "Browser preview and PDF consume the same resolved geometry" is the load-bearing claim of the whole product, and the corpus never says what "same" means numerically, what is prohibited in each consumer, or how a live editor can honour it at interactive latency. (C01, C02.)
2. **Several concrete Indian newspaper production realities are absent** — legacy non-Unicode font encodings, per-page press colour availability and the flat plan, customer-supplied PDF advertisements, replating. These are not exotic edge cases; they are the daily substance of the target customer's production. (C04, C05, C06, PO12.)
3. **Caution has hardened into under-decision in places where the evidence to decide already exists**, which guarantees the same arguments will be re-litigated in every future feature spec at full cost. The publishing engine's implementation language is the worst instance: it is not owned by any decision item, yet the dependency registry has already effectively chosen it. (C03, M01, M12.)

None of these invalidate the program. All of them are correctable before RM01 is authorized, and most are correctable on paper.

---

# PART I — FINDINGS

Each finding carries: ISSUE / EVIDENCE / WHY IT MATTERS / RECOMMENDED CORRECTION / MASTER BUILD SPEC CHANGE REQUIRED / RESEARCH NEEDED / PRODUCT OWNER INPUT NEEDED.

---

## C01 — CRITICAL — "Same resolved geometry" is an invariant with no testable definition

**ISSUE.** D03 and Master Build Spec §4 establish that the browser preview and the PDF writer consume the same resolved physical scene without independent reflow. This is the product's central technical promise. Nowhere in the corpus is it given an operational definition: there is no statement of what quantities must be bit-identical, what quantities may differ, by how much, in what unit, measured with what instrument, or what each consumer is forbidden from doing.

**EVIDENCE.**
- Master Build Spec §4 asserts the shared-geometry rule and qualifies it with "Screen antialiasing and display colour may differ; positions, text coverage and flow may not." That sentence names three permitted divergences and three prohibited ones, but assigns no tolerance to either set.
- `PHASE_3_PUBLISHING_ENGINE.md` feasibility exit criterion (2) requires "identical glyph/line/frame geometry in preview and exported file". "Identical" is not achievable literally across a rasterizing browser consumer and a vector PDF consumer; it is achievable for the *inputs* to both, which is a different and much stronger statement that the document does not make.
- `PHASE_3_PUBLISHING_ENGINE.md` also scopes determinism "first ... to a pinned server environment", deferring cross-consumer parity.
- `PHASE_14_TESTING_VALIDATION.md` defers the tolerance question rather than setting it.
- RD01 treats the composition/renderer/writer combination as unresolved, which is correct, but a conformance contract is required *as an input to* RD01, not as an output of it — otherwise RD01 has no pass/fail criterion.

**WHY IT MATTERS.** An invariant that cannot be tested is not an invariant; it is a slogan. Every downstream gate (G1 honest UI, G3 publishing qualification, G6 press acceptance) implicitly depends on this one, and none of them can be evaluated without it. Worse, the absence of a definition permits the most dangerous failure mode in this product class: a preview that is "close enough" in casual inspection, drifting by a line here and a word there, discovered only when a physical newspaper has a dropped paragraph. The corpus correctly forbids hidden dropped text; without a conformance contract it has no mechanism to detect it.

**RECOMMENDED CORRECTION.** Write a numbered geometry conformance contract, either as a new Master Build Spec §4 subsection or as `docs/architecture/GEOMETRY_CONFORMANCE.md` referenced normatively from §4. It must contain five parts:

1. **Input identity.** Both consumers take a ResolvedDocument identified by digest. Parity is asserted between two consumers of *the same digest*, never between two resolutions.
2. **Prohibited operations, per consumer.** Neither the browser preview nor the PDF writer may perform text measurement, shaping, font fallback, line breaking, justification, hyphenation or any fitting. This must be made *structurally unreachable*, not merely a convention — the preview and writer are given glyph IDs and positions, never strings plus a font. Assert it in tests with a deliberately faulting font shim: substitute a font object whose measurement and shaping entry points throw, and require both consumers to render the scene unchanged. If either consumer breaks, it was measuring.
3. **Required exact equality.** Glyph ID sequence; font instance identity (file content hash plus variation coordinates, not family name); glyph origins expressed in the canonical physical integer unit; advances and per-glyph offsets; line box and frame box rectangles; clip geometry; z-order; image placement matrix; image derivative identity by hash.
4. **Permitted divergence with a numeric budget.** Rasterization, antialiasing, screen colour, subpixel positioning of the *raster* and font hinting are permitted to differ. The permitted divergence of any glyph origin after unit conversion between any two consumers is **≤ 25 µm (≈0.07 pt)**. This number is derived from press capability, not invented: web-offset colour-to-colour registration tolerance is on the order of 100 µm, and CTP/imagesetter addressability is roughly 6–10 µm at 2540–4000 dpi. A budget one quarter of registration tolerance and above plate addressability is defensible to a printer and cheap to hold.
5. **Fail-loud primitives.** Enumerate the scene primitives for which *any* divergence is a hard failure rather than a budgeted one: text run content, frame membership of a run, overset state, page assignment, and whether a glyph is present at all.

The measuring instrument must be **structural**, not visual: extract text-positioning operators and font resources from the PDF content stream and compare them against the preview scene graph. Raster diffing is a useful secondary tolerant check and a terrible primary one — it passes when a word is set in the wrong font at the same position and fails on innocuous antialiasing.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §4, plus a normative reference to the new conformance document.
**RESEARCH NEEDED:** No new research item; this is specification work. It becomes the pass/fail criterion *for* RD01.
**PRODUCT OWNER INPUT NEEDED:** No, except that a press partner (PO03) can later confirm the tolerance is acceptable to their prepress department.

---

## C02 — CRITICAL — Server-authoritative resolution and professional interactive editing are, as written, contradictory

**ISSUE.** OP14 tentatively holds that resolution is server-authoritative. C01's prohibition means the client may not shape, measure or break text. Phase 4 nonetheless targets interactive latency (visible drag p95 under 50 ms, active-page text response under 300 ms). These three constraints cannot all hold for the operations that matter most in newspaper pagination.

**EVIDENCE.**
- `DECISION_REGISTER.md` OP14: server-authoritative resolution, open.
- `PHASE_3_PUBLISHING_ENGINE.md`: determinism scoped to a pinned server environment; a passing reference to gesture-level preview.
- `BROWSER_EDITOR_RESEARCH.md`: "visible drag p95 under 50 ms, active-page text response under 300 ms".
- Master Build Spec §5 places the editor as a consumer of resolved scenes.

**WHY IT MATTERS.** The contradiction is not uniform, and that is the key analytical point the corpus misses. Dragging a picture box, moving a rule, changing z-order, nudging a locked ad — all of these are *affine transforms of existing resolved geometry* and can be previewed locally at 60 fps with no shaping whatsoever. But **narrowing a text frame, changing a column count, editing a headline, or reflowing a linked story cannot be previewed locally at all**, because a correct preview requires shaping and line breaking, which the client is forbidden to do. And text-frame resizing is not a marginal operation in newspaper production; it is the operation. An editor that goes blank, or freezes, or shows stale text every time a sub-editor drags a frame edge is not a professional tool, and this is exactly what OP14 plus C01 currently specify.

**RECOMMENDED CORRECTION.** Do not weaken the shared-geometry invariant. Instead, introduce a second invariant that makes the contradiction disappear by naming two distinct classes of geometry:

- **Provisional geometry.** Computed client-side, explicitly approximate, visually marked as unconfirmed in the UI, never exported, never cached as a ResolvedDocument, never preflighted, never archived, and never the basis of an overset or copyfit determination. It exists only to keep the pointer responsive during a gesture.
- **Committed geometry.** Produced only by the canonical resolver, identified by digest, and the sole input to preview parity, PDF generation, preflight, release and archive.

With that split stated as an invariant, RD01 and RD06 become **one coupled decision**, not two independent ones, and there are exactly three honest options:

| Option | Description | Cost | Risk |
|---|---|---|---|
| (i) Shared engine compiled to WASM | Same composition code runs client and server; parity proven numerically, not assumed | High build/packaging cost; asset size; requires C03 resolved first | Numeric drift between native and WASM builds must be *proven* absent, not hoped |
| (ii) Server round-trip per committed command, client shows a provisional text estimate | Client uses a cheap approximate measurer for in-gesture feedback only | Medium | The estimate will sometimes disagree visibly with the committed result; UI must make that honest, not embarrassing |
| (iii) Server round-trip, no local text estimate: frame shows a "recomposing" state during text-affecting gestures | Simplest and fully honest | Low | Feels less fluid than a desktop tool; may be perfectly acceptable at ~300 ms |

Option (iii) should be named in the Master Build Spec as **the fallback the UI is designed against**. If the UI is designed so that (iii) is acceptable, then (i) and (ii) are upgrades; if the UI is designed assuming (i) and (i) proves infeasible, the entire editor design is rework. This is the single highest-leverage sequencing decision in the corpus.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §4 (provisional vs committed geometry as a named invariant) and §5 (the editor's obligation to render provisional state as visibly unconfirmed).
**RESEARCH NEEDED:** RD01 and RD06 must be restated as one coupled decision with the three options above as the explicit candidate set.
**PRODUCT OWNER INPUT NEEDED:** No, but the pilot newsroom should be shown option (iii) behaviour during RM02 and asked whether it is acceptable. That is a cheap and extremely valuable early signal.

---

## C03 — CRITICAL — No decision item owns the publishing engine's implementation language and distribution strategy

**ISSUE.** The corpus has no decision, open decision, or research item whose subject is: *in what language is the publishing engine written, how is it built and packaged, and must it also run in the browser?* This decision has nevertheless already been made implicitly, by the dependency registry.

**EVIDENCE.**
- `DEPENDENCY_CANDIDATES.md` DEP60 records the engine language as "Language undecided."
- OP13 covers the *backend API runtime* only (FastAPI/Python, TENTATIVE) — a different question.
- `PHASE_16_REPOSITORY_DEVELOPMENT.md` flags the `publishing/` area as requiring native toolchains, i.e. it already assumes native.
- `PHASE_2_SYSTEM_ARCHITECTURE.md` frames Native-vs-WASM purely as a *parity* question, not as a language/packaging decision.
- RD01 is scoped to the composition/renderer/writer *combination*, not to the implementation substrate.
- Every named primitive candidate — HarfBuzz, FreeType, ICU, libhyphen, LittleCMS, libvips, Pango, SkParagraph, qpdf, PoDoFo — is native C or C++.

**WHY IT MATTERS.** Three things follow from the evidence above that the corpus does not acknowledge. First, **C++ has already been chosen** without an ADR, simply by listing only C/C++ primitives; a Rust stack (which has credible bindings or equivalents for most of these, and a materially better memory-safety posture for parsing hostile input) was never placed on the table. Second, this decision, not RD01, is what determines whether option (i) in C02 is even available — WASM feasibility, build size, and numeric parity are properties of the toolchain. Third, it governs hiring, CI complexity, supply-chain review, packaging, sandboxing of hostile-input parsers, and replacement cost. A decision with that blast radius must not be an emergent property of a research table.

**RECOMMENDED CORRECTION.** Add **RD13 (CRITICAL): publishing engine implementation language, native build and packaging strategy, sandboxing model for hostile-input parsers, and whether a WASM client build is a requirement.** Make RD01 formally dependent on RD13. Require the RD13 deliverable to evaluate at minimum: C++ with the named primitives; Rust with FFI to the same primitives; and Rust with native-ecosystem equivalents where they exist and are qualified. Require it to state explicitly whether a WASM target is in scope, because that single answer eliminates or enables C02 option (i).

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §3 (system shape must name the engine as a distinct artifact with its own language and packaging) and §10 (technology selection must record the decision and its ADR).
**RESEARCH NEEDED:** Yes — RD13, new, CRITICAL, blocking RD01.
**PRODUCT OWNER INPUT NEEDED:** Indirectly — team capability and hiring intent are owner inputs to RD13.

---

## C04 — CRITICAL — Legacy non-Unicode Indian font encodings are entirely absent from the corpus

**ISSUE.** The architecture assumes all text is Unicode and all fonts are OpenType. For the stated target customer — Indian-language newspapers, with Marathi/Pune examples used throughout the product context — this assumption is false about their existing content, their existing archives, and frequently their brand typefaces.

**EVIDENCE.**
- `TYPOGRAPHY_RESEARCH.md` states the rule "Preserve source Unicode text" — it does not contemplate source text that is not Unicode.
- Master Build Spec §4 frames typography entirely in OpenType/Unicode terms.
- Master Build Spec §6 describes ingestion (feeds, CMS, manual, import) with no encoding treatment at any boundary.
- R18 in `PHASE_1_ANALYSIS.md` is defined purely as script coverage, not as encoding provenance.
- The font asset contract in the typography research has no field distinguishing a Unicode OpenType font from a legacy 8-bit-encoded display font.

**WHY IT MATTERS.** Indian newspaper production has a long tail of pre-Unicode, font-specific 8-bit Devanagari encodings (the Shree-Lipi / Kruti Dev / APS family and their many house variants). Three consequences follow, each independently serious:

1. **A brand typeface that exists only as a legacy-encoded font blocks the pilot.** The corpus's no-silent-substitution policy is correct and should not be weakened — but it means that if the customer's masthead or standing headline face is legacy-encoded, there is no supported path at all, and this will be discovered during onboarding rather than during architecture.
2. **Content, archive and advertisement-copy import require font-specific, partially lossy conversion tables**, with genuinely hard cases (nukta normalization, eyelash-ra, half-form/conjunct reconstruction, ambiguous glyph-to-character mappings). No roadmap lane owns this work, and it is not a small amount of work.
3. **Converted text weakens the archive's exactness claim.** If the archive's promise is provenance and exact retrieval, then text that passed through a lossy conversion must carry that fact as first-class metadata, or the promise is overstated for exactly the historical material the customer cares most about.

**RECOMMENDED CORRECTION.**
- Master Build Spec §4 and §6: state that text ingress may be non-Unicode, and that any conversion happens at a recorded, versioned, single boundary; the conversion identity and the original bytes are retained; the conversion is reversible where the mapping permits and is flagged as lossy where it does not; converted text carries its own provenance record distinguishable from authored Unicode text.
- Font record contract: add a field distinguishing Unicode OpenType fonts (supported for composition) from legacy-encoded fonts (supported, if at all, only as a conversion source, never as a composition target).
- Add **RD14 (HIGH): legacy Indian encoding inventory, conversion-table sourcing or construction, lossiness characterization, and round-trip test corpus.**
- Add a blocking product-owner question (PO13 below).
- Add legacy-content fixtures to the UI backlog so that the blocked-import, conversion-review and rejected-font workflows are *designed* rather than discovered in production.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §4 and §6.
**RESEARCH NEEDED:** Yes — RD14.
**PRODUCT OWNER INPUT NEEDED:** Yes — blocking. What are the actual fonts and encodings in the customer's current production and archive?

---

## C05 — CRITICAL — The production plan is missing press colour availability and the flat-plan / news-hole artifact

**ISSUE.** A newspaper page is not uniformly capable of colour. Colour availability is a function of press towers and signature imposition, so on a typical run only certain pages can carry colour. The architecture models neither this constraint nor the artifact that carries it — the flat plan (page plan / dummy), which is also where the news hole is computed against booked advertising.

**EVIDENCE.**
- `PDF_PREPRESS_RESEARCH.md` PrintProfile field list contains no page-level colour capability.
- Master Build Spec §7's press policy list likewise omits it.
- `PHASE_3_PUBLISHING_ENGINE.md` mentions news-hole once, as a verb phrase, with no owning entity.
- `PHASE_11_DATA_REVISION_ARCHIVE.md`'s ownership table has no edition-plan or page-plan aggregate at all. Edition owns Sections and Pages; nothing owns the *plan*.
- Crucially, this is a **fidelity gap and not an invented requirement**: `ORIGINAL_PRODUCT_CONTEXT.md` §7 lists "news-hole calculation" and "advertisement placement" among the product's strategic IP. Astra dropped a requirement the owner named as differentiating.

**WHY IT MATTERS.** A colour photograph placed on a mono page produces a physically wrong newspaper that passes **every check described anywhere in the corpus** — the PDF is valid, the preflight is green, the geometry is conformant, the rights are clear — and the error surfaces at the press, at deadline, when the only remedies are expensive. Equally, without a plan entity there is no representation of the ad-sales/editorial boundary, so the system cannot answer the most basic daily question in a newsroom: how much editorial space exists today, and where.

**RECOMMENDED CORRECTION.**
1. Add **per-page colour availability and section/signature structure** to the versioned PrintProfile (or to a referenced press-configuration record it pins). Treat it as a hard constraint class ranked *above* user locks: a lock may not authorize placing colour on a mono page.
2. Add a first-class **EditionPlan** (flat plan) aggregate: page count, page sequence, per-page section assignment, per-page colour capability, per-page advertisement allocation, and remaining news hole. It is created before generation, versioned, and pinned into the release package alongside the print profile.
3. Add a **Pageinator-owned "page colour capability" preflight rule class**. This matters specifically because no external PDF validation engine can perform this check — it requires knowledge of the press configuration and the page's position in the plan, which is not in the PDF. It is a clean example of why the HYBRID preflight split is right, and the corpus should use it as such.
4. Add a flat-plan screen and fixtures to the UI backlog. It is absent from all 26 units, and it is arguably the first screen a production editor opens each day.
5. Add **RD16 (HIGH): press configuration capture — colour tower/signature modelling, how the constraint is obtained from a real press partner, and how it is validated.**

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §3 (new aggregate), §4 (constraint ranking above locks), §7 (PrintProfile fields and the owned preflight rule class).
**RESEARCH NEEDED:** Yes — RD16.
**PRODUCT OWNER INPUT NEEDED:** Yes — blocking (PO14 below): the actual press configuration, colour page availability pattern, and signature structure.

---

## C06 — CRITICAL — No qualified path exists for importing customer-supplied PDF advertisements

**ISSUE.** Display advertising arrives as press-ready PDF. The corpus repeatedly asserts that a tested vector-preserving import path is *required*, and simultaneously evaluates no candidate capable of providing one.

**EVIDENCE.**
- Master Build Spec §7: "Imported vector ads need a tested preserve/import path; rasterizing everything is not an automatic safe solution."
- `PDF_PREPRESS_RESEARCH.md` repeats the requirement.
- `IMAGE_COLOR_RESEARCH.md` warns explicitly: "Do not route all uploaded PDFs through an image rasterizer and assume ad fidelity."
- `DEPENDENCY_CANDIDATES.md` DEP27–DEP32 cover PDF structure, writing, rendering and composition — **none is assessed for page-import fidelity**. qpdf can splice objects but is not a composition writer. PoDoFo's import capability is limited and carries an "API evolving" note. Ghostscript conversion is itself flagged in the corpus as altering colour, transparency and font behaviour, which disqualifies it as a fidelity-preserving import path.
- PDFlib separates its base product from PDI (PDF Import) as a distinct commercial tier — a licensing fact that PO04's budget question does not surface, so the owner is being asked to approve a budget for a capability tier that has not been named.

**WHY IT MATTERS.** If ad import is unqualified, one of three bad outcomes follows: ads are rasterized (destroying vector text and spot colour, and drawing complaints from advertisers and the printer), ads are manually re-created (destroying the product's time-saving proposition), or ads bypass the system entirely (destroying the immutability and completeness of the archived edition package). Any of the three undermines the core value proposition. And the failure is discovered at integration time, not now, unless the requirement is made a first-class evaluation criterion.

**RECOMMENDED CORRECTION.**
1. Make PDF-ad import with preserved vectors, text, embedded fonts, spot colours and overprint a **named, weighted criterion in RD01's exit deliverable** and part of the PDF research experiment corpus — not a footnote.
2. Add dependency registry rows for the PDF page-import capability and evaluate at minimum **pdfium** (BSD-3-Clause — verify), **Apache PDFBox** (Apache-2.0 — verify), and **MuPDF/mutool** (AGPL or commercial — verify). Their absence from a 64-row registry that found room for Ghostscript and veraPDF is a genuine omission, not a judgement call.
3. Surface PDF-import licence tiering explicitly inside PO04 so the budget question is answerable.
4. Define **quarantine-with-diagnostic** behaviour for an unimportable creative: the ad is rejected with a specific, actionable reason returned to whoever supplied it. Silent rasterization must be prohibited by name.
5. Add a creative-file rejection scenario to backlog unit UI012.
6. Add **RD15 (CRITICAL): PDF advertisement import fidelity path** — or make it a named, separately-reportable sub-deliverable of RD01. It must not be folded invisibly into RD01's general writer question, because the writer decision and the import decision can have different winners.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §7.
**RESEARCH NEEDED:** Yes — RD15.
**PRODUCT OWNER INPUT NEEDED:** Yes — how do advertisements actually arrive today, in what formats, from whom, and with what correction authority?

---

## H01 — HIGH — The backend runtime decision is left TENTATIVE while being structurally coupled to two decisions that do not exist yet

**ISSUE.** OP13 records the backend runtime (FastAPI/Python) as TENTATIVE. OP12 records the broader stack similarly. RM03 requires choosing "one runtime/identity/queue/storage path". But the runtime choice is not free: it is pulled in one direction by the news-intelligence pipeline (Python's extraction, NLP and embedding ecosystem is genuinely dominant) and in another by the publishing engine (native, per C03), and the seam between the API runtime and a native engine — process boundary, IPC, memory limits, crash isolation, backpressure — is not specified anywhere.

**EVIDENCE.** `DECISION_REGISTER.md` OP12/OP13; `PHASE_2_SYSTEM_ARCHITECTURE.md` marks FastAPI/Python TENTATIVE; `IMPLEMENTATION_ROADMAP.md` RM03 requires a single path; no artifact describes the API↔engine boundary.

**WHY IT MATTERS.** A tentative runtime is fine. A tentative runtime whose *interface to the most complex component in the system* is unspecified is not — because the interface, not the runtime, is what is expensive to change. If the engine runs in-process via bindings, a crash in a hostile-PDF parser takes down the API worker; if it runs out-of-process, there is a serialization contract, a resource governor and a queue that must be designed.

**RECOMMENDED CORRECTION.** Do not force the runtime decision early. Instead, decide the *seam* early and independently of the runtime: specify that the publishing engine is invoked as an isolated, resource-limited, separately-deployable worker with a versioned request/response contract over durable jobs, never as an in-process library inside a request-serving API process. That single rule makes the runtime decision cheap, makes hostile-input isolation possible (Phase 12 already requires it), and makes C03's language decision genuinely independent of OP13. Then let OP13 be decided after RD13.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §3.
**RESEARCH NEEDED:** No; specification work.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## H02 — HIGH — No rule governs who may modify final PDF bytes, and commercial preflight engines modify them by default

**ISSUE.** The corpus establishes an exact-revision export invariant and a candidate digest bound to approval. RM11 mentions a "fixup/new-hash flow". But the Master Build Spec never states the rule that makes this safe: that **no tool may alter the approved bytes in place**, and that any fixup produces a new candidate with a new digest requiring re-validation and re-approval.

**EVIDENCE.** Master Build Spec §7 and §8; `PREFLIGHT_RESEARCH.md` two-stage model; `IMPLEMENTATION_ROADMAP.md` RM11.

**WHY IT MATTERS.** Both leading commercial preflight products (callas pdfToolbox, Enfocus PitStop Server) are *correction* engines as much as validation engines, and their default profiles routinely convert colour, flatten transparency, subset or re-embed fonts, and normalize structure. If a fixup runs silently between validation and release, the archived bytes are not the approved bytes, the digest binding is broken, and the geometry conformance contract (C01) has been violated by a tool nobody was watching. This is a realistic operational failure, not a theoretical one.

**RECOMMENDED CORRECTION.** State in §7: automatic correction is disabled by default; any correction is an explicit, authorized, audited action producing a new candidate digest; validation always re-runs on post-fixup bytes; the approval that existed before a fixup is revoked by the fixup. Add a test to the Phase 14 release-race suite asserting that a fixup invalidates a prior approval.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §7 and §8.
**RESEARCH NEEDED:** Vendor-behaviour verification belongs in the existing RD03 procurement evaluation (confirm default profile behaviour and whether correction can be hard-disabled).
**PRODUCT OWNER INPUT NEEDED:** No.

---

## H03 — HIGH — Deadline behaviour is unarchitected, and the "no waivers" rule collides with newspaper reality

**ISSUE.** A newspaper has a hard, externally-imposed deadline. The corpus treats time-criticality only as capacity budgets under RM16/G5. It contains no design for what happens when generation, preflight or release fails twenty minutes before the press run — and it simultaneously states that mandatory defects cannot be waived.

**EVIDENCE.** Master Build Spec §7: "Engine timeout/unavailability/expired license/malformed report is a failure, not green. Mandatory defects cannot be waived." `IMPLEMENTATION_ROADMAP.md` RM16/G5 treat deadlines as performance budgets only. `PHASE_17_RISK_REGISTER.md` does not contain a deadline-escape risk.

**WHY IT MATTERS.** The fail-closed rule is correct and I would not weaken it casually. But a system with no escape hatch will be escaped anyway — by the operator emailing a file from a desktop application at 11:40 pm, outside the archive, outside the audit, outside everything the product promises. An unarchitected escape is worse than an architected one, because it is invisible. The corpus's own integrity goals are best served by naming the escape and instrumenting it.

**RECOMMENDED CORRECTION.** Resolve the collision explicitly, in one of two directions, and say which:
- **(a) Architected escape.** An emergency export is possible; it is permanently and visibly marked non-conforming; it requires a named authority with a specific capability; it records the outstanding defects and the reason; it is archived exactly like a conforming release but with a distinct release class that can never be silently presented as conforming; and reprint of it requires re-acknowledgement.
- **(b) No escape.** State plainly in the product contract that Pageinator will not emit a file that fails mandatory checks, and that the newsroom's fallback is its prior system. This is honest and defensible, but the owner must agree to it before a pilot, not during one.

Either way, add a deadline-failure scenario to the UI backlog so the newsroom sees the behaviour during RM02 rather than during a press run.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §2 (product contract) and §7.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** Yes — blocking (PO15 below).

---

## H04 — HIGH — Digital/e-paper and proof-image outputs are underspecified, inviting a second renderer

**ISSUE.** The original product context §55 ranks outputs: editable document, PDF/X print master, proof PDF, PNG/JPEG page proofs, web/e-paper, packaged edition, printer-specific variants. The Master Build Spec concentrates almost entirely on the print master, leaving the digital outputs without an architectural rule.

**EVIDENCE.** Master Build Spec §7; `ORIGINAL_PRODUCT_CONTEXT.md` §55.

**WHY IT MATTERS.** Unspecified secondary outputs are exactly how a second text composer enters a system. Someone will implement an HTML e-paper view by re-flowing the editable document in a browser, because it is easy — and at that moment the product has two composition engines with different line breaks, and the archive contains a digital edition that does not match the printed one. RJ-level prohibition of a second composer already exists for PDF; it must be stated generally.

**RECOMMENDED CORRECTION.** State in §7 that **all** rendered outputs — print master, proof PDF, page raster proofs, e-paper, thumbnails — are derived from the same ResolvedDocument digest, and that no output path may re-compose text. E-paper interactivity (article text extraction, reflowable reading views) is permitted *as a separate, explicitly non-WYSIWYG derived artifact* carrying its own provenance link back to the resolved scene, never as a re-layout of the page.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §7.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** Whether e-paper is in pilot scope (PO11 territory; can defer, but the invariant cannot).

---

## H05 — HIGH — Archive search is architected as "rebuildable projections" with no engine decision and no multilingual analysis plan

**ISSUE.** The original context §31 specifies archive search by date, headline, reporter, person, place, organization, section, keyword, edition, page and advertisement. The corpus correctly insists search indexes are rebuildable projections and never the authoritative catalogue — but then stops. There is no decided search technology, no tenancy model for the index, and, most importantly, no treatment of **Devanagari and Urdu text analysis**: tokenization, normalization, matra/nukta folding, transliteration matching, or Urdu's optional-diacritic and space-insensitivity problems.

**EVIDENCE.** `PHASE_11_DATA_REVISION_ARCHIVE.md` (projections rule, AR14 tenancy clarification); `ORIGINAL_PRODUCT_CONTEXT.md` §31; `DEPENDENCY_CANDIDATES.md` contains search-adjacent rows but no qualified multilingual analysis candidate.

**WHY IT MATTERS.** Search is the archive's user-facing value. A search that cannot match "पुणे" typed with a different normalization, or cannot find an Urdu headline because the query omitted diacritics, is a search that the newsroom will conclude is broken — and this is an analysis-chain property decided at index time, expensive to retrofit across a large historical corpus.

**RECOMMENDED CORRECTION.** Add **RD17 (MEDIUM): multilingual search and indexing stack** — candidate engines, Devanagari/Urdu analysis chains, normalization policy, transliteration and cross-script query handling, tenant isolation of indexes, and reindex cost for a multi-year archive. Record in §6/§8 that index analysis configuration is versioned and that a reindex under a new analysis version is a recorded migration, not a silent rebuild.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §6 and §8.
**RESEARCH NEEDED:** Yes — RD17.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## H06 — HIGH — "Duplicate edition" and "reprint" are product operations with no data-model contract

**ISSUE.** The original context §27 specifies, from the archive UI, the operations: preview, open, download print PDF, download proof, **duplicate edition**, **reopen editable copy**, and **reprint**. Phase 11 defines the three retrieval promises well, but duplicate-edition and reprint have no lineage, rights or identity rules.

**EVIDENCE.** `ORIGINAL_PRODUCT_CONTEXT.md` §27; `PHASE_11_DATA_REVISION_ARCHIVE.md` retrieval promises; backlog UI021 covers preview/download/editable copy but not duplication or reprint semantics.

**WHY IT MATTERS.** Duplicating a released edition into a new working edition raises questions the system must answer deterministically: are story rights re-evaluated for the new publication date? Are advertisement reservations copied, and are their contractual constraints still valid? Is the print profile re-pinned to current or retained? Is the duplicated edition's lineage to the source release recorded? Reprint raises a sharper one: reprint is *not* re-export — it is authorization to use archived bytes again, and rights may have lapsed since. Phase 11's AR07 clarification handles revocation for *access*; it does not define reprint as a distinct authorized action with its own grant check.

**RECOMMENDED CORRECTION.** In §8, define duplicate-edition as creating a new Edition with a recorded `derived_from` release reference, re-evaluating rights grants against the new publication date and territory, explicitly re-confirming or dropping advertisement reservations, and pinning the *current* print profile by default with an explicit option to retain the historical one. Define reprint as a first-class authorized action, checked against current grants at request time, audited, and refused (with reason) when a grant has lapsed.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §8.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** Reprint authority and rights-lapse policy are contractual; overlaps PO05.

---

## H07 — HIGH — The UI-first backlog does not distinguish durable work from deliberately disposable work

**ISSUE.** RM01/RM02 build a simulated product, including a sample editor, before RD01/RD06 decide the rendering and interaction architecture. The roadmap acknowledges this tension once ("UI sample remains distinct until each capability qualified"), but the 26 backlog units carry no classification indicating which are expected to survive the engine decisions and which are knowingly throwaway.

**EVIDENCE.** `IMPLEMENTATION_ROADMAP.md` RM02/RM12; `specs/INITIAL_IMPLEMENTATION_BACKLOG.md` UI001–UI026; `PHASE_15_UI_FIRST.md`.

**WHY IT MATTERS.** UI-first is the right strategy here — I agree with Astra on this, strongly (see B). Its one serious failure mode is that disposable scaffolding silently becomes load-bearing because nobody labelled it. The sample editor is the acute case: it will be the most impressive artifact produced in RM02, it will be demoed, and there will be enormous pressure to keep it. If it is labelled DISPOSABLE-BY-DESIGN from day one, that pressure is manageable; if it is not, the product inherits a browser-only geometry model, which the roadmap itself warns against.

**RECOMMENDED CORRECTION.** Add a mandatory classification field to every backlog unit: **DURABLE** (survives engine decisions: design tokens, routes, shells, navigation, status language, accessibility patterns, tenancy-shaped fixtures, dashboards, settings, archive browse) or **DISPOSABLE-BY-DESIGN** (canvas/editor interaction internals, any simulated composition or overset logic, any mock geometry). Require that disposable units contain no logic that a later real implementation would be tempted to reuse, and that they never define a persisted schema.

**MASTER BUILD SPEC CHANGE REQUIRED:** No.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## H08 — HIGH — Editing lease granularity is undecided but determines the revision and command model

**ISSUE.** Phase 11 proposes a "document edit lease" as an initial coordination aid, with revision checks as the real safety mechanism. That is architecturally sound. But the *granularity* of the lease — document, page, or frame — is left open, and RM14 defers the concurrency model entirely.

**EVIDENCE.** `PHASE_11_DATA_REVISION_ARCHIVE.md` revision and edit contract; `IMPLEMENTATION_ROADMAP.md` RM14; `PHASE_1_ANALYSIS.md` multi-user requirements.

**WHY IT MATTERS.** In real newspaper production, several desk staff work on one edition simultaneously, on different pages. A document-level lease makes that impossible and will be rejected by the newsroom on day one of the pilot. A page-level lease is probably right, but it interacts badly with linked text flows that cross pages — an overset cascade from page 3 changes page 7, which someone else holds. That interaction must be designed into the command and revision model in RM06, not bolted on in RM14. Deferring it to RM14 means discovering it after the schema is committed.

**RECOMMENDED CORRECTION.** Decide lease granularity before RM06 schema work. My recommendation, offered as a recommendation and not a finding of fact: **page-level leases, with linked-flow effects allowed to cross lease boundaries as server-computed consequences** — that is, a leaseholder's edit may change geometry on a page they do not hold, and the other holder receives an explicit, non-destructive "upstream flow changed" notification with a diff, never a silent mutation under their cursor. Record it in §5 as an invariant that linked-flow consequences are server-computed and notified, never client-applied across a lease boundary.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §5.
**RESEARCH NEEDED:** No; design decision.
**PRODUCT OWNER INPUT NEEDED:** Confirmation of real concurrency patterns (how many people, on what units, at once) — overlaps PO06.

---

## H09 — HIGH — Font licensing for a multi-tenant SaaS with archival retention has no owner and is treated as a technical detail

**ISSUE.** The Edition Package requires "font files or licensed recoverable font references" retained for the archive's life. The corpus treats this as a storage and dependency-retention question. It is primarily a licensing question, and a hard one.

**EVIDENCE.** `PHASE_11_DATA_REVISION_ARCHIVE.md` Edition Package contents; `TYPOGRAPHY_RESEARCH.md` font asset contract; `DECISION_REGISTER.md` contains no font-licensing decision; PO02 asks about languages and typefaces but not about license terms for server-side use.

**WHY IT MATTERS.** Commercial font EULAs commonly restrict server-side installation, count seats or CPUs, restrict redistribution, and are frequently silent or hostile on indefinite retention of the font binary inside a customer archive held by a third-party SaaS. A customer uploading their brand font does not thereby grant Pageinator the right to store and re-use it. Embedding subsets into a PDF is usually permitted; retaining full font binaries in a vendor-operated archive for decades often is not. This can invalidate the "editable restoration" retrieval promise for exactly the fonts that matter.

**RECOMMENDED CORRECTION.** Treat fonts as first-class rights-bearing assets: extend RightsGrant to cover fonts with actions (compose, embed-subset, retain-in-archive, restore-for-edit), evidence of licence, seat/server scope, and validity. Refuse to compose with a font whose grant does not cover the intended action, using the same fail-closed discipline applied elsewhere. Add **RD18 (HIGH): font licensing model for server-side composition and archival retention**, including whether a libre-font-only pilot matrix is viable as a risk-reduction path.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §10 and §6 (rights).
**RESEARCH NEEDED:** Yes — RD18.
**PRODUCT OWNER INPUT NEEDED:** Yes — extends PO02 to include licence terms, not just typeface names.

---

## H10 — HIGH — Audit integrity is treated as an operational concern, but it is part of the product's value proposition

**ISSUE.** AuditEvent is defined as an append-only action record. There is no decision on tamper-evidence, retention duration, per-tenant exportability, or the relationship between audit records and the immutable release manifests they describe.

**EVIDENCE.** `PHASE_11_DATA_REVISION_ARCHIVE.md` AuditEvent row; `PHASE_12_SECURITY_TENANCY.md`; no corresponding decision in the register.

**WHY IT MATTERS.** Pageinator's differentiation, per the corpus and the original context, rests on provenance, immutability and defensible release history. In a publishing dispute — a defamation claim, a rights challenge, a retraction inquiry — "who approved this edition, from what revision, under what rights, at what time" is the product. "Append-only" in a database the vendor operates is a weak claim under adversarial examination. The corpus applies rigorous integrity thinking to PDF bytes and package manifests and then stops short of the record that explains them.

**RECOMMENDED CORRECTION.** Decide, and record in §9: audit retention duration relative to archive retention; whether audit records are hash-chained or otherwise tamper-evident; whether the release manifest incorporates the digest of its own approval audit chain (I recommend yes — it costs almost nothing and makes the manifest self-describing); and whether tenants can export their own audit history (I recommend yes, as a product feature, not just a compliance one).

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §9.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** Retention duration is a policy/legal input; overlaps PO05.

---

## H11 — HIGH — The entire publishing risk-reduction path is blocked on owner answers with no defined fallback

**ISSUE.** RM04, the early feasibility spike that is the most valuable de-risking activity in the whole plan, depends on PO02 (languages/typefaces), PO03 (press partner) and PO04 (commercial engine budget). If the owner does not answer promptly, the highest-risk part of the architecture stays unexplored while UI work proceeds — precisely the imbalance the roadmap is otherwise designed to avoid.

**EVIDENCE.** `IMPLEMENTATION_ROADMAP.md` RM04 dependency column; `PRODUCT_OWNER_QUESTIONS.md` PO02–04 marked BLOCKING.

**WHY IT MATTERS.** Blocking is correct for *production* commitments and wrong for *feasibility learning*. Nothing about proving that a paragraph of Marathi, an image and a vector ad can round-trip to a preflight-clean PDF requires the customer's actual fonts or actual press. Treating RM04 as blocked converts a schedule risk into an architecture risk, because the UI will be built while the engine is still hypothetical.

**RECOMMENDED CORRECTION.** Define a **default pilot matrix** that unblocks RM04 immediately on licensed-libre inputs: Latin/English plus Devanagari/Marathi; one libre font family with credible Devanagari coverage; one generic coldset newsprint output condition; one open-licensed image; one vector ad authored in-house. State explicitly that RM04 results under the default matrix establish *feasibility of the approach*, not qualification of the customer's actual matrix, and that G3 still requires the real matrix. This preserves the epistemic discipline while removing the block.

**MASTER BUILD SPEC CHANGE REQUIRED:** No (roadmap change).
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No — that is the point of the correction.

---

## H12 — HIGH — The advertising domain is modelled far below its commercial centrality

**ISSUE.** Advertising is modelled as `Asset`/`Advertisement` plus an edition-scoped reservation pinning creative and contractual constraints. The original product context treats advertisement placement as strategic IP and describes advertisement-aware workflows. Between those two positions sits a large undecided scope: booking, rate cards, size catalogues, position guarantees, make-goods, and the arbitration of ad space against editorial space.

**EVIDENCE.** `PHASE_11_DATA_REVISION_ARCHIVE.md` Asset/Advertisement row; `ORIGINAL_PRODUCT_CONTEXT.md` §7 (strategic IP) and §21; `DECISION_REGISTER.md` has no scope decision for ad sales.

**WHY IT MATTERS.** This is a scope-boundary ambiguity, and ambiguous scope boundaries are where products acquire an unplanned second product. Indian newspapers generally already run ad-booking systems. Pageinator can either integrate with them (importing bookings as constraints) or replace them (a much larger product). The architecture currently implies the former without saying so, while the strategic-IP framing implies the latter.

**RECOMMENDED CORRECTION.** Make the boundary explicit in §2: Pageinator consumes advertisement bookings as *constraints* — position, size, page, colour requirement, creative reference, contractual guarantees — via import or manual entry, and does not own ad sales, rate cards, invoicing or make-good workflows in the pilot. If the owner wants ad sales, it becomes a separately scoped product decision with its own roadmap lane. Either answer is fine; leaving it implicit is not.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §2 (scope boundary).
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** Yes — is ad booking in scope, and what system does it live in today?

---

## H13 — HIGH — Minimum effective-PPI policy has no authoritative source and no defined block/warn semantics

**ISSUE.** The image/colour research correctly defines effective PPI from usable pixels over physical placement size (not EXIF DPI), and uses 200 PPI as an example. An example is not a policy. There is no PrintProfile field carrying minimum acceptable effective PPI, and no rule about whether falling below it warns or blocks.

**EVIDENCE.** `IMAGE_COLOR_RESEARCH.md` resolution section; `PDF_PREPRESS_RESEARCH.md` PrintProfile fields; Master Build Spec §7.

**WHY IT MATTERS.** Newsprint screen rulings are much coarser than commercial print, so the acceptable PPI is genuinely lower and genuinely press-specific — a single global constant will be wrong in both directions, rejecting usable images and passing unusable ones. And the block-versus-warn choice is an editorial-authority question: a news picture from a phone at a breaking story may be the only image in existence, and a hard block would be wrong. The corpus's fail-closed instinct is right for *conformance* defects and wrong for *quality* thresholds; it must distinguish them.

**RECOMMENDED CORRECTION.** Add minimum effective PPI (warn threshold and block threshold, separately) to the versioned PrintProfile. Classify low-resolution imagery as a **quality** finding that may be acknowledged by an authorized editorial role with a recorded acknowledgement, distinct from **conformance** defects which may not be waived. Record the acknowledgement in the release package.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §7.
**RESEARCH NEEDED:** Threshold values belong to RD16/press partner input.
**PRODUCT OWNER INPUT NEEDED:** Yes — press screen ruling; overlaps PO03.

---

## H14 — HIGH — Astra's own review corrections were applied to phase documents but not promoted into the decision register

**ISSUE.** The Phase 24 consistency review applied corrections AR06, AR07, AR14 and AR17 as *clarifications inside phase documents*. The decision register is declared the authority for decision status, yet none of these appear there as numbered decisions. They are, in substance, decisions.

**EVIDENCE.** `ASTRA_ARCHITECTURE_REVIEW.md` corrections-applied table; `PHASE_11_DATA_REVISION_ARCHIVE.md` carries AR06/AR07/AR14/AR17 as inline "Phase 24 clarification" paragraphs; `DECISION_REGISTER.md` D01–D13 do not include them.

**WHY IT MATTERS.** This is a traceability defect with a practical cost. Edition-local StoryRevision lineage (AR06), release-commit serialization against revocation (AR07), tenant scoping of news observations and embeddings (AR14), and append-only press receipts outside the immutable manifest (AR17) are all binding constraints on future implementation. If a feature spec author reads the decision register — which the process tells them to do — they will not find them. Decisions buried in prose get re-litigated or violated.

**RECOMMENDED CORRECTION.** Promote AR06, AR07, AR14 and AR17 to numbered DECIDED entries (D14–D17) with references back to the phase-document text, and add a register convention: any review finding whose resolution constrains implementation becomes a numbered decision, not a paragraph.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §1 and §11 counters.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M01 — MEDIUM — RD05 (numeric representation) is largely decidable on paper today; micro-points are the wrong default

**ISSUE.** RD05 treats the canonical numeric unit as requiring an experiment. Most of it requires arithmetic, and the arithmetic points clearly away from the candidate the corpus leans toward.

**EVIDENCE AND ANALYSIS.** `PHASE_3_PUBLISHING_ENGINE.md` states integer micro-points are "only a candidate"; AR05 downgraded them to one candidate; RD05 remains open. Working it through with int64 (max ≈ 9.22 × 10^18):

| Unit | Resolution | Broadsheet 600 mm ≈ 1701 pt | Two-term coordinate product | Headroom |
|---|---|---|---|---|
| Millipoints (1e-3 pt) | 0.353 µm | 1.70 × 10^6 | 2.9 × 10^12 | ~10^6 × |
| Micro-points (1e-6 pt) | 0.353 nm | 1.70 × 10^9 | 2.9 × 10^18 | ~3 × |

Micro-point resolution is 0.353 nanometres. That is roughly three orders of magnitude below the wavelength of visible light and seven below plate addressability — it is precision with no physical referent. Worse, a naive two-term product of micro-point coordinates lands within a factor of three of int64 overflow, which means every transform composition needs overflow analysis. Millipoints give 0.353 µm resolution — comfortably finer than the 6–10 µm plate addressability and the 25 µm conformance budget proposed in C01 — with roughly a million times the arithmetic headroom.

**RECOMMENDED CORRECTION.** Decide **integer millipoints** as the canonical physical unit now, with the above analysis recorded as its justification, and with explicit documented bounds on intermediate values and a stated rounding mode. Narrow RD05 to the one thing that genuinely needs measurement: accumulated rounding error across long chains of transforms and across a full linked-flow composition, verified by round-trip tests. Do not run an experiment to discover a fact that division already establishes.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §4.
**RESEARCH NEEDED:** RD05 narrowed, not removed.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M02 — MEDIUM — RJ04 (rejecting veraPDF as a PDF/X validator) is correct, but the rejection is recorded too broadly

**ISSUE.** RJ04 rejects veraPDF. As a rejection of veraPDF *as a PDF/X conformance validator* this is exactly right — veraPDF's scope is PDF/A and PDF/UA, and using it to claim PDF/X compliance would be a category error. But the register records the rejection without preserving the tool's legitimate scope.

**EVIDENCE.** `DECISION_REGISTER.md` RJ04; `PDF_PREPRESS_RESEARCH.md` candidate table.

**WHY IT MATTERS.** If the archive tier ever promises PDF/A conformance for long-term preservation — a plausible and attractive claim for a newspaper archive product — veraPDF becomes the correct open-source instrument, and a flat "rejected" entry will cause someone to re-derive that from scratch or avoid it wrongly.

**RECOMMENDED CORRECTION.** Amend RJ04 to read: rejected as a PDF/X validator (out of scope by design); retained as a candidate for PDF/A and PDF/UA verification should archival-conformance or accessibility claims enter scope.

**MASTER BUILD SPEC CHANGE REQUIRED:** No.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M03 — MEDIUM — news-please should be classified REFERENCE, not RESEARCH FURTHER; and one recorded observation needs re-verification

**ISSUE.** DEP38 classifies news-please as RESEARCH FURTHER. Independent verification of the package metadata (PyPI JSON API, retrieved during this review) supports a firmer and different conclusion.

**EVIDENCE — independently verified, not taken from the corpus.** The published distribution's `requires_dist` unconditionally includes database, search and cloud clients — PyMySQL, psycopg2-binary, elasticsearch, redis, boto3 — plus warcio. These are not extras; they are hard dependencies, installed even for extraction-only use. The extraction itself is substantially an ensemble over newspaper4k and readability-lxml rather than a novel extractor.

**Discrepancy requiring re-verification:** the PyPI JSON API reports an upload time of 2024-01-19 for version 1.6.16, whereas `NEWS_INTELLIGENCE_RESEARCH.md` records 2025-09-21. I am not asserting the corpus is wrong — the discrepancy may reflect a different version, a re-upload, or a different field — but it is exactly the kind of recorded observation that should carry its retrieval method and be re-checked before it informs a decision.

**WHY IT MATTERS.** Adopting news-please as a library imports a database client, a search client and a cloud SDK into the dependency tree of a service that already has its own choices for all three. That is a supply-chain and operational cost with no offsetting benefit, since the valuable part — extraction heuristics and crawl orchestration patterns — is available directly from its own upstreams.

**RECOMMENDED CORRECTION.** Reclassify DEP38 news-please as **REFERENCE** (study its pipeline design, crawl politeness handling and extraction ensembling), with targeted **ADOPT** of Trafilatura and/or newspaper4k for extraction and feedparser for feeds, evaluated on a Devanagari/Urdu corpus specifically — extraction quality on Indian-language news sites is not established by any English-corpus benchmark. Add a `verified_on` date and retrieval method to dependency registry rows (see L04).

**MASTER BUILD SPEC CHANGE REQUIRED:** No.
**RESEARCH NEEDED:** Language-specific extraction benchmark within existing RD07/RD08.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M04 — MEDIUM — Hyphenation is listed as a copyfit lever for languages where it barely applies

**ISSUE.** The typography research lists libhyphen among candidates without noting that usable hyphenation patterns for Hindi and Marathi effectively do not exist, and that Devanagari justification in practice relies on inter-word spacing, controlled tracking and editorial rewriting rather than hyphenation.

**EVIDENCE.** `TYPOGRAPHY_RESEARCH.md` candidate table; `PHASE_3_PUBLISHING_ENGINE.md` copyfit discussion.

**WHY IT MATTERS.** This changes the copyfit design, not just a dependency choice. If hyphenation is unavailable for the primary pilot language, the composition engine's justification quality depends much more heavily on its spacing model and its willingness to report an infeasible fit — and the product's copyfit feature must lean on editorial suggestions (trim a word, tighten a deck) rather than automatic hyphenation. Designing copyfit around a lever that does not exist for Marathi would be a real, discoverable-late error.

**RECOMMENDED CORRECTION.** Record per-language availability of hyphenation explicitly in the language/font matrix, and state in §4 that copyfit strategy is language-dependent, with hyphenation available only for languages with qualified patterns. Add to RD19 below.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §4 (minor).
**RESEARCH NEEDED:** Folded into RD19.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M05 — MEDIUM — Urdu Nastaliq is treated as equivalent in difficulty to other supported scripts; it is not

**ISSUE.** Urdu is listed alongside English, Hindi and Marathi as a first-class requirement, with no distinction between Naskh and Nastaliq styles. Nastaliq — which is what Urdu newspaper readers expect — has sloped baselines within a word, extreme vertical extents, contextual collision avoidance, and justification by kashida elongation rather than word spacing.

**EVIDENCE.** `TYPOGRAPHY_RESEARCH.md` language acceptance table; Master Build Spec §4.

**WHY IT MATTERS.** Nastaliq support is a property of both the font and the layout engine, and several otherwise-excellent paragraph layers handle it poorly or not at all. Line-height computation, collision handling and kashida justification are not incremental work on top of a Naskh implementation. If Nastaliq is in pilot scope, it materially constrains the paragraph-layer choice in RD01/RD02; if it is not, saying so early removes a large risk.

**RECOMMENDED CORRECTION.** Split the Urdu requirement into Naskh and Nastaliq as separately-qualified matrix entries. Require RD02 to test Nastaliq explicitly against candidate paragraph layers before any commitment. Make Nastaliq pilot scope an explicit question to the owner within PO02.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §4 (language matrix granularity).
**RESEARCH NEEDED:** Within RD02, made explicit.
**PRODUCT OWNER INPUT NEEDED:** Yes — within PO02.

---

## M06 — MEDIUM — The instruction not to create CLAUDE.md / AGENTS.md is wrong for an agent-driven build

**ISSUE.** `PHASE_16_REPOSITORY_DEVELOPMENT.md` states "Do not create CLAUDE.md or AGENTS.md at this stage." The same document establishes a development process explicitly built around agent sessions with targeted file references and dependency-aware context expansion.

**EVIDENCE.** `PHASE_16_REPOSITORY_DEVELOPMENT.md`.

**WHY IT MATTERS.** These files are the mechanism by which the process the document describes is actually enforced. Without them, every agent session rediscovers the repository conventions, the do-not-modify list, the decision-register authority rule and the path conventions — by reading documentation, at full token cost, every time. Since the corpus explicitly asks for ways to minimize token and context waste, this instruction works directly against a stated goal.

**RECOMMENDED CORRECTION.** Reverse it. Create a short root-level agent instruction file at RM01 containing only: repository map, the authority hierarchy (decision register is authoritative for decision status), the do-not-modify list, the one-feature/one-branch/one-spec rule, and where to look before expanding context. Add path-scoped files under `publishing/`, `frontend/` and `docs/` as those areas acquire rules. Keep them short — a long instruction file is a token cost paid on every session and is the failure mode to avoid, not the files themselves.

**MASTER BUILD SPEC CHANGE REQUIRED:** No.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M07 — MEDIUM — A 19-layer test architecture is overengineered for the UI-only phase

**ISSUE.** Phase 14 defines nineteen verification layers before any code exists. For RM01/RM02, which produce a simulated UI with no engine, no tenancy and no real data, most of those layers have no subject.

**EVIDENCE.** `PHASE_14_TESTING_VALIDATION.md`; `IMPLEMENTATION_ROADMAP.md` RM01/RM02 scope.

**WHY IT MATTERS.** The layer set is excellent as a *destination*. Presented as a starting obligation it will either be ignored — which erodes the credibility of the whole testing document — or complied with, which burns effort on publishing oracles and release-race suites for a product that has neither. The corpus is otherwise very good at staging obligations to gates; this one was not staged.

**RECOMMENDED CORRECTION.** Map each of the nineteen layers to the earliest gate at which it becomes applicable, and state a minimal tier for the UI phase: component tests, accessibility checks, a small set of journey-level UI E2E tests, and fixture-reset integrity. Everything else activates at G2 or later, by gate.

**MASTER BUILD SPEC CHANGE REQUIRED:** No.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M08 — MEDIUM — Signed URLs versus an authenticated gateway is presented as a choice, but the archive requirements have already made it

**ISSUE.** Phase 12 offers both signed URLs (bearer capabilities) and an authenticated download gateway, noting the gateway is needed "for content requiring immediate revocation". Phase 11 then requires that rights revocation restrict subsequent access and reprint. Those two statements together decide the question for released masters, but the register does not record the decision.

**EVIDENCE.** `PHASE_12_SECURITY_TENANCY.md`; `PHASE_11_DATA_REVISION_ARCHIVE.md` AR07 clarification.

**RECOMMENDED CORRECTION.** Record the decision: released print masters and rights-bearing archive members are served through an authenticated gateway that checks current grants at request time. Signed URLs remain acceptable for non-rights-bearing, short-lived, low-sensitivity artifacts such as UI thumbnails of a user's own in-progress work. Note the operational consequence — the gateway is on the bandwidth path for large PDFs and must be designed for streaming, not buffering.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §9 (minor).
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M09 — MEDIUM — Deferring RPO/RTO to "agree with the first customer" defers a constraint on storage architecture

**ISSUE.** Phase 11 declines to invent an SLA and says recovery objectives will be agreed with the first customer. The refusal to invent is right; the consequence is that a decision which constrains replication topology, backup frequency and storage-tier selection has no working value at all.

**EVIDENCE.** `PHASE_11_DATA_REVISION_ARCHIVE.md` retention/DR section.

**RECOMMENDED CORRECTION.** Set **provisional internal engineering targets**, clearly labelled as internal design assumptions and not customer commitments, so that RM03 and RM13 have something to design against. A defensible provisional pair for a daily newspaper: RPO measured in minutes for editable working state, effectively zero data loss for committed releases, and RTO within one publication cycle. Revise on contact with the first customer.

**MASTER BUILD SPEC CHANGE REQUIRED:** No.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** Eventually; not blocking.

---

## M10 — MEDIUM — RM05 gates all news work behind G2, blocking low-risk modelling

**ISSUE.** RM05 depends on G2 (safe real-data platform). That is correct for ingesting third-party content. It is unnecessarily restrictive for modelling owned and manually-entered content, which carries no third-party rights risk.

**EVIDENCE.** `IMPLEMENTATION_ROADMAP.md` RM05 dependency column, which itself says "Owned/manual content first" while gating the whole lane on G2.

**RECOMMENDED CORRECTION.** Split RM05 into RM05a (owned/manual content modelling, provenance and rights primitives — available before G2, since it handles no external content) and RM05b (contracted external sources, extraction, dedup, events, AI — requires G2 and per-source permission). This matches the lane's own stated sequencing.

**MASTER BUILD SPEC CHANGE REQUIRED:** No (roadmap change).
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M11 — MEDIUM — Backlog unit UI026 is a single integration unit depending on twenty other units

**ISSUE.** UI026 depends on UI005–UI025. A unit with twenty-one dependencies is not a unit; it is a phase, and it violates the corpus's own rule against implementing an entire lane in one feature branch.

**EVIDENCE.** `specs/INITIAL_IMPLEMENTATION_BACKLOG.md` UI026; `IMPLEMENTATION_ROADMAP.md` feature-delivery section.

**RECOMMENDED CORRECTION.** Split into per-journey walkthroughs, each depending only on the units that journey actually traverses — for example: onboarding-to-first-edition; desk assignment to placed story; generation to sample export; release to archive retrieval; failure and denial paths. Each becomes an independently completable and independently demonstrable unit.

**MASTER BUILD SPEC CHANGE REQUIRED:** No (backlog change).
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## M12 — MEDIUM — Several OPEN items are technically decidable now, and leaving them open has a recurring cost

**ISSUE.** The register's caution is generally a virtue, but a decision left open is re-argued in every feature spec that touches it. At least four items have sufficient evidence to be decided today: OP12 frontend stack (React/TypeScript/Vite is recorded and nothing in the corpus challenges it); RD05 numeric unit (M01); the signed-URL/gateway question (M08); and the API↔engine seam (H01).

**EVIDENCE.** `DECISION_REGISTER.md` OP12, RD05; `PHASE_12_SECURITY_TENANCY.md`; `PHASE_2_SYSTEM_ARCHITECTURE.md`.

**WHY IT MATTERS.** The corpus reports "4 critical unresolved decisions, 12 research workstreams, 5 blocking owner questions" as a headline. That framing implicitly treats openness as neutral. It is not: each open item is a recurring tax on every future specification. Openness should be reserved for items where a wrong choice is expensive and the evidence is genuinely absent — which is true of RD01, RD03 and the new RD13, and not true of the four above.

**RECOMMENDED CORRECTION.** Lock the four items named above (see Section M of this review for the full list of decisions I consider safe to lock, with justification). Keep genuinely evidence-blocked items open.

**MASTER BUILD SPEC CHANGE REQUIRED:** Yes — §11 counters.
**RESEARCH NEEDED:** No.
**PRODUCT OWNER INPUT NEEDED:** No.

---

## L01 — LOW — Documentation phase numbering collides with product phase numbering

The architecture documents are numbered Phase 1–24; the original product context §56 numbers a product roadmap P0–P17; the roadmap uses RM01–RM18 and G0–G7. Three concurrent numbering schemes with overlapping ranges will cause misreference. Recommend retiring the documentation "Phase N" prefix in favour of topic names once the program is accepted, keeping RM/G as the only sequencing identifiers.

## L02 — LOW — Product name inconsistency

The repository directory is `Paginator`; the documents consistently say `Pageinator`. Resolve before any code, package name, domain or identifier is created, because it will otherwise propagate into module paths and be expensive to unpick.

## L03 — LOW — Gates G0–G7 have no named approver

Each gate specifies required evidence but not who is authorized to declare it met. For G3 (publishing qualification) and G6 (press acceptance), the approver is arguably external. Add an approver column.

## L04 — LOW — The dependency registry has no verification date or method per row

Sixty-four rows of licence, maintenance and capability claims will drift, and M03 demonstrates that at least one recorded observation is already in question. Add `verified_on` and `verified_how` columns, and treat rows older than a defined interval as stale when used to justify a decision.

## L05 — LOW — The Phase 2 deployment diagram depicts a shape that is still open

The mermaid diagram renders a topology while OP11 (modular monolith) and OP13 (runtime) remain open. Diagrams are read as decisions regardless of surrounding prose. Label it illustrative, or redraw it as a logical-boundary diagram with no deployment implication until OP11/OP13 close.

## L06 — LOW — The risk register lacks owner and mitigation-status fields

K01–K30 are well chosen but static. Add owner, current mitigation status and the gate at which each risk is expected to be retired, so the register becomes an instrument rather than a list.

---

# PART II — REQUIRED SECTIONS A–T

## A. EXECUTIVE ASSESSMENT

Astra's 24-phase program is a strong, unusually honest piece of pre-implementation architecture. Its defining virtue is epistemic: it distinguishes what is decided from what is open from what needs evidence from what was rejected, it names the physical press as the real acceptance authority rather than a proxy for it, it refuses to convert a plausible library into a commitment, and it repeatedly declines to invent facts it does not have. Those habits are rarer and more valuable than any individual technical choice in the corpus, and they should be preserved without dilution.

The program is nevertheless not yet an implementation blueprint. Its single most important invariant — that the browser preview and the PDF consume the same resolved geometry — is asserted without a testable definition, and as written it is in direct tension with the interactive editing latency the product requires (C01, C02). The decision that most constrains whether that invariant is even satisfiable — the publishing engine's implementation language and whether it can run in the browser — is owned by no decision item while having been silently pre-determined by the dependency registry (C03). And three concrete realities of the target customer's daily production are absent: legacy non-Unicode Indian font encodings (C04), per-page press colour availability and the flat plan (C05), and customer-supplied PDF advertisements (C06). The last two are fidelity failures against the owner's own stated strategic IP, not judgement calls.

Alongside those, a quieter pattern: in several places the corpus's admirable caution has become under-decision. Items with sufficient evidence to be settled — the canonical numeric unit, the frontend stack, the signed-URL-versus-gateway question, the API-to-engine seam — remain open, which guarantees they will be re-argued at full cost in every feature specification that touches them. Openness is not free, and the corpus's own headline counters implicitly treat it as though it were.

**Overall verdict: NOT READY to authorize implementation as written; READY after a bounded set of corrections that are mostly specification work and can be completed on paper.** Six CRITICAL findings, fourteen HIGH, twelve MEDIUM, six LOW. The UI foundation work (RM01) can be authorized ahead of most of this, provided the durable-versus-disposable classification in H07 is applied first and the provisional-versus-committed geometry language in C02 is settled, because those two things determine whether the UI phase produces learning or debt.

---

## B. WHAT ASTRA GOT RIGHT

This section is long deliberately. An adversarial review that only lists faults misrepresents the artifact under review.

1. **The shared-resolved-geometry invariant itself (D03) is the correct central commitment.** Every competing architecture — independent browser reflow, "PDF as the source of truth", or best-effort preview — produces a product that lies to its user. The invariant is underdefined (C01), not wrong. It should be sharpened, never weakened.

2. **Exact-revision export (D05/R36/RJ02) — never rerun the original generation — is right and is the kind of rule that is easy to get wrong.** Most systems regenerate on download. Binding final bytes, report, profile and approval together is what makes the archive defensible.

3. **Archive-before-download (AR17).** Committing the archive before exposing the print master is a small ordering rule with enormous consequences, and getting it right pre-implementation is a genuine win. So is keeping press receipts and physical-print observations as append-only records *outside* the immutable manifest.

4. **The release/revocation race analysis (AR07) is excellent.** Recognising that a permission check before object staging is insufficient, and that final commit must serialize against revocation or use compare-and-retry, is a depth of reasoning most architectures reach only after a production incident.

5. **Object storage and database are not one atomic transaction.** The staged-then-committed protocol with an outbox, a reconciler, stable release IDs and attempt-specific temporary keys is correct in every particular.

6. **The three retrieval promises are separated with real precision.** Exact byte retrieval, view/proof, and editable restoration are genuinely different promises with different feasibility, and conflating them is the standard way archive products over-promise. The explicit refusal to promise byte-identical recomposition years later is honest and commercially wise.

7. **Tenant isolation as an early, structural concern (D04) rather than an RM14 afterthought.** The roadmap's line "Never wait for the multi-user lane to implement tenant isolation" is exactly right. RLS as defence-in-depth with non-owner, non-BYPASSRLS roles and transaction-local tenant context is the correct pattern.

8. **AR14's tenant scoping of news observations, entitlements, clusters, embeddings and search results.** The observation that a shared URL or content hash is not authority to share licensed content across organizations is subtle and important, and it is the kind of thing that leaks by default in naive designs.

9. **The AI boundary (D02) and the NEVER-delegate list.** Glyph placement, line breaking, geometry, overset, effective resolution, colour conversion, font embedding, PDF structure, mandatory preflight, rights grants, access control, billing arithmetic, release approval and archive integrity must never be sole-sourced to a model. This list is correct and close to complete; I would add only "page colour capability" (C05) and "whether text was converted from a legacy encoding" (C04). Treating retrieved content as data with no tool authority is likewise correct.

10. **Fail-closed preflight.** Timeout, unavailability, expired licence or malformed report is a failure, not green. This is the single most valuable sentence in §7, and it is the opposite of what most integrations do by default.

11. **The HYBRID preflight split.** Pageinator owning source-model, content-coverage, overset, geometry, ad and rights/revision checks, with a commercial engine owning final-byte conformance, is the right division. C05 supplies the cleanest possible illustration of why: no external PDF engine can know whether a page can print in colour.

12. **The refusal to treat PDF/X-4 as universal.** Recognising that the output target is a press-specific negotiated profile, not a standard chosen in advance, reflects real prepress experience.

13. **The warning against rasterizing all uploaded PDFs.** Correct, and it is the reason C06 is a gap rather than a disagreement — Astra identified the requirement and simply did not carry it into the candidate evaluation.

14. **Scraping capability is not republication rights.** The rights model — action-scoped grants with evidence, licensor, territory, attribution, embargo, validity, revocation and retention, defaulting unknown material to discovery-only — is the most commercially protective part of the entire corpus.

15. **news-please was not adopted on reputation.** The corpus recorded observed evidence and declined to commit. My independent verification (M03) refines the conclusion but validates the caution; the alternative — adopting it because it is the well-known package — would have imported a database client, a search client and a cloud SDK into the core.

16. **Grapheme clusters, shaping clusters and glyphs are distinguished.** Most systems conflate these and then produce caret and selection bugs in Indic and Arabic text forever. Requiring caret and selection mappings as first-class outputs of the paragraph layer is correct.

17. **No silent font substitution.** Blocking unsupported font/script pairs rather than substituting is the right call and should survive the pressure C04 will place on it.

18. **Effective PPI computed from usable pixels over physical placement, not EXIF DPI.** Correct, and a common source of wrong warnings in competing products.

19. **Original preservation with derived renditions, and assign-versus-convert discipline for ICC profiles.** Both correct and both frequently botched.

20. **UI-first as a strategy.** Given genuine uncertainty about the engine, building the workflow first — with simulation labels, denial and error and stale and cancel states, and resettable multi-tenant fixtures — extracts real product learning at low cost and without pretending. The insistence that simulated states be *labelled* as simulated is what makes it honest rather than a demo.

21. **Gate discipline, and specifically the "what this does NOT prove" column.** That column is the best single structural idea in the roadmap. It prevents the universal failure mode where passing an early gate is quoted as evidence for a later claim.

22. **One feature, one branch, one spec, one fresh session, with targeted file references and dependency-aware context expansion.** This is the correct development architecture for an agent-assisted build, and the explicit prohibition on implementing an entire roadmap lane in one branch is well judged.

23. **Astra's own adversarial self-review found genuinely hard things** — AR05 (numeric precision), AR06 (edition-local revisions), AR07 (release race), AR08 (paragraph layer), AR14 (tenancy of derived news data), AR17 (archive ordering). Self-review that finds real defects rather than cosmetic ones is uncommon.

24. **The corpus does not invent product-owner preferences.** PO01–PO11 ask rather than assume. Given how much of this architecture depends on customer-specific facts, that restraint is worth more than any individual technical decision.

---

## C. CRITICAL ERRORS

Full detail in Part I. Summary:

| ID | Error | Consequence if uncorrected |
|---|---|---|
| C01 | The shared-geometry invariant has no testable definition — no unit, tolerance, prohibited-operation list or instrument | The product's central promise cannot be verified at any gate; drift is discovered in print |
| C02 | Server-authoritative resolution plus a no-client-shaping rule plus interactive latency targets are mutually unsatisfiable for text-affecting operations | Either the editor is unusable for its core operation, or the invariant is quietly broken |
| C03 | No decision item owns the publishing engine's implementation language, packaging or WASM availability; the dependency registry has chosen C++ by omission | The decision that determines whether C02 option (i) exists is being made by accident |
| C04 | Legacy non-Unicode Indian font encodings are absent from the entire corpus | Customer brand fonts and historical archives cannot be onboarded; discovered during the pilot |
| C05 | Per-page press colour availability and the flat-plan/news-hole artifact are absent | A physically wrong newspaper passes every check in the system; a named strategic-IP requirement is dropped |
| C06 | No candidate is evaluated for PDF advertisement import fidelity, despite the requirement being stated three times | Ads are rasterized, re-created by hand, or bypass the archive — any of which breaks the value proposition |

---

## D. HIGH-PRIORITY CORRECTIONS

| ID | Correction | Must precede |
|---|---|---|
| H01 | Specify the API↔engine seam as an isolated, resource-limited, separately-deployed worker with a versioned contract; decouple it from the runtime choice | RM03, RD13 |
| H02 | Prohibit in-place modification of approved PDF bytes; any fixup creates a new candidate, revokes prior approval, and re-validates | RM10/RM11 |
| H03 | Resolve the deadline-versus-fail-closed collision explicitly: architected escape with a non-conforming release class, or a stated no-escape product contract | RM02 (UI must show it), G5 |
| H04 | State that all rendered outputs derive from one ResolvedDocument digest; no output path may re-compose text | RM10 |
| H05 | Add a multilingual search and indexing research item; version index analysis configuration | RM13 |
| H06 | Define duplicate-edition and reprint as first-class operations with lineage, rights re-evaluation and profile pinning rules | RM13 |
| H07 | Classify every backlog unit DURABLE or DISPOSABLE-BY-DESIGN | RM01 |
| H08 | Decide lease granularity (page-level recommended) and make linked-flow consequences server-computed and notified | RM06 |
| H09 | Treat fonts as rights-bearing assets with action-scoped grants; research SaaS font licensing | RM07 |
| H10 | Decide audit tamper-evidence, retention and exportability; bind approval-chain digest into the release manifest | RM13 |
| H11 | Define a default pilot matrix so RM04 is not blocked on PO02–04 | RM04 |
| H12 | State the advertising scope boundary: constraints consumed, ad sales not owned | RM02 |
| H13 | Add warn/block effective-PPI thresholds to PrintProfile; separate quality findings from conformance defects | RM09 |
| H14 | Promote AR06/AR07/AR14/AR17 to numbered decisions | Immediately |

---

## E. MISSING REQUIREMENTS

Requirements present in the original product context or in the operational reality of the target customer, and absent or materially under-treated in the architecture.

| # | Missing requirement | Source | Severity |
|---|---|---|---|
| E1 | Legacy non-Unicode Devanagari encodings in content, archives and brand fonts | Customer reality; India-specific | CRITICAL (C04) |
| E2 | Per-page press colour availability; signature/imposition structure | Press reality; implied by §7 strategic IP | CRITICAL (C05) |
| E3 | Flat plan / page plan / news-hole calculation as a first-class artifact | `ORIGINAL_PRODUCT_CONTEXT.md` §7 names news-hole calculation as strategic IP | CRITICAL (C05) |
| E4 | Customer-supplied PDF advertisement import with fidelity | Master Build Spec §7 states the requirement; no candidate evaluated | CRITICAL (C06) |
| E5 | Replate / edition variants across print runs (city edition vs district edition; late-news replates) | Standard Indian newspaper practice; absent entirely | HIGH — see PO12 |
| E6 | Deadline failure behaviour and escape authority | Newspaper reality; collides with the no-waiver rule | HIGH (H03) |
| E7 | Duplicate-edition and reprint semantics | `ORIGINAL_PRODUCT_CONTEXT.md` §27 | HIGH (H06) |
| E8 | Multilingual archive search analysis (Devanagari/Urdu) | `ORIGINAL_PRODUCT_CONTEXT.md` §31 | HIGH (H05) |
| E9 | Font licensing for server-side composition and archival retention | Implied by Edition Package; no owner | HIGH (H09) |
| E10 | Advertising scope boundary (bookings consumed vs ad sales owned) | `ORIGINAL_PRODUCT_CONTEXT.md` §7 vs Phase 11 model | HIGH (H12) |
| E11 | Minimum effective-PPI policy source and warn/block semantics | `IMAGE_COLOR_RESEARCH.md` gives an example, not a policy | HIGH (H13) |
| E12 | E-paper/digital edition derivation rule | `ORIGINAL_PRODUCT_CONTEXT.md` §55 priority 5 | HIGH (H04) |

**Distorted requirements:** none found of consequence. Astra's normalization of R01–R48 tracks the original context faithfully where it covers it.

**Unjustified scope expansion:** minimal, and this is to Astra's credit. The nearest candidates are the 19-layer test architecture as an immediate obligation (M07) and the breadth of the AI architecture relative to pilot needs — both are correctly-designed destinations presented without staging, not invented scope.

**Prematurely deferred requirements:** lease granularity (H08, deferred to RM14 but constrains RM06), tenant-scoped search design (H05), and news modelling for owned content (M10).

---

## F. ARCHITECTURE ISSUES

### F.1 Invariant classification

Each architectural invariant asserted by the corpus, classified as requested.

| Invariant | Classification | Note |
|---|---|---|
| Browser preview and PDF consume the same resolved geometry (D03) | **UNDERSPECIFIED** | Correct in intent; no unit, tolerance, prohibited-operation list or instrument (C01) |
| Resolution is server-authoritative (OP14) | **TOO STRONG as stated** | Must be split into provisional vs committed geometry or it forbids a usable editor (C02) |
| Export never reruns the original generation (D05/RJ02) | **CORRECT** | One of the strongest decisions in the corpus |
| Only one text composer exists in the system | **TOO WEAK** | Stated for PDF; must be generalized to all rendered outputs including e-paper and proofs (H04) |
| No silent font substitution | **CORRECT** | Must survive the pressure C04 will place on it |
| Mandatory preflight defects cannot be waived | **CORRECT but incomplete** | Needs the quality-vs-conformance distinction (H13) and a deadline answer (H03) |
| Preflight engine failure is a failure, not green | **CORRECT** | Keep verbatim |
| Archive commitment precedes exposure of the print master (AR17) | **CORRECT** | Promote to a numbered decision (H14) |
| Tenant isolation is structural and early (D04) | **CORRECT** | Best-sequenced invariant in the corpus |
| AI proposes, humans accept, deterministic systems own physical correctness (D02) | **CORRECT** | Add page colour capability and legacy-conversion provenance to the never-delegate list |
| Retrieved content is data, never instructions, with no tool authority | **CORRECT** | Keep verbatim |
| Immutable release packages with pinned dependencies | **CORRECT** | Font licensing may limit it in practice (H09) |
| Byte-identical recomposition is not promised | **CORRECT** | Commercially wise |
| Scraping capability is not republication rights | **CORRECT** | Keep verbatim |
| Locks are respected during bounded regeneration | **INCORRECT as an absolute** | Press colour capability must outrank a user lock (C05) |
| Integer micro-points as canonical unit | **INCORRECT as a default** | Millipoints; see M01 arithmetic |

### F.2 Document and publishing engine — hidden complexity not yet surfaced

The EditableDocument/ResolvedDocument split is right. The complexity the corpus has not yet costed sits in five places:

1. **Linked-flow cascades across lease boundaries.** A single word added on page 3 can push a paragraph to page 7. This is simultaneously a layout problem, a concurrency problem (H08) and a notification-UX problem, and it is the hardest interaction in the product. It currently appears only as a test case in Phase 14, not as a designed mechanism.
2. **Bounded regeneration with locks is a constraint-satisfaction problem with no guaranteed solution.** The corpus rightly requires infeasibility to be reported rather than hidden. It does not yet say what the engine does when the constraint set is over-determined — which is the normal case near deadline, not the exception. An explicit infeasibility taxonomy (which constraint class yielded, and why) is needed for the UI to be usable.
3. **Copyfit and headline fitting are editorial, not typographic, operations.** Tracking and scaling have hard limits that Indian display typography reaches quickly, and hyphenation is largely unavailable for Marathi (M04). The honest design is that copyfit *proposes* editorial actions and only applies bounded, profile-limited typographic adjustment.
4. **Overset must be a first-class, exportable state**, not a rendering artifact. The corpus says text must never be silently dropped; the mechanism is that overset is part of the ResolvedDocument and a named preflight rule, which should be stated rather than implied.
5. **Revision reproducibility is bounded by dependency availability, not by the schema.** Phase 11 says this well for fonts and engines; C04 adds encoding conversion tables to the list of things that must be retained for a restoration to mean anything.

### F.3 Browser editor technology — premature rejection and premature narrowing

The browser-editor research is good and correctly refuses to select. Two observations:

- **No approach has been prematurely rejected.** DOM/SVG/Canvas/WebGL/WebGPU/WASM/hybrid are all fairly characterized. I agree with Astra that a hybrid (DOM chrome, accelerated canvas page surface, accessible DOM shadow for text) is the likely destination, and I agree it should not be locked yet.
- **The narrowing that has occurred is elsewhere and is unacknowledged:** by requiring that the editor consume resolved scenes and forbidding client shaping, the corpus has already eliminated every DOM-text-based approach for the page surface, because DOM text implies browser line breaking. That is probably the right elimination, but it should be recorded as a decision with its accessibility consequence named — the accessible text representation must then be constructed deliberately from the resolved scene's source mappings, which is real work that no backlog unit currently owns.

### F.4 Data, revision and archive

Strong overall (see B). Gaps: duplicate/reprint semantics (H06), audit integrity (H10), search projections (H05), provisional RPO/RTO (M09), and the absence of an EditionPlan aggregate (C05). One further note: Phase 11's snapshot-plus-bounded-command-history recommendation, with an explicit rejection of full event sourcing, is correct and should be locked rather than left as a recommendation.

### F.5 Overengineering and underengineering

| Area | Classification |
|---|---|
| 19-layer test architecture as an immediate obligation | OVERENGINEERED FOR CURRENT NEEDS — stage by gate (M07) |
| AI architecture breadth relative to pilot scope | OVERENGINEERED FOR CURRENT NEEDS — correct destination, needs staging |
| Micro-point numeric precision | OVERENGINEERED — precision below any physical referent, at real overflow cost (M01) |
| Full event sourcing (explicitly rejected) | CORRECTLY DEFERRED — rejection is right |
| CRDT collaborative editing (not mandated) | CORRECTLY DEFERRED — leases plus revision checks are sufficient for this workflow |
| Multi-region / high-availability topology | CORRECTLY DEFERRED |
| Geometry conformance definition | UNDERENGINEERED FOR FINAL PRODUCT — and needed now (C01) |
| Engine language and packaging | DANGEROUSLY DEFERRED — being decided by accident (C03) |
| Legacy encoding handling | DANGEROUSLY DEFERRED — absent entirely (C04) |
| Press colour and flat plan | DANGEROUSLY DEFERRED — produces physically wrong output that passes all checks (C05) |
| PDF ad import | DANGEROUSLY DEFERRED — requirement stated, capability unevaluated (C06) |
| Lease granularity | DANGEROUSLY DEFERRED — constrains RM06 schema (H08) |
| Deadline escape behaviour | DANGEROUSLY DEFERRED — will be escaped invisibly if unarchitected (H03) |
| Font licensing | DANGEROUSLY DEFERRED — can invalidate the restoration promise (H09) |

---

## G. PUBLISHING, TYPOGRAPHY AND PDF ISSUES

### G.1 Typography

The typography research is the strongest research artifact in the corpus. The primitive stack (HarfBuzz for shaping, FreeType for font access and rasterization, ICU for Unicode/BiDi/segmentation) is the correct and effectively uncontested choice for a production system, and I would lock it rather than leave it open — the alternatives are either incomplete or research-grade. The distinction between grapheme clusters, shaping clusters and glyphs, and the requirement that caret and selection mappings be first-class outputs, is exactly right and is the difference between an editor that works in Devanagari and one that produces cursor bugs forever.

Open issues:

- **Paragraph-layer choice (AR08) is the real decision, and it is correctly open.** Pango (LGPL-2.1+) and SkParagraph (BSD-style, with a glyph/position/font/source-offset visitor) are both credible. The licence difference matters more than the corpus states: LGPL in a natively-linked, possibly WASM-compiled engine has relinking obligations that are awkward in a WASM build specifically. That interacts with C03/RD13 and should be evaluated jointly, not separately.
- **Nastaliq is not equivalent to other scripts (M05)** and must be a separately-qualified matrix entry, because it constrains the paragraph-layer choice.
- **Hyphenation is largely unavailable for Marathi and Hindi (M04)**, which changes the copyfit design, not just a dependency row.
- **Legacy encodings (C04)** are absent entirely and are the most likely cause of an onboarding failure with a real Indian customer.
- **Font licensing (H09)** is treated as storage; it is licensing.
- Justification quality for Devanagari — which depends on spacing models and optional inter-word adjustment rather than hyphenation — has no acceptance criterion. Native-reviewer acceptance is required in the roadmap but not defined as a measurable artifact. Recommend a scored native-reviewer rubric per language, recorded as evidence, rather than a binary sign-off.

### G.2 PDF and prepress

The corpus's central prepress judgement — that the real acceptance criterion is a printing press accepting the file, and that PDF/X-4 is a candidate rather than a universal target — is correct and unusually mature.

On the open-source-versus-commercial question, my independent assessment agrees with Astra's direction but is firmer on one point and softer on another:

- **Firmer:** for *final-byte conformance validation*, there is no credible open-source substitute for callas pdfToolbox or Enfocus PitStop Server. Ghostscript is a converter whose transformations are themselves a risk; qpdf is structural only; veraPDF is scoped to PDF/A and PDF/UA (M02). Treating commercial preflight as a probable purchase rather than an open question would save research effort. PO04 should be framed as "confirm budget", not "decide whether to spend".
- **Softer:** for *writing* the PDF, the case for a commercial writer is weaker than the corpus implies, because the writer's job under the shared-geometry invariant is unusually narrow — it places pre-positioned glyphs with pre-subset fonts, pre-converted images and explicit colour, and performs no composition of its own. That is a much smaller surface than a general-purpose PDF library serves, and it is the kind of component where a focused implementation over a low-level primitive is defensible. RD01 should evaluate a narrow purpose-built writer as a first-class option, not only as a fallback.
- **C06 is the gap that matters most here.** The one thing the writer *cannot* do narrowly is import a third-party PDF advertisement with fidelity. That single requirement may be what forces a commercial writer/import tier, and it is currently invisible in PO04's budget framing.
- **Fixup governance (H02)** is missing and is the most likely way the exact-revision invariant gets broken in production.
- **Transparency, overprint and spot colour in imported ads** interact badly with flattening and with output-intent conversion. The corpus mentions all three concepts but does not state the rule: imported ad colour and overprint intent must be preserved, not normalized, and any normalization is a recorded, authorized transformation.

### G.3 Browser/PDF consistency — what "same geometry" should mean

Answered normatively in C01. Restated in one sentence for the Master Build Spec's benefit: *same geometry* means both consumers receive the identical ResolvedDocument digest; neither performs measurement, shaping, fallback, breaking, justification or fitting; glyph identity, font instance identity, glyph origins, advances, offsets, line and frame boxes, clip geometry, z-order and image placement matrices are exactly equal in canonical integer millipoints; rasterization, antialiasing, hinting and screen colour may differ; and any glyph-origin divergence after unit conversion exceeding 25 µm is a conformance failure.

---

## H. NEWS INTELLIGENCE ISSUES

**Independent assessment of the news-please classification.** Astra classified DEP38 as RESEARCH FURTHER, on recorded evidence rather than reputation. That caution was warranted. My independent verification (M03) supports a firmer conclusion: **REFERENCE**, not ADOPT and not RESEARCH FURTHER, because the package's hard dependency set (PyMySQL, psycopg2-binary, elasticsearch, redis, boto3, warcio) is unacceptable for a service that has already chosen its own database, search and object storage, and because its extraction value is substantially an ensemble over upstreams that can be adopted directly. One recorded release-date observation in the corpus disagrees with the PyPI JSON API and should be re-verified before it informs anything (M03).

Per-capability classification for this domain:

| Capability | Recommended classification | Note |
|---|---|---|
| Crawl orchestration and politeness | REFERENCE news-please; ADOPT Scrapy if a general crawler is needed, else build narrow | Most pilot sources will be contracted feeds, not crawls |
| Feed parsing | ADOPT feedparser | Mature, tiny, BSD-2 |
| Article extraction | ADOPT Trafilatura and/or newspaper4k; benchmark on a Devanagari/Urdu corpus | No English benchmark transfers to Indian-language sites |
| Boilerplate removal fallback | REFERENCE Mozilla Readability | Useful as a second opinion in an ensemble |
| Exact and near-duplicate detection | ADOPT datasketch (MinHash/LSH) | Well-scoped, correct tool |
| Linguistic annotation | RESEARCH — spaCy coverage for Marathi and Urdu is materially weaker than for English | Do not assume parity |
| Dynamic-site rendering | ADOPT Playwright only where a contracted source requires it | Do not make headless browsing the default ingestion path |
| Event clustering | BUILD on adopted embeddings | Must be reversible and tenant-scoped (AR14) |

Other findings in this domain:

- **The rights model is the strongest part of the news architecture.** Action-scoped grants with default discovery-only for unknown provenance is exactly the right default, and it is the thing that keeps this product out of trouble.
- **AR14's tenant scoping of embeddings and clusters is correct and easy to violate.** It should be a numbered decision (H14), because a shared vector index is the natural implementation and it is the wrong one.
- **The explainable news score is under-specified.** The corpus requires explainability but does not state the invariant that the score's inputs are recorded with the score, so that an editor can be shown *why* at any later time. Without that, explainability degrades to a tooltip.
- **Source lineage and corrections handling is well conceived** — the requirement that upstream corrections propagate as reversible events rather than silent rewrites is right.
- **Owned/manual content should not be gated behind G2 (M10).**

---

## I. OPEN-SOURCE AND DEPENDENCY ISSUES

The 64-row dependency registry is a genuinely valuable artifact and its classification vocabulary (ADOPT / WRAP / BUY / REFERENCE / BUILD / RESEARCH / REJECT) is the right one. Issues:

1. **PDF page-import candidates are entirely missing (C06).** pdfium, Apache PDFBox and MuPDF/mutool should be evaluated. Their absence from a registry that found room for Ghostscript and veraPDF is an omission.
2. **DEP60's "language undecided" is not a dependency row; it is a missing decision (C03).**
3. **No row has a verification date or method (L04),** and M03 shows at least one recorded observation is already in question.
4. **Licence implications are recorded but not analysed against the deployment model.** LGPL (Pango, libvips) has different practical consequences for a server binary, a distributed native binary and a WASM module. AGPL (Ghostscript, MuPDF, iText) is disqualifying for a SaaS unless commercially licensed — the registry notes the licence but should state the consequence explicitly, because "AGPL" alone will be misread by an implementer as merely an attribution obligation.
5. **ProseMirror's meta-repository relocation is noted; the substantive question is not.** For this product, the semantic text input layer is *not* a document editor — it is a command source for text within a frame whose layout is computed elsewhere. That is a much smaller requirement than either ProseMirror or Lexical is built for, and adopting either may import a document model that competes with the canonical one. This deserves an explicit WRAP-or-BUILD analysis rather than a library comparison.

**Per-capability BUILD / ADOPT / WRAP / REFERENCE / BUY / RESEARCH summary:**

| Capability | Recommendation | Confidence |
|---|---|---|
| Text shaping | ADOPT HarfBuzz | High — lock it |
| Font access and rasterization | ADOPT FreeType | High — lock it |
| Unicode, BiDi, segmentation | ADOPT ICU | High — lock it |
| Paragraph layout | RESEARCH (Pango vs SkParagraph vs build over HarfBuzz+ICU) | Genuinely open; licence interacts with C03 |
| Line-break and justification policy | BUILD | Newspaper policy is product-specific |
| Copyfit and headline fitting | BUILD | Strategic IP per the owner |
| Layout, columns, linked flows, overset | BUILD | Strategic IP; no library matches newspaper semantics |
| Flat plan and news-hole | BUILD | Strategic IP (C05) |
| Image processing | ADOPT libvips (note LGPL) | High |
| Colour management | ADOPT LittleCMS | High |
| PDF writing (resolved primitives only) | RESEARCH — narrow purpose-built writer is a credible first-class option | Open |
| PDF structural manipulation | ADOPT qpdf | High |
| PDF page import for ads | RESEARCH — pdfium / PDFBox / MuPDF / commercial PDI tier | Open and urgent (C06) |
| Domain preflight (coverage, overset, geometry, rights, page colour) | BUILD | Only Pageinator can do these |
| Final-byte PDF conformance | BUY (callas or Enfocus) | High — treat as a purchase, not a question |
| PDF/A or PDF/UA verification, if ever claimed | ADOPT veraPDF | Conditional (M02) |
| Browser 2D scene rendering | RESEARCH (Konva / Fabric / PixiJS / CanvasKit / custom) | Open; coupled to C02 |
| Semantic text input | WRAP or BUILD, not ADOPT wholesale | See item 5 above |
| Feed parsing | ADOPT feedparser | High |
| Article extraction | ADOPT Trafilatura / newspaper4k after Indian-language benchmark | Medium |
| Crawling framework | REFERENCE news-please; ADOPT Scrapy only if needed | Medium (M03) |
| Near-duplicate detection | ADOPT datasketch | High |
| Search engine and multilingual analysis | RESEARCH (RD17) | Open (H05) |
| Identity and authentication | ADOPT a managed provider or a mature server; do not build | High |
| Object storage | ADOPT (S3-compatible, but verify object-lock semantics rather than assuming API compatibility implies them) | High |
| Job queue and workers | ADOPT | High |
| Observability | ADOPT OpenTelemetry-based stack | High |
| Constraint solving for layout | BUILD narrow, deterministic; do not adopt a general solver | Medium — general solvers make infeasibility unexplainable |

---

## J. SECURITY AND TENANCY ISSUES

Phase 12 is solid. The decisions that must be architected **before** UI implementation, because retrofitting them is expensive or impossible:

1. **Organization as the tenant root, with publication-scoped authorization**, present in every identifier, API path and fixture from the first UI unit. Getting this wrong in mock data teaches the UI the wrong shape.
2. **IDs alone grant no access**, and organization-qualified foreign keys. This shapes API design and therefore mock contracts.
3. **The capability/permission matrix**, at least in outline, because the UI must render denied states from the beginning — which the backlog correctly already requires.
4. **Authenticated gateway for rights-bearing downloads (M08)**, because it changes the URL shape the UI uses.
5. **Hostile-input isolation boundary (H01)**, because it determines whether uploads are synchronous or job-based, which is directly visible in the UI.
6. **Support/operator access separation**, because impersonation and support views must be designed as first-class audited flows, not added later as a back door.

Additional findings:

- **Audit integrity (H10)** is a product feature here, not an ops concern.
- **Signed URLs as bearer capabilities** are correctly identified as revocation-hostile; the decision follows (M08).
- **Prompt-injection posture is correct** — retrieved content is data with no tool authority — and should be extended explicitly to *uploaded* content, including PDF metadata and image EXIF/XMP fields, which are a realistic injection vector into any AI-assisted metadata workflow.
- **Hostile media isolation** is well covered for images; the same discipline must apply to uploaded PDFs (C06), which are a considerably richer attack surface, and this is a further argument for the out-of-process engine boundary in H01.
- **Tenant-negative testing across storage, jobs and search** as a G2 requirement is exactly right and is the kind of thing usually discovered missing after a leak.

---

## K. UI-FIRST STRATEGY ISSUES

**Does UI-first create unnecessary future rewrites?** Mostly no, and I agree with Astra that it is the right strategy under this much engine uncertainty. It creates rewrites in exactly one place — the sample editor — and that is manageable if and only if the disposability is declared in advance (H07). Everything else in RM02 (routes, shells, tokens, status language, accessibility patterns, tenancy-shaped fixtures, dashboards, archive browse, settings, denial and error and stale states) is durable regardless of how the engine decisions resolve.

**What MUST be decided before UI implementation begins:**

| Item | Why it cannot be mocked |
|---|---|
| Tenancy shape (org/publication scoping in every identifier and path) | Wrong shape in fixtures teaches the wrong API and propagates into every screen |
| Provisional vs committed geometry (C02) | The UI needs a visual language for "unconfirmed" from the first editor screen; adding it later means redesigning every editing interaction |
| Durable vs disposable classification (H07) | Determines what is allowed to accrue logic |
| Status and failure vocabulary, including deadline failure (H03) | Every screen renders it |
| The existence of a flat plan / page plan (C05) | It is a top-level navigation destination; adding it later restructures the information architecture |
| Simulation labelling rules | Already required by the corpus; correct |
| Accessibility and language/script rendering approach (including RTL) | Retrofitting RTL and Indic text handling into a completed UI is expensive |

**What can be safely mocked or deferred:** engine selection, PDF writer, preflight vendor, real authentication provider, real job infrastructure, search engine, AI providers, billing provider, real press profiles, real fonts (use libre fonts with Devanagari coverage), and all composition behaviour — provided every simulated result is labelled and no simulated logic is written in a form that invites reuse.

**One additional caution.** The backlog's simulated generation and simulated preflight units risk teaching the newsroom a latency and reliability model that the real system will not match. Simulated generation should be given a deliberately realistic duration and a realistic failure rate, and simulated preflight should fail sometimes. A demo where everything always succeeds in 200 ms produces feedback that does not transfer.

---

## Supplementary 1 — Assessment of Astra's own adversarial review (review area 17)

**Correctly identified.** AR05 (micro-point precision downgraded to one candidate), AR06 (edition-local StoryRevision lineage), AR07 (release commit must serialize against revocation), AR08 (paragraph layer is the real typography decision, not the shaper), AR14 (tenant scoping of source observations, embeddings, clusters and search results), AR17 (archive commitment precedes exposure; press receipts append-only outside the manifest). These are hard, non-obvious findings, and finding them before implementation is worth a great deal.

**Missed.** The six CRITICAL findings in this review were all available from the corpus and the original product context without new research: the geometry invariant's lack of definition (C01), the editor/resolution contradiction (C02), the unowned engine-language decision (C03), legacy encodings (C04), press colour and the flat plan (C05), and PDF ad import (C06). C05 and C06 are the most striking misses because the corpus *states* both requirements — news-hole calculation is named as strategic IP, and vector ad import is named as needing a tested path — and then does not carry either into the data model or the candidate evaluation. Astra's review checked internal consistency of what was written; it did not check completeness against what was required.

**Overstated.** Nothing materially. The review is not padded.

**Understated.** AR05 was treated as a downgrade to "one candidate" when the arithmetic (M01) supports an actual decision. AR08 was treated as a candidate comparison when the licence-versus-packaging interaction (G.1) makes it a coupled decision with C03.

**Corrections not propagated.** AR06, AR07, AR14 and AR17 were applied as inline prose clarifications in phase documents but never promoted into the decision register, which the corpus itself designates as authoritative for decision status (H14). This is the single process defect in an otherwise well-run review.

---

## Supplementary 2 — Independent risk analysis (review area 20)

My independently ranked top risks. Those marked **NEW** have no evident counterpart in K01–K30.

| Rank | Risk | Likelihood | Impact | Where addressed |
|---|---|---|---|---|
| 1 | The shared-geometry invariant is never operationally verified and drift is discovered in print | High if uncorrected | Severe — destroys the core promise | C01 |
| 2 | **NEW** — The editor proves unusable for text-frame operations because no option in C02 was chosen deliberately | High | Severe — the product's daily workflow fails | C02 |
| 3 | **NEW** — Customer brand fonts are legacy-encoded and cannot be onboarded at all | Medium-High for an Indian pilot | Severe — pilot cannot start | C04 |
| 4 | **NEW** — A colour image is placed on a mono page and the error reaches the press | High if uncorrected | Severe — physical waste, customer trust | C05 |
| 5 | **NEW** — Customer PDF advertisements cannot be imported with fidelity | Medium-High | Severe — value proposition collapses | C06 |
| 6 | Commercial preflight or PDF-import licensing exceeds the owner's budget | Medium | High — forces an architecture change late | PO04, G.2 |
| 7 | **NEW** — A deadline failure is escaped outside the system, invisibly | High once in production | High — destroys archive completeness and audit | H03 |
| 8 | **NEW** — A preflight vendor's default correction profile silently alters approved bytes | Medium | High — breaks the exact-revision invariant | H02 |
| 9 | No press partner is available, so G6 is never reachable and G3 claims stall | Medium | High — the product cannot be qualified | PO03 |
| 10 | The engine language decision is made by accident and proves wrong for WASM or for hiring | Medium | High — expensive to reverse | C03 |
| 11 | **NEW** — Font licences prohibit archival retention, invalidating the editable-restoration promise | Medium | High — a sold promise cannot be kept | H09 |
| 12 | The sample editor becomes load-bearing because disposability was never declared | High | Medium-High — inherits a browser-only geometry model | H07 |
| 13 | Linked-flow cascades across concurrent editors produce data loss or unusable UX | Medium | High | H08, F.2 |
| 14 | Article extraction quality on Indian-language sites is materially worse than English benchmarks suggest | High | Medium | H, RD07/08 |
| 15 | Multilingual archive search is judged broken by the newsroom due to analysis-chain gaps | Medium-High | Medium | H05 |

---

## L. ROADMAP AND BACKLOG ISSUES

**Sequencing.** The roadmap's overall shape is sound, and its best feature — the "what this does NOT prove" column on every gate — should be preserved exactly. The three sequencing problems are:

1. **RM04 is blocked on owner answers (H11)**, which converts the highest-value de-risking activity into the most schedule-exposed one. A default pilot matrix fixes this without weakening G3.
2. **RD13 does not exist, so RM04 and RM10 have an unstated prerequisite (C03).** RM04 cannot meaningfully compare renderer/writer routes without knowing the engine's substrate.
3. **RM11 vendor evaluation is described as starting in RM04**, which is right, but the roadmap does not make the vendor *decision* a prerequisite for RM10's writer commitment. If a commercial import/writer tier turns out to be necessary (C06), discovering that after the writer is built is the expensive ordering.

Two smaller ones: RM05 gates owned-content modelling behind G2 unnecessarily (M10), and RM14's deferral of the concurrency model leaves RM06's schema underdetermined (H08).

**Backlog.** UI001–UI026 is well constructed — the inclusion of denied, error, stale and cancel states and of resettable multi-tenant fixtures from the start is exactly right, and it is the part most teams skip. Problems: no durable/disposable classification (H07), no flat-plan screen (C05), no legacy-content import scenario (C04), no ad creative rejection scenario (C06), UI026 is a phase rather than a unit (M11), no deadline-failure scenario (H03), and no visual language for provisional-versus-committed geometry (C02).

---

## M. DECISIONS THAT ARE SAFE TO LOCK

These have sufficient evidence in the corpus today. Locking them removes recurring re-litigation cost.

| Decision | Justification |
|---|---|
| HarfBuzz for shaping; FreeType for font access and rasterization; ICU for Unicode, BiDi and segmentation | No credible production alternative exists; every candidate architecture uses them |
| Integer millipoints as the canonical physical unit, with documented intermediate bounds and rounding mode | Arithmetic in M01; micro-points have no physical referent and ~3× int64 headroom on a two-term product |
| Organization as tenant root; publication-scoped authorization; organization-qualified foreign keys; IDs alone grant no access | Already decided in substance (D04); shapes the UI phase |
| Authenticated gateway (not signed URLs) for rights-bearing and released artifacts | Forced by the revocation requirement (M08) |
| Publishing engine invoked as an isolated, resource-limited, separately-deployed worker with a versioned contract | Forced by hostile-input isolation and by decoupling from OP13 (H01) |
| Snapshot plus bounded command/audit history; full event sourcing rejected | Already reasoned; upgrade from recommendation to decision |
| Fail-closed preflight (timeout, unavailability, expired licence, malformed report = failure) | Correct as written; lock verbatim |
| No silent font substitution; unsupported font/script pairs are blocked | Correct as written; lock verbatim |
| Archive commitment precedes exposure of the print master; press receipts append-only outside the manifest (AR17) | Lock as a numbered decision |
| Edition-local StoryRevision lineage for edition-specific text changes (AR06) | Lock as a numbered decision |
| Release commit serializes against revocation, or uses an equivalent compare-and-retry protocol (AR07) | Lock as a numbered decision |
| Tenant scoping of source observations, entitlements, clusters, embeddings and search results (AR14) | Lock as a numbered decision |
| Commercial final-byte preflight (callas or Enfocus) as the expected path, subject to budget confirmation | No credible open-source substitute exists for PDF/X conformance (G.2) |
| React / TypeScript / Vite frontend stack (OP12) | Recorded, unchallenged anywhere in the corpus; leaving it open costs more than it protects |
| All rendered outputs derive from one ResolvedDocument digest; no output path re-composes text | Generalization of an already-accepted rule (H04) |

---

## N. DECISIONS THAT SHOULD BE REOPENED

| # | Decision | Why reopen |
|---|---|---|
| N1 | OP14 — server-authoritative resolution | As stated it forbids a usable editor; must be recast as provisional vs committed geometry (C02) |
| N2 | RD01 — composition/renderer/writer combination | Must be restated as coupled with RD06, dependent on the new RD13, and must carry PDF ad import as a weighted criterion (C02, C03, C06) |
| N3 | RD05 — numeric representation | Largely decidable on paper; narrow to rounding accumulation (M01) |
| N4 | RJ04 — veraPDF rejected | Correct as a PDF/X rejection; over-broad as recorded (M02) |
| N5 | DEP38 — news-please, RESEARCH FURTHER | Independent verification supports REFERENCE with targeted ADOPT of upstreams (M03) |
| N6 | DEP60 — "engine language undecided" as a registry row | A registry row cannot own a decision of this blast radius; becomes RD13 plus an ADR (C03) |
| N7 | Phase 16 — "Do not create CLAUDE.md or AGENTS.md at this stage" | Works against the corpus's own token-efficiency goal (M06) |
| N8 | RM14 — concurrency model deferred | Lease granularity constrains the RM06 schema and must precede it (H08) |

---

## O. RESEARCH REQUIRED BEFORE IMPLEMENTATION

New research items, in addition to the existing RD01–RD12.

| ID | Subject | Severity | Blocks |
|---|---|---|---|
| RD13 | Publishing engine implementation language, native build and packaging strategy, sandboxing model for hostile-input parsers, and whether a WASM client build is required | CRITICAL | RD01, RM04, RM10, C02 option (i) |
| RD14 | Legacy Indian encoding inventory, conversion-table sourcing or construction, lossiness characterization, round-trip test corpus | HIGH | Customer onboarding; archive import |
| RD15 | PDF advertisement import fidelity — vectors, text, embedded fonts, spot colour, overprint, transparency; candidates pdfium / PDFBox / MuPDF / commercial PDI tier | CRITICAL | RM10, G3, PO04 budget framing |
| RD16 | Press configuration capture — colour tower and signature modelling, screen ruling, how the constraint is obtained from a real press partner and validated | HIGH | RM08, RM11, G3 |
| RD17 | Multilingual search and indexing — engines, Devanagari/Urdu analysis chains, normalization, transliteration, tenant isolation, reindex cost | MEDIUM | RM13 |
| RD18 | Font licensing for server-side composition and archival retention; viability of a libre-font-only pilot matrix | HIGH | RM07, the editable-restoration promise |
| RD19 | Devanagari and Urdu justification quality, per-language hyphenation availability, Nastaliq feasibility in candidate paragraph layers, and a scored native-reviewer rubric | MEDIUM | RM07, copyfit design |
| RD20 | Bounded-regeneration infeasibility taxonomy and constraint-ranking model (which constraint class yields, and how infeasibility is explained to an editor) | MEDIUM | RM08, RM12 |

Additionally, existing items need scope amendments: **RD01** (couple with RD06; depend on RD13; include ad import), **RD02** (test Nastaliq explicitly), **RD03** (verify vendor default-correction behaviour and whether correction can be hard-disabled), **RD05** (narrow per M01), **RD07/RD08** (benchmark extraction on an Indian-language corpus, not an English one).

---

## P. PRODUCT-OWNER QUESTIONS THAT MUST BE ANSWERED

**Genuinely blocking, and genuinely requiring the owner — nine.**

| ID | Question | Status |
|---|---|---|
| PO01 | Customer segment and first pilot newsroom | Existing; correctly blocking |
| PO02 | Languages, scripts and typefaces — **amend to add:** Nastaliq vs Naskh for Urdu, and the licence terms of each named typeface, not only its name | Existing; amend (M05, H09) |
| PO03 | Press partner — **amend to add:** press configuration, colour page availability pattern, signature structure and screen ruling | Existing; amend (C05, H13, RD16) |
| PO04 | Commercial engine budget — **reframe as:** confirm budget for a probable commercial preflight purchase, and separately for a PDF-import licence tier if RD15 requires one | Existing; reframe (G.2, C06) |
| PO05 | Archive promise, retention and legal-hold policy | Existing; correctly blocking |
| PO12 | **NEW** — Replates and edition variants: does the customer run multiple print runs per day, with city/district variants or late-news replates? How are variants related, versioned and archived? | New; blocking |
| PO13 | **NEW** — Legacy fonts and encodings: what fonts and encodings exist in current production and in the historical archive? Are any brand faces available only as legacy-encoded fonts? | New; blocking (C04) |
| PO14 | **NEW** — Page colour availability: which pages can print colour, determined by what, and how does the newsroom learn it today? | New; blocking (C05) |
| PO15 | **NEW** — Deadline authority: may Pageinator ever emit a file that fails mandatory checks, under a named authority and permanent non-conforming marking? Or is the answer no, with the newsroom's fallback being its prior system? | New; blocking (H03) |

**Technically answerable without the owner — do not ask.** Numeric unit (M01), frontend stack (OP12), signed-URL versus gateway (M08), engine seam (H01), lease granularity (H08, subject only to a factual check on concurrency patterns), search index tenancy, audit hash-chaining. Asking the owner these delays the program and produces worse answers.

**Premature.** PO11 is correctly marked deferrable. E-paper scope (H04) can also wait, although the derivation invariant cannot.

**Important and missing, beyond the four new blocking items:** how advertisements arrive today and from whom (H12/C06); whether ad booking is in scope or integrated (H12); and the actual concurrency pattern on a page and an edition (H08). These are factual questions about current operations, not preference questions, and they should be gathered in a single structured discovery session rather than asked one at a time.

**A note on discipline.** The corpus does not invent owner preferences anywhere, and this review does not either. Every recommendation above that touches a preference is phrased as a question, and every recommendation phrased as a decision rests on arithmetic, licence terms, physical constraints or evidence already in the corpus.

---

## Q. CHANGES REQUIRED IN MASTER_BUILD_SPEC.md

Eighteen changes. The Master Build Spec is not rewritten here; these are the required amendments, by section.

| # | Section | Change | Source |
|---|---|---|---|
| Q1 | §2 | State the advertising scope boundary (constraints consumed; ad sales not owned in the pilot) and the deadline-failure product contract | H12, H03 |
| Q2 | §3 | Name the publishing engine as a distinct artifact invoked as an isolated, resource-limited, separately-deployed worker with a versioned contract; reference its language/packaging ADR | C03, H01 |
| Q3 | §3 | Add the EditionPlan (flat plan) aggregate to domain ownership, with page count, sequence, section, colour capability, ad allocation and news hole | C05 |
| Q4 | §4 | Add the geometry conformance contract, or reference `docs/architecture/GEOMETRY_CONFORMANCE.md` normatively | C01 |
| Q5 | §4, §5 | Add the provisional-vs-committed geometry invariant and the editor's obligation to render provisional state as visibly unconfirmed | C02 |
| Q6 | §4 | Fix integer millipoints as the canonical physical unit, with documented intermediate bounds and rounding mode | M01 |
| Q7 | §4, §6 | State that text ingress may be non-Unicode; conversion occurs at a single recorded, versioned boundary retaining original bytes and lossiness provenance | C04 |
| Q8 | §4 | Refine the language matrix: Naskh and Nastaliq as separate entries; per-language hyphenation availability; copyfit strategy is language-dependent | M04, M05 |
| Q9 | §4 | State that press capability constraints outrank user locks during bounded regeneration | C05 |
| Q10 | §5 | State lease granularity and that linked-flow consequences are server-computed and notified, never client-applied across a lease boundary | H08 |
| Q11 | §6 | Extend the rights model to fonts as action-scoped rights-bearing assets; version search index analysis configuration and treat reindex as a recorded migration | H09, H05 |
| Q12 | §7 | Add per-page colour availability, signature structure and minimum effective-PPI warn/block thresholds to PrintProfile; distinguish quality findings (acknowledgeable) from conformance defects (not waivable) | C05, H13 |
| Q13 | §7 | Add the PDF advertisement import path, quarantine-with-diagnostic behaviour, and an explicit prohibition on silent rasterization | C06 |
| Q14 | §7 | State that all rendered outputs — print master, proof, page rasters, e-paper, thumbnails — derive from one ResolvedDocument digest and that no output path re-composes text | H04 |
| Q15 | §7, §8 | Prohibit in-place modification of approved bytes; any fixup creates a new candidate with a new digest, revokes prior approval and re-validates | H02 |
| Q16 | §8 | Define duplicate-edition and reprint as first-class operations with lineage, rights re-evaluation against the new date and territory, and profile pinning rules | H06 |
| Q17 | §9 | Decide audit tamper-evidence, retention and tenant exportability; bind the approval-chain digest into the release manifest; record the authenticated-gateway decision | H10, M08 |
| Q18 | §1, §11 | Promote AR06, AR07, AR14 and AR17 to numbered decisions; update the open-decision, research and owner-question counters to reflect this review | H14, M12 |

---

## R. CHANGES REQUIRED IN IMPLEMENTATION_ROADMAP.md

| # | Change |
|---|---|
| R1 | Define a default pilot matrix (Latin/English plus Devanagari/Marathi, one libre font family, one generic coldset newsprint condition, in-house vector ad) so RM04 proceeds without PO02–04, with results explicitly scoped to approach feasibility rather than customer qualification |
| R2 | Add RD13 as a prerequisite of RM04 and RM10, and restate RD01/RD06 as one coupled decision |
| R3 | Make the preflight/import vendor decision a gate before RM10's writer commitment, not a late RM11 activity |
| R4 | Split RM05 into RM05a (owned/manual content modelling, available before G2) and RM05b (external sources, requiring G2 and per-source permission) |
| R5 | Add repository agent-instruction files (root plus path-scoped) to RM01 scope, reversing the Phase 16 prohibition |
| R6 | Add an EditionPlan / flat-plan and press-configuration workstream, sequenced with RM06 and feeding RM08 and RM11 |
| R7 | Add a legacy-encoding ingestion and conversion workstream, feeding RM05a and RM06 |
| R8 | Extend G3's evidence requirements to include PDF advertisement import fidelity and page-colour constraint enforcement; extend G1's to include the deadline-failure and provisional-geometry UX having been reviewed by the pilot newsroom |

---

## S. CHANGES REQUIRED IN INITIAL_IMPLEMENTATION_BACKLOG.md

| # | Change |
|---|---|
| S1 | Add a mandatory DURABLE / DISPOSABLE-BY-DESIGN classification to every unit; disposable units may define no persisted schema and no reusable logic |
| S2 | Add a flat-plan / page-plan screen unit with per-page colour capability, ad allocation and remaining news hole, placed early in navigation |
| S3 | Add a legacy-content import scenario: blocked import, conversion review with lossiness disclosure, and rejected-font paths |
| S4 | Add an advertisement creative rejection and quarantine scenario to UI012, with a specific actionable diagnostic returned to the supplier |
| S5 | Split UI026 into per-journey walkthroughs, each depending only on the units its journey traverses |
| S6 | Add a deadline-failure scenario exercising whichever answer PO15 gives, plus realistic simulated generation durations and a non-zero simulated failure rate |
| S7 | Add a provisional-vs-committed geometry visual language to the UI001/UI002 token and status-language units, and apply it in every editing interaction |

---

## T. FINAL READINESS ASSESSMENT

**Documentation gate G0 — decision-ready documentation: NOT MET as written; achievable with specification work only.** The artifacts are complete and traceable, but G0's own criterion of "explicit open decisions" is not satisfied while the engine language decision is owned by no item (C03) and the central invariant has no testable definition (C01). Both are correctable on paper, without research and without owner input.

**Authorization recommendation, in order:**

1. **Immediately, no authorization required:** promote AR06/AR07/AR14/AR17 to numbered decisions (H14); lock the fifteen items in Section M; amend RJ04 and DEP38 (M02, M03); add verification dates to the dependency registry (L04).
2. **Before authorizing RM01:** write the geometry conformance contract (C01); state the provisional-vs-committed invariant (C02); apply the durable/disposable classification (H07); settle the deadline question direction with the owner (PO15); add the flat-plan screen, legacy-content and ad-rejection scenarios to the backlog (S2–S4).
3. **In parallel with RM01, not after it:** open RD13 (C03) and RD15 (C06); begin RD14 (C04), RD16 (C05) and RD18 (H09); run the structured owner discovery session covering PO12–PO15 and the amendments to PO02–PO04.
4. **Then:** authorize RM04 against the default pilot matrix (H11), which is the single highest-value action available once RD13 has a direction.

**What this assessment does not conclude.** It does not conclude that the architecture is wrong — it is, in its fundamentals, right, and Section B is not a courtesy. It does not conclude that any dependency choice is settled where I have marked it open. It does not conclude that the product is feasible: nothing in this corpus, and nothing in this review, constitutes evidence that a real press will accept a Pageinator file, and the corpus is admirably clear that only RM17/G6 can establish that. And it does not resolve any question that properly belongs to the product owner.

**Summary judgement.** Astra produced a strong architecture with excellent epistemic hygiene and six consequential gaps, four of which (C03–C06) exist because the review checked internal consistency rather than completeness against the customer's production reality. Close those, define the invariant that everything else depends on, and this becomes a genuinely implementable blueprint.

---

*End of independent second-architect review. No project file other than this document was created or modified. No implementation was performed.*

