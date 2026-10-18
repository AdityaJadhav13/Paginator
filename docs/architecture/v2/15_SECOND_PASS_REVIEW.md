# 15 — Architecture v2: Second-Pass Critical Review

Date: 2026-10-07 · Reviewer stance: adversarial to the v2 package (written the same day).

Related documents:
- `16_PHASE0_EVIDENCE_PLAN.md`: experiments.
- `17` to `19`: questionnaire, licences, fonts and legacy text.
- `20_ARCHITECTURE_BASELINE.md`: what is frozen and what is open.
- `REVIEW_CHANGELOG.md`: every change and why.

## 1. Executive summary: what changed

Architecture v2 was a plausible design written as if it were settled. Every document and all 16 ADRs said **DECIDED**. The review found that several load-bearing choices were assumptions, two were factually wrong, and the roadmap still allowed a lot of building before any external validation.

**The most important changes**
1. **One publishing kernel, decided by experiment (ADR-017, which supersedes ADR-002 and part of ADR-001).**
   - v2 required the browser and server to compose text with the same TypeScript/WASM code.
   - The review found a simpler route to the real principle (preview = PDF): **a single authoritative resolver behind a language-neutral contract**, with the browser drawing its display list.
   - Composing in the browser becomes an *optimisation that must prove it is needed*.
   - The kernel language is now a **working hypothesis**, decided by EXP-ENGINE (`16` §1). The current front-runner is Option E: extend the existing Python engine. Its tests pass today (182/182), its ecosystem is the strongest for press PDF, and it measured about 1 ms per paragraph.
   - The TypeScript port (v2's Phase 0 tasks 3–7) is **deferred and conditional**.
2. **Typesetting quality is unproven, not just unbuilt.**
   - Measured: with the old engine's default spacing limits, Knuth–Plass found a feasible justification for **0 of 240** synthetic newspaper paragraphs, in English and Marathi, at 30–60 mm.
   - The engine breaks lines correctly but has **no justification policy** for newspaper column widths.
   - Gate 1 now requires proven composition, not shaping.
3. **The roadmap is now gate-driven (ADR-018).** Eight real-world gates, G0–G7 (`13`). Nothing in multi-tenant SaaS, archive, e-paper, newsroom or full generation starts in earnest before the press accepts our PDF (G2). v2's Phase 1 put auth, organisations, a profile wizard, autosave and the full editor *before* the first printed page.
4. **Factual corrections.**
   - Newsprint ink limit: the current WAN-IFRAnewspaper26v5 profile is **220%**; v2 said about 240%. The number now comes from the press.
   - v2's "TrueType-only MVP" conflicts with typical ad specifications that forbid TrueType. It must be proven with the press.
   - Better Auth has **two July 2026 CVEs**, one exploitable in the *default* invitation configuration. It is now PROPOSED with mandatory hardening, not decided.
   - India's DPDP Act and Rules contain **no journalism exemption**. Archive and byline handling is a legal unknown, not an architecture decision.
   - Skia's PDF backend has no CMYK, so it can never be the press writer.
5. **New architecture that v2 lacked:**
   - a font-rights model whose renderer modes do not require sending font files to browsers (`19` §1, ADR-019);
   - a legacy-Marathi conversion pipeline (`19` §2);
   - production-night degraded modes that never depend on AI or on a live kernel round-trip for export (ADR-020);
   - decision-status discipline (ADR-021);
   - an explicit commercial-preflight strategy (ADR-022);
   - a ready-to-use press questionnaire (`17`).
6. **Removed or deferred false precision:**
   - "top-5 alternatives", "beam width 24", "SSIM ≥ 0.995" and many single-number budgets are now parameters or pre-registered experiment criteria;
   - AWS/ECS/OpenTofu, Kysely/Fastify, Graphile Worker and Better Auth are now implementation details or hypotheses that follow the backend-language decision;
   - e-paper and full archive tiers move after G4.

**What survived unchanged**
- Editable→Resolved separation.
- Exports bound to an exact revision.
- Rights ≠ discovery.
- AI never controls geometry.
- Modular monolith on Postgres with RLS as defence-in-depth.
- Staged generation with ads first.
- Python-oracle discipline.
- The audit's main diagnosis.

## 2. Revalidating the three-codebase audit

| Earlier claim | Re-check | Result |
|---|---|---|
| A never rendered real text; widths approximated (0.6 em); text drawn as bars | Source lines re-read (`text_impl.cpp:158,197`) | **Confirmed** |
| A's Knuth–Plass is broken; PDF is ASCII-only | Source re-read (`pdf_exporter.cpp:6,9,204`) | **Confirmed** |
| B's `typeset/` is about 2,000 LOC, production grade, unused by the app | 1,977 LOC; only mention outside is a comment (`errors.py:5`); **182/182 tests pass** under the pinned venv | **Confirmed**, with a refinement: *production grade at shaping and line breaking, not at composition* |
| B's Knuth–Plass is "correct" | Probed: trivially feasible input succeeds. Realistic paragraphs at 30–60 mm are **genuinely infeasible** under default spacing (0/240). A traced example needs 6.9 mm stretch with 0.41 mm available | **Correct algorithm; inadequate policy.** v2 overstated its readiness |
| B supports Marathi | Tests tag Devanagari as `hi`. No `mr` fixtures. `mr` shaping runs (benchmarked) | **Partially.** Marathi-specific validation is absent |
| B's spec M10 expects veraPDF to validate PDF/X | veraPDF scope is PDF/A and PDF/UA | **Confirmed error in B's spec** |
| C has no engine or backend; tests are inflated | Re-listed 35 test files | **Confirmed.** Triage in §11 |
| C's docs hold good decisions | Re-read the register | **Confirmed.** But v2 then marked its *own* additions DECIDED without evidence, repeating the pattern it criticised |

## 3. ACCEPT / CHANGE / PROVE / REJECT matrix

| # | Decision (v2) | Verdict | Revised position |
|---|---|---|---|
| 1 | Preview and PDF derive from the same resolved layout | **ACCEPT** | Frozen principle |
| 2 | EditableDocument → ResolvedDocument display list; exports bound to an exact revision | **ACCEPT** | |
| 3 | Package (headline + deck + body + photo) as the layout unit | **ACCEPT** | From the design grammar |
| 4 | Isomorphic TS composition in browser and server (ADR-002) | **CHANGE** | Single authoritative kernel; client composition must PROVE it is needed (ADR-017) |
| 5 | Kernel language = TypeScript via harfbuzzjs + ICU4X (ADR-001) | **PROVE** | EXP-ENGINE; front-runner Option E (Python) |
| 6 | Frontend in TypeScript/React | **ACCEPT** | Already built; unaffected by the kernel choice |
| 7 | Backend language = TypeScript (Fastify/Kysely) | **PROVE** | Follows the kernel decision; minimise languages in the production path |
| 8 | Integer micro-point units and determinism lint | **ACCEPT** (principle: deterministic kernel); **PROVE** (exact unit) | Applies to whichever kernel |
| 9 | Python kept only as a test oracle, then retired | **CHANGE** | Freeze oracle-v0 as an immutable reference. The kernel may *also* be Python (separate, evolving) |
| 10 | Canvas2D worker renderer; Konva rejected; CanvasKit fallback | **PROVE** | EXP-RENDER, with Konva included as a measured baseline (`16` §4) |
| 11 | ProseMirror story editor for IME input | **ACCEPT** (direction), **PROVE** (IME matrix) | |
| 12 | Single command bus and undo stack | **ACCEPT** | |
| 13 | Server re-resolves on every commit | **CHANGE** | Moot under a single kernel. If client composition is adopted later, the server re-resolves dirty pages at debounced checkpoints and always at export |
| 14 | Staged generation (ads → allocation → page layout → continuations) | **ACCEPT** (structure) | |
| 15 | Top-5 alternatives; beam width 24 | **REJECT as fixed numbers** | Parameters. Default "up to 3 *structurally distinct* alternatives", kept only if pilot data shows they get chosen |
| 16 | highs-js before CP-SAT to stay single-language | **CHANGE** | If the kernel is Python, CP-SAT is native. Solver choice follows measured need |
| 17 | AI never supplies coordinates | **ACCEPT** | Frozen principle |
| 18 | Custom TS PDF/X writer | **CHANGE** | The writer lives in the kernel language. Pageinator owns content streams and PDF/X semantics; libraries (qpdf/pikepdf or equivalent) own serialisation (§5) |
| 19 | TrueType-only fonts in MVP | **PROVE** | Ask the press (`17` F2/F3). Prepare a CFF/CID path if TrueType is refused |
| 20 | Newsprint TAC about 240% | **REJECT** (value) | Value comes from the press; the 26v5 default is 220% |
| 21 | Own model-level preflight + structural checks | **ACCEPT** | |
| 22 | One commercial seat for CI validation only | **CHANGE** | ADR-022: run the *press's own profile* before delivery; production integration decided before G4 |
| 23 | Ghostscript `inkcov` in pipeline | **PROVE** | Optional; AGPL needs counsel; PDFium separations as alternative |
| 24 | Modular monolith | **ACCEPT** | |
| 25 | PostgreSQL system of record | **ACCEPT** | |
| 26 | Postgres-backed queue (Graphile Worker) | **ACCEPT** (Postgres queue) / **DETAIL** (library) | Threshold for a dedicated queue in §8 |
| 27 | RLS on every tenant table | **ACCEPT** (defence-in-depth) | Tests in §8 |
| 28 | AWS ap-south-1 + ECS + OpenTofu + multi-env | **CHANGE** | India region: DECISION. AWS: HYPOTHESIS. ECS/OpenTofu/environments: DETAIL, deferred until G3. Phase 0 needs almost no cloud |
| 29 | Better Auth | **PROVE** | 2-day spike with mandatory hardening; alternatives listed (§8) |
| 30 | S3 Object Lock (governance) archive, retention tiers | **CHANGE** (timing) | Keep the design. Before G5 only versioned storage + hash manifest of delivered files |
| 31 | E-paper in Phase 2 (ADR-011 revised DF05) | **REJECT** (timing) | After G4 unless the pilot requires it. Derived output only |
| 32 | Zoned editions shipped in Phase 2 | **CHANGE** | Data-model hook only; feature when the pilot needs it |
| 33 | SFTP press delivery built in Phase 2 | **CHANGE** | Build only the pilot's actual mechanism (`17` §H); manual download first |
| 34 | Rights class as a domain invariant | **ACCEPT** | |
| 35 | Evidence-based verification signals | **ACCEPT** | Built after G6 |
| 36 | AI provider adapter, typed tasks, evals | **ACCEPT** | Model names are DETAIL |
| 37 | Detailed RBAC matrix (11 roles) | **CHANGE** | Principle (org isolation + publication scoping) ACCEPT; matrix is a HYPOTHESIS until pilot observation |
| 38 | Performance budget table | **CHANGE** | Grounded targets plus ceilings, measured in Phase 0 (`16` §5) |
| 39 | SSIM ≥ 0.995 parity | **REJECT** | Replaced by a three-level parity test (`12`) |
| 40 | Phase plan P0–P5 | **REJECT** (structure) | Replaced by gates G0–G7 (`13`) |
| 41 | Specs ≤ 150 lines; golden-vector tests; package boundaries | **ACCEPT** | Plus safeguards in `14` |
| 42 | Urdu as later separate track | **ACCEPT** | |
| 43 | Legacy font converter "in P1" | **CHANGE** | Full pipeline design (`19` §2); scope from the pilot's encodings |
| 44 | Font licence gate via "outline streaming" | **CHANGE** | Rights model with four preview modes; legal review (`19` §1) |

## 4. Certainty classification

| Class | Items |
|---|---|
| **PRINCIPLE** (true regardless of technology) | • Preview and PDF from one resolved layout<br>• deterministic resolution<br>• exports bound to exact revisions<br>• originals never destroyed<br>• published editions immutable; corrections are new releases<br>• AI suggests, humans accept, deterministic code decides geometry and print correctness<br>• rights ≠ discovery<br>• strong tenant isolation (defence-in-depth)<br>• core editing and print production never depend on AI availability<br>• mature libraries for commodity problems (shaping, ICC, auth, queues)<br>• external validation gates progress<br>• decisions carry evidence-backed status |
| **ARCHITECTURE DECISION** | • Modular monolith<br>• PostgreSQL<br>• object storage for binaries<br>• single authoritative kernel behind a language-neutral contract<br>• browser renders display lists and never lays out text itself<br>• ProseMirror for text input<br>• single command bus<br>• staged generation, ads first<br>• rights class invariant<br>• AI task/provider abstraction<br>• Postgres-based job queue until thresholds<br>• India hosting region<br>• React/TS frontend<br>• gate-driven roadmap<br>• font-rights model<br>• press-profile-matched validation |
| **WORKING HYPOTHESIS** (needs evidence) | • Kernel language (E vs A/B/D)<br>• backend language<br>• renderer implementation (R1–R4)<br>• whether client-side composition is needed<br>• integer micro-points as the unit<br>• composition policy parameters for Marathi<br>• TrueType acceptance by the press<br>• PDF/X variant<br>• TAC and ICC values<br>• template-first generation quality<br>• number of alternatives<br>• Better Auth fitness<br>• AWS as provider<br>• performance budgets achievable<br>• RBAC role set<br>• legacy converter build vs buy<br>• Ghostscript usage |
| **IMPLEMENTATION DETAIL** | • Fastify/Kysely/FastAPI<br>• Graphile Worker vs Procrastinate<br>• ECS vs other compute<br>• OpenTofu<br>• tile size<br>• cache sizes<br>• MessagePack + zstd<br>• model names (Sonnet/Haiku)<br>• Sentry/Grafana<br>• exact folder layout of the monorepo<br>• UUIDv7 |

## 5. PDF architecture review: what Pageinator owns

| Concern | Owner | Notes |
|---|---|---|
| Content streams (glyph runs with explicit positions, paths, images, clips, XObject placement) | **Pageinator** | Positions copied from the ResolvedDocument; never re-measured. Single y-flip function |
| Physical units and page boxes (MediaBox/TrimBox/BleedBox) | **Pageinator** | From the press's specification |
| PDF/X metadata (`GTS_PDFXVersion`, `Trapped`, ID, OutputIntent) | **Pageinator** | Variant from the press (X-1a:2001, X-1a:2003 or X-4) |
| Colour decisions: K-only text, overprint, rich black, mono pages, TAC compliance | **Pageinator** (policy) | Profile values from the press |
| Font embedding decisions (subset, CID mapping, `/W` = kernel advances, ToUnicode) | **Pageinator** | Licence-gated (`19`) |
| Determinism, page order, multipage vs per-page files, naming | **Pageinator** | Press naming template |
| Object model, cross-reference table, compression, serialisation | **Library** | qpdf/pikepdf (Python) or an equivalent maintained library in the kernel language |
| Font subsetting | **Library** | fontTools (`retain_gids`) or hb-subset |
| Image decode, resample, RGB→CMYK conversion | **Library** | LittleCMS through Pillow ImageCms or libvips; intent explicit |
| Importing ad PDF pages as Form XObjects | **Library** | pikepdf `as_form_xobject` or equivalent |
| Transparency flattening | **Avoid** | X-1a means no transparency in *our* content. Ads with transparency are normalised at intake (only through review-approved tooling) or rejected |
| PDF/X validation | **External** | Commercial tool + press preflight (ADR-022) |

## 6. Generation engine review

| Question | Answer after challenge |
|---|---|
| Where are hard constraints applied? | At every stage, as early as possible: <br>• flatplan: ads and page colour;<br>• allocation: capacity, section and jump rules;<br>• page layout: no overlap, locks, ad rectangles, package integrity;<br>• after composition: zero overset, minimum sizes.<br>A candidate failing a hard constraint is discarded and never scored |
| Where are soft constraints applied? | Only when scoring complete page candidates, plus a capacity-fit term in allocation |
| When does real typography run? | **Twice**: <br>(1) depth curves per story × column span × style, cached and computed once per story revision, feeding allocation and candidate pruning;<br>(2) full composition of the finalists only.<br>v2 implied full composition for every candidate, which is unnecessary |
| Cost of evaluating a candidate | Pruned candidates are table lookups on the cached depth curves (microseconds). A finalist composition is about 1 ms per paragraph measured in Python, roughly 20–40 ms per page. Budget: ≤ 50 finalists per page |
| How are candidates pruned? | Area/fit estimate from depth curves → hard-constraint filter → beam on partial score → full composition of the top N |
| How are continuations planned? | In allocation, as a decision variable. Jump-line frames are created in assembly |
| How are ads locked? | Booked placements become hard rectangles in the flatplan. Placed ad frames carry `locked: true`. Regeneration treats them as fixed geometry |
| How are photos associated? | **Before** generation, at the content desk: the story package is assembled by people, with AI *suggestions* by caption or entity match. Generation never pairs photos with stories itself; it only sizes and crops within the package |
| How do templates participate? | They are the first candidate generator (slot templates per page type). They encode the publication's look. Free partition search comes later and is seeded with the best template result |
| When is OR-Tools used? | Only for allocation, and only if greedy + local search measurably under-performs (> 5% objective gap or infeasibility misreporting on the real corpus). Never for 2D geometry |
| When are heuristics better? | Page geometry, headline fitting and copyfit ladders: the objective comes from typesetting and is not linear. Heuristics guided by real composition are used here |
| When does AI participate? | **Never inside the search loop.** AI runs *before* (priority hints, headline variants at target lengths, trims flagged for approval: all cached inputs) and *after* (suggest trims when the copyfit ladder escalates). This keeps generation deterministic, cheap and AI-independent |
| How do manual locks survive? | A lock is a hard constraint on object and geometry, stored in the EditableDocument. Regeneration reads locks from the current revision, never from a stale input |
| One-page regeneration | Rerun page layout for that page. Allocation may move at most one unlocked story in or out if the page is infeasible, and shows a diff before applying. A stability penalty discourages churn |
| Top-5 alternatives? | **Arbitrary.** Replaced by "up to 3 structurally distinct" (configurable). Kept only if pilot telemetry shows alternatives are chosen more than about 10% of the time |
| First version? | Inside pages from slot templates. **The front page stays manual and template-assisted until G6.** It is the most editorially sensitive page and the least valuable to automate first |

## 7. AI boundary review

| Capability | Class | Note |
|---|---|---|
| Line breaking, coordinates, fit, overset, preflight, colour, PDF, page dimensions | **DO NOT USE AI** | Deterministic authority |
| Source verification verdict ("true/false") | **DO NOT USE AI** | Evidence signals only; AI may *extract claims* |
| Copyfit decisions | **DETERMINISTIC PREFERRED** | AI only proposes trimmed *text*; the kernel measures it |
| Page strategy | **DETERMINISTIC PREFERRED** | Template choice by rules; an AI hint is optional |
| Story priority | **AI USEFUL** | Suggestion; editors decide |
| Classification (section, topic) | **AI USEFUL** | Rules and keywords first for known sources |
| Headline suggestions | **AI USEFUL** | Engine-verified fit loop |
| Summarisation / deck | **AI USEFUL** | Grounding checks |
| Translation mr↔hi↔en | **AI REQUIRED** (for the feature) | Human review mandatory; glossary per publication |
| Image–story matching | **AI USEFUL** | Suggestions at the content desk |
| Archive search | **AI USEFUL** | Keyword search first (deterministic); semantic search is an enhancement |
| Dedup and event clustering | **AI USEFUL** | MinHash first; embeddings improve cross-language clustering |
| Legacy font conversion | **DO NOT USE AI** for conversion | Deterministic tables; AI may only rank low-confidence review queues |

**AI outage:** every AI capability degrades to "unavailable". Nothing on the path from edit to resolve to preflight to export calls AI (ADR-020).

## 8. Backend, auth and tenancy review

- **Modular monolith (ACCEPT).** Boundaries are as in `03` §4, plus the **kernel boundary** (contract `16` §1.8). If the kernel is Python and the API is TypeScript, the kernel runs as a stateless internal service. If the backend language equals the kernel language, it is an in-process module plus a worker pool.
- **PostgreSQL (ACCEPT).** It holds relational state, the queue, audit and, later, search (pg_trgm/pgvector). We do not add another datastore without a measured need.
- **Postgres job queue (PROVE sufficiency).**
  - Expected load: generation, export and preflight run a few times a minute at peak. Ingestion is about 100k items/day (about 1.2/s average, roughly 20/s at burst). That is two orders of magnitude below where a Postgres queue struggles.
  - **Move to a dedicated broker when any of these holds:**
    - sustained > 200 jobs/s;
    - queue operations > 15% of database CPU;
    - p95 enqueue latency > 50 ms;
    - a need for streaming fan-out (a wire firehose to multiple consumers);
    - polyglot workers needing features the chosen library lacks.
  - Library: Graphile Worker for a Node backend, Procrastinate for Python (DETAIL).
- **Region (DECISION) vs provider (HYPOTHESIS).**
  - An India region is chosen for latency to newsrooms and customer expectations.
  - **Legal note:** the DPDP Act permits cross-border transfer except to countries the government restricts. Residency is therefore a customer and commercial expectation, not a proven legal requirement (counsel L5).
  - AWS is the hypothesis because S3 Object Lock and replication are mature. GCP Mumbai, Azure Pune or a smaller provider remain alternatives.
  - **Phase 0 needs only:** a dev kernel server in-region for latency tests, plus the developers' machines.
- **Auth (PROVE).**
  - Principle: use a mature auth system; never hand-rolled crypto or session handling.
  - Better Auth evidence: MIT; Google, Microsoft and organisations supported. However, CVE-2026-53514 (organisation invitations accepted by an *unverified* email under the **default** config) and CVE-2026-53515 (SSO provider registration by any member) were published July 2026.
  - If adopted, these settings are mandatory:
    - `requireEmailVerification: true`;
    - `requireEmailVerificationOnInvitation: true`;
    - SSO registration restricted to owners/admins;
    - a pinned patched version and an advisory watch.
  - Alternatives:

    | Option | Character |
    |---|---|
    | WorkOS AuthKit | Hosted; strong orgs/SSO; data in the US; generous free tier |
    | Clerk | Hosted; per-active-user pricing; orgs |
    | Auth0 | Costly for B2B orgs |
    | Zitadel / Keycloak | Self-hosted; operationally heavy |
    | Authlib / fastapi-users | If the backend is Python |

  - **Decide with a 2-day spike after the backend-language decision.** Criteria: email verification enforced, Microsoft Entra multi-tenant, org invitations, MFA, session revocation, audit hooks, data residency, cost at 50 orgs × 30 users.
  - Classification: provider = DETAIL behind the `identity` module.
- **Tenant isolation (PRINCIPLE; defence-in-depth).** Five layers:
  1. application authorisation (central `authorize()`);
  2. Postgres RLS with FORCE and a non-owner role;
  3. object keys prefixed by org, with signed URLs issued only after authorisation;
  4. jobs carry `org_id` and re-establish tenant context;
  5. audit of denials.

  **Proof tests:**
  - **(a) Catalog meta-test:** every table with `org_id` has FORCE RLS and a policy, so new tables cannot slip through.
  - **(b) Per-table:** query under org A returns zero org B rows.
  - **(c) Per-endpoint:** generated from the API contract, every endpoint called with A's session and B's IDs returns 404.
  - **(d) Storage:** A's session cannot obtain a URL for B's key.
  - **(e) Jobs:** a job for A cannot read B.
  - **(f) Search, vector and caches:** all scoped.
  - **(g) Export packages:** contain only A's assets.
  - **(h) External penetration test before the first paid customer.**

## 9. DPDP review (requires qualified legal review)

| Data | Likely role | Unknowns for counsel |
|---|---|---|
| User accounts (staff emails, names, login data) | Pageinator = **fiduciary** | Notice, consent, retention, breach notification process and timelines under the 2025 Rules |
| Reporter details, bylines in content | Customer = fiduciary; Pageinator = **processor** | Whether bylines in published editions can be retained against erasure requests |
| People named or pictured in stories and photos | Customer = fiduciary (journalism) | **No journalistic exemption in the Act or Rules.** The Editors Guild has sought clarification; petitions are pending. How archives and search of historical editions are treated is unresolved |
| Archive search of personal names | Customer-directed processing | Is searchability "processing" that triggers erasure or rectification rights? |
| AI processing (third-party providers, possibly abroad) | Processor → sub-processor | Cross-border transfer terms, DPAs, retention by providers, restricted-country list |
| Cloud storage and backups | Processor | Erasure across backups; retention schedules |
| Audit records | Fiduciary or processor (legitimate use) | Retention period for security logs containing personal data |

**Architecture stance until legal advice arrives**
- Keep personal data of *accounts* separate from editorial content, so it can be erased.
- Keep locked archive objects free of account personal data.
- Support legal hold and court-ordered removal (governance mode, not compliance mode).
- Make AI processing switchable per organisation.
- Record purposes.
- **Do not claim DPDP compliance in marketing until counsel signs off.**

## 10. Security threat ranking (Pageinator-specific)

| Rank | Threat | Severity | Phase it matters | Key controls |
|---|---|---|---|---|
| 1 | Cross-tenant leak of **unpublished editions** | Critical | First real customer data (G3) | §8 layers and tests; penetration test |
| 2 | Compromised staff or reporter account (phishing) | High | G3 | MFA for privileged roles; least-privilege publication grants; anomaly alerts; session revocation |
| 3 | Embargoed stories exposed early (wire embargo fields ignored) | High | G4 (wire), G6 (newsroom) | Embargo as a first-class field; access and AI processing blocked until release time; audit |
| 4 | Malicious ad PDF/EPS (parser exploits, Ghostscript history) | High | G4 | Sandboxed intake (no network, read-only FS, seccomp, limits); `-dSAFER`; prefer PDFium/qpdf; reject EPS unless reviewed |
| 5 | Malicious fonts (HarfBuzz/FreeType/fontTools parser bugs) | High | G1/G3 (customer fonts) | Sandboxed parsing at upload; pinned, patched libraries; fuzz corpus |
| 6 | Image bombs / malicious images | High | G3 | Pixel limits, magic-byte sniffing, sandboxed decode |
| 7 | Press-output tampering (altered PDF between export and press) | High | G2+ | Hash in manifest; delivery receipts with hashes; signed manifest; slug line with revision hash |
| 8 | Supply-chain compromise (npm/PyPI/WASM/Docker) | High | All | Lockfiles with hashes, pinned digests, SBOM, review of new dependencies (`14`), minimal images |
| 9 | ZIP bombs (DOCX imports are ZIP files) | Medium | G3 | Decompressed-size and ratio limits; streaming parse |
| 10 | Signed-URL abuse (forwarded links to unpublished pages) | Medium | G3 | 5-minute TTL; unpublished content streamed through authenticated endpoints; URLs bound to object version |
| 11 | Prompt injection and poisoned feeds | Medium | G6 | Data-only prompts; suggestion-only outputs; source allowlists; rights class |
| 12 | AI data exfiltration (content sent to providers) | Medium | When AI ships | Per-org AI switch; DPAs; zero-retention terms; no secrets in prompts |
| 13 | SVG attacks | Medium | G3 | Reject SVG uploads, or rasterise in a sandbox |
| 14 | Archive tampering / repudiation | Medium | G5+ | Object Lock, signed manifests, cross-account backup |
| 15 | Account takeover by credential stuffing | Medium | G3 | Rate limits, breached-password check, MFA |

## 11. Test strategy review

**Test-value hierarchy** (highest first):
- **T1 Publishing contracts:** typography fixtures; layout fixtures; PDF fixtures; three-level parity; press-accepted regression.
- **T2 Isolation and security:** tenancy suite; authorisation; upload sandbox tests.
- **T3 Workflow behaviour:** end-to-end golden path; session and workspace races; autosave recovery.
- **T4 Component behaviour and accessibility:** focused component tests; one axe sweep over the route table.
- **T5 Static policy:** lint and dependency rules. **These are configuration, not "tests".**
- **T0 Forbidden:**
  - count inflation by looping one check over files;
  - comparing an implementation with itself;
  - large snapshots;
  - tests for placeholders.

**Current repo triage** (to execute after the engine decision; not urgent):

| Files | Verdict |
|---|---|
| `ui004/stale-session`, `ui004/stale-workspace`, `ui004/session-and-reset`, `ui004/route-access`, `ui002/route-resolution`, `ui002/keyboard`, `ui001/dialog` | **KEEP.** Real behaviour |
| `ui001/controls`, `ui001/layout`, `ui005/contact`, `ui005/cta`, `ui005/routes`, `ui005/pricing`, `ui004/failure-announcements` | **KEEP, trim.** Remove duplicates |
| All five `*/boundary.test.ts` | **CONSOLIDATE** into one dependency-cruiser config plus one meta-test |
| `ui001/accessibility`, `ui002/accessibility`, `ui004/accessibility-responsive`, `ui005/accessibility`, `ui002/responsive` | **CONSOLIDATE** into one axe and responsive sweep driven by the route table |
| `ui001/tokens` | **CONSOLIDATE.** Keep the contrast-pair checks only |
| `ui001/rtl` | **REWRITE** as Playwright checks of computed logical layout. The current version compares React output with itself (UI001 review M-11) |
| `ui001/status-semantics` | **REWRITE** as type-level exhaustiveness (`never` checks). The "exactly eight states" test cannot detect a ninth |
| `ui003/contracts`, `ui004/contracts` | **REWRITE** against the real API schemas when they exist |
| `ui003/fixtures-and-scoping`, `ui003/scenarios-and-reset` | **KEEP** while mocks exist; **REMOVE** when the real API lands |
| `ui005/claims` (511 lines) | **REMOVE.** Replace with a one-page claims review checklist |
| `ui001/showcase` | **REMOVE.** Demo-only |
| `ui005/reading-order`, `ui005/security` | **REVIEW.** Keep only assertions about real behaviour |

## 12. Deadline-night reliability (ADR-020)

| Failure | What keeps working | Design |
|---|---|---|
| AI provider down | **Everything except AI suggestions** | No AI on the production path |
| Kernel service degraded or down (Option E coupling) | Viewing, navigation, moving frames (geometric transforms are client-side), queued text edits (local outbox), **downloading last-known-good page PDFs** | N+2 kernel instances across availability zones; separate interactive and batch pools; export pool reserved during the deadline window |
| One worker crashes mid-export | Export retries idempotently by `job_key` | The last good export per page always remains downloadable |
| Database outage (Multi-AZ failover typically 1–2 min) | Local editing into the outbox | Outbox replay; banner; exports wait |
| Object-storage outage | Already-downloaded files; local outbox | Retry; delivery to press from the last local download |
| Newsroom internet outage | Local viewing of resolved pages; queued edits | **Emergency package** (below) |
| Total Pageinator outage near deadline | Press receives last-good pages | Runbook: prepress downloads last-good pages, which are kept current automatically from T−60 min |

**Last-known-good (LKG).** Every revision that passes preflight is marked LKG. Its per-page print PDFs are pre-rendered in the background during the deadline window.

**Emergency package (target G4).** One download per edition containing:
- LKG per-page PDFs;
- the current editable and resolved documents;
- the font manifest;
- a **standalone kernel container or CLI** that can re-export on a newsroom PC.

This works naturally if the kernel is a self-contained CLI or service, which counts in Option E's favour.

**Targets:**
- local durability of edits ≤ 2 s;
- server recovery point ≤ 10 s;
- deadline-window export starts within 30 s at p95;
- regional failover ≤ 5 min (the DB service level);
- no AI dependency.

## 13. Archive, e-paper and Urdu

- **Archive.**
  - Keep the v2 design: package, signed manifest, Object Lock in governance mode, tiers, legal hold.
  - Stage it so it cannot threaten G2:
    - **G2–G4:** versioned bucket with delivered PDFs plus a manifest of SHA-256 hashes and revision IDs.
    - **G5:** full edition package and restore drill.
    - **G7:** paid retention tiers and search.
  - Corruption detection: verify the manifest checksum on every retrieval, plus a monthly sample scrub.
  - Restore drill: once a quarter, compare PDF byte hashes.
- **E-paper.**
  - A derived output from the same ResolvedDocument and print PDFs: page images plus article regions from source mapping.
  - **It must never add geometry or rules to the print document.**
  - Timing: after G4, unless the pilot makes it a purchase condition.
- **Urdu.**
  - An explicit later capability with its own gate: RTL paragraphs, Arabic-script shaping with Nastaliq, kashida/stretch justification, mirrored column order, tall line metrics, Urdu typographic conventions, and a specialist reviewer.
  - Devanagari success says nothing about Urdu.
  - The data model carries `direction` now; nothing else is built.

## 14. UI work boundary

| When | UI work |
|---|---|
| **Safe now** | Bug fixes to the existing shell, tokens and controls. Keep the marketing pages as they are. A **low-fidelity edition-workflow prototype** with existing mocks, for pilot conversations (it is a research tool, not product). The renderer bake-off harness (throwaway) |
| **After typography proof (G1) and the EXP-ENGINE / EXP-RENDER memos** | Editor shell on real display lists: page canvas, thumbnails, selection, move/resize, zoom/pan. Story editor panel (ProseMirror) and IME matrix. Publication profile forms limited to what the kernel consumes: grid, styles, fonts |
| **After press acceptance (G2)** | Preflight UI, export and release UI, print profile UI, ad intake UI, press delivery UI (the pilot's mechanism) |
| **After a production night (G4) and productivity proof (G5)** | Generation UI polish (alternatives, regenerate), newsroom feed, archive browser and search, billing and pricing, self-serve onboarding, further marketing polish |

## 15. STOP / START / CONTINUE

**STOP**
- Marking architecture "DECIDED" without evidence. That includes the v2 package itself.
- Measuring progress by test count, line count, spec length, screen count or phase number.
- Running long phase sequences with no external validation between them (repo A: 244 commits; v2's Phase 1 bundle).
- Wrapping stubs or placeholders in more layers and tests (A's Phase 17; C's placeholder measurements).
- Porting or rewriting an engine before its reference behaviour is frozen as executable fixtures.
- Hand-building low-level technology that mature libraries already solve: rasterisers, PDF object writers, shapers, auth.
- Building UI ahead of the engine behaviour it depends on.
- Pinning precise-looking numbers (k = 5, beam 24, SSIM 0.995, TAC 240%) without a source.
- Letting subagent or AI claims (versions, CVEs, capabilities) into documents unverified. Two v2 claims had to be re-checked in this review.
- Designing for generic commercial print when the target is newsprint.

**START**
- Gate-driven development with written external evidence (press, editors, printed pages).
- Executable golden fixtures from a frozen oracle; fixture changelogs approved by humans.
- A real Marathi corpus and native sub-editor review as standing practice.
- Pre-registered benchmarks (criteria fixed before results) for engine, renderer and solver choices.
- ADR status discipline (ADR-021): PROPOSED → ACCEPTED/EXPERIMENTAL → SUPERSEDED/REJECTED, with evidence links.
- Observing real production nights before designing workflows.
- Treating press-accepted artefacts as permanent regression assets.
- Ranking work by risk.
- Doing font, licence and legal diligence early, as engineering inputs.
- Measuring on the newsroom's actual hardware and network.
- Keeping a `KNOWN_DEFECTS` record instead of silently patching references.

**CONTINUE**
- The Editable/Resolved separation and the exact-revision export principle.
- B's invariant culture: conservation checks, planted-defect meta-tests, deterministic outputs, measured feasibility reports.
- C's decision register habit, product-context documents, accessibility-first UI kit and race-condition handling.
- Rights-aware news design and the AI-as-suggestion boundary.
- Recording measurements (B's `PROGRESS.md` style) and honest "not available" notes.
- One feature, one branch, one fresh agent session (D13), with short specs.
- graphify-assisted, scoped context for agents.

## 16. Document-quality findings (fixed in this review)

| Finding | Where | Fix |
|---|---|---|
| Everything marked DECIDED | All docs and ADRs | Review banners; ADR status block; `20` baseline |
| Contradiction: the doc 05 integer-unit rules vs. the floating-point mm units of the Python oracle being ported | 05, 12 | The kernel contract defines units; the oracle compares in font units and hex floats (`16` §2.2) |
| Budgets assumed client-side composition | 06 | Grounded budgets with ceilings (`16` §5) |
| TAC 240% | 08, ADR-014 | From the press |
| TrueType-only is unverified against press and ad specifications | 05, 08, ADR-006, ADR-013 | PROVE through `17` F2/F3 |
| SSIM threshold arbitrary | 08, 12 | Three-level parity (`12`) |
| Better Auth version and CVE claims partly unverified | 11, ADR-008 | Verified CVEs listed; hardening conditions |
| Phase plan front-loaded SaaS before the first print | 13 | Gates G0–G7 |
| E-paper moved forward without a pilot requirement | ADR-011 | Reverted |
| Generation "top-5", beam 24 | 07, ADR-005 | Parameters |
| Monorepo layout assumed TS kernel packages | 03 | Marked conditional |
| No font-rights model or legacy pipeline | 05, ADR-013 | `19`, ADR-019 |
| No deadline degraded modes beyond fallback export | 11, ADR-016 | ADR-020 |

## 17. Final self-challenge

| Question | Honest answer | Action taken |
|---|---|---|
| Can this produce a Marathi newspaper? | Not yet shown. Shaping works; justified composition at newspaper widths fails under current policy (0/240) | G1 requires L1–L6 evidence; composition policy is the first engine work |
| Have we proven line breaking and composition, not just shaping? | **No.** Only the algorithm's correctness | TYPO plan (`16` §3) |
| Can it stay interactive on 16 pages? | Unknown. The server-only kernel adds a round-trip | EXP-RENDER plus EXP-ENGINE B1/B2 with pilot-network emulation |
| Can browser and server produce identical layouts? | By construction with a single kernel. Otherwise unproven across engines | ADR-017; hash tests if client composition is adopted |
| Will a commercial press accept it? | Unknown. No Pageinator file has ever reached a press | G2; questionnaire; press-profile validation |
| Designed for newsprint? | Now yes in policy; values pending (TAC 220% default in 26v5, K-only text, overprint, mono pages) | `17` §D |
| Can an existing Marathi paper migrate? | Only if legacy text conversion and font rights are solved | `19`; P0-11/P0-12 |
| AI down 15 minutes before deadline? | Production unaffected by design | ADR-020 |
| Can one paper see another's unpublished edition? | Designed against with five layers; untested until code exists | Tenancy suite; penetration test before G3 with real data |
| Can we prove a two-year-old edition is exactly what was published? | Yes once manifests are signed and hashes recorded from G2 | Hash manifests from G2; signing from G5 |
| Are rights, fonts, licences and privacy serious? | Now identified with owners; legal answers outstanding | `18` L1–L8; `19`; §9 |
| Will newspapers pay? | Unknown. No pricing, no pilot contract | G0 includes a pilot MoU; G7 is the commercial proof; P0-02 baseline quantifies value |
| Can the current team build and operate this? | Only with the reduced scope: one pilot, one language, one press, server-only kernel, no SaaS breadth before G4 | Gates enforce scope. Multi-tenant breadth, archive tiers, newsroom and Urdu are deferred |
| Does the process prevent another 78k lines before the hypothesis is proven? | Yes, if the gates are enforced: no editor before G1, no SaaS breadth before G2, PR size limits, evidence-attached PRs | `14` safeguards; ADR-018 |
