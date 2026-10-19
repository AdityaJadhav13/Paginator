# UI001 — Independent Implementation Review

Status: review complete — **not ready to commit**
Reviewed: 2026-09-17
Branch: `feature/ui001-foundation` (implementation uncommitted; `git status` shows only `?? frontend/`)
Contract: `specs/active/UI001_UI_FOUNDATION.md`
Scope of changes made by this review: this file only. No file under `frontend/` was modified.

---

## 0. Reviewer independence disclosure

This review was requested as an independent review of work by a separate implementation agent. **The review was carried out in the same Claude Code session that produced the UI001 implementation**, so it is not independent in authorship. To offset that, no claim from the implementation completion report was accepted as given. Every claim below rests on evidence gathered during the review:

- all source, configuration, manifest, lockfile, and test files were read in full;
- validation commands were re-run;
- the `skipLibCheck` claim was tested with the compiler and a control run;
- the production build was driven in a real browser (headless Chrome 152 over the DevTools protocol) to verify layout, dialog, focus, contrast, reduced-motion and axe behavior that jsdom cannot show;
- type-level API probes and a `src/ui`-only compilation were run from scratch configurations outside the repository.

A second review by a different reviewer is still advisable before merge.

---

## 1. Verdict summary

| Area | Result |
|---|---|
| Acceptance criteria | PASS 15 · PARTIAL 9 · FAIL 6 · NOT VERIFIABLE 0 |
| Findings | BLOCKER 1 · HIGH 6 · MEDIUM 11 · LOW 8 · NOTE 7 |
| Typecheck / Tests / Build | PASS / PASS (565/565) / PASS |
| Lint | NOT CONFIGURED |
| `skipLibCheck` | **REQUIRES CHANGE**: a narrower fix was shown to compile with `skipLibCheck: false` |
| Dependencies | **CHANGES REQUIRED** |
| Scope compliance | PASS |
| Architecture-boundary compliance | PASS |
| Ready to commit | **NO** |

The foundation is well structured: the durable/demo split is clean, there is no scope creep, and several behaviors hold up in a real browser: the dismissible dialog, Enter activation, reduced motion, contrast, and full-page axe with zero serious or critical violations. It still cannot be committed. Nothing ignores `node_modules`/`dist` (B-01). Beyond that, the implementation does not meet UI001's own semantic contract for stale proofs, scenario sequences, and required status identities (H-01–H-03). The non-dismissible dialog breaks in Chromium (H-04). The test suite never exercises the showcase that §13 requires (H-05). The dependency gate was never recorded (H-06).

"565 passing tests" overstates coverage. 323 of them (57%) are generated presence or loop checks, and several interaction tests cannot fail (M-10, M-11).

---

## 2. Method and independent validation

### 2.1 Commands (run by the reviewer)

| Command | Result |
|---|---|
| `npm run typecheck` | PASS (exit 0) |
| `npm test -- --run` | PASS: 8 files, **565/565** |
| `npm run build` | PASS. Output hashes identical to the pre-existing `dist/` (`index-BvNSICcV.css`, `index-DQniS1wY.js`) |
| lint | NOT CONFIGURED: no `lint` script and no ESLint config, yet `Field.tsx:45` carries an `eslint-disable` comment |
| `npx tsc --noEmit --skipLibCheck false` | 3 errors, all TS2428 `Assertion` declaration conflicts in `node_modules` |
| `npm audit` | 0 vulnerabilities |
| `npm ci` (scratch copy of manifest + lockfile) | succeeds, with `EBADENGINE` for `vitest@5.0.1` on Node 25.8.2 |
| `git add --dry-run frontend` | **4,377 paths** would be staged; only 46 are source files |

### 2.2 Real-browser verification (production build, headless Chrome 152)

| Check | Observation |
|---|---|
| 320 CSS px, LTR | `scrollWidth` **376** > `clientWidth` 320: page scrolls horizontally. Offender: "Denied action (focusable, not activatable)" button |
| 320 CSS px, RTL | Same button overflows to `left: -56px`: label clipped and unreachable by scrolling |
| axe, full showcase, LTR and RTL | 0 serious/critical violations. Moderate: `landmark-one-main`, `region`. Serious "needs review": `aria-prohibited-attr` ×16 (icon spans), `color-contrast` ×19 (icon-only glyphs) |
| axe, dismissible dialog open | 0 serious/critical violations |
| Dismissible dialog via keyboard | Enter opens; focus moves to heading `h2`; Tab and Shift+Tab stay in the dialog (passing through browser chrome, as native modals do); background not focusable; Escape closes; focus returns to "Open dialog" |
| Non-dismissible dialog via keyboard | 1st Escape: stays open. **2nd Escape: closes natively.** Pressing the opener again: **does not reopen** |
| Enabled Button + Enter | Scenario 1 advances exactly one step (Simulated → Pending) |
| Denied button | Focusable, `aria-disabled="true"`, `aria-describedby` resolves to the *disclaimer* text, not the denial reason |
| Initial-render live regions | One `role="alert"` present on first render ("Resolution failed" InlineMessage) |
| Scenario 2 after advance | "Stale · Layout proof · Proof from revision: demo-proof-018-a · Current revision: demo-rev-019 · …" (`demo-rev-018` never shown) |
| Status icon accessibility tree | `generic`, name "diamond" (exposed as noise) |
| `prefers-reduced-motion: reduce` | Spinner `animation-name: none`; label text retained |
| Computed contrast (actual token values) | Status label text on `#F1F5F9` ≥ 5.00:1 for all eight; InlineMessage text ≥ 5.91:1; disabled text 3.90:1 |

### 2.3 Scratch probes (outside the repository)

- **`src/ui`-only program** (demo excluded): typechecks, and 0 demo files are pulled in.
- **Type probe:** `<Button ref={…}>` and `<Checkbox ref={…}>` are rejected (TS2322). `<StatusIndicator state="approved-candidate" subject="…" />` (no `candidateLabel`), `state="stale"` with no revisions, and `state="failed"` with no `detail` all **typecheck**.
- **jsdom:** `HTMLDialogElement.prototype.showModal` is `undefined`, so every Dialog test runs against the two-line polyfill in `dialog.test.tsx`.

---

## 3. Review 1 — Acceptance criteria

| AC | Result | Evidence |
|---|---|---|
| AC-01 frontend-only, no forbidden scaffold | PASS | `git status` shows only `frontend/`; no backend/worker/route/schema/service directories. (Generated artifacts: B-01) |
| AC-02 dependency review recorded before install | **FAIL** | No UI001 dependency record exists; `docs/research/DEPENDENCY_CANDIDATES.md` predates UI001 and says exact review is pending. No Node runtime selected or recorded (no `engines`, `.nvmrc`). H-06 |
| AC-03 exact pins; commands succeed | PARTIAL | Manifest pins exact; lockfile root still records `@types/node` as `^22.20.3`; `@types/node` is outside the approved set; commands pass only on Node 25, which vitest/jsdom engines exclude. H-06, M-02 |
| AC-04 tokens for all §6 values; no raw values in durable components | **FAIL** | All §6 tokens present with correct values, but `base.css:465,559–578` contains 9 raw hex colours plus raw `rgb()` backdrop, `4px` status border (`:633`), `800ms` spinner (`:617`). M-03 |
| AC-05 contrast tests meet §6.3 | PARTIAL | Pairs are hard-coded in `contrast.ts`, not read from `tokens.css`. Status accents are asserted at 3:1 although rendered as normal-size label text (4.5:1 required). InlineMessage pairs untested. Actual values pass (§2.2). M-03 |
| AC-06 typography roles | PASS | `base.css:35–89` matches the §6.1 table exactly; system fonts only; no `url()`/font requests. (Tests check class-name presence only: M-11) |
| AC-07 layout primitives; bounded tokenized spacing | PARTIAL | Gap props are `SpaceToken` `"0"`–`"9"`. `Grid.minItemSize` accepts any string (`Grid.tsx:16`). No ref forwarding. M-09, M-06 |
| AC-08 Button/IconButton native, named, respond once | PASS | Native `<button>`, `type="button"` default, no custom activation handler when enabled; one-step advance on Enter verified in Chrome. (Untested in suite: M-10) |
| AC-09 Field/TextInput/TextArea/Select labels, associations, invalid/required | PASS | `label[for]`, `aria-describedby` (description + errors), `aria-invalid="true"`, native `required` + visible "(required)". Prop-collision risk: M-08 |
| AC-10 Checkbox/RadioGroup native keyboard + labels, incl. RTL | PARTIAL | Native elements and labels correct. RadioGroup cannot be used uncontrolled (M-07). Space test is a false positive; arrow keys and RTL keyboard untested (M-10) |
| AC-11 disabled/denied cannot activate; denial explanation referenced | PARTIAL | Activation blocked (`onClick` not wired when denied). Capability-card buttons reference the disclaimer, not the denial reason (L-01). Denied Enter/Space tests cannot fail (M-10) |
| AC-12 Dialog name, focus, containment, dismissibility, inertness, restoration | **FAIL** | All pass in Chrome except dismissibility: non-dismissible dialog closes on second Escape and cannot be reopened. H-04 |
| AC-13 InlineMessage/ProgressIndicator meaning via text + semantics | PASS | Visible heading/label text; native `<progress>`; decorative spinner `aria-hidden`. Minor issues L-02, L-04 |
| AC-14 focus indicator incl. invalid, forced colours, keyboard | PASS | Global `:focus-visible` 2px/2px (`base.css:98`), invalid rule (`:104`), forced-colours `Highlight` (`:734`). No component removes outlines. Structural review as §13.3 allows |
| AC-15 reduced motion | PASS | Verified in Chrome: spinner stops, text retained |
| AC-16 LTR/RTL, no physical CSS, no clipping or page scroll at 320px | **FAIL** | Measured `scrollWidth` 376 at 320px (LTR) and label clipped at −56px (RTL). M-04; untested: H-05 |
| AC-17 exactly eight states; not a production lifecycle | PASS | `presentation-state.ts:11–19`; imported only by UI and demo code |
| AC-18 label, tone, non-colour cue, announcement behavior per state | PARTIAL | Labels, icons, accent tokens correct. Announcement mechanics unreliable (live attribute toggled with content; no coalescing); icon names via prohibited `aria-label`. M-05, L-02 |
| AC-19 saved intention never resolved/confirmed | PASS | Canonical "Saved Intention"; distinct icon ◇ vs ◉ |
| AC-20 simulated visibly labeled | PASS | Sticky "Simulated" banner wraps all demos; `simulated` state label |
| AC-21 stale shows older proof revision and newer editable revision | **FAIL** | Stale renders the *proof ID* as "Proof from revision"; `demo-rev-018` never appears. H-02 |
| AC-22 approved candidate identity + "Not published" | PARTIAL | "Not published" unconditional. Identity is optional in the API and silently omitted when missing. H-01 |
| AC-23 failed recomposition retains intention; last proof separate | PARTIAL | Separate confirmed-proof indicator after failure. The retained revision-19 intention exists only in free-text `detail`; no proof is visible during recomposing. H-03 |
| AC-24 org/publication fixtures | PASS | Fictional, qualified, static, `fixtureKind` present |
| AC-25 capability disclaimer | PASS | All four cards display the exact disclaimer |
| AC-26 four scenarios exactly per §10.4; deterministic; reset | **FAIL** | Scenario 2 omits "saved intention at `demo-rev-019`". Deterministic, no timers/network, reset works. H-03 |
| AC-27 `src/ui` import boundary | PASS | No forbidden imports (source read + `src/ui`-only compile). Test regex weaknesses: M-11 |
| AC-28 axe on every showcase section and dialog-open state | PARTIAL | Reviewer's browser run: 0 serious/critical (full page LTR/RTL, dismissible dialog open). The suite never runs axe on the showcase or any dialog-open state. H-05 |
| AC-29 no network/storage/credentials/etc. | PASS | Source grep: no `fetch`, `XMLHttpRequest`, `WebSocket`, storage, cookies, service workers, canvas |
| AC-30 durable vs disposable by path; demo removable | PASS | `src/ui/**` vs `src/demo/ui001/**`; `src/ui` compiles and its component tests run without demo. (Task 10 "removal simulation" test absent: H-05) |

**Totals: PASS 15 · PARTIAL 9 · FAIL 6 · NOT VERIFIABLE 0.** Spec §14 states UI001 passes only if all 30 pass.

### Implementation tasks

| Task | Status |
|---|---|
| 1 Toolchain | Mostly done; no empty smoke test; runtime/dependency gate unrecorded (H-06) |
| 2 Tokens/base | Done except raw values (M-03) |
| 3 Layout | Done except bounded `minItemSize` and refs (M-09, M-06) |
| 4 Fields | Done; API issues M-07, M-08 |
| 5 Actions | Done; refs (M-06), weak keyboard tests (M-10) |
| 6 Dialog/messages/progress | Dialog dismissibility defect (H-04); tests polyfill-based |
| 7 Presentation state | Required identities unenforced (H-01); identity semantics (H-02) |
| 8 Fixtures/showcase | Scenario deviations (H-03); 320px check missing and failing (H-05, M-04) |
| 9 Cross-cutting a11y/RTL | Showcase-level verification absent (H-05) |
| 10 Boundaries/final | Boundary test present; removal simulation absent; generated artifacts not ignored (B-01) |

---

## 4. Findings

### BLOCKER

#### B-01 — Generated dependency and build artifacts are not ignored

- **Files:** `.gitignore` (repository root); no `frontend/.gitignore`.
- **Problem:** Neither file ignores `node_modules/`, `dist/`, `coverage/`, or `*.tsbuildinfo`. `git check-ignore` reports all as not ignored. `git add --dry-run frontend` would stage **4,377 paths** (113 MB of `node_modules`, plus `dist/` and `node_modules/.vite/vitest/results.json`); only 46 are authored source files.
- **Risk:** The first `git add frontend` / `git add .` commits the dependency tree and build output, bloating history permanently.
- **Requirement affected:** Task 10 completion ("the diff contains only authorized frontend UI001 files and necessary dependency manifests/lockfile"); AC-01 intent.
- **Smallest correction:** Add `frontend/.gitignore` (or root entries) with `node_modules/`, `dist/`, `coverage/`, `*.tsbuildinfo`.
- **Proving test:** `git add --dry-run frontend | grep -cE 'node_modules|/dist/'` returns `0`, and `git add --dry-run frontend | wc -l` equals the authored-file count.

### HIGH

#### H-01 — StatusIndicator does not enforce its required identities

- **Files:** `frontend/src/ui/contracts/presentation-state.ts:26–56`; `frontend/src/ui/controls/StatusIndicator.tsx:140–197`.
- **Problem:** `candidateLabel`, `revisionLabel`/`relatedRevisionLabel`, and `detail` are optional for every state. `approved-candidate` without `candidateLabel` renders "Approved Candidate · Not published" with no identity. `stale` without `revisionLabel` renders no revision information at all (the whole block is gated on it). `failed` without `detail` renders no failure description. The reviewer's type probe confirms all three compile.
- **Risk:** The durable public API permits exactly the ambiguous states §4 and §5.1 forbid. Later units mapping domain state into `PresentationState` get no compile-time or runtime protection.
- **Requirement affected:** §5.1 ("`approved-candidate` requires `candidateLabel`", "`stale` requires…", "`failed` requires a human-readable detail"); AC-21, AC-22; Task 7; §13.5 "Assert approved candidate requires an identity".
- **Smallest correction:** Make `StatusIndicatorProps` a discriminated union keyed on `state` that keeps the §5.1 field names but makes `candidateLabel` required for `approved-candidate`, both revision labels required for `stale`, and `detail` required for `failed`. Add a dev-time runtime guard (e.g. throw or render an explicit "identity missing" error) for untyped callers.
- **Proving test:** `// @ts-expect-error` cases for each missing field in a type-test file included in `typecheck`, plus render tests asserting the guard.
- **Note:** §5.1 shows a flat interface. A discriminated union is structurally compatible and is the least-invasive way to satisfy the prose rules; record it as a clarification if needed.

#### H-02 — Revision and proof identities are overloaded and mis-rendered

- **Files:** `frontend/src/ui/controls/StatusIndicator.tsx:140–177`; `frontend/src/ui/contracts/presentation-state.ts:33–43`; `frontend/src/demo/ui001/scenarios.ts:66–70, 88–94, 123–129`.
- **Problem:**
  1. The `stale` branch labels `revisionLabel` "Proof from revision", but every caller passes a **proof ID** (`demo-proof-018-a`). The stale proof's revision, `demo-rev-018`, is never displayed (confirmed in Chrome, §2.2).
  2. For `confirmed-proof`, `revisionLabel` is rendered as "Proof:", and the revision comes from `relatedRevisionLabel`.
  3. For `pending`, `saved-intention`, `recomposing`, and `failed`, `revisionLabel` is accepted but **silently not rendered**. The revision appears only inside free-text `detail`, unwrapped by `<bdi>`.
  4. The JSDoc calls `revisionLabel` "the current editable revision… Required for stale", which contradicts the stale rendering.
- **Risk:** Callers cannot know what a label means, and the displayed identity (a proof labelled as a revision) is wrong. This is the stale-vs-current distinction §4 marks non-negotiable.
- **Requirement affected:** §4 rule 3; §9 (identifiers in `bdi`); AC-21; §13.4 "fixture identifiers use `bdi`".
- **Smallest correction:** Give each label one meaning: `revisionLabel` is the revision the state is about, and `relatedRevisionLabel` is the newer current revision (stale) or the bound revision (confirmed proof). Render `revisionLabel` for every state that accepts it. A proof identity has no field in §5.1: show it through `subject` ("Layout proof demo-proof-018-a") or add an explicitly approved `proofLabel`. Stale must render "Proof revision: demo-rev-018 · Current revision: demo-rev-019".
- **Proving test:** Table test per state asserting the exact visible identity text inside `<bdi>`. Stale test asserting both `demo-rev-018` and `demo-rev-019` and that no proof ID appears after "revision:".

#### H-03 — Scenarios 2 and 3 do not follow §10.4

- **Files:** `frontend/src/demo/ui001/scenarios.ts:79–129`; `frontend/src/demo/ui001/Ui001Showcase.tsx:397–444`; `frontend/tests/ui001/boundary.test.ts:193–259`.
- **Problem:**
  - **Scenario 2** must end with "saved intention at `demo-rev-019` while `demo-proof-018-a` remains visible as stale". The implementation replaces the confirmed proof with a single stale indicator; no saved-intention indicator for revision 19 exists.
  - **Scenario 3:** in the recomposing step no proof is visible (spec §4: "Any older proof remains visibly old or stale"). The last confirmed proof appears only after failure, which suggests it was produced by the failure. The retained revision-19 intention exists only in `detail` prose (AC-23 "retains the current intention").
  - Scenario tests check only first and last states, so these deviations pass.
- **Risk:** The showcase is the G1 honest-simulation evidence; it currently demonstrates a weaker model than the spec.
- **Requirement affected:** §10.4 scenarios 2–3; AC-23, AC-26; §13.5 "Assert status transitions follow only the deterministic sequences".
- **Smallest correction:** Model each scenario step as the full set of indicators shown. Scenario 2 final = [saved-intention rev-019, stale proof-018-a (rev-018 vs rev-019)]. Scenario 3 = [recomposing rev-019 + last confirmed proof rev-018] → [failed rev-019 + saved-intention rev-019 + last confirmed proof rev-018].
- **Proving test:** Render the showcase, advance each scenario, and snapshot-free assert the ordered list of `data-pg-state` values and identity texts at every step, then reset.

#### H-04 — Non-dismissible Dialog closes on repeated Escape and cannot be reopened

- **Files:** `frontend/src/ui/controls/Dialog.tsx:48–86`.
- **Problem:** The component cancels the `cancel` event but never listens for `close`. Chromium's close-watcher rule makes `cancel` non-cancelable when no user activation occurred since the previous cancel (Escape does not grant activation). Reproduced in Chrome 152: the second Escape closes the non-dismissible dialog natively. React state still holds `open=true`, so the effect never re-runs and **the opener cannot reopen the dialog** until reload. The same desync applies to `<form method="dialog">` content. No cleanup closes the dialog or restores focus if it unmounts while open.
- **Risk:** A destructive or in-progress confirmation can be dismissed by double Escape, and the control is then left broken.
- **Requirement affected:** §8.4 ("Escape closes only a dismissible dialog"); AC-12.
- **Smallest correction:** Add a `close` listener that calls `onClose()` so state always matches the element. Document that non-dismissible means "no dismiss affordance and first Escape is blocked", not a guarantee against user-agent close. Add effect cleanup that closes and restores focus on unmount.
- **Proving test:** In jsdom, dispatch `close` on the dialog and assert `onClose` is called and reopening sets `open` again. Record a manual Chromium check (open → Escape → Escape → state closed → reopen works).

#### H-05 — The required showcase-level tests do not exist

- **Files:** `frontend/tests/ui001/accessibility.test.tsx`, `rtl.test.tsx`, `dialog.test.tsx` (`grep -rn Ui001Showcase tests/` returns nothing).
- **Problem:** No test renders `Ui001Showcase`. Missing, although §13 requires them:
  - axe on every showcase section and each dialog-open state (§13.3, AC-28);
  - Tab/Shift+Tab traversal of the showcase (§13.2);
  - full showcase under `rtl`/`ur-IN` then `ltr`/`en-IN` (§13.4);
  - the 320px structural check (Task 8);
  - the demo-removal simulation (Task 10).

  The "Heading structure" test renders a hand-written `<div>`, not the showcase. Dialog tests run on a polyfill (jsdom has no `showModal`), so initial focus, containment, and inertness are never asserted.
- **Risk:** Defects that show up only when components are composed (H-02, H-03, M-04, M-05, the initial `role="alert"`) pass CI. AC-28 evidence exists only from this review's manual browser run.
- **Requirement affected:** §13.2–13.4; AC-16, AC-28; Tasks 8–10.
- **Smallest correction:** Add showcase tests: render once per direction, run axe per `section[aria-labelledby]` and with each dialog open, tab through with `userEvent.tab()` asserting DOM order, and assert heading order from the real showcase. Keep 320px, focus containment, and repeated-Escape as a documented browser check, since jsdom has no layout or native dialog.
- **Proving test:** The tests above, which must fail against the current Scenario 2 text and the initial-render `role="alert"`.

#### H-06 — Dependency adoption gate and Node runtime were never recorded; validation ran on an engine-excluded Node

- **Files:** `frontend/package.json` (no `engines`); no `.nvmrc`/`.node-version`; no dependency record under `docs/` or `specs/`.
- **Problem:** §12 requires, *before installation*, a recorded review of versions, licenses, engines, provenance, advisories, and transitive tree, plus a selected supported Node runtime ("the observed Node 25 build must not be chosen merely because it is present"). None is recorded. All validation ran on Node 25.8.2, which is outside `vitest@5.0.1` (`^22.12.0 || ^24.0.0 || >=26.0.0`) and `jsdom@30.1.0` (`^22.22.2 || ^24.15.0 || >=26.0.0`); `npm ci` emits `EBADENGINE`. The completion report called these "advisory". They are explicit engine exclusions. `@types/node` was added without authorization.
- **Requirement affected:** §12; AC-02, AC-03.
- **Smallest correction:** Select a supported LTS (Node 22 or 24), add `"engines"` and `.nvmrc`, re-run all three commands on it, and write the dependency record (versions, licenses including MPL-2.0 `axe-core` and transitive `lightningcss`, audit result, tree size, engine ranges, the `@types/node` decision).
- **Proving test:** CI or local run of `npm ci && npm run typecheck && npm test -- --run && npm run build` under the selected Node with no `EBADENGINE` warnings.

### MEDIUM

#### M-01 — `skipLibCheck: true` is avoidable

- **Files:** `frontend/tsconfig.json:7`; `frontend/src/test/setup.ts:1`.
- **Verified:** The incompatibility is real. `@testing-library/jest-dom/types/vitest.d.ts` augments `interface Assertion<T = any>`, while Vitest 5 declares `Assertion<R, T>` (TS2428 ×3). But Vitest 5 exposes `interface Matchers<R, T>` as its extension point. In a scratch program with `skipLibCheck: false`, `setup.ts` excluded, and a four-line declaration (`declare module "vitest" { interface Matchers<R …, T …> extends TestingLibraryMatchers<unknown, R> {} }`), `tsc` exits **0**. The control without the declaration fails with 122 missing-matcher errors, proving the declaration supplies the types.
- **Risk:** `skipLibCheck` hides all future declaration errors across `node_modules`, including the React/Vite types the durable API depends on.
- **Requirement affected:** Review 7 intent; §12 notes jest-dom is optional.
- **Smallest correction:** In `setup.ts`, use `import * as matchers from "@testing-library/jest-dom/matchers"; expect.extend(matchers);`. Add `src/test/jest-dom-vitest.d.ts` with the `Matchers` augmentation and remove `skipLibCheck`. Alternative: drop the optional jest-dom dependency.
- **Proving test:** `npm run typecheck` passes with `skipLibCheck` absent, and one matcher test still fails when its expectation is inverted.

#### M-02 — `@types/node` and test globals leak into production type-checking

- **Files:** `frontend/package.json:21`; `frontend/package-lock.json` root (`"@types/node": "^22.20.3"`); `frontend/tsconfig.json:19–21`; tests using `readFileSync`/`__dirname`.
- **Problem:** `@types/node` is unapproved. It is only needed to read CSS from tests, which Vite's `import css from "…/base.css?raw"` does without Node types. Because `types: ["vitest/globals", "node"]` applies to the whole `src` + `tests` program, production source typechecks with `describe`, `expect`, `process`, `Buffer` in scope. The lockfile root still records the caret range (cosmetic: `npm ci` passes). `__dirname` in an ESM package works only through Vitest's shim.
- **Requirement affected:** §12 (no silent additions; exact pins); AC-03.
- **Smallest correction:** Replace file reads with `?raw` imports and remove `@types/node`, or approve and record it pinned to the selected Node major. Split `tsconfig` into app (no test/Node globals) and test configs, and regenerate the lockfile.
- **Proving test:** A deliberate `describe` reference inside `src/ui` fails `typecheck`.

#### M-03 — Raw values in durable CSS; token and contrast tests do not guard them

- **Files:** `frontend/src/ui/base.css:465, 559–580, 613, 617, 633`; `frontend/tests/ui001/tokens.test.ts:17–19, 126–137`; `frontend/src/test/contrast.ts:51–103`.
- **Problem:**
  - InlineMessage variants use 9 raw hex colours; the dialog backdrop uses raw `rgb()`; plus raw `4px`, `2px`, `800ms`, `1rem`, `1.25rem`, `0.5rem` sizes.
  - The "raw value boundary" tests only check that `tokens.css` has no `url()`/`@import`; nothing scans `base.css`.
  - `tokenExists` checks names, not the §6 values.
  - Contrast pairs are hard-coded hex strings, not parsed from `tokens.css`, so a token edit cannot fail them.
  - The eight status accents are asserted at 3:1, but `.pg-status__label` renders them as 14px text (4.5:1 required).
  - Actual ratios all pass (§2.2); the gap is enforcement.
- **Requirement affected:** §6 ("Components must consume semantic tokens"); AC-04, AC-05; Task 2 raw-value boundary test.
- **Smallest correction:** Express InlineMessage colours with existing tokens (e.g. `surface-subtle` background + semantic border/text), or add approved semantic tokens recorded in the spec. Parse `tokens.css` in the contrast helper, raise status-label pairs to 4.5:1, and add a `base.css` scan rejecting hex/`rgb()` and non-approved literals outside an explicit allow-list (the spec's `2px` focus values).
- **Proving test:** Changing any colour token value or adding a hex literal to `base.css` makes a test fail.

#### M-04 — Page scrolls horizontally at 320px

- **Files:** `frontend/src/ui/base.css:192` (`.pg-button { white-space: nowrap }`); `frontend/src/demo/ui001/Ui001Showcase.tsx:674–680`.
- **Problem:** Measured `scrollWidth` 376 at 320px in LTR; in RTL the label is clipped at −56px. The durable Button forbids wrapping, so any long label overflows narrow containers. Grids with `minItemSize` ≥ available width have the same risk (M-09).
- **Requirement affected:** §9 (usable at 320px without horizontal scrolling); AC-16.
- **Smallest correction:** Allow wrapping (`white-space: normal`, `min-block-size` instead of fixed `block-size`, `max-inline-size: 100%`), or shorten the showcase label and keep nowrap only for `IconButton`.
- **Proving test:** Documented browser check at 320px: `document.documentElement.scrollWidth <= clientWidth` in both directions.

#### M-05 — Announcement and live-region behavior is unreliable

- **Files:** `frontend/src/ui/controls/StatusIndicator.tsx:104–127`; `frontend/src/ui/controls/Field.tsx:73–81`; `frontend/src/demo/ui001/Ui001Showcase.tsx:392, 413, 430, 440, 836`.
- **Problem:**
  1. The showcase passes `announcement="off"` on the initial step and `"polite"`/`"assertive"` afterwards, so `aria-live` is **added in the same render as the content change**. Many screen-reader and browser combinations do not announce changes in a region that was not live beforehand, including the failure transition (`off` → `assertive`).
  2. The last-proof indicator mounts with `announcement="polite"` already populated.
  3. Field's `aria-live="assertive"` container mounts together with its errors.
  4. The showcase renders `InlineMessage live` (`role="alert"`) on initial page load (confirmed in Chrome), contrary to §8.5.
  5. No coalescing of rapid changes exists.

  Announcement behavior itself is not verifiable without assistive-technology testing. These are code-level risks, and the pattern contradicts the spec's rule.
- **Requirement affected:** §5.1 announcement rules; §8.5; AC-18; §13.3.
- **Smallest correction:** Keep a stable live region mounted from first render and change only its content. Suppress initial announcement by rendering the initial content before the region becomes live, or by announcing only through a separate always-mounted announcer. Render Field's error container always (empty when valid). Remove `live` from the initial-render showcase message.
- **Proving test:** Assert the live attribute is identical before and after an `advance` click. Assert no `role="alert"` exists on initial showcase render. Record a manual VoiceOver/NVDA check.

#### M-06 — Refs are not forwarded by several controls

- **Files:** `frontend/src/ui/controls/Button.tsx`, `IconButton.tsx`, `Checkbox.tsx`; all `frontend/src/ui/layout/*.tsx`.
- **Problem:** Reviewer probe: `<Button ref={…}>` and `<Checkbox ref={…}>` fail typecheck (TS2322). TextInput/TextArea/Select use `forwardRef`, the others use nothing, so the pattern is inconsistent.
- **Requirement affected:** §8 ("Controls must forward native attributes and refs needed by later composition"); AC-07.
- **Smallest correction:** With React 19, type props as `ComponentPropsWithRef<"button">` (etc.) and pass `ref` through; use one pattern across all controls.
- **Proving test:** Type-test file rendering each control with a typed ref, plus a runtime test asserting `ref.current` is the native element.

#### M-07 — RadioGroup cannot be used uncontrolled

- **Files:** `frontend/src/ui/controls/RadioGroup.tsx:14–17, 60–62`.
- **Problem:** Every radio renders `checked={value === option.value}`. Without `value` and `onChange`, every radio is controlled to `false`: clicks and native arrow-key selection are reverted by React. The props look optional, so this is a silent trap, and it prevents the "native keyboard behavior" AC-10 promises.
- **Smallest correction:** Support `defaultValue` (uncontrolled `defaultChecked`) when `value` is undefined, or make `value`/`onChange` required.
- **Proving test:** `<RadioGroup legend options />`: focus the first radio, press ArrowDown, and assert the second is checked.

#### M-08 — Field overwrites the child's own `id` and `aria-describedby`

- **Files:** `frontend/src/ui/controls/Field.tsx:46–51`.
- **Problem:** `cloneElement` replaces `id` unconditionally and replaces `aria-describedby` whenever a description or error exists. A child that references another explanation (e.g. denial or help text) silently loses it. The `any` cast also hides wrong children: a `RadioGroup` child accepts no `id`, so the label points nowhere.
- **Requirement affected:** §8.2 (association with "one native control"); API durability.
- **Smallest correction:** Merge the child's `aria-describedby` tokens, respect an existing child `id` for `htmlFor`, and type `children` as `ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: … }>` without `any`.
- **Proving test:** Child with `aria-describedby="external"` inside a Field with errors keeps both IDs.

#### M-09 — `Grid.minItemSize` is an unbounded string

- **Files:** `frontend/src/ui/layout/Grid.tsx:4–17`.
- **Problem:** Accepts any CSS string, contradicting "bounded `minItemSize` token". The comment references a non-existent `minItemSizeValue`. A value larger than the container overflows (`minmax(X, 1fr)` with `auto-fill`).
- **Requirement affected:** §7 Grid contract; AC-07.
- **Smallest correction:** Accept a small union of approved sizes and use `minmax(min(X, 100%), 1fr)` so it cannot overflow.
- **Proving test:** Type test rejecting `"500px"`; CSS assertion that the grid template uses `min(…, 100%)`.

#### M-10 — Interaction tests that cannot fail, and missing keyboard coverage

- **Files:** `frontend/tests/ui001/controls.test.tsx:113–133, 378–384`; `frontend/tests/ui001/dialog.test.tsx:19–29, 96–118`.
- **Problem:**
  - The denied Enter/Space tests use `fireEvent.keyDown`, which never synthesizes a click in jsdom, so they pass even if denial blocking is removed.
  - The Checkbox "Space" test uses `userEvent.type`, which **clicks first**, so `onChange` fires from the click.
  - Enabled Enter/Space activation, radio arrow keys, and RTL keyboard behavior are untested.
  - Dialog Escape tests dispatch a synthetic `cancel` event on a polyfilled element; initial focus, containment, inertness, and non-dismissible-stays-open are never asserted.
  - "Disabled button is not in sequential focus order" asserts only `toBeDisabled()`.
- **Requirement affected:** §13.2; AC-08, AC-10, AC-11, AC-12.
- **Smallest correction:** Use `element.focus(); await userEvent.keyboard("{Enter}")` / `" "` / `"{ArrowDown}"`. Assert enabled buttons fire exactly once and denied ones zero times. Use `userEvent.tab()` to assert disabled controls are skipped and denied ones are reached.
- **Proving test:** Temporarily removing the denied guard in `Button.tsx` makes the denied tests fail.

#### M-11 — 57% of the test count is generated presence checks; structural scans are narrow

- **Files:** `frontend/tests/ui001/boundary.test.ts:37–88`; `tokens.test.ts`; `status-semantics.test.tsx:77–99, 323–338`; `rtl.test.tsx:204–266`; `layout.test.tsx:249–272`.
- **Problem:**
  - 240 of 565 tests are one-regex-per-file loops, 75 are "defines X" name checks, and 8 assert `data-pg-state`.
  - Import regex misses side-effect imports (`import "../demo/x.css"`) and paths without a trailing slash (`"../../demo"`).
  - No scan exists for AC-29 APIs.
  - The "exactly eight states" test asserts the length of an array literal and cannot detect a ninth union member.
  - The RTL DOM-order tests compare React output to itself.
  - The physical-CSS scan checks 6 properties (not `left`/`right`/`inset-left`/`text-align: left`/`float`/`order`/`row-reverse`) and is duplicated in two files.
- **Risk:** Inflated counts and passing scans give false confidence about AC-04, AC-16, AC-17, AC-27, AC-29.
- **Smallest correction:** Collapse per-file loops into one test per rule that reports offending files. Match all `import` forms and bare `/demo` segments. Add an API scan for `fetch|localStorage|sessionStorage|document.cookie|serviceWorker|WebSocket`. Use an exhaustive `satisfies Record<PresentationState, …>` check. Extend the physical-direction pattern list; delete tautological tests.
- **Proving test:** Adding `import "../demo/ui001/ui001-showcase.css"` to a `src/ui` file, or a ninth state, makes a test fail.

### LOW

- **L-01 — Denied action references the disclaimer, not the reason.** `Ui001Showcase.tsx:325–333, 350–358`: `aria-describedby` points to the disclaimer `div`; the denial-reason `<p>` has no ID. `Button.denied` does not require a description. Reference both IDs and consider requiring `aria-describedby` when `denied`. (AC-11)
- **L-02 — Icon labels use a prohibited attribute; dead code.** `StatusIndicator.tsx:129` and `InlineMessage.tsx:59` put `aria-label` on generic `span`s (axe `aria-prohibited-attr`, serious "needs review" ×16). Chrome exposes names like "diamond" that add noise before the canonical label. Mark glyphs `aria-hidden="true"`; the visible label and heading carry the meaning. `InlineMessage.tsx:50` `aria-live={!live ? undefined : undefined}` is dead; `speak: none` (`base.css:538`) is non-standard.
- **L-03 — CSS-generated readable glyph.** `base.css:327–331` `.pg-field__error::before { content: "⚠" }` violates §9's prohibition on CSS-generated readable text; use an `aria-hidden` inline element.
- **L-04 — ProgressIndicator labeling.** `ProgressIndicator.tsx:37, 53`: the visible label is not associated, and `aria-label` duplicates it. Numeric progress is visible only if the caller writes it into the label; `value` is not clamped. Use `aria-labelledby` and optionally render the value as text.
- **L-05 — Dead code and misleading comments.**
  - Unused classes: `pg-status--${state}`, `pg-checkbox--disabled`.
  - Empty rules: `.pg-dialog__content`, `.pg-showcase__context-card`, `.pg-showcase__scenario-card`.
  - Misnamed `fieldErrorId` used for denial IDs.
  - `as const` on already-annotated fixture objects (no effect).
  - `eslint-disable` without ESLint; `import React` at the end of `dialog.test.tsx`; `render.tsx` re-exports `render` twice.
  - IconButton docs say "visible accessible name" but it is `aria-label`.
  - `vite.config.ts`/`vitest.config.ts` are outside the `tsconfig` `include`.
- **L-06 — Forced colours do not mark denied buttons.** `base.css:719–722` styles only `:disabled` with `GrayText`; `[aria-disabled="true"]` looks enabled in forced-colours mode. The disabled button fill is 1.24:1 against `surface` (exempt, but weakens "remain perceivable").
- **L-07 — Showcase inaccuracies.** `readOnly` on a checkbox (`Ui001Showcase.tsx:784`) has no effect. "Disabled input" displays "Read-only value" using `disabled`, which blurs §8.3's `readOnly` vs `disabled` distinction.
- **L-08 — Placeholder-only coverage was removed by deviation 4.** The negative axe test now renders an input with neither label nor placeholder, so the §13.3 "no placeholder-only labeling" rule is untested. axe does treat a placeholder as an accessible name, so the fix belongs outside axe: assert every rendered `input`/`textarea` in the showcase has a `label[for]` association.

### NOTE

- **N-01 — Independence limitation.** See §0.
- **N-02 — Deviation 3 accepted.** WCAG 2.1 SC 1.4.3 exempts text in inactive components; `#6B7280` on `#E5E7EB` is 3.90:1 and the spec's own token values could never reach 4.5:1. The "deviation" corrected the implementer's own over-strict test; no spec threshold was weakened.
- **N-03 — Licenses and advisories.** `npm audit`: 0 vulnerabilities. MPL-2.0 packages (`axe-core`, transitive `lightningcss` via Vite) and MIT-0/CC0-1.0 packages are development-only and not shipped in `dist`. Record them in the H-06 dependency record.
- **N-04 — Verified strengths.** Dismissible dialog, keyboard opening, heading focus, background inertness, focus restoration, one-shot Enter activation, reduced motion, contrast, and full-page axe (0 serious/critical) all behave correctly in a real browser. Keep them covered by tests (H-05).
- **N-05 — Fixture shapes are acceptably disposable.** `OrgFixture`/`PublicationFixture`/`CapabilityFixture` live under `src/demo/ui001`, carry `fixtureKind`, and are imported by nothing durable. The `allowed: true|false` capability flag always renders with the disclaimer. No implied production contract was found.
- **N-06 — `test` script defaults to watch mode.** `npm test` without `-- --run` never exits; acceptable because §13.6 specifies `--run`, but CI must pass it.
- **N-07 — Review side effects.** `npm run build` rewrote `frontend/dist/` with byte-identical asset hashes. `npm test` rewrote `node_modules/.vite/vitest/results.json`. Browser, compiler, and install probes ran only from scratch directories outside the repository.

---

## 5. Reviews 2–12 in brief

### Review 2 — Scope control: PASS
No router, shell, deep links, service adapters, auth or tenancy code, persistence, DTOs, document/edition schemas, editor, canvas, composition, publishing, PDF, preflight, ingestion, archive, billing, or edition planning. Runtime dependencies are `react` and `react-dom` only. The showcase is a single page with no routes. No unnecessary future architecture was introduced.

### Review 3 — Durable vs demo boundary: PASS
Import direction is one-way (`demo` → `ui`), confirmed by reading every import and by compiling `src/ui` alone. `scenarios.ts` imports the `PresentationState` type from `ui`, which is the permitted direction. Capability fixtures cannot be mistaken for enforcement: every card carries the disclaimer, and `Button.denied` documents that it is not enforcement. Test-side weaknesses: M-11.

### Review 4 — State semantics
| Distinction | Result |
|---|---|
| Saved intention vs resolved output | Held: distinct labels and icons, "not yet resolved" copy |
| Simulated vs authoritative geometry | Held: banner and state label |
| Stale proof vs current-revision proof | **Weak**: labelled "Stale" and "not current", but wrong identity shown and old revision absent (H-02) |
| Approved candidate vs published | Held for "Not published"; identity can be omitted (H-01) |
| Demo permission vs production authorization | Held (disclaimer on every card) |

Scenario fidelity: H-03. Announcements: M-05.

### Review 5 — Accessibility
Semantic HTML, labels, fieldset/legend, heading order, focus indicator, reduced motion, and contrast are sound.

Places where axe passes but real interaction fails:
- non-dismissible Escape (H-04);
- live regions toggled with content (M-05);
- initial `role="alert"` (axe does not flag it);
- 320px clipping (axe does not measure it);
- the icon `aria-label` noise (reported only as "needs review");
- the denied describedby target (L-01).

### Review 6 — Component API quality
Issues: missing and inconsistent refs (M-06), RadioGroup controlled-only trap (M-07), Field prop collision (M-08), unbounded Grid (M-09), StatusIndicator optional required-fields (H-01) and overloaded labels (H-02).

Polymorphic layout primitives use `as ElementType` with `HTMLAttributes<HTMLElement>`. That allows `<Stack as="ul">` with non-`li` children. Acceptable for UI001; do not widen `as` further.

### Review 7 — TypeScript
`strict`, `noUnusedLocals`/`Parameters`, `noFallthroughCasesInSwitch` are on. There is one `any` (`Field.tsx:46`); no `@ts-ignore` or `@ts-expect-error`. `as CSSProperties` casts for custom properties are acceptable.

`skipLibCheck` is not justified in its current form, and a narrowly scoped fix is verified (M-01). Test and Node globals are visible to production source (M-02).

### Review 8 — Dependencies: CHANGES REQUIRED
| Package | Version | Required | Class | Verdict |
|---|---|---|---|---|
| react, react-dom | 19.3.0 | Yes | runtime | Accept |
| typescript | 7.0.2 | Yes | dev | Accept |
| vite, @vitejs/plugin-react | 8.3.0 / 6.1.1 | Yes | dev | Accept |
| vitest | 5.0.1 | Yes | dev | Accept, but requires a supported Node (H-06) |
| jsdom | 30.1.0 | Yes | dev | Accept, but requires a supported Node (H-06) |
| @testing-library/react | 16.3.3 | Yes | dev | Accept |
| @testing-library/user-event | 14.6.7 | Yes | dev | Accept (currently under-used: M-10) |
| axe-core | 4.13.0 | Yes | dev | Accept (MPL-2.0, dev only) |
| @types/react, @types/react-dom | 19.3.0 | Yes | dev | Accept |
| @testing-library/jest-dom | 7.0.1 | Optional | dev | Keep only with the M-01 fix, or drop |
| @types/node | 22.20.3 | **Not approved** | dev | Remove via `?raw`, or approve and align to the selected Node major (M-02) |

No duplicate functionality; no alternative library is recommended.

### Review 9 — CSS, tokens, RTL
All §6 tokens exist with the exact specified values. Logical properties are used throughout durable CSS; no physical directional declarations were found (the scan tool is narrow, M-11). The focus indicator is global and not suppressed by error styling. Forced colours cover buttons, fields, status, and focus (denied gap: L-06).

Raw values: M-03. Responsive failure: M-04/M-09. Contrast claims are numerically true but not enforced against the token file.

### Review 10 — Test quality
See H-05, M-10, M-11, L-08. What the suite does test meaningfully: Field associations, native element choice, the canonical-label table, "Not published", and Dialog accessible name and restoration via clicks. The 565 figure should be read as roughly 240 behavioral and semantic assertions.

### Review 11 — Validation
See §2. The reported results are reproducible, on an engine-excluded Node (H-06).

### Review 12 — Code quality and repository hygiene
No secrets, no machine-specific paths in source, and no giant or tangled modules. `Ui001Showcase.tsx` is 952 lines but disposable and linear. Generated artifacts would enter Git (B-01). Dead code and naming: L-05.

---

## 6. Deviation verdicts (from the implementation report)

| # | Claim | Verified? | Verdict |
|---|---|---|---|
| 1 | `@types/node` needed for fs/path in tests | Partly: needed only because tests read files through Node | **Reject as recorded.** Avoidable via `?raw`; if kept, approve, record, and align to the selected Node (M-02, H-06) |
| 2 | jest-dom 7.0.1 and Vitest 5 declarations incompatible → `skipLibCheck` | Incompatibility **real** (TS2428 ×3) | **Requires change.** A narrow `Matchers` augmentation compiles with `skipLibCheck: false` (M-01) |
| 3 | Disabled text at 3:1 per WCAG exemption | **True** (3.90:1; SC 1.4.3 exemption) | Accept (N-02) |
| 4 | axe treats placeholder as accessible name → negative test removed placeholder | **True** for axe | Explanation accepted; the change removed placeholder-only coverage (L-08) |

---

## 7. Required before UI001 can be committed and accepted

1. **B-01**: ignore `node_modules`, `dist`, `coverage`, `*.tsbuildinfo`.
2. **H-01 – H-06**: required identities, identity semantics, scenario fidelity, dialog `close` sync, showcase-level tests, recorded dependency and Node gate.
3. **M-01 – M-04** are strongly recommended in the same correction pass, because each maps to a failing or partial acceptance criterion (AC-02/03/04/05/16).

After corrections, re-run §2 (commands under the selected Node, plus the browser checks for 320px and repeated Escape), and have a reviewer other than the implementing session repeat this review.
