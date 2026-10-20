# Pageinator — The Real Product: Complete Product Specification and Build Plan

> Written for: the owner (to approve what the product is and the order it is built in) and the engineers or agents who build it.
> Status: **APPROVED** by the owner, 2026-10-20. Nothing below is built yet unless marked **EXISTS**. Examples are fictional; no pilot content appears here.

---



## Contents

- [01-product-map.md](01-product-map.md): §2
- [02-design-system.md](02-design-system.md): §3
- [03-website-and-accounts.md](03-website-and-accounts.md): §4, §5
- [04-workspace-and-production.md](04-workspace-and-production.md): §6, §7
- [05-page-editor.md](05-page-editor.md): §8
- [06-print-archive-notifications.md](06-print-archive-notifications.md): §9, §10, §11
- [07-roles-settings-mobile.md](07-roles-settings-mobile.md): §12, §13
- [08-architecture-and-build.md](08-architecture-and-build.md): §14, §15, §16, §17

## 0. Context

**Why this plan exists.**
- The test stage is finished.
  - Pageinator lays out all 28 held-out pages itself, and they pass every check.
  - The press printed our PDF.
  - The owner–editor approved the pages; the signed sheet is pending.
- The owner has asked for **the real product**:
  - one combined code project;
  - starting with the core text engine in TypeScript;
  - everything planned in detail: every screen, button, icon, selection, the canvas, the tools, exports.

**What exists.**
- **Proven engines, in Python (`experiments/phase0/`):**
  - body composer (composer3);
  - headline composer (head1);
  - PDF/X-1a writer (pdfx1, press-accepted);
  - page rebuild (page1);
  - auto-layout (gen1).
- **Frozen reference oracle:** `tools/oracle/v0`.
- **A React UI foundation (`frontend/`, now `apps/web/`):**
  - tokens, 12 controls + 7 layout primitives, route shells, 31 route leaves (mostly placeholders), 5 public pages;
  - a mock session.
- **Gate status today.**
  - **G0 NOT MET:** pilot agreement and press questionnaire not done.
  - **G1 pending:** signed sheet, plus L3 to measure.
  - **G2 met only for type and colour:** the page with photos and an ad, and the record sheet, are still to do.
- **The architecture:** `docs/architecture/v2`, with gates G0–G7.
- **The original product brief:** `docs/context/ORIGINAL_PRODUCT_CONTEXT.md` (OPC).

**What this plan delivers.**
1. A complete specification of the product, so nothing is left to guess (§2–§13).
2. The engineering build plan: monorepo → TypeScript engine at exact parity with the Python → editor → backend → print → archive. Each milestone is tied to the real-world gates (§14–§16).
3. A verification strategy (§17).

**How to read the screen specs.**
- Each control row: **Control · Icon · Label · Shortcut · What it does · When enabled / who sees it**.
- Labels are English. Every string goes through the translation catalogue; Marathi wording follows the glossary in §3.9, reviewed by a native editor.
- "(later: Gn)" means the control ships when gate Gn is passed. Before then it is **hidden, not shown disabled**, so the UI never advertises what does not work.


## 1. Decisions this plan takes

Change any of them by saying so; each names what it affects.

| # | Decision | Why | Status |
|---|---|---|---|
| D1 | One monorepo (pnpm workspaces). `frontend/` becomes `apps/web` | Owner request; one language across browser and server | **Owner decision 2026-10-20** (supersedes "restructure deferred", ADR-001/16:366) |
| D2 | Core text engine in **TypeScript** (+ HarfBuzz compiled to WASM). Python stays as the frozen reference: the TS engine must reproduce its golden vectors before it is used | Owner request. One engine for server export, and in the browser where font licences allow | **Owner decision** (closes O1 and O3 in favour of TS; supersedes the Python front-runner E). **O2** (is composition in the browser needed?) stays open until the M7 memo, because restricted house fonts may force server composition |
| D3 | Browser-first. Desktop Chrome/Edge primary; Firefox/Safari supported; installable as an app window (PWA) for a full-screen editor and more shortcuts | OPC §4, §50 | Confirmed |
| D4 | Interface in **English and Marathi** (toggle). All strings in a catalogue from day one. Marathi complete for the daily path (dashboard → editor → preflight → export) before G3 | The pilot's staff work in Marathi; the review kit was bilingual and worked | **New** (v2 had "English only in P1") |
| D5 | Shortcuts **compatible with Adobe InDesign** where the browser allows | The pilot's designers used InDesign CS6; muscle memory transfers | **New** |
| D6 | Icons: **Lucide** (ISC licence) copied into `packages/icons` as our own inline-SVG components, plus custom newspaper icons | Satisfies UI001's "project-owned inline SVG" rule without drawing 150 icons | **New** |
| D7 | Units in the UI: **millimetres** for geometry, **points** for type, **columns** for widths. Internally: the editable document is float64 mm (keeps the measured house grid exact); resolved pages are **integer millipoints** (1/1000 pt) in PDF space, which is exactly what the press-accepted writer emits. Integer-first glyph arithmetic is adopted only if the cross-browser determinism test (M7) fails | Exact parity with the press-accepted output; plain float arithmetic is identical across engines | **New** (settles the open units question in doc 05, which called millipoints "micro-points"; ADR-024) |
| D8 | Default publication profile = the pilot's measured house style (`experiments/phase0/results/page1/house_profile.json`): trim 347 × 540 mm, no bleed, 8 × 36.5 mm columns, 4.19 mm gutter, body 12/13 pt | Real, measured | **New** |
| D9 | Gates stay the law (`13_ROADMAP_AND_RISKS.md`). The engine port (M0–M8) starts **now** and continues even if other gates slip. The editor starts after G1 (signed sheet **and** L3 measured on the reviewed pages) plus the engine and renderer memos. Backend and hosting start after G0 (pilot agreement and press questionnaire) and the full G2 (photos + ad page accepted, record sheet filed). Every other screen is built when its gate opens; until then it exists only in this specification and in a low-fidelity prototype | Architecture rules (doc 13 "what is allowed before each gate"; doc 15 §14) | Confirmed |
| D10 | Generation never invents geometry with AI. AI only proposes text (headline variants, trims, translations) as suggestions that a person accepts | FROZEN P6/P7 | Confirmed |
| D11 | Two small Python helpers stay in production, as sidecars: the **independent PDF/X checker** (validates every export) and **fontprep** (pins variable fonts to static instances with the same tool that made the reference). Everything else is TypeScript | They are proven, and re-writing a validator in the same language as the writer weakens the check | **New** |
