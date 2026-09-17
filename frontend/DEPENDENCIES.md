# UI001 dependency and Node runtime record

Recorded per `specs/active/UI001_UI_FOUNDATION.md` §12 (dependency proposal and
adoption gate), written during the H-06 correction pass identified by
`docs/reviews/UI001_INDEPENDENT_CODE_REVIEW.md`. This is an implementation-level
record scoped to `frontend/`, not a project architecture document.

## Supported Node runtime

```
^22.22.2 || ^24.15.0 || >=26.0.0
```

Recorded in `package.json` `engines.node`. This is the intersection of every
installed package's own `engines.node` field (the tightest constraint,
`jsdom@30.1.0`'s `^22.22.2 || ^24.15.0 || >=26.0.0`, is a subset of `vite`'s,
`vitest`'s, and `@vitejs/plugin-react`'s ranges, so it is the effective
requirement). Node 25.8.2 — the version present in this development
environment by default — satisfies none of these ranges and is **not** the
selected baseline; it must not be used as evidence of compatibility.

All validation in this correction pass (`typecheck`, `test -- --run`, `build`)
was re-run under **Node v22.22.3** (npm 11.11.1), installed locally via `nvm`,
which satisfies the `^22.22.2` branch of the range above. `npm ci` under this
Node version produces no `EBADENGINE` warnings.

If Node 22.x is not available in a given environment, use Node 24.15.0+ or
26.0.0+ instead; do not fall back to an unlisted version.

## Approved dependency versions

All versions are pinned exactly (no `^`, `~`, `latest`, or prerelease ranges)
in `package.json` and `package-lock.json`.

| Dependency | Version | License | Class | Why required |
|---|---:|---|---|---|
| `react` | 19.3.0 | MIT | Required runtime | Component composition |
| `react-dom` | 19.3.0 | MIT | Required runtime | Renders React into the DOM |
| `typescript` | 7.0.2 | Apache-2.0 | Required dev | Type-checks components and fixtures |
| `vite` | 8.3.0 | MIT | Required dev | Dev/build tool |
| `@vitejs/plugin-react` | 6.1.1 | MIT | Required dev | React JSX transform for Vite |
| `vitest` | 5.0.1 | MIT | Required dev | Test runner |
| `@testing-library/react` | 16.3.3 | MIT | Required dev | Accessible-DOM component tests |
| `@testing-library/user-event` | 14.6.7 | MIT | Required dev | Realistic keyboard/pointer interaction |
| `jsdom` | 30.1.0 | MIT | Required dev | DOM environment for component tests |
| `axe-core` | 4.13.0 | MPL-2.0 | Required dev | Automated accessibility checks |
| `@types/react` | 19.3.0 | MIT | Required dev | React type declarations |
| `@types/react-dom` | 19.3.0 | MIT | Required dev | React DOM type declarations |
| `@testing-library/jest-dom` | 7.0.1 | MIT | Optional dev | Readable DOM matchers |
| `@types/node` | 22.20.3 | MIT | Approved dev (see below) | Node builtin types for filesystem-based test assertions |

Required dependencies: 12. Optional: 2 (`@testing-library/jest-dom`, `@types/node`).

### `@types/node` — approval record

Not in the spec's original §12 table. It is required because four test files
(`tests/ui001/tokens.test.ts`, `layout.test.tsx`, `rtl.test.tsx`,
`boundary.test.ts`) read the durable stylesheet source (`tokens.css`,
`base.css`) with `node:fs`/`node:path` to assert on raw CSS text and to scan
import statements.

**A Vite `?raw` import (`import css from "./tokens.css?raw"`) was tried as a
Node-free alternative and rejected: verified empirically to resolve to an
empty string for `.css` files under Vitest's SSR transform pipeline** (Vite
short-circuits CSS module content to `""` during SSR/non-browser transforms;
this is CSS-specific — a plain `.txt?raw` import and `import.meta.glob(...,
{ query: "?raw" })` over `.ts`/`.tsx` files both return real content and are
used in `boundary.test.ts`). No other Node-free mechanism for reading local
file content synchronously in a jsdom-environment Vitest run was found.

Given that, `@types/node` is approved as a **test-scoped** dependency:

- pinned to the latest 22.x release (`22.20.3`), matching the selected Node
  22 baseline branch;
- included only in `tsconfig.test.json`'s `types` array — the production
  `tsconfig.json` program (`src/ui/**`, `src/demo/**`, `main.tsx`) has
  `"types": []` and never sees Node's ambient globals (`process`, `Buffer`,
  etc.), which was the underlying concern (review finding M-02);
- not a runtime dependency; it contributes nothing to `dist/`.

### License and advisory notes

- `npm audit`: 0 vulnerabilities (info/low/moderate/high/critical all 0).
- Non-permissive licenses present, all development-only and none shipped in
  `dist/`: `axe-core` (MPL-2.0, direct) and its transitive build dependency
  `lightningcss` (MPL-2.0, via Vite's CSS pipeline, various platform
  binaries). MPL-2.0 is copyleft only at the file level of the licensed
  library itself and does not extend to code that merely uses it as a
  build/test tool; no `lightningcss` or `axe-core` source is modified or
  distributed by this project.
- No vendor/commercial licensing, no native or WASM publishing dependency,
  and no addition beyond what §12 already anticipated other than the
  `@types/node` case above.

## Verification commands run under the selected runtime

```
node -v   # v22.22.3
npm ci
npm run typecheck   # tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.test.json
npm test -- --run
npm run build
```

All four succeeded with no `EBADENGINE` warnings and no TypeScript errors.
