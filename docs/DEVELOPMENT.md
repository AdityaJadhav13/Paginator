# Developing Pageinator

## Layout
| Path | What |
|---|---|
| `apps/web` | The React application (`@pageinator/web`) |
| `packages/*` | Engine packages (`@pageinator/pyshim`, and from M1 `harfbuzz`, `fonts`, `shape`, `hyphenate`, `compose`, `headline`, `document`, `pdf`, `kernel`) |
| `tools/testkit` | Test-only helpers: repository paths, Python-flavoured JSONL |
| `tools/ts` | Repository guards: privacy, frozen evidence, dependency graph, oracle manifest |
| `tools/oracle/v0` | **Frozen** Python reference oracle (never edited) |
| `experiments/phase0`, `fixtures/typeset/v1` | **Frozen** Phase-0 evidence and golden vectors (changes need the `evidence-change` approval) |
| `docs/product` | The product specification and build plan |
| `docs/architecture/v2` | Architecture, gates G0–G7 and ADRs (ADR-023: TS kernel with a Python oracle; ADR-024: units) |

## Setup
1. Node 24 LTS (`.nvmrc`):
   ```sh
   nvm install && nvm use
   ```
2. pnpm 11.20.0 (`packageManager` in `package.json`):
   ```sh
   npm i -g pnpm@11.20.0
   ```
   You can use corepack instead.
3. Install:
   ```sh
   pnpm install
   ```
   This also points git at the tracked hooks (`git config core.hooksPath .githooks`), so the privacy guard runs
   before every push. It leaves an existing `core.hooksPath` alone, with a warning.

## Everyday commands
| Command | Does |
|---|---|
| `pnpm run ci` | Everything CI runs: guards, dependency graph, lint, format check, typecheck, tests, web build |
| `pnpm test` | All tests: web (jsdom), kernel (node) |
| `pnpm run typecheck` | `tsc -b` (TypeScript 7) for packages, plus the web app's own typecheck |
| `pnpm run lint` / `pnpm run format` | ESLint (with the kernel determinism rules) and Prettier |
| `pnpm --filter @pageinator/web dev` | Run the web app |
| `pnpm run guard` | Privacy guard, frozen-evidence guard and oracle check. Locally, on a branch stacked on another, set `GUARD_BASE=origin/<base>` |
| `pnpm run check:oracle` | The frozen oracle: its manifest's SHA-256s, and every tracked file against `tools/ts/oracle-files.json` |
| `pnpm run test:private` | Private parity tests against pilot goldens (needs `PAGEINATOR_PRIVATE_GOLDENS`; fails, never skips, when missing) |

## Rules that keep the engine trustworthy
- **Kernel packages are deterministic.**
  - Every package under `packages/` is a kernel package unless `tools/ts/workspace.json` lists it as a browser package.
  - No clock, randomness, I/O, `Math.pow`/`log`/`round`, `**`, default `sort()`, locale or Unicode-table functions
    (`toLowerCase`, `trim`, `normalize`, `localeCompare` …), `\s` or `\p{…}` in regular expressions, or regular
    expressions built at run time.
  - Use `@pageinator/pyshim` for Python semantics (its Unicode 14 tables come from the goldens).
  - ESLint enforces this; `tools/ts/test/eslint-rules.test.ts` pins every rule. A rule may be disabled only with a
    description that cites an ADR.
- **The Python oracle is the reference.**
  - Golden vectors change only through `tools/goldens/v1` generators, with a changelog entry and human approval.
  - The oracle runs in its own environment: `tools/oracle/v0/.venv`. Never upgrade its Python (3.11.14).
- **The repository is public.** Pilot content, fonts, colour profiles, artwork and review answers live in `~/PageinatorPrivate`, never here.
  - The privacy guard (`tools/ts/guard-private.ts`) runs before every push and in CI. It checks the working tree,
    the index, and every blob of every commit being pushed, so a file committed and then deleted is still caught.
  - Fonts, images and PDFs need their SHA-256 in `tools/ts/guard-allowlist.json`. Colour profiles, design files,
    archives and office documents are never allowed, nor is anything in a `logos/` directory.
  - Private terms: locally `~/PageinatorPrivate/denylist.txt`; in CI the `PAGEINATOR_DENYLIST` secret, which must be
    set (an empty secret fails the job). The scan reads UTF-8, UTF-16 and gzip content and compares NFC forms.
  - Ignored files (`Logos/`, `node_modules/`) cannot be committed without `git add -f`; a force-added file is checked.
- **Every substantial change gets two independent checks:** a code review and a verification.
