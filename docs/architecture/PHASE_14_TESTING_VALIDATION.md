# Phase 14 — Testing and production validation

Prepared 2026-09-16. Inputs: publishing, preflight, revision/archive and security artifacts read from disk. This specifies future verification; no product tests or press experiments have run. Passing UI tests establishes workflow behavior only.

## Verification layers

| Layer | Required cases and oracle | Gate |
|---|---|---|
| Unit/domain | Permission policies, unit conversions, state transitions, crop/PPI, command validation; independent expected values | Each affected feature |
| Schema/contracts | Valid/invalid documents, tagged units, finite/ranged numbers, acyclic frame/style references, unknown schema version handling; mock/API conformance | Contract changes |
| API/integration | Idempotency, duplicate/reordered jobs, stale revision conflicts, partial upload, transaction/outbox consistency | Backend foundation |
| Authorization/tenancy | Two organizations, multiple publications, revoked user, role changes; IDs/jobs/search/blob/manifest access; non-owner DB roles and pooled tenant switching | Before any real customer data |
| UI/component | Loading, empty/error/denied states, labels/focus, responsive layout and right-to-left input | UI-first |
| E2E | Complete fixture journey and failure recovery; changing edition must not leak state; deep links and refresh | UI-first acceptance |
| Visual UI regression | Deterministic fixtures/viewports, keyboard focus and layouts; review intentional diffs | UI changes |
| Typography goldens | English/Hindi/Marathi/Urdu, conjuncts, bidi, ligatures, font fallback, line-end reshaping, source-to-glyph mapping; native-reader approved references | Font/engine/data changes |
| Layout goldens | Dense columns, ad reservations, linked flows, continuation, overset, locked regions and regeneration closure | Composer changes |
| Property/fuzz | Random commands preserve references/locks/content coverage; serialization round-trip; malicious fonts/HTML/images/PDFs under resource caps | Engine/parser releases |
| PDF structural | Actual page boxes, fonts/subsets/text mapping, colour spaces, output intent, clips and required standard | Every production candidate |
| PDF rendering comparison | Independent renderer versus resolved scene, with explicit tolerances and geometry/text checks | Writer/profile changes |
| Professional preflight | Seeded pass/fail corpus, missing engine/report, expired license, false-green prevention, profile version binding | Every production candidate |
| Archive restoration | Hash-verified released download; editable copy with dependencies; lost DB/index and stale toolchain scenarios | Archive release and recurring drills |
| Migration | Old schema fixtures, forward migration to copy, no historical-byte changes, backup/restore and failed deployment | Data/schema releases |
| Performance | Representative 16-page and agreed stress editions, concurrent tenant bursts, queue fairness, memory/disk/CPU caps | Engine/backend launch |
| Security | SSRF redirects/DNS, hostile uploads, XSS/CSRF, forged webhooks, support access, secret/log leaks and dependency advisories | Real-data launch and ongoing |
| Failure recovery | Worker death at each release state, storage failures, duplicate delivery, lost acknowledgment, key/region outage, cancellation | Production release path |
| Real press | Actual profile/RIP/prepress approval, physical print inspection, repeat editions and archived reprint | Press/customer pilot |

## Publishing oracle design

Goldens must not simply snapshot whatever the current engine produces. Establish them through source-text assertions, independent measurements, qualified language/prepress reviewers and approved press samples. Never update a typography golden solely to make a dependency upgrade pass. Record why each intentional geometry change is correct.

Separate exact assertions (text ranges, font/glyph identity, line breaks, units, PDF hash binding, ad position, page boxes) from tolerant raster comparisons (antialiasing, display colour). Set tolerances using physical significance and renderer behavior; a low pixel-diff score cannot excuse missing text. Use independently implemented renderers or professional systems where feasible to reduce common-mode errors.

Verify the same ResolvedDocument drives browser and PDF: compare stable page/frame/line IDs, glyph positions and asset transforms, inspect PDF text mapping and sample known physical distances. Use a separate test for font subset mapping, including ligatures and RTL logical order. Missing glyphs, unsupported PDF primitives and source/PDF mismatch are blockers even when screenshots look plausible.

## Release race and crash suite

Request export at revision N, edit N+1 while worker runs, then verify output remains labeled N and cannot masquerade as current approved output. Change print profile or rights during processing; require the correct invalidation/recheck. Duplicate the job and kill the worker after each object write/database transition; assert at most one release identity, recoverable states and no exposed incomplete package. Mutate a candidate after preflight; hash binding must reject it. Revoke a releaser before completion; the old request cannot confer permanent release authority.

Archive tests include deleted working originals still retained by published package references, checksum mismatch, expired signatures, unavailable font rights, unavailable old engine, quota exhaustion, backup recovery and authorized retention expiry. Retrieval of exact bytes and permission to reprint are separate assertions.

## Performance and operations acceptance

Use the illustrative 16-page/79-story/47-photo/12-ad edition, but measure actual glyphs, image sizes and complexity. Record hardware, browsers, network, cold/warm cache, fonts/engine versions and tenant concurrency. Phase 4 latency targets are experiment targets, not SLAs. The pilot owner must define deadline, supported capacity and recovery needs; derive budgets for each stage from measured end-to-end work.

Collect job queue age, resolve/export/preflight duration, input-to-save latency, error rates, peak memory and cost per edition. Test one tenant's pathological job while another produces a normal edition. Prove backups restore within agreed recovery objectives before promising them. Keep local/staging/production separate; staging uses licensed fixtures or explicitly approved sanitized data.

## Press and customer pilot acceptance

Acquire a written press input specification and licensed language/font/ad/photo corpus. Produce a representative edition; obtain technical preflight and press/RIP acceptance; inspect physical text, images, ink/black, trim and page ordering with the press. Record PDF hash, profile, tooling, proof approvals, handoff receipt and physical inspection findings. Correct defects through new revisions/candidates. Repeat on multiple production cycles agreed with the customer, then retrieve/reprint a prior release from archive. A single successful PDF upload is insufficient.

## Test tooling and ownership

Reuse mature unit, browser automation, fuzz and PDF tools appropriate to chosen runtimes; the registry covers Playwright and conditional GoogleTest. Do not force C++ test tools onto an unchosen engine language. Feature owners maintain domain/contract tests; publishing engineers own geometry/font/PDF cases with independent reviewers; security/operations own isolation and recovery; newsroom/prepress users approve language and press outcomes. CI gates scale with touched boundaries, with heavier corpus checks on engine/dependency/profile changes. No percentage coverage target substitutes for these behaviors.
