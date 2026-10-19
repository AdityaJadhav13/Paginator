# UI001 — UI Foundation

Status: implementation-ready feature specification  
Prepared: 2026-09-17  
Milestone: RM01 Foundation  
Gate contribution: G1 honest UI simulation  
Implementation authorization: separate authorization is still required; this document does not initialize or install anything.

## 1. Objective and authority

UI001 establishes Pageinator's durable presentation foundation before any product screen, route shell, service adapter, editor, or publishing capability is built. It provides design tokens, layout primitives, accessible controls, and an explicit application-status vocabulary. A minimal showcase demonstrates those contracts using fictional data that cannot be mistaken for production authentication, authorization, tenancy, persistence, geometry, or release behavior.

This specification is bounded by:

- `docs/MASTER_BUILD_SPEC.md` §§1, 5, 10, and 11, especially the immediate UI boundary and dependency-adoption rules.
- `docs/IMPLEMENTATION_ROADMAP.md` RM01 and the G1 truthfulness boundary.
- `specs/INITIAL_IMPLEMENTATION_BACKLOG.md` shared acceptance contract and UI001.
- `docs/reviews/ARCHITECTURE_RECONCILIATION_ROUND_1.md` H07, M12, L04, X08, BLV2-01, BLV2-07, and §L.
- Supporting detail from `docs/architecture/PHASE_15_UI_FIRST.md`, `PHASE_14_TESTING_VALIDATION.md`, and `PHASE_16_REPOSITORY_DEVELOPMENT.md` where cited by the authoritative inputs.

Relevant normalized requirements are R38 and R40. UI001 does not close any publishing, press, security, tenancy, persistence, or product-owner decision.

## 2. Scope

UI001 includes:

- Pageinator design tokens for typography, spacing, colour, focus, borders, radii, elevation, and motion.
- Typography roles and a system-font baseline that does not imply newspaper composition or bundled font rights.
- Small layout primitives built with semantic elements and CSS logical properties.
- Foundational controls needed by later UI units: Button, IconButton, Field, TextInput, TextArea, Select, Checkbox, RadioGroup, Dialog, InlineMessage, StatusIndicator, and ProgressIndicator.
- Keyboard behavior, visible focus, semantic HTML, accessible names and descriptions, error association, disabled behavior, status announcements, LTR, and RTL behavior.
- A reusable presentation contract for `simulated`, `pending`, `saved-intention`, `recomposing`, `confirmed-proof`, `stale`, `failed`, and `approved-candidate`.
- Disposable demonstrations for organization context, publication context, capabilities, denied capabilities, status transitions, and revision/proof/candidate identities.
- A minimal single-page showcase only to exercise and test UI001. It is not an application shell and has no routes.

## 3. Explicit exclusions

UI001 must not include or scaffold:

- UI002 routing, public/application/editor shells, deep links, or navigation behavior.
- UI003 production or mock service adapters beyond static UI001 demonstration fixtures.
- Production authentication, authorization, tenancy, persistence, DTOs, document schemas, or edition schemas.
- Newspaper editing, page composition, physical geometry, text shaping, canvas/SVG scene rendering, PDF generation, preflight, archive, ingestion, billing, or edition-planning behavior.
- Native or WASM publishing dependencies.
- A router, global state library, data-fetching library, form library, UI framework, CSS framework, icon package, editor, canvas library, composition library, authentication SDK, or persistence package.
- Network requests, credentials, browser storage, service workers, cookies, cloud state, generated API clients, or production environment configuration.
- Claims of press fidelity, production security, real permissions, durable save, publication, or release.

## 4. Non-negotiable semantic distinctions

The presentation layer must preserve the following distinctions in labels, help text, test names, and fixtures.

| Concept | Exact meaning in UI001 | Must never imply |
|---|---|---|
| Simulated | The displayed result or transition is fictional and exists only to demonstrate UI behavior. | Real service work, validated geometry, press readiness, or production enforcement. |
| Pending | A fictional action has been requested but has no durable acknowledgment. | Saved, resolved, approved, or published. |
| Saved intention | An editable intention is shown as durably acknowledged in the scenario. Its layout may remain unresolved. | Resolved output or current proof. |
| Recomposing | A fictional resolution attempt is in progress for a named revision. Any older proof remains visibly old or stale. | Current authoritative geometry or a successful result. |
| Confirmed proof | The scenario's authoritative proof is bound to the displayed editable revision and proof identity. | Approval, publication, press acceptance, or PDF qualification. |
| Stale | A proof or result belongs to an older revision or dependency identity and is not current. | Current revision proof or a safe approval basis. |
| Failed | The requested operation did not complete. Prior confirmed proof and unsaved/saved intentions remain separately identified. | Success, rollback of the user's intention, or permission to continue as if valid. |
| Approved candidate | An exact candidate identity has fictional approval evidence in the demonstration. | Published edition, archive commitment, release, press delivery, or physical acceptance. |

Additional rules:

1. `saved intention` and `confirmed proof` must use different labels, icons, descriptions, and test assertions.
2. Every simulated example must display the word **Simulated** in its nearby status or containing demonstration banner.
3. A stale proof must show both its proof revision and the newer current editable revision when both exist.
4. An approved candidate must show the candidate identity and the clarification **Not published**.
5. A denied-capability fixture must say **Demonstration only — production authorization is not evaluated here**.
6. Colour and iconography may reinforce a state but may not be its only signal.

## 5. Durable presentation contracts

### 5.1 Presentation state type

The durable contract is a UI vocabulary, not a backend enum or production DTO:

```ts
type PresentationState =
  | "simulated"
  | "pending"
  | "saved-intention"
  | "recomposing"
  | "confirmed-proof"
  | "stale"
  | "failed"
  | "approved-candidate";
```

`StatusIndicator` accepts only presentation data:

```ts
interface StatusIndicatorProps {
  state: PresentationState;
  subject: string;
  detail?: string;
  revisionLabel?: string;
  relatedRevisionLabel?: string;
  candidateLabel?: string;
  announcement?: "off" | "polite" | "assertive";
}
```

Rules:

- The component owns the canonical visible label and semantic tone for each state; callers cannot replace it with misleading text.
- `subject` describes the thing in the state, such as “Layout proof”. It does not encode authorization or domain behavior.
- `revisionLabel`, `relatedRevisionLabel`, and `candidateLabel` are opaque display strings. UI001 does not parse them or define production identifier formats.
- `approved-candidate` requires `candidateLabel` and always renders “Not published”.
- `stale` requires enough detail to identify what is old; the fixture contract requires both old and current revision labels.
- `failed` requires a human-readable detail and uses an assertive announcement only when failure follows a user-initiated action.
- Initial page render is not announced. `pending`, `saved-intention`, `recomposing`, `confirmed-proof`, and `stale` transitions use polite announcements when they result from an action. Rapid progress changes are coalesced so assistive technology is not flooded.

### 5.2 Replaceability boundary

Durable foundation code may depend on React props, semantic HTML, CSS variables, and presentation-only types. It must not import demo fixtures, service interfaces, storage, routing, permission evaluators, domain DTOs, or engine types.

Later units may map their domain state into `PresentationState`; they must not treat this UI union as the canonical job, document, export, approval, or release lifecycle. Transport, production DTOs, authentication and authorization providers, persistence, canvas/rendering, editor/input, composition, publishing, edition-planning, and press-profile implementations remain replaceable.

## 6. Design-token contract

Tokens are CSS custom properties prefixed `--pg-` and exposed from one durable token stylesheet. Components must consume semantic tokens rather than raw colour, spacing, focus, or typography values. Demo fixtures may not introduce a second token system.

### 6.1 Typography

Use operating-system fonts only. Do not download, bundle, or imply qualification of newspaper fonts.

```text
--pg-font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
--pg-font-mono: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace

--pg-font-size-100: 0.75rem   / --pg-line-height-100: 1rem
--pg-font-size-200: 0.875rem  / --pg-line-height-200: 1.25rem
--pg-font-size-300: 1rem      / --pg-line-height-300: 1.5rem
--pg-font-size-400: 1.25rem   / --pg-line-height-400: 1.75rem
--pg-font-size-500: 1.5rem    / --pg-line-height-500: 2rem
--pg-font-size-600: 2rem      / --pg-line-height-600: 2.5rem

--pg-font-weight-regular: 400
--pg-font-weight-medium: 500
--pg-font-weight-semibold: 600
--pg-font-weight-bold: 700
```

Required roles:

| Role | Size/line height | Weight | Intended use |
|---|---|---|---|
| `display` | 600/600 | bold | Showcase title only; later public/product use. |
| `page-title` | 500/500 | bold | One page or panel title. |
| `section-title` | 400/400 | semibold | Section heading. |
| `body` | 300/300 | regular | Default prose and control values. |
| `body-small` | 200/200 | regular | Secondary explanatory text. |
| `label` | 200/200 | medium | Form and compact UI labels. |
| `caption` | 100/100 | regular | Supplementary metadata; never the sole error text. |
| `code` | 200/200 mono | regular | Opaque demonstration identifiers. |

Headings use semantic `h1`–`h3` according to document structure; typography roles do not determine heading rank.

### 6.2 Spacing, size, radius, border, and elevation

```text
--pg-space-0: 0
--pg-space-1: 0.125rem
--pg-space-2: 0.25rem
--pg-space-3: 0.5rem
--pg-space-4: 0.75rem
--pg-space-5: 1rem
--pg-space-6: 1.5rem
--pg-space-7: 2rem
--pg-space-8: 3rem
--pg-space-9: 4rem

--pg-control-height-sm: 2rem
--pg-control-height-md: 2.5rem
--pg-control-height-lg: 3rem
--pg-content-measure: 72rem
--pg-reading-measure: 70ch

--pg-radius-sm: 0.25rem
--pg-radius-md: 0.5rem
--pg-radius-lg: 0.75rem
--pg-radius-pill: 999px
--pg-border-width: 1px
--pg-shadow-raised: 0 0.25rem 1rem rgb(15 23 42 / 0.12)
```

Spacing props on layout primitives accept only token keys `0`–`9`; they do not accept arbitrary pixel values.

### 6.3 Colour semantics

Initial light-theme values are engineering defaults. They are not brand or press-colour decisions.

| Token | Value | Semantic use |
|---|---:|---|
| `--pg-color-canvas` | `#F8FAFC` | Page background. |
| `--pg-color-surface` | `#FFFFFF` | Controls and surfaces. |
| `--pg-color-surface-subtle` | `#F1F5F9` | Grouped content background. |
| `--pg-color-text` | `#17202A` | Primary text. |
| `--pg-color-text-muted` | `#4B5563` | Secondary text. |
| `--pg-color-border` | `#64748B` | Control boundaries requiring non-text contrast. |
| `--pg-color-border-subtle` | `#CBD5E1` | Decorative separation only. |
| `--pg-color-action` | `#1D4ED8` | Primary action/background and links. |
| `--pg-color-action-hover` | `#1E40AF` | Primary action hover. |
| `--pg-color-on-action` | `#FFFFFF` | Text/icons on primary action. |
| `--pg-color-focus` | `#7C3AED` | Focus indicator. |
| `--pg-color-danger` | `#B91C1C` | Failure/error foreground or filled background. |
| `--pg-color-success` | `#166534` | Confirmed/success foreground or filled background. |
| `--pg-color-warning` | `#854D0E` | Stale/warning foreground or filled background. |
| `--pg-color-disabled-bg` | `#E5E7EB` | Native-disabled control background. |
| `--pg-color-disabled-text` | `#6B7280` | Native-disabled control text. |

Status accents use these exact initial values: simulated `#5B21B6`, pending `#1D4ED8`, saved intention `#0F766E`, recomposing `#9A3412`, confirmed proof `#166534`, stale `#854D0E`, failed `#B91C1C`, approved candidate `#065F46`. Status text must still include the canonical label.

Required contrast is WCAG AA as an engineering baseline: at least 4.5:1 for normal text, 3:1 for large text, and 3:1 for meaningful component boundaries and focus indicators against adjacent colours. Disabled controls remain perceivable and are never distinguished by opacity alone. Forced-colours mode must retain a visible boundary and focus indicator.

### 6.4 Focus and motion

- Every interactive element uses a visible `:focus-visible` indicator: `2px solid var(--pg-color-focus)` with `2px` outline offset.
- Components may not remove focus outlines unless they replace them with this tokenized indicator.
- Error styling does not replace focus styling; both must remain identifiable together.
- Focus order follows DOM and reading order. CSS reordering is prohibited in durable layout primitives.
- Motion is limited to colour/opacity and short nonessential transitions. Default duration is `150ms`; progress indication may rotate continuously only when accompanied by accessible text.
- `prefers-reduced-motion: reduce` disables nonessential transitions and spinner rotation while preserving state text.

## 7. Foundational layout primitives

All primitives accept `className`, appropriate semantic element selection where specified, and tokenized spacing. They use logical properties (`margin-inline`, `padding-block`, `inline-size`, `inset-inline-*`) so `dir="rtl"` works without mirrored component code.

| Primitive | Contract | Prohibited behavior |
|---|---|---|
| `Stack` | Vertical flow with tokenized gap; renders `div`, `section`, `ul`, or `ol` as requested. | Absolute positioning or visual reordering. |
| `Inline` | Inline/flex flow with tokenized gap, wrapping option, and logical alignment. | Left/right-specific spacing props. |
| `Cluster` | Wrapping group for actions/tags with start/end/space-between alignment. | Changing DOM order in RTL. |
| `Grid` | CSS grid with a bounded `minItemSize` token and gap token; responsive by available width. | Product breakpoint policy or page-composition geometry. |
| `Container` | Centers ordinary UI content with `--pg-content-measure` and logical padding. | Application shell/sidebar behavior. |
| `Surface` | Groups content with semantic background, border, radius, and optional raised elevation. | Dialog behavior or implied document canvas. |
| `VisuallyHidden` | Hides text visually while keeping it available to assistive technology. | Hiding focusable controls or product content. |

## 8. Foundational control behavior

Controls must forward native attributes and refs needed by later composition. They must not wrap native behavior in a Pageinator domain model.

### 8.1 Actions

- `Button` renders a native `button` and defaults to `type="button"`. Variants are `primary`, `secondary`, `quiet`, and `danger`; sizes are `sm`, `md`, and `lg`.
- Enter and Space activate an enabled button through native behavior. No custom key handler duplicates activation.
- `IconButton` is a button with an icon plus a required accessible name. Tooltip behavior is out of scope; visible text is preferred where space permits.
- Navigation links are real anchors when introduced by UI002. UI001 must not create a button that pretends to be a route link.

### 8.2 Fields and selection

- `Field` associates one visible label, optional description, and zero or more error messages with one native control using stable generated IDs.
- `TextInput` and `TextArea` expose native value/input/change behavior. Placeholder text is never the accessible name.
- `Select` is a native single-select. Custom combobox behavior is deferred until a feature requires it.
- `Checkbox` uses a native checkbox and visible label. Space toggles it when enabled.
- `RadioGroup` uses `fieldset`, `legend`, and native radios. Browser-native arrow-key and Space behavior is preserved.
- Invalid controls set `aria-invalid="true"`; error IDs are included in `aria-describedby`; errors remain visible text.
- Required state is conveyed semantically and visibly. An asterisk alone is insufficient.

### 8.3 Disabled and denied states

- A truly unavailable native control uses `disabled`, is omitted from sequential focus, and has adjacent visible explanatory text when the reason matters.
- A capability-denied action that users must discover may use `aria-disabled="true"` so it remains focusable. It must block pointer and keyboard activation and reference a visible denial explanation.
- `aria-disabled` is never treated as authorization enforcement. Demo denied states include the required demonstration disclaimer.
- Read-only fields use `readOnly`, not `disabled`, when their value must remain selectable or submitted by a future form.

### 8.4 Dialog

- `Dialog` uses the native `dialog` element unless exact browser review shows a supported-platform defect. No third-party dialog dependency is introduced by UI001.
- Opening moves focus to the dialog heading or first appropriate control. Tab and Shift+Tab remain within an open modal dialog.
- Escape closes only a dismissible dialog. Destructive or in-progress confirmation may require an explicit action.
- Closing restores focus to the invoker when it still exists.
- A visible heading supplies the accessible name; descriptive text is associated when present.
- Background content is not interactive while the modal dialog is open.

### 8.5 Messages and progress

- `InlineMessage` variants are `info`, `success`, `warning`, and `error`, each with visible heading/text and a non-colour cue.
- Errors caused by a submitted user action use `role="alert"`. Static guidance and messages present on initial render do not.
- `ProgressIndicator` uses native `progress` for known progress. Unknown progress uses text plus a decorative spinner hidden from assistive technology.
- Progress updates are announced at meaningful state changes, not every numeric update.

## 9. Directionality and responsive behavior

- The showcase provides an LTR/RTL direction toggle implemented by setting `dir` on the showcase root. It does not persist the selection.
- Components inherit direction; none hard-code `dir="ltr"`.
- Durable CSS uses logical properties. Directional icons, if any, are inline project-owned SVG and mirror only when their meaning is directional. Status and action icons do not mirror.
- Text remains in logical DOM order. Flex/grid `order`, `row-reverse`, and CSS-generated readable text are prohibited.
- Mixed-direction fixture identifiers are wrapped with `bdi`; opaque revision/proof/candidate strings remain readable inside RTL content.
- The showcase remains usable at 320 CSS pixels without horizontal page scrolling. This validates primitive flexibility only and does not establish product viewport support.

## 10. Demonstration fixtures

All fixtures live under the disposable `src/demo/ui001/` boundary. They are static, deterministic, fictional, and contain `fixtureKind: "ui001-demo-only"`. They are never imported by durable UI modules.

### 10.1 Context fixtures

| Fixture | Display data | Mandatory qualification |
|---|---|---|
| Organization | `org-demo-sahyadri`, “Sahyadri Media Cooperative” | “Fictional organization context” |
| Publication A | `pub-demo-pune-daily`, “Pune Daily Ledger”, locale `en-IN`, direction `ltr` | “Fictional publication context” |
| Publication B | `pub-demo-urdu-evening`, “Deccan Evening Record”, locale `ur-IN`, direction `rtl` | “Fictional publication context; RTL display demonstration” |

These IDs test scoped presentation only. They do not establish tenant keys, API paths, database identifiers, or authorization boundaries.

### 10.2 Capability fixtures

Use presentation-only capability strings:

- Allowed example: `demo.edition.view` — “View this demonstration edition”.
- Allowed example: `demo.edition.edit-intention` — “Edit a fictional intention”.
- Denied example: `demo.candidate.approve` — “Approval demonstration unavailable for this role”.
- Denied example: `demo.publication.settings` — “Settings demonstration unavailable in this context”.

Every capability card displays **Demonstration only — production authorization is not evaluated here**. No fixture hides data as proof of isolation, and no component claims the denial came from a real policy engine.

### 10.3 Revision, proof, and candidate fixtures

- Editable revision: `demo-rev-018`.
- Newer editable revision: `demo-rev-019`.
- Confirmed proof for revision 18: `demo-proof-018-a`.
- Approved candidate derived from proof 18: `demo-candidate-042`.

These strings are opaque display examples and define no production format.

### 10.4 Deterministic transition scenarios

The showcase exposes explicit buttons to advance/reset these in-memory scenarios; timers and random failures are prohibited.

1. **Save then resolve:** simulated → pending (`demo-rev-018`) → saved intention (`demo-rev-018`) → recomposing (`demo-rev-018`) → confirmed proof (`demo-proof-018-a`, `demo-rev-018`).
2. **Proof becomes stale:** confirmed proof for `demo-rev-018` → saved intention at `demo-rev-019` while `demo-proof-018-a` remains visible as stale.
3. **Resolution fails safely:** recomposing `demo-rev-019` → failed for revision 19 while the last confirmed proof remains explicitly bound to revision 18.
4. **Candidate approval is not publication:** confirmed proof `demo-proof-018-a` → approved candidate `demo-candidate-042`, always accompanied by “Not published”.

Reset returns all scenarios to their defined initial state in memory. Reload persistence is out of scope.

## 11. Repository design

The expected UI001 repository shape is:

```text
frontend/
  package.json
  package-lock.json
  index.html
  tsconfig.json
  vite.config.ts
  vitest.config.ts
  src/
    main.tsx
    ui/
      tokens.css
      base.css
      contracts/
        presentation-state.ts
      layout/
        Stack.tsx
        Inline.tsx
        Cluster.tsx
        Grid.tsx
        Container.tsx
        Surface.tsx
        VisuallyHidden.tsx
      controls/
        Button.tsx
        IconButton.tsx
        Field.tsx
        TextInput.tsx
        TextArea.tsx
        Select.tsx
        Checkbox.tsx
        RadioGroup.tsx
        Dialog.tsx
        InlineMessage.tsx
        StatusIndicator.tsx
        ProgressIndicator.tsx
      index.ts
    demo/
      ui001/
        fixtures.ts
        scenarios.ts
        Ui001Showcase.tsx
        ui001-showcase.css
    test/
      setup.ts
      contrast.ts
      render.tsx
  tests/
    ui001/
      tokens.test.ts
      layout.test.tsx
      controls.test.tsx
      dialog.test.tsx
      accessibility.test.tsx
      rtl.test.tsx
      status-semantics.test.tsx
      boundary.test.ts
```

Do not create `backend/`, `workers/`, `publishing/`, `schemas/`, `infra/`, route folders, service adapters, or feature folders for UI001.

### 11.1 Durable foundation code

`src/ui/**`, token styles, presentation-state types, and their behavior tests are intended to survive later engine and service selections. “Durable” means the contract is intended for reuse; it does not exempt code from future review or change.

### 11.2 Disposable demonstration fixtures

`src/demo/ui001/**`, fixture identifiers, capability strings, transition reducer/state, and showcase layout are disposable. They may be replaced or removed when UI002/UI003 supply application shells and scenario adapters. They define no production schema and may not be imported from `src/ui/**`.

`boundary.test.ts` verifies this direction by scanning durable UI module imports and failing if they reference `/demo/`, service, routing, storage, auth, editor, canvas, composition, or publishing modules.

## 12. Dependency proposal and adoption gate

No package manifest or lockfile existed when this specification was authored. The environment reported Node `25.8.2` and npm `11.11.1`; those observations are not a project runtime commitment. Before implementation, confirm each package's engine compatibility, provenance, transitive tree, advisories, browser-distribution implications, and license notices. Pin approved exact versions in `package.json` and the generated lockfile; do not use `^`, `~`, `latest`, beta, RC, canary, or nightly ranges.

Registry metadata was checked on 2026-09-17. These versions are exact **review targets**, not approvals:

| Dependency | Target version | License | Class | Why required |
|---|---:|---|---|---|
| `react` | `19.3.0` | MIT | Required runtime | Approved engineering direction for component composition. |
| `react-dom` | `19.3.0` | MIT | Required runtime | Renders React components into semantic browser DOM. |
| `typescript` | `7.0.2` | Apache-2.0 | Required development | Type-checks component contracts and fixtures. |
| `vite` | `8.3.0` | MIT | Required development | Minimal dev/build tool in the approved engineering direction. |
| `@vitejs/plugin-react` | `6.1.1` | MIT | Required development | React JSX transform and Vite integration. |
| `vitest` | `5.0.1` | MIT | Required development | Component and semantic unit-test runner aligned with Vite. |
| `@testing-library/react` | `16.3.3` | MIT | Required development | Tests rendered behavior through accessible DOM queries. |
| `@testing-library/user-event` | `14.6.7` | MIT | Required development | Exercises realistic keyboard and pointer interactions in component tests. |
| `jsdom` | `30.1.0` | MIT | Required development | DOM environment for focused UI001 component tests. |
| `axe-core` | `4.13.0` | MPL-2.0 | Required development | Automated accessibility-rule checks; results supplement semantic tests and review. |
| `@types/react` | `19.3.0` | MIT | Required development | React TypeScript declarations. |
| `@types/react-dom` | `19.3.0` | MIT | Required development | React DOM TypeScript declarations. |
| `@testing-library/jest-dom` | `7.0.1` | MIT | Optional convenience | Readable DOM matchers only; omit if Vitest/native assertions remain clear. |

Required dependencies proposed: **12**. Optional dependencies proposed: **1**.

The adoption review must also select and record a supported Node runtime. The observed Node 25 build must not be chosen merely because it is present locally. If any target fails compatibility, security, maintenance, or license review, update this specification or record the authorized replacement before installation; do not silently substitute versions.

No UI component framework is proposed. Use native controls, project CSS, and project-owned inline SVG where a non-colour cue is needed. Storybook, Playwright, a router, an icon library, CSS tooling, and visual-regression infrastructure are deferred until a later unit proves the need.

## 13. Test specification

Tests verify semantics and interaction. Passing screenshots alone cannot satisfy UI001.

### 13.1 Component tests

- Render every control in default, disabled, invalid, and relevant message/status variants.
- Assert native element choice, label/control association, description/error relationships, required state, names, and forwarded attributes.
- Assert fields keep errors visible and associated; Button defaults to `type="button"`.
- Assert layout primitives render the requested semantic element and only tokenized gap values.

### 13.2 Keyboard and focus tests

- Tab through the showcase in DOM order in both directions.
- Activate buttons with Enter and Space; toggle checkbox with Space; exercise native radio keyboard behavior.
- Open Dialog from the keyboard, verify initial focus, contained Tab/Shift+Tab navigation, permitted Escape behavior, and focus restoration.
- Verify disabled controls do not activate. Verify `aria-disabled` denied actions remain discoverable, do not activate, and reference their explanation.
- Inspect the durable stylesheet for the required `:focus-visible` rule and ensure error selectors do not suppress it.

### 13.3 Accessibility checks

- Run `axe-core` against every showcase section and each dialog-open state with zero serious or critical violations.
- Assert one page `h1`, ordered heading levels, semantic fieldsets/legends, accessible names, and no placeholder-only labeling.
- Assert user-triggered errors use alert semantics, ordinary status changes use a polite live region, and initial static content is not unnecessarily live.
- Compute contrast from token values in a test helper and assert the ratios in §6.3. Automated checks do not replace reviewer inspection.
- Review forced-colours and reduced-motion CSS rules structurally.

### 13.4 RTL checks

- Render the full showcase under `dir="rtl"` and `lang="ur-IN"`, then repeat under `dir="ltr"` and `lang="en-IN"`.
- Assert component names, labels, descriptions, errors, and keyboard order remain correct in both modes.
- Assert fixture identifiers use `bdi`; status/action icons keep their semantic orientation.
- Scan durable CSS for physical directional declarations (`margin-left/right`, `padding-left/right`, `left`, `right`, `border-left/right`) unless a documented non-directional exception is present. Use logical equivalents.

### 13.5 Status-semantic tests

- Table-test all eight states for canonical label, non-colour cue, description, and announcement policy.
- Assert saved intention never contains “resolved” or “proof confirmed”.
- Assert simulated state and every demo scenario expose “Simulated”.
- Assert stale state presents old and current revision labels.
- Assert approved candidate requires an identity and always exposes “Not published”.
- Assert a failed recomposition preserves and separately labels the last confirmed proof.
- Assert status transitions follow only the deterministic sequences in §10.4 and reset cleanly.
- Assert capability denial always carries the production-enforcement disclaimer.

### 13.6 Required verification commands after implementation

Exact script names may be implemented as `typecheck`, `test`, and `build`. Completion requires all three to exit successfully:

```text
npm run typecheck
npm test -- --run
npm run build
```

No E2E browser matrix, screenshot baseline, publishing golden, security test, or performance qualification is required for UI001.

## 14. Objective acceptance criteria

UI001 passes only if all criteria below pass.

1. **AC-01:** Only `frontend/` implementation files and the already-approved specification are involved; no backend, worker, publishing, schema, infra, route, or feature scaffold exists.
2. **AC-02:** The dependency review records the exact approved versions, licenses, engine compatibility, provenance, advisories, and transitive tree before installation or lockfile creation.
3. **AC-03:** All approved package versions are pinned exactly, and required typecheck, test, and build commands exit successfully.
4. **AC-04:** Durable tokens exist for every value specified in §6, and durable components do not contain unapproved raw colour, spacing, focus, or typography values.
5. **AC-05:** Token contrast tests meet the thresholds in §6.3 for all specified text, action, status, control-boundary, and focus combinations.
6. **AC-06:** All eight typography roles render with the specified size, line height, weight, and font family without external font requests.
7. **AC-07:** Stack, Inline, Cluster, Grid, Container, Surface, and VisuallyHidden satisfy their contracts and accept only bounded tokenized spacing.
8. **AC-08:** Button and IconButton use native button semantics, have accessible names, and respond once to native Enter/Space activation when enabled.
9. **AC-09:** Field, TextInput, TextArea, and Select have visible labels; descriptions and errors are programmatically associated; invalid and required states are both visible and semantic.
10. **AC-10:** Checkbox and RadioGroup preserve native keyboard behavior and visible labels, including under RTL.
11. **AC-11:** Disabled controls cannot activate; discoverable denied controls use `aria-disabled`, cannot activate, and reference a visible denial explanation.
12. **AC-12:** Dialog has a visible accessible name, moves and contains focus, follows its dismissibility rule, prevents background interaction, and restores focus on close.
13. **AC-13:** InlineMessage and ProgressIndicator communicate their meaning with text and semantics without relying on colour, animation, or an icon alone.
14. **AC-14:** Every interactive component has the specified visible focus indicator, including when invalid, in forced-colours mode, and under keyboard navigation.
15. **AC-15:** Reduced-motion behavior removes nonessential animation without hiding progress or state information.
16. **AC-16:** The complete showcase works under LTR and RTL without changed DOM order, hard-coded LTR direction, physical-direction CSS, clipped labels, or page-level horizontal scrolling at 320 CSS pixels.
17. **AC-17:** `PresentationState` contains exactly the eight specified presentation states and is not reused as a production lifecycle or service DTO.
18. **AC-18:** Each state renders its canonical visible label, semantic tone, non-colour cue, and specified announcement behavior.
19. **AC-19:** Saved intention is never labeled or announced as resolved output or confirmed proof.
20. **AC-20:** Simulated geometry/results are visibly labeled Simulated and never described as authoritative, press-ready, or validated.
21. **AC-21:** A stale proof displays its older proof revision and the newer editable revision and is never described as current.
22. **AC-22:** Approved candidate always displays its candidate identity and “Not published”; no fixture exposes release, archive, delivery, or press-acceptance success.
23. **AC-23:** Failed recomposition retains the current intention and separately identifies the last confirmed proof rather than silently reverting or advancing state.
24. **AC-24:** Organization and publication fixtures are fictional, visibly qualified, deterministic, and used only for presentation context.
25. **AC-25:** Every capability/denial fixture displays the required disclaimer and makes no production authorization, security, or isolation claim.
26. **AC-26:** The four transition scenarios follow §10.4 exactly, use no randomness or network request, and reset to their initial in-memory state.
27. **AC-27:** Durable `src/ui/**` code has no imports from demo, routing, service, storage, authentication, authorization, editor, canvas, composition, publishing, edition-planning, or press-profile modules.
28. **AC-28:** `axe-core` reports zero serious or critical violations for every showcase section and dialog-open state, with semantic assertions also passing.
29. **AC-29:** No network, credential collection, browser persistence, service worker, cookie, cloud write, payment, AI, upload, canvas, PDF, or native/WASM behavior exists.
30. **AC-30:** A reviewer can identify durable foundation code and disposable demonstration fixtures from paths alone and can remove `src/demo/ui001/**` without breaking `src/ui/**` tests or typechecking.

Acceptance criteria count: **30**.

## 15. Ordered implementation plan

### Task 1 — Adopt and initialize the bounded frontend toolchain

- **Purpose:** Create only the minimal React/TypeScript/Vite and test setup needed by UI001 after dependency approval.
- **Expected files/modules:** `frontend/package.json`, lockfile, `index.html`, TypeScript/Vite/Vitest configuration, `src/main.tsx`, `src/test/setup.ts`.
- **Dependencies:** Approved versions from §12 and explicit implementation authorization.
- **Tests:** Empty smoke test, typecheck, and production build; assert no unexpected runtime/network code.
- **Completion condition:** Exact pins and lockfile match the approved review; a minimal empty root renders and all three verification commands run.

### Task 2 — Implement tokens and base styles

- **Purpose:** Establish the single semantic token source, baseline document styles, focus, reduced-motion, and forced-colours behavior.
- **Expected files/modules:** `src/ui/tokens.css`, `src/ui/base.css`, `tests/ui001/tokens.test.ts`, contrast helper.
- **Dependencies:** Task 1.
- **Tests:** Token completeness, raw-value boundary, contrast calculations, focus/reduced-motion/forced-colours rule checks.
- **Completion condition:** Every §6 token exists once, contrast thresholds pass, and no external font or asset request is present.

### Task 3 — Implement layout primitives

- **Purpose:** Provide small semantic, token-spaced, direction-neutral composition helpers for later screens.
- **Expected files/modules:** `src/ui/layout/**`, exports, `layout.test.tsx`.
- **Dependencies:** Task 2.
- **Tests:** Semantic element choice, bounded gaps, wrapping/alignment, no DOM reorder, LTR/RTL rendering.
- **Completion condition:** All seven §7 primitives satisfy their contracts without route, shell, or editor behavior.

### Task 4 — Implement field primitives

- **Purpose:** Provide accessible native input, description, validation, and selection foundations.
- **Expected files/modules:** Field, TextInput, TextArea, Select, Checkbox, RadioGroup modules and tests.
- **Dependencies:** Tasks 2–3.
- **Tests:** Label/name association, required/invalid/error semantics, disabled/read-only behavior, native keyboard interaction, RTL.
- **Completion condition:** AC-09 through AC-11 pass for field and selection controls.

### Task 5 — Implement action controls

- **Purpose:** Provide native buttons and discoverable denied-action presentation without inventing authorization enforcement.
- **Expected files/modules:** Button, IconButton, shared control styles, relevant component/keyboard tests.
- **Dependencies:** Tasks 2–3.
- **Tests:** Element/type defaults, accessible names, Enter/Space behavior, disabled and `aria-disabled` non-activation, focus.
- **Completion condition:** AC-08 and the action-related portion of AC-11 pass.

### Task 6 — Implement dialog, messages, and progress

- **Purpose:** Establish accessible modal, feedback, error, and busy-state patterns.
- **Expected files/modules:** Dialog, InlineMessage, ProgressIndicator, `dialog.test.tsx`, accessibility tests.
- **Dependencies:** Tasks 2, 4, and 5.
- **Tests:** Dialog name/focus containment/Escape/restoration/background inertness; alert/status behavior; determinate/indeterminate progress; reduced motion.
- **Completion condition:** AC-12 through AC-15 pass.

### Task 7 — Implement the presentation-state contract

- **Purpose:** Encode the eight truthful application-state meanings without creating a production lifecycle.
- **Expected files/modules:** `contracts/presentation-state.ts`, StatusIndicator, status styles, `status-semantics.test.tsx`.
- **Dependencies:** Tasks 2, 3, and 6.
- **Tests:** Table tests for labels, non-colour cues, announcements, required identities, prohibited equivalences, and failed/stale behavior.
- **Completion condition:** AC-17 through AC-23 pass and the public API cannot render an approved candidate without “Not published”.

### Task 8 — Add disposable fixtures and the minimal showcase

- **Purpose:** Make UI001 reviewable in LTR/RTL with deterministic contexts, capability denials, and status transitions.
- **Expected files/modules:** `src/demo/ui001/**` and minimal `main.tsx` wiring.
- **Dependencies:** Tasks 3–7.
- **Tests:** Fixture qualification text, exact scenarios, reset, no randomness/network/storage, 320-pixel structural check.
- **Completion condition:** AC-16 and AC-20 through AC-26 pass; the showcase has no route or application-shell behavior.

### Task 9 — Complete cross-cutting accessibility and directionality verification

- **Purpose:** Validate the assembled foundation semantically rather than visually alone.
- **Expected files/modules:** `accessibility.test.tsx`, `rtl.test.tsx`, test utilities.
- **Dependencies:** Task 8.
- **Tests:** Axe scans, heading/name relationships, live-region policy, full keyboard traversal, CSS logical-property scan, forced-colours and reduced-motion review.
- **Completion condition:** AC-05, AC-14 through AC-16, and AC-28 pass with documented manual contrast/focus review.

### Task 10 — Enforce boundaries and run final verification

- **Purpose:** Prove that durable foundation code is independent of disposable fixtures and excluded architecture.
- **Expected files/modules:** `boundary.test.ts`, final export surface in `src/ui/index.ts`; no new product modules.
- **Dependencies:** Tasks 1–9.
- **Tests:** Import-boundary scan, forbidden-dependency/behavior audit, removal simulation for demo imports, full typecheck/test/build.
- **Completion condition:** All 30 acceptance criteria pass; required commands are green; the diff contains only authorized frontend UI001 files and necessary dependency manifests/lockfile.

Implementation tasks: **10**.

## 16. Handoff and remaining decisions

Architecture blockers remaining for UI001: **0**.

Before coding begins, the implementation session must receive explicit implementation authorization and the exact dependency review must approve or replace the targets in §12. Those are execution gates, not unresolved product or publishing architecture.

UI001 is ready for implementation under this specification. UI002, UI003, production services, editor technology, publishing technology, and all press-dependent behavior remain outside this feature.
