# Pageinator product specification — System architecture (how it is built)

Part of the product specification ([index](README.md)). Examples are fictional.

## 14. System architecture (how it is built)

```
Browser (apps/web: React shell + plain-TS editor core)
  ├─ compose worker  ── @pageinator/kernel (TS + HarfBuzz WASM) ── instant fit while typing   (licence-permitted fonts only)
  ├─ render worker   ── @pageinator/render (Canvas2D/OffscreenCanvas, 512-px tiles, glyph Path2D cache)
  └─ IndexedDB outbox (every edit durable locally in ≤ 1 s)
        │  REST + SSE (Zod contracts)
apps/api (Fastify 5) ── modules/* (identity, orgs, publications, editions, content, assets, documents,
        │                           production, audit, notifications …)  ── PostgreSQL 17 (RLS FORCE)
apps/worker (Graphile Worker) ── same @pageinator/kernel = AUTHORITATIVE resolve + PDF export, preflight,
        │                         image CMYK renditions, auto-layout; Python sidecars: PDF/X validator, fontprep
S3-compatible storage (content-addressed; archive bucket with Object Lock later)
```

**Principles**
- **Same engine everywhere.** Browser and server run the same TS kernel. The server's result is the official one; a page hash is compared on every save.
- **Exact revisions.** Preview and PDF come from one resolved layout, and exports bind to an exact revision.
- **No guessing in the engine.**
  - It does not read clocks, use random numbers or do I/O.
  - Python's semantics are emulated where parity needs them.
  - A lint rule enforces both.

**Units**
- **The document** (what people edit): float64 mm, pt and ratios. This preserves the measured house grid exactly.
- **Resolved pages** (what the engine computes): integer millipoints (1/1000 pt) in PDF space, which is exactly what the press-accepted writer emits.
- The y-flip happens in exactly one function.

**Fonts**
- Engine v0 takes static font instances only.
- Variable fonts are pinned to instances by a "fontprep" job using the fontTools instancer, the same tool that produced the reference.
- Restricted house fonts compose on the server, and the browser shows outlines or tiles (ADR-019) until their licence allows browser use.

## 15. Build plan

### 15.1 Three tracks
- **Track A — Engine** (critical path; starts now and continues even if other gates slip): M0 → M8, then the editor, backend and print milestones as their gates open.
- **Track G — Gate actions** (owner + team, in parallel; these unlock everything after M8):

| Action | Gate it completes | What exactly |
|---|---|---|
| **G0-1** Pilot agreement | G0 | A one-page MoU between Pageinator and the pilot newspaper: production contact; 3–5 past editions usable as private test material (already permitted); 2 shadow nights and 1 test print run |
| **G0-2** Press questionnaire | G0 | `17_PRESS_REQUIREMENTS_QUESTIONNAIRE.md` sections B, C, D, F answered by the printing unit (PDF variant, ink limit, colour profile, how files arrive) |
| **G2-1** Second press test | G2 (criterion 1) | Send the page with photos that EXP-PAGE-1 already chose for press testing, rebuilt with the existing Python pipeline, plus one real ad. Get written acceptance naming its SHA-256 |
| **G2-2** Record sheet | G2 | File the press record sheet: RIP report, the file's SHA-256 |
| **G1-1** Signed sheet | G1 | The owner–editor's signed sign-off sheet (photo) |
| **G1-2** L3 measurement | G1 | Measure "lines outside the spacing policy ≤ 2%" on the 24 reviewed pages (the team does this from existing outputs) |

- **Track B — Interface foundation and prototype** (parallel, never blocks Track A):
  - **Builds the foundation every screen needs:** design system, icons, the translation catalogue (§3).
  - **Plus a low-fidelity prototype** of the daily journey for pilot conversations, which the roadmap allows now (doc 15 §14: "a research tool, not product").
  - **Each real screen is built when its gate opens** (§15.4), from this specification.
  - **The editor UI starts after G1** and both memos.

### 15.2 Track A milestones (engine first)

| M | Deliverable | Gate | Depends on | Done when (evidence) | Est. |
|---|---|---|---|---|---|
| **M0** | Monorepo: pnpm 11 workspace; `frontend/` → `apps/web` (git mv); Node 24 LTS (engines `>=24.15.0`; Node 26 added when it becomes LTS); TS 7 `tsc` plus TS 6 for ESLint; ESLint with determinism and boundary rules; Prettier; GitHub Actions (guard, ts, oracle, later pdf-validate); privacy guard (blocks font files, ICC profiles, `Logos/` and private PDFs, with the 22 tracked OFL fonts the frozen oracle needs **allowlisted by SHA-256**; plus a denylist of private terms held as a CI secret); frozen-evidence guard; package-dependency graph check (reads `package.json` files, not graphify); `packages/pyshim` seed | — | PR #4 merged (or stack M0 on it) | `pnpm ci` green; web test count equals the npm baseline (1,249 in 35 files, measured); oracle 182 tests pass; planted private file fails the guard; OFL fonts pass | 2–3 d |
| **M0.5** | **Goldens v1:** `tools/goldens/v1/` generators run with the oracle environment. They import the frozen code read-only and record inputs and outputs: Unicode/pyshim vectors, font instances and ids, Liang breaks, `prepare()` and full `Composed` dumps, headliner layouts over new fictional headlines, line placement, PDF micro-cases, and the **synthetic press test regenerated into `fixtures/goldens/v1/press/`** (today it is git-ignored). Public goldens are committed after human approval; private goldens go to `~/PageinatorPrivate/goldens/v1/` | — | M0 | `gen_all.py --check` regenerates identically; counts recorded in `fixtures/goldens/v1/MANIFEST.json`; the 32,076 tracked compose2 signatures are referenced in place | 4–6 d |
| **M1** | `pyshim` (Python round/format/JSON/median/pow, Unicode 14 tables), **own HarfBuzz 14.3.0 WASM** (exact uharfbuzz commit and flags; built reproducibly in Docker), `fonts` (registry, `font_id`, metrics), `shape` (itemize, shapeRun) | toward G1/G2 transfer | M0.5 | 203/203 fixture records identical (glyph ids, clusters, hex advances); ≥ 1 M pyshim vectors; reproducible `.wasm` SHA-256 | 10–14 d |
| **M2** | `hyphenate` (Liang, mr + en-us) and the oracle breakers (greedy, Knuth–Plass) | — | M1 | fixture breaks 203/203; Liang 100% | 3–5 d |
| **M3** | `compose` = composer3 + house policy C3 (`policy_for(k)`) | — | M2 | **32,076/32,076** tracked compose2 signatures (`experiments/phase0/results/compose2/signatures.json`, via composer3's legacy mode); M0.5 Composed dumps hex-equal; private C3 signatures 8,996/8,996 | 6–8 d |
| **M4** | `headline` (keep-together rules, fill/balance/first-fit, copyfit, house pairs) | — | M3 | Public headline goldens; private 424 headlines | 3–5 d |
| **M5** | `document` v0 (Zod → JSON Schema kernel contract), line resolve, `kernel` facade, `pgn` CLI | — | M3 | Placed lines identical to the synthetic press-test manifest; no schema drift | 4–6 d |
| **M6** | `pdf` (PDF/X-1a writer port) + `pgn press-test` | **G2 transfer** | M4, M5 | Content streams **byte-identical** to the accepted file; outlines/advances equal; independent checker 0 FAIL; mutation test 6/6; **the press accepts a TS-made file** (written, naming its SHA-256) | 7–10 d + press |
| **M7** | Cross-engine determinism (Node, Chromium, Firefox, WebKit), benchmarks, EXP-ENGINE memo, ADR-023/024 | editor gate (part) | M6 | Identical hashes on 4 engines; resolve ≤ 5 s for 16 pages; ≥ 2,000 trials/s/core | 4–6 d |
| **M8** | Page engine v1 (column flow, wrap, copyfit, crossheads, headline fill) | **G1 transfer** | M7 + G1 (signed sheet + L3) | Synthetic flows identical; **the Python outputs for the 24 reviewed pages reproduced** glyph-for-glyph (private) | 15–20 d |
| **M9** | Renderer bake-off harness (a read-only page viewer; no editor chrome) + shortcut verification across browsers + EXP-RENDER memo | editor gate (part) | M5 + a Windows i5 / 8 GB laptop (O-j) | Budgets met on that laptop; draw log equals the resolved page exactly; the shortcut table (§8.12) verified on Chrome, Edge, Firefox and Safari | 6–8 d |
| **M10–M12** | Editor E1 (core, workers, thumbnails) → E2 (select/move/resize/snap/threads/overset) → E3 (story panel, ProseMirror, IME, headline tool, local outbox) | after G1 + both memos | M8, M9 | Reflow ≤ 250 ms p95; edit → canvas ≤ 400 ms (target 200 when the browser may compose; **≤ 600 ms when restricted fonts force server composition**); 60 fps drag; **signed Marathi IME matrix** | 10–14 wk |
| **M13** | API (Fastify 5, Zod), Postgres 17 + RLS, jobs, storage, docker-compose dev | after **G0** and the **full G2** (G2-1, G2-2) | M7 | Tenancy proof tests (a)–(g); server page hash equals client hash | 3–4 wk |
| **M14** | Auth (Better Auth after a 2-day spike; patched version), MFA, sessions, security baseline | same as M13 | M13 | Spike memo; CVE regression tests | 2 wk |
| **M15a** | Autosave sync and revisions; **Export** (press master per press profile, proof PDF, page images); model preflight subset (§9.1 rules marked G3); LKG; release path **through RELEASED with a minimal archive** (PDFs + manifest); manual delivery with receipt; Word/text import; phone review screens (§13.1); the Python PDF/X checker packaged as the validator sidecar | **G3 entry** | M12, M13 | Recovery loses ≤ 2 s of work; 4-page export ≤ 60 s; validator 0 FAIL on every export | 3–4 wk |
| **M15b** | **Colour and ads for print:** photo CMYK renditions with **lcms2 compiled to WASM** in the worker (parity with `photos.py`, which also uses lcms2: same profile, intent and black-point compensation); minimal ad placement (artwork rasterised to CMYK, placed in the booked rectangle) | **G3 entry** | M15a | Pixel parity with `photos.py` on the pilot photos; **press accepts a TS-made page with photos + an ad** | 2–3 wk |
| **M16** | Pilot hosting (AWS ap-south-1 minimal: RDS, S3, ECS Fargate, CloudFront; OpenTofu), monitoring, backups | **G3 entry** | M14, M15a | Restore drill; newsroom round-trip measured | 2–3 wk |
| **G3** | Pilot staff make a **4-page edition with at least one ad in Pageinator; it is printed** | **G3** | M10–M16, G0 | Printed copies, receipts, observation notes | 1–2 wk |
| M17 | Ads intake (vector ad PDFs as Form XObjects, checked on upload; its own press test), share-link / email / SFTP delivery and the press portal, jump lines ("Continue on page"), ZIP import, degraded modes, emergency package, load test | after G3 | G3 | Shadow night (G4a); press accepts a vector-ad page | 5–7 wk |
| M18 | Inside-page auto-layout (gen1 port: guillotine search, alternatives, 17 gates) | after G3 | G3 | Replay identity; 28 held-out pages pass the same gates | 4–6 wk |
| M19 | Archive package (signed manifest, Object Lock), e-paper | after G4 | G4 | Restore drill with byte-hash comparison | — |
| M20 | AI suggestions (headlines, trims, translation; suggestion-only, evals) | after G5 | G5 | Evals pass; no suggestion auto-applied | — |
| M21 | Whole-edition generation incl. front pages, newsroom feed, billing/self-serve | after G6 | G6 | — | — |

**Calendar estimate** (one developer with AI agents; includes the two-reviewer process on every PR):
- M0–M7 in ~10–12 weeks (to about mid-January 2027);
- M8 by February 2027, if G1 is complete;
- G3 around Q3 2027, if G0 and the full G2 are done by spring.

These are estimates, not promises. Each milestone ends with evidence, not a date.

### 15.3 Track B (interface foundation and prototype, parallel)

| B | Builds (spec §) | Uses | Done when |
|---|---|---|---|
| B0 | **Foundation:** design-system additions (§3.2 tokens, §3.5 components, §3.6 `packages/icons`), the translation catalogue with the Marathi glossary (§3.9), keyboard-shortcut infrastructure (code-based matching, focus-scoped key maps). Needed by every later screen, including the editor | Existing `src/ui` | Component tests; axe zero serious violations; Marathi UI renders correctly at 13 px+ |
| B1 | **Low-fidelity workflow prototype** of the daily journey (§2.1), on the existing mock services. Clearly labelled "Prototype". For walkthroughs with the pilot's staff, so this specification is checked by real users before the real screens are built | Existing mocks | Owner and staff walkthrough notes; spec corrections recorded |
| B2 | The M9 harness page viewer (read-only pages; zoom, pan, page strip). **No editor menus or tools** before G1 | M5 + M9 | Pages render exactly as the PDF |

**Real screens:** each is built when its gate opens (§15.4), from §4–§13. Nothing is shown in the real product before it works.

### 15.4 Where each screen lands (real, not mock)

| Screen | Real at |
|---|---|
| Editor [G3-min set] | M10–M12 (after G1 + memos); the rest after G3 (M17) |
| Story editor and fit estimates | M12 (engine in the browser where font licences allow, otherwise on the server) |
| Auth, Team, Organization, Account | M14 |
| Overview, Editions, Plan, Content desk, Media, Stories, Publication settings, Brand, Print profiles, Fonts, Templates & styles (pilot set-up use) | M13–M15a |
| Export (press master, proof, page images), Preflight, History/release (through Released, minimal archive), manual delivery + receipts, phone review | M15a |
| Photo colour for print; minimal ads in the editor | M15b |
| Press portal, Ads desk intake, share-link/email/SFTP delivery, continuations, ZIP import | M17 |
| Generate (inside pages) and every auto-layout entry point | M18 |
| Archive browser and edition package, E-paper | M19 |
| Suggestions panel (AI) | M20 |
| Newsroom feed, whole-edition generate, Billing, self-serve onboarding wizard, "Learn from past editions" | M21 (after G6) |
| Public website pages and claims | As each claim becomes true (§4) |

### 15.5 First steps after approval (M0, precise)
1. **Preconditions:**
   - PR #4 merged (if not, stack M0 on `feature/phase0-close`);
   - tag `evidence/phase0-final`;
   - `Logos/` already copied to `~/PageinatorPrivate/brand/` and git-ignored.
2. **Baseline:** in `frontend/`, under Node 22.22.3, run `npm ci && npm test -- --run`. Record the count and `npm ls --all --json`.
3. **Branch and move:** `git switch -c chore/m0-monorepo`, then `git mv frontend apps/web` in a commit of its own.
4. **Node:** `.nvmrc` = Node 24 LTS; engines `>=24.15.0` (CI tests 24; Node 26 joins when it becomes LTS). Remove `apps/web/{node_modules,dist,package-lock.json}`.
5. **Root config:**
   - `package.json` with `packageManager: pnpm@11.20.0`;
   - `pnpm-workspace.yaml` (apps/*, packages/*, modules/*, tools/testkit; catalog `@typescript/native: npm:typescript@7.0.2`, `typescript: npm:@typescript/typescript6@6.0.2`, `vitest: 5.0.1`; `engineStrict`);
   - `tsconfig.base.json` (ES2023, no DOM in kernel packages, `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly`);
   - `eslint.config.js` with the determinism rules (§14), Prettier, `.editorconfig`.
6. **Web package:**
   - `apps/web/package.json` renamed `@pageinator/web`. Runtime dependencies unchanged; the boundary test AC-47 fixes them.
   - Run `pnpm install`, then diff the transitive versions against the npm baseline.
7. **App root:** move `src/demo/ui004/routeTree.tsx` → `apps/web/src/root/AppRoot.tsx`. Keep a 2-line re-export shim at the old path; demos mount at `/__demo` in dev only.
8. **First kernel package:** `packages/pyshim` (float hex round-trip over every `*_hex` value in `fixtures/typeset/v1`) and `tools/testkit` (JSONL loader). Together they prove the build, test and lint plumbing.
9. **CI and guards:**
   - `.github/workflows/ci.yml` (guard, ts, oracle);
   - `tools/ts/guard-private.ts`: OFL fonts allowlisted by SHA-256; ICC files, `Logos/` and private PDFs blocked; denylist from a CI secret;
   - `check-frozen.ts`;
   - `check-graph.ts` (package dependencies from `package.json`).
10. **Docs:**
    - `docs/DEVELOPMENT.md`;
    - ADR-023 (TS kernel, Python oracle; closes O1/O3; amends ADR-001/017);
    - ADR-024 (units: float mm intent, integer millipoint resolved);
    - mark `docs/IMPLEMENTATION_ROADMAP.md` and `specs/INITIAL_IMPLEMENTATION_BACKLOG.md` superseded;
    - save **this specification** into `docs/product/` (split by section) as the product source of truth. **Privacy rule for that copy:** the repo is public, so every pilot-specific detail is replaced with fictional examples before it is committed. That covers the paper's name, file-name prefix, place names, real headlines quoted as examples, and advertiser names. The privacy guard must pass on it.
11. **Finish:** `graphify update .`, then a PR with the task card, an independent code review and an independent verifier, as always.

### 15.6 Working rules (unchanged and binding)
- **Private data:** pilot content, fonts, artwork and review answers never enter the public repo; a guard runs before every push.
- **Frozen evidence:** the Python oracle (`tools/oracle/v0`) and the experiments stay untouched, in place.
- **Goldens:** they change only through the generators, with a changelog entry and human approval.
- **Pull requests:** at most 400 net LOC per kernel PR. Every substantial PR gets an independent code reviewer and an independent verifier.
- **Claims:** no claim of press-ready, PDF/X-valid or G1/G2 met without evidence.
- **AI:** never decides geometry, line breaks, fit or validity.
- **Graph:** run `graphify update .` after code changes.


## 16. Decisions the owner needs to make (defaults in **bold**; approving this plan accepts the defaults)

| # | Decision | Default | Needed by |
|---|---|---|---|
| O-0 | **G0:** sign the one-page pilot agreement (The Sahyadri Daily) and get the press questionnaire answered (G0-1, G0-2) | **Yes; the team drafts both for you** | M9, M13 |
| O-1 | **G2 completion:** second press test with photos + an ad from the existing pipeline, and file the record sheet (G2-1, G2-2) | **Yes; the team prepares the file** | M13 |
| O-a | Merge PR #4 | **Merge** (you said you'll confirm) | M0 |
| O-b | Node version | **Node 24 LTS** | M0 |
| O-c | Golden reference machine | **This Mac (macOS arm64, Python 3.11.14), never upgraded** | M1 |
| O-d | Where private parity tests run | **Locally only, with the result attested in each PR** (no private CI on a public repo) | M3 |
| O-e | Back up `~/PageinatorPrivate` | **Yes: encrypted external disk + one cloud copy** | M3 |
| O-f | Re-confirm press acceptance for a TS-made file (M6), and later a TS-made page with photos + an ad (M15b) | **Yes** (two more test sends) | M6, M15b |
| O-h | **G1:** the signed sheet, plus L3 measured on the 24 reviewed pages, which are the G1 evidence set | **Yes** | M8 |
| O-i | House fonts: files + licence evidence (browser use? PDF embedding?), TrueType or CFF | **Needed**; until then the free stand-ins | M10 |
| O-j | A Windows i5 / 8 GB laptop for performance tests; measure the newsroom's internet to Mumbai | **Borrow one from the newsroom** | M9 |
| O-k | Hosting | **AWS ap-south-1 minimal** (≈ $150–300/month); plan B: Supabase Mumbai + Fly.io | M13 |
| O-l | Sign-in provider | **Better Auth** (self-hosted) after a 2-day spike | M14 |
| O-m | Budget for one Acrobat Pro or pdfToolbox seat (cross-check) and a light penetration test before G3 | **Yes** | M15a |
| O-n | Interface language | **English + Marathi** (D4) | B0 |
| O-o | Run Track B (foundation + low-fidelity prototype for staff walkthroughs) in parallel | **Yes, low intensity; never blocks Track A** | B0 |


## 17. Verification

| Milestone | How we prove it | Commands / evidence |
|---|---|---|
| M0 | Same tests pass after the move; oracle intact; guards bite | `pnpm install --frozen-lockfile && pnpm ci`; `pnpm --filter @pageinator/web test` (count = baseline); in `tools/oracle/v0`: `PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m pytest -p no:cacheprovider tests/` → 182 passed (pyproject already adds `-q`); planted `.icc` file → guard fails |
| M1–M4 | Bit-exact against the Python reference | `tools/oracle/v0/.venv/bin/python tools/goldens/v1/gen_all.py --check`; `pnpm --filter @pageinator/{pyshim,harfbuzz,fonts,shape,hyphenate,compose,headline} test`; `PAGEINATOR_PRIVATE_GOLDENS=~/PageinatorPrivate/goldens/v1 pnpm test:private` (fails, never skips, if missing; the existing `PAGEINATOR_PRIVATE_CORPUS` and `PAGEINATOR_PRIVATE_FONTS` variables keep their meaning); WASM rebuild SHA-256 equals `BUILD.json` |
| M5 | Contract stable; lines identical | `pnpm --filter @pageinator/document run contracts:check`; `pnpm pgn replay fixtures/goldens/v1/resolve` |
| M6 | **Press-accepted output reproduced** | `pnpm pgn press-test --synthetic`; `pnpm pgn pdf-diff <accepted.pdf> <ts.pdf>` (content streams byte-identical; allowlisted dictionary differences only); independent checker 0 FAIL; mutation test 6/6; private run on the accepted page; **press written acceptance naming the SHA-256** |
| M7 | Same answer in every browser | `pnpm test:browsers` (Chromium/Firefox/WebKit); `pnpm bench:kernel`; macOS/Linux CI produce identical PDF bytes |
| M8 | **The reviewed pages transfer** | `pnpm pgn replay fixtures/goldens/v1/flow`; `pnpm test:private -- g1-transfer` (the Python outputs for the 24 reviewed pages reproduced exactly) |
| M9–M12 | Fast, exact, typeable | Playwright parity (L1 structure, L2 draw log); perf traces on the Windows laptop; signed IME matrix sheet |
| M13–M16 | Isolation, recovery, export | `docker compose -f infra/docker/compose.dev.yml up -d && pnpm --filter @pageinator/api test` (tenancy, contract, idempotency); kill-the-tab recovery; 4-page export ≤ 60 s; planted-defect preflight tests; restore drill |
| G3+ | The real world | Printed edition, delivery receipts with hashes, shadow-night logs (doc 13) |
| Every PR | Two independent agents | Code review + independent verification; privacy scan before push |
| Every real screen (built at its gate) | Behaviour + accessibility | Component tests per screen; axe zero serious violations; each role sees exactly §12; Marathi strings render; staff walkthrough of the screen against the prototype notes |
| G0 / G2 / G1 actions | Paper trail | Signed MoU; answered questionnaire; press acceptance naming the SHA-256 of the photo + ad page; filed record sheet; signed G1 sheet; L3 report |
