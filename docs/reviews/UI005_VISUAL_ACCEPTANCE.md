# UI005 — Visual and Real-Browser Acceptance Evidence

Unit: UI005 Public Product Journey
Specification: `specs/active/UI005_PUBLIC_PRODUCT_JOURNEY.md` §23 (visual acceptance) and §24 (real-browser acceptance)
Recorded: 2026-09-18 — regenerated after the final acceptance fix pass (H1 content governance, H2 shell scope)
Build under test: `frontend/dist` from the uncommitted UI005 working tree, served by `vite preview` at `http://localhost:4173`
Browser: `Chrome/153.0.8010.48` (headless, `--headless=new`), driven over the Chrome DevTools Protocol. Exact build string and user agent are recorded in `ui005-visual/rb-checks.json`.
Node: v22.22.3 (satisfies `^22.22.2 || ^24.15.0 || >=26.0.0`)

**Durable evidence lives in [`docs/reviews/ui005-visual/`](ui005-visual/):** 31 PNG screenshots plus two machine-readable reports.

| Artefact | Contents |
|---|---|
| `ui005-visual/*.png` | Every screenshot referenced below, captured from the running implementation. |
| `ui005-visual/rb-checks.json` | Raw per-check output for RB-01 – RB-08, the zoom-reflow check and the two footer checks: exact browser, viewport, the check performed, and every measurement. |
| `ui005-visual/va-13-main-unchanged.json` | Side-by-side `<main>` measurements for the five auth/onboarding routes, pre-UI005 baseline vs. final build. |

All screenshots were captured **after** the H1 and H2 fixes, so none predates the footer reimplementation. Each was opened and inspected individually; §4 records what that inspection found.

Session default note: the mock session's canonical default is **signed in** as the Sahyadri demo editor (UI004 §7.2). Signed-out captures were produced by loading `/`, activating the header's **Sign out** control, then navigating client-side, so no reload restored the default session.

---

## 1. Visual acceptance scenarios (§23)

| ID | Scenario | Result | Screenshot | Notes |
|---|---|---|---|---|
| VA-01 | Homepage, 1440×900, signed out | **PASS** | `home-1440-signed-out.png` | Serif hero at `--pg-font-size-800` is the unambiguous focal point; the simulation qualification sits opposite the lead in the hero aside, above the fold; primary CTA reads "Enter the demonstration". Bands span full width, content centred at the 72rem measure. No gradient, glow, card grid or stock imagery. |
| VA-02 | Homepage, 1280×800 | **PASS** | `home-1280.png` | Same structure at reduced rhythm (`--pg-space-10`); no region collapses; all seven workflow stages legible in the ink band's contents-page treatment. |
| VA-03 | Homepage, 834×1112 | **PASS** | `home-834.png` | Multi-column regions are single column; header nav still expanded (≥768px); the figure scales without clipping; sections remain visually separated. |
| VA-04 | Homepage, 390×844 | **PASS** | `home-390.png`, `home-390-nav-open.png` | Single column; hero steps down to `--pg-font-size-700` and still dominates; nav collapsed behind the existing `CollapsibleNav` disclosure and operable; CTA not clipped; reading order identical to desktop. No second navigation mechanism was added. |
| VA-05 | Homepage, 320×640 | **PASS** | `home-320.png` | No horizontal scrollbar, no clipped text, no overlap; the geometry figure fits; legend labels remain readable. Confirmed numerically by RB-01. |
| VA-06 | Features, 1280×800 | **PASS** | `features-1280.png` | All seven stages present, each labelled "RESERVED IN THE CURRENT BUILD" and each carrying its complete owner caption ("Reserved for UI009.", "Reserved for UI014.", …) as one governed sentence after the H1 fix; lead-and-follow rhythm visible (Ingest spans 8 columns, the remaining six sit in a 3-column arrangement); "What Pageinator will not be" appears before the closing CTA. No stage implies it works. |
| VA-07 | Pricing, 1280×800 | **PASS** | `pricing-1280.png`, `pricing-tier-detail-1280.png` | Open-decision block sits above the tiers; every tier shows "Not priced" and the adjacent caption "Illustrative — not an offer"; no currency symbol or numeral anywhere; the three tiers share one class list (no elevation); no per-tier action control at all. |
| VA-08 | Pricing, 390×844 | **PASS** | `pricing-390.png` | Tiers stack in DOM order; the open-decision block remains first; each tier's illustrative caption stays adjacent to its name; no horizontal scroll. |
| VA-09 | Security, 1280×800 | **PASS** | `security-1280.png`, `security-limits-detail-1280.png` | "What is true today" and "What is not true today" carry equal heading weight — the limits block is set on the ink band, the strongest treatment on the page, not as fine print. No badge, shield, lock or compliance mark. Design intent is explicitly labelled "None of it is an implemented control today." |
| VA-10 | Contact, resting state | **PASS** | `contact-1280.png` | The "does not send anything" qualification appears above the first field in body text; labels are visible (not placeholder-only); the required field uses UI001's existing affordance; no address, phone number, upload control or consent checkbox. |
| VA-11 | Contact, submitted | **PASS** | `contact-submitted-1280.png` | Heading reads "Nothing was sent"; body states the text was not transmitted or stored; fields cleared; focus moved to the acknowledgement (measured in RB-06). Rendered as `InlineMessage variant="info"` — deliberately not a green success confirmation, and no checkmark. |
| VA-12 | Signed-in CTA state | **PASS** | `home-signed-in.png`, `pricing-signed-in.png` | Both CTA positions on both pages read "Open your demonstration workspace" and resolve to `/org/org-demo-sahyadri/pub/pub-demo-pune-daily/overview`. Exact labels and hrefs recorded under check `VA-12` in `rb-checks.json`. Header shows `SignedInSessionControls` as before; no page-content duplicate of the sign-in or sign-out affordance. |
| VA-13 | Auth and onboarding routes | **PASS (with one intended, stated difference)** | `login-1280.png`, `signup-1280.png`, `forgot-password-1280.png`, `verify-1280.png`, `onboarding-1280.png`, plus `va-13-main-unchanged.json` | See §1.1. |
| VA-14 | RTL | **PASS** | `home-rtl-1280.png`, `features-rtl-1280.png`, `pricing-rtl-1280.png`, `contact-rtl-1280.png`, `footer-rtl-1280.png` | Text aligns to the start edge; sideheads and rules mirror coherently; pricing tiers mirror in visual order as RTL grid flow requires; the figure's legend labels are **not** mirrored (no `scaleX(-1)` is used); the contact form's labels, fields and acknowledgement mirror without overlap; the footer Secondary nav mirrors with "Home" rightmost and the notice on the same edge. Confirmed numerically by RB-07. |

**Screenshot scenarios passed: 14 / 14.**

### 1.1 VA-13 in detail

§20.4 relocates the content measure out of `PublicShell`'s `<main>` into each route's own regions. That relocation must be layout-neutral for rows 6–10.

Verified against a real baseline rather than by inspection: the pre-UI005 commit (`2e131f3`) was built in a temporary `git worktree`, served on port 4174, and probed side by side with the final UI005 build on port 4173. Raw measurements: `ui005-visual/va-13-main-unchanged.json` (`"result": "PASS"`).

For all five routes the following were **byte-identical** between the two builds: `<main>`'s `innerHTML` length, the first child's class (`pg-container`), its bounding box, its computed `padding-inline-start` / `padding-block-start` / `max-inline-size`, and the `<h1>`'s bounding box and computed font.

**The one intended difference** is the new `<nav aria-label="Secondary">` in the footer (§20.4 edit 2), which by design appears on every route wrapped by `PublicShell`, including the auth and onboarding routes. Full-page screenshots therefore differ below the fold. This is the specified change, not a regression of the Container relocation, and it is recorded here rather than presented as "unchanged".

---

## 2. Real-browser acceptance checks (§24)

Executed in `Chrome/153.0.8010.48` headless over CDP against the production build. Every measurement below is reproduced in full in `ui005-visual/rb-checks.json`; the table summarises.

| ID | Check performed | Viewport(s) | Result | Observed |
|---|---|---|---|---|
| RB-01 | `document.documentElement.scrollWidth` vs `clientWidth` on each of the 5 routes at each of the 5 widths | 320, 390, 834, 1280, 1440 | **PASS** | 25/25 combinations equal. Example: `/` at 320 → `scrollWidth 320`, `clientWidth 320`. |
| RB-02 | `axe.run(document)` with **no rule disabled**, all impact levels counted | 1280, 390 | **PASS** | 10/10 route×width runs returned `violations: []`. Unlike the jsdom runs, resolved custom properties and computed colour are visible here, so `color-contrast` is genuinely evaluated. |
| RB-03 | Dispatch `Tab` repeatedly from document start on `/`, recording `document.activeElement` (tag, accessible name, href, computed outline) at each stop | 1280×900 | **PASS** | 44 tab stops. First stop: `A` "Skip to main content". No focus trap (traversal terminates back at `body`). Traversal reaches the footer Secondary nav links. Full ordered list of all 44 stops is in `rb-checks.json`. |
| RB-03b | Click "Features" in the Primary nav, then `history.back()`; read `location.pathname` and `document.activeElement.id` | 1280×900 | **PASS** | Forward → `/features\|pg-route-heading`; back → `/\|pg-route-heading`. |
| RB-04 | Compare each top-level section's `getBoundingClientRect().top` ordering against DOM order | 390, 1280 | **PASS** | All 10 route×width combinations `inDomOrder: true`; per-route region counts and top offsets recorded. |
| RB-05 | CDP `Network.requestWillBeSent` log per route, excluding the document and the `/assets/` bundle | 1280×900 | **PASS** | `thirdParty: []` on all 5 routes. No font, image, script, beacon, XHR or fetch request. |
| RB-06 | `fetch`, `XMLHttpRequest.open`, `XMLHttpRequest.send`, `navigator.sendBeacon`, `WebSocket`, `HTMLFormElement.prototype.submit` instrumented via `Page.addScriptToEvaluateOnNewDocument` **before** load; then fill and submit | 1280×900 | **PASS** | `instrumentedCalls: []`. Form has `action: null`, `method: null`, `target: null`. URL, `document.cookie`, `localStorage.length` and `sessionStorage.length` all unchanged. Acknowledgement rendered ("Nothing was sent…"), textarea cleared to `""`, `focusMovedToAcknowledgement: true`. |
| RB-07 | Set `dir="rtl"`; measure every element in `main` and `footer` against the viewport, sibling-region overlap, horizontal scroll, and footer Secondary nav mirroring | 1280×900, `dir=rtl` | **PASS** | All 5 routes: `elementsOutsideViewport: []`, `siblingRegionOverlaps: 0`, `horizontalScroll: false`, `footerLinkCount: 5`, `footerFirstLinkIsRightmost: true`. |
| RB-08 | WCAG relative-luminance ratio of `getComputedStyle(color)` against the nearest opaque ancestor background, at the rendered size and weight | 1280×900 | **PASS** | 12 samples, all above threshold. See §2.1. |

**Real-browser checks passed: 8 / 8** (9 assertions including RB-03b).

Two additional checks were run in the same session and are recorded in `rb-checks.json`:

| ID | Check | Result | Observed |
|---|---|---|---|
| AC-57 | Zoom reflow (WCAG 1.4.10) by equivalence: 1280px at 200% = 640 CSS px, at 400% = 320 CSS px | **PASS** | No horizontal scroll on any of the 5 routes at either equivalent width. |
| H2-footer / H2-footer-focus | Footer Secondary nav geometry and focusability after the shell.css additions were removed | **PASS** | See §3. |

### 2.1 RB-08 measured contrast ratios

| Sample | Ratio | Size / weight | Threshold | Result |
|---|---|---|---|---|
| Ink band body | 16.45:1 | 16px / 400 | 4.5:1 | PASS |
| Ink band lead | 16.45:1 | 20px / 400 | 4.5:1 | PASS |
| Ink band note (muted) | 11.08:1 | 12px / 400 | 4.5:1 | PASS |
| Ink band availability label | 11.08:1 | 12px / 500 | 4.5:1 | PASS |
| Ink band section title | 16.45:1 | 32px / 600 | 3:1 (large) | PASS |
| Ink band standing head | 11.08:1 | 12px / 600 | 4.5:1 | PASS |
| Subtle band body | 15.02:1 | 16px / 400 | 4.5:1 | PASS |
| Standing head on subtle band | 6.90:1 | 12px / 600 | 4.5:1 | PASS |
| Primary CTA label (action surface) | 6.70:1 | 20px / 500 | 4.5:1 | PASS |
| Primary CTA on ink band | 16.45:1 | 20px / 500 | 4.5:1 | PASS |
| Footer Secondary nav link | 6.70:1 | 14px / 500 | 4.5:1 | PASS |
| Footer simulation notice | 15.02:1 | 12px / 400 | 4.5:1 | PASS |

The CTA inverts to a light surface on the ink band deliberately: `--pg-color-action` against `--pg-color-text` is roughly 2.0:1, below the 3:1 non-text threshold for a control boundary. That inversion is why the on-ink CTA measures 16.45:1.

---

## 3. Footer revalidation after the H2 shell-scope fix

H2 removed every UI005 addition from `frontend/src/app/shell.css` and rebuilt the Secondary footer navigation from UI001 primitives alone — `Cluster as="nav"` for the wrapping row and tokenized gap, `Stack` for the separation from the notice, and `pg-button pg-button--quiet pg-type-body-small` on each router `Link` for the tokenized colour and type size. No stylesheet, no inline pixel values, no new component.

Screenshots taken with the footer scrolled into view, plus measured geometry (check `H2-footer` in `rb-checks.json`):

| Width | Screenshot | Links | Rows used | Clipped | Page overflow | Verdict |
|---|---|---|---|---|---|---|
| 1440 | `footer-1440.png` | 5 | 1 | no | no | PASS |
| 1280 | `footer-1280.png` | 5 | 1 | no | no | PASS |
| 834 | `footer-834.png` | 5 | 1 | no | no | PASS |
| 390 | `footer-390.png` | 5 | 1 | no | no | PASS |
| 320 | `footer-320.png` | 5 | 2 (clean wrap) | no | no | PASS |
| 1280 RTL | `footer-rtl-1280.png` | 5 | 1 | no | no | PASS — "Home" rightmost, notice on the same edge |

Every width reports `display: flex`, `flexWrap: wrap`, `ariaLabel: "Secondary"`, the five labels `Home, Features, Pricing, Security, Contact` and the five hrefs `/`, `/features`, `/pricing`, `/security`, `/contact`. At 320px the row wraps to two lines with no clipping and no overflow. `H2-footer-focus` confirms the first footer link is focusable (`tabIndex: 0`, `document.activeElement` matches) and receives UI001's `:focus-visible` outline.

The specific defects the fix pass was told to watch for — collapsed links, broken spacing, overflow, inaccessible focus, poor wrapping, RTL misalignment — were each checked and none is present.

One implementation detail found by inspecting `footer-1440.png` during this pass and corrected: the first attempt used `pg-button--sm`, whose inline padding inset the link row about 9px from the notice beneath it. Dropping the size modifier (`pg-button` contributes no padding of its own) and widening the `Cluster` gap to `--pg-space-5` restored exact alignment at the container edge. The screenshots above are from the corrected version.

---

## 4. Design-quality assessment (§8.3)

Each screenshot was assessed against the spec's own question: *does this look like a product a newspaper would buy, or like a template with a newspaper theme applied?*

Three defects were found by inspection, fixed, and re-verified. All are recorded because automated tests passed while they were present, which is the case §23 exists to catch:

1. **Collapsed vertical rhythm.** `.pg-public__measure > * + *` and the typography classes' `margin: 0` had equal specificity, and the later rule won — every section's heading hugged the paragraph beneath it across all five surfaces. Fixed by qualifying the flow rules with `.pg-public`; a comment in `public.css` records why the prefix is load-bearing.
2. **Half-empty grid at laptop width and above.** Measure-constrained prose under a full-width heading left roughly half the 72rem grid empty, which read as unfinished rather than composed. Fixed by introducing a sidehead layout (`Section`): the standing head sits in a narrow start column with the prose beside it, which is how a newspaper sets a section label.
3. **Footer link row misaligned by ~9px** after the H2 rebuild — see §3.

A smaller correction: the homepage's open-questions region previously nested the security block as an `<h3>` under an `<h2>` reading "Packaging is not decided", which mis-stated the information architecture. The region now carries a neutral `<h2>` ("Two decisions that are still open") with both topics as siblings beneath it.

Remaining observations, recorded as judgement rather than defects:

- The page-geometry figure leaves empty space below the column grid, which is faithful to a real page's bottom margin but reads as slightly sparse at large sizes. Kept, because filling it would require inventing content the diagram must not show.
- The pricing open-decision `Surface` spans the full sidehead body while its prose is measure-constrained, leaving a wide right edge inside the box. Acceptable at all five widths; noted for a future pass.
- Footer links use UI001's quiet hover tint rather than an underline, because an underline-on-hover rule would require CSS this shell is not permitted to add.

---

## 5. Scope of what this document does **not** claim

- Chrome only. Firefox and Safari were not exercised.
- No real assistive-technology pass (VoiceOver, NVDA, JAWS) was performed. RB-02/RB-03 verify machine-checkable structure and focus behaviour only.
- No physical-device testing; the five widths were emulated via `Emulation.setDeviceMetricsOverride`.
- Zoom reflow was verified by CSS-width equivalence (640px and 320px viewports), not by driving the browser's own zoom control.
- Print stylesheets, reduced-transparency and forced-colours modes were not exercised beyond what `axe-core` covers.
- `prefers-reduced-motion` is verified by stylesheet assertion in `tests/ui005/boundary.test.ts`, not by a real-browser media-query emulation.
