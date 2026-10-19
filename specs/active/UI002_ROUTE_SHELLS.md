# UI002 — Public, Application, and Editor Route Shells

Status: implementation-ready feature specification
Prepared: 2026-09-17
Milestone: RM01 Foundation
Gate contribution: G1 honest UI simulation
Implementation authorization: separate authorization is still required; this document does not initialize or install anything.

## 1. Purpose

UI002 gives Pageinator stable navigation and workspace context before any feature screen exists (R11/R38/R40). It defines the canonical route family from Phase 15, the three shells that frame every future screen — public, workspace, and editor — and the cross-cutting navigation behaviors (deep links, refresh, back/forward, not-found, invalid context) that every later unit inherits rather than re-solving. UI002 renders explicitly labeled placeholders at every route leaf it does not itself own; it implements no feature.

## 2. Architecture references

This specification is bounded by:

- `docs/MASTER_BUILD_SPEC.md` §5 ("Build accessible tokens/components, route shells, explicit mock service DTOs and resettable scenario adapters before feature screens").
- `docs/IMPLEMENTATION_ROADMAP.md` RM01.
- `specs/INITIAL_IMPLEMENTATION_BACKLOG.md` shared acceptance contract, UI002, and the UI003–UI027 entries whose routes UI002 reserves.
- `docs/architecture/PHASE_15_UI_FIRST.md` "Route and shell map" (the canonical illustrative route table) and "Fixtures, persistence and accessibility" (responsive behavior).
- `docs/architecture/PHASE_1_ANALYSIS.md` R11, R38, R40.
- `docs/reviews/ARCHITECTURE_RECONCILIATION_ROUND_1.md` §K backlog changeset (UI002 row: "Routes/shells/context/navigation patterns" durable, "Placeholder views and simulated capability rules" disposable; BLV2-02/S2 reserved edition-planning navigation seam; BLV2-07/S7 reserved workspace status surface), and §L blockers-before-UI-foundation points 3 and 5.
- `specs/active/UI001_UI_FOUNDATION.md` and the accepted `frontend/src/ui/**` implementation it produced (§1 of this document does not redesign UI001; §7 below lists exactly what UI002 reuses from it).

Relevant normalized requirements are R11, R38, and R40. UI002 does not close any authorization, persistence, editorial, or production-readiness decision.

## 3. Preconditions

- UI001 is implemented and accepted (`frontend/src/ui/**`, `frontend/src/ui/index.ts` export surface, `--pg-*` tokens, `PresentationState`/`StatusIndicator`).
- A router dependency has been through the adoption gate in §12 and is exactly pinned before implementation begins.
- Implementation authorization for UI002 specifically has been given; this document alone does not grant it.

## 4. In scope

- The canonical route table (§6): every path Phase 15 names, at the param structure and nesting this document fixes.
- Three shells — `PublicShell`, `WorkspaceShell`, `EditorShell` — and their chrome, landmarks, and keyboard behavior (§7).
- Deep link, refresh, and browser back/forward correctness for every route in §6.
- Not-found behavior for unmatched paths.
- Invalid-context behavior for well-formed but non-existent or cross-context IDs, with no record-leakage signal (§8).
- A reserved workspace status-surface seam (BLV2-07) and a reserved edition-planning navigation seam (BLV2-02, Section L point 5), both populated only with labeled placeholders.
- Responsive shell behavior: phone review layout vs. desktop editor layout (§10).
- A disposable UI002 fixture set (organizations, publications, editions) and a disposable placeholder-screen component used at every route UI002 does not itself own.

## 5. Explicit out of scope

UI002 must not include or scaffold:

- Any feature screen's real content: public marketing copy (UI005), authentication/session logic (UI004), onboarding steps (UI006), overview data (UI007), edition creation (UI008), newsroom/Content Desk (UI009–012), generation (UI014), the sample editor's actual interaction surface (UI015–018), preflight/export results (UI019–020), archive retrieval (UI021), team/settings/billing behavior (UI022–024), or the edition plan (UI027).
- Any mock service, DTO, or scenario adapter (UI003). UI002 does not call a service; its context data is static fixture literals owned by UI002 itself.
- Session, role, or capability state of any kind. There is no "denied" route in UI002 — that is UI004's access-context concept and requires a session UI002 does not have. UI002 has exactly two non-happy-path states: not-found and invalid-context.
- Production authentication, authorization, tenancy enforcement, or persistence.
- A production RBAC model or any implication that a fixture capability check is a security boundary.
- Canvas/editor engine, composition, geometry, PDF, preflight, or archive behavior.
- A global state-management library, a design-system library, a breadcrumb library, an analytics library, or any dependency beyond the router decided in §12.
- Deployment/hosting SPA-fallback configuration (a precondition, not a deliverable — see §3).

## 6. Canonical route table

All paths are illustrative in the same sense Phase 15 marks them illustrative — one consistent family, not a locked production URL contract. `:orgId`, `:pubId`, and `:editionId` are opaque path segments; UI002 does not parse or validate their format beyond string matching against its own fixture list (§8).

| # | Path | Shell | UI002 renders | Owning future unit |
|---|---|---|---|---|
| 1 | `/` | Public | Placeholder | UI005 |
| 2 | `/features` | Public | Placeholder | UI005 |
| 3 | `/pricing` | Public | Placeholder | UI005 |
| 4 | `/security` | Public | Placeholder | UI005 |
| 5 | `/contact` | Public | Placeholder | UI005 |
| 6 | `/login` | Public | Placeholder | UI004 |
| 7 | `/signup` | Public | Placeholder | UI004 |
| 8 | `/forgot-password` | Public | Placeholder | UI004 |
| 9 | `/verify` | Public | Placeholder | UI004 |
| 10 | `/onboarding` | Public (pre-context variant — see §7.1) | Placeholder | UI006 |
| 11 | `/org/:orgId/settings` | Workspace | Placeholder | UI022–024 |
| 12 | `/org/:orgId/billing` | Workspace | Placeholder | UI024 |
| 13 | `/org/:orgId/storage` | Workspace | Placeholder | UI023 |
| 14 | `/org/:orgId/pub/:pubId/overview` | Workspace | Placeholder | UI007 |
| 15 | `/org/:orgId/pub/:pubId/editions` | Workspace | Placeholder | UI008 |
| 16 | `/org/:orgId/pub/:pubId/stories` | Workspace | Placeholder | UI010–011 |
| 17 | `/org/:orgId/pub/:pubId/media` | Workspace | Placeholder | UI011 |
| 18 | `/org/:orgId/pub/:pubId/ads` | Workspace | Placeholder | UI012 |
| 19 | `/org/:orgId/pub/:pubId/templates` | Workspace | Placeholder | UI013 |
| 20 | `/org/:orgId/pub/:pubId/newsroom` | Workspace | Placeholder | UI009 |
| 21 | `/org/:orgId/pub/:pubId/sources` | Workspace | Placeholder | UI009–010 |
| 22 | `/org/:orgId/pub/:pubId/archive` | Workspace | Placeholder | UI021 |
| 23 | `/org/:orgId/pub/:pubId/archive/:releaseId` | Workspace | Placeholder | UI021 |
| 24 | `/org/:orgId/pub/:pubId/brand` | Workspace | Placeholder | UI013/022 |
| 25 | `/org/:orgId/pub/:pubId/print-profiles` | Workspace | Placeholder | UI013 |
| 26 | `/org/:orgId/pub/:pubId/team` | Workspace | Placeholder | UI022 |
| 27 | `/org/:orgId/pub/:pubId/editions/:editionId` | Workspace | Redirects to row 28 | UI008 |
| 28 | `/org/:orgId/pub/:pubId/editions/:editionId/content` | Workspace | Placeholder | UI010–012 |
| 29 | `/org/:orgId/pub/:pubId/editions/:editionId/generate` | Workspace | Placeholder | UI014 |
| 30 | `/org/:orgId/pub/:pubId/editions/:editionId/preflight` | Workspace | Placeholder | UI019 |
| 31 | `/org/:orgId/pub/:pubId/editions/:editionId/export` | Workspace | Placeholder | UI020 |
| 32 | `/org/:orgId/pub/:pubId/editions/:editionId/plan` | Workspace | Disabled nav entry only (§9.4); no route content required | UI027 (proposed) |
| 33 | `/org/:orgId/pub/:pubId/editions/:editionId/editor` | Editor | Placeholder | UI015–018 |
| — | Any unmatched path | Whichever shell can be determined, else Public | `NotFoundPage` | — |
| — | Well-formed but non-existent/cross-context `:orgId`/`:pubId`/`:editionId`/`:releaseId` | Workspace (using whatever prefix of the context did resolve) | `InvalidContextPage` | — |

Rows 27–32 are the edition workspace; row 33 is the only row rendered by `EditorShell` instead of `WorkspaceShell`. Row 32 exists only as a disabled navigation item per §9.4 — its route need not resolve to a distinct page if the implementer prefers to omit it entirely from the router and only render the disabled nav entry; either satisfies this spec.

### 6.1 Route exists vs. feature implemented

Every "Placeholder" cell in §6 renders `PlaceholderScreen` (§7.4): a labeled, non-interactive notice naming the surface and the unit that will implement it. A placeholder must never:

- render a fabricated list, count, or status value,
- present a disabled or fake-interactive control that looks operable,
- claim any data was loaded, saved, generated, or validated,
- omit the "not yet implemented" label to look more finished than it is.

## 7. Shell responsibilities

### 7.1 PublicShell

Wraps rows 1–10. Renders:

- `<header>` with product name (fictional/placeholder, not a real brand claim) and a top-level `<nav aria-label="Primary">` linking rows 1–5.
- A visible "Sign in" / "Sign up" affordance linking rows 6–7 (native `<a>`/router `Link`, not a button pretending to navigate).
- `<main>` containing the route's `PlaceholderScreen`.
- `<footer>` with a minimal fictional-product notice (not marketing copy — that is UI005).

`/onboarding` (row 10) uses `PublicShell` in a **pre-context variant**: the "Sign in"/"Sign up" affordance is omitted (the fictional user is mid-flow), everything else is identical. This is the only shell-variant rule in UI002; it does not require a fourth shell.

### 7.2 WorkspaceShell

Wraps rows 11–32. Renders:

- `<header>` containing: an organization switcher and a publication switcher (built from UI001's `Select` inside a `Field`, populated from the UI002 fixture list — §8), the reserved status-surface seam (§9.4), and a "Back to public site" link.
- A persistent contextual `<nav aria-label="Publication">` linking the publication-scoped rows (14–26) when a `:pubId` is resolved, and an org-scoped variant (rows 11–13) when only `:orgId` is resolved (e.g. org admin routes with no publication selected).
- `<nav aria-label="Breadcrumb">` (§7.5) above `<main>` for any route two or more segments below `/org/:orgId`.
- `<main>` containing the route's `PlaceholderScreen`, `InvalidContextPage`, or the edition sub-navigation (content/generate/preflight/export/plan tabs) when inside rows 27–32.
- Direction/locale: `WorkspaceShell` sets `dir`/`lang` on itself from the resolved publication fixture's `direction`/`locale` (§8) when a `:pubId` is resolved; otherwise `dir="ltr"`/`lang="en-IN"`.

### 7.3 EditorShell

Wraps row 33 only. Deliberately minimal — no persistent sidebar, no publication switcher:

- `<header>` with: edition identity (opaque label, e.g. "Edition `edition-demo-001`"), the reserved status-surface seam (§9.4), and an explicit "Exit editor" link back to row 28.
- `<main>` containing `PlaceholderScreen` (desktop) or the phone-review variant (§10.2).
- No breadcrumb trail — the "Exit editor" link is the only way back, consistent with Phase 15's "full composition is desktop-first" framing and with not implying a page navigator that does not exist yet.

### 7.4 PlaceholderScreen (shared, disposable)

One reusable component, not one file per route. Props: `title: string`, `owningUnit: string` (e.g. `"UI007"`), `description?: string`. Renders a heading (`title`), a `StatusIndicator` with `state="simulated"` and `subject={title}`, and a sentence of the form "This surface is not yet implemented. It will be built in {owningUnit}." `PlaceholderScreen` lives in the disposable layer (§16) because every future unit deletes its own call site.

### 7.5 Breadcrumbs

`WorkspaceShell` derives breadcrumb items from the resolved route context, not from a separately maintained list: Organization name → Publication name (when resolved) → the current section's human label → (Edition `id` → current tab, when inside rows 27–32). Each item except the last is a link. The organization and publication names come from the UI002 fixture list (§8), never from the raw ID.

### 7.6 Landmarks, keyboard, and focus (all shells)

- Exactly one `<h1>` per rendered page, set by the leaf screen (`PlaceholderScreen`'s `title`, or `NotFoundPage`/`InvalidContextPage`'s own heading).
- One `<main>` landmark per shell; a "Skip to main content" link (UI001 `VisuallyHidden`, visible on focus) is the first focusable element in every shell.
- Every `<nav>` has a distinguishing `aria-label` ("Primary", "Publication", "Breadcrumb").
- On every client-side route change, focus moves to the new page's `<h1>` (`tabIndex={-1}` + `.focus()`, the same pattern UI001's `Dialog` uses for its heading), and a `VisuallyHidden` `aria-live="polite"` region announces the new page's `title`. Initial page load is not announced (consistent with UI001 §5.1's initial-render rule).
- Tab order follows DOM order: skip link → global nav → contextual nav → breadcrumb → main content. No `tabindex` greater than 0 anywhere.
- All shells use UI001's `:focus-visible` styling and logical CSS properties; no shell hard-codes `dir="ltr"`.

## 8. Context and security semantics

UI002 fixtures live under `frontend/src/demo/ui002/fixtures.ts`, marked `fixtureKind: "ui002-demo-only"`, following the exact pattern UI001 established (`fixtureKind: "ui001-demo-only"`). They are never imported by `frontend/src/app/**` (durable shell code) — only by the disposable route-wiring module that assembles the app (§16).

Minimum fixture set (fictional, resettable, deterministic):

| Fixture | ID | Notes |
|---|---|---|
| Organization A | `org-demo-sahyadri` | "Sahyadri Media Cooperative" |
| Organization B | `org-demo-konkan` | "Konkan Coastal Press" — exists only to prove cross-org isolation |
| Publication A1 (org A) | `pub-demo-pune-daily` | "Pune Daily Ledger", `en-IN`, `ltr` |
| Publication A2 (org A) | `pub-demo-urdu-evening` | "Deccan Evening Record", `ur-IN`, `rtl` |
| Publication B1 (org B) | `pub-demo-ratnagiri-tide` | "Ratnagiri Tide", `en-IN`, `ltr` — exists only to prove cross-org isolation |
| Edition (pub A1) | `edition-demo-001` | opaque label only |
| Edition (pub B1) | `edition-demo-002` | opaque label only — exists only to prove cross-publication isolation |
| Archive release (pub A1) | `release-demo-001` | opaque label only |

These IDs establish scoped presentation context only. They are not tenant keys, API paths, database identifiers, or an authorization boundary, and this fact is stated in the same visible qualification pattern UI001 used for its own fixtures (a short caption on `WorkspaceShell`'s header, not a full disclaimer on every screen — the workspace is inherently fixture-scoped for the whole UI002 milestone).

### 8.1 Context resolution rules

For a route matching `/org/:orgId/pub/:pubId/...`:

1. If `:orgId` does not match a fixture organization, render `InvalidContextPage`.
2. Else if `:pubId` does not match a fixture publication **belonging to that organization**, render `InvalidContextPage` — using the identical component, props shape, and rendered text whether `:pubId` matches no publication at all or matches a publication that belongs to a *different* organization. The two cases must be indistinguishable in the rendered output and in any accessible name/announcement.
3. Else if the route also has `:editionId`/`:releaseId` and it does not match a fixture edition/release belonging to that publication, apply the same rule as step 2 at that level.
4. `InvalidContextPage` states only: the segment that failed to resolve, expressed generically ("This publication is not available in this organization" — never "no such ID" vs. "wrong organization" as distinguishable messages), and a link back to a valid entry point (`/org/:orgId/pub/:pubId/overview` if the organization did resolve, else `/`).
5. `InvalidContextPage` never lists, counts, or names any other organization's or publication's fixtures, and never varies its response time, DOM structure, or copy based on which failure case occurred.

### 8.2 Not-found vs. invalid-context

A path that matches no route pattern at all (e.g. `/org/x/pub/y/nonexistent-section`) is not-found (§6, unmatched-path row), not invalid-context — the distinction is: the *route shape* is unrecognized (not-found) vs. the *route shape matched but a param did not resolve* (invalid-context). Both states return an HTTP-equivalent "not found" posture (no route claims to exist that does not); UI002 does not implement server-side status codes, since it is a client-side SPA — the client-side render is sufficient for this milestone.

## 9. Navigation behavior

### 9.1 Deep links

Every row in §6 must be reachable by navigating directly to its URL (no prior in-app navigation), resolving to the same shell and content as reaching it by clicking through the app.

### 9.2 Refresh

A full page reload at any URL in §6 must resolve to the identical rendered state (shell, breadcrumb, placeholder title, or invalid-context/not-found state) as the original navigation. Because UI002 has no service layer, this is a pure function of the URL and the static fixture list — no loading state, no flash of different content, is acceptable for a fixture lookup this cheap.

### 9.3 Browser back/forward

Client-side navigations push history entries such that back/forward moves between exactly the URLs actually visited, in order, including moves between shells (e.g. Public → Workspace → Editor → back → Workspace). Focus and the live-region announcement (§7.6) fire on back/forward navigation exactly as on forward navigation.

### 9.4 Reserved seams

- **Status surface (BLV2-07):** `WorkspaceShell` and `EditorShell` headers each render one UI001 `StatusIndicator` with `state="simulated"`, `subject` naming the current edition when one is resolved (else the publication, else the organization), and `detail="Reserved workspace status surface — bound to real edition state in UI015–020."` This is the only `StatusIndicator` UI002 renders; it must never imply a real revision, proof, or approval exists.
- **Edition-planning nav seam (BLV2-02 / Section L point 5):** row 32's link in the edition sub-navigation is rendered as a UI001 `Button` with `denied` and a visible adjacent explanation ("Edition planning is not yet available — reserved for UI027."), using the exact same discoverable-but-not-activatable pattern UI001's `denied` prop already implements. This is not a capability check; the label must not imply one.

## 10. Responsive behavior

UI002 fixes two breakpoints, expressed as tokens the implementer adds to `frontend/src/ui/tokens.css` only if UI001 does not already define an equivalent (check first; do not duplicate):

- **Phone:** viewport inline size < 768px.
- **Desktop:** viewport inline size ≥ 768px. (No separate tablet behavior is required by this spec; the phone rule applies below 768px and the desktop rule at and above it. A future unit may add an intermediate breakpoint without touching UI002's contract.)

### 10.1 WorkspaceShell responsive rule

At phone width, the contextual `<nav aria-label="Publication">` collapses behind a disclosure control (a UI001 `IconButton` toggling a `<nav>` that becomes visible) rather than a persistent sidebar; the organization/publication switchers remain reachable from the same disclosure. Breadcrumbs remain visible (they are short, wrap acceptably, and are load-bearing for orientation). No horizontal page scrolling at 320 CSS pixels, matching UI001 §9's structural requirement.

### 10.2 EditorShell responsive rule — the testable phone-vs-desktop requirement

This is the backlog's explicit "phone review layout versus desktop editor layout" requirement, made concrete:

- At desktop width, row 33 renders `PlaceholderScreen` with `title="Editor"`, `owningUnit="UI015–018"` — i.e., the ordinary placeholder, framed to suggest a future editing surface will occupy this space.
- At phone width, row 33 renders a **distinct** component, `EditorPhoneReviewPlaceholder`, whose copy explicitly states: "Full editing requires a larger screen. This device shows edition review only." plus the same `StatusIndicator` status-surface seam from §9.4. It does not attempt to render, scale down, or simulate the desktop editor chrome.
- Both variants are reachable by the identical URL (row 33); only the rendered component differs by viewport. This is what makes the requirement testable: resize (or mock the viewport) at the same URL and assert the different `title`/copy is present, not a CSS-only reflow of identical markup.

### 10.3 PublicShell responsive rule

Standard responsive collapse of `<nav aria-label="Primary">` behind a disclosure control at phone width, same mechanism as §10.1. No content difference — Phase 15 does not require public-page content to differ by device for UI002's placeholder milestone.

## 11. Accessibility requirements

- Every shell passes `axe-core` with zero serious/critical violations, verified the same way UI001's correction pass verified StatusIndicator/Dialog: `axe.run()` in jsdom for structural checks, plus a real-browser check (documented, not necessarily automated in CI) for anything jsdom cannot establish — see UI001's own review (`docs/reviews/UI001_INDEPENDENT_CODE_REVIEW.md`) for why viewport/layout claims specifically need that second check.
- RTL: `WorkspaceShell` under `pub-demo-urdu-evening` context renders with `dir="rtl"`/`lang="ur-IN"`; breadcrumbs, nav labels, and the organization/publication switcher remain correctly associated and keyboard-operable in that mode (reuse UI001's `Field`/`Select` — do not reimplement).
- No physical-direction CSS (`margin-left`/`margin-right`/`left`/`right`/`border-left`/`border-right`) in any new shell stylesheet — same scan pattern as UI001's `tests/ui001/rtl.test.tsx`.
- Contrast: any new colour usage in shell chrome must consume existing UI001 `--pg-*` tokens only; no new raw colour values (this was UI001's own M-03 correction — do not reintroduce the pattern it fixed).

## 12. Dependency decision

UI002 genuinely needs a routing dependency. Building deep-link resolution, refresh-safe param parsing, nested layouts, and back/forward history management by hand would, in practice, mean writing a bespoke router — more code, less audited, and harder to keep correct than adopting a minimal, well-established one. The smallest-dependency-surface principle favors adoption here, not avoidance.

| Dependency | Proposed package | Class | Why |
|---|---|---|---|
| Client-side router | `react-router` (current major series compatible with React 19; do not pin a version in this document — see below) | Required runtime | Deep links, param-based nested routes, refresh-safe resolution, and history-based back/forward are all direct UI002 acceptance criteria (§6, §9). `react-router` is the de facto minimal standard for this in a Vite/React app and, as of its current major version, ships its own TypeScript types (no separate `@types/*` package expected). |

No other dependency is proposed. Do not add a state-management library (route params plus the static fixture list are sufficient state for UI002), a design-system library (UI001 already provides one), or a breadcrumb/menu component library (§7.5 breadcrumbs are derived from route data, not a separate package).

This document deliberately does not pin an exact patch version, matching the posture UI001 §12 took for its own dependencies: exact version, license (expect MIT), engine compatibility, provenance, and advisories must be reviewed and recorded — following the same adoption-gate process and the same `frontend/DEPENDENCIES.md` record UI001's correction pass established — **before installation**, as part of implementation, not as part of authoring this spec. Do not install it while implementing this document's Task 1 without completing that review first.

## 13. Implementation tasks

### Task 1 — Adopt the router dependency and initialize `frontend/src/app/`

- **Purpose:** Complete the §12 adoption gate, install the reviewed exact version, and scaffold the durable shell directory.
- **Expected files:** `frontend/package.json`/lockfile update, `frontend/DEPENDENCIES.md` update (append, do not rewrite UI001's entries), `frontend/src/app/` directory.
- **Dependencies:** §12 review complete; implementation authorization.
- **Completion condition:** Exact pin recorded; `npm run typecheck`/`test`/`build` still pass with the new dependency installed and unused.

### Task 2 — Route table and context-resolution contract

- **Purpose:** Encode §6's route table and §8's resolution rules as durable, typed code.
- **Expected files:** `frontend/src/app/routes.ts` (path constants/param types), `frontend/src/app/contracts/route-context.ts` (the `OrgContext`/`PublicationContext`/`EditionContext` resolution result types — durable types only, no fixture values).
- **Dependencies:** Task 1.
- **Completion condition:** Every §6 row has a named path constant; resolution types compile against the fixture shape defined in Task 4 without importing it.

### Task 3 — PublicShell, WorkspaceShell, EditorShell

- **Purpose:** Implement the three shells per §7.
- **Expected files:** `frontend/src/app/shells/PublicShell.tsx`, `WorkspaceShell.tsx`, `EditorShell.tsx`, `frontend/src/app/Breadcrumbs.tsx`, `frontend/src/app/RouteAnnouncer.tsx`.
- **Dependencies:** Task 2; UI001 `src/ui` components (Stack, Inline, Cluster, Container, Surface, Button, IconButton, Field, Select, StatusIndicator, VisuallyHidden).
- **Completion condition:** AC-08 through AC-16 pass.

### Task 4 — Disposable fixtures and PlaceholderScreen

- **Purpose:** Provide the §8 fixture set and the shared placeholder pattern.
- **Expected files:** `frontend/src/demo/ui002/fixtures.ts`, `frontend/src/demo/ui002/PlaceholderScreen.tsx`, `frontend/src/demo/ui002/EditorPhoneReviewPlaceholder.tsx`.
- **Dependencies:** Task 1.
- **Completion condition:** Fixture set matches §8's table exactly; `fixtureKind: "ui002-demo-only"` present on every fixture object.

### Task 5 — NotFoundPage and InvalidContextPage

- **Purpose:** Implement the two non-happy-path states per §8.2 and §8.1.
- **Expected files:** `frontend/src/app/NotFoundPage.tsx`, `frontend/src/app/InvalidContextPage.tsx`.
- **Dependencies:** Task 2.
- **Completion condition:** AC-19 through AC-22 pass, including the identical-response requirement in §8.1 rule 2.

### Task 6 — Route tree assembly

- **Purpose:** Wire §6's full route table using the Task 1 router, the Task 3 shells, and the Task 4/5 leaves.
- **Expected files:** `frontend/src/demo/ui002/routeTree.tsx` (disposable — it references fixture IDs and placeholder components), `frontend/src/main.tsx` update.
- **Dependencies:** Tasks 2–5.
- **Completion condition:** Every §6 row resolves via deep link (§9.1); `main.tsx` mounts the assembled tree.

### Task 7 — Reserved seams

- **Purpose:** Implement §9.4's status-surface and edition-planning seams.
- **Dependencies:** Task 3, Task 6.
- **Completion condition:** AC-23, AC-24 pass.

### Task 8 — Responsive behavior

- **Purpose:** Implement §10's phone/desktop rules, including the distinct `EditorPhoneReviewPlaceholder`.
- **Dependencies:** Tasks 3, 4, 6.
- **Completion condition:** AC-25 through AC-28 pass.

### Task 9 — Accessibility and keyboard verification

- **Purpose:** Verify §7.6 and §11 across the assembled route tree, following the same jsdom-plus-real-browser split UI001's correction pass established for anything jsdom cannot measure (layout/viewport).
- **Expected files:** `frontend/tests/ui002/accessibility.test.tsx`, `frontend/tests/ui002/keyboard.test.tsx`.
- **Dependencies:** Tasks 3–8.
- **Completion condition:** AC-14 through AC-18, AC-29 pass.

### Task 10 — Boundary enforcement and final verification

- **Purpose:** Prove `frontend/src/app/**` never imports `frontend/src/demo/**`, mirroring UI001's `boundary.test.ts`.
- **Expected files:** `frontend/tests/ui002/boundary.test.ts`.
- **Dependencies:** Tasks 1–9.
- **Completion condition:** All acceptance criteria in §15 pass; `npm run typecheck`, `npm test -- --run`, `npm run build` all succeed.

Implementation tasks: **10**.

## 14. Test requirements

Tests must be meaningful, behavioral checks — not generated per-route assertion loops that cannot fail. Prefer table-driven tests over §6's route list only where the assertion genuinely differs per row (e.g. shell selection); a single parameterized deep-link test covering all 33 rows is acceptable and preferred to 33 near-duplicate `it()` blocks.

| Area | Required tests |
|---|---|
| Route resolution | Deep link to each of the three shells resolves the correct shell component (one assertion per shell family, table-driven across §6, not one test per row). Row 27 redirects to row 28. |
| Refresh | Simulated reload (re-mount the router at a given URL, no prior navigation) at a public route, a workspace route with full org/pub/edition context, and the editor route all resolve identically to a fresh deep link. |
| Back/forward | A sequence Public → Workspace → Editor → back → back produces the exact three prior URLs in reverse, with `WorkspaceShell` state (org/pub) intact on the second `back`. |
| Not-found | An unmatched path renders `NotFoundPage`; verify it is `NotFoundPage` specifically, not `InvalidContextPage`. |
| Malformed/invalid IDs | `:orgId` non-existent → `InvalidContextPage`. `:pubId` non-existent under a valid `:orgId` → `InvalidContextPage`. `:pubId` valid but under a *different* organization than `:orgId` → `InvalidContextPage`. |
| No record leakage | The two `:pubId` failure cases above (non-existent vs. wrong-organization) produce byte-identical rendered text and identical DOM structure in `InvalidContextPage` — assert equality between the two renders, not just "no violation." Same test repeated one level down for `:editionId`. |
| Keyboard navigation | Skip link is the first Tab stop in each shell and moves focus to `<main>`. Tab order through `WorkspaceShell` matches §7.6. Organization/publication switchers are operable via keyboard only (no mouse-only interaction). |
| Focus after navigation | Client-side navigation between two §6 routes moves focus to the new page's `<h1>`; verify `document.activeElement` and that the live region (§7.6) received the new title. Verify the *initial* page load does **not** trigger the live-region announcement. |
| Shell selection | Table-driven: for a representative sample covering all three shells (at least one public, one org-admin workspace, one publication-scoped workspace, one edition-workspace, the editor route, not-found, and invalid-context), assert the rendered shell's identifying landmark structure. |
| Phone vs. desktop editor | At the row-33 URL, mock/set a phone-width viewport and assert `EditorPhoneReviewPlaceholder`'s copy is present and the desktop placeholder's is not; repeat at desktop width and assert the reverse. This must fail if someone reverts to rendering the same component at both widths. |
| Desktop editor | At desktop width, row 33 renders `PlaceholderScreen` with `owningUnit="UI015–018"` and no editing affordance (no button claims to edit, move, or save anything). |
| RTL | `WorkspaceShell` under `pub-demo-urdu-evening` sets `dir="rtl"`/`lang="ur-IN"`; breadcrumb and switcher labels remain correctly associated (reuse UI001's RTL test patterns; do not duplicate its logical-CSS-property scan — extend it to any new shell stylesheet instead). |
| Accessibility/landmarks | `axe-core` zero serious/critical on each shell (one representative route per shell) and on `NotFoundPage`/`InvalidContextPage`. One `<h1>` per rendered route. Every `<nav>` has a distinct `aria-label`. |
| Reserved seams | Status-surface `StatusIndicator` renders with `state="simulated"` and the exact §9.4 detail text on both `WorkspaceShell` and `EditorShell`. The edition-plan nav item is `aria-disabled="true"`, discoverable, and does not navigate on click or Enter/Space (reuse UI001's `Button` `denied` tests directly; do not reinvent them). |
| Boundary | `frontend/src/app/**` has zero imports matching `/demo/`, `/service/`, `/services/`, `/routing/`\* , `/storage/`, `/auth/`, `/editor/`, `/canvas/`, `/composition/`, `/publishing/` — same pattern as UI001's `boundary.test.ts`, adapted to the `src/app` root. (\*"routing" here means a future service-routing concept, not the router dependency itself, which durable shell code legitimately imports.) |

## 15. Acceptance criteria

UI002 passes only if all criteria below pass.

1. **AC-01:** Every row in §6's route table is reachable by direct deep link and resolves to the shell and content specified in that row.
2. **AC-02:** A full reload at any §6 URL resolves identically to a fresh deep link to the same URL.
3. **AC-03:** Browser back/forward through a multi-shell navigation sequence produces exactly the URLs visited, in order.
4. **AC-04:** Row 27 (`.../editions/:editionId`) resolves to row 28's content without a visible intermediate blank state.
5. **AC-05:** An unmatched path renders `NotFoundPage` and only `NotFoundPage`.
6. **AC-06:** A non-existent `:orgId` renders `InvalidContextPage`.
7. **AC-07:** A non-existent or cross-organization `:pubId` renders `InvalidContextPage` with output byte-identical to the non-existent case (§8.1 rule 2), for both the non-existent and the wrong-organization inputs.
8. **AC-08:** A non-existent or cross-publication `:editionId`/`:releaseId` renders `InvalidContextPage` with the same non-distinguishable-cause property as AC-07.
9. **AC-09:** `InvalidContextPage` never renders any other organization's or publication's name, ID, or count.
10. **AC-10:** `PublicShell` renders exactly the landmarks and nav specified in §7.1, including the pre-context variant at `/onboarding`.
11. **AC-11:** `WorkspaceShell` renders the organization switcher, publication switcher, contextual nav, breadcrumb, and status-surface seam specified in §7.2.
12. **AC-12:** `EditorShell` renders no persistent sidebar and no publication switcher.
13. **AC-13:** Every placeholder screen names its owning future unit and contains no fabricated data, count, or status.
14. **AC-14:** Exactly one `<h1>` exists per rendered route.
15. **AC-15:** A "Skip to main content" link is the first focusable element in every shell and moves focus into `<main>` when activated.
16. **AC-16:** Client-side navigation moves focus to the new page's `<h1>` and announces its title via a polite live region; the initial page load does not announce.
17. **AC-17:** No shell stylesheet contains a physical-direction CSS property.
18. **AC-18:** `WorkspaceShell` sets `dir="rtl"`/`lang="ur-IN"` when the resolved publication is `pub-demo-urdu-evening`, and `dir="ltr"` otherwise.
19. **AC-19:** Every shell and both non-happy-path pages pass `axe-core` with zero serious/critical violations.
20. **AC-20:** `frontend/src/app/**` contains zero imports from `frontend/src/demo/**` or any forbidden module pattern listed in §14's boundary row.
21. **AC-21:** All §8 fixtures declare `fixtureKind: "ui002-demo-only"`.
22. **AC-22:** `NotFoundPage` and `InvalidContextPage` are distinct components and are never substituted for each other.
23. **AC-23:** The status-surface seam renders on both `WorkspaceShell` and `EditorShell` using UI001's `StatusIndicator` with `state="simulated"` and the exact detail text from §9.4.
24. **AC-24:** The edition-planning nav entry is discoverable (`aria-disabled="true"`, not `disabled`), does not navigate on click or Enter/Space, and references a visible explanation, using UI001's `Button` `denied` behavior unmodified.
25. **AC-25:** At viewport widths ≥ 768px, row 33 renders `PlaceholderScreen`; at widths < 768px, it renders `EditorPhoneReviewPlaceholder`; both are the same URL.
26. **AC-26:** `EditorPhoneReviewPlaceholder` contains no attempt to render, scale, or simulate desktop editor chrome.
27. **AC-27:** At phone width, `WorkspaceShell`'s contextual nav is reachable via a disclosure control and the page has no horizontal scroll at 320 CSS pixels.
28. **AC-28:** No shell (public, workspace, or editor) has a horizontal-scroll requirement at 320 CSS pixels in any documented viewport check.
29. **AC-29:** Tab order in `WorkspaceShell` follows: skip link → global/contextual nav → breadcrumb → main content, with no positive `tabindex` anywhere in any shell.
30. **AC-30:** No route, placeholder, or shell implements, calls, or references authentication, authorization enforcement, a service adapter, or persistence of any kind.
31. **AC-31:** Required verification commands (`npm run typecheck`, `npm test -- --run`, `npm run build`) all exit successfully with the router dependency installed at its reviewed exact version.

Acceptance criteria count: **31**.

## 16. Files/domain boundaries

```text
frontend/
  src/
    app/                              # durable — routes/shells/context patterns
      routes.ts
      contracts/
        route-context.ts
      shells/
        PublicShell.tsx
        WorkspaceShell.tsx
        EditorShell.tsx
      Breadcrumbs.tsx
      RouteAnnouncer.tsx
      NotFoundPage.tsx
      InvalidContextPage.tsx
    demo/
      ui002/                          # disposable — fixtures, placeholders, route wiring
        fixtures.ts
        PlaceholderScreen.tsx
        EditorPhoneReviewPlaceholder.tsx
        routeTree.tsx
    main.tsx                          # updated to mount the UI002 route tree
  tests/
    ui002/
      route-resolution.test.tsx
      keyboard.test.tsx
      accessibility.test.tsx
      responsive.test.tsx
      boundary.test.ts
```

`frontend/src/app/**` is durable: its route/shell/context patterns are intended to survive later feature units, exactly as `frontend/src/ui/**` survives them. `frontend/src/demo/ui002/**` is disposable: its fixtures, placeholder components, and route-tree wiring are replaced incrementally as UI004–UI027 land, each deleting its own placeholder call site and wiring real content into the *same* durable route defined in `frontend/src/app/routes.ts`. A reviewer must be able to remove `frontend/src/demo/ui002/**` and still have `frontend/src/app/**` typecheck and its own unit tests (route-context contract, shell rendering with injected props) pass, mirroring UI001's AC-30 removal-simulation property.

## 17. Prohibited shortcuts

- Do not render feature content "for realism" in any placeholder — a placeholder that looks finished is worse than one that looks unfinished.
- Do not implement a denied/permission-based route state; that concept does not exist without UI004's session.
- Do not call `fetch`, a mock service, or any UI003 concept that does not yet exist.
- Do not distinguish "record does not exist" from "record exists in a different context" in any user-visible or timing-observable way.
- Do not add a state-management, breadcrumb, icon, or design-system library beyond the router decided in §12.
- Do not reimplement a UI001 control (`Button`'s `denied` behavior, `Field`/`Select` association, `StatusIndicator`'s canonical labels) — import and use it.
- Do not invent a fourth shell or a permission-varying shell; exactly three shells, with `/onboarding`'s pre-context variant as the only documented exception.
- Do not pin or install the router dependency as part of authoring or reviewing this specification.
- Do not treat this document as authorizing implementation of any unit other than UI002.

## 18. Completion checklist

- [ ] Router dependency adoption-gate record appended to `frontend/DEPENDENCIES.md` with exact version, license, and advisories.
- [ ] All 33 §6 rows implemented and deep-linkable.
- [ ] `PublicShell`, `WorkspaceShell`, `EditorShell` implemented per §7.
- [ ] `NotFoundPage` and `InvalidContextPage` implemented per §8, with the no-leakage property verified by an equality test, not inspection alone.
- [ ] Status-surface and edition-planning seams implemented per §9.4.
- [ ] Phone-vs-desktop editor distinction implemented and tested per §10.2.
- [ ] All 31 acceptance criteria in §15 pass.
- [ ] `npm run typecheck`, `npm test -- --run`, `npm run build` all succeed.
- [ ] `frontend/src/demo/ui002/**` removal simulation confirmed (§16).
- [ ] No file outside `frontend/` touched; no commit or push performed by the implementing session without separate instruction.
