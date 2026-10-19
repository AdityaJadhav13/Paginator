# 18 — Dependency, Licence and PDF-Tooling Review

**Status:** ACCEPTED as an engineering classification. **This is not legal advice.**
- Every row marked REQUIRES REVIEW needs qualified counsel's sign-off before production use.
- Rows marked COMMERCIAL LICENSE REQUIRED need a contract.

Licence identifiers reflect our understanding as of 2026-10-07. Re-verify them at adoption time against each project's own `LICENSE` file and SBOM.

**Classification key**

| Class | Meaning |
|---|---|
| SAFE / PERMISSIVE | MIT, BSD, Apache-2.0, ISC, Unicode-3.0 or similar. Keep notices. |
| REQUIRES REVIEW | Weak or strong copyleft, unclear terms, or data/content licences. |
| COMMERCIAL LICENSE REQUIRED | Proprietary, or a dual-licensed project whose free option does not fit our use. |
| DO NOT USE | Unacceptable for our distribution and SaaS model without a commercial licence we do not plan to buy. |

## 1. Candidate dependencies

### Kernel and typography

| Component | Licence (as understood) | Class | Notes |
|---|---|---|---|
| HarfBuzz / harfbuzzjs / uharfbuzz | "Old MIT" (HarfBuzz); Apache-2.0 (uharfbuzz) | SAFE | Pin versions. uharfbuzz 0.56.0 bundles HarfBuzz 14.3.0 |
| HarfRust | MIT / Apache-2.0 | SAFE | Young (2025); only relevant to Option B |
| fontTools | MIT | SAFE | Subsetting with `retain_gids`; instancing |
| FreeType / freetype-py | FTL or GPLv2 (dual) / BSD | SAFE (choose FTL) | FTL requires an attribution credit |
| ICU4X | Unicode-3.0 | SAFE | |
| ICU4C / PyICU | Unicode-3.0 / MIT-style | SAFE | |
| Hyphenation patterns (TeX hyph-utf8, LibreOffice) | Varies per language (LPPL, MIT, GPL, MPL) | REQUIRES REVIEW per pattern file | Matters only if hyphenation is adopted |
| Pydantic, FastAPI | MIT | SAFE | |
| OR-Tools | Apache-2.0 | SAFE | |
| HiGHS / highs-js | MIT | SAFE | |

### PDF, images and colour

| Component | Licence (as understood) | Class | Notes |
|---|---|---|---|
| qpdf | Apache-2.0 | SAFE | |
| pikepdf | MPL-2.0 | SAFE for unmodified use; REQUIRES REVIEW if we modify its files | File-level copyleft |
| pdf-lib (original) / @pdfme/pdf-lib | MIT | SAFE licence; **original unmaintained** | The fork is used only if the kernel is TS |
| PDFium | BSD-3-Clause (third-party parts BSD/MIT/FTL) | SAFE | Rasterising for parity checks and ad previews |
| pdf.js | Apache-2.0 | SAFE | |
| Apache PDFBox | Apache-2.0 | SAFE | Its preflight module covers PDF/A-1b only |
| Ghostscript | **AGPL-3.0** or Artifex commercial | REQUIRES REVIEW (unmodified separate process); COMMERCIAL if embedded or modified | Optional only: EPS→PDF for ads, `inkcov`. Run sandboxed with `-dSAFER`; Ghostscript has a long CVE history |
| MuPDF | **AGPL-3.0** or Artifex commercial | **DO NOT USE** without a commercial licence | PDFium covers rendering |
| Poppler | GPL-2.0/3.0 | DO NOT LINK; CLI as a separate process REQUIRES REVIEW | Not needed |
| veraPDF | GPLv3+ / MPL-2.0 (dual) | SAFE under MPL for unmodified use | No PDF/X support. XXE CVEs in mid-2026 were fixed in 1.30.2. Not needed |
| iText | AGPL-3.0 or commercial | **DO NOT USE** without a licence | |
| Skia / CanvasKit | BSD-3-Clause | SAFE | Skia's PDF backend has **no CMYK**, so it is unusable for press PDF |
| LittleCMS (lcms2) | MIT | SAFE | |
| Pillow (ImageCms) | MIT-CMU (HPND) | SAFE | Explicit rendering intent and black-point compensation |
| libvips (via sharp / pyvips) | **LGPL-2.1+** | REQUIRES REVIEW (light) | Dynamic linking on our servers is generally acceptable. We do not distribute binaries to customers |
| sharp / pyvips | Apache-2.0 / MIT | SAFE | Prebuilt sharp binaries bundle LGPL libvips |
| libheif (HEIC) | LGPL-3.0 | REQUIRES REVIEW | Patent questions over HEVC decoding: review |
| ClamAV | GPL-2.0 | REQUIRES REVIEW (separate daemon is normal practice) | |

### Web and frontend

| Component | Licence | Class |
|---|---|---|
| React, Vite, React Router, Vitest | MIT | SAFE |
| ProseMirror | MIT | SAFE |
| Konva | MIT | SAFE |

### Backend platform (conditional on the backend-language decision)

| Component | Licence | Class | Notes |
|---|---|---|---|
| Better Auth | MIT | SAFE licence; **security conditions in `15` §8** | |
| Graphile Worker | MIT | SAFE | |
| Kysely | MIT | SAFE | |
| Fastify | MIT | SAFE | |
| Procrastinate | MIT | SAFE | |

### Commercial preflight and PDF

| Component | Licence | Class | Notes |
|---|---|---|---|
| callas pdfToolbox (Desktop / CLI / Server / SDK) | Commercial | COMMERCIAL LICENSE REQUIRED | Server/CLI around €5k historically. **SaaS or multi-tenant hosting terms must be negotiated.** |
| Enfocus PitStop (Pro / Server) | Commercial | COMMERCIAL LICENSE REQUIRED | |
| Adobe Acrobat Pro (Preflight) | Commercial, per seat | COMMERCIAL LICENSE REQUIRED | Engineering validation only. Not for automated server use (EULA) |
| PDFlib | Commercial | COMMERCIAL LICENSE REQUIRED | Strong PDF/X writer; not planned |

### Fonts, colour profiles and AI services

| Component | Licence | Class | Notes |
|---|---|---|---|
| OFL fonts (Noto, Mukta, Tiro, Source, Archivo) | SIL OFL 1.1 | SAFE | Embedding and bundling allowed; no standalone sale |
| Customer and commercial fonts (incl. Shree-Lipi, Akruti and foundry fonts) | Per-vendor licence agreement (EULA) | REQUIRES REVIEW | See `19` §1 |
| ICC profiles (WAN-IFRA, ECI, press-supplied) | Profile-specific terms | REQUIRES REVIEW | Embedding the profile in PDF OutputIntents is normal. Check redistribution terms for bundling profiles with our software |
| AI provider APIs | Commercial terms and data processing agreements (DPA) | COMMERCIAL / REQUIRES REVIEW | Data processing, retention, region, training opt-out |

## 2. PDF capability separation

These are different problems with different tools. A tool that can do one cannot necessarily do another.

| Capability | Open source / permissive | Copyleft (review) | Commercial | Pageinator plan |
|---|---|---|---|---|
| **Creation (press-grade, CMYK, PDF/X structure)** | Our own content streams + qpdf/pikepdf object model; pdf-lib forks (TS) | Ghostscript `pdfwrite` (can emit PDF/X-3; AGPL) | PDFlib, callas | **Our writer**, driven by the ResolvedDocument. Skia and krilla are rejected: no CMYK and no PDF/X respectively |
| **Structural manipulation** (merge, split, embed pages, repair) | qpdf, pikepdf, PDFBox, pdfcpu | MuPDF (AGPL) | callas, PitStop | qpdf / pikepdf |
| **Rendering / rasterising** | PDFium, pdf.js | Ghostscript, MuPDF, Poppler | Adobe PDF Print Engine (press RIPs) | PDFium |
| **PDF/A validation** | PDFBox preflight (PDF/A-1b only) | veraPDF (MPL option) | callas | Not needed for print; possibly for archive later |
| **PDF/UA validation** | — | veraPDF; PAC (freeware, Windows) | callas | Not in scope |
| **PDF/X validation** | **None identified** | **None identified** | callas pdfToolbox, Enfocus PitStop, Acrobat Pro Preflight | Commercial (ADR-022) plus the press's own preflight |
| **General print preflight** (TAC, effective DPI, overprint, fonts, hairlines) | Building blocks only: our model-level rules; PDFium separations; qpdf structure | Ghostscript `inkcov` | callas, PitStop, Acrobat | Our model rules (most checks are better done *before* the PDF exists) plus independent commercial validation |

## 3. Unresolved legal issues (counsel required)

| # | Question |
|---|---|
| L1 | AGPL-3.0 Ghostscript used as an unmodified separate process inside a SaaS: obligations? Or buy an Artifex licence, or drop it? |
| L2 | Font EULAs: may a SaaS run customer-licensed fonts on its servers? May it deliver glyph outlines or rasterised tiles to browsers? Embed them in PDFs? Keep them in archives (`19` §1)? |
| L3 | ICC profile redistribution terms. |
| L4 | callas / PitStop server licences for multi-tenant SaaS use. |
| L5 | DPDP: Pageinator as data processor versus data fiduciary; the journalism exemption is absent; archive erasure (`15` §9). |
| L6 | Wire-service licence terms (PTI, IANS) for storage, AI processing and the archive. |
| L7 | libheif/HEVC patent exposure. |
| L8 | Terms of service and DPA templates for customers; liability when a page misses print because of us. |

## 4. MCP and development-tool review (least privilege)

**Principles**
- Agents never receive production credentials.
- Read-only by default.
- Separate cloud accounts for dev and prod.
- Secrets never placed in an agent's environment.
- Destructive or outward-facing actions need a human.

| Tool | Verdict | Scope |
|---|---|---|
| GitHub (`gh` CLI) | **USE NOW** | Fine-grained token, repo-scoped. Can open PRs; no admin and no force-push to `main` (branch protection) |
| Playwright | **USE NOW** | Local and CI, for the bake-off, end-to-end tests and parity rasterisation |
| Chrome DevTools MCP | **USE NOW** (Phase 0 benchmarks) | Local browsers only, for performance traces |
| Documentation lookup (context7) | **USE NOW** | Read-only |
| graphify | **USE NOW** | Already in `CLAUDE.md`; local graph only |
| PostgreSQL MCP | **USE LATER** (Phase 1+) | Local or dev database only, with a read-only role. **Never prod** |
| AWS MCP / CLI for agents | **TOO RISKY now; LATER** for a read-only dev account | No IAM or write permissions. Infrastructure changes go through reviewed IaC PRs |
| Observability MCPs (Sentry, Grafana) | **USE LATER** (Phase 1+) | Read-only, with customer-content masking |
| Issue tracking (GitHub Issues / Linear) | **USE LATER** | Use when the team grows past about 3 people |
| Supabase MCP / plugin (installed in this environment) | **UNNECESSARY** | Not our platform; leave it unauthenticated |
| Design tools (Figma MCP) | **UNNECESSARY** now | Revisit after Gate 2 for editor UI |
| Google Drive MCP | **UNNECESSARY** for engineering | Press and customer documents stay out of agent context unless deliberately shared |
| agentmemory MCP (configured; failed to connect) | **UNNECESSARY** | Project memory lives in the repo and in `CLAUDE.md` |
