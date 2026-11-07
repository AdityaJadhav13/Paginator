# ADR-023: TypeScript kernel, Python oracle; one monorepo now

**Status:**
- **ACCEPTED** (owner decision, 2026-10-20).
- Closes O1 (kernel language) and O3 (backend language) in favour of TypeScript.
- O2 (whether composition also runs in the browser) **stays open** until the M7 memo.

Date: 2026-10-20. Amends ADR-001 (the restructure is no longer deferred) and ADR-017 decision 4 (language).
Records owner decisions D1–D4 of the product plan (`docs/product/`).

## Context
- Phase 0 proved the publishing path in Python:
  - composition (composer3);
  - headlines (head1);
  - a PDF/X-1a writer whose output the pilot's press accepted;
  - page rebuild;
  - automatic layout of 28 held-out pages, all passing every check.
- ADR-017 kept the kernel language EXPERIMENTAL, with Python (option E) as the front-runner, pending EXP-ENGINE.
- The owner chose to build the real product as one combined code project, starting with the core text engine in TypeScript. Reasons:
  - one language from browser to server;
  - instant fit feedback where font licences allow composition in the browser;
  - one toolchain for a small team working with agents.

## Decision
1. **One pnpm monorepo now:** `apps/*`, `packages/*`, `tools/*`. `frontend/` became `apps/web`. The frozen evidence stays in place: `tools/oracle/v0`, `experiments/phase0` and `fixtures/typeset/v1`.
2. **The kernel is TypeScript, with HarfBuzz compiled to WASM.** HarfBuzz is built by us at the exact commit and flags uharfbuzz 0.56.0 used (14.3.0), not taken from harfbuzzjs.
3. **The frozen Python code is the reference oracle.** The TypeScript kernel replaces nothing until it reproduces its golden vectors bit for bit (float.hex floats, glyph ids, breaks, signatures). Two transfer tests are required:
   - **G2 transfer (M6):** the TS writer reproduces the press-accepted PDF's decompressed content streams exactly, **and the press accepts a TS-made file**.
   - **G1 transfer (M8):** the TS page engine reproduces the reviewed pages glyph for glyph.
4. **Parity mode first.** The port emulates the Python semantics the goldens depend on, in `@pageinator/pyshim`: round half to even, `float.hex`, `json.dumps`, `pow` on integer exponents, code-point string order, and Unicode 14 tables.
   - Determinism across engines is proven in M7 (Node, Chromium, Firefox, WebKit).
   - Integer-first arithmetic is adopted only if that test fails (ADR-024).
5. **Python stays in production only as two sidecars:**
   - the independent PDF/X checker, which validates every export (a validator written in the writer's own language would be weaker);
   - fontprep, the fontTools instancer for variable fonts.
6. **The ADR-017 principles are unchanged.** One authoritative kernel on the server, preview and PDF from one resolved layout, exports bound to exact revisions. If the browser also composes, the server stays authoritative and page hashes are compared on every save.

## Consequences
- **Port cost:** about 6–8 weeks for M0–M7 at bit-exact parity (`docs/product/08-architecture-and-build.md`).
- **Kernel lint:** kernel packages are linted for determinism (no clock, randomness, I/O, transcendental math, `**`, locale functions or Unicode property escapes).
- **Golden-vector changes** only through the generators, with a changelog entry and human approval.
- **ADR-001's "restructure deferred"** and ADR-017's "Option E front-runner" no longer apply.
