# Pageinator — Architecture Reconciliation Round 1

Date: 2026-09-16. Status: evidence-based reconciliation and proposed changes, not implementation authorization. Only this document is changed. Existing decision statuses remain recorded in the existing register until an authorized documentation update applies the accepted changes.

## Scope, evidence and counting

Read completely: [Claude review](CLAUDE_ARCHITECTURE_REVIEW.md), [Master Build Spec](../MASTER_BUILD_SPEC.md), [decision register](../architecture/DECISION_REGISTER.md), [owner questions](../architecture/PRODUCT_OWNER_QUESTIONS.md), [Astra review](ASTRA_ARCHITECTURE_REVIEW.md), [roadmap](../IMPLEMENTATION_ROADMAP.md), and [initial backlog](../../specs/INITIAL_IMPLEMENTATION_BACKLOG.md). Supporting documents were inspected specifically for disputed geometry, typography, licensing, revision, preflight, worker, testing and ingestion claims. Original context was consulted selectively for strategic IP, archive operations, search, outputs and system intent; it was not reread wholesale.

Evidence shorthand used below: **MS** = Master Build Spec; **DR** = decision register; **P2/P3/P11/P14/P16** = architecture documents for system, publishing, data/archive, testing and repository development; **TR/BR/PR/PFR/NR** = typography, browser, PDF/prepress, preflight and news research. Section names accompany references so findings remain locatable after line changes. **RD** identifies the existing research workstream unless explicitly marked proposed. **O01–O15**, **ND01–ND08**, **MSV2**, **RMV2**, and **BLV2** identify reconciliation proposals in this document, not already-approved register entries.

The audit covers **38 numbered findings** (6 critical, 14 high, 12 medium, 6 low) and **8 additional substantive positions** in Claude's later sections, assigned X01–X08 here: **46 findings evaluated**. Repetitions in Claude's summaries and Q/R/S tables are cross-references, not extra findings. All 18 Q proposals, 8 R proposals, 7 S proposals, 8 reopening proposals and 15 proposed locks are separately adjudicated. Critical disposition totals count ACCEPT as Accepted; ACCEPT WITH MODIFICATION as Modified; REJECT as Rejected; and MIXED/RESEARCH REQUIRED/PRODUCT OWNER DECISION REQUIRED as Research/Owner unresolved. This describes reconciliation disposition, not passed feasibility tests.

**Overall position:** preserve the product's WYSIWYG, exact-release, rights and tenant boundaries. Sharpen their operational definitions. The largest correction is to distinguish responsive, provisional editing feedback from revision-bound authoritative geometry and to test both fidelity and usability. Do not confuse a missing qualification result with an architecture that claims qualification. Do not turn a plausible customer practice into an owner-approved requirement.

Bounded UI foundation is architecturally ready to authorize with the acceptance conditions in section L; no publishing experiment or customer answer must precede tokens, accessible shells and scoped mock adapters. Production engine commitment remains blocked. No implementation is authorized or performed by this reconciliation.

## Reconciled geometry and interaction contract

This is proposed normative text for MS §§4–5, supplied here so C01/C02 do not remain merely requests to write another document.

1. **Three identities, not two save states.** An editable revision can be durably saved while its layout is still unresolved. Track editable revision, resolution status and release-candidate status separately. A ResolvedDocument is an immutable result bound to an editable revision plus complete dependency/engine/profile manifests. “Committed geometry” below means accepted authoritative resolution, not merely acknowledged text autosave. It may still carry blocking diagnostics and is not automatically approved or printable.
2. **Authoritative scene identity.** Page-faithful proof and PDF consumers receive the same canonical scene digest and applicable output recipe. Canonical serialization specifies ordering, units, finite/range constraints and dependencies. Equality is checked on decoded canonical values as well as the digest. Zoom, device pixel ratio and viewport transforms are presentation-only. Identical digest alone does not prove that consumers interpreted the data correctly.
3. **Exact semantic invariants.** Require identical source coverage and reading/source mappings, selected original-font glyph identity, font binary/face/variation identity, line breaks, frame/page membership, overset/unplaced ranges, paint order, clipping topology, image/ad identity and intended placement. An omitted glyph, moved word between lines, changed font, hidden overset or wrong page is a failure regardless of positional tolerance. Logical text is preserved without assuming one glyph equals one character.
4. **Consumer boundary.** Consumers cannot choose fallback fonts, reshape, rebreak, hyphenate, justify or fit authoritative text. Explicit glyph runs, positions and transformations determine painting. Source strings remain available in a separate semantic channel for accessibility, selection and PDF text mapping; banning all strings would break these requirements. Font parsing, glyph outline access, subsetting and PDF encoding are allowed if they do not change the selected glyphs or layout. Measuring an outline for painting/culling is different from using measurements to recompose. Do not require a global font-metrics shim to throw: valid rasterizers and subsetters may need font data. Test the narrow adapter with shaping/layout entry points disabled and instrument consumer calls.
5. **Numeric equality and budgets.** Both consumers use exactly the same canonical coordinates, advances, offsets, boxes, clips and placement matrices before conversion. Backend/PDF encodings may round; the physical deviation must remain inside a versioned, prespecified error budget. No cumulative per-glyph allowance may hide line-end drift. Measure maximum endpoint, transformed-bound and page-position error, not only average origin error. Canonical representation, transform coefficients and intermediate arithmetic are distinct decisions. Integer millipoints are a promising candidate, not approved by this document.
6. **Test threshold without a false press claim.** For initial comparative spikes, use **25 µm as a provisional maximum adapter-conversion error ceiling**, explicitly an engineering hypothesis borrowed from Claude, not a press standard or customer acceptance value. Report observed error and test much tighter expected conversion precision where supported. Before qualification, RD01/RD05 must allocate a justified total budget across storage, matrices and writer conversion, with prepress review under RD03. Freeze that budget before scoring qualification candidates; never widen it just to pass. At 72 points/inch, 25 µm is about 0.070866 point. Raster edge/hinting differences have a separate visual test; they do not spend the layout budget. The review supplies no verified source establishing that press registration tolerance determines acceptable browser/PDF layout error.
7. **Independent measurement.** Compare the browser draw-command trace before device transforms with a separately decoded PDF scene after applying page coordinates, text matrices, Form XObject matrices and clipping. Map subset character codes/CIDs/GIDs back to original glyph identity or verified outlines; raw PDF glyph numbers need not equal original font glyph numbers. Check image/ad resources, source-to-text mappings and bounding geometry. Independent PDF raster rendering and native-reader inspection supplement this comparison. Importing an opaque PDF ad requires its own recursive resource/appearance tests; text extraction alone is not an oracle. The writer's own instrumentation is useful but cannot be the only verifier.
8. **Provisional interaction.** Pointer transforms, input buffers and optional provisional reflow may run locally. They carry a base revision and pending command identity and are visibly unconfirmed. They cannot produce a production ResolvedDocument, a current authoritative fit/overset pass, a release approval, a final PDF or an archive record. Provisional diagnostics may be shown only as estimates. Draft recovery may retain semantic commands/text under the draft policy; that does not archive provisional geometry as publication truth.
9. **Reconciliation after editing.** On acknowledgment and resolution, apply only a result whose revision and dependency identities match the requested state. Discard or retain as explicitly historical any out-of-order result. Replace the affected dependency closure atomically in the proof view; show significant reflow changes and affected pages. Preserve input, IME composition, selection intent and local pending commands. A server round trip must not reset an active composition session. Conflict, resolution failure and disconnected states keep the last confirmed proof visibly stale and preserve unsaved work.
10. **Approval barrier.** The user must be able to inspect a stable authoritative proof for the exact candidate. Pending or stale local feedback cannot be represented as that candidate's proof. A previously released revision remains retrievable by its identity while a newer draft is pending. Save acknowledgment, resolve completion, preflight pass and release approval must never share a misleading “saved/ready” flag.
11. **WYSIWYG remains a two-part acceptance requirement.** The settled authoritative page must match its PDF in semantics and physical scene; the interactive editor must also meet tested usability budgets on supported devices/networks. A permanent “approximate” badge cannot excuse routinely surprising reflow or an unusable editor. Measure command-to-confirmed-layout p50/p95/tails, cancellation, jump magnitude/frequency, linked-flow scope and IME/caret stability. The existing 50 ms/300 ms figures were local experiment targets, not promised remote SLAs (BR, performance section).
12. **Candidates, not a selected fallback product.** Compare shared native/WASM composition; server composition with a bounded local estimate; and server composition with retained last-confirmed text plus a recomposing frame/overlay. Hybrids, incremental resolution and caching are also possible. The third path is the minimum error/pending UX to design and test, not an assumption that a professional newsroom will accept it. Client resolution becomes authoritative only through the selected verification/acceptance protocol; shared source code alone does not establish parity or authority.

## Critical findings — individual adjudication

### C01 — “Same resolved geometry” lacks a testable definition

**Claude severity:** CRITICAL. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** The invariant lacks operational equality, prohibited operations, tolerance and an independent instrument. Claude supplies exact integer geometry, a 25 µm tolerance and a throwing font shim.

**What the existing architecture claims:** D03/MS §4 require one resolved scene and prohibit independent reflow. P14's publishing oracle already separates exact semantics from tolerant raster comparison and requires PDF position/font checks, but leaves tolerances and adapter-level conformance unfinished.

**Evidence:** P3 “Units and determinism contract,” “Rendering contract” and feasibility criteria; P14 “Publishing oracle design”; MS §4. These contain more than a slogan but less than a complete executable acceptance contract.

**Technical analysis:** This is an **underspecified invariant**, not evidence against shared geometry. Raster and vector consumers can have identical vector inputs without identical pixels. PDF subsets can renumber glyphs; exact raw GID equality would falsely reject valid writers. Source strings are needed for accessibility and text mapping. A blanket ban on all font measurements tests too much. The proposed physical tolerance is plausible for a spike but not substantiated as a production budget.

**Final reconciliation position:** Adopt the twelve-point contract above. Exact source/flow identity is unconditional. Adapter rounding is bounded and measured independently. RD01 has a test design before experiments and a frozen numeric budget before qualification; RD05 supplies range/error analysis.

**Master Build Spec impact:** MSV2-04, MSV2-06. **Roadmap impact:** RMV2-02, RMV2-08. **Backlog impact:** BLV2-07 status vocabulary only; do not build the conformance harness in RM01.

**Research required:** RD01/RD05, with RD03 prepress review; no new workstream solely for wording. **Product owner input required:** None to define invariant; O03/O08 supply qualification environment. **Gate:** contract precedes production scene API freeze; numeric qualification does not block UI primitives.

### C02 — Server authority conflicts with interactive editing

**Claude severity:** CRITICAL. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Server resolution plus a client shaping ban makes text editing unusable; distinguish provisional and committed geometry and design around server-only recomposing feedback.

**What the existing architecture claims:** OP14 is expressly conditional. P3 already allows local gesture preview, debounced text transactions and later dependency-closure resolution. BR's response budgets are local feasibility targets; remote latency is explicitly unmeasured. MS §5 permits a story-panel fallback.

**Evidence:** P3 lines describing manual-edit protocol; BR interaction/performance sections; DR OP14/RD01/RD06; MS §§4–5. There is no locked promise of a server call on every keystroke or a total prohibition on provisional local work.

**Technical analysis:** An **underspecified interaction/authority contract and research question**, not a demonstrated logical impossibility. Moving an image may also change text wrapping, so even seemingly affine gestures can invalidate composition. Local responsiveness is possible while authoritative resolution is pending; whether that experience is professionally acceptable is empirical. “Exactly three options” is too restrictive, and native/WASM byte-identical recomputation is not necessary if only server results become authoritative.

**Final reconciliation position:** Refine D03 and split OP14 into authority policy and execution placement. Couple RD01/RD06/ND01 with shared acceptance evidence while retaining separate typography and interaction deliverables. Design the recomposing state, benchmark alternatives, and do not declare the cheapest fallback adequate without newsroom testing. Saved intentions and resolved proofs have separate identities.

**Master Build Spec impact:** MSV2-05. **Roadmap impact:** RMV2-02/08/09. **Backlog impact:** BLV2-07 and stale-result scenarios in UI014–020.

**Research required:** RD01/RD06/RD12 and proposed RD13. **Product owner input required:** O06/O08 supply workflow and operating constraints; customer usability feedback is research, not a request that the owner select WASM. **Gate:** status semantics before sample-editor implementation; usable resolution path before production editor commitment.

### C03 — Publishing language, packaging and browser availability have no decision owner

**Claude severity:** CRITICAL. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** A new critical decision is needed, and C/C++ dependencies have already implicitly selected C++.

**What the existing architecture claims:** DEP60 says language undecided; P16 says native publishing *may* use its own build; OP13 concerns API runtime. P2 already allows isolated executables and explicitly keeps native/WASM open. P14 expressly says not to force C++ test tools onto an unchosen language.

**Evidence:** DR OP13/14 and RD01/10; P2 recommended topology; P16 repository areas; DEP60 and PDF candidates include bindings, JVM/.NET and vendor runtimes, not only C++ application choices.

**Technical analysis:** A **genuine ownership gap**, accompanied by an **incorrect inference of a locked language**. C ABI libraries can be used through bindings or subprocesses. Rust FFI does not make a native parser memory-safe. Language, font access, paragraph APIs, licensing, browser payload and operational isolation must be evaluated together. Ordering all RD01 learning after a final language choice creates a circular prerequisite: the library experiments are evidence for that choice.

**Final reconciliation position:** Add ND01/proposed RD13 with a named publishing lead. Separate control plane, composition core, browser renderer and PDF/import/preflight workers. Assess C++ orchestration, Rust plus FFI, and qualified alternative stacks, including vendor/service adapters when appropriate. No mandatory Rust rewrite or native/WASM port. Fix the capability and isolation boundaries first; iterate language/packaging decisions with RD01/RD06. A recorded direction precedes broad production investment, not exploratory comparisons.

**Master Build Spec impact:** MSV2-02/18. **Roadmap impact:** RMV2-02/03. **Backlog impact:** keep native tools and schemas out of UI001–003.

**Research required:** Proposed RD13; linked RD01/06/09/10. **Product owner input required:** O04 budget and O08 available team/operational constraints, not a language preference vote. **Gate:** production engine commitment; no UI-foundation block.

### C04 — Legacy Indian font encodings are missing

**Claude severity:** CRITICAL. **Astra reconciliation classification:** MIXED — SPLIT INTO MULTIPLE DECISIONS.

**What Claude claims:** Legacy font encodings are inevitable for the target customer; conversion, font inventory and archive provenance are missing and block onboarding.

**What the existing architecture claims:** TR assumes Unicode editorial input, preserves licensed originals and disallows silent substitutions. MS does not promise arbitrary historical archive import or legacy-font composition. Ongoing published-edition exactness concerns preserved bytes, not lossless extraction from every historical document.

**Evidence:** TR pipeline/font contract; MS §§4/6/8; original context §§27–29 requires exact published files and editable copies but does not identify a first customer's actual encoding estate.

**Technical analysis:** **(a) ACCEPT:** the ingress contract needs unknown/legacy encoding detection and explicit refusal/conversion provenance. **(b) RESEARCH REQUIRED:** inventory and qualify exact mappings using supplied samples; font-family brand names do not uniquely identify an encoding. **(c) PRODUCT OWNER DECISION REQUIRED:** whether legacy conversion or historical editable import belongs in the pilot. The prevalence claim is not customer evidence. A conversion can be lossy without damaging exact-byte retention if original bytes remain separately preserved. A static masthead supplied as licensed vector artwork is distinct from editable legacy text.

**Final reconciliation position:** Canonical editable text remains Unicode. Retain permitted original bytes and declared/detected source encoding; record converter/version/table, confidence, unmapped spans, normalization and reviewer acceptance in a new derived StoryRevision. Unknown mapping blocks automated composition, never silently substitutes. Do not claim reversibility unless tested; do not “convert” an arbitrary PDF by treating glyph codes as Unicode. Keep legacy conversion an adapter capability, conditionally scoped by O13.

**Master Build Spec impact:** MSV2-07/08. **Roadmap impact:** RMV2-07. **Backlog impact:** BLV2-03, simulated only.

**Research required:** Proposed RD14, RD02/RD10. **Product owner input required:** O02 supplies must-have brand/font usage; O13 chooses legacy-import scope and provides access to operational samples. **Gate:** relevant imports and customer-font qualification, not all publishing work and not UI foundation.

### C05 — Flat plan, news hole and page colour capability are missing

**Claude severity:** CRITICAL. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** A missing EditionPlan and press capability model allow colour on monochrome pages to pass every check; add page/signature configuration, preflight and a planning UI.

**What the existing architecture claims:** P3 already reserves ads before news-hole allocation and models advertisement colour constraints. MS §4 already ranks hard press/ad constraints above locks. Neither provides a versioned plan tying physical page sequence, allocations and run-specific colour permissions together.

**Evidence:** Original context §7 explicitly lists news-hole calculation and ad placement; P3 model/constraints; PR PrintProfile fields; P11 ownership table. This is a **genuine model and workflow defect**, not total absence of ad-aware planning.

**Technical analysis:** Put reusable press capabilities in a versioned PrintProfile or referenced press configuration; put the actual run/page assignment in EditionPlan. Colour capability may vary by press setup/run and imposition, so a static universal page-number map in every profile is insufficient. Initially accept a printer-supplied page-capability map and responsibility record; do not build a tower/signature simulator or imposition engine. Mono compatibility concerns final separations/colour policy, not merely whether the source photograph is RGB. Approved conversion can produce a valid mono derivative. An external checker can inspect colour usage, but Pageinator must supply the page/run policy.

**Final reconciliation position:** ND02: edition owns a versioned plan with ordered stable page IDs, sections, press-map reference, allowed separations, ad reservations and calculable editorial area. Distinguish geometric news-hole area from a typographically qualified story-fit estimate. Pin plan revision in resolutions, checks and release package. Contradictory press constraints and locks return infeasibility; precedence never authorizes silently moving a locked object.

**Master Build Spec impact:** MSV2-03/09/12. **Roadmap impact:** RMV2-06/08. **Backlog impact:** BLV2-02.

**Research required:** Extend RD03 with Claude RD16; RD05 for allocation/constraint tests. **Product owner input required:** O01 workflow and O03 press partner/responsibility; printer supplies technical data. **Gate:** plan model before edition-generation integration; final enforcement before G3/G6. A flat-plan mock does not wait for a real press map.

### C06 — PDF advertisement import lacks a qualified path

**Claude severity:** CRITICAL. **Astra reconciliation classification:** ACCEPT.

**What Claude claims:** The required vector-preserving ad path has no capability-specific comparison; import licensing and rejection behavior must be explicit.

**What the existing architecture claims:** MS §7, PR and image research already require qualified import, isolated parsing and rejection of unsupported creatives. RD01's corpus includes vector ads but lacks a separately accountable import result.

**Evidence:** PR candidate comparison/colour safety/experiment; DEP27–32; vendor confirms the separately named [PDFlib+PDI import product](https://www.pdflib.com/products/pdflib-family/pdflib-pdi/). [PDFium import API](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_ppo.h) and [PDFBox page-to-form API](https://pdfbox.apache.org/docs/2.0.13/javadocs/org/apache/pdfbox/multipdf/LayerUtility.html) establish candidate functionality, not qualified press fidelity; the latter is historical API evidence and not a selected version.

**Technical analysis:** This is a **genuine evaluation-ownership defect and research blocker** for promised PDF-ad support. No path is qualified yet; it does not follow that existing candidates are incapable. Page import, embedded resources, colour conversion and final writer output form a coupled path. Original ad bytes may be preserved while their objects are remapped into the edition; object-byte equality is not a valid import oracle. Validate vectors/text, fonts, boxes/clipping, transparency, blend modes, spots, overprint and output-intent interactions. Rendering support alone proves none of these.

**Final reconciliation position:** Add ND04/proposed RD15 as separately reported import qualification under the shared RD01 integration. Compare a small shortlist including one open route and PDI/commercial route; screen PDFium/PDFBox/MuPDF documentation before selecting trials. Verify exact licensing rather than promoting Claude's suggested license labels. Keep unsupported creatives quarantined with diagnostics. No silent rasterization; permitted normalization is a versioned, authorized transformation followed by new proof/preflight. Accepting the finding does not adopt a library.

**Master Build Spec impact:** MSV2-13. **Roadmap impact:** RMV2-03/08. **Backlog impact:** BLV2-04/UI012.

**Research required:** Proposed RD15, RD01/03/09/10. **Product owner input required:** O04 procurement constraints and O15 required creative formats/correction authority. **Gate:** chosen import/writer pair before production PDF commitment, actual corpus before G3. UI foundation unaffected.

## High findings — individual adjudication

### H01 — API/publishing seam is unspecified

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Runtime choices are entangled; mandate an isolated, resource-limited worker and durable versioned jobs, never an in-process request-handler engine.

**What the existing architecture claims:** MS §3 and P2 already separate durable workers, support independent runtime dependencies and prohibit CPU-heavy request-handler jobs.

**Evidence:** P2 “Recommended deployment shape” and “Architecture choices”; MS §§3/9. The seam exists conceptually, but its request/result and isolation guarantees need specification.

**Technical analysis:** Require a process/security boundary for hostile parsing and expensive production work; do not require a new network service/deployment unit for every engine. Durable exports need jobs. Low-latency interactive resolution may use a cancellable request to an isolated worker with revision checks, without durably queuing each speculative keystroke. Shared contracts decouple API language; backend choice need not wait for a final engine language if this seam is qualified.

**Final reconciliation position:** Tighten the existing seam: immutable input refs, tenant scope, manifest versions, operation ID, resource limits, cancellation, structured diagnostics, result digests and stale-result rejection. No raw worker authority to release.

**Master Build Spec impact:** MSV2-02. **Roadmap impact:** RMV2-02. **Backlog impact:** UI003 promises/statuses remain transport-independent. **Research required:** RD09/12 and proposed RD13 qualification. **Product owner input required:** None for boundary; O08 for budgets.

### H02 — Fixups can mutate approved bytes

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** MS omits new-candidate/new-approval rules; vendor defaults routinely modify files.

**What the existing architecture claims:** MS §7 already requires new bytes, proof, validation and approval after fixups. PFR “Domain-owned UX” explicitly disables fixups by default. P11 invalidates stale approvals after mutation.

**Evidence:** Those exact sections contradict the omission premise. Claude did not independently verify vendor default behavior beyond news-please; do not treat that default claim as verified.

**Technical analysis:** The remaining useful correction is operational: validate a read-only input, verify pre/post hash, separate correction authorization, and test vendor profiles. A new candidate invalidates approval applicability to the new bytes; it does not erase a historical approval of unchanged earlier bytes. A geometry-changing repair must update the authoritative scene or be rejected; a second approval alone cannot cure scene/PDF divergence.

**Final reconciliation position:** Retain existing invariant and make the read-only validation/fixup adapter explicit.

**Master Build Spec impact:** MSV2-15. **Roadmap impact:** RMV2-03/08. **Backlog impact:** stale-pass scenario under BLV2-06/UI019–020. **Research required:** RD03 vendor profile behavior. **Product owner input required:** None.

### H03 — Deadline failures need an explicit product contract

**Claude severity:** HIGH. **Astra reconciliation classification:** PRODUCT OWNER DECISION REQUIRED.

**What Claude claims:** Either provide a marked emergency non-conforming release or state no escape and external fallback.

**What the existing architecture claims:** D05/RJ07/MS §7 fail closed; capacity and manual workflows are considered, but a deadline continuity contract is not explicit.

**Evidence:** MS §§2/7/9, roadmap RM16–18, DR RJ07. This is a product commitment, not a reason to weaken required checks automatically.

**Technical analysis:** The choice is broader than Claude's binary: retry a qualified checker, use another already-qualified route, deliver a previously released candidate where currently permitted, or move production to the newsroom's prior system. Availability failure, advisory image quality, invalid rights and physical conformance are different failure classes. An owner cannot grant third-party rights by approving an emergency. A non-conforming print-export product would explicitly reopen a locked release requirement and need separate legal/press/technical scope; this review does not authorize it.

**Final reconciliation position:** O14 selects continuity policy before press-pilot commitments. Until then keep the existing fail-closed rule and model deadline failure without a working bypass. Record externally produced files as externally produced evidence if that later enters scope; never certify them retroactively.

**Master Build Spec impact:** MSV2-01 conditional contract. **Roadmap impact:** RMV2-08/09. **Backlog impact:** BLV2-06 deterministic failure/retry/blocked screens. **Research required:** RD12 recovery drills; RD03 alternate validation route only if proposed. **Product owner input required:** O14; not before UI foundation.

### H04 — Secondary outputs need the same-scene rule

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Generalize no independent text recomposition to proof PDFs, page rasters, thumbnails and e-paper.

**What the existing architecture claims:** D03 covers preview/PDF; MS §8 archives proofs/thumbnails; DF05 defers e-paper. Original context §55 explicitly lists secondary outputs.

**Evidence:** Original output priority list, MS §§4/7/8 and DR DF05.

**Technical analysis:** Page-faithful outputs should share an authoritative scene/release identity; approved output recipes may differ in colour, resolution, marks and crop. A final-byte proof can derive from the exact validated PDF and transitively from its resolved digest. Reflowable article reading is a separately labeled semantic derivative, not a fake print page. Printer-specific transformations need their own artifact/profile lineage and validation.

**Final reconciliation position:** Adopt the derivation rule with explicit output classes; do not demand identical bytes/colour/resolution for every output or add e-paper to the pilot.

**Master Build Spec impact:** MSV2-14. **Roadmap impact:** RMV2-08. **Backlog impact:** UI020–021 output labels under BLV2-07. **Research required:** RD01/03 for actual adapters. **Product owner input required:** O11 only for expansion priority.

### H05 — Multilingual archive search lacks a plan

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** No index tenancy or multilingual analysis plan exists; add RD17 and select an engine.

**What the existing architecture claims:** D04/P11/MS §§3/9 already scope search; RD07 explicitly includes multilingual retrieval; NR recommends relational metadata/text retrieval first and analyzer evaluation before a standalone engine.

**Evidence:** DR RD07/DF04, NR “Deduplication, events and editorial evidence,” original context §31 says richer search is eventual.

**Technical analysis:** Add archive-specific query corpus, source-text preservation, versioned analysis and alias/index migration/rollback. Do not blindly fold nukta, matras or Urdu spacing: transformations can collapse distinct words. Test recall and false matches with native readers. No evidence requires a search cluster before initial archive metadata browsing.

**Final reconciliation position:** Merge Claude RD17 into RD07 as a visible archive-search deliverable with RD09 isolation tests. Engine remains evidence-dependent.

**Master Build Spec impact:** MSV2-11/16. **Roadmap impact:** RMV2-04/09. **Backlog impact:** no real analyzer; UI021 filter fixtures. **Research required:** RD07. **Product owner input required:** No algorithm choice; O01/O11 determine promised search scope.

### H06 — Duplicate and reprint lack semantics

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** No lineage/reprint authorization exists; use current profile by default for duplicates.

**What the existing architecture claims:** MS §§6/8 explicitly distinguishes current reprint permission and exact retrieval; P11 retrieval item 1 reauthorizes current use. UI021 already creates lineage and denies reprint separately from viewing.

**Evidence:** P11 “Retrieval promises,” MS §8, UI021. Duplication policy for ads/date/profile is less specific.

**Technical analysis:** Separate reprint (same archived bytes, new authorized delivery/use record), editable restoration (new draft of the historical state), and new-edition duplication (new date/scope, rechecked rights and reservations). Auto-updating to the current profile can invalidate the historical layout; retaining an obsolete profile can also fail. Require an explicit applicable profile choice/confirmation for the new purpose, with a suggested default only after workflow evidence.

**Final reconciliation position:** Extend already-correct lineage/rights rules with these operation contracts. Retrying delivery is not a new release; changing bytes requires a new candidate.

**Master Build Spec impact:** MSV2-16. **Roadmap impact:** RMV2-09. **Backlog impact:** UI021 scenarios within BLV2-05. **Research required:** RD04/09 tests, no new workstream. **Product owner input required:** O05/O12/O15 for contracts, variants and ad reuse.

### H07 — UI work needs explicit reuse expectations

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Classify every unit durable/disposable and prohibit all reusable logic or persisted schema in disposable units.

**What the existing architecture claims:** UI003 excludes production schemas; UI015 excludes renderer commitment; UI025 intentionally persists a versioned fictional demo. MS §5 and RM12 separate the sample editor.

**Evidence:** UI003/015/016/025 and roadmap RM12.

**Technical analysis:** A unit can contain durable controls and disposable composition mocks. A blanket prohibition on reusable logic is untestable and would prohibit harmless shared controls. “Never persisted” contradicts useful demo reset/reload tests; the real boundary is no promotion of demo storage into a production schema.

**Final reconciliation position:** Classify components/contracts by intended reuse within each unit; mark the entire sample-geometry/composition adapter disposable. Reuse requires contract review and relevant tests, not confidence from a demo. Keep mock DTO versions explicitly nonproduction.

**Master Build Spec impact:** MSV2-05 (short boundary clarification). **Roadmap impact:** RMV2-09. **Backlog impact:** BLV2-01 across all units. **Research required:** None for classification. **Product owner input required:** None.

### H08 — Lease granularity and cross-page flows

**Claude severity:** HIGH. **Astra reconciliation classification:** MIXED — SPLIT INTO MULTIPLE DECISIONS.

**What Claude claims:** RM14 defers concurrency too late; select page leases and allow notified server changes across lease boundaries.

**What the existing architecture claims:** RM06 already depends on PO06 editing-model input and RD05; RM14 implements the chosen model. Document leases are conditional, not locked.

**Evidence:** Roadmap RM06 dependency and RM14 deliverable; DR OP06/DF02; P11 command envelope.

**Technical analysis:** **ACCEPT** the need for early scope/read-write-set design. **REJECT** page leases as a factually established answer and notification as sufficient concurrency control. A notified reflow can still invalidate another editor's in-flight operation. **PRODUCT OWNER DECISION REQUIRED** for simultaneous-work needs; **RESEARCH REQUIRED** for command conflicts and cross-flow behavior. Leases coordinate intent, revisions enforce correctness, and derived geometry is not equivalent to changing another user's story text.

**Final reconciliation position:** Decide lease/transaction granularity before durable RM06 commitments using O06. Test document checkout, page/flow coordination and revision-conflict options. Compute dependency closure, validate its revisions, reject/rebase conflicts explicitly, and publish one coherent resolved result. Never silently overwrite or bypass an exclusive lease's defined promise.

**Master Build Spec impact:** MSV2-10. **Roadmap impact:** RMV2-09. **Backlog impact:** UI016/018 conflict fixtures under BLV2-07. **Research required:** RD05/06/09. **Product owner input required:** O06; before production edition workspace/model, not shell navigation.

### H09 — Fonts lack a rights owner

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Font SaaS/embedding/archive rights are treated as storage; add a font RightsGrant and RD18.

**What the existing architecture claims:** P2's shared rights service explicitly covers fonts. TR's font record already lists browser/server use, embedding/subsetting and archival rights; DR RD02/04/10 assigns typography, legal and operations responsibilities.

**Evidence:** TR “Font asset and output contract,” P2 ownership, RD02 required evidence. The blanket absence claim is incorrect.

**Technical analysis:** Strengthen action-specific enforcement and the relationship between font grant, engine manifest and promised recovery tier. Binary embedding flags do not establish license permission. Do not generalize commercial EULA restrictions without the actual agreements; supported fonts need individually reviewed terms.

**Final reconciliation position:** Explicitly connect font grants to compose, distribute-to-browser, embed/subset, retain and restore operations. Fold Claude RD18 into RD02/10/04; a libre-font feasibility corpus is an experiment choice, not an owner-approved brand replacement.

**Master Build Spec impact:** MSV2-11/18. **Roadmap impact:** RMV2-01/02. **Backlog impact:** font-blocked fixture under BLV2-03. **Research required:** RD02/10/04 license review. **Product owner input required:** O02 desired fonts and O05 recovery tier; rights holders/legal supply terms.

### H10 — Audit assurance, retention and export

**Claude severity:** HIGH. **Astra reconciliation classification:** MIXED — SPLIT INTO MULTIPLE DECISIONS.

**What Claude claims:** Append-only is inadequate; hash-chain audit, bind approval-chain digest to manifests, choose retention and tenant exports.

**What the existing architecture claims:** P11/MS §8 already package approval/release evidence and hashes; P11 AuditEvent is append-only. Tamper threat and customer audit export are not specified.

**Evidence:** P11 package inventory/AuditEvent; MS §§8–9.

**Technical analysis:** **ACCEPT** an explicit assurance/threat model and binding approval evidence to release identity. **RESEARCH REQUIRED** for integrity design under RD09/04: a hash chain without an independently protected anchor can be rewritten wholesale, and concurrent append/retention/redaction/key handling is not “almost free.” Avoid circular digests by hashing an approval record referring to the PDF/resolved digest, then referencing it from the package manifest; the later release event references that manifest. **PRODUCT OWNER DECISION REQUIRED** for contractual retention/export scope, not algorithm selection.

**Final reconciliation position:** ND06 defines minimum verifiable release evidence, access separation and restoration tests; enhanced tamper evidence scales to the promised threat model. Do not mandate blockchain, global hash chaining or permanent payload logs.

**Master Build Spec impact:** MSV2-17. **Roadmap impact:** RMV2-09. **Backlog impact:** no cryptographic UI work. **Research required:** RD09/04/10. **Product owner input required:** O05/O07 contractual scope.

### H11 — RM04 should learn without customer answers

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Use a default pilot matrix to unblock all feasibility work from PO02–04.

**What the existing architecture claims:** RM04 lists those owner inputs; general roadmap text already permits isolated licensed experiments but supplies no explicit fallback corpus.

**Evidence:** RM04 dependency versus roadmap “Execution sequence” research exception.

**Technical analysis:** Name it a **reference feasibility corpus**, not a pilot matrix. Use owned/licensed text, images, fonts and an in-house PDF ad. A generic output profile is experimental, not press approval. English/Marathi alone can conceal the eventual Urdu design constraint; include a bounded Nastaliq/RTL stress case before narrowing engine architecture. Commercial trial legality and access cannot be waived by choosing libre inputs.

**Final reconciliation position:** Split no-purchase capability learning from licensed vendor evaluation and actual customer qualification. Start the former without owner delay; record unrun professional checks as unrun. RM04 does not logically depend on UI foundation code.

**Master Build Spec impact:** MSV2-18 gate clarification. **Roadmap impact:** RMV2-01/02. **Backlog impact:** none; research stays outside UI backlog. **Research required:** Existing RD01/02/03/10; no extra research ID. **Product owner input required:** None for a later-authorized no-purchase spike; O04 before spending/contract commitment.

### H12 — Advertising boundary is implicit

**Claude severity:** HIGH. **Astra reconciliation classification:** REJECT.

**What Claude claims:** The architecture implies integration without saying it and strategic ad-placement IP implies ad sales may be included.

**What the existing architecture claims:** MS §2 explicitly lists ad-sales CRM as a non-goal; P2 says not to build sales/finance CRM; DR DF05 defers it; UI012 excludes invoicing/ad-sales CRM.

**Evidence:** These four direct scope statements settle the claimed omission. Original context §7 names placement, not a replacement sales system.

**Technical analysis:** Strategic ownership of placement does not imply sales ownership. Customer booking formats, slot catalogues and correction responsibilities are legitimate discovery inputs, but they do not reopen an explicit scope boundary automatically.

**Final reconciliation position:** Keep the existing boundary. Specify import/manual entry for booked constraints as a clarification under C05/C06; sales expansion only under O11 after an explicit scope request.

**Master Build Spec impact:** No new scope change; MSV2-01 restates the existing boundary. **Roadmap impact:** none beyond C05/C06. **Backlog impact:** BLV2-02/04. **Research required:** No standalone item. **Product owner input required:** O15 workflow facts, not approval to exclude something already excluded.

### H13 — Effective-PPI policy and warnings

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** PrintProfile has no minimum-resolution field; all low PPI should be acknowledgeable quality findings.

**What the existing architecture claims:** PR PrintProfile explicitly includes minimum effective image resolution by asset class; PFR allows advisory acknowledgments but forbids mandatory waivers.

**Evidence:** PR “PrintProfile requirements”; PFR “Domain-owned UX”; MS §7 already defers resolution policy to the press.

**Technical analysis:** Missing master-level detail is severity/authority, not the existence of a threshold. Low resolution can be advisory or a mandatory press/ad-contract failure. It cannot universally be demoted to quality. Separate photo/line-art classes, placement/crop, warn thresholds, required minimums, rule source and authorized acknowledgment. Unknown/failed measurement is not a quality acknowledgment.

**Final reconciliation position:** Add explicit policy structure without a universal PPI constant or a universal override. Record advisory acknowledgments in approval evidence; required limits remain blocking.

**Master Build Spec impact:** MSV2-12. **Roadmap impact:** RMV2-06/08. **Backlog impact:** UI011/019 advisory versus blocked fixtures via BLV2-06. **Research required:** RD03 press calibration. **Product owner input required:** O03 press relationship and O14 editorial authority; printer supplies technical limits.

### H14 — Review decisions need register traceability

**Claude severity:** HIGH. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** AR06/07/14/17 must become four new numbered decisions; none appears in D01–13.

**What the existing architecture claims:** D04–06 already own tenant, exact-release and archive invariants, with AR references and detailed MS protocols. Story lineage deserves more direct indexing.

**Evidence:** DR D04/D05/D06; MS §§4/8; Astra Phase 24 correction table.

**Technical analysis:** Decision-status authority need not duplicate every implementation rule. Creating a new top-level decision for every clarification causes divergent copies and inflated unresolved counts. Stable subclauses and evidence links are sufficient when the underlying decision is unchanged.

**Final reconciliation position:** Add D03.story-lineage, D04.private-derived-data, D05.commit-revocation and D06.archive-receipts subclauses/cross-references in a future register update. New ND decisions cover actually new choice subjects; do not count these four promotions as new architectural choices.

**Master Build Spec impact:** MSV2-18. **Roadmap impact:** RMV2-09 governance. **Backlog impact:** shared traceability contract only. **Research required:** None for indexing; original runtime tests remain. **Product owner input required:** None.

## Medium findings — individual adjudication

### M01 — Lock integer millipoints now

**Claude severity:** MEDIUM. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Int64 coordinate-product arithmetic makes millipoints decisively preferable and allows immediate selection. **What the existing architecture claims:** AR05 already removed the micro-point recommendation; RD05 requires bounds on intermediate arithmetic and conversion.

**Evidence:** P3 numeric contract; DR RD05; Claude's table. **Technical analysis:** 600 mm is about 1700.787 pt; millipoints give about 0.353 µm resolution and micro-points about 0.353 nm. Those conversions support testing coarser units. But squaring a coordinate is not the complete affine-transform calculation: matrix coefficients have their own scale, products are summed, inverses and nested transforms matter, and JavaScript Number has a different exact-integer range from int64. Claude's prose also overstates micro-points versus 6–10 µm plate addressability by orders of magnitude: the ratio is roughly 17,000–28,000, not ten million.

**Final reconciliation position:** Prefer bounded coarse fixed-point as a research direction; do the arithmetic now as part of RD05, then exercise serialization/transforms across actual adapters. Do not lock a unit from a two-column calculation. Include rounding/tie rules, maximum geometry, coefficients, scale nesting, wire representation and accumulated error.

**Master Build Spec impact:** MSV2-06 retains a bounded decision gate. **Roadmap impact:** RMV2-02. **Backlog impact:** demo coordinates remain nonproduction. **Research required:** RD05 documentation plus spike/property tests. **Product owner input required:** None.

### M02 — veraPDF rejection is too broad

**Claude severity:** MEDIUM. **Astra reconciliation classification:** REJECT.

**What Claude claims:** RJ04 flatly rejects veraPDF and loses its PDF/A/UA role. **What the existing architecture claims:** RJ04 explicitly rejects “qpdf or veraPDF alone as comprehensive PDF/X press preflight” and its reason expressly names PDF/A/UA capabilities.

**Evidence:** DR RJ04; MS §7; PR/PFR scope tables. **Technical analysis:** The requested narrower rejection already exists. A future PDF/A/UA product claim requires separate scope and evidence; it is not required by exact-byte archiving.

**Final reconciliation position:** Keep RJ04. **Master Build Spec impact:** None. **Roadmap impact:** None. **Backlog impact:** None. **Research required:** None now. **Product owner input required:** O11 only if future conformance/accessibility output scope is expanded.

### M03 — Reclassify news-please to REFERENCE

**Claude severity:** MEDIUM. **Astra reconciliation classification:** RESEARCH REQUIRED.

**What Claude claims:** Broad mandatory dependencies and upstream-based extraction establish REFERENCE; direct extractors should be adopted; release-date evidence conflicts. **What the existing architecture claims:** NR already records broad dependencies, extraction ensembling and the package/source discrepancy, and requires comparison before a possible constrained WRAP.

**Evidence:** NR dependency and outcome sections; current primary checks in the dedicated news-please assessment below. **Technical analysis:** Dependencies create measurable supply-chain/install costs, not necessarily running database/search services. No comparative accuracy/cost benchmark establishes that the ensemble has no value. A wrapper isolates behavior but does not remove installed dependency obligations. PyPI's visible file metadata supports Astra's 2025 date, not Claude's asserted 2024 date; the JSON endpoint could not be independently fetched in this session.

**Final reconciliation position:** Keep **RESEARCH FURTHER** for extraction-only WRAP, with REFERENCE as the no-runtime-dependency fallback if it loses the bounded comparison. Do not adopt alternatives untested or build extraction from scratch. **Master Build Spec impact:** MSV2-11 retains status with updated evidence note. **Roadmap impact:** RMV2-04. **Backlog impact:** no installs/live crawling. **Research required:** RD07/RD10. **Product owner input required:** O10 source selection/permission, not package choice.

### M04 — Hindi/Marathi hyphenation barely exists

**Claude severity:** MEDIUM. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Usable patterns effectively do not exist; copyfit should not depend on them. **What the existing architecture claims:** TR already requires approved dictionaries and says hyphenation may be disabled by language/profile.

**Evidence:** TR candidate and acceptance sections; upstream [Marathi patterns](https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-mr.tex) and [Hindi patterns](https://raw.githubusercontent.com/hyphenation/tex-hyphen/master/hyph-utf8/tex/generic/hyph-utf8/patterns/tex/hyph-hi.tex) are available. **Technical analysis:** Existence refutes a blanket absence inference; it does not establish newsroom usability, approved break conventions or license/build compatibility. “Controlled tracking” is also not automatically safe within Indic shaping clusters.

**Final reconciliation position:** Record qualified pattern identity or disabled status per language/style; support no-hyphenation fit and explicit editorial proposals. Test breaks with native reviewers. **Master Build Spec impact:** MSV2-08. **Roadmap impact:** RM07 evidence under RMV2-02. **Backlog impact:** no automatic fit claims in UI017. **Research required:** RD02, absorbing Claude RD19. **Product owner input required:** No technology choice; O02 identifies editorial reviewers.

### M05 — Nastaliq is treated like other scripts

**Claude severity:** MEDIUM. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Nastaliq difficulty/style distinction is absent; require separate Naskh/Nastaliq qualification. **What the existing architecture claims:** TR explicitly discusses Nastaliq overhangs/extents, line collisions and approved justification; MS §4 singles it out; RD02 names it.

**Evidence:** TR language table and paragraph following it; MS §4. **Technical analysis:** The omitted distinction is matrix granularity, not awareness. Claude's universal kashida prescription is too broad for unqualified fonts/editorial practice; the existing prohibition on indiscriminate insertion is safer.

**Final reconciliation position:** Qualify font/language/style combinations separately; test eventual Nastaliq needs before an engine choice that excludes them. Do not silently substitute Naskh for required Nastaliq or force both into the first pilot. **Master Build Spec impact:** MSV2-08. **Roadmap impact:** RMV2-01/02. **Backlog impact:** visibly illustrative Urdu fixtures. **Research required:** RD02. **Product owner input required:** O02 pilot styles and reviewers.

### M06 — Reverse the agent-instruction-file prohibition

**Claude severity:** MEDIUM. **Astra reconciliation classification:** REJECT.

**What Claude claims:** The current prohibition obstructs future agent-driven work and must be reversed at RM01. **What the existing architecture claims:** P16 says “at this stage” and explicitly permits future guidance if later authorized; D12 records a documentation-only instruction.

**Evidence:** P16 final paragraph; current user restriction allows only this reconciliation file. **Technical analysis:** A stage-scoped user instruction is not a permanent architecture defect. Minimal future guidance may help, but it need not precede tokens/routes and it cannot be created now.

**Final reconciliation position:** Keep the present restriction. Future authorized feature specs may consider short guidance without copying the architecture into it. **Master Build Spec impact:** None. **Roadmap impact:** reject R5's mandatory reversal. **Backlog impact:** none. **Research required:** None. **Product owner input required:** No new product decision; future task authorization governs file creation.

### M07 — Nineteen testing layers burden the UI phase

**Claude severity:** MEDIUM. **Astra reconciliation classification:** REJECT.

**What Claude claims:** The test architecture presents every layer as an immediate obligation. **What the existing architecture claims:** P14 already has a Gate column assigning UI, backend, engine, production and press applicability; MS §11 and every backlog unit separate UI evidence from production qualification.

**Evidence:** P14 “Verification layers” and “Test tooling and ownership”; UI026 out-of-scope. **Technical analysis:** The premise is contradicted by explicit staging. G-number cross-references could improve navigation, but do not warrant a new test program or correction of nonexistent mandatory UI publishing tests.

**Final reconciliation position:** Keep proportional UI component/keyboard/fixture and journey evidence, activating production layers when relevant. **Master Build Spec impact:** None. **Roadmap impact:** optional gate cross-reference in RMV2-09. **Backlog impact:** BLV2-05 improves incremental journey delivery. **Research required:** None. **Product owner input required:** None.

### M08 — Rights requirements force a download gateway

**Claude severity:** MEDIUM. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Every rights-bearing release/member must use a streaming gateway; signed URLs can serve low-sensitivity thumbnails. **What the existing architecture claims:** MS §9 already requires enforceable gateway behavior when immediate revocation is needed and identifies signed URLs as bearer capabilities.

**Evidence:** MS §§8–9; P11 revocation contract. **Technical analysis:** Specify the revocation window first. Request-time authorization followed by a short-lived URL has a bounded exposure window; an enforcing gateway/edge authorization can deny new requests immediately but cannot recall cached or delivered bytes. Thumbnails can themselves expose embargoed copyrighted material. Resumed/range requests, CDN caches and in-flight transfers need defined semantics. UI links should call a download action, so transport is not an RM01 URL-shape prerequisite.

**Final reconciliation position:** ND08 selects an authenticated streaming or edge-enforced path for artifacts requiring current-grant enforcement; signed capabilities only where the documented rights/security policy permits the residual window. No universal low-risk thumbnail exemption. **Master Build Spec impact:** MSV2-17. **Roadmap impact:** RMV2-09 before release delivery. **Backlog impact:** adapter-based download states only. **Research required:** RD09/12 revocation/cache/stream tests. **Product owner input required:** O05/O07 contracts; no transport choice asked of owner.

### M09 — Add provisional RPO/RTO values

**Claude severity:** MEDIUM. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Minutes of draft loss, zero committed-release loss, and recovery within one publication cycle are defensible working targets. **What the existing architecture claims:** PO08/RD12 intentionally avoid invented SLA promises and already require replication checks before archive commitment.

**Evidence:** MS §§8–9; P11 disaster recovery; RD12. **Technical analysis:** Internal design hypotheses help, but “zero” needs a failure boundary, and one publication cycle can be too slow at deadline. Choose testable fault classes and distinguish acknowledged draft durability, archive replication acknowledgment, restore time and service resumption. Compare cost/latency against owner needs before procurement.

**Final reconciliation position:** Record provisional scenarios/budgets in RD12, visibly noncontractual, then validate; do not publish Claude's numbers as defaults. **Master Build Spec impact:** MSV2-17 operational assumptions. **Roadmap impact:** RMV2-09. **Backlog impact:** UI025 never implies offline/recovery guarantee. **Research required:** RD04/12 benchmark and drills. **Product owner input required:** O08 before operational commitment.

### M10 — Let owned/manual content work precede G2

**Claude severity:** MEDIUM. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Owned/manual content has no third-party rights risk and should not wait for G2. **What the existing architecture claims:** UI mocks already model content; G2 precedes all real customer data, not merely externally fetched material.

**Evidence:** RM03/RM05, D04, MS §11. **Technical analysis:** Customer-owned stories may still be confidential, tenant-sensitive or contain third-party photos. Ownership does not remove access-control, parser or retention obligations. Isolated fictional/licensed research and domain modeling can precede G2.

**Final reconciliation position:** Split RM05 modeling/isolated experiments from live operational ingestion. Keep G2 for every real customer-content path, including manual entry. **Master Build Spec impact:** MSV2-18 clarifies gate. **Roadmap impact:** RMV2-04. **Backlog impact:** unchanged fictional-only boundary. **Research required:** Existing RD07/09. **Product owner input required:** O07/O10 before live use.

### M11 — UI026 is too broad

**Claude severity:** MEDIUM. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Twenty-one dependencies make the acceptance unit a phase violating one-feature-per-branch. **What the existing architecture claims:** UI026 verifies prior features; it does not implement them. Individual tests already run per unit.

**Evidence:** UI026 and backlog sequencing section. **Technical analysis:** An integration gate can depend on all integrated features without implementing them in one branch. However, postponing all journey evidence until the end risks integration surprises.

**Final reconciliation position:** Deliver journey tests incrementally and retain UI026 as a final evidence checklist/report, not a large feature branch. **Master Build Spec impact:** None. **Roadmap impact:** RMV2-09 G1 evidence. **Backlog impact:** BLV2-05. **Research required:** None. **Product owner input required:** None.

### M12 — Lock four open items now

**Claude severity:** MEDIUM. **Astra reconciliation classification:** MIXED — SPLIT INTO MULTIPLE DECISIONS.

**What Claude claims:** Frontend stack, millipoints, gateway and engine seam are settled enough to lock. **What the existing architecture claims:** Framework recommendation is strong but adoption remains gated; unit, revocation needs and engine execution are conditional.

**Evidence:** DR OP12/13/14/RD05; MS §§3/4/9; M01/M08/H01 above. **Technical analysis:** **ACCEPT WITH MODIFICATION** a frontend direction limited to React/TypeScript/Vite and an isolated engine boundary, with exact-version checks before adoption. **RESEARCH REQUIRED** for numeric representation. **ACCEPT WITH MODIFICATION** revocation behavior, with implementation selected against policy. OP12 also bundles database/storage; accepting a frontend choice must not approve that entire row.

**Final reconciliation position:** Reduce repeated debate through bounded defaults and closure criteria, not premature blanket locks. See the fifteen-row lock audit below. **Master Build Spec impact:** MSV2-02/06/17/18. **Roadmap impact:** RMV2-02/09. **Backlog impact:** UI001 adoption check and BLV2-01. **Research required:** RD05/09/10/13 as applicable. **Product owner input required:** None for frontend or units; O05/O07 for delivery commitments.

## Low findings — individual adjudication

### L01 — Numbering schemes collide

**Claude severity:** LOW. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Retire documentation Phase N labels. **What the existing architecture claims:** Historical Phase 1–24, product P0–17 and delivery RM/G describe different sequences. **Evidence:** artifact titles and original context §56. **Technical analysis:** Rename-all work would break useful historical references; qualify identifiers by namespace.

**Final reconciliation position:** Future prose uses topic + RM/G and treats Phase N as historical. **Master Build Spec impact:** MSV2-18 glossary. **Roadmap impact:** RMV2-09. **Backlog impact:** no renumbering. **Research required:** None. **Product owner input required:** None.

### L02 — Paginator/Pageinator naming

**Claude severity:** LOW. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Naming must be resolved before any code. **What the existing architecture claims:** Product documents and this user instruction consistently use Pageinator; the local folder is Paginator. **Evidence:** current task/title and workspace path. **Technical analysis:** A historical directory name need not define product identifiers or require a workspace rename.

**Final reconciliation position:** Use Pageinator for product-facing names; record the local-folder exception. Do not rename files/root now. Domain/trademark/business naming is not inferred from a folder. **Master Build Spec impact:** MSV2-18 naming note if needed. **Roadmap impact:** no additional prerequisite. **Backlog impact:** use consistent copy/package naming in authorized UI feature. **Research required:** None for architecture. **Product owner input required:** None absent a proposed brand change.

### L03 — Gates need approvers

**Claude severity:** LOW. **Astra reconciliation classification:** ACCEPT.

**What Claude claims:** Add explicit gate approvers. **What the existing architecture claims:** P14 assigns responsibilities but RM gates lack an approval column. **Evidence:** P14 ownership; roadmap gate table. **Technical analysis:** Roles are definable now; actual named people require project staffing. External press acceptance differs from internal technical approval.

**Final reconciliation position:** G0 architect/spec reviewer; G1 product/UX plus accessibility reviewer; G2 security/backend accountable lead; G3 publishing/prepress lead with language reviewers; G4 operations/security and contract-policy owner; G5 operations/security; G6 receiving press/prepress representative plus newsroom; G7 customer product sponsor, with commercial owner if paid. Record evidence, approver, date and supported scope; roles can be combined with explicit accountability. **Master Build Spec impact:** MSV2-18. **Roadmap impact:** RMV2-09. **Backlog impact:** UI026 evidence sign-off. **Research required:** None. **Product owner input required:** O01/O03 identify acceptance representatives, not a new questionnaire item.

### L04 — Dependency evidence needs dates/methods

**Claude severity:** LOW. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Add per-row verification metadata and stale intervals. **What the existing architecture claims:** Research artifacts are dated; RD10 already requires exact-version refresh before adoption. **Evidence:** DR RD10 and registry status explanation. **Technical analysis:** Per-row provenance helps, but a recent document observation is not a binary/license/security audit; fixed expiry intervals alone are inadequate.

**Final reconciliation position:** Record artifact/version/hash, checked-on date, retrieval method/source and unverified dimensions; refresh on adoption, material upgrade or advisory, with risk-based scheduled reviews. **Master Build Spec impact:** MSV2-18. **Roadmap impact:** RMV2-09. **Backlog impact:** UI001 exact-dependency evidence. **Research required:** RD10, already existing. **Product owner input required:** None.

### L05 — Deployment diagram looks decided

**Claude severity:** LOW. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Diagram silently locks topology. **What the existing architecture claims:** P2 titles it “Recommended deployment shape” and labels recommendations repeatedly. **Evidence:** P2 diagram heading and choice table. **Technical analysis:** The premise is overstated; a concise caption distinguishing logical/process boundaries from deployment counts improves interpretation.

**Final reconciliation position:** Keep the useful diagram; annotate candidate topology during future edits. **Master Build Spec impact:** MSV2-02 maintains conditional deployment language. **Roadmap impact:** none beyond ND01. **Backlog impact:** none. **Research required:** No new work. **Product owner input required:** None.

### L06 — Risks need accountable owners and status

**Claude severity:** LOW. **Astra reconciliation classification:** ACCEPT.

**What Claude claims:** Add owner, mitigation status and retirement gate to K01–30. **What the existing architecture claims:** Static risk rows and separate RD accountabilities exist. **Evidence:** risk register and DR research role column. **Technical analysis:** Cross-linking avoids a separate competing decision authority. Some risks remain ongoing controls rather than being permanently retired.

**Final reconciliation position:** Add accountable role, open/mitigated/accepted status, evidence and next review gate in a future authorized update. **Master Build Spec impact:** MSV2-18 cross-reference only. **Roadmap impact:** RMV2-09. **Backlog impact:** none. **Research required:** None beyond linked RD. **Product owner input required:** Only if accepting a product/business risk, handled in O set.

## Significant additional positions in Claude's later sections

These eight findings are counted separately because they introduce decisions beyond C01–L06. Their severity is reported only where Claude supplied one; none is invented here.

### X01 — Replates and edition variants (Claude E5/P/PO12)

**Claude severity:** HIGH (E5). **Astra reconciliation classification:** PRODUCT OWNER DECISION REQUIRED.

**What Claude claims:** City/district variants and late replates are missing required daily workflows. **What the existing architecture claims:** Editions have date/region and immutable releases; it does not promise page-level replate operations. **Evidence:** UI008, MS §§2/8, original context §§27–29. **Technical analysis:** Region editions do not fully model a second print run or revised page set, but prevalence is not proof of pilot scope. A minimal future contract can derive a new candidate/release from an earlier release, record changed pages and run identity, recheck continuation/plan dependencies and retain both. Replacing archived page files in place is never valid.

**Final reconciliation position:** ND07/O12 selects pilot variants/replates scope before durable edition workspace design. **Master Build Spec impact:** MSV2-03/16. **Roadmap impact:** RMV2-06/09. **Backlog impact:** no automatic new feature; a future selected variant scenario can extend UI008/021. **Research required:** RD05/04 and press workflow discovery under RD03 if selected. **Product owner input required:** O12.

### X02 — Infeasibility, overset and constraint precedence (Claude F.1/F.2/RD20)

**Claude severity:** Not separately assigned; RD20 is MEDIUM. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** Locks are absolute, overset only implicit, and no policy says which constraints yield. **What the existing architecture claims:** P3 explicitly ranks press/ad constraints above locks, records unplaced ranges and returns infeasibility without automatic relaxation. **Evidence:** P3 constraints/manual edit/rendering sections; MS §4. **Technical analysis:** Precedence identifies why a proposed state is unacceptable; it is not authority to violate a lower-ranked hard constraint. Need stable diagnostics: missing dependency, unsupported primitive/font, forbidden break, overset, contradictory hard constraints, lock conflict, expired reservation, plan mismatch, stale base, and computation budget exhausted. A heuristic timeout does not prove mathematical infeasibility.

**Final reconciliation position:** Expose source ranges and diagnostic causes; offer user-approved relaxation/proposals and distinguish unknown feasibility from proven violation. **Master Build Spec impact:** MSV2-09/10. **Roadmap impact:** RMV2-06/09. **Backlog impact:** UI018–019 fixtures under BLV2-02/07. **Research required:** RD05 absorbs RD20. **Product owner input required:** No algorithm choice; O15 ad authority as relevant.

### X03 — Lock HarfBuzz, FreeType and ICU (Claude G.1/I/M)

**Claude severity:** Not separately assigned. **Astra reconciliation classification:** RESEARCH REQUIRED.

**What Claude claims:** No credible alternatives exist; all viable stacks use this exact trio. **What the existing architecture claims:** Mature shaper/font/Unicode capabilities are required; TR makes FreeType conditional if the renderer already supplies the needed capability and keeps exact builds/distribution open. **Evidence:** TR candidate table, DR D09/RD01/02/10, C03. **Technical analysis:** Candidate names do not prove independent deployment of all three is necessary. A paragraph/vendor stack may encapsulate capabilities, and duplicated font/Unicode implementations add weight and drift. Browser distribution and fonts constrain licensing/packaging. “No alternative” was not independently established by Claude.

**Final reconciliation position:** Lock capabilities and adapter tests, keep the trio as strong comparison candidates, choose versions/bindings after ND01 evidence. **Master Build Spec impact:** MSV2-02/08/18. **Roadmap impact:** RMV2-02. **Backlog impact:** no native dependency requirement. **Research required:** RD01/02/10/13. **Product owner input required:** O04 budget and O02 required matrix only.

### X04 — Commercial preflight must be purchased; a custom writer is easy (Claude G.2/I/M)

**Claude severity:** Not separately assigned. **Astra reconciliation classification:** MIXED — SPLIT INTO MULTIPLE DECISIONS.

**What Claude claims:** Commercial preflight is effectively mandatory and PO04 should only confirm budget; a narrowly built writer deserves first-class status. **What the existing architecture claims:** HYBRID with probable professional-engine purchase; compare mature writers and consider alternatives if equivalent evidence exists. **Evidence:** PFR procurement exit, MS §§7/10, D09. **Technical analysis:** **ACCEPT** the expected commercial evaluation path; **REJECT** converting owner's procurement choice into presumed consent or an unproved universal impossibility claim. **RESEARCH REQUIRED** for writer adapters: positioned glyphs still require subsetting, Unicode mapping, resources, colour, transparency, conformance and untrusted PDF import. These are not trivial serialization. A thin original adapter over mature primitives is different from building a PDF implementation from scratch.

**Final reconciliation position:** Compare total cost/risk with import included. Budget refusal may mean scope/schedule change, never fake certification. **Master Build Spec impact:** MSV2-13/18. **Roadmap impact:** RMV2-03. **Backlog impact:** none. **Research required:** RD01/03/10/15. **Product owner input required:** O04 genuine option choice.

### X05 — AGPL categorically disqualifies SaaS (Claude I.4)

**Claude severity:** Not separately assigned. **Astra reconciliation classification:** REJECT.

**What Claude claims:** AGPL is disqualifying for SaaS unless commercially licensed. **What the existing architecture claims:** Copyleft/commercial paths require an approved compliance design; subprocesses are not legal exemptions. **Evidence:** MS §10, dependency commercial-status legend; [GNU AGPL text, especially §13](https://www.gnu.org/licenses/agpl-3.0.html). **Technical analysis:** The license imposes obligations, including for modified network-interactive versions; it does not categorically prohibit SaaS. Whether obligations fit Pageinator's proprietary distribution/service design requires exact component, linking, modification and deployment review. This is not legal clearance for any candidate.

**Final reconciliation position:** Retain conditional license review and commercial alternatives; reject a universal ban or universal subprocess exemption. **Master Build Spec impact:** MSV2-18 preserves accurate wording. **Roadmap impact:** RMV2-03 adoption gate. **Backlog impact:** no new dependency. **Research required:** RD10 exact license review. **Product owner input required:** O04 commercial/IP constraints, not legal interpretation.

### X06 — Record score inputs for later explanations (Claude H)

**Claude severity:** Not separately assigned. **Astra reconciliation classification:** ACCEPT.

**What Claude claims:** Explainable news scores need persisted input provenance, not a tooltip. **What the existing architecture claims:** NR uses versioned weights and provenance; MS §6 records AI versions but does not explicitly bind every displayed ranking to its feature inputs. **Evidence:** NR ranking paragraph; MS §6. **Technical analysis:** Retain score value, feature/weight/model versions, source observation references, timestamp and reason codes under rights/retention policy. Do not indefinitely copy prohibited source text merely to reproduce a score; record when an explanation is no longer reproducible because evidence retention lawfully expired.

**Final reconciliation position:** Add bounded score provenance and uncertainty, never a truth probability. **Master Build Spec impact:** MSV2-11. **Roadmap impact:** RMV2-04. **Backlog impact:** UI009 reason fixtures within existing scope. **Research required:** RD07/08 for quality and retention behavior. **Product owner input required:** O10 source rights, no new question.

### X07 — General constraint solvers must be excluded (Claude I capability table)

**Claude severity:** Not separately assigned. **Astra reconciliation classification:** REJECT.

**What Claude claims:** General solvers make infeasibility unexplainable; build narrow deterministic layout only. **What the existing architecture claims:** RD05 compares bounded heuristics before a solver and owns newspaper policy. **Evidence:** DR RD05; P3 deterministic configuration/timeout discussion. **Technical analysis:** A solver's explainability depends on model, diagnostics and integration; bespoke heuristics also fail without explanations. Neither name proves explainability or suitability. Rejecting a whole class conflicts with the commodity-reuse principle without measured evidence.

**Final reconciliation position:** Start simple deterministic layouts; consider a solver only for a measured gap with bounded resources and inspectable constraints. **Master Build Spec impact:** MSV2-09 retains candidate openness. **Roadmap impact:** no added lane. **Backlog impact:** no real solver. **Research required:** RD05 when complexity justifies comparison. **Product owner input required:** None.

### X08 — DOM/input/accessibility boundary is prematurely narrowed (Claude F.3/I.5/J/K)

**Claude severity:** Not separately assigned. **Astra reconciliation classification:** ACCEPT WITH MODIFICATION.

**What Claude claims:** DOM text is eliminated, accessible source mapping lacks ownership, and rich-text frameworks may bring competing models. **What the existing architecture claims:** BR already specifies DOM page/frame/story outlines and keyboard alternatives; MS §5 describes input adapters mapped to Pageinator commands, with no print authority. **Evidence:** BR rendering/interaction tables; MS §5; UI015/017/026. **Technical analysis:** Browser reflow cannot be final layout authority; this does not ban DOM/SVG shells, accessible text or all glyph-positioned rendering. Input libraries can own transient composition/selection history through an adapter; bespoke IME is not automatically simpler. Ownership should be explicit in RM12.

**Final reconciliation position:** RD06 qualifies semantic input, source-to-caret mapping, screen-reader/keyboard access and one command/undo authority. Keep resolved painting separate from editable semantic text; extend prompt-injection tests to uploaded metadata as untrusted data under existing RD09. **Master Build Spec impact:** MSV2-05/10/17. **Roadmap impact:** RMV2-02/09. **Backlog impact:** BLV2-01/07. **Research required:** RD06/09. **Product owner input required:** O08 supported devices/accessibility workflows, not library selection.

## Publishing-engine decision ownership and selection order

The publishing lead owns ND01, with frontend, typography, prepress, security and licensing reviewers. API runtime OP13 is a separate decision. A modular codebase can contain multiple runtime artifacts without becoming a microservice architecture.

| Capability requirement to settle first | Technology choices it constrains | Evidence before selection |
|---|---|---|
| Explicit positioned glyphs, source mappings, font instances, script/style correctness, no independent output reflow | HarfBuzz or a qualified encapsulating shaping stack; paragraph primitives | Corpus and API spike; exact glyph/source extraction and font access; RD01/02 |
| Font outlines/metrics/rasterization, variation support, no silent fallback, rights-aware browser delivery | FreeType or renderer/vendor font facilities | Avoid duplicate font stacks; font-format and hostile-input tests; RD02/09/10 |
| Bidi, segmentation, line-break rules, normalization versions | ICU or qualified Unicode services provided by selected stack | Pin data and APIs, conformance corpus, size/runtime review; RD02/13 |
| Optional per-language permitted word breaks with licensed patterns | libhyphen or paragraph-layer facility, or disabled hyphenation | Pattern-specific/native-reader evaluation and rights; RD02/10 |
| Scene painting with explicit glyphs, clips/transforms, images/ad previews; input/accessibility separate | DOM/SVG/canvas/CanvasKit/other graphics route | Instrumented scene parity, memory, startup and interaction benchmarks; RD01/06 |
| Server authority, provisional interaction, supported offline/nonoffline scope and remote budgets | Native/WASM/server placement, shared core versus renderer-only WASM | Browser font permission, payload/startup, parity and network tests; RD06/12/13 |
| Production candidate generation, PDF-ad fidelity, exact final-byte checks and diagnostic access | PDF writer/import adapter, commercial preflight route | Integrated import/writer/preflight corpus, procurement/DR terms; RD01/03/15 |

Selection sequence: define these capabilities and the authority/isolation seams → screen licensing/API access and deployment feasibility → run small alternative integrations → compare measured quality, UX, security and total cost → record language/build/distribution ADR and tested limits → freeze production scene/schema contracts only after broader qualification. This is iterative: a writer's unavailable glyph API or a WASM license constraint can invalidate an earlier candidate direction. No rule requires all libraries to run in the browser. PDF parsing, colour conversion and final preflight can remain isolated server operations while a smaller browser artifact paints authoritative glyph runs.

## news-please reassessment

**Conclusion: RESEARCH FURTHER**, specifically a bounded extraction-only WRAP comparison. Whole-pipeline ADOPT is unsupported. REFERENCE is useful now and is the fallback if runtime integration offers no measured benefit. REJECT is not established. No from-scratch extractor is proposed.

Primary web evidence was inspected on 2026-09-16 through the browsing tool. Its returned pages may be cached; this was documentation/source inspection, not package installation, wheel execution or a security audit.

| Dimension | Evidence and reconciled conclusion |
|---|---|
| Technical crawling/extraction | Upstream documents distinct library/CLI paths and an HTML extraction entry point. This supports evaluating a stateless adapter, not adopting its crawler/storage topology. [Upstream README](https://github.com/fhamborg/news-please) |
| Hidden I/O and execution | Inspected master `from_html` bypasses Scrapy and has `fetch_images=True` by default; batch URL processing uses a process pool. Test `fetch_images=False` under denied egress, malicious URLs and explicit per-request accounting. The release wheel still needs its own inspection. [Library source](https://raw.githubusercontent.com/fhamborg/news-please/master/newsplease/__init__.py) |
| Dependency/operational suitability | Master setup lists unconditional database/search/cloud clients, extraction libraries and minimum-version ranges; it declares version 1.6.13. These increase installation, compatibility and supply-chain cost even in an isolated worker. They do not require Pageinator to operate each referenced service. Benchmark import/startup/memory and extraction benefit against direct alternatives. [Setup source](https://raw.githubusercontent.com/fhamborg/news-please/master/setup.py) |
| Release-date discrepancy | PyPI lists both 1.6.16 distribution files uploaded **2025-09-21**, supporting Astra's recorded date. The wheel's listed SHA-256 is `ea542de0cf7e24e11ccef38546106ffa93419559556e9a2b31b8af1a4c2be63c`; this is page metadata, not a locally verified download hash. The version-specific JSON endpoint returned a fetch error, so Claude's alleged JSON response was not reproduced. Do not replace the date with 2024-01-19. [PyPI file metadata](https://pypi.org/project/news-please/) |
| Maintenance health | Visible history includes a 2026-04-14 README cleanup and 2025 functional changes. This refutes an unsupported abandonment conclusion but establishes neither active security response nor supported modern interpreter compatibility. Release/source mapping and issue/support responsiveness remain adoption checks. [Commit history](https://github.com/fhamborg/news-please/commits/master/) |
| License suitability | Upstream labels the project Apache-2.0. That is a plausible core license route, not clearance of transitive dependencies or source content. Review exact release notices, dependency graph and distribution form under RD10. [Project license](https://github.com/fhamborg/news-please/blob/master/LICENSE.txt) |
| Source terms/robots | Library and crawler paths differ; reading robots for sitemap discovery is not proof of exclusion compliance. Pageinator owns authorized access, user-agent/robots policy, redirects/SSRF, quotas and retention before fetch. The protocol itself does not supply access authorization. [Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html) |
| Republication rights | Neither a package license nor successful extraction establishes permission to store, display, edit, translate, AI-process, print or reprint third-party material. Existing D07/MS §6 action-specific rights remain unchanged. Source agreements, not extractor selection, govern these operations. |

RD07 exit: reconcile the exact wheel/source provenance; compare news-please, direct newspaper4k and Trafilatura on permitted source/language samples using the existing NR minimum of 25 articles per pilot language as a starting corpus, expanded where errors cluster. Score body/headline/date/author extraction, encoding preservation, partial failures, incidental fetches, p95 resource/latency cost, update burden and license fit. Use the same labeled material for every candidate. Adopt/wrap only if the ensemble's measured value exceeds its added cost. If access is feed/API-only, defer this comparison rather than installing an unused crawler. RD08 covers later AI quality, not HTML extraction accuracy.

## Audit of Claude's eight reopening recommendations

| Claude ID | Decision subject | Required classification | Reconciliation and reason |
|---|---|---|---|
| N1 | OP14 server-authoritative resolution | REOPEN | Reconsider execution placement and local-estimate strategy under the explicit authoritative/provisional contract. Authority remains server-accepted; no weakening of settled-proof parity. OP14 was open/recommended, so this reopens its working direction, not a previously approved technology. |
| N2 | RD01 renderer/composer/writer | REFINE | Already open. Couple deliverables to RD06/13 and add separately reported PDF-ad import. Do not merge every workstream into an unmanageable single decision or serially block exploratory evidence. |
| N3 | RD05 numeric representation | RESEARCH FIRST | Retain bounds/transform/wire-format work; millipoints are a strong candidate, not proved by int64 coordinate squaring. Paper analysis precedes a focused spike. |
| N4 | RJ04 veraPDF | KEEP LOCKED | The existing rejection is already limited to comprehensive PDF/X preflight. |
| N5 | DEP38 news-please | RESEARCH FIRST | Fresh source/PyPI evidence does not establish a comparative winner. Keep extraction WRAP evaluation bounded; no automatic ADOPT of upstreams. |
| N6 | DEP60 engine-language ownership | REOPEN | Move the unowned working assumption into ND01/RD13 with its own accountable ADR. DEP60 still describes original policy code; it should link the decision rather than own it. |
| N7 | P16 stage-specific guidance-file restriction | KEEP LOCKED | Honor current user scope; future authorized guidance was already allowed. No permanent prohibition to reverse. |
| N8 | RM14 concurrency sequencing | PRODUCT OWNER FIRST | O06 establishes simultaneous editing need; RD05 designs granularity before RM06 durable schema. RM06 already has this dependency; make it visible and test it early. |

**Total decisions reopened: 2** (N1/N6 working architecture directions). No locked product requirement is rescinded. Two other decisions are refined, researched or owner-gated without falsely counting an already-open workstream as newly reopened. D03 is clarified rather than reopened; a future O14 request for emergency non-conforming output would require a separate explicit reopening of release policy.

## Audit of Claude's fifteen “safe to lock” proposals

| Proposal in Claude §M | Reconciled disposition |
|---|---|
| HarfBuzz/FreeType/ICU | Do not lock technologies yet; X03 capability-first evaluation. |
| Integer millipoints | Do not lock; M01/RD05 bounds and integration evidence first. |
| Organization tenant/publication scope | Keep D04 locked, including scoped references and deny-by-default authority. |
| Authenticated gateway for all rights-bearing artifacts | Lock required revocation behavior; ND08 qualifies enforcing transport and allowed window, not a thumbnail exemption. |
| Isolated resource-limited engine worker | Adopt production isolation boundary; do not require independent service deployment or durable queues for every provisional edit. |
| Snapshots plus bounded command history | Strong default for implementation; preserve pinned release/hold evidence. No need for full-system event sourcing. Bounded history does not imply bounded audit retention. |
| Fail-closed preflight | Keep locked; owner recovery choice cannot silently turn failures green. |
| No silent font substitution | Keep locked; qualified substitutions require explicit change and new proof. |
| Archive before master exposure/append-only receipts | Keep and index under D06; already implemented in specification, not runtime. |
| Edition-local story lineage | Keep and index under D03; no hidden alternate text body. |
| Release serialization against revocation | Keep and index under D05; test equivalent transaction protection. |
| Tenant-private derived news data | Keep and index under D04. |
| Commercial preflight expected | Preserve as likely procurement path, not a purchase or owner-budget decision; X04. |
| React/TypeScript/Vite | Accept frontend direction for a bounded UI feature, exact-version/adoption review still required; do not also approve bundled database/storage choices. |
| All outputs from one resolved digest | Apply to page-faithful outputs with explicit recipes and lineage; accessible/reflowable reading remains a labeled derivative. |

## Overengineering and buildability check

**Where Astra overengineered or created avoidable burden:** the breadth of the 64-candidate catalogue can look like an obligation to evaluate everything; future work should use capability screening and a small shortlist. The original micro-point preference spent precision without a justified physical error budget and was rightly withdrawn before this review. Twenty-six UI units can consume too much runway before engine learning; RM04 should run independently under separate authorization. Repeating statuses/counters across many documents creates avoidable maintenance work. The AI roadmap is a destination: one evaluated task/provider and a manual path are enough to begin. Mock DTOs must stay small, not become a shadow production schema.

**Where Claude overengineered or locked too much:** compulsory hash-chain infrastructure, a universal application download gateway, separately deployed services for every engine use, and a broad new research item for every already-owned question add cost without a threat/workload justification. Mandatory page leases with cross-lease mutations are premature. C++/Rust-only framing narrows before testing; mandating three libraries can duplicate an encapsulated stack. A custom writer is not automatically simpler than a mature library. Banning reusable logic or all persistence inside mock units is counterproductive. Requiring a full flat-plan feature, owner emergency policy and publishing measurements before UI tokens/shells unnecessarily serializes unrelated work.

**Where both may overengineer:** universal long-term editable restoration before choosing a pilot recovery promise; advanced multilingual semantic search before basic authorized metadata retrieval; all types of simultaneous editing, digital distribution, replates and historical imports in the first pilot; general arbitrary-page layout optimization; large approval/counter taxonomies that duplicate the same evidence. Keep these capability boundaries visible without implementing every option.

**Complexity professional publishing actually requires:** script-aware shaping and source-to-glyph mappings; paragraph/linked-flow correctness; genuine provisional-versus-authoritative editing reconciliation; no dropped text; explicit press page/colour/ad constraints; qualified PDF resource/font/import behavior; final-byte conformance and physical press testing; exact release identities; rights and current authorization; crash-safe archive commitment; reliable recovery. These directly protect the published newspaper and cannot be replaced by a good-looking mock or a convenient renderer.

**Buildable first production slice:** one explicitly supported template/format, one agreed pilot language/font subset plus eventual-script feasibility probes, manual/owned content, booked ad constraints, a printer-supplied page-capability map, a qualified writer/import path, one final-byte validation route and coordinated editing if O06 accepts it. Keep the ability to reject unsupported content. This is a candidate scope for owner review, not a chosen customer preference.

## Final reconciliation matrix

Rows cover all 46 significant findings; X severities are not invented. Confidence concerns the reconciliation judgment, not feasibility. “Blocks UI foundation?” means prevents authorizing bounded UI001–003 with the contract in section L; later sample-editor/planning obligations do not block these units. “Blocks production engine?” identifies unresolved capability/contract work before relevant production engine commitment, not a ban on isolated research. “Later” means another gate, such as release, ingestion or commercial launch.

| ID | Claude severity | Topic | Claude position | Astra original position | Reconciled position | Confidence | Action | Owner needed? | Research needed? | Blocks UI foundation? | Blocks production engine? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| C01 | CRITICAL | Geometry | Undefined; fixed tolerance | Same scene, incomplete oracle | ACCEPT WITH MODIFICATION; semantic equality + measured adapter budget | High | MSV2-04 | No | RD01/05 | No | Yes |
| C02 | CRITICAL | Interaction | Server authority contradictory | Conditional server resolution/local gestures | ACCEPT WITH MODIFICATION; provisional/saved/resolved separated | High | Reopen OP14 | O06/08 | RD01/06/13 | No | Yes |
| C03 | CRITICAL | Engine substrate | C++ implicitly selected | Language open, no dedicated owner | ACCEPT WITH MODIFICATION; ND01 owns evidence-led choice | High | RD13 | O04/08 | Yes | No | Yes |
| C04 | CRITICAL | Legacy text | Inevitable conversion requirement | Unicode composition, originals | MIXED — SPLIT INTO MULTIPLE DECISIONS; ingress contract plus scoped support | High on gap; medium on demand | ND03 | O02/13 | RD14 | No | Conditional on required inputs |
| C05 | CRITICAL | Flat plan | Missing model and colour rules | Ad-first constraints, no plan aggregate | ACCEPT WITH MODIFICATION; plan pins run-specific capability map | High | ND02 | O01/03 | RD03/05 | No | Yes |
| C06 | CRITICAL | PDF ads | No qualified import | Required, incompletely evaluated | ACCEPT; separately qualify import/writer pair | High | ND04/RD15 | O04/15 | Yes | No | Yes for PDF-ad support |
| H01 | HIGH | Engine seam | Missing; separate worker mandatory | Workers already proposed | ACCEPT WITH MODIFICATION; isolation, flexible transport | High | MSV2-02 | No | RD09/13 | No | Yes |
| H02 | HIGH | Fixups | Rule absent | New bytes/proof/approval already required | ACCEPT WITH MODIFICATION; read-only validation enforcement | High | MSV2-15 | No | RD03 | No | Yes before export |
| H03 | HIGH | Deadline | Emergency or no escape | Fail closed, recovery underspecified | PRODUCT OWNER DECISION REQUIRED; retain fail closed pending answer | High | ND05/O14 | Yes | RD12 | No | Later: press pilot |
| H04 | HIGH | Output derivation | One rule for all outputs | Preview/PDF rule; e-paper deferred | ACCEPT WITH MODIFICATION; page-faithful versus reading derivative | High | MSV2-14 | O11 later | RD01 | No | Yes for output adapters |
| H05 | HIGH | Search | No tenancy/analyzer plan | Tenant scope and RD07 exist | ACCEPT WITH MODIFICATION; expand RD07, no forced cluster | High | MSV2-11 | Scope only | RD07 | No | Later: promised search |
| H06 | HIGH | Duplicate/reprint | Semantics absent | Rights/lineage already explicit | ACCEPT WITH MODIFICATION; clarify copy purpose/ad/profile | High | MSV2-16 | O05/12/15 | RD04/09 | No | Later: archive workflow |
| H07 | HIGH | UI reuse | Binary disposability/no persistence | Mock boundaries already explicit | ACCEPT WITH MODIFICATION; component-level lifecycle | High | BLV2-01 | No | No | No | No |
| H08 | HIGH | Concurrency | Page leases now | O06 before RM06 already | MIXED — SPLIT INTO MULTIPLE DECISIONS; workflow first, conflict proof | High | MSV2-10 | O06 | RD05/06/09 | No | Yes |
| H09 | HIGH | Font rights | Missing owner/rights | Font grants and RD02/04/10 exist | ACCEPT WITH MODIFICATION; explicit enforcement links | High | MSV2-11 | O02/05 | RD02/10 | No | Yes |
| H10 | HIGH | Audit | Hash chain nearly free | Append-only/package evidence | MIXED — SPLIT INTO MULTIPLE DECISIONS; assurance before mechanism | High | ND06 | O05/07 | RD04/09 | No | Later: release |
| H11 | HIGH | Feasibility | Default pilot matrix | Owner dependencies delay RM04 | ACCEPT WITH MODIFICATION; reference corpus, trials still gated | High | RMV2-01 | Budget only | Existing RD | No | No; unblocks research |
| H12 | HIGH | Ad-sales boundary | Implicit | Explicit non-goal | REJECT omission; retain constraints-only scope | High | Keep DF05 | O15 workflow | No new | No | No |
| H13 | HIGH | PPI | Missing threshold; quality only | Minimum by class already specified | ACCEPT WITH MODIFICATION; policy can warn or block | High | MSV2-12 | O03/14 | RD03 | No | Yes before press output |
| H14 | HIGH | Register | Four new top-level decisions | Existing umbrella decisions/details | ACCEPT WITH MODIFICATION; indexed subclauses | High | MSV2-18 | No | No | No | No |
| M01 | MEDIUM | Numeric unit | Lock millipoints | Bounded representation open | ACCEPT WITH MODIFICATION; paper analysis then tests | High | RD05 | No | Yes | No | Yes |
| M02 | MEDIUM | veraPDF | Rejection too broad | Specifically PDF/X-alone rejection | REJECT | High | Keep RJ04 | No | No | No | No |
| M03 | MEDIUM | news-please | REFERENCE; adopt alternatives | RESEARCH FURTHER | RESEARCH REQUIRED; benchmark exact artifacts | High | RD07 | O10 sources | Yes | No | No; ingestion gate |
| M04 | MEDIUM | Hyphenation | Patterns effectively absent | Qualified dictionaries or disabled | ACCEPT WITH MODIFICATION; patterns exist, quality unproved | High | RD02 | Reviewer only | Yes | No | Yes for language claims |
| M05 | MEDIUM | Nastaliq | Difficulty absent | Explicit Nastaliq risk | ACCEPT WITH MODIFICATION; finer matrix | High | MSV2-08 | O02 | RD02 | No | Yes |
| M06 | MEDIUM | Agent files | Reverse prohibition | Stage-scoped restriction | REJECT | High | Honor current scope | No | No | No | No |
| M07 | MEDIUM | Tests | All layers imposed now | Already staged by gate | REJECT | High | Preserve staging | No | No | No | No |
| M08 | MEDIUM | Downloads | Universal gateway | Policy-dependent revocation | ACCEPT WITH MODIFICATION; enforceable window/transport | High | ND08 | O05/07 | RD09/12 | No | Later: delivery |
| M09 | MEDIUM | Recovery targets | Set generic working SLA | Customer-dependent targets | ACCEPT WITH MODIFICATION; explicit internal fault scenarios | High | RD12 | O08 | RD04/12 | No | Later: platform/pilot |
| M10 | MEDIUM | Owned content | All owned content before G2 | Any real customer data gated | ACCEPT WITH MODIFICATION; only isolated modeling before G2 | High | RMV2-04 | O07/10 | RD09 | No | No |
| M11 | MEDIUM | UI026 | Split phase-size unit | Final integration verification | ACCEPT WITH MODIFICATION; incremental journeys + final gate | High | BLV2-05 | No | No | No | No |
| M12 | MEDIUM | Early locks | Four choices settled | Conditional directions | MIXED — SPLIT INTO MULTIPLE DECISIONS; bounded defaults | High | Lock audit | Policy only | RD05/09/10 | No | Relevant subsets |
| L01 | LOW | Numbering | Retire Phase labels | Multiple namespaces | ACCEPT WITH MODIFICATION; qualify, preserve history | High | Glossary | No | No | No | No |
| L02 | LOW | Name | Resolve folder/product | Pageinator product | ACCEPT WITH MODIFICATION; folder exception | High | Consistent copy | No | No | No | No |
| L03 | LOW | Approvers | Add names | Responsibilities elsewhere | ACCEPT; roles now, people at gate | High | RMV2-09 | O01/03 | No | No | Later: sign-off |
| L04 | LOW | Evidence freshness | Date every row | Artifact dates/adoption review | ACCEPT WITH MODIFICATION; exact artifact/method/scope | High | RD10 metadata | No | RD10 | No | Before adoption |
| L05 | LOW | Diagram | Silently decided | Already recommended | ACCEPT WITH MODIFICATION; clarify process/deployment | High | Caption | No | No new | No | No |
| L06 | LOW | Risk management | Add owner/status | Static risks + RD owners | ACCEPT; link accountable role/evidence/gate | High | RMV2-09 | Risk acceptance only | No new | No | No |
| X01 | HIGH | Replates | Missing required workflow | Date/region/revisions | PRODUCT OWNER DECISION REQUIRED; immutable derived release if scoped | Medium | ND07 | O12 | RD03/04/05 | No | Conditional on scope |
| X02 | Not assigned | Infeasibility/overset | Rules absent/locks absolute | Rules and overset already explicit | ACCEPT WITH MODIFICATION; stable diagnostics, no silent relaxation | High | RD05 | No | Yes | No | Yes |
| X03 | Not assigned | Primitive stack | Lock three libraries | Capability reuse, versions open | RESEARCH REQUIRED | High | ND01 | Budget/matrix only | RD01/02/10/13 | No | Yes |
| X04 | Not assigned | Preflight/writer | Purchase presumed; custom writer cheap | Compare mature routes | MIXED — SPLIT INTO MULTIPLE DECISIONS; evidence and owner budget | High | RD01/03/15 | O04 | Yes | No | Yes |
| X05 | Not assigned | AGPL | SaaS categorically disallowed | Compliance-dependent | REJECT blanket legal claim | High | Exact license review | O04 constraints | RD10 | No | Before relevant adoption |
| X06 | Not assigned | Score provenance | Preserve inputs | Versioned scores, partial binding | ACCEPT; bounded evidence record | High | MSV2-11 | O10 rights | RD07/08 | No | No; intelligence gate |
| X07 | Not assigned | Solvers | Reject general solvers | Compare only for measured need | REJECT categorical ban | High | Keep RD05 options | No | RD05 if needed | No | No additional block |
| X08 | Not assigned | Semantic input | DOM excluded, mapping unowned | DOM/input adapters already planned | ACCEPT WITH MODIFICATION; explicit RM12 ownership | High | RD06 | O08 | RD06/09 | No | Yes for editor |

## A. AGREEMENTS — NO CHANGE REQUIRED

Keep browser-first newspaper workflow; human editorial acceptance; deterministic physical authority; organization tenancy with publication-scoped authorization; immutable edited-revision export; exact archived bytes; archive-before-master-download; no silent font substitution; original asset preservation; action-specific rights; fail-closed mandatory checks; press-specific output qualification; and a labeled UI-first simulation. Keep source observations, events and editorial stories separate. Keep commodity reuse, a modular application with isolated workers, snapshots plus bounded command history as the default, and no automatic CRDT/microservice/solver platform.

Claude's agreements in §B are materially sound, with two wording qualifications: exact retrieval does not itself confer reprint permission, and rights safety covers stored/displayed discovery metadata as well as full republication. These qualifications already exist in Astra's architecture. G0 documents explicit open decisions; G1 UI success never proves G3/G6 publishing quality. No research result, press acceptance or commercial consent is inferred here.

## B. ASTRA POSITIONS CORRECTED BY CLAUDE

The central geometry invariant needed a more complete consumer-level conformance contract and a named distinction between pending interaction, saved intentions and authoritative proof. Engine implementation/distribution needed its own accountable decision instead of an unowned language note. Edition planning needed a versioned flat plan with run-specific colour capabilities and ad/news-hole ownership. PDF-ad import needed separately reported qualification and explicit licensing scope. Text ingress needed unknown/legacy encoding handling even if conversion is excluded from the pilot. RM04 needed a reference-corpus path independent of customer timing. Score explanations need bounded persisted input provenance. Gate approvers and decision/risk cross-references should be easier to locate.

These are real corrections. Writing them does not establish that any engine can satisfy them.

## C. CLAUDE FINDINGS REJECTED

Whole findings rejected: **H12, M02, M06, M07, X05, X07**. The ad-sales exclusion and narrow veraPDF rejection are already explicit; agent-file restrictions are stage-specific user constraints; tests are already staged; AGPL is not a categorical SaaS ban; and generic solvers are not categorically unexplainable.

Rejected premises within otherwise modified findings include: C++ already chosen, Nastaliq/font rights/PPI/fixup rules wholly absent, 2024-01-19 established as the news-please 1.6.16 upload date, no Hindi/Marathi pattern candidates, every low-PPI finding waivable, and page leases or a 25 µm production budget already proved. Rejecting a premise does not discard a useful narrower correction.

## D. FINDINGS ACCEPTED WITH MODIFICATION

**C01, C02, C03, C05, H01, H02, H04, H05, H06, H07, H09, H11, H13, H14, M01, M04, M05, M08, M09, M10, M11, L01, L02, L04, L05, X02, X08** — 27 findings. Their individual analyses define the modifications; the matrix supplies gate impact.

**C06, L03, L06, X06** are accepted. **C04, H08, H10, M12, X04** are mixed and split. **M03/X03** require research; **H03/X01** require owner decisions. Total: 46. Critical summary: **1 accepted, 4 modified, 0 rejected, 1 mixed/unresolved**. All six still have relevant unexecuted production evidence or scope gates; disposition counts are not feasibility closure.

## E. DECISIONS REOPENED

**2 working directions reopened:** OP14 execution/interaction placement (N1) and DEP60's unowned publishing-substrate assumption, now ND01 (N6). The eight-row reopening audit above governs. No locked product requirement is rescinded. RD01 is refined, RD05/DEP38 remain research-gated, RJ04 and the current guidance-file restriction remain locked, and concurrency scope awaits O06 before technical selection. Clarifying D03 does not authorize approximate final output.

## F. NEW DECISIONS REQUIRED

Eight proposed decision subjects, distinct from research workstreams. The four existing AR clarifications become indexed subclauses, not additional decisions.

| ID | Decision subject / accountable role | Fixed boundary | Remaining choice / required gate |
|---|---|---|---|
| ND01 | Publishing artifacts, language/build/distribution; publishing lead with frontend/security/legal | Capability/authority/isolation contract; separate from API language | Substrate, bindings, browser build, packaging and evidence-led ADR; before broad engine commitment |
| ND02 | EditionPlan/press configuration; edition/publishing lead | Versioned ordered pages, ad allocations, news hole and run capability map | Capture method and pilot workflow; before durable planning/layout |
| ND03 | Text ingress/legacy conversion; ingestion/typography lead | Unicode canonical text, originals/provenance, unknown-input refusal, no silent loss | Supported mappings and historical-import scope; before applicable imports |
| ND04 | PDF-ad import/normalization; prepress/publishing lead | Isolated import, diagnostic quarantine, no silent rasterization, versioned transforms | Qualified import/writer pair, formats, correction authority and license tier; before production ad output |
| ND05 | Deadline continuity/exceptional output; product owner with newsroom/prepress | Existing fail-closed release remains in force | Recovery/fallback commitment; non-conforming output requires explicit reopening; before press pilot |
| ND06 | Audit assurance/customer evidence; security/operations with product/legal | Approval evidence bound to exact artifact; append-only facts distinct from retention/access | Threat model, tamper-evidence mechanism, export/retention; before real release/archive promises |
| ND07 | Edition/run/variant/replate identity; edition lead with owner | Historical releases cannot be overwritten; derivations preserve lineage | Required run/page-replacement workflows and authority; before durable workspace model |
| ND08 | Released-artifact revocation/delivery; security/platform lead | Current-use authorization and explicit bearer exposure; no recall of delivered bytes | Enforcing transport/cache/range behavior against revocation window; before release delivery |

These are proposed register additions. No engine language, library version, vendor or owner preference is selected here.

## G. RESEARCH REQUIRED

**15 consolidated remaining workstreams:** retain RD01–12 with amendments; add proposed RD13 (substrate), RD14 (legacy ingress), RD15 (PDF-ad import). None is closed here. Claude's eight new items map as follows: RD13→new RD13; RD14→new RD14; RD15→new RD15; RD16→existing RD03; RD17→existing RD07 with an archive deliverable; RD18→RD02/04/10; RD19→RD02; RD20→RD05. Distinct import/substrate paths gain accountability without duplicating existing license/typography/layout research.

Categories identify the principal blocked commitment; gate notes identify earlier or conditional obligations. No broad publishing workstream blocks tokens/routes/scoped fictional adapters. Exact-version review of dependencies used by UI001 still precedes their adoption inside an authorized foundation feature: a bounded RD10 slice, not full-product SBOM completion.

| Workstream | Classification | Deduplicated scope / exit evidence | Resolution methods | Accountable role / timing |
|---|---|---|---|---|
| RD01 | BLOCKING PUBLISHING ENGINE | Composer/paragraph/renderer/writer integration under geometry contract; independent subset/Unicode/clip/image/ad checks; prespecified numerical budget; linked-flow and eventual-script coverage | documentation; prototype/spike; benchmark | Publishing lead; before production engine/schema commitment; coupled RD06/13/15 |
| RD02 | BLOCKING PUBLISHING ENGINE | Font/language/style matrix; Nastaliq/Naskh as relevant; qualified/disabled hyphenation; IME/source mapping; scored native-reviewer rubric; font rights | documentation; prototype/spike; benchmark; license review; customer discovery | Typography/legal/native reviewers; before language claims; absorbs RD18/19 portions |
| RD03 | BLOCKING PRESS OUTPUT | Profile/page-capability/run map, colour and PPI severity; vendor read-only/fixup behavior, licensed concurrency/DR terms; exact-file and physical acceptance | documentation; prototype/spike; license review; printer/vendor consultation; press test | Prepress lead; actual profile before production output; absorbs RD16 |
| RD04 | BLOCKING PRESS OUTPUT | Archive-before-release, licensed dependency recovery, retention/holds/expiry, audit evidence/key recovery; exact retrieval and editable-copy disaster drills under O05 | prototype/spike; benchmark; license review; customer discovery | Operations/security/legal; before production release and archive commercial promises |
| RD05 | BLOCKING EDITOR ARCHITECTURE | Coordinate/transform/wire bounds, rounding, command/revision schema, lease/read-write scopes, linked-flow/plan/lock conflicts, infeasibility versus timeout | documentation; prototype/spike; benchmark | Engine/document lead; before durable model/editor commitment; absorbs RD20 |
| RD06 | BLOCKING EDITOR ARCHITECTURE | Semantic input, IME/RTL/accessibility/carets, renderer choices, provisional feedback/reconciliation and network/resource usability | documentation; prototype/spike; benchmark; customer discovery | Frontend lead; before professional editor commitment; coupled RD01/13 |
| RD07 | BLOCKING NEWS INTELLIGENCE | Exact news-please comparison, access behavior, extraction/dedup/corrections; news/archive analyzers, versioned migration and native query corpus | documentation; prototype/spike; benchmark; license review; customer discovery | Ingestion/search lead; before live source/search claims; absorbs RD17; basic metadata browse precedes advanced search |
| RD08 | BLOCKING NEWS INTELLIGENCE | One AI task/provider at a time: language fidelity, injection, explanation retention, latency/cost, terms/manual fallback; extraction remains RD07 | documentation; prototype/spike; benchmark; license review | AI lead; before live AI, not manual newsroom work |
| RD09 | BLOCKING COMMERCIAL RELEASE | Tenant/reference/queue/blob/search isolation, hostile parsing, release/revocation, uploaded-metadata injection, delivery caches/ranges, audit threat model | documentation; prototype/spike; benchmark; license review | Security lead; **earlier G2 before any real customer data**, then release; classification does not postpone security |
| RD10 | BLOCKING COMMERCIAL RELEASE | Selected artifact/version provenance, transitive notices/licenses, distribution, security/support and replacement plan; fonts/dictionaries/bindings separately | documentation; license review; printer/vendor consultation | Engineering/legal; **before each adoption**, including UI subset at RM01; full-product compliance before launch |
| RD11 | BLOCKING COMMERCIAL RELEASE | Billing eligibility, metering/reconciliation, termination/retention entitlements and complete per-edition economics | documentation; prototype/spike; benchmark; license review; customer discovery | Commercial lead; before charging; O09/O05 |
| RD12 | BLOCKING PRESS OUTPUT | Devices/network/deadlines, fault scenarios, fairness/burst/vendor limits, recovery/fallback drills and cost; targets tied to failure boundaries | prototype/spike; benchmark; customer discovery; printer/vendor consultation | Operations lead; before reliability commitment/G5; O08/O14 |
| RD13 (proposed) | BLOCKING PUBLISHING ENGINE | Language/FFI/sandbox/build/distribution; browser requirement versus optional acceleration; measured native/WASM/API fit and maintenance cost | documentation; prototype/spike; benchmark; license review | Publishing lead; direction during RM04, ADR before broad investment; does not block exploratory RD01 |
| RD14 (proposed) | NON-BLOCKING / LATER | Exact encoding inventory; mapping licenses, ambiguities/lossiness, retention/review workflow; round-trip only where possible | documentation; prototype/spike; license review; customer discovery | Ingestion/typography; becomes blocking for owner-required legacy imports before that feature; unknown-input refusal required regardless |
| RD15 (proposed) | BLOCKING PUBLISHING ENGINE | PDF-ad form/page import plus writer; fonts/vectors/colour/spot/transparency/overprint; malformed inputs, limits, diagnostics, transforms and licensing | documentation; prototype/spike; benchmark; license review; printer/vendor consultation; press test | Prepress/publishing; before PDF-ad commitment, qualification G3/G6 |

Documentation can resolve API availability, arithmetic bounds and candidate elimination. It cannot close fidelity, usability, performance or recovery claims alone. License review establishes allowed use, not quality. Printer consultation supplies requirements; a press test verifies the physical path. Discovery supplies operating facts; the owner chooses the promises.

## H. PRODUCT OWNER DECISIONS REQUIRED

**15 deduplicated decision subjects**, spanning different gates; not fifteen UI blockers. O01–O11 retain original PO01–PO11 subjects. O12 maps Claude PO12, O13 the scope part of Claude PO13, O14 Claude PO15, and O15 ad-workflow inputs outside Claude's nine-row table. Claude PO14 merges into O03. Typeface/legacy inventory also feeds O02 without asking twice. All nine Claude questions and all eleven original questions are accounted for.

Only preferences, promised scope, commercial policy, acceptance authority and customer commitments belong here. Font EULA interpretation, colour-tower mechanics, language, lease algorithm, numeric scale, search analyzer and crypto are engineering/research work. The owner authorizes access to customer/press/rights-holder evidence rather than inventing technical answers. Timing is the earliest **production** commitment; fictional UI scenarios can remain provisional.

| ID / question | Why the owner must answer / affected decision | Options and consequences | Answer required |
|---|---|---|---|
| O01 — Which first customer/workflow, pilot outcomes and acceptance representative? | Customer/value scope cannot be inferred technically; OP01/ND02/G7 | One publication/cadence gives a smaller testable workflow; multiple regional/daily workflows require more formats/roles/peak-load evidence. Owner identifies sponsor; discovery describes actual work. | BEFORE EDITION WORKSPACE |
| O02 — Which pilot language/font/style pairs are essential, and what substitutions are acceptable? | Brand/audience fidelity is a product commitment; OP02/RD02 | Cleared Unicode/libre fonts may simplify delivery; required proprietary/legacy faces need rights and technical qualification; required Nastaliq needs dedicated tests. Deferring a pilot pair preserves eventual scope but forbids a present support claim. Owner supplies priorities/reviewers; legal verifies terms. | BEFORE PUBLISHING ENGINE |
| O03 — Which press/run arrangement and handoff responsibility must the pilot serve? | Partner and responsibility are customer choices; OP03/ND02/RD03 | Printer-supplied page map with printer-owned imposition is smaller; Pageinator-owned imposed/signature/run planning adds modeling and tests. One profile narrows qualification; multiple presses increase cost. Printer supplies colour map/PPI/screen ruling. | BEFORE PUBLISHING ENGINE output commitment; physical validation BEFORE PRESS PILOT |
| O04 — What commercial-engine/trial/procurement constraints and spending envelope apply? | Spending and commercial/IP constraints cannot be selected technically; OP04/ND01/04 | Commercial writer/import/preflight may reduce integration risk but adds OEM/worker/DR cost; mixed routes need compatibility proof; no commercial spend may narrow scope, delay delivery or require a qualified external route. None waives checks. | BEFORE PUBLISHING ENGINE procurement; no-purchase learning may proceed earlier |
| O05 — What archive/reprint/editable-recovery/evidence promise is sold, including cancellation? | Liability, access and paid scope require owner policy informed by legal/contracts; OP05/ND06/08 | Fixed exact-PDF retention is bounded; editable recovery needs licensed dependencies; longer/custom retention and audit export increase storage/legal-hold/deletion cost. Explicit post-cancellation access/grace and reprint limits prevent overpromising. Rights terms cannot be waived. | BEFORE PRESS PILOT; before any earlier archive/storage-lock contract |
| O06 — What simultaneous editing must the pilot support? | Acceptable coordination is a workflow choice; OP06/RD05 | Edition checkout is simpler but limits parallel work; assigned pages/flows add cross-flow conflicts; same-story simultaneous editing needs richer reconciliation. Engineers choose the mechanism after need is established. | BEFORE EDITION WORKSPACE durable model |
| O07 — What confidentiality/residency/support-access promises apply? | Customer contracts and acceptable exposure are not technically inferable; OP07/RD09 | Publication access with audited support is simpler; story-level embargo adds grants/UI; contractual residency/isolation narrows providers and changes operations. Unsupported sensitive cases remain excluded. | BEFORE EDITION WORKSPACE using real customer data |
| O08 — What devices/network, deadlines, load, recovery and staffing constraints must be supported? | Service commitment and investment are business choices; OP08/ND01/RD06/12 | Managed desktops/good networks narrow support; older devices/low bandwidth/tighter recovery require more local feedback, tests and operations. Broader guarantees need budget. Engineers derive targets and fault models. | BEFORE PUBLISHING ENGINE/editor operating commitments; final reliability BEFORE PRESS PILOT |
| O09 — Who pays, how is it packaged, and what remains after nonpayment? | Commercial preference and contract; OP09/RD11 | Publication/seat pricing improves predictability; usage/storage pricing needs metering; different grace/read-only/export policies alter support and entitlements. No option silently deletes releases or bypasses correctness. | BEFORE COMMERCIAL LAUNCH, including paid pilot |
| O10 — Which sources and permitted uses are essential initially? | Source priority/contracts and lawful scope are customer choices; OP10/RD07/08 | Owned/manual reduces connectors; feeds/wires require entitlement/correction mapping; web extraction adds access/terms/quality work. Discovery rights alone do not grant full-text/AI/print use. | BEFORE EDITION WORKSPACE with live source content; before each protected processing rollout |
| O11 — Which expansion has priority after the pilot? | Investment priority is not a technical fact; DF01/03–06 | Offline/desktop changes sync/distribution; e-paper/API adds products; enterprise isolation adds operations; richer search adds analyzers; ad-sales is separate scope. Defer until evidence rather than include all implicitly. | LATER |
| O12 — Are multiple runs, regional variants or page replates in the pilot contract? | Scope/authority determines edition/run identity; ND07 | Separate derived whole-edition releases are simpler; page replates need changed-page validation and press/run lineage; deferral excludes the promise while retaining originals. Discovery supplies actual patterns. | BEFORE EDITION WORKSPACE durable model |
| O13 — Must the pilot import legacy-encoded editable text or historical archives? | Research can assess mappings, not choose migration scope; ND03 | Unicode-only intake with explicit rejection is cheapest; selected encodings add reviewed conversion; historical editable reconstruction is broader and potentially lossy; file-only history preserves bytes without editability. Brand needs remain O02. | BEFORE EDITION WORKSPACE import scope; before applicable conversion |
| O14 — What deadline continuity commitment is acceptable? | Newsroom fallback/exception authority and disruption tolerance are owner choices; ND05 | Fail-closed release with recovery/qualified alternatives/prior-system fallback; or separately consider marked non-conforming technical output, requiring explicit reopening and press/legal/security review. Missing rights/security cannot be waived. Advisory-quality acknowledgment remains distinct. | BEFORE PRESS PILOT; earlier only if exception capability is commissioned |
| O15 — What ad-booking/creative intake, correction and reservation-reuse workflow is required? | Integration scope and authority to alter advertiser material are business constraints; ND02/04 | Manual/imported booked constraints keep sales external; booking-system integration adds connectors; supplier-only correction can delay deadlines; authorized local transforms need audit/new proof. Historical reservations must be reconfirmed/dropped for a new edition. Sales CRM stays excluded absent explicit O11 change. | BEFORE EDITION WORKSPACE reservations; creative path BEFORE PUBLISHING ENGINE |

No preference is chosen here. No owner questionnaire needs to pause UI tokens/shells. One structured discovery session should collect operational evidence for O01/02/03/06/08/10/12/13/15 and then ask only the remaining scope/commitment choices. No owner question is categorized BEFORE UI FOUNDATION.

## I. MASTER BUILD SPEC V2 CHANGESET

**18 consolidated changes.** Each row evaluates the corresponding Claude Q proposal using the requested classification and supplies the exact intended amendment. This document changes none of the target files. Conditional wording/gates can be documented immediately in a later authorized update; a conditional result cannot be filled in as if research or owner approval already occurred.

| V2 ID / Claude proposal | Disposition | Exact eventual change and scope | Evidence/condition before final commitment |
|---|---|---|---|
| MSV2-01 / Q1, §2 | OWNER DECISION BEFORE CHANGE | Retain existing no-ad-sales-CRM scope; explain booked constraints enter by manual/import adapter. Add deadline continuity contract selected under O14, explicitly preserving standard fail-closed release and distinguishing advisory acknowledgment from exceptional technical output. | Existing exclusion needs no owner reopening. O14 before selecting any different deadline product; O15 for intake workflow. |
| MSV2-02 / Q2, §§3/10 | MODIFY | Name control plane, composition core, browser consumer and PDF/import/preflight worker artifacts. Require isolated resource-bounded hostile/expensive processing and versioned contracts. Reference ND01/RD13 ADR; language/build/WASM stay open. Interactive resolution may use isolated cancellable requests; durable exports retain job protocol. | RD01/06/09/13; separate deployment is optional, not mandatory service proliferation. |
| MSV2-03 / Q3, §3 | ACCEPT | Add edition-owned versioned EditionPlan: ordered stable pages, sections, run/profile/capability-map reference, ad allocations and editorial area. Pin plan revision into resolution/release manifests; distinguish area from qualified copyfit. Add ND07 run/variant identity as conditional scope. | O01/03/12/15; RD03/05. No press tower simulator assumed. |
| MSV2-04 / Q4, §4 | MODIFY | Incorporate the twelve-point geometry/interaction contract above normatively: exact semantic identities, common canonical scene, narrow consumer restrictions, permitted encoding remap, independent structural/raster oracles and explicit budgets. | 25 µm is experimental ceiling only; RD01/05 freezes justified production budget before qualification. No new standalone conformance file required. |
| MSV2-05 / Q5, §§4/5 | ACCEPT | Name provisional interactive geometry, saved editable revision and authoritative resolved geometry separately; revision/dependency matching, stale-result rejection, pending/failure UI, stable proof/approval barrier. Add component-level mock reuse boundary and RM12 semantic/accessibility ownership. | RD01/06/13 usability proof; do not select server-only fallback as a satisfactory product without testing. |
| MSV2-06 / Q6, §4 | RESEARCH BEFORE CHANGE | Replace no unit with an approved representation only after a recorded bounds/error/wire-format decision; meanwhile state coarse fixed-point/millipoints as a candidate, include transforms/intermediates/rounding, and reject production CSS-pixel authority. | RD05 paper analysis plus cross-adapter tests; no immediate integer-millipoint lock. |
| MSV2-07 / Q7, §§4/6 | MODIFY | Add Unicode canonical ingress contract with permitted original-byte retention, declared/detected encoding, converter/table/version, normalization/lossiness/unmapped spans and reviewer provenance. Unknown conversion blocks; derived StoryRevision retains source lineage. | O13 chooses conversion scope; RD14 qualifies exact mappings. Do not promise general reversibility or historical editable reconstruction. |
| MSV2-08 / Q8, §4 | ACCEPT | Refine supported matrix by language/font/style, including distinct Naskh/Nastaliq qualifications where relevant; hyphenation is qualified-by-pattern or disabled, copyfit is language-specific, native review uses a recorded rubric. | RD02/O02. Remove no eventual language; do not assert pattern nonexistence or universal kashida policy. |
| MSV2-09 / Q9, §4 | MODIFY | Keep already-present press/ad precedence above locks. Add page-capability constraint, explicit overset/source ranges and stable infeasibility diagnostics; contradictory hard constraints fail rather than silently relax locks. Time budget exhaustion is not proof of infeasibility. | RD03/05; approve any user-requested relaxation through new commands. |
| MSV2-10 / Q10, §§4/5 | OWNER DECISION BEFORE CHANGE | State required concurrency promises after O06; engineering chooses lease/transaction granularity with linked-flow closure, read/write revision validation, notification and conflict/rebase rules. Do not mandate page leases or unilateral cross-lease changes. | O06 before scope; RD05/06/09 before production protocol. Existing revision safety remains binding meanwhile. |
| MSV2-11 / Q11, §6 | MODIFY | Make existing font RightsGrant enforcement explicit for compose/browser distribution/embed/subset/retain/restore. Version search analysis and migration/rollback with tenant scope. Add ranking inputs/version/reason provenance under permitted retention. Keep news-please RESEARCH FURTHER with fresh evidence, not automatic REFERENCE or alternatives adoption. | RD02/04/07/08/10; O02/05/10 policy. Search stack remains open. |
| MSV2-12 / Q12, §7 | MODIFY | Distinguish reusable press configuration from run-specific EditionPlan page/separation map. Expose existing per-asset-class minimum PPI as warn/mandatory-rule policy with source and acknowledgment authority. Check final mono/colour separations, not source RGB labels. | Press evidence RD03/O03; some PPI requirements can remain mandatory. |
| MSV2-13 / Q13, §7 | ACCEPT | Name ND04/RD15 import contract and compatible writer/import/preflight qualification; PDF-ad quarantine with actionable diagnostics, no silent rasterization, authorized versioned normalization, exact source and derived resource identities. Name import-tier licensing in evaluation scope. | RD15/01/03/09/10, O04/15. Candidate API does not equal fidelity proof. |
| MSV2-14 / Q14, §7 | MODIFY | All page-faithful output artifacts derive from the authoritative scene/release digest with explicit colour/crop/resolution/marks recipes. Final-byte proofs may derive from exact candidate PDF. Label reflowable reading separately with provenance. | RD01/03 adapters; O11 for e-paper scope, not for the invariant. |
| MSV2-15 / Q15, §§7/8 | MODIFY | Preserve existing fixup/new-proof/new-approval rule. Add read-only validation and pre/post hash checks; separate authorized correction into new candidate/lineage; invalidate approval applicability to new bytes, retain old historical evidence. Geometry-changing fixup must reconcile scene or fail. | RD03 vendor behavior and RD09 race tests; no assumed vendor defaults. |
| MSV2-16 / Q16, §8 | MODIFY | Separate exact reprint delivery/use, historical editable restoration and new-edition duplication; pin lineage, current grants, new date/territory, reconfirmed/dropped ads and explicitly confirmed applicable profile. Add conditional variant/replate releases and versioned archive search projections. | O05/12/15 and RD04/05/07/09; do not silently switch all copies to current profile. |
| MSV2-17 / Q17, §9 | MODIFY | Define audit assurance/retention/export and noncircular evidence binding under ND06. Define ND08 current-grant delivery/revocation window, streaming/range/cache checks, no thumbnail exemption or recall promise. Record internal recovery assumptions/failure boundaries separately from SLA; uploaded metadata is untrusted AI input. | O05/07/08; RD04/09/12. No mandatory universal hash chain or unreviewed zero-loss target. |
| MSV2-18 / Q18, §§1/10/11 | MODIFY | Index AR06/07/14/17 under D03–06 subclauses; register ND01–08 and consolidated RD13–15 only when authorized. Replace copied headline counters with linked status/count conventions, preserve exact-version adoption gates and capability/technology distinction. Name approver roles; qualify historical Phase versus RM/G and Pageinator/folder names. Clarify isolated research versus G2 live data and G1 versus customer feedback. | Counts here are reconciliation proposals, not already-edited register totals. No blanket “lock fifteen items” action. |

Q dispositions: 4 ACCEPT (Q3/Q5/Q8/Q13), 11 MODIFY, 1 RESEARCH BEFORE CHANGE (Q6), 2 OWNER DECISION BEFORE CHANGE (Q1/Q10), 0 wholly REJECT. A modified proposal can contain rejected subclaims, as detailed above. All 18 have an explicit eventual destination; unresolved values remain unresolved.

## J. ROADMAP V2 CHANGESET

First, all eight Claude roadmap proposals are adjudicated individually:

| Claude proposal | Disposition | Reason / V2 destination |
|---|---|---|
| R1 — default pilot matrix | MODIFY | Reference feasibility corpus, not approved pilot. Include eventual RTL/Nastaliq stress before architecture narrowing; vendor trials still need permitted access. RMV2-01. |
| R2 — RD13 before RM04/RM10, merge RD01/06 | MODIFY | Joint iterative evidence; establish artifact boundaries/direction early, but do not require a final language before exploratory comparisons that choose it. Keep separate deliverables. RMV2-02. |
| R3 — preflight/import vendor decision before writer commitment | MODIFY | Compatible import/writer/preflight capability and license path before commitment; do not force a vendor purchase if an equivalent qualified route exists. RMV2-03. |
| R4 — owned/manual work before G2 | MODIFY | Modeling and isolated licensed fixtures may precede G2; real customer-owned data still requires G2. RMV2-04. |
| R5 — reverse guidance-file prohibition at RM01 | REJECT | Existing prohibition is stage-specific and current user forbids other files. Guidance is optional future authorized work, not a technical prerequisite. RMV2-05 preserves bounded UI scope without this mandate. |
| R6 — flat-plan/press-configuration lane | ACCEPT | Assign model work within RM06, feeding RM08/11 and UI planning; do not add a separate service or automatic imposition system. RMV2-06. |
| R7 — legacy conversion lane | MODIFY | Inventory/refusal/provenance now in scope; converters only for owner-required encodings. Feed imports and model via adapter, not universal migration. RMV2-07. |
| R8 — expanded G3 and pilot-reviewed G1 | MODIFY | Add PDF-ad/page-capability evidence at G3; honest pending/deadline UX at G1. Actual pilot newsroom availability must not block G1; early representative feedback is useful, customer suitability remains G7/production editor qualification. RMV2-08. |

**9 consolidated roadmap changes**, including two cross-cutting sequencing clarifications needed beyond Claude's eight proposals:

| ID | Exact eventual amendment | Prerequisite / exit |
|---|---|---|
| RMV2-01 | RM04 starts with a documented owned/licensed reference corpus and reference profile, one page plus bounded complex-script/linked-flow probes. Distinguish no-purchase experiments, permitted vendor trials and actual customer/press qualification. Remove mandatory completion of RM01 and unanswered PO02–04 from the no-purchase learning path. | Separate research authorization and relevant dependency/license checks; record tested limits/unrun checks; no G3/G6 claim. |
| RMV2-02 | Add RD13/ND01 and couple RD01/02/05/06/13 through shared experiments. Compare artifact/language/renderer/paragraph routes iteratively. Resolve numeric and concurrency schema contracts before durable RM06 commitment; do not freeze interfaces from a one-page proof. | Prespecified geometry test contract and bounded prototypes; recorded substrate direction before broad work; qualified schema/scene at G3. |
| RMV2-03 | Move import/preflight capability and procurement screening into early RM04; require a compatible licensed writer/import/checker path before RM10 commitment. RM11 verifies check-only profiles, correction isolation and fail-closed reports. | RD01/03/10/15 results, O04 constraints; no purchase assumed. |
| RMV2-04 | Split RM05a domain modeling/isolated extraction experiments from RM05b live content processing. Make basic authorized metadata/archive query needs visible early; advanced analyzers and AI remain claim-specific gates. | RM05a uses fictional/licensed research material; **G2 for all real customer data**, then O10/RD07/08 per source/task. |
| RMV2-05 | State RM01 scope explicitly: UI001–003 bounded foundation, Pageinator naming, scoped mock contracts, status vocabulary and reuse boundaries. Later editor/planning screens inherit these contracts but do not become prerequisites to tokens/routes. No production schema/native tools or mandatory guidance-file creation. | Authorized feature spec and selected UI dependency review; no owner/engine research prerequisite. |
| RMV2-06 | Add an EditionPlan/press-map deliverable under RM06, developed from RM04/press discovery and feeding RM08/09/11. Account for page order, ads, editorial area and optional O12 run/variant scope. UI planning uses fictional maps first. | O03 supplies partner, RD03 validates actual map; RD05 tests constraints. Do not require mechanical tower simulation. |
| RMV2-07 | Add a scoped legacy-ingress deliverable under RM05/RM06: inventory, unsupported-input refusal, conversion provenance and reviewer workflow. Build/qualify only O13-selected converters. | RD14/02/10; blocked input is valid behavior until qualification. Historical migration is not silently added. |
| RMV2-08 | G1 requires honest provisional/saved/resolved/deadline failure states, deterministic failure scenarios and accessible workflow evidence. G3 adds integrated PDF-ad import/page-colour enforcement, independent geometry oracle and supported-matrix evidence. G6 adds actual press map, repeated physical results and chosen deadline fallback drill. | Representative feedback can inform G1; actual customer/press acceptance remains G6/G7. No fictional preview qualifies production. |
| RMV2-09 | Make O06/ND07 workspace decisions and linked-flow conflict design explicit before RM06, with RM14 implementing and testing the selected model. Start archive/audit/delivery/recovery design beside RM06; assign G0–G7 approver roles and link risk owners/status/evidence. Incremental UI journeys precede final G1 report. | Relevant O/RD evidence before each real capability; no new universal gate or calendar schedule. |

The resulting independent paths are: UI foundation → simulated workflow → G1; isolated reference experiments → evidence-led engine/model → G3; real-data platform → G2 → permitted live content; release/archive/recovery → G4/G5 → repeated press pilot G6 → customer acceptance G7. These paths exchange evidence without making every unresolved research item a UI prerequisite.

## K. BACKLOG V2 CHANGESET

**7 consolidated changes**, evaluating all seven Claude proposals. The initial backlog remains UI-only. Additional production research is not hidden in it.

| ID / Claude proposal | Disposition | Exact eventual amendment and acceptance |
|---|---|---|
| BLV2-01 / S1 | MODIFY | Add “intended reuse” and “replacement boundary” to every unit using the mapping below. Durable interface intent does not guarantee unchanged implementation. Disposable mock adapters may persist versioned fictional state (UI025) but define no production schema. Reuse requires explicit contract review/qualification; do not prohibit shared controls/tests. |
| BLV2-02 / S2 | ACCEPT | Add proposed UI027, “Simulated edition plan”: ordered pages/sections, versioned fictional colour/separation map, ad allocations and remaining area. Mark capacity/fit illustrative; unsupported/unknown capability blocks simulated readiness. Link from edition navigation. Depends on UI008/UI012/UI013; UI014 generation adds UI027 prerequisite. No press tower/imposition solver. Skeleton navigation can appear earlier in UI002. |
| BLV2-03 / S3 | MODIFY | Extend UI010/013/017 with predefined legacy/unknown input, conversion-review/lossiness and unsupported-font scenarios. Show original/derived lineage, unmapped spans and acceptance/denial. No converter, font parser, upload or promised pilot migration; O13 scope remains open. |
| BLV2-04 / S4 | ACCEPT | Extend UI012 with quarantined/unsupported PDF creative and actionable fixture diagnostics, correction request preview and replacement-version state. No message sent to supplier, real file parsing or rasterization. Pin accepted replacement identity and invalidate affected simulated readiness. |
| BLV2-05 / S5 | MODIFY | Deliver journey evidence incrementally: UI026a onboarding→edition; UI026b selection→plan; UI026c generation→edit→sample export; UI026d release→archive copy/reprint denial; UI026e cross-cutting denial/stale/reset/RTL checks as their features arrive. Each lists only actual traversal dependencies. Retain UI026 as the final G1 report/checklist, not a single branch implementing prior features. Extend UI021 duplicate/reprint/profile/reservation scenarios. |
| BLV2-06 / S6 | MODIFY | Add deterministic selectable deadline-failure/slow-job/vendor-error/blocked-release scenarios to UI014/019/020, with preserved draft and retry/fallback explanation. Continue the current fail-closed policy while O14 is unanswered; no active emergency bypass. Delay/failure parameters are demo scenarios, not claimed measured realism; no flaky random failure requirement. Distinguish quality acknowledgment from mandatory failure. |
| BLV2-07 / S7 | ACCEPT | UI001 vocabulary distinguishes simulated, pending, saved intentions, recomposing, confirmed proof, stale, failed and approved candidate. UI002 reserves appropriate workspace status surface; UI015–020 show revision-bound states and accessible announcements. Sample geometry never claims press parity; out-of-order mock results cannot replace newer state. |

Intended reuse mapping covers all original 26 units plus proposed UI027. “D” identifies durable product/interface intent; “T” identifies disposable demonstration machinery. Mixed boundaries are deliberate corrections to Claude's unit-wide binary labels.

| Units | D — intended to survive engine selection | T — replace/discard or requalify before production |
|---|---|---|
| UI001 | Tokens, accessible controls, status semantics | Demo-only status samples |
| UI002 | Routes/shells/context/navigation patterns | Placeholder views and simulated capability rules |
| UI003 | Service boundary/error/scoping conventions | Fictional DTO implementation, seeds and scenario adapters; no production document schema |
| UI004 | Access/denied/session UX | Mock session/role enforcement |
| UI005 | Product navigation/content structure | Illustrative prices/non-sending forms/claims requiring launch review |
| UI006 | Progressive onboarding controls | Fictional creation and unchecked profile values |
| UI007 | Overview/list/timezone presentation | Fixture readiness/count data |
| UI008 | Edition creation/open workflow | Mock identity/idempotency/storage |
| UI009 | Attributed newsroom/reason UI | Fake ranking/grouping/source records |
| UI010 | Selection/rights/provenance workflow | Simulated grants/readiness/import/conversion |
| UI011 | Caption/credit/quality presentation | Fake measurement/media associations |
| UI012 | Reservation/quarantine/diagnostic UI | Fake slot feasibility/creative processing |
| UI013 | Version/pinning/configuration presentation | Unqualified print/font/template fixtures |
| UI014 | Job/cancel/retry/stale-result UX | Simulated composition and progress timing |
| UI015 | Page navigation, accessible frame list, properties layout | Sample scene/selection/hit-testing/geometry internals |
| UI016 | Gesture-command intent, numeric input, unsaved/conflict UX | Demo units, command/revision/history engine; real mapping requires qualification |
| UI017 | Story/suggestion diff, human acceptance/lineage UX | Fake AI/revisions; input bridge must be requalified for actual editor |
| UI018 | Proposal scope/lock/diff/rejection UX | Precomputed dependency closure/layout results |
| UI019 | Issue categories/location/stale-result presentation | Fake preflight engine/findings |
| UI020 | Candidate/approval/archive identity workflow | Fake hashes/permissions/release/export |
| UI021 | Retrieval/copy/reprint-permission distinction | Fake package/download/copy/storage |
| UI022 | Role/capability/denial presentation | Mock enforcement/invitations |
| UI023 | Storage/retention/preferences UI | Fake accounting/non-destructive controls |
| UI024 | Entitlement/billing workflow | Fake prices/accounting/non-charging actions |
| UI025 | Persistence/reset adapter seam and corruption UX | Entire fictional local schema and store; not offline product or cloud save |
| UI026 | Journey intent/accessibility evidence structure | Fixture-specific expectations replaced with actual contracts later |
| UI027 (proposed) | Planning/navigation/page-capability/ads/area UX | Fictional plan/colour map and illustrative news-hole/fit calculations |

**RM01 readiness:** ready to authorize a bounded UI001 feature specification, then UI002/003 by dependency. Carry BLV2-01/07 and section L into that feature's acceptance criteria. This is not approval to implement an entire RM02 workflow, a production document schema, a native engine or an exception-release feature. The current task expressly prohibits implementation, so no framework initialization follows this conclusion.

## L. BLOCKERS BEFORE UI FOUNDATION

**UI foundation blocked: NO — no unresolved product or publishing-research question prevents authorizing UI001–003.** G0 as a historical documentation-completion claim stands; it was not a production approval. This reconciliation repairs its decision inventory for bounded foundation work without pretending the source specifications have already been edited into V2.

Before executing the future foundation feature, its spec must include:

1. Existing org/publication-scoped identifiers and capability/denial scenarios; no production security claim.
2. The pending/saved/resolved/stale/simulated vocabulary and explicit mock replacement boundary defined here. UI001 need not implement composition to name these states.
3. Accessible keyboard/focus/RTL-capable shell controls and transport-independent service actions; no assumption about a final canvas/input library.
4. Exact selected UI dependency review and explicit implementation authorization, as already required by UI001. These are normal execution gates, not unclosed publishing feasibility blockers.
5. A reserved edition-planning navigation seam and no finalized owner-specific deadline/lease/profile behavior. Full UI027, encoding scenarios and ad quarantine precede the relevant RM02 surfaces, not foundational tokens.

Claude §K/§T overstates what must precede the first UI implementation. Gateway transport, press configuration, final numeric scale, engine language, PDF import, actual pilot feedback and an owner emergency-output answer do not determine the design-token or route-shell architecture. Keep their interface states explicit and defer dependent behavior honestly. Applying all 18 master changes is not a prerequisite to authorizing this narrow feature; its spec must cite the bounded reconciliation contract alongside the existing authority documents.

## M. BLOCKERS BEFORE PUBLISHING ENGINE

**Publishing-engine work blocked: YES for broad production implementation/technology and schema commitment; NO for a separately authorized, isolated evidence-gathering spike.** Neither this review nor the existing research qualifies a production stack.

Required before committing the relevant engine/model components:

- Geometry oracle, bounded numeric representation, versioned scene/source mappings and a fixed qualification error budget: RD01/05.
- Named engine artifact/build/distribution decision with qualified dependency/rights/isolation path: ND01/RD13/10/09. API language is separate.
- Usable provisional/authoritative editor path, IME/caret/accessibility evidence and actual resource/network measurements: RD06/12 coupled with RD01.
- O02 supported pilot matrix, licensed font inputs and eventual Nastaliq/complex-script design probes: RD02. Legacy converters only if O13 requires them.
- EditionPlan/page-capability/ad constraints and O06/O12 coordination/run scope before durable RM06 freeze: ND02/07, RD03/05.
- Compatible writer/import/preflight path, actual capability API evidence and O04 procurement constraints: RD01/03/15. No isolated writer choice that discovers required import licensing later.

These close at different component gates; they do not require waiting for every news/AI/commercial research question before any publishing learning. Final physical press results are not a prerequisite to a prototype, but remain necessary before press-ready claims.

## N. BLOCKERS BEFORE PRESS PILOT

Require G2 for real customer data; G3 for supported publishing/import/editor capabilities; G4 for exact release/archive/recovery; G5 for security/operations. Resolve applicable O01–O08/O10/O12–O15 commitments, including O14 continuity and O05 archive promises. Qualify the actual press profile and run map, actual licensed fonts/scripts/creatives, delivery/imposition responsibilities, advisory versus mandatory limits, final-byte validation and correction controls. Demonstrate current-grant release/delivery checks, revision/hash-bound approval, exact archive retrieval and permitted reprint, plus failed-job/deadline/recovery drills.

G6 itself requires repeated real press/RIP acceptance and physical inspection of the exact hashed editions, recorded with external press sign-off; do not claim G6 before conducting the pilot. Trial/reference profiles and a one-page test do not substitute. Paid pilots additionally require RD11/O09 and applicable commercial terms before charging. Alternative validation or emergency-output scope cannot be improvised at deadline.

## O. NON-BLOCKING LONG-TERM ITEMS

Offline/desktop operation, enterprise-dedicated topology, active-active deployments, advanced semantic/cross-script search, broad e-paper/API distribution, ad-sales CRM, generalized arbitrary DTP layout, universal legacy/archive migration, advanced simultaneous same-story collaboration, multiple AI providers/custom training, sophisticated global audit chains and byte-identical future recomposition are not prerequisites to the bounded pilot. Some may be out of scope altogether rather than merely scheduled later. Owner-required replates, Nastaliq or legacy support move to the appropriate earlier gate explicitly; eventual multilingual requirements are not deleted by pilot staging.

Historical documentation renaming, mandatory new guidance files and a larger catalogue of speculative dependencies have no priority over a useful foundation and a measured publishing integration. Preserve the documentation's evidence, but avoid rewriting every artifact merely for consistency of prose.

## P. RECOMMENDED NEXT STEP

Review this reconciliation, then authorize **one bounded UI001 foundation feature specification** carrying BLV2-01/07 and section L, alongside a **separately scoped reference-corpus publishing experiment specification** for RD01/06/13/15. Gather the deduplicated owner/discovery inputs once, without making unanswered press-pilot preferences block UI primitives. Applying the proposed V2 documentation changes requires a later authorized task; do not implement or silently edit protected inputs as part of this review.

Completion counts: **46 findings (38 numbered + 8 additional); critical 1 accepted / 4 modified / 0 rejected / 1 mixed-unresolved; 2 working decisions reopened; 8 new decision subjects; 15 remaining research workstreams; 15 owner decision subjects; 18 Master Build Spec changes; 9 roadmap changes; 7 backlog changes.** UI foundation has no unresolved architecture blocker. Production-engine commitment remains blocked on the specified coupled feasibility, scope and qualification evidence.

Verification scope: document coverage/count/reference checks and repository change-scope checks only. No product, typography, PDF, import, security, performance, recovery or press tests have been executed. Web research was read-only; no dependencies were installed and no code or configuration was created.

**NO IMPLEMENTATION PERFORMED.**
