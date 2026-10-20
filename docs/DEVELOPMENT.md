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

## Everyday commands
| Command | Does |
|---|---|
| `pnpm run ci` | Everything CI runs: guards, dependency graph, lint, format check, typecheck, tests, web build |
| `pnpm test` | All tests: web (jsdom), kernel (node) |
| `pnpm run typecheck` | `tsc -b` (TypeScript 7) for packages, plus the web app's own typecheck |
| `pnpm run lint` / `pnpm run format` | ESLint (with the kernel determinism rules) and Prettier |
| `pnpm --filter @pageinator/web dev` | Run the web app |
| `pnpm run guard` | Privacy guard and frozen-evidence guard. Locally, on a branch stacked on another, set `GUARD_BASE=origin/<base>` |
| `pnpm run check:oracle` | The frozen oracle's files match their recorded SHA-256 |
| `pnpm run test:private` | Private parity tests against pilot goldens (needs `PAGEINATOR_PRIVATE_GOLDENS`; fails, never skips, when missing) |

## Rules that keep the engine trustworthy
- **Kernel packages are deterministic.**
  - No clock, randomness, I/O, `Math.pow`/`log`/`round`, `**`, locale functions or Unicode property escapes.
  - Use `@pageinator/pyshim` for Python semantics.
  - ESLint enforces this. A rule may be disabled only with a description that cites an ADR.
- **The Python oracle is the reference.**
  - Golden vectors change only through `tools/goldens/v1` generators, with a changelog entry and human approval.
  - The oracle runs in its own environment: `tools/oracle/v0/.venv`. Never upgrade its Python (3.11.14).
- **The repository is public.** Pilot content, fonts, colour profiles, artwork and review answers live in `~/PageinatorPrivate`, never here.
  - The privacy guard runs in CI.
  - Locally, its private-term list is `~/PageinatorPrivate/denylist.txt`.
- **Every substantial change gets two independent checks:** a code review and a verification.
