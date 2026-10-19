# UI003 — Scoped Mock Service and Scenario Foundation

Status: implementation-ready feature specification  
Prepared: 2026-09-17  
Milestone: RM01 Foundation  
Gate contribution: G1 honest UI simulation  
Implementation authorization: separate authorization is required; this document does not implement, install, commit, or push anything.

## 1. Purpose

UI003 establishes one coherent fictional Pageinator domain behind small, replaceable, promise-based service contracts. It gives later UI units deterministic organization, publication, and edition context; safe scoped lookup behavior; and controllable latency, failure, and denial scenarios without binding feature components to fixture arrays or pretending the mock types are production schemas.

This unit owns the service boundary, public result/error conventions, hierarchical scoping behavior, canonical fictional seed, and mock scenario/reset mechanics. It does not own session/authentication, feature-specific records, persistence, networking, or production authorization.

## 2. Architecture references

This specification is bounded by:

- `docs/MASTER_BUILD_SPEC.md` §§3 and 5: organization is the tenant, publications are nested scopes, browser clients use scoped service contracts, and the immediate UI uses explicit DTOs and resettable scenarios without freezing production schemas.
- `docs/IMPLEMENTATION_ROADMAP.md` RM01: mock contracts/scenarios belong in the bounded UI foundation and must not create backend or engine scaffolding.
- `specs/INITIAL_IMPLEMENTATION_BACKLOG.md` shared acceptance contract and UI003.
- `docs/architecture/PHASE_1_ANALYSIS.md` R06, R34, R37, and R38.
- `docs/architecture/PHASE_12_SECURITY_TENANCY.md`: IDs select context but never prove authority; the UI-first phase simulates states and cannot establish security readiness.
- `docs/architecture/PHASE_15_UI_FIRST.md`: remote/domain state stays behind promise-based services; scenarios inject deterministic latency, failure, and denial; views do not import mutable fixtures.
- `docs/architecture/PHASE_16_REPOSITORY_DEVELOPMENT.md`: UI DTOs are separate from future physical-document/API schemas; one owner and one import direction per contract.
- `docs/architecture/DECISION_REGISTER.md` D04, D10, and D13.
- `docs/reviews/ARCHITECTURE_RECONCILIATION_ROUND_1.md` §§K–L: UI003's service/error/scoping conventions are intended to survive, while fictional DTO implementations, seeds, and scenario adapters are disposable and define no production document schema.
- `specs/active/UI001_UI_FOUNDATION.md`: presentation-state language, fictional-data qualification, denial disclaimer, deterministic-reset precedent, and durable/disposable import boundary.
- The accepted UI002 specification and implementation on `feature/ui002-route-shells`: existing IDs, organization/publication/edition relationships, locale/direction fields, and non-enumerating invalid-context behavior. UI003 does not redesign UI002.

Relevant normalized requirements are R06, R34, R37, and R38. UI003 satisfies none of the production-security, persistence, API-generation, or publishing-engine gates.

## 3. Preconditions

- UI001 is accepted and its current TypeScript/Vitest toolchain is available.
- UI003 implementation is separately authorized.
- The implementer reads this specification before creating `frontend/src/services/**`, `frontend/src/mocks/**`, or `frontend/tests/ui003/**`.
- UI002 need not be merged for UI003 implementation. Its accepted IDs and field concepts are normative compatibility inputs; §15 defines the integration sequence for the first branch that contains both units.
- No unresolved architecture research or product-owner choice blocks this fictional service foundation.

## 4. In scope

- Minimal read-only DTOs for `User`, `Organization`, `Publication`, and `Edition`.
- Two product-facing query service contracts: `UserQueryService` and `WorkspaceQueryService`.
- One stable `ServiceResult<T>` and three UI-safe failure categories: unavailable context, denied demonstration, and temporary failure.
- Strict organization → publication → edition lookup semantics, including indistinguishable unknown-ID and wrong-parent results at the same level.
- A canonical, fictional, deterministic seed with two organizations, three publications, two users, and three editions.
- A factory-created mock environment with no process-global mutable state.
- Deterministic normal, latency, failure, and denial scenarios, optionally targeted to named service operations.
- Reset to the exact canonical seed and normal scenario.
- Defensive copying/read-only results so consumers cannot mutate mock storage.
- Contract, fixture, scoping, scenario, reset, isolation, and import-boundary tests.
- An explicit migration rule for UI002's disposable fixture snapshot.

## 5. Explicit out of scope

UI003 must not implement or scaffold:

- UI004 session state, credentials, login/signup/recovery, memberships, roles, grants, capability evaluation, or production authorization.
- Onboarding, publication creation, edition creation/update/delete, or any other command/mutation service.
- A backend, HTTP client, API route, fetch call, WebSocket, database, object store, queue, worker, service worker, cookie, or browser persistence.
- Generated production clients, OpenAPI/GraphQL/schema tooling, or a claim that these DTOs are the future canonical API source.
- A generic repository/database object exposed to UI code.
- Complete production `User`, `Organization`, `Publication`, `Edition`, `EditableDocument`, or `ResolvedDocument` schemas.
- Stories, media, ads, newsroom/source records, rights, profiles, templates, generation jobs, document commands, preflight, exports, releases, archives, billing, storage accounting, or audit records.
- Random failures, random IDs, random delays, wall-clock-generated records, or test-order-dependent state.
- Any production isolation/security claim. Denial is a labeled demonstration scenario only.

## 6. DTO definitions

The definitions below are the complete UI003 DTO surface. The TypeScript syntax is normative for field names, types, and optionality; comments may vary.

```ts
export type TextDirection = "ltr" | "rtl";

export interface UserDto {
  readonly id: string;
  readonly displayName: string;
}

export interface OrganizationDto {
  readonly id: string;
  readonly name: string;
}

export interface PublicationDto {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
  readonly locale: string;
  readonly direction: TextDirection;
}

export interface EditionDto {
  readonly id: string;
  readonly publicationId: string;
  readonly label: string;
}
```

### 6.1 Why these fields exist

| DTO | Field | Current need |
|---|---|---|
| `UserDto` | `id` | Stable fictional identity for UI004 to reference without defining credentials now. |
| `UserDto` | `displayName` | Human-readable identity in later simulated session UI. |
| `OrganizationDto` | `id`, `name` | Route context, organization switcher, safe context labels. |
| `PublicationDto` | `id`, `orgId`, `name` | Publication lookup and strict parent scoping. |
| `PublicationDto` | `locale`, `direction` | Existing UI002 shell language/direction behavior. |
| `EditionDto` | `id`, `publicationId`, `label` | Edition route context and strict parent scoping. |

No email, role, membership, capability, timezone, cadence, date, status, revision, profile, page count, document, or release field is authorized here. Their owning feature adds the smallest needed DTO or service extension later.

These are UI service DTOs, not database entities, backend models, authorization records, production API schemas, or publishing-engine types. `readonly` is a compile-time consumer contract; adapters must also return detached values so runtime mutation cannot alter their internal seed.

## 7. Fixture model and canonical seed

The mock implementation owns one internal seed identified as `ui003-seed-v1` and qualified as `ui003-demo-only`. Seed metadata is mock-internal and is not added to the DTOs.

### 7.1 Users

| ID | Display name | Notes |
|---|---|---|
| `user-demo-sahyadri-editor` | `Sahyadri Demo Editor` | Fictional identity only; no membership or role is implied. |
| `user-demo-konkan-reviewer` | `Konkan Demo Reviewer` | Fictional identity only; no membership or role is implied. |

### 7.2 Organizations

| ID | Name |
|---|---|
| `org-demo-sahyadri` | `Sahyadri Media Cooperative` |
| `org-demo-konkan` | `Konkan Coastal Press` |

There are exactly two organizations in `ui003-seed-v1`.

### 7.3 Publications

| ID | Parent organization | Name | Locale | Direction |
|---|---|---|---|---|
| `pub-demo-pune-daily` | `org-demo-sahyadri` | `Pune Daily Ledger` | `en-IN` | `ltr` |
| `pub-demo-urdu-evening` | `org-demo-sahyadri` | `Deccan Evening Record` | `ur-IN` | `rtl` |
| `pub-demo-ratnagiri-tide` | `org-demo-konkan` | `Ratnagiri Tide` | `en-IN` | `ltr` |

### 7.4 Editions

| ID | Parent publication | Label | Test purpose |
|---|---|---|---|
| `edition-demo-001` | `pub-demo-pune-daily` | `edition-demo-001` | Existing UI002 happy path. |
| `edition-demo-urdu-001` | `pub-demo-urdu-evening` | `edition-demo-urdu-001` | Same-organization, wrong-publication and RTL context tests. |
| `edition-demo-002` | `pub-demo-ratnagiri-tide` | `edition-demo-002` | Cross-organization/publication isolation tests from UI002. |

The seed order shown above is canonical. Normal collection results preserve it. The names are fictional and make no customer, certification, licensing, security, or operational claim. UI004 may later add membership/session fixtures that refer to these users and organizations; UI003 does not infer those relationships.

## 8. Service contracts

Feature and application code depend on these interfaces and DTO/result types. They do not import the mock seed, scenario implementation, or internal arrays.

```ts
export interface UserQueryService {
  getUser(input: {
    readonly userId: string;
  }): Promise<ServiceResult<UserDto>>;
}

export interface WorkspaceQueryService {
  listOrganizations(): Promise<ServiceResult<readonly OrganizationDto[]>>;

  getOrganization(input: {
    readonly organizationId: string;
  }): Promise<ServiceResult<OrganizationDto>>;

  listPublications(input: {
    readonly organizationId: string;
  }): Promise<ServiceResult<readonly PublicationDto[]>>;

  getPublication(input: {
    readonly organizationId: string;
    readonly publicationId: string;
  }): Promise<ServiceResult<PublicationDto>>;

  getEdition(input: {
    readonly organizationId: string;
    readonly publicationId: string;
    readonly editionId: string;
  }): Promise<ServiceResult<EditionDto>>;
}
```

### 8.1 Contract rules

1. Every method returns a `Promise`; expected unavailable/denied/failure states resolve to `ServiceResult`, not thrown exceptions.
2. Invalid mock configuration and programmer misuse may throw synchronously from the controller configuration boundary, but ordinary query inputs never do.
3. Input objects make context explicit and prevent positional-ID mistakes.
4. `getEdition` includes the organization and publication IDs so the adapter validates the full hierarchy rather than looking up an edition globally.
5. The only collection reads authorized now are organization listing and publications within one organization. UI003 does not add edition listing, search, paging, sorting controls, or mutation methods.
6. Collection order is canonical seed order; it is not locale sorting or production ordering.
7. Returned DTOs and arrays are detached from adapter storage. Mutating a cast result cannot change a later query.
8. Services do not accept a user/session argument. UI004 owns simulated session and membership context and may wrap or extend these contracts without converting UI003 denial into real authorization.

## 9. Scoped lookup semantics

Lookup is hierarchical and fail-closed within the fictional seed:

```text
organizationId
  -> publicationId belonging to that organization
      -> editionId belonging to that publication
```

An adapter must not perform a global child lookup and then return the child merely because its ID exists elsewhere.

| Operation | Input condition | Required result |
|---|---|---|
| `getUser` | Known user ID | That detached `UserDto`. |
| `getUser` | Empty or unknown user ID | `unavailable` for `user`. |
| `listOrganizations` | Normal scenario | Both detached organizations in canonical order. |
| `getOrganization` | Known organization ID | That detached `OrganizationDto`. |
| `getOrganization` | Empty or unknown organization ID | `unavailable` for `organization`. |
| `listPublications` | Known organization ID | Only publications whose `orgId` equals that organization, in canonical order. |
| `listPublications` | Empty or unknown organization ID | `unavailable` for `organization`; never an empty success that reveals a lookup distinction. |
| `getPublication` | Publication belongs to supplied organization | That detached `PublicationDto`. |
| `getPublication` | Empty/unknown publication ID | `unavailable` for `publication`. |
| `getPublication` | Known publication under a different organization | The exact same public result as an unknown publication ID under the supplied organization. |
| `getEdition` | Organization, publication, and edition form the correct chain | That detached `EditionDto`. |
| `getEdition` | Organization is empty/unknown | `unavailable` for `organization`; no child lookup. |
| `getEdition` | Publication is empty/unknown or belongs to another organization | `unavailable` for `publication`; no edition lookup. |
| `getEdition` | Edition is empty/unknown | `unavailable` for `edition`. |
| `getEdition` | Known edition under a different publication | The exact same public result as an unknown edition ID under the supplied publication. |

“Exact same public result” means deep-equal code, resource, and display text; no requested or discovered foreign ID/name/count; no alternative suggestion; and the same scenario-controlled delay. Internal control flow may differ, but it is not exposed by the contract.

Scenario denial or temporary failure is evaluated for the named operation before any record lookup. A denied or failed call therefore cannot reveal whether a supplied ID exists. Latency waits first and then performs the normal scoped lookup.

## 10. Result and error vocabulary

```ts
export type UnavailableResource =
  | "user"
  | "organization"
  | "publication"
  | "edition";

export type ServiceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ServiceError };

export type ServiceError =
  | {
      readonly code: "unavailable";
      readonly resource: UnavailableResource;
      readonly displayMessage: string;
    }
  | {
      readonly code: "denied";
      readonly displayMessage: "This demonstration action is not available in the current context.";
      readonly qualification: "Demonstration only — production authorization is not evaluated here";
    }
  | {
      readonly code: "temporary-failure";
      readonly displayMessage: "The demonstration service is temporarily unavailable. Try again.";
    };
```

The `unavailable` display messages are fixed by resource:

| Resource | Exact `displayMessage` |
|---|---|
| `user` | `This user is not available.` |
| `organization` | `This organization is not available.` |
| `publication` | `This publication is not available in this organization.` |
| `edition` | `This edition is not available in this publication.` |

### 10.1 Public versus internal information

Safe for UI display: `code`, `resource` when present, `displayMessage`, and the denial qualification. These values contain no IDs, parent candidates, record counts, membership claims, or reason such as “exists under another parent.”

Not part of the service result: missing-versus-wrong-parent reason, stack traces, fixture indices, alternate parents, scenario internals, requested IDs echoed into messages, HTTP status, endpoint names, and mock storage details. Tests know their setup and do not need a diagnostic escape hatch. Logging/telemetry is outside UI003.

The vocabulary is transport-independent. A future network adapter may translate transport failures into it, but UI003 defines no HTTP status or response body.

## 11. Scenario controller

Scenario state belongs to one factory-created mock environment. There is no exported singleton and no module-global mutable scenario.

```ts
export type MockOperation =
  | "user.get"
  | "organization.list"
  | "organization.get"
  | "publication.list"
  | "publication.get"
  | "edition.get";

export type MockScenario =
  | { readonly mode: "normal" }
  | {
      readonly mode: "latency";
      readonly delayMs: number;
      readonly operations?: readonly MockOperation[];
    }
  | {
      readonly mode: "failure";
      readonly operations?: readonly MockOperation[];
    }
  | {
      readonly mode: "denial";
      readonly operations?: readonly MockOperation[];
    };

export interface MockScenarioController {
  setScenario(scenario: MockScenario): void;
  getScenario(): MockScenario;
  reset(): void;
}

export interface MockServiceEnvironment {
  readonly users: UserQueryService;
  readonly workspace: WorkspaceQueryService;
  readonly scenarios: MockScenarioController;
}
```

`createMockServiceEnvironment(options?)` returns a fresh environment. Its optional test seam may inject a delay function with this shape:

```ts
export type Delay = (milliseconds: number) => Promise<void>;
```

The default delay uses the platform timer. Tests use Vitest fake timers or an injected controlled delay; they never wait on real wall-clock time.

If `operations` is absent, the scenario applies to all six operations. If present, it applies only to the listed operations; every other operation behaves normally. The controller defensively copies configuration. `getScenario()` returns a detached read-only value.

`delayMs` must be a finite integer from 0 through 10,000 inclusive. An invalid scenario or unknown operation is a test/developer configuration error and is rejected immediately by `setScenario`; it is not converted into a user-facing service error.

## 12. Latency, failure, and denial semantics

| Mode | Affected service promise | Record lookup | Required resolved result |
|---|---|---|---|
| `normal` | Resolves without an intentional timer. | Normal scoped lookup. | Success or `unavailable`. |
| `latency` | Remains unsettled until the configured deterministic delay completes. | Runs after the delay. | The same success or `unavailable` result normal mode would return. |
| `failure` | Resolves without random delay. | Must not run. | `temporary-failure`. |
| `denial` | Resolves without random delay. | Must not run. | `denied` with the exact UI001-derived qualification. |

Modes are exclusive in UI003. Combined delay-plus-failure, retry counts, progressive loading, stale revision, and operation-specific payloads belong to later feature scenarios. Failure and denial do not mutate the seed. No mode rejects a service promise for an expected state.

The denial mode demonstrates UI behavior only. It is not a permission evaluator, access-control list, production policy, or evidence of tenant isolation.

## 13. Reset and determinism rules

1. `createMockServiceEnvironment()` begins with a fresh clone of `ui003-seed-v1` and `{ mode: "normal" }`.
2. `scenarios.reset()` atomically restores a fresh canonical seed clone and normal mode.
3. Repeated reset produces deep-equal query results in the same order.
4. One environment's scenario changes and resets cannot affect another environment.
5. Tests create a fresh environment in setup; no test relies on a prior test resetting shared state.
6. Seed construction uses no `Math.random`, `Date.now`, current timezone/date, `crypto.randomUUID`, counter retained across environments, or locale-dependent sort.
7. UI003 performs no browser or filesystem persistence. Reload persistence belongs to UI025.
8. Query results are cloned deeply enough for these flat DTOs and arrays. Freezing internal seed objects is encouraged, but freezing alone does not replace defensive result copying.
9. The mock adapter owns no mutation methods in UI003. Reset still replaces its internal snapshot so later feature adapters can extend the environment without changing reset semantics.

## 14. Adapter and import boundaries

The dependency direction is one-way:

```text
feature/app consumers -> services contracts
mock adapters         -> services contracts
tests                 -> services contracts and mock factory

services contracts -X-> mocks, React, app, demo, routing, storage
mocks             -X-> feature components, UI001 demo, UI002 demo fixtures
```

- `frontend/src/services/**` contains DTOs, `ServiceResult`, and the two product service interfaces. It is framework-free TypeScript and imports no mock, React, router, UI, demo, storage, backend, editor, composition, or publishing module.
- `frontend/src/mocks/**` contains the internal seed, mock scenario/environment implementation, and factory. It may import `frontend/src/services/**` only from the product layer.
- Feature components receive service implementations through props/context/composition and import service contracts, never `seed.ts` or mutable arrays.
- The application composition root is the only future production code allowed to select the mock factory. This selection is not required by UI003 because no feature consumes the service yet.
- A future production adapter implements the service interfaces from another directory. It must not import the mocks. Replacing the selected adapter must not require changing feature query call sites.
- The conventions—promise boundary, explicit scoped inputs, result vocabulary, and import direction—are intended to survive. The exact UI DTOs, seed values, and scenario implementation are disposable and require review before reuse against a real API.

### 14.1 Dependencies

UI003 proposes **zero new runtime dependencies and zero new development dependencies**. TypeScript, promises, platform timers, Vitest, and existing test helpers are sufficient. No package manifest, lockfile, or dependency record should change for UI003.

## 15. UI002 fixture migration and integration strategy

UI003 reuses UI002's organization/publication/edition IDs, names, hierarchy, locale, and direction exactly. It adds one Urdu-publication edition solely to exercise same-organization wrong-publication scoping. It does not create a second naming family.

The accepted UI002 branch currently owns a disposable synchronous fixture snapshot and `*FixtureLike` context types. The migration is staged because UI003 depends only on UI001 and may be implemented in parallel:

1. UI003 becomes the canonical source for service-backed user/organization/publication/edition mock data. New feature units must extend UI003 services/seed or add their own service DTOs; they must not extend UI002 fixture literals.
2. Until the first branch contains both units, UI002's fixture file remains a frozen disposable compatibility snapshot. The overlapping records must stay field-for-field equal to §7.
3. On the first integration branch containing UI002 and UI003, and no later than UI004 integration, replace UI002's direct fixture ownership with a small application-level adapter/provider that reads `UserQueryService`/`WorkspaceQueryService` results. Delete the overlapping organization/publication/edition literals from `src/demo/ui002/fixtures.ts`; do not make UI002 import `src/mocks/seed.ts` directly.
4. UI002's route context continues to preserve non-leakage semantics. Unknown and wrong-parent service results at a given level map to the same `InvalidContextPage` state. Loading/temporary failure/denial UI belongs to the consuming feature unless an integration spec explicitly assigns it; UI003 does not redesign shells.
5. UI002's `ReleaseFixtureLike`/`release-demo-001` remains UI002-owned and disposable. Release/archive DTOs are not pulled into UI003; UI021 owns that extension.
6. A compatibility test records the overlapping canonical values from §7 so divergence is detected during integration. No component receives or mutates the internal seed arrays.

This strategy keeps one forward source without making UI003 depend on UI002 or prematurely adding async feature behavior to a route-shell milestone.

## 16. Implementation tasks

### Task 1 — Define UI service DTOs and result vocabulary

- **Purpose:** Create the framework-free contract types in §§6 and 10.
- **Expected files:** `frontend/src/services/dtos.ts`, `frontend/src/services/result.ts`, `frontend/src/services/index.ts`.
- **Dependencies:** UI001 toolchain only.
- **Completion condition:** Exact fields/unions compile; service contracts can import them without any mock/React dependency.

### Task 2 — Define the two query service interfaces

- **Purpose:** Establish the promise-based, scoped product-facing boundary in §8.
- **Expected files:** `frontend/src/services/user-query-service.ts`, `frontend/src/services/workspace-query-service.ts`.
- **Dependencies:** Task 1.
- **Completion condition:** The interfaces expose only the six authorized operations and all inputs/results match §§8–10.

### Task 3 — Create the canonical fictional seed

- **Purpose:** Encode `ui003-seed-v1` once inside the mock boundary.
- **Expected files:** `frontend/src/mocks/seed.ts`.
- **Dependencies:** Task 1.
- **Completion condition:** The seed exactly matches §7, is clearly qualified as demo-only, and exports no mutable array to consumers.

### Task 4 — Implement the environment and scenario controller

- **Purpose:** Give each consumer/test an isolated environment with normal, latency, failure, denial, and reset behavior.
- **Expected files:** `frontend/src/mocks/scenarios.ts`, `frontend/src/mocks/create-mock-service-environment.ts`, `frontend/src/mocks/index.ts`.
- **Dependencies:** Tasks 1–3.
- **Completion condition:** Configuration validation, operation targeting, injected delay seam, defensive scenario copies, and reset rules match §§11–13.

### Task 5 — Implement scoped query adapters

- **Purpose:** Implement both service contracts over the private seed snapshot.
- **Expected files:** small adapter modules under `frontend/src/mocks/` or private functions within the environment factory; do not create a generic public database class.
- **Dependencies:** Tasks 2–4.
- **Completion condition:** Every row in §9 behaves exactly as specified, including wrong-parent/unknown equality and scenario-before-lookup ordering.

### Task 6 — Enforce copying and deterministic reset

- **Purpose:** Ensure no result can mutate internal state and reset is identical across runs/environments.
- **Expected files:** implementation from Tasks 3–5; a private clone helper is allowed only if it clarifies this boundary.
- **Dependencies:** Tasks 3–5.
- **Completion condition:** Mutation attempts do not affect later reads; reset restores both seed and normal scenario; two environments remain isolated.

### Task 7 — Add contract, fixture, scoping, and scenario tests

- **Purpose:** Prove §§7–13 behavior through the public services/controller.
- **Expected files:** focused tests under `frontend/tests/ui003/` as listed in §19.
- **Dependencies:** Tasks 1–6.
- **Completion condition:** Every test requirement in §17 is covered without real timers, generated per-record inflation, or private-state assertions.

### Task 8 — Enforce boundaries and complete verification

- **Purpose:** Prove replaceability, absence of forbidden behavior, and UI002 identity compatibility.
- **Expected files:** `frontend/tests/ui003/boundary.test.ts` and compatibility assertions in the smallest appropriate UI003 test file.
- **Dependencies:** Tasks 1–7.
- **Completion condition:** AC-01 through AC-30 pass; typecheck, full tests including UI001, and production build succeed; no dependency or unrelated file changes exist.

Implementation tasks: **8**.

## 17. Test requirements

Tests exercise public contracts/factory behavior. They may import mock internals only in the boundary/static-source tests needed to prove forbidden constructs are absent; behavioral tests must not inspect private arrays or implementation maps.

| Area | Required tests |
|---|---|
| DTO shape | Compile-time/type assertions or `satisfies` checks prove exactly the authorized required fields and no feature-specific fixture requires a larger DTO. |
| Promise boundary | Each of the six operations returns a thenable immediately and resolves to `ServiceResult`; expected unavailable/denied/failure cases do not reject or throw. |
| Canonical seed | Query the services and prove exactly two organizations, three publications with the §7 distribution, three editions reachable through their correct scopes, and two known users. Do not inflate this into one test per field. |
| Deterministic creation | Two fresh environments queried in the same sequence produce deep-equal results and canonical ordering. |
| Deterministic reset | Change scenario, attempt consumer-side result mutation, reset, and prove deep equality with a new environment plus normal mode. |
| Environment isolation | Configure/reset one environment and prove another environment is unchanged. |
| Organization lookup | Known succeeds; empty and unknown produce the exact organization `unavailable` result. |
| Publication collection | Each organization returns only its own publications; unknown organization returns organization `unavailable`. |
| Publication non-leakage | Unknown publication and `pub-demo-ratnagiri-tide` requested under `org-demo-sahyadri` produce deep-equal public results with no foreign ID/name/count. Repeat with a known Sahyadri publication under Konkan. |
| Edition hierarchy | Each edition succeeds only through its organization/publication chain. Same-organization and cross-organization wrong-publication requests are covered. |
| Edition non-leakage | Unknown edition and a known edition from another publication produce deep-equal public results at the edition level with no foreign ID/label. |
| Missing context | Empty organization/publication/edition inputs return the unavailable resource identified in §9 and never fall through to a child success. |
| Error shapes | Assert the exact discriminants, allowed keys, fixed display messages, and denial qualification. Assert no error contains a requested ID or diagnostic reason. |
| Normal scenario | A known success and unknown failure match ordinary scoped semantics with no intentional timer. |
| Latency scenario | With fake timers or an injected controlled delay, the promise is unsettled before `delayMs`, settles at the configured boundary, and yields the same result as normal mode. No real-time sleep. |
| Failure scenario | Known and unknown inputs for an affected operation both resolve to the exact same `temporary-failure`; an unaffected operation remains normal when targeting is used. |
| Denial scenario | Known and unknown inputs for an affected operation both resolve to the exact same `denied` result and qualification; no authorization claim appears. |
| Scenario targeting | Omitted operations affect all; a specified operation list affects only those operations; invalid delay/operation configuration is rejected at configuration time. |
| Mutable leakage | Mutating cast DTOs, arrays, and returned scenario operation arrays cannot alter a later result or controller state. |
| UI002 compatibility | One compact table asserts overlapping UI002 IDs/names/relationships/locale/direction equal §7; `edition-demo-urdu-001` is explicitly the only new overlapping-domain record. |
| Import direction | Scan `src/services/**` for forbidden imports and `src/mocks/**` for feature/demo imports. Prove contracts do not depend on mocks and mocks do not depend on UI components. |
| Forbidden behavior | Static scan and runtime spies establish no `fetch`, XHR, WebSocket, browser storage, cookie, service worker, random ID/delay, current-time generation, backend/API path, or production persistence. |
| Regression | Existing UI001 tests, full typecheck, full test run, and build remain green. UI002 tests are also required on an integration branch that contains UI002. |

Use table-driven cases when inputs differ but the invariant is the same, especially wrong-parent/unknown equality. Do not generate a separate `it()` for every file × forbidden-pattern pair or every seed field. Test counts are not an acceptance metric.

## 18. Acceptance criteria

UI003 passes only if all criteria below pass.

1. **AC-01:** Implementation changes are limited to `frontend/src/services/**`, `frontend/src/mocks/**`, `frontend/tests/ui003/**`, and the already-approved UI003 specification; no backend, worker, schema, storage, feature, route, editor, or publishing scaffold is added.
2. **AC-02:** `package.json`, the lockfile, and dependency records are unchanged; UI003 adds zero runtime and zero development dependencies.
3. **AC-03:** `UserDto`, `OrganizationDto`, `PublicationDto`, and `EditionDto` contain exactly the required fields and types in §6, with no optional production/future-feature fields.
4. **AC-04:** DTO properties are read-only and every returned DTO/array is detached from internal mock storage; consumer mutation cannot affect a later query.
5. **AC-05:** `ui003-seed-v1` contains exactly two users, two organizations, three publications, and three editions with the IDs, values, order, and relationships in §7.
6. **AC-06:** All overlapping organization/publication/edition records are field-for-field compatible with accepted UI002 identities; no second naming family is introduced.
7. **AC-07:** `UserQueryService` exposes only `getUser`, and it always returns a promise resolving to the specified success or `user` unavailable result.
8. **AC-08:** `WorkspaceQueryService` exposes exactly the five methods in §8; every method always returns a promise and expected domain/scenario outcomes never reject.
9. **AC-09:** Known organization, publication, and edition IDs resolve only through the correct hierarchical context and return the exact detached DTO.
10. **AC-10:** `listOrganizations` returns exactly the two organizations in canonical order; `listPublications` returns only publications belonging to the supplied known organization in canonical order.
11. **AC-11:** Unknown and wrong-organization publication IDs produce deep-equal `unavailable` results with no foreign ID, name, count, or alternate parent.
12. **AC-12:** Unknown, same-organization/wrong-publication, and cross-organization edition IDs produce the required deep-equal edition-level `unavailable` result whenever the supplied parent context itself is valid.
13. **AC-13:** Missing or unknown parent context stops lookup at the appropriate organization/publication level and cannot return a child or child-derived detail.
14. **AC-14:** `listPublications` for an empty or unknown organization resolves to organization `unavailable`, not an empty successful list.
15. **AC-15:** `ServiceResult<T>` and `ServiceError` contain exactly the discriminants and public fields in §10; all fixed display messages and the denial qualification match exactly.
16. **AC-16:** No public error exposes requested IDs, internal diagnostic reasons, stack traces, fixture positions, other parents, HTTP status, endpoint details, or record counts.
17. **AC-17:** Normal mode preserves scoped success/unavailable behavior without an intentional timer or data mutation.
18. **AC-18:** Latency mode uses the configured fixed delay, is testable without real wall-clock waiting, and returns the same value normal mode would return after the delay.
19. **AC-19:** Failure mode resolves affected operations to the exact `temporary-failure` result before record lookup, for both known and unknown IDs.
20. **AC-20:** Denial mode resolves affected operations to the exact `denied` result and UI001-derived qualification before record lookup, for both known and unknown IDs, without claiming production authorization.
21. **AC-21:** Scenario targeting follows §11: omitted operations target all; listed operations target only themselves; invalid delay/operation configuration is rejected immediately.
22. **AC-22:** Every `createMockServiceEnvironment()` call owns isolated seed/scenario state; changing or resetting one environment cannot affect another.
23. **AC-23:** `scenarios.reset()` restores a fresh canonical seed clone and normal mode; repeated resets and a new environment produce deep-equal public query results.
24. **AC-24:** No mutable fixture array, internal map, seed object, or writable scenario object is exported to UI/feature consumers.
25. **AC-25:** UI003 source contains no random/time-derived records or delays, network call, browser/filesystem persistence, service worker, cookie, backend/API implementation, or production credential handling.
26. **AC-26:** Import-boundary tests prove `src/services/**` has no mock/framework/app/demo/storage imports and `src/mocks/**` depends inward on services without importing feature/UI/demo modules.
27. **AC-27:** UI002 compatibility is recorded and tested as §15 specifies; no release/archive DTO is added to UI003.
28. **AC-28:** No membership, role, capability, authentication, command/mutation, feature-domain, EditableDocument, or ResolvedDocument schema is introduced.
29. **AC-29:** The meaningful tests in §17 pass without generated assertion-count inflation, real-time sleeps, private-state behavioral assertions, or test-order dependence.
30. **AC-30:** Under a supported Node runtime, `npm run typecheck`, `npm test -- --run`, and `npm run build` all exit successfully, with existing UI001 tests green and UI002 tests green whenever UI002 is present on the integration branch.

Acceptance criteria count: **30**.

## 19. Files and domain boundaries

Expected implementation shape:

```text
frontend/
  src/
    services/                         # durable intent: framework-free UI service contracts
      dtos.ts
      result.ts
      user-query-service.ts
      workspace-query-service.ts
      index.ts
    mocks/                            # disposable: fictional seed and adapters
      seed.ts
      scenarios.ts
      create-mock-service-environment.ts
      index.ts
  tests/
    ui003/
      contracts.test.ts
      fixtures-and-scoping.test.ts
      scenarios-and-reset.test.ts
      boundary.test.ts
```

The exact test-file split may be reduced if fewer files make the behavior clearer. Do not add one source file per DTO, record, scenario mode, or service method. Do not edit `frontend/src/ui/**`, UI001 demo files, routes, shells, or feature folders for UI003. On a later integration branch, UI002 migration follows §15 under that branch's authorized scope.

## 20. Prohibited shortcuts

- Do not export `SEED`, fixture arrays, maps, or a `mockDb` for components to query directly.
- Do not let `getEdition` find by edition ID alone and check the parent afterward.
- Do not return `not-found` for an unknown child and `denied`/`wrong-parent` for the same ID found elsewhere.
- Do not echo IDs, names, counts, or alternate parents in service errors.
- Do not reject promises for expected unavailable, denial, or temporary-failure states.
- Do not use `any`, unbounded generic repositories, runtime schema libraries, state-management libraries, fake-server libraries, or HTTP semantics to avoid writing the small explicit contracts.
- Do not use `Math.random`, current time, real sleeps in tests, module singletons, test-order cleanup assumptions, or persistence to implement scenarios.
- Do not freeze an array and call it safe while returning the same object references to consumers; return detached data.
- Do not add memberships/roles to make denial look realistic. UI004 owns that model and must retain the demonstration-only qualification.
- Do not model future edition dates/statuses/revisions/pages, documents, publishing states, or archives “for convenience.”
- Do not change UI001/UI002 design or implement feature screens.
- Do not install, commit, push, or create backend/configuration scaffolding under this specification alone.

## 21. Completion checklist

- [ ] The four DTOs match §6 exactly and are documented as UI contracts, not production entities.
- [ ] The two product-facing query services match §8 exactly and return promises.
- [ ] The canonical seed matches §7 and is not directly exposed.
- [ ] Correct-scope, missing, unknown, and wrong-parent behavior matches §9.
- [ ] Result/error shapes and exact safe display strings match §10.
- [ ] Normal, latency, failure, and denial scenarios match §§11–12.
- [ ] Fresh environments, scenario targeting, reset, and defensive-copy behavior match §13.
- [ ] Adapter/import boundaries match §14 and zero dependencies were added.
- [ ] UI002 compatibility and staged migration follow §15 without adding release/archive DTOs.
- [ ] All eight implementation tasks are complete.
- [ ] All §17 tests and all 30 acceptance criteria pass.
- [ ] Typecheck, full tests, build, and existing UI001 regression tests pass under a supported Node runtime.
- [ ] UI002 regression tests pass on the first integration branch containing both units.
- [ ] No application feature, real API/auth/persistence, production schema, dependency installation, commit, or push was performed by specification authoring.

UI003 is ready for implementation. It has no architecture or product-owner blocker. Its contracts remain explicitly fictional and transport-independent; later features extend them only when their own behavior requires new data.
