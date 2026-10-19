# UI005 — Truthful Public Product Journey

Status: implementation-ready feature specification
Prepared: 2026-09-18
Milestone: RM02 UI-first product
Gate contribution: G1 honest UI simulation
Implementation authorization: separate authorization is still required; this document does not initialize, install, or build anything.

## 1. Purpose

UI005 replaces the five public placeholder routes with the real public product journey: a landing surface, a features surface, a pricing surface, a security surface, and a contact surface (R01/R39). Its job is to explain what Pageinator is for — the connected newspaper production workflow from discovery to archive — and to lead a reader into the labeled demonstration that UI002/UI003/UI004 already built.

UI005 is the first surface in this repository whose primary output is *persuasion*, and therefore the first that can lie. Every other unit's failure mode is a bug; UI005's failure mode is a false claim. The whole specification below is organized around that asymmetry: what may be said, how it must be qualified, and how a reviewer proves in a real browser that nothing on these five pages implies a capability, a customer, a certification, or a price that does not exist.

UI005 implements no product capability. It adds no service, no session concept, no persistence, and no dependency.

## 2. Architecture references

This specification is bounded by:

- `docs/MASTER_BUILD_SPEC.md` §5 (the UI-first product scope, the fixture honesty rules, and the "Do not freeze production engine schemas through UI mocks" constraint) and its workflow sentence: "discover/import → select and prepare content → generate an editable edition → professionally edit in the browser → deterministically validate → inspect final PDF → approve/release → hand off to press → retain and retrieve the exact publication. … customer economics and time savings remain unvalidated."
- `docs/MASTER_BUILD_SPEC.md` non-goals: "a generic dashboard, unrestricted web republication, truth oracle, full InDesign clone, ad-sales CRM or automatic printing-press control. Manual press handoff is a valid pilot proposal. Real-time shared editing and permanent archive retention are not assumed."
- `docs/IMPLEMENTATION_ROADMAP.md` RM02 ("Landing/auth/onboarding → …; recorded workflow feedback, **no production claims**") and RM04–RM11/RM17, which establish that typography, layout, PDF, preflight, and press fidelity are unbuilt and unqualified.
- `specs/INITIAL_IMPLEMENTATION_BACKLOG.md`, UI005 entry (reproduced verbatim in §4) and the shared acceptance contract.
- `docs/architecture/PHASE_15_UI_FIRST.md` "Route and shell map" row: "| Public site | `/`, `/features`, `/pricing`, `/security`, `/contact` | Understand product and enter demo/signup; **no invented certifications or binding pricing** |".
- `docs/architecture/PHASE_1_ANALYSIS.md` R01 (newspaper/media B2B production OS), R02 (subscription business whose "packaging, buyer and price [are] unvalidated"), R03 (browser-first), R38–R40, and R39's constraint "Pricing/security claims must be truthful and provisional".
- `docs/architecture/DECISION_REGISTER.md` D10 ("Immediate build is a labeled UI simulation with coherent fixtures and service boundaries … No live publishing/backend/AI/payment capability in initial backlog") and open item OP09 ("Paying buyer, packaging and account closure/access policy") — the reason §16 exists in the form it does.
- `specs/active/UI001_UI_FOUNDATION.md` and the accepted `frontend/src/ui/**` implementation: the `--pg-*` token system, the 35-symbol export surface, the logical-CSS rule, and the `PresentationState` vocabulary.
- `specs/active/UI002_ROUTE_SHELLS.md` §6 (canonical route table, rows 1–5), §7.1 (`PublicShell`), §7.6 (landmarks/keyboard/focus), §10.3 (public nav collapse), §11 (accessibility).
- `specs/active/UI003_SCOPED_MOCK_SERVICES.md` §7 (canonical seed) and §14 (adapter/import boundaries).
- `specs/active/UI004_SIMULATED_SESSION_ACCESS.md` §12 (route integration matrix, cases 1–2) and §12.1 (auth-route behavior), which already own `/login`, `/signup`, `/verify`, `/forgot-password`.

Relevant normalized requirements are **R01** and **R39**. UI005 closes no open decision — in particular it does not close OP09, and §16 is written so that closing OP09 later requires editing one content module, not redesigning a page.

## 3. Preconditions and current baseline

UI005 begins from an accepted, working baseline. The implementer must not re-derive it.

| Already implemented | Where | UI005 relationship |
|---|---|---|
| `--pg-*` token system, 35 exported primitives | `frontend/src/ui/**` | Reused. UI005 adds the seven tokens in §10 and no primitive. |
| `PublicShell` with brand link, `CollapsibleNav aria-label="Primary"`, skip link, `<main id="pg-main" tabIndex={-1}>`, footer simulation notice | `frontend/src/app/shells/PublicShell.tsx` | Reused unchanged except the two edits enumerated in §20.4. |
| Session-aware header (`SignedInSessionControls` when ready; Sign in / Sign up links otherwise) | `PublicShell.tsx`, `frontend/src/features/auth/SessionStatus.tsx` | Reused unchanged. UI005 must not duplicate it in page content. |
| Canonical routes and path builders | `frontend/src/app/routes.ts` (`PATTERNS`, `paths`, `ROUTE_LABELS`, `OWNING_UNIT`, `ROUTE_HEADING_ID`, `MAIN_LANDMARK_ID`) | Reused. UI005 adds no path and renames no label. |
| Focus + polite announcement on navigation | `frontend/src/app/RouteAnnouncer.tsx` | Reused. UI005 leaves focus management alone; it only guarantees each page has one `<h1 id={ROUTE_HEADING_ID} tabIndex={-1}>`. |
| Five public placeholders | `frontend/src/demo/ui004/routeTree.tsx` — `placeholder("home" \| "features" \| "pricing" \| "security" \| "contact")` | **Replaced by UI005.** These are the only five call sites UI005 removes. |
| Auth surfaces | `frontend/src/features/auth/AuthRouteScreen.tsx` | Untouched. UI005 links to them; it never re-implements them. |
| Nav collapse below 768px | `frontend/src/app/shell.css` `@media (max-width: 767px)` | Reused. UI005 adds no second navigation mechanism (§21.4). |

Implementation authorization for UI005 specifically has been given separately; this document alone does not grant it.

## 4. Backlog requirement mapping

The UI005 backlog entry reads, verbatim:

> ### UI005 — Truthful public product journey
> Purpose: explain the newspaper workflow and lead into the demo (R01/R39).
> Dependencies: UI002/UI004.
> Expected file/domain area: `frontend/features/public/`.
> Acceptance criteria: landing/features/pricing/security/contact surfaces with coherent CTAs; pricing marked illustrative; no invented customers, certifications or press-ready claims; contact is non-sending demo behavior.
> Test expectations: CTA destinations, keyboard and small-screen reading order, absence of live form submission.
> Out of scope: marketing analytics, payment signup, real contact delivery.

Every clause is normative. Nothing below expands it.

### 4.1 Purpose clauses

| ID | Exact clause | UI005 resolution | Acceptance criteria |
|---|---|---|---|
| BR-00a | "explain the newspaper workflow" | §13 defines a seven-stage workflow story sourced sentence-by-sentence from `MASTER_BUILD_SPEC.md` §5, rendered on `/` in condensed form and on `/features` in full. | AC-05, AC-06, AC-07 |
| BR-00b | "lead into the demo (R01/R39)" | §20.1 defines one primary CTA whose destination is session-derived; every surface repeats it exactly once in a closing band. | AC-16, AC-17, AC-18 |

### 4.2 Acceptance clauses

| ID | Exact clause | UI005 resolution | Acceptance criteria |
|---|---|---|---|
| BR-01 | "landing/features/pricing/security/contact surfaces" | §11 maps the five routes; §12 and §15–§18 specify each surface's composition. No sixth public route is added. | AC-01, AC-02, AC-03 |
| BR-02 | "with coherent CTAs" | §20.1–§20.3: exactly one primary CTA label/destination pair across all five surfaces, one secondary CTA vocabulary, and a declared table of every link a public page may emit. | AC-16 – AC-21 |
| BR-03 | "pricing marked illustrative" | §16: every tier carries a visible illustrative qualification, no currency amount is presented as purchasable, no "per seat / per month" commitment is implied, and OP09's open status is stated on the page. | AC-22 – AC-27 |
| BR-04 | "no invented customers" | §19.2 forbids named organizations, logos, testimonials, quotes, case studies, counts of users/publishers/editions, and "trusted by" constructions. §19.4 makes this a scanned, automated check over the content module. | AC-28, AC-29, AC-36 |
| BR-05 | "no invented … certifications" | §17: no SOC 2, ISO 27001, GDPR-compliant, HIPAA, PCI, pen-test, audit, or certification claim of any kind; the security surface describes *architectural intent and current limits*, not attestations. | AC-30, AC-31, AC-32 |
| BR-06 | "no invented … press-ready claims" | §19.3: a forbidden-claim vocabulary covering press-ready, print-ready, production-ready, certified, guaranteed, deterministic-output, and fidelity assertions; every workflow stage carries an availability label from §13.2 instead. | AC-33, AC-34, AC-35 |
| BR-07 | "contact is non-sending demo behavior" | §18: a real, accessible form with no `action`, no `method`, no `mailto:`, no network call; submission renders a local acknowledgement that states nothing was sent and no address was retained. | AC-38 – AC-43 |

### 4.3 Test expectation clauses

| ID | Exact clause | Required coverage |
|---|---|---|
| BR-T1 | "CTA destinations" | §28 "CTA destinations" row: every CTA on every surface asserted by resolved `href`, in both signed-out and signed-in session states. |
| BR-T2 | "keyboard and small-screen reading order" | §28 "Reading order" and "Keyboard" rows, plus the real-browser scenarios RB-03, RB-04, RB-06 in §24 (jsdom cannot establish visual order). |
| BR-T3 | "absence of live form submission" | §28 "No submission" row: `fetch`/`XMLHttpRequest`/`navigator.sendBeacon`/`WebSocket`/`HTMLFormElement.prototype.submit` spies, plus a static scan for `action=`, `method=`, and `mailto:` in `frontend/src/features/public/**`. |

### 4.4 Out-of-scope clauses

| ID | Exact clause | Enforcement |
|---|---|---|
| BR-X1 | "marketing analytics" | §6, §30; static scan for analytics/telemetry identifiers in `frontend/src/features/public/**`. |
| BR-X2 | "payment signup" | §6, §16; no checkout, plan-selection, card, currency-entry, or "Buy"/"Subscribe"/"Start trial" control. |
| BR-X3 | "real contact delivery" | §6, §18; enforced by BR-T3's spies and scan. |

Backlog purpose clauses mapped: **2/2**. Backlog acceptance clauses mapped: **7/7**. Backlog test expectations mapped: **3/3**. Backlog out-of-scope clauses mapped: **3/3**. **Total backlog requirements mapped: 15/15.**

## 5. In scope

- Real content for the five public routes `/`, `/features`, `/pricing`, `/security`, `/contact` (§11).
- A durable public content model (§19.1) that holds every user-visible sentence as data, so claim governance is scannable rather than a review habit.
- The seven-stage workflow story and its availability vocabulary (§13).
- A non-fabricated product preview: a structural page-geometry illustration drawn from static geometry, with no story text, no counts, and no implied render output (§14).
- Pricing presented as an illustrative packaging hypothesis with OP09 stated as open (§16).
- A security surface describing architectural intent, scope boundaries, and current limitations — with an explicit "what is not true today" block (§17).
- A non-sending contact form using UI001 `Field`/`TextInput`/`TextArea`/`Button`/`InlineMessage` (§18).
- One primary CTA whose destination is derived from UI004 session state (§20.1).
- A public stylesheet, `frontend/src/features/public/public.css`, using only `--pg-*` tokens and logical properties (§9, §10).
- Seven token additions to `frontend/src/ui/tokens.css` (§10.2) — the only file outside `frontend/src/features/public/**` and the route tree that UI005 modifies, besides the two `PublicShell` edits in §20.4.
- Responsive behavior at five named widths, RTL correctness, accessibility, and an asset budget (§21, §22).
- Visual acceptance testing with 14 named screenshot scenarios and 8 real-browser scenarios (§23, §24).

## 6. Explicit out of scope

UI005 must not include, scaffold, or imply:

- **Marketing analytics, telemetry, tag managers, pixels, cookie banners, consent managers, or any third-party script.** No `<script src>` to any origin. No `navigator.sendBeacon`. No `performance` reporting to anywhere.
- **Payment signup**: no checkout, cart, plan-selection state, currency input, card field, billing address, tax field, "Buy", "Subscribe", "Start free trial", "Contact sales for a quote", or any control that begins a commercial transaction.
- **Real contact delivery**: no email transport, no `mailto:`, no form `action`, no CRM, no ticketing integration, no address the reader could believe is monitored.
- Authentication, session, or account logic. UI005 reads UI004 session state to choose a CTA destination; it never mutates it, never calls `signIn`/`signOut`, and never renders a credential-like field.
- Any new route, including `/about`, `/docs`, `/blog`, `/careers`, `/legal`, `/terms`, `/privacy`, `/status`, or a sitemap. Five routes, exactly.
- Any workspace, editor, newsroom, generation, preflight, export, or archive capability, or any surface that renders one.
- Any service call. `frontend/src/features/public/**` imports nothing from `frontend/src/services/**`, `frontend/src/mocks/**`, or `frontend/src/demo/**`.
- A second design system, a component library, an icon package, an animation library, a CSS framework, a headless-UI package, a Markdown/MDX pipeline, or an i18n runtime.
- Screenshots, mockups, or renderings of the workspace, the editor, or a composed newspaper page (§14 defines what is permitted instead).
- A search box, a language switcher, a theme switcher, a newsletter signup, a chat widget, a testimonial carousel, a logo wall, or a statistics counter.
- Server-side rendering, prerendering, meta/OpenGraph/JSON-LD structured data, `robots.txt`, or sitemap generation.
- Any change to `frontend/src/app/shells/WorkspaceShell.tsx`, `EditorShell.tsx`, `Breadcrumbs.tsx`, `RouteAnnouncer.tsx`, `SkipLink.tsx`, `CollapsibleNav.tsx`, `NotFoundPage.tsx`, `InvalidContextPage.tsx`, `StatusSurface.tsx`, or `routes.ts`.

## 7. Product positioning and truthfulness constraints

### 7.1 What Pageinator is

Pageinator is a **production system for professional newspaper and media organizations** (R01): one connected workflow from source discovery through an editable edition, browser editing, deterministic validation, press handoff, and immutable archive retrieval. Its intended buyer is a publisher, not an individual writer. Its intended unit of work is an edition, not a document.

### 7.2 What Pageinator is not

Reproduced from `MASTER_BUILD_SPEC.md` non-goals and normative for §19's copy: Pageinator is **not** a generic dashboard, **not** unrestricted web republication, **not** a truth oracle, **not** a full InDesign clone, **not** an ad-sales CRM, and **not** automatic printing-press control. Real-time shared editing is not assumed. Permanent archive retention is not assumed.

### 7.3 What exists today

Per D10, the current build is a **labeled UI simulation**. Concretely, and this is the only list of working capability a public page may present:

1. A fictional sign-in that selects one of two demonstration profiles. No credentials are requested and no account is created.
2. Scoped navigation across two fictional organizations and three fictional publications, including an RTL publication.
3. A workspace route family in which every feature surface is an explicitly labeled "not yet implemented" placeholder naming the unit that will build it.

No content is ingested. No edition is generated. No page is composed. No PDF is produced. No file is validated. Nothing is archived. No payment is possible.

### 7.4 The three truthfulness rules

Every sentence UI005 renders must satisfy all three:

1. **Sourced.** Its claim traces to `MASTER_BUILD_SPEC.md`, `PHASE_1_ANALYSIS.md`, `PHASE_15_UI_FIRST.md`, `IMPLEMENTATION_ROADMAP.md`, or `DECISION_REGISTER.md`. §19.1 requires each content record to carry that trace as a field.
2. **Tensed.** A capability that does not exist is never described in the present indicative. The workflow story uses "is being built to" / "will" / an explicit availability label (§13.2) — never "Pageinator ingests", "Pageinator validates", "Pageinator exports".
3. **Bounded.** A claim that is provisional says so on the same surface, adjacent to the claim, not in a footer disclaimer. Pricing says it is illustrative next to the pricing. Security says what is not true today in the security section, not in small print.

### 7.5 Tone

Direct, specific, and unexcited. The reader is a production editor or a publisher who has been sold software before. Specificity is the persuasion: "Discovery-only items cannot be imported as licensed full text" earns more trust than "powerful rights management". Superlatives, urgency, and manufactured scarcity are forbidden (§19.3).

## 8. Design quality bar

UI005 must read as an intentional B2B product site made by people who understand newspaper production.

### 8.1 Avoid

- Generic startup-template composition: centered hero + three identical icon cards + logo wall + testimonial + pricing table + oversized footer.
- Neon/AI-product aesthetics: gradient meshes, purple-to-cyan washes, glowing borders, animated blobs, particle fields, "shimmer" text.
- Glassmorphism, heavy blur, frosted panels, neumorphic shadows, or any treatment that lowers text contrast for effect.
- Fake analytics: dashboards, sparklines, gauges, progress rings, counters, charts, or any number presented as a measurement.
- Stock photography of newsrooms, laptops, handshakes, or people.
- Emoji as interface iconography. Decorative icon sets used as content substitutes.
- Parallax, scroll-jacking, reveal-on-scroll animation chains, auto-playing carousels, or motion that is not a direct response to a user action.
- Marketing intensifiers: "revolutionary", "seamless", "effortless", "AI-powered", "next-generation", "world-class", "trusted by", "10x", "unlock", "supercharge".
- Rounded-pill everything, oversized border radii, and card shadows applied uniformly to create false depth.

### 8.2 Prefer

- **Editorial typography as the primary design device.** A serif display face (OS stack, §10.2) for headlines against UI001's sans for interface and body text is the single strongest signal that this product belongs to publishing rather than to generic SaaS.
- **A disciplined grid.** One content measure (`--pg-content-measure`), a small set of column spans, and consistent vertical rhythm from the space scale. Asymmetry earned by content weight, not by decoration.
- **Newspaper composition used structurally, not as costume.** A rule line above a section label; a strong hierarchy between a lead item and secondary items; a multi-column measure on long prose; a standing-head treatment for section labels. Never a fake masthead, fake dateline, fake bylines, or fake headlines about real events.
- **Restraint in colour.** UI001's existing palette only. The dark band uses `--pg-color-text` as a surface, exactly as `shell.css` already does for the editor header — a reused idea, not a new one.
- **Whitespace as structure.** The §10.2 space additions exist so public sections can breathe at a different density than the application without inventing arbitrary pixel values.
- **Text that carries the weight.** If a section would be empty without its illustration, the section is not ready.

### 8.3 The reviewer's question

A reviewer evaluating §23 asks one question of every screenshot: *does this look like a product a newspaper would buy, or like a template with a newspaper theme applied?* A "template" verdict on any of the 14 scenarios fails UI005 regardless of how many automated tests pass.

## 9. Visual identity and design language

### 9.1 Typographic system

| Role | Family | Size token | Weight | Used for |
|---|---|---|---|---|
| Hero | serif (`--pg-font-serif`) | `--pg-font-size-800` | `--pg-font-weight-bold` | The `/` `<h1>` only. |
| Page title | serif | `--pg-font-size-700` | `--pg-font-weight-bold` | The `<h1>` on `/features`, `/pricing`, `/security`, `/contact`. |
| Section title | serif | `--pg-font-size-600` | `--pg-font-weight-semibold` | `<h2>` on all five surfaces. |
| Standing head | sans | `--pg-font-size-100` | `--pg-font-weight-semibold` | Small uppercase section label above a rule line. Letter-spaced. |
| Lead paragraph | sans | `--pg-font-size-400` | regular | The first paragraph under a hero or page title. |
| Body | sans | `--pg-font-size-300` | regular | Everything else; existing `.pg-type-body`. |
| Caption / qualification | sans | `--pg-font-size-100` | regular, `--pg-color-text-muted` | Illustrative and availability qualifications; existing `.pg-type-caption`. |

Prose blocks are constrained to `--pg-reading-measure` (70ch). No public text block exceeds it.

### 9.2 Structural devices

- **Standing head + rule.** A section opens with a small uppercase sans label, a 1px `--pg-color-border` rule (`border-block-start`), then the serif `<h2>`. This is the site's recurring motif and the main thing that makes it read as editorial.
- **Lead-and-follow.** Where a section has multiple items, one is given greater span and weight; the rest sit in a secondary row. Never N identical cards.
- **The ink band.** At most two full-width bands per page use `--pg-color-text` as background with `--pg-color-on-action` text — the homepage workflow band and the closing CTA band. This mirrors `shell.css`'s `--editor` header treatment.
- **Rules over shadows.** Separation is achieved with `--pg-color-border-subtle` hairlines. `--pg-shadow-raised` is used nowhere in `public.css`.

### 9.3 Colour

Only existing UI001 colour tokens. No new colour token is added (§10.2 adds no colour). No raw hex, `rgb()`, `hsl()`, or named colour appears in `public.css` — enforced by the same scan pattern UI001's correction pass established.

### 9.4 Motion

Only `--pg-duration-default` / `--pg-easing-default`, only on `:hover`/`:focus-visible` of interactive elements, and only for `color`, `background-color`, `border-color`, or `text-decoration-color`. No entrance animation, no scroll-triggered animation, no transform animation. The stylesheet includes a `@media (prefers-reduced-motion: reduce)` block that removes all transitions.

### 9.5 Imagery

No raster images, no photographs, no logos, no icon font, no external SVG asset. The single permitted graphic is the §14 geometry illustration, authored as inline SVG in the component that owns it.

## 10. Token usage and permitted extensions

### 10.1 Rule

UI005 does not create a competing design system. `public.css` consumes `--pg-*` tokens only; it declares no custom property of its own except component-scoped `--pg-public-*` values set inline by a component and read via `var()`, which is the pattern UI001 already established.

### 10.2 Permitted additions to `frontend/src/ui/tokens.css`

Seven additions, each justified by a gap that cannot be closed by composing existing tokens.

| # | Token | Value | Why the existing scale cannot serve |
|---|---|---|---|
| 1 | `--pg-font-serif` | `ui-serif, Georgia, "Times New Roman", "Noto Serif", serif` | UI001 defines only sans and mono. The editorial voice in §8.2 requires a serif. This is an OS stack: nothing is downloaded, bundled, or implied to be a qualified newspaper font (UI001 §6.1). |
| 2 | `--pg-font-size-700` | `2.5rem` | The scale stops at `600` = `2rem`, the application page-title size. A public page title set at the same size as a workspace placeholder title reads as an unfinished app screen. |
| 3 | `--pg-font-size-800` | `3.25rem` | One step above `700`, for the single `/` hero. Without it the hero and the page titles are indistinguishable and the homepage has no focal point. |
| 4 | `--pg-line-height-700` | `2.875rem` | Required companion to token 2; the scale pairs every size with a line height. |
| 5 | `--pg-line-height-800` | `3.5rem` | Required companion to token 3. |
| 6 | `--pg-space-10` | `6rem` | The scale stops at `--pg-space-9` = `4rem`, tuned for application density. Public section rhythm at 4rem maximum makes every section the same weight and the page reads as a settings screen. |
| 7 | `--pg-space-11` | `8rem` | Band-level separation between major page regions at laptop width and above. |

No colour, radius, shadow, border-width, duration, easing, control-height, or measure token is added. Tokens 2–5 extend an existing scale by two steps in its established ratio; tokens 6–7 extend an existing scale by two steps. Nothing is renamed and no existing value changes — a diff of `tokens.css` must be purely additive, which §28 asserts.

### 10.3 Consumption rules

- Every size, space, colour, radius, and duration in `public.css` is `var(--pg-…)`.
- Logical properties only: `margin-block`, `padding-inline`, `inset-inline-start`, `border-block-end`, `text-align: start`. No `left`/`right`/`margin-left`/`padding-right`/`border-left`/`border-right`/`float`.
- No `!important`. No `z-index` above `1` (the skip link owns `100`).
- No viewport units for type (`vw`-scaled headlines break RTL and zoom); type sizes come from tokens only.

## 11. Route ownership and content map

UI005 owns exactly five routes. It adds none and modifies no other route's ownership.

| # | Route | `OWNING_UNIT` | `<h1>` | UI005 replaces | Component |
|---|---|---|---|---|---|
| 1 | `/` | `UI005` | "Newspaper production, end to end" | `placeholder("home")` | `HomePage` |
| 2 | `/features` | `UI005` | "What Pageinator is being built to do" | `placeholder("features")` | `FeaturesPage` |
| 3 | `/pricing` | `UI005` | "Illustrative packaging" | `placeholder("pricing")` | `PricingPage` |
| 4 | `/security` | `UI005` | "Security posture and current limits" | `placeholder("security")` | `SecurityPage` |
| 5 | `/contact` | `UI005` | "Contact" | `placeholder("contact")` | `ContactPage` |

Routes owned: **5**. Placeholders removed: **5**.

Routes explicitly **not** touched: `/login`, `/signup`, `/forgot-password`, `/verify` (UI004, `AuthRouteScreen`), `/onboarding` (UI006, `placeholder("onboarding")` remains), and every workspace and editor route. `PublicShell` continues to wrap rows 1–10 exactly as UI002 §7.1 specifies.

Each page's `<h1>` carries `id={ROUTE_HEADING_ID}` and `tabIndex={-1}` so `RouteAnnouncer` keeps working unchanged. Exactly one `<h1>` per page.

## 12. Homepage composition

`/` is composed of seven regions in DOM order. Nothing in region order changes by viewport (§21).

1. **Hero.** Serif `<h1>` at `--pg-font-size-800`: "Newspaper production, end to end". One lead paragraph (≤ 2 sentences) stating the workflow span and the buyer. Primary CTA (§20.1) and secondary CTA ("See the workflow" → `/features`). Directly beneath, in `.pg-type-caption`, the standing simulation qualification: "This is a working demonstration. No content is published, composed, validated, or printed by it today." No image, no gradient, no card.
2. **Current state band.** The §7.3 list of the three things that actually work today, as a short prose block with the primary CTA repeated as an inline link. This region exists specifically so a reader cannot get past the fold believing the product runs. It uses `--pg-color-surface-subtle`.
3. **Workflow band (ink).** The seven stages of §13 in condensed form: stage number, stage name, one sentence, availability label. This is the homepage's focal composition and the only place the ink band's full width is used for content rather than for a CTA. Link: "Read the full workflow" → `/features`.
4. **Structure section.** The §14 page-geometry illustration with its caption, and two paragraphs explaining why newspaper structure — columns, linked flows, fixed ad constraints, overset — is the problem the product is organized around. Lead-and-follow layout: illustration leads, prose follows.
5. **Constraints section.** Three items drawn from §7.2's non-goals, phrased as what the product deliberately will not do. This is a trust device and a differentiator; it replaces the template "three benefit cards".
6. **Provisional section.** Two short blocks that link out: "Packaging is not decided" → `/pricing`, and "Security posture and its limits" → `/security`.
7. **Closing CTA band (ink).** Primary CTA, secondary link to `/contact`, and the simulation qualification restated once.

The homepage carries a condensed form of each other surface and never content that exists nowhere else except the hero, the current-state band, and the structure section. Full treatments live on their own routes (§15–§18).

Homepage regions: **7**.

## 13. The product story — seven stages

### 13.1 Stages

Each stage is one record in the content model (§19.1) with: number, name, one-sentence description, one constraint sentence, an availability label (§13.2), and the owning future unit read from `OWNING_UNIT`. All description and constraint text traces to `MASTER_BUILD_SPEC.md` §5.

| # | Stage | Description (source: MASTER §5) | Constraint stated on the page | Owning unit |
|---|---|---|---|---|
| 1 | **Ingest** | Authorized discovery and import from owned content and contracted sources. | Permitted access and storage are checked before fetching, not only after extraction. Copied wire reports do not count as independent corroboration. | UI009–010 |
| 2 | **Organize** | Selecting and preparing stories, media, and ads for one edition. | An observation or event grouping is not an approved publishable story. Readiness reports concrete missing inputs, not an uncalibrated percentage. | UI010–012 |
| 3 | **Generate** | Producing an editable edition from the selected content and the publication's templates. | Regeneration is bounded and preserves locks. No text is silently dropped. | UI014 |
| 4 | **Edit** | Professional editing of the edition in the browser. | The sample editor stays distinct from the production editor until each capability is independently qualified. | UI015–018 |
| 5 | **Validate** | Deterministic validation of the composed edition against a print profile. | Validation is failure-closed: an unqualified profile or revision blocks release rather than warning. | UI019 |
| 6 | **Export** | Producing the final PDF for inspection, approval, and press handoff. | Manual press handoff is the pilot proposal. Pageinator does not control a printing press. | UI020 |
| 7 | **Archive** | Retaining and retrieving the exact published edition. | Release manifests are immutable. Permanent retention is not assumed. | UI021 |

Stages: **7**.

### 13.2 Availability vocabulary

Three values. Every stage on every surface carries exactly one, rendered as visible text adjacent to the stage name — never as a coloured badge that could read as a status light.

| Value | Visible label | Meaning |
|---|---|---|
| `demonstrated` | "You can try this in the demonstration" | A labeled simulation of this step is reachable and interactive today. |
| `routed` | "Reserved in the current build" | The surface is routed and named but renders an explicit "not yet implemented" placeholder. |
| `planned` | "Not built" | Neither surface nor engine capability exists. |

**As of this specification, all seven stages are `routed`.** The only `demonstrated` capabilities are the three in §7.3, which appear in region 2 of the homepage and §15.4 of `/features` — not as workflow stages. An implementer must not upgrade a stage to `demonstrated` in order to make the page feel stronger; §28 requires a test asserting that a `demonstrated` stage names a route whose leaf is not a `PlaceholderScreen`.

### 13.3 Why this is not a `StatusIndicator`

UI001's `PresentationState` is a document/proof lifecycle vocabulary (`simulated`, `pending`, `confirmed-proof`, `stale`, …) and UI001 §5 forbids treating it as a canonical lifecycle for anything else. Roadmap availability is not a document state. UI005 therefore renders availability as plain typographic text through a small local component (`CapabilityNote`), and imports `StatusIndicator` nowhere. This is a deliberate non-reuse, recorded here so a reviewer does not read it as an oversight.

## 14. Product preview strategy

### 14.1 The problem

A public product page normally shows the product. Pageinator has no product output to show: no composed page, no PDF, no proof, no edition. A screenshot of the current build would show labeled placeholders; a rendered newspaper page would be a fabrication. Both are forbidden.

### 14.2 The resolution

The single permitted graphic is a **page-geometry illustration**: an inline SVG schematic of a newspaper page's structure — margins, a column grid, gutters, a reserved ad rectangle, and a linked-flow indicator between two regions — drawn from static geometry constants declared in the component.

It must:

- contain **no text glyphs representing content** — no headline, no byline, no dateline, no body text, no greeking, no lorem ipsum. Region labels ("Column grid", "Reserved ad", "Linked flow") are permitted and are rendered as SVG `<text>` in the sans family at caption size.
- contain **no numbers presented as measurements** — no page count, no story count, no column-inch figure, no percentage, no dimension callout.
- carry a visible caption, immediately adjacent and programmatically associated via `<figcaption>`: *"Illustration of newspaper page structure. This is a diagram, not output produced by Pageinator."*
- be exposed accessibly: `<figure>` + `<figcaption>`, with the SVG carrying `role="img"` and an `aria-label` that describes the structure in one sentence.
- use only `--pg-color-border`, `--pg-color-border-subtle`, `--pg-color-surface-subtle`, and `--pg-color-text-muted` via `currentColor` or CSS custom properties — no fill that reads as a brand illustration.
- scale by `viewBox` with `width: 100%` and an intrinsic aspect ratio; it never introduces horizontal scroll (§21.5).

### 14.3 The other preview

The honest product preview is the demonstration itself. The primary CTA (§20.1) is the preview, which is why it appears in exactly two bands on every surface and why §20.2 requires its destination to be resolved from live session state rather than hard-coded.

### 14.4 Forbidden

No screenshot of any Pageinator surface. No mockup of the workspace, the editor, a dashboard, an inbox, or a settings screen. No browser-chrome frame device. No device mockup. No video. No animated walkthrough. No "before/after". No sample PDF. No thumbnail grid.

## 15. Features surface (`/features`)

`/features` carries the full workflow treatment that `/` condenses.

1. **Page title and lead.** Serif `<h1>` "What Pageinator is being built to do" at `--pg-font-size-700`, one lead paragraph, and the simulation qualification.
2. **The seven stages in full.** Each stage is a `<section>` with `<h2>` (standing head + rule + serif title), the description sentence, the constraint sentence, the availability label, and the owning unit named in a caption ("Reserved for UI014"). Lead-and-follow: stage 1 is presented at greater span; stages 2–7 follow in a rhythm that resets every third item so the page does not read as a uniform list.
3. **What this is not.** The §7.2 non-goals rendered as a prose block, each with one clarifying sentence. Placed *before* the closing CTA, deliberately, so the last substantive thing a reader sees is a limit rather than a pitch.
4. **What works today.** The §7.3 three-item list, verbatim with the homepage, sourced from the same content record so the two cannot drift.
5. **Closing CTA band.**

`/features` renders no pricing figure and no security claim; it links to `/pricing` and `/security` instead.

## 16. Pricing surface (`/pricing`)

### 16.1 Governing facts

R02 records that the subscription business's "packaging, buyer and price [are] unvalidated". OP09 is open. Phase 15 forbids "binding pricing". Therefore `/pricing` presents a **packaging hypothesis**, not an offer.

### 16.2 Composition

1. **Page title and lead.** "Illustrative packaging". The lead paragraph states in its first sentence that nothing on the page is purchasable and that packaging is an open decision.
2. **The open-decision block.** A `<Surface variant="subtle">` stating: packaging, buyer, and price are not decided; this page exists to show the shape a subscription might take, not what it will cost; there is no way to pay, and no payment capability exists in this build. This block appears **above** the tiers, not below.
3. **Three illustrative tiers.** Each tier has a name, a one-line intent, and a list of scope boundaries (what is included *as a scope*, not as a promise). Each tier carries, adjacent to its name, the visible caption **"Illustrative — not an offer"**.
4. **Price presentation.** Each tier's price position renders the literal string **"Not priced"**. No currency symbol, no numeral, no "from", no "starting at", no "contact us for pricing", no struck-through figure, no per-seat or per-month unit. A price in any form anywhere on this page fails AC-24.
5. **Per-tier action.** Each tier's action is the primary CTA (enter the demonstration) — identical across tiers. No tier has a distinct "Choose", "Select", "Upgrade", or "Get started" control, because choosing is not possible.
6. **What is not included.** A prose block stating explicitly: there is no trial, no invoice, no contract, no refund policy, no SLA, and no committed availability, because no service is being sold.
7. **Closing CTA band.**

### 16.3 Rules

- No comparison table with checkmarks, because a checkmark asserts a capability exists.
- No "most popular" marker, no recommended tier, no tier visually elevated over the others.
- No storage quota, seat count, edition limit, page limit, or usage figure.
- No countdown, discount, annual-vs-monthly toggle, or currency selector.
- The word "free" does not appear.

## 17. Security surface (`/security`)

### 17.1 Governing facts

R39 requires security claims to be "truthful and provisional". Phase 15 forbids "invented certifications". RM03 (backend foundation) and RM16 (hardening) are not started. There is no server, no database, no identity provider, no stored customer data, and no audited control.

### 17.2 Composition

1. **Page title and lead.** "Security posture and current limits". The lead paragraph states that this page describes design intent and current reality, and that Pageinator holds no customer data today.
2. **What is true today.** The build is a browser-only simulation. All fictional data lives in memory for the duration of a page view. Nothing is transmitted. Nothing is stored in `localStorage`, `sessionStorage`, IndexedDB, or a cookie. There is no account, no credential, and no session token. Refreshing the page discards everything.
3. **Design intent.** The tenancy and scoping model the product is being built toward, sourced from `MASTER_BUILD_SPEC.md`: the organization is the tenant; publications are nested authorization scopes; tenant-qualified references prevent attaching another organization's story, font, ad, asset, or archive member; cross-tenant deduplication must not disclose existence; sharing across publications is explicit. Each sentence is labeled as intent, in the future tense, not as an implemented control.
4. **Non-leakage as a demonstrated property.** The one security-adjacent claim that *is* demonstrable today: the build's inaccessible-context surface is generic by construction — an unknown identifier and a known identifier belonging to another organization produce identical output. This is stated as a UI property of the simulation, tested in UI002/UI004, and explicitly not presented as a production authorization control.
5. **What is not true today.** An explicit, prominent block: no certification, audit, attestation, or third-party assessment of any kind; no penetration test; no compliance programme; no encryption-at-rest claim, because nothing is at rest; no availability commitment; no incident-response programme; no data-processing agreement; no sub-processor list. This block is the same visual weight as block 3, not a footnote.
6. **Reporting.** A sentence directing security correspondence to `/contact`, with the standing note that the contact form does not send.
7. **Closing CTA band.**

### 17.3 Forbidden vocabulary on this surface

`SOC 2`, `SOC2`, `ISO 27001`, `ISO27001`, `GDPR-compliant`, `HIPAA`, `PCI`, `FedRAMP`, `CCPA-compliant`, `certified`, `accredited`, `audited`, `attestation`, `penetration tested`, `bank-grade`, `military-grade`, `enterprise-grade`, `zero-trust`, `end-to-end encrypted`, `99.9%`, `SLA`, `uptime`. §19.4 scans for these as a case-insensitive forbidden list over the content module.

## 18. Contact surface (`/contact`)

### 18.1 Behavior

A real, accessible, keyboard-operable form that sends nothing.

- Fields, using UI001 primitives only: **Name** (`TextInput`, optional), **Organization** (`TextInput`, optional), **How to reach you** (`TextInput`, optional, `type="text"` — **not** `type="email"`, so no address is implied to be collected or validated as one), **Message** (`TextArea`, required, `required` conveyed through UI001 `Field`'s existing required affordance).
- The `<form>` element has **no `action` attribute, no `method` attribute, and no `target`**. Its `onSubmit` handler calls `preventDefault()` unconditionally as its first statement.
- On submit with a non-empty message: render a UI001 `InlineMessage variant="info"` with heading "Nothing was sent" and body stating that this demonstration has no message delivery, that the text was not transmitted or stored, and that it will be discarded when the page is closed. The form's values are cleared. The acknowledgement receives focus.
- On submit with an empty message: render the field-level required error through UI001 `Field`'s existing error path. No `InlineMessage` acknowledgement is shown.
- The acknowledgement uses `InlineMessage`'s `live` prop so it is announced. This is a user-triggered outcome, which is the condition UI001 established for an assertive announcement; a polite announcement is acceptable and preferred here because nothing failed.

### 18.2 Standing qualification

Above the form, before the first field, in body text (not a caption): "This form does not send anything. There is no address behind it, no ticketing system, and no one is notified. It exists so the contact step of the journey is complete and honest."

### 18.3 Rules

- No `mailto:` link anywhere on any public surface.
- No displayed email address, phone number, postal address, or handle — a real-looking address implies a real channel, and a fictional one is an invented claim.
- No file upload, no CAPTCHA, no consent checkbox, no marketing opt-in, no "we'll get back to you within N hours".
- No `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, `WebSocket`, `EventSource`, or `HTMLFormElement.prototype.submit()` call. The static scan in §28 covers all of them.
- Nothing is written to `localStorage`, `sessionStorage`, IndexedDB, or a cookie — including a "draft" convenience, which would contradict §17.2 block 2.

## 19. Copy system and claim governance

### 19.1 Content as data

Every user-visible sentence on the five surfaces lives in `frontend/src/features/public/content.ts` as typed records, not inline in JSX. Each record carries:

```
id: string                     // stable, kebab-case
text: string                   // the exact rendered sentence
source: ContentSource          // "MASTER_BUILD_SPEC" | "PHASE_1_ANALYSIS" | "PHASE_15_UI_FIRST" | "IMPLEMENTATION_ROADMAP" | "DECISION_REGISTER" | "UI005_SPEC"
sourceRef: string              // e.g. "§5 workflow sentence", "R02", "OP09"
```

This exists for one reason: it makes §19.4's scan possible and makes claim review a diff of one file rather than an audit of six components. Components read records by id; a component that inlines a user-visible sentence violates AC-36.

### 19.2 Forbidden entities

No named customer, publisher, newspaper, agency, or press. No logo. No testimonial, quote, endorsement, or attributed statement. No case study. No count of users, customers, publications, editions, pages, or installations. No "trusted by", "used by", "join N publishers", "loved by newsrooms". No advisor, investor, or partner list. No award. No press mention. No map of locations.

The UI003 fixture organizations (`Sahyadri Media Cooperative`, `Konkan Coastal Press`) and publications (`Pune Daily Ledger`, `Deccan Evening Record`, `Ratnagiri Tide`) **must not appear on any public surface**. They are demonstration fixtures; presenting them publicly reads as a customer list. `frontend/src/features/public/**` importing from `frontend/src/mocks/**` is forbidden by §26 and asserted by AC-46.

### 19.3 Forbidden claim vocabulary

Case-insensitive, scanned over every `text` field in the content module:

`press-ready`, `print-ready`, `production-ready`, `production ready`, `ready for press`, `certified`, `guaranteed`, `guarantee`, `trusted by`, `industry-leading`, `world-class`, `best-in-class`, `enterprise-grade`, `revolutionary`, `seamless`, `effortless`, `AI-powered`, `powered by AI`, `next-generation`, `cutting-edge`, `unlock`, `supercharge`, `10x`, `instantly`, `zero-config`, `no code`, `free trial`, `money-back`, plus the §17.3 security list.

Additionally forbidden: any present-indicative sentence asserting an unbuilt capability. The scan enforces this structurally by requiring every workflow-stage description record to be authored in the form the §13.1 table fixes and to be paired with an availability label (AC-34).

### 19.4 The governance test

`frontend/tests/ui005/claims.test.ts` iterates every record in the content module and asserts: (a) no forbidden term appears; (b) `source` and `sourceRef` are non-empty; (c) every record id is referenced by at least one component, so dead copy cannot accumulate unreviewed; (d) no fixture organization or publication name appears; (e) no currency symbol, digit-with-currency pattern, or percentage appears in any `/pricing` record. This test is the mechanism by which BR-04, BR-05, and BR-06 are enforced rather than merely asserted.

### 19.5 Reading level and length

Lead paragraphs: at most two sentences. Body paragraphs: at most four sentences. No sentence exceeds 30 words. No public page exceeds roughly 900 words of body copy; a page that needs more is carrying content that belongs on another route or nowhere.

## 20. Navigation, auth entry, footer, and shell integration

### 20.1 The primary CTA

One label/destination pair, resolved from UI004 session state, implemented once in `frontend/src/features/public/PrimaryCta.tsx` and used by all five surfaces.

| Session state (`useSession().state.status`) | Label | Destination |
|---|---|---|
| `ready` (signed in) | "Open your demonstration workspace" | `paths.pubOverview(state.session.activeOrganizationId, state.session.activePublicationId)` |
| `signed-out` | "Enter the demonstration" | `paths.login()` |
| `loading` | "Enter the demonstration" | `paths.login()` |
| `denied` / `temporary-failure` | "Enter the demonstration" | `paths.login()` |

Rules: it is a router `Link` styled as a primary action, never a `<button>` that navigates. It never calls `signIn`. It renders in exactly two places per surface — the opening region and the closing CTA band — and nowhere else. During `loading` it renders its signed-out form rather than a spinner or a disabled control, because a public page must never present a dead primary action.

### 20.2 Secondary CTAs

One vocabulary, used at most once each per surface: "See the workflow" → `/features`; "Read the packaging note" → `/pricing`; "Security posture and limits" → `/security`; "Contact" → `/contact`; "Read the full workflow" → `/features` (homepage workflow band only).

### 20.3 Permitted link destinations

A public surface may link only to: the five UI005 routes, `paths.login()`, `paths.signup()`, and — when signed in — the active publication overview via `paths.pubOverview`. Every destination is produced by a `paths.*` builder; no template literal path appears in `frontend/src/features/public/**`. No external link, no `target="_blank"`, no `rel="noopener"` (because there is nothing to open), no anchor-only `href="#"`. AC-21 asserts this by scanning rendered `href` values across all five surfaces.

### 20.4 `PublicShell` changes

Exactly two edits, both narrow:

1. `<main>`'s content is currently wrapped in `<Container>`. UI005's full-width bands (§9.2) cannot live inside a measure-constrained container. The wrapper moves from the shell into each page's own regions: `PublicShell` renders `<main id={MAIN_LANDMARK_ID} tabIndex={-1}><Outlet /></main>`, and every page region that is not a full-width band wraps its own content in `<Container>`. Auth routes and `/onboarding` render through the same `<main>`, so `AuthRouteScreen` and `PlaceholderScreen` call sites gain a `<Container>` wrapper at their route element in `routeTree.tsx` to preserve their current appearance exactly. This is a layout-neutral change for rows 6–10 and must be verified as such (VA-13).
2. The footer's existing simulation notice is retained verbatim. UI005 adds, in the same footer, a single `<nav aria-label="Secondary">` listing the five public routes — the conventional public-site footer navigation. No other footer content: no column grid, no social links, no legal links, no copyright line naming an entity that does not exist, no newsletter form.

No other shell change is permitted. In particular, the header's session-aware controls, the `CollapsibleNav`, the brand link, and the skip link are untouched.

### 20.5 Auth entry

UI005 does not render sign-in or sign-up affordances in page content; the shell header already owns them (UI004 §12 cases 1–2). The primary CTA's signed-out destination is `/login`, which is the single, coherent entry point. `/signup` is reachable only from the shell header, exactly as today. UI005 renders no credential-like field on any surface — the §18 contact fields are not credential-like and carry no `type="email"`, `type="password"`, `autoComplete`, or `name` attribute suggesting authentication.

## 21. Responsive, RTL, and internationalization behavior

### 21.1 Widths

UI005 is verified at five widths. Only one new breakpoint boundary is introduced beyond UI002's 768px.

| Name | Width | Behavior |
|---|---|---|
| Large desktop | 1440px | Content centered at `--pg-content-measure` (72rem). Bands span full viewport; their inner content respects the measure. Generous rhythm using `--pg-space-11`. |
| Laptop | 1280px | Identical structure; rhythm steps down to `--pg-space-10`. |
| Tablet | 834px | Multi-column regions collapse to a single column at `--pg-space-9` rhythm. Header nav is still expanded (≥ 768px). |
| Mobile | 390px | Single column throughout. Header nav collapsed behind the existing `CollapsibleNav` disclosure. Rhythm at `--pg-space-7`/`--pg-space-8`. Hero drops to `--pg-font-size-700`. |
| Minimum | 320px | No horizontal scroll. No truncated or clipped text. No overlapping elements. The §14 illustration scales by `viewBox`. |

Breakpoints are expressed as `@media (min-width: …)` in `public.css` using rem-based values consistent with UI002's 768px boundary; column collapse uses `grid-template-columns` with `minmax()` so most reflow happens without a media query at all.

### 21.2 Reading order

DOM order equals visual order at every width. No CSS `order`, no `grid-row`/`grid-column` placement that moves an element before an earlier sibling, no `flex-direction: row-reverse` or `column-reverse`, and no absolute positioning that changes perceived sequence. This is what makes BR-T2's "small-screen reading order" expectation testable: the same DOM assertion holds at 320px and 1440px, and RB-04 verifies it visually.

### 21.3 RTL

- `public.css` contains no physical-direction property (§10.3), verified by the same scan pattern UI002 applied to `shell.css`.
- Every public surface renders correctly under `dir="rtl"`: the standing-head rule, the lead-and-follow spans, the §14 illustration container, the pricing tiers, and the contact form all mirror without overlap, clipping, or reversed reading order.
- The illustration's SVG is mirrored by its container's direction only where mirroring is meaningful; its internal geometry is symmetric enough that no `transform: scaleX(-1)` is required, and none is permitted (it would mirror the label text).
- `PublicShell` does not set `dir`; the public site is `ltr` by default. RTL verification is performed by setting `dir="rtl"` on the document element in the real-browser check (RB-07), which is how UI002's RTL claims for public chrome are established.
- No public copy is translated; UI005 adds no i18n runtime (§6). Language remains the document default.

### 21.4 No new navigation mechanism

`CollapsibleNav` in `PublicShell` already provides the phone-width disclosure (UI002 §10.3, `shell.css` `@media (max-width: 767px)`). UI005 adds no drawer, no off-canvas panel, no hamburger menu, no sticky mobile bar, and no in-page navigation. A "mobile drawer" is explicitly **not** needed and must not be built.

### 21.5 Overflow

No public element sets a fixed inline size in `px`. Long tokens are protected with `overflow-wrap: anywhere` where a word could exceed 320px. The illustration and any wide block use `max-inline-size: 100%`.

## 22. Accessibility, performance, and asset budget

### 22.1 Accessibility

- Each surface passes `axe-core` with **zero** violations of any impact level — not merely zero serious/critical. UI005 is static content with no complex widget; there is no legitimate minor violation.
- Exactly one `<h1>` per surface, carrying `id={ROUTE_HEADING_ID}` and `tabIndex={-1}`.
- Heading levels are sequential: `<h1>` → `<h2>` → `<h3>`. No level is skipped, and no heading level is chosen for size (size comes from typography classes).
- Every `<section>` that is a landmark-equivalent region uses a heading; no `role` attribute is added to a native element that already carries the role.
- The footer's new `<nav>` has `aria-label="Secondary"`, distinct from the header's `"Primary"`.
- The §14 figure uses `<figure>`/`<figcaption>` with `role="img"` and an `aria-label` on the SVG.
- Every interactive element is reachable and operable by keyboard alone, shows UI001's `:focus-visible` treatment, and has an accessible name that makes sense out of context ("Enter the demonstration", not "Learn more" repeated).
- Text contrast meets WCAG 2.1 AA at every size, including `--pg-color-text-muted` on `--pg-color-surface-subtle` and `--pg-color-on-action` on the `--pg-color-text` ink band. The ink band's contrast is verified numerically, not by eye (RB-08).
- No positive `tabindex`. No `aria-hidden` on a focusable element. No `title` attribute used as the sole accessible name.
- The page is fully usable at 200% browser zoom and at 400% zoom at 1280px width (WCAG 1.4.10 reflow), with no horizontal scroll.

### 22.2 Performance and asset budget

- **Zero new runtime dependencies** (§25). The public bundle adds only UI005's own modules.
- **Zero network requests** from any public surface after the application bundle loads: no font file, no image, no analytics, no API call. A real-browser check asserts an empty request log after first paint (RB-05).
- No web font is downloaded; `--pg-font-serif` is an OS stack.
- `public.css` is a single stylesheet imported by the feature's entry module; UI005 adds no CSS-in-JS and no runtime style injection.
- Total UI005 source (components + content + stylesheet) is expected to be well under the size at which code-splitting is warranted; UI005 introduces no dynamic import and no route-level lazy boundary.
- No layout shift after first paint on any surface: nothing is measured in JS and repositioned, and the illustration reserves its space via `viewBox` aspect ratio.

## 23. Visual acceptance testing

**Automated DOM tests alone are insufficient for UI005.** Every criterion below is verified by a human looking at a rendered browser at a stated viewport, capturing a screenshot, and recording a pass/fail with a one-line note. The evidence is filed at `docs/reviews/UI005_VISUAL_ACCEPTANCE.md`. A scenario with no screenshot is not passed.

For each scenario: **Setup** is the exact URL, viewport, and session state. **Capture** is the screenshot required. **Pass** is the condition. **Fail** names the specific way it is expected to go wrong.

### VA-01 — Homepage, large desktop, signed out
**Setup:** `/`, 1440×900, signed out. **Capture:** full-page screenshot. **Pass:** The hero's serif `<h1>` is the unambiguous focal point; the simulation qualification is visible without scrolling; the primary CTA reads "Enter the demonstration"; the page reads as an editorial product site, not a template. Content is centered within the measure with bands spanning full width. **Fail:** hero indistinguishable from a page title; three identical cards visible; any gradient or glow; qualification below the fold.

### VA-02 — Homepage, laptop
**Setup:** `/`, 1280×800, signed out. **Capture:** full-page. **Pass:** Identical structure to VA-01 at reduced rhythm; no region collapses; the workflow ink band holds all seven stages legibly. **Fail:** stages wrap into an uneven ragged grid; band padding visually collapses.

### VA-03 — Homepage, tablet
**Setup:** `/`, 834×1112, signed out. **Capture:** full-page. **Pass:** Multi-column regions are single column; header nav still expanded; illustration scales without clipping; rhythm reduced but sections still visually separated. **Fail:** header nav collapsed at ≥ 768px; illustration cropped; two adjacent sections indistinguishable.

### VA-04 — Homepage, mobile
**Setup:** `/`, 390×844, signed out. **Capture:** full-page plus a capture with the nav disclosure open. **Pass:** Single column; hero at `--pg-font-size-700` and still dominant; nav collapsed behind the existing disclosure and operable; CTA full-width and not clipped; reading order matches desktop. **Fail:** hero text overflowing; CTA truncated; a second navigation mechanism present; content reordered.

### VA-05 — Homepage, 320px minimum
**Setup:** `/`, 320×640, signed out. **Capture:** full-page plus a horizontal-scroll check. **Pass:** No horizontal scrollbar; no clipped text; illustration fits; no element overlaps another. **Fail:** any horizontal scroll; the illustration forcing width; a long unbroken token overflowing.

### VA-06 — Features, laptop
**Setup:** `/features`, 1280×800. **Capture:** full-page. **Pass:** All seven stages present with availability labels reading "Reserved in the current build"; the lead-and-follow rhythm is visible (stage 1 given greater span); "What this is not" appears before the closing CTA; no stage implies it works. **Fail:** seven identical cards; any availability label reading as `demonstrated`; the non-goals block missing or demoted to a footnote.

### VA-07 — Pricing, laptop
**Setup:** `/pricing`, 1280×800. **Capture:** full-page plus a close capture of one tier. **Pass:** The open-decision block sits above the tiers; every tier shows "Not priced" and the adjacent "Illustrative — not an offer" caption; no currency symbol or numeral appears anywhere; no tier is visually elevated; every tier action is the identical primary CTA. **Fail:** any price-like glyph; a "most popular" marker; a checkmark comparison table; a per-tier "Choose plan" control.

### VA-08 — Pricing, mobile
**Setup:** `/pricing`, 390×844. **Capture:** full-page. **Pass:** Tiers stack in DOM order; the open-decision block remains first; each tier's illustrative caption remains adjacent to its name, not orphaned at the bottom. **Fail:** caption separated from its tier; tiers reordered; horizontal scroll.

### VA-09 — Security, laptop
**Setup:** `/security`, 1280×800. **Capture:** full-page plus a close capture of the "what is not true today" block. **Pass:** "What is true today" and "What is not true today" carry equal visual weight; no certification name, badge, shield, or lock icon appears; the design-intent block is visibly labeled as intent. **Fail:** a badge or shield graphic; the limits block styled as fine print; any tense that reads as an implemented control.

### VA-10 — Contact form, laptop, resting state
**Setup:** `/contact`, 1280×800. **Capture:** full-page. **Pass:** The standing "does not send" qualification appears above the first field in body text; labels are visible (not placeholder-only); the required field is marked through UI001's existing affordance; no email address, phone number, or upload control is present. **Fail:** placeholder-as-label; a displayed address; a consent checkbox; a "we'll respond within" promise.

### VA-11 — Contact form, submitted acknowledgement
**Setup:** `/contact`, 1280×800; type a message; submit. **Capture:** screenshot of the acknowledgement. **Pass:** The acknowledgement heading reads "Nothing was sent"; the body states the text was not transmitted or stored; the fields are cleared; focus is visibly on the acknowledgement; the acknowledgement does not resemble a success confirmation of a delivery. **Fail:** a green "Message sent" treatment; a checkmark; fields retaining values; focus left on the submit button.

### VA-12 — Signed-in CTA state
**Setup:** `/` and `/pricing`, 1280×800, after signing in through `/login` with a demonstration profile. **Capture:** both pages' opening region and closing band. **Pass:** The primary CTA reads "Open your demonstration workspace" in all four positions and resolves to the active publication overview; the shell header shows `SignedInSessionControls` as it does today; no page-content duplicate of the sign-in affordance appears. **Fail:** CTA still reading "Enter the demonstration"; two different CTA labels on one page; a page-level sign-out or identity control.

### VA-13 — Auth and onboarding routes unchanged
**Setup:** `/login`, `/signup`, `/forgot-password`, `/verify`, `/onboarding` at 1280×800, signed out. **Capture:** one screenshot each, compared against the same captures taken before UI005's changes. **Pass:** Visually unchanged — the §20.4 `<Container>` relocation is layout-neutral for these routes. **Fail:** content now full-bleed; changed measure; changed spacing.

### VA-14 — RTL
**Setup:** `/`, `/features`, `/pricing`, `/contact` at 1280×800 with `dir="rtl"` on the document element. **Capture:** one screenshot each. **Pass:** Text aligns to the start edge; standing-head rules and lead-and-follow spans mirror coherently; the illustration and its caption remain correctly associated and unmirrored in their label text; the contact form's labels, fields, and error/acknowledgement positions mirror without overlap. **Fail:** a stranded left-aligned block; mirrored label glyphs inside the SVG; overlapping form elements; a physical-direction margin visibly unmirrored.

**Screenshot / manual scenarios: 14.**

## 24. Real-browser acceptance requirements

jsdom has no layout engine, does not apply media queries, cannot measure contrast, and cannot establish scroll or focus-ring behavior. The following are verified in real Chrome (headless via CDP is acceptable and is how UI002/UI004 established their equivalent claims), with results recorded in `docs/reviews/UI005_VISUAL_ACCEPTANCE.md`.

| ID | Check | Method | Pass condition |
|---|---|---|---|
| RB-01 | No horizontal overflow | For each of the five routes at 320, 390, 834, 1280, 1440: compare `document.documentElement.scrollWidth` to `clientWidth`. | Equal at all 25 combinations. |
| RB-02 | `axe-core` in a real engine | Run `axe.run()` against each of the five routes at 1280 and 390. | Zero violations of any impact, at all 10 combinations. |
| RB-03 | Keyboard traversal | Tab from document start on each route; record the ordered accessible names. | Skip link is first; order is skip link → brand → primary nav → session/auth controls → main content in DOM order → footer nav. No focus trap. Every stop has a visible focus indicator. |
| RB-04 | Visual reading order equals DOM order | For each route at 390 and 1280, read `getBoundingClientRect()` for every region and compare the top-edge ordering to DOM order. | Region order by geometry matches DOM order at both widths. |
| RB-05 | Zero network requests | Enable CDP `Network`, load each route, wait for idle after first paint, and inspect the request log excluding the application bundle and its own module graph. | No font, image, script, beacon, XHR, or fetch request. |
| RB-06 | Contact form sends nothing | Instrument `fetch`, `XMLHttpRequest.prototype.send`, `navigator.sendBeacon`, `WebSocket`, and `HTMLFormElement.prototype.submit` before load; fill and submit the form; also verify the URL does not change and no navigation occurs. | Zero calls; URL unchanged; acknowledgement rendered; `localStorage`/`sessionStorage`/`document.cookie` unchanged. |
| RB-07 | RTL layout | Set `dir="rtl"`; for each route at 1280, assert no element's bounding box extends beyond the viewport and no two sibling region boxes overlap. | No overflow, no overlap, on all five routes. |
| RB-08 | Contrast on the ink band and muted text | Compute contrast ratios for `--pg-color-on-action` on `--pg-color-text`, and `--pg-color-text-muted` on `--pg-color-surface-subtle`, at the rendered sizes used. | Every pair ≥ 4.5:1 for body text and ≥ 3:1 for text at `--pg-font-size-600` and above. |

**Real-browser scenarios: 8.**

Additionally, the reload requirement from UI002 §9.2 and the back/forward requirement from §9.3 continue to hold for the five routes and are re-verified in the real browser as part of RB-03's traversal session (navigating `/` → `/features` → `/pricing` → back → back must land on `/` with focus on its `<h1>`).

## 25. Dependency policy

**UI005 adds zero dependencies — runtime, development, or transitive.**

No dependency is proposed, and the §12 adoption-gate process is not invoked, because nothing in §5's scope requires one. Specifically: no Markdown/MDX pipeline (content is typed data, §19.1), no icon package (§9.5 permits no icons), no animation library (§9.4 permits only CSS transitions), no carousel, no i18n runtime (§21.3), no analytics SDK (§6), no form library (UI001 `Field` is sufficient), no SVG-loader plugin (the one illustration is inline JSX), and no headless-UI package (the public site has no complex widget).

An implementer who believes a dependency is required must stop and raise it rather than install it; a new dependency invalidates §22.2's budget and requires the `frontend/DEPENDENCIES.md` adoption gate UI001's correction pass established.

**New runtime dependencies: 0. New dev dependencies: 0.**

## 26. Implementation boundaries and file map

```text
frontend/
  src/
    ui/
      tokens.css                     # MODIFIED — additive only, the 7 tokens in §10.2
    features/
      public/                        # NEW — all UI005 code
        content.ts                   # typed content records (§19.1)
        workflow.ts                  # the seven stage records + availability vocabulary (§13)
        public.css                   # the only UI005 stylesheet (§9, §10.3)
        PrimaryCta.tsx               # §20.1
        CapabilityNote.tsx           # §13.2 availability label (not a StatusIndicator)
        StandingHead.tsx             # §9.2 standing head + rule motif
        PageGeometryFigure.tsx       # §14 illustration
        HomePage.tsx                 # §12
        FeaturesPage.tsx             # §15
        PricingPage.tsx              # §16
        SecurityPage.tsx             # §17
        ContactPage.tsx              # §18
        index.ts                     # the feature's export surface (the five pages only)
    app/
      shells/
        PublicShell.tsx              # MODIFIED — exactly the two edits in §20.4
    demo/
      ui004/
        routeTree.tsx                # MODIFIED — 5 placeholder call sites replaced;
                                     # rows 6–10 gain a <Container> wrapper (§20.4.1)
  tests/
    ui005/
      routes.test.tsx                # surface rendering, headings, ownership
      cta.test.tsx                   # CTA labels and destinations in both session states
      pricing.test.tsx               # illustrative qualification, no price, no purchase path
      security.test.tsx              # no certification claim, limits block present
      contact.test.tsx               # non-sending behavior, accessibility, acknowledgement
      claims.test.ts                 # §19.4 content governance scan
      reading-order.test.tsx         # DOM order and heading sequence
      accessibility.test.tsx         # axe on all five surfaces
      boundary.test.ts               # import boundary + stylesheet scans
```

### 26.1 Durable vs disposable

`frontend/src/features/public/**` is **durable**. Unlike UI002's placeholders, the public journey is real product surface: it is not deleted by a later unit. Later units may revise its copy — which is precisely why §19.1 puts every sentence in one reviewable module — but the directory survives.

The backlog names the area as `frontend/features/public/`; the repository's established layout is `frontend/src/features/<domain>/` (as `frontend/src/features/auth/` already demonstrates). `frontend/src/features/public/` is the same area under the repository's actual convention.

### 26.2 Import boundaries

`frontend/src/features/public/**` may import from:

- `frontend/src/ui/index.ts` (UI001 primitives),
- `frontend/src/app/routes.ts` (`paths`, `ROUTE_HEADING_ID`, `ROUTE_LABELS`),
- `frontend/src/features/auth/SessionProvider.tsx` (`useSession`, read-only, for §20.1 only),
- `react`, `react-router`,
- its own modules.

It must **not** import from `frontend/src/services/**`, `frontend/src/mocks/**`, `frontend/src/demo/**`, `frontend/src/app/shells/**`, or any `frontend/src/ui/` internal path that bypasses `index.ts`. `frontend/src/app/**` must not import from `frontend/src/features/public/**`. Both directions are asserted by `boundary.test.ts` using the `import.meta.glob(..., { eager: true, query: "?raw", import: "default" })` pattern UI001/UI002 established for `.ts`/`.tsx` sources, and `node:fs` for the CSS scans (raw CSS imports return an empty string under Vitest — a known constraint recorded during UI001).

## 27. Implementation tasks

### Task 1 — Token additions
**Purpose:** Add the seven §10.2 tokens. **Files:** `frontend/src/ui/tokens.css`. **Completion:** `git diff` on `tokens.css` is purely additive; `npm run typecheck`, `npm test -- --run`, `npm run build` still pass with the tokens unused.

### Task 2 — Content and workflow model
**Purpose:** Author `content.ts` and `workflow.ts` per §13 and §19.1, with `source`/`sourceRef` on every record. **Files:** `frontend/src/features/public/content.ts`, `workflow.ts`. **Dependencies:** none. **Completion:** AC-36, AC-37 pass; `claims.test.ts` passes against the model before any component exists.

### Task 3 — Shared public presentation pieces
**Purpose:** `public.css`, `StandingHead`, `CapabilityNote`, `PrimaryCta`. **Files:** as named in §26. **Dependencies:** Tasks 1–2. **Completion:** AC-11 – AC-15, AC-16 – AC-20 pass; no physical-direction property and no raw colour in `public.css`.

### Task 4 — Page geometry illustration
**Purpose:** `PageGeometryFigure` per §14. **Dependencies:** Tasks 1, 3. **Completion:** AC-08, AC-09, AC-10 pass; the SVG contains no content glyph and no measurement.

### Task 5 — Homepage
**Purpose:** `HomePage` per §12's seven regions. **Dependencies:** Tasks 2–4. **Completion:** AC-01, AC-05, AC-06 pass; VA-01 – VA-05 captured.

### Task 6 — Features surface
**Purpose:** `FeaturesPage` per §15. **Dependencies:** Tasks 2–4. **Completion:** AC-02, AC-07, AC-33 – AC-35 pass; VA-06 captured.

### Task 7 — Pricing surface
**Purpose:** `PricingPage` per §16. **Dependencies:** Tasks 2–3. **Completion:** AC-22 – AC-27 pass; VA-07, VA-08 captured.

### Task 8 — Security surface
**Purpose:** `SecurityPage` per §17. **Dependencies:** Tasks 2–3. **Completion:** AC-30 – AC-32 pass; VA-09 captured.

### Task 9 — Contact surface
**Purpose:** `ContactPage` per §18. **Dependencies:** Tasks 2–3. **Completion:** AC-38 – AC-43 pass; VA-10, VA-11 captured.

### Task 10 — Shell and route integration
**Purpose:** The two §20.4 `PublicShell` edits and the five route-tree replacements, preserving rows 6–10 exactly. **Files:** `PublicShell.tsx`, `frontend/src/demo/ui004/routeTree.tsx`. **Dependencies:** Tasks 5–9. **Completion:** AC-03, AC-04, AC-44, AC-45 pass; VA-13 captured; every existing UI002/UI003/UI004 test still passes unmodified.

### Task 11 — Tests and boundary enforcement
**Purpose:** The nine test files in §26. **Dependencies:** Tasks 1–10. **Completion:** AC-46 – AC-48 pass; full suite green.

### Task 12 — Visual and real-browser acceptance
**Purpose:** Execute §23's 14 scenarios and §24's 8 checks; file `docs/reviews/UI005_VISUAL_ACCEPTANCE.md`. **Dependencies:** Task 11. **Completion:** All 22 recorded with evidence; `npm run typecheck`, `npm test -- --run`, `npm run build` all succeed under a supported Node version.

**Implementation tasks: 12.**

## 28. Test requirements

Tests must be behavioral and capable of failing. A parameterized test across the five routes is preferred to five near-duplicate blocks where the assertion is genuinely identical.

| Area | Required tests |
|---|---|
| Surface rendering | Each of the five routes renders its §11 component with exactly one `<h1>` carrying `ROUTE_HEADING_ID` and `tabIndex={-1}`; no route renders `PlaceholderScreen`. |
| Ownership preservation | `/login`, `/signup`, `/forgot-password`, `/verify` still render `AuthRouteScreen`; `/onboarding` still renders the UI006 placeholder. Asserted after UI005's route-tree change, not before. |
| CTA destinations | Table-driven across all five surfaces × two session states (`signed-out`, `ready`): assert the primary CTA's exact label and resolved `href` per §20.1, and that exactly two primary CTAs exist per surface. |
| Permitted links | Collect every `href` rendered on each surface; assert each is a `paths.*` result from §20.3's allowed set; assert no `target`, no `mailto:`, no `http`/`https` scheme, no `href="#"`. |
| Workflow integrity | All seven §13.1 stages render on `/features` and in condensed form on `/`; each carries an availability label; the stage records used by both pages are the same objects (drift is impossible, not merely unlikely). |
| Availability honesty | Any stage marked `demonstrated` must name a route whose leaf is not a `PlaceholderScreen`; with all stages currently `routed`, this test asserts the vocabulary is enforced and will fail the moment someone upgrades a label without shipping the surface. |
| Illustration | The `PageGeometryFigure` SVG contains no digit character and no forbidden content glyph pattern; `<figcaption>` is present and associated; `role="img"` and a non-empty `aria-label` are set. |
| Pricing | Every tier renders the literal "Not priced" and the illustrative caption; no currency symbol (`$ € £ ₹ ¥`), no digit adjacent to a currency symbol, and no `%` appears anywhere on the surface; the open-decision block precedes the first tier in DOM order; no control's accessible name matches `/choose\|select\|buy\|subscribe\|start.*trial\|upgrade\|get started/i`. |
| Security | The §17.3 forbidden vocabulary does not appear; the "what is not true today" block is present and contains at least the certification, audit, SLA, and encryption-at-rest denials. |
| Contact — no submission | Spies on `fetch`, `XMLHttpRequest.prototype.send`, `XMLHttpRequest.prototype.open`, `navigator.sendBeacon`, `WebSocket`, and `HTMLFormElement.prototype.submit` record zero calls across fill-and-submit. The `<form>` has no `action`, no `method`, no `target`. `localStorage`, `sessionStorage`, and `document.cookie` are unchanged. |
| Contact — behavior | Submitting with a message renders the "Nothing was sent" acknowledgement, clears the fields, and moves focus to the acknowledgement. Submitting empty renders the required-field error and **no** acknowledgement. Both paths are keyboard-only operable. |
| Claim governance | `claims.test.ts` per §19.4 (a–e), including the fixture-name check and the dead-copy check. |
| Reading order | For each surface, the DOM order of regions matches the §12/§15–§18 specified order, and heading levels are sequential with no skip. |
| Accessibility | `axe-core` zero violations of any impact on each of the five surfaces, and on `/contact` in its post-submit acknowledgement state. Footer `<nav aria-label="Secondary">` is distinct from the header's `"Primary"`. |
| Stylesheet scans | `public.css` contains no physical-direction property, no raw colour value, no `!important`, no `px` font size, no `vw`/`vh` type size. `tokens.css`'s diff is additive only (no existing token's value changed). |
| Boundary | `frontend/src/features/public/**` has zero imports matching `/mocks/`, `/services/`, `/demo/`, `/app/shells/`; `frontend/src/app/**` has zero imports of `features/public`. |
| Regression | The entire existing UI001/UI002/UI003/UI004 suite passes **unmodified**. A UI005 change that requires editing a prior unit's test is a design error to be raised, not absorbed. |

## 29. Acceptance criteria

UI005 passes only if every criterion passes. Criteria are grouped into four categories.

### Category A — Content truthfulness (AC-01 – AC-12)

1. **AC-01:** `/` renders `HomePage` with the §12 regions in the specified DOM order.
2. **AC-02:** `/features`, `/pricing`, `/security`, `/contact` render their §11 components with the specified `<h1>`.
3. **AC-03:** No public surface renders `PlaceholderScreen`, and `/onboarding` still does.
4. **AC-04:** The four auth routes still render `AuthRouteScreen` with unchanged behavior.
5. **AC-05:** The homepage states, above the fold at 1280px width, that this is a demonstration in which nothing is published, composed, validated, or printed.
6. **AC-06:** The homepage's current-state region lists exactly the three §7.3 capabilities and claims no fourth.
7. **AC-07:** All seven §13.1 stages appear on `/features` with their constraint sentence, and the condensed set on `/` is generated from the same records.
8. **AC-08:** The §14 illustration contains no content glyph, no digit, and no measurement, and carries its exact caption.
9. **AC-09:** No screenshot, mockup, photograph, logo, or device frame appears on any public surface.
10. **AC-10:** No number presented as a measurement, count, percentage, or statistic appears on any public surface.
11. **AC-11:** Every workflow stage carries an availability label from §13.2's three values.
12. **AC-12:** No stage is labeled `demonstrated` unless its route's leaf is not a `PlaceholderScreen`.

### Category B — Claim governance (AC-13 – AC-32)

13. **AC-13:** Every user-visible sentence lives in the content module with a non-empty `source` and `sourceRef`.
14. **AC-14:** No component inlines a user-visible sentence.
15. **AC-15:** Every content record id is referenced by at least one component.
16. **AC-16:** Exactly one primary CTA label/destination pair exists, implemented once in `PrimaryCta`.
17. **AC-17:** Signed out, the primary CTA reads "Enter the demonstration" and resolves to `/login` on all five surfaces.
18. **AC-18:** Signed in, it reads "Open your demonstration workspace" and resolves to the active publication overview on all five surfaces.
19. **AC-19:** Each surface renders the primary CTA in exactly two positions.
20. **AC-20:** The primary CTA is a router `Link`, never a button, and never calls `signIn`/`signOut`.
21. **AC-21:** Every rendered `href` on every public surface is a `paths.*` result within §20.3's allowed set; no external link, `mailto:`, `target`, or `href="#"` exists.
22. **AC-22:** `/pricing` renders the open-decision block before the first tier.
23. **AC-23:** Every tier carries the visible caption "Illustrative — not an offer" adjacent to its name.
24. **AC-24:** No currency symbol, price numeral, percentage, or unit-of-sale appears anywhere on `/pricing`.
25. **AC-25:** Every tier's action is the identical primary CTA; no plan-selection, checkout, or trial control exists.
26. **AC-26:** No tier is marked recommended, popular, or visually elevated.
27. **AC-27:** `/pricing` states that packaging, buyer, and price are open decisions and that no payment capability exists.
28. **AC-28:** No named customer, publisher, logo, testimonial, quote, case study, award, or partner appears on any surface.
29. **AC-29:** No UI003 fixture organization or publication name appears on any public surface.
30. **AC-30:** No certification, audit, attestation, compliance-programme, or third-party-assessment claim appears; the §17.3 vocabulary is absent.
31. **AC-31:** `/security` renders a "what is not true today" block at the same visual weight as its design-intent block.
32. **AC-32:** `/security` states that nothing is transmitted or stored and that no account, credential, or session token exists.

### Category C — Behavior, structure, and boundaries (AC-33 – AC-48)

33. **AC-33:** The §19.3 forbidden claim vocabulary appears nowhere in the content module.
34. **AC-34:** No unbuilt capability is described in the present indicative; every stage description is paired with an availability label.
35. **AC-35:** `/features` renders the §7.2 non-goals before its closing CTA.
36. **AC-36:** `claims.test.ts` passes all five of its §19.4 checks.
37. **AC-37:** The stage records consumed by `/` and `/features` are the same objects.
38. **AC-38:** `/contact`'s `<form>` has no `action`, no `method`, and no `target`, and its `onSubmit` calls `preventDefault()` first.
39. **AC-39:** Filling and submitting the form produces zero calls to `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket`, or `HTMLFormElement.prototype.submit`.
40. **AC-40:** Submission leaves `localStorage`, `sessionStorage`, and `document.cookie` unchanged and does not change the URL.
41. **AC-41:** A successful submission renders the "Nothing was sent" acknowledgement, clears the fields, and moves focus to it.
42. **AC-42:** An empty-message submission renders the required-field error and no acknowledgement.
43. **AC-43:** No `mailto:` link, displayed address, phone number, upload control, CAPTCHA, or response-time promise exists on any surface.
44. **AC-44:** `PublicShell` changes are limited to exactly the two §20.4 edits; no other shell file is modified.
45. **AC-45:** Rows 6–10 render visually unchanged after the `<Container>` relocation (VA-13).
46. **AC-46:** `frontend/src/features/public/**` imports nothing from `mocks/`, `services/`, `demo/`, or `app/shells/`, and `frontend/src/app/**` imports nothing from `features/public`.
47. **AC-47:** UI005 adds zero runtime and zero development dependencies; `package.json` is unchanged.
48. **AC-48:** The entire pre-existing UI001–UI004 test suite passes unmodified.

### Category D — Design, accessibility, and verification (AC-49 – AC-62)

49. **AC-49:** `tokens.css`'s diff is purely additive and consists of exactly the seven §10.2 tokens.
50. **AC-50:** `public.css` contains no raw colour value, no physical-direction property, no `!important`, and no viewport-unit type size.
51. **AC-51:** No `--pg-shadow-raised` usage and no decorative gradient, blur, or glow appears in `public.css`.
52. **AC-52:** Motion is limited to §9.4's permitted properties and is fully removed under `prefers-reduced-motion: reduce`.
53. **AC-53:** Exactly one `<h1>` per surface, carrying `ROUTE_HEADING_ID` and `tabIndex={-1}`; heading levels are sequential with no skip.
54. **AC-54:** `axe-core` reports zero violations of any impact on all five surfaces in jsdom and in real Chrome at 1280 and 390 (RB-02).
55. **AC-55:** DOM order equals visual order at 320, 390, 834, 1280, and 1440 on all five surfaces (RB-04); no CSS `order` or reversing flex direction is used.
56. **AC-56:** No horizontal scroll at any of the five widths on any of the five surfaces (RB-01).
57. **AC-57:** The page is usable at 200% zoom, and at 400% zoom at 1280px width, with no horizontal scroll.
58. **AC-58:** Tab order is skip link → brand → primary nav → session/auth controls → main content → footer nav, with a visible focus indicator at every stop and no focus trap (RB-03).
59. **AC-59:** Zero network requests originate from any public surface after the application bundle loads (RB-05).
60. **AC-60:** All contrast pairs meet §22.1's thresholds, verified numerically (RB-08).
61. **AC-61:** All 14 §23 scenarios and all 8 §24 checks are recorded with evidence in `docs/reviews/UI005_VISUAL_ACCEPTANCE.md`.
62. **AC-62:** `npm run typecheck`, `npm test -- --run`, and `npm run build` all exit successfully under a Node version satisfying `^22.22.2 || ^24.15.0 || >=26.0.0`.

**Acceptance criteria: 62** — Category A (truthfulness): 12; Category B (claim governance): 20; Category C (behavior, structure, boundaries): 16; Category D (design, accessibility, verification): 14.

## 30. Prohibited shortcuts

- Do not describe an unbuilt capability in the present tense to make a sentence read better.
- Do not invent a customer, a logo, a testimonial, a statistic, a certification, or an award — not even as a placeholder "to be replaced before launch".
- Do not present the UI003 fixture organizations as customers, references, or examples of who uses Pageinator.
- Do not show a price, a currency symbol, a "from" figure, or a struck-through amount on `/pricing`.
- Do not add a "Start free trial", "Choose plan", "Buy", or "Contact sales" control.
- Do not add a security badge, shield, lock icon, or compliance logo.
- Do not make the contact form send, queue, store, or appear to store anything, and do not add a `mailto:` fallback.
- Do not add analytics, telemetry, a cookie banner, a chat widget, or any third-party script.
- Do not create a second design system, a parallel token set, or a component that duplicates a UI001 primitive.
- Do not reuse `StatusIndicator` for roadmap availability (§13.3) or invent a badge that reads as a status light.
- Do not build a mobile drawer or any second navigation mechanism; `CollapsibleNav` already exists.
- Do not add a public route beyond the five in §11.
- Do not modify any shell other than the two §20.4 `PublicShell` edits, and do not touch `routes.ts`.
- Do not weaken, skip, or edit an existing UI001–UI004 test to make a UI005 change pass.
- Do not install a dependency; raise the need instead (§25).
- Do not treat passing automated tests as satisfying §23 — the screenshots are the acceptance evidence.
- Do not treat this document as authorizing implementation of any unit other than UI005.

## 31. Completion checklist

- [ ] Seven §10.2 tokens added to `tokens.css`; diff verified purely additive.
- [ ] `frontend/src/features/public/` created with the §26 file set; content and workflow models carry `source`/`sourceRef` on every record.
- [ ] All five surfaces implemented per §12 and §15–§18; five placeholder call sites removed from `routeTree.tsx`.
- [ ] `PublicShell` changed by exactly the two §20.4 edits; rows 6–10 verified visually unchanged.
- [ ] Primary CTA implemented once and verified in both session states on all five surfaces.
- [ ] `/pricing` verified free of any price, purchase path, or recommended tier.
- [ ] `/security` verified free of any certification claim, with the "what is not true today" block present.
- [ ] `/contact` verified non-sending by runtime spies and static scan.
- [ ] `claims.test.ts` passing all five §19.4 checks.
- [ ] All 62 §29 acceptance criteria pass.
- [ ] All 14 §23 visual scenarios captured and recorded in `docs/reviews/UI005_VISUAL_ACCEPTANCE.md`.
- [ ] All 8 §24 real-browser checks executed and recorded.
- [ ] Zero dependencies added; `package.json` unchanged.
- [ ] Entire UI001–UI004 suite passing unmodified.
- [ ] `npm run typecheck`, `npm test -- --run`, `npm run build` all succeed.
- [ ] No file outside `frontend/src/ui/tokens.css`, `frontend/src/features/public/**`, `frontend/src/app/shells/PublicShell.tsx`, `frontend/src/demo/ui004/routeTree.tsx`, and `frontend/tests/ui005/**` modified; no commit or push performed without separate instruction.
