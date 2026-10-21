# 09 — Launch plan: grow the Desk into the product

> Written for: the owner and the engineers or agents who build Pageinator.
> Status: **APPROVED in principle by the owner, 2026-10-20** ("grow the Desk into the product, with open-source parts;
> start now"). Replaces the **order** of the build plan in [08](08-architecture-and-build.md) §15. The product it
> builds is still the one specified in sections 01–07: the target does not change, the route to it does.

## 1. The decision

The owner wants to use Pageinator on their own paper now, and to launch it to other papers as soon as it is solid. So:
- **The product grows from the Desk** (`tools/desk`). It already lays out a whole 4-, 8- or 16-page paper with the
  engines whose text-only test page the press accepted, and it has a page editor. Every feature is added to something the newsroom already uses.
- **The proven Python engines are the engine service from day one.** The TypeScript engine port (M0.5–M8) continues
  alongside. It replaces the Python service one piece at a time, only where its output is proven identical (the
  golden vectors). Nothing waits for the port.
- **Open-source parts wherever they fit.** The licences allowed are MIT, Apache-2.0, BSD and ISC (with MIT-0 and
  0BSD). Any other licence needs a review, package by package: MPL-2.0 for build and test tools, and two permissive
  licences that common tools use (BlueOak-1.0.0, CC0-1.0). Proprietary, licence-key, AGPL/GPL and SSPL/BSL parts are
  not used.
  - Reverse engineering closed products is not done.
- **Gates become release checks.** Gates G0–G7 now decide what may be used for a real printed edition and what may be
  sold. They no longer decide what may be built (see §6).

## 2. What never changes

1. **Print safety.**
   - Every page PDF is checked by the independent PDF/X-1a checker; a page that fails is never offered as a press file.
   - Before a real edition, the press confirms a test print of the same kind of page.
2. **Exact type.** The page is set only by our engine, and the screen draws the same glyphs at the same places as the
   print file. Browser text layout is never used on the page.
3. **Marathi first.** Correct Devanagari, Marathi input methods, Marathi labels.
4. **No AI for layout.** No AI decides any line break, size, position or fit. AI may suggest text, and a person
   accepts it.
5. **Privacy.** The paper's content, fonts and artwork never enter the public repository.
6. **Two independent checks.** Every substantial change gets a code review and an independent verification, plus
   tests.
7. **No unproven claims.** We say "checked" only when a check ran.

## 3. Stack

| Part | Choice | Licence | Why |
|---|---|---|---|
| Engine service | The Phase-0 engines (gen1, page1, head1, compose3, pdfx1), behind `tools/desk/engine` | ours | Press-tested with a text-only page (pages with photos or ads not yet). Measured on this Mac on 2026-10-20: about 0.1 s to set a changed page, 0.4–1 s to measure a story at a new width |
| Page canvas | Our own canvas drawing of the engine's display list (glyph outlines from the same font instances as the PDF). In the React app: **Konva** (react-konva) for handles and snapping | MIT | No open-source newspaper or DTP editor exists; Konva is maintained and has a React 19 binding |
| Story text editing | **ProseMirror** (Tiptap's free MIT core only) | MIT | IME-safe; Marathi input matrix to be tested |
| Collaboration (later) | **Yjs** + y-prosemirror + **Hocuspocus** | MIT | Self-hosted |
| Viewing | **PDF.js** (proofs), **OpenSeadragon** (page tiles, e-paper) | Apache-2.0 / BSD-3 | |
| Backend and accounts | See §3.1 | | |
| Avoid | tldraw (licence key), Polotno (proprietary), Tiptap paid features, Superdesk (AGPL), Vivliostyle (AGPL), Scribus (GPL) | | Licence |

A licence check (`pnpm run check:licences`, part of `pnpm run ci` and of CI) fails the build when an installed npm
package has a licence outside that list and its reviewed exceptions. Every package in `pnpm-lock.yaml` must be
installed and checked, except other platforms' builds of reviewed families (the lockfile itself records no licences).
Every installed link must be a package of the workspace's store or one of the workspace's own projects, as pnpm itself
records them: a link to any other folder is refused, and so are patched packages, a `.pnpmfile` and links left out of
the lockfile.
Python packages are not covered by it: the Desk runs in the frozen Phase-0 environments, which include pikepdf
(MPL-2.0, used unmodified) and Pillow (MIT-CMU); they need the same review before the hosted engine worker (L2.2)
ships them.

### 3.1 Backend (survey 2026-10-20; consistent with ADR-007/008)

| Part | Choice | Licence | Notes |
|---|---|---|---|
| Database | **Postgres**: AWS RDS Mumbai, or Supabase in Mumbai used only as managed Postgres | PostgreSQL | One store for data, per-paper separation (RLS), the job queue and the audit log |
| API | **Fastify + Kysely** in `apps/api` | MIT | The same language as the web app and the TS kernel |
| Accounts | **Better Auth**: email and password, the organization plugin, two-step sign-in | MIT | Pin versions and watch its security advisories (several in 2026). Our own tests for invitations and paper separation. Fallback: Keycloak (Apache-2.0) |
| Files | **S3 Mumbai**: versioning, Object Lock for the printed archive, presigned uploads | — | On a VPS instead: SeaweedFS (Apache-2.0). Never MinIO (AGPL, archived) |
| Jobs | **Procrastinate** (Postgres) for the Python engine workers: measure, lay out, export, check | MIT | No Redis |
| Live updates | Server-sent events with Postgres LISTEN/NOTIFY; Hocuspocus later | MIT | |
| Images | Pillow with Little CMS (CMYK, exists); sharp for previews and zoom tiles | MIT-CMU / Apache-2.0 | sharp's prebuilt libvips (`@img/sharp-libvips-*`) is LGPL-3.0-or-later: it needs a review before sharp is added (the licence check refuses it until then) |
| Print check | Our independent PDF/X-1a checker on every page (exists), plus a commercial preflight or a press proof before any PDF/X claim (ADR-022) | ours | No open-source PDF/X validator exists (veraPDF checks PDF/A) |
| Operations | Docker Compose on EC2; RDS point-in-time recovery; S3 copy to Hyderabad; Uptime Kuma | — | |
| Later | Razorpay (MIT SDKs), Amazon SES, WhatsApp Cloud API (send e-paper links, not PDFs) | — | |

**Monthly cost** for one paper with about 20 staff, before GST:
- AWS Mumbai: about ₹22k;
- AWS Mumbai with a standby database: about ₹31k;
- an Indian VPS: about ₹12–17k, with the most operations work for us.

WhatsApp messages and payment fees are extra.

**How the parts fit at L2:**
- **Web app:** the React app (`apps/web`), which also holds the page editor.
- **API:** the Fastify API (`apps/api`) owns accounts, data and files.
- **Engine workers:** the Python engine runs as workers. Each layout, export and check is a job; an open page has an
  editing session.
- **The Desk's own server** stays for local, own-paper use until the hosted product covers its features.

## 4. Phases

Each phase ends with something the newsroom uses on real work.

### L1: The Desk complete for our own paper (now)
- **EXISTS:**
  - lay out 4/8/16 pages automatically;
  - article needs from the paper's own pages;
  - past-edition import;
  - an independent PDF/X-1a check on every page;
  - **the page editor**: select, move, resize, swap, remove and add stories on the grid; undo and redo; every change
    set by the engine and kept; "Save page" makes and checks the print file.
- **To add:**
  - "Try another layout" for one page;
  - move a story to another page;
  - edit a story's text from the editor, with the page set again;
  - lock a story in place;
  - photo crop and focal point;
  - rulers and zoom to selection.
- **Inputs:** the house fonts (the owner provides the files and the licence); Word (.docx) import; Marathi labels on
  every screen.
- **Owner:** one press test (a Desk page with photos and a real ad). This also completes gate G2.

### L2: The newsroom (several people, one paper, hosted)
- **People:**
  - accounts, roles, invitations and two-step sign-in;
  - the paper's data kept separate;
  - an audit log.
- **Desks:**
  - **story desk:** reporters file from a phone; statuses, assignments, comments and approvals;
  - **photo desk:** captions and credits; CMYK conversion (EXISTS);
  - **ads desk:** bookings, artwork checks, placement.
- **Edition plan (flatplan):** pages, colour pages, ad positions, sections.
- **Release:** preflight, approvals, export, and sending to the press with a receipt.
- **Hosting:** in India, with backups and monitoring.

### L3: Archive, e-paper, delivery
- **Archive:** every printed edition, searchable and reprintable.
- **E-paper website.**
- **Delivery:** a press link on WhatsApp or email, and the press portal.

### L4: Other papers (SaaS)
- **Onboarding:** learn a paper's house style from its past PDFs (the Phase-0 page model and house profile, made
  part of the product), plus a template editor.
- **Running many papers:** multi-paper tenancy and billing (Razorpay).
- **Website:** public claims updated as each capability becomes true.

### All along: the TypeScript engine
M0.5 → M8 as in 08 §15. Each proven piece moves into the browser for instant fit while typing. The Python service
stays the reference.

## 5. Order of the next work
1. **Now:**
   - L1 editor additions (try another layout, move between pages, text edits from the editor);
   - the licence check (done: `pnpm run check:licences`);
   - the house fonts as soon as they arrive.
2. **Then:** the L2 backend on the stack chosen in §3.1, starting with accounts and the story desk.
3. **When the owner is ready:** the press test, using a page the Desk prepares.

## 6. Gates, restated
- **G0–G2** decide when the Desk may print a real edition and when a page with photos or ads may go to press.
- **G3 onwards** decide when other papers may be offered the product.
- **Building is not blocked by any gate.**
