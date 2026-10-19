# UI004 — Simulated Session and Access Context

Status: implementation-ready feature specification  
Prepared: 2026-09-17  
Milestone: RM02 UI-first product  
Gate contribution: G1 honest UI simulation  
Implementation authorization: separate authorization is required; this document does not implement, install, commit, or push anything.

## 1. Purpose

UI004 adds the smallest deterministic simulated session and access layer needed to enter Pageinator's existing workspace and editor routes as a fictional role. It resolves an active fictional user, limits organization and publication choices to that session's fictional access grants, integrates asynchronous UI003 services into UI002's route shells, and provides truthful loading, signed-out, inaccessible, denied, and temporary-failure states.

This unit is a browser-only demonstration. It is not authentication, server session management, production authorization, tenant isolation evidence, or a production role model. Organization and publication IDs select a simulated context; they never establish real authority.

## 2. Architecture references

This specification is bounded by:

- `docs/MASTER_BUILD_SPEC.md` §§3, 5, and 11: organizations are tenants, publications are nested scopes, immediate authentication is simulated, and UI visibility is not authorization.
- `docs/IMPLEMENTATION_ROADMAP.md` RM01–RM03: UI004 belongs to the resettable UI-first product; real identity and authorization belong to RM03/G2.
- `specs/INITIAL_IMPLEMENTATION_BACKLOG.md` shared acceptance contract and the complete UI004 entry.
- `docs/architecture/PHASE_1_ANALYSIS.md` R06–R08, R11, R34, R38–R40.
- `docs/architecture/PHASE_12_SECURITY_TENANCY.md`: client-supplied IDs never prove authority; production identity, grants, sessions, and isolation require backend enforcement.
- `docs/architecture/PHASE_15_UI_FIRST.md`: navigation state stays in routes, remote/domain state stays behind services, and simulated identity/session behavior is resettable and explicit.
- `docs/architecture/PHASE_16_REPOSITORY_DEVELOPMENT.md`: frontend providers/adapters compose at the application boundary; mocks remain replaceable; no dependency or directory is added without need.
- `docs/architecture/DECISION_REGISTER.md` D04, D09, D10, and D13.
- `docs/reviews/ARCHITECTURE_RECONCILIATION_ROUND_1.md` §K: UI004's access/denied/session UX is intended to survive, while mock session/role enforcement is disposable and establishes no production security claim.
- `specs/active/UI001_UI_FOUNDATION.md`: truthful simulated, pending, failed, denial-qualification, focus, keyboard, status, RTL, and responsive presentation rules.
- `specs/active/UI002_ROUTE_SHELLS.md`: canonical routes, three shells, route focus/history behavior, invalid-context non-leakage, and the disposable fixture boundary.
- `specs/active/UI003_SCOPED_MOCK_SERVICES.md`: canonical user/workspace DTOs, `ServiceResult`, scoped non-leaking queries, scenario behavior, reset/isolation, and the mandatory first-integration fixture migration.

UI004 contributes to R07/R08 only as a fictional UI demonstration. It does not satisfy D04, RD09, G2, or any production security gate.

## 3. Preconditions and current baseline

- UI001, UI002, and UI003 are accepted and integrated on the UI004 branch.
- The current baseline contains the three UI002 shells and route hierarchy, the UI003 service contracts/mock environment, and the UI001 presentation primitives.
- The current integrated baseline passes 841 tests, typecheck, and production build before UI004 work begins.
- UI003 is the canonical source for fictional users, organizations, publications, and editions.
- UI002's organization/publication/edition literals remain only as the deferred compatibility snapshot that UI004 must now remove under UI003 §15.
- No production identity-provider decision, permission matrix, or product-owner choice blocks this fictional milestone.

## 4. Backlog requirement mapping

The UI004 backlog entry contains four acceptance requirements. All four are normative here.

| Backlog ID | Exact requirement | UI004 resolution | Acceptance criteria |
|---|---|---|---|
| BR-01 | Login/signup/verify/recovery use fictional identities and no real credentials. | Replace the four UI002 placeholders with explicitly simulated entry/recovery surfaces. They contain no password, real email, token, provider, or sending behavior. | AC-01, AC-02, AC-28 |
| BR-02 | Role/org/publication switch updates visible navigation and scoped mock access. | A demonstration identity/role control selects one of two fictional profiles; organization/publication selectors use only the active session's grants and update the route-backed context. | AC-03, AC-12–AC-17 |
| BR-03 | Denied route state. | Protected routes use one generic `AccessUnavailablePage` for inaccessible/unknown context and UI003 denial, preserving non-leakage and displaying the demonstration-only qualification. | AC-04, AC-19–AC-23, AC-31 |
| BR-04 | Logout clears current selections and protected fixture views. | Sign-out atomically removes the simulated session and active IDs, replaces protected routes with `/login`, and prevents history navigation from re-exposing protected UI. | AC-05, AC-18, AC-29–AC-30 |

The backlog test expectations map as follows:

| Test expectation | Required coverage |
|---|---|
| Direct-link denial | Signed-out and inaccessible workspace/editor deep links, including refresh-equivalent initialization. |
| Role change | Switch from the Sahyadri editor profile to the Konkan reviewer profile; identity, role, options, navigation, and access all update. |
| Organization switch | Switch the default profile between its two granted organizations and verify the role/publication/navigation changes. |
| Session reset | Change identity, context, scenario, and sign-out state; reset repeatedly to the canonical default. |
| Zero auth/email network actions | Runtime spies and static boundary checks cover `fetch`, XHR, WebSocket, form submission, mail navigation, and browser persistence. |

Backlog acceptance requirements mapped: **4/4**.

## 5. In scope

- Minimal UI-only simulated session/profile/access DTOs and one promise-based `SimulatedSessionService`.
- A React `SessionProvider`/`SessionContext` that resolves the current session and UI003 `UserDto` without exposing mock details.
- A service-backed `WorkspaceRouteProvider` that replaces UI002's synchronous organization/publication/edition fixture resolution.
- Two fictional access profiles using UI003's existing two users and existing organization/publication IDs.
- Deterministic signed-in, signed-out, identity/role switch, organization switch, publication switch, logout, reset, latency, denial, and temporary-failure behavior.
- Four truthful public auth-route surfaces: login, signup, verification, and recovery.
- Protected workspace/editor route behavior, safe return-to handling, and one generic inaccessible/denied surface.
- UI002 fixture migration required by UI003 §15.
- Accessibility, responsive, RTL, visual, boundary, and regression tests for the new behavior.

## 6. Explicit out of scope

UI004 must not implement or scaffold:

- Real authentication, identity proofing, password or passkey handling, OAuth/OIDC/SAML, MFA, credential validation, email delivery, invitation delivery, verification tokens, recovery tokens, provider SDKs, or account creation.
- Server sessions, cookies, bearer tokens, CSRF handling, backend/API endpoints, database tables, queues, storage, network calls, browser persistence, or production secrets.
- Production authorization, tenant enforcement, security claims, a complete role/capability matrix, RBAC/ABAC engines, membership administration, grants, invitations, audit, support impersonation, or billing entitlements.
- UI005 marketing content, UI006 onboarding behavior, UI007 dashboard data, UI008 edition commands, UI022 team/role administration, or UI025 persistence.
- Newsroom, Content Desk, AI/generation, composition, geometry, editor engine, PDF, preflight, archive behavior, production schemas, `EditableDocument`, or `ResolvedDocument`.
- New route families, a fourth shell, a global state-management library, or a second organization/publication/edition fixture universe.

## 7. Simulated session model

### 7.1 Normative UI contracts

These definitions are the complete UI004 session DTO surface. They are fictional browser contracts, not production identity, membership, or authorization records.

```ts
export type SimulatedRole = "editor" | "reviewer";

export interface SimulatedProfileDto {
  readonly userId: string;
}

export interface SimulatedAccessGrantDto {
  readonly organizationId: string;
  readonly role: SimulatedRole;
  readonly publicationIds: readonly string[];
}

export interface SimulatedSessionDto {
  readonly userId: string;
  readonly access: readonly SimulatedAccessGrantDto[];
  readonly activeOrganizationId: string;
  readonly activePublicationId: string;
}

export type SessionSnapshot =
  | { readonly status: "signed-out" }
  | { readonly status: "signed-in"; readonly session: SimulatedSessionDto };
```

No email, password, verification flag, provider subject, token, expiry, refresh token, cookie, IP/device, avatar, timezone, capability list, billing entitlement, production membership ID, or audit field is authorized.

`UserDto` remains the only user-display contract. `SessionProvider` resolves `session.userId` through `UserQueryService`; UI004 does not duplicate `displayName` in its session seed.

### 7.2 Canonical fictional profiles and grants

The session mock seed is identified internally as `ui004-session-seed-v1` and `ui004-demo-only`. Names and domain records come from UI003 services; the session seed contains only the IDs and grant relationships below.

| Profile | User | Grants | Canonical active context |
|---|---|---|---|
| `sahyadri-editor` | `user-demo-sahyadri-editor` | Sahyadri: `editor`, Pune Daily and Deccan Evening. Konkan: `reviewer`, Ratnagiri Tide. | Sahyadri / Pune Daily |
| `konkan-reviewer` | `user-demo-konkan-reviewer` | Konkan: `reviewer`, Ratnagiri Tide only. | Konkan / Ratnagiri Tide |

The cross-organization grant on the default profile exists only to exercise organization switching and different roles without adding another user. It implies no production sharing policy.

Canonical default state is signed in as `sahyadri-editor`, active in `org-demo-sahyadri` / `pub-demo-pune-daily`. This preserves the accepted UI002 happy-path deep links while signed-out behavior remains deterministically selectable.

The UI labels the profile control **Demonstration identity and role**. Selecting the other profile changes both the fictional user and its active role; it is not represented as production account impersonation or a real role mutation.

The visible active role is always the `role` on the grant whose `organizationId` equals `activeOrganizationId`. A signed-in snapshot is valid only when its active organization has a grant and its active publication occurs in that grant's `publicationIds`.

### 7.3 Service contract

```ts
export interface SimulatedSessionService {
  listProfiles(): Promise<ServiceResult<readonly SimulatedProfileDto[]>>;
  getSession(): Promise<ServiceResult<SessionSnapshot>>;
  signIn(input: {
    readonly userId: string;
  }): Promise<ServiceResult<SessionSnapshot>>;
  signOut(): Promise<ServiceResult<SessionSnapshot>>;
  selectOrganization(input: {
    readonly organizationId: string;
  }): Promise<ServiceResult<SessionSnapshot>>;
  selectPublication(input: {
    readonly organizationId: string;
    readonly publicationId: string;
  }): Promise<ServiceResult<SessionSnapshot>>;
}
```

Rules:

1. Every method returns a promise and resolves expected states to `ServiceResult`; it does not throw for signed-out, inaccessible, denial, or temporary failure.
2. `listProfiles` returns the two detached profile IDs in canonical order. Display names are resolved through `UserQueryService`.
3. `signIn` accepts only a canonical fictional profile user ID, resolves that user through UI003, and selects the profile's canonical active context.
4. `signOut` always clears the local simulated session and active selections. It performs no UI003 lookup and is not blocked by a failure/denial scenario.
5. `selectOrganization` requires a signed-in grant for that organization and selects the grant's first publication in canonical grant order.
6. `selectPublication` requires the organization grant and a publication ID in that grant. Unknown and known-but-ungranted values resolve to the same `denied` result.
7. Returned profiles, grants, publication-ID arrays, snapshots, and sessions are defensively copied.
8. Access IDs are presentation inputs only. Components must not treat a successful client-side check as production authorization.

## 8. Access semantics

### 8.1 Minimal access rule

UI004 grants only entry to organization/publication route context. An edition inherits access from its publication. UI004 defines no action capability matrix and does not decide whether an editor/reviewer may publish, bill, invite, or alter content; later owning units add the smallest demonstrations they need.

### 8.2 Evaluation order

Protected workspace/editor resolution follows this order for every initial load and navigation:

1. Resolve the session.
2. If signed out, redirect to login without rendering protected labels or fixtures.
3. Resolve the active `UserDto` through `UserQueryService`.
4. Check the requested organization ID against the session's organization grants **before** querying that organization.
5. If a publication is present, check it against the grant for the requested organization **before** querying that publication.
6. Query UI003 in hierarchy order: organization, publication, then edition when present.
7. Resolve UI002's release-only fixture only after organization/publication access and service resolution have succeeded.
8. On success, synchronize the session's active organization/publication to the URL context. The URL remains the navigation authority while on a protected route.

An organization/publication ID absent from the session grant produces `inaccessible` whether it is unknown or exists elsewhere. No domain lookup is made to distinguish those cases.

An unknown/wrong-publication edition under an allowed organization/publication is mapped from UI003's exact edition `unavailable` result to UI002's generic edition invalid-context surface. An edition behind an inaccessible publication is never looked up.

### 8.3 Externally visible access results

```ts
export type WorkspaceAccessState =
  | { readonly status: "loading" }
  | { readonly status: "signed-out"; readonly returnTo: string }
  | { readonly status: "allowed"; readonly context: ResolvedContext }
  | { readonly status: "inaccessible" }
  | { readonly status: "invalid-context"; readonly invalid: InvalidContext }
  | { readonly status: "denied" }
  | { readonly status: "temporary-failure"; readonly retry: () => void };
```

`inaccessible` and `denied` have different internal causes for deterministic tests, but they render the same public component, DOM structure, heading, message, qualification, and safe links:

- Heading: `Access unavailable`
- Message: `This workspace context is not available for this simulated session.`
- Qualification: `Demonstration only — production authorization is not evaluated here`

The surface never displays the requested ID, a foreign name, record count, alternate parent, grant details, internal cause, endpoint, or status code.

## 9. Session and access state machines

### 9.1 Session state machine

| State | Entry | Allowed transition |
|---|---|---|
| `loading` | Initial `getSession`, user resolution, profile switch, or retry is unsettled. | `ready`, `signed-out`, `denied`, `temporary-failure`. |
| `signed-out` | No simulated session or successful logout. | `loading` via a fictional sign-in/signup/verify action. |
| `ready` | Session and active `UserDto` resolved. | Profile/org/publication switch → `loading`; logout → `signed-out`; scenario result → `denied`/`temporary-failure`. |
| `denied` | UI003 returns `denied` while resolving the active user. | Retry or profile/reset action → `loading`. |
| `temporary-failure` | UI003 returns `temporary-failure` while resolving the active user. | Retry → `loading`; logout/reset remains available. |

The provider ignores stale completions using a monotonically increasing request generation held per provider instance. It uses no wall-clock identity, randomness, module singleton, or persisted counter.

### 9.2 Access state machine

| State | Visible behavior |
|---|---|
| `loading` | Protected shell chrome reveals no context; main content shows an indeterminate, visibly labeled progress state. |
| `signed-out` | Replace-navigate to `/login?returnTo=...`; no protected shell/leaf is rendered. |
| `allowed` | Render the existing Workspace or Editor shell with filtered session/context data. |
| `inaccessible` | Render `AccessUnavailablePage`; do not call the disallowed domain lookup. |
| `invalid-context` | Render existing `InvalidContextPage` with UI003's safe unavailable level. |
| `denied` | Render the same `AccessUnavailablePage` as `inaccessible`. |
| `temporary-failure` | Render a distinct retryable failure surface; do not redirect or mislabel it as denial. |

Changing identity, organization, or publication invalidates any pending older request. An older response cannot overwrite the current session/context.

## 10. Service and context boundaries

UI004 owns exactly three boundaries:

1. **`SimulatedSessionService`** — framework-free promise contract in `src/services/`; implemented by the UI004 mock adapter. It imports UI003 result/DTO contracts, never React or mocks.
2. **`SessionProvider` / `SessionContext`** — React feature boundary in `src/features/auth/`; resolves session plus `UserDto`, exposes profile data, view state, and the four mutation actions (sign in, sign out, select organization, select publication), and renders no route policy itself.
3. **`WorkspaceRouteProvider` / `useWorkspaceRouteContext`** — application integration boundary in `src/app/`; consumes `SessionContext`, `WorkspaceQueryService`, URL params, and the release-only adapter, then exposes `WorkspaceAccessState` to existing shells.

No separate `AccessContext`, global store, permission engine, repository object, or event bus is added. `WorkspaceRouteProvider` is sufficient for route access; feature-level capabilities remain later units' responsibility.

The application composition root is the only production-source location allowed to select `createMockServiceEnvironment()` and the UI004 mock session factory. Feature components and durable contracts import neither mock factory nor seed.

## 11. UI003 integration and UI002 fixture migration

### 11.1 One coherent fictional domain

The application creates one UI003 `MockServiceEnvironment` and one UI004 session environment composed with its `users` and `workspace` services. UI004 must not construct another user/organization/publication/edition object with names, locale, direction, or edition labels.

Route resolution uses:

- `UserQueryService.getUser` for the active identity and profile display names.
- `WorkspaceQueryService.listOrganizations` for switcher candidates, filtered by session grants.
- `WorkspaceQueryService.getOrganization` for requested organization context.
- `WorkspaceQueryService.listPublications` for the active organization's switcher candidates, filtered by its publication grant.
- `WorkspaceQueryService.getPublication` and `getEdition` for requested scoped context.
- UI003 scenarios unchanged for `user.get`, organization, publication, and edition operations.

UI004 does not add session operations to UI003's `MockOperation` union. Session presets are controlled separately; UI003 latency/failure/denial remains the single scenario mechanism for underlying user/workspace queries.

### 11.2 Required UI002 migration

On the UI004 integration branch:

- **Delete:** `ORG_SAHYADRI`, `ORG_KONKAN`, all three UI002 publication literals, both UI002 edition literals, their UI002-specific interfaces, `UI002_FIXTURES`, and `WorkspaceFixturesProvider` ownership of those arrays.
- **Migrate:** `resolveWorkspaceContext` from synchronous array lookup to the async service-backed `WorkspaceRouteProvider`. Preserve its `ResolvedContext`, `InvalidContext`, fallback, and non-leaking rendered semantics where compatible with the new access state.
- **Migrate:** top-level disposable route assembly from `src/demo/ui002/routeTree.tsx` to the UI004 composition so auth leaves and providers are wired once. Existing UI002 placeholders continue to occupy routes owned by later units.
- **Retain:** `PlaceholderScreen`, `EditorPhoneReviewPlaceholder`, `EditorRouteContent`, the durable route table/shells, and all UI002 navigation/focus/responsive contracts.
- **Retain as release-only and disposable:** move `ReleaseFixtureLike` and `release-demo-001` to `src/demo/ui002/release-fixtures.ts`. UI021 owns their eventual service migration. They must not be copied into the UI003 seed or UI004 session data.
- **Update tests:** UI002 route tests render the integrated provider-backed route tree with an explicit canonical session/environment. Compatibility tests prove all visible organization/publication/edition values come from UI003 and that only the release record remains UI002-owned.

Components receive detached resolved DTOs and filtered options through context. They never import `src/mocks/seed.ts`, UI004 access seed, or fixture arrays.

## 12. Route integration matrix

| # | Route/session case | Required behavior |
|---|---|---|
| 1 | Public route + signed out | Render existing Public shell and public leaf; show Sign in/Sign up links. |
| 2 | Public route + signed in | Render the same public leaf; replace entry links with active fictional identity/role, Open workspace, and Log out. |
| 3 | Auth route + signed out | Render the relevant UI004 simulated surface; no credential fields or network-backed form. |
| 4 | Auth route + signed in | Render `Already using a simulated session`, active identity/role, Open workspace, and Log out; never create a second session implicitly. |
| 5 | Workspace route + signed out | Replace-redirect to `/login?returnTo=<encoded pathname>` before protected content renders. |
| 6 | Org workspace + allowed context | Resolve through UI003, synchronize active org, render org navigation and granted organization options. |
| 7 | Publication/edition workspace + allowed context | Resolve hierarchy through UI003, synchronize active org/pub, render filtered switchers, locale/direction, breadcrumbs, and the existing leaf. |
| 8 | Workspace + inaccessible/unknown organization | Render generic `AccessUnavailablePage`; known foreign and unknown IDs are indistinguishable. |
| 9 | Workspace + inaccessible/unknown/wrong-scope publication | Render the same generic access surface; do not query the publication/edition or reveal its existence. |
| 10 | Workspace + invalid child under allowed publication | Map UI003 edition unavailable to existing generic `InvalidContextPage`; release uses the retained release-only adapter with the same semantics. |
| 11 | Workspace + UI003 denial | Render the same access surface as cases 8–9 with the exact demonstration qualification. |
| 12 | Workspace + UI003 temporary failure | Stay on the URL and render retryable failure; do not redirect or label it denied. |
| 13 | Editor route + signed out | Apply the same replace-redirect and return-to rule as case 5; render no edition identity first. |
| 14 | Editor route + allowed context | Resolve the full chain, preserve desktop/phone UI002 behavior and RTL, and render the existing Editor shell. |
| 15 | Editor route + inaccessible/invalid context | Use the same access/invalid rules as workspace routes; the minimal Editor shell must not reveal foreign context. |
| 16 | Unmatched route, any session | Preserve UI002 `NotFoundPage` and shell-aware not-found behavior; access guards must not convert an unrecognized route shape into denial. |

Route cases specified: **16**.

### 12.1 Auth-route behavior

- `/login`: show the two fictional profiles as buttons under `Demonstration identity and role`. Selecting one calls `signIn`; there is no email/password input.
- `/signup`: state that no account is created; one `Start fictional signup` action selects the default profile and replace-navigates to `/onboarding`, whose UI006 placeholder remains.
- `/verify`: state that no token or email is used; one `Continue with verified fictional profile` action selects the default profile and replace-navigates to its workspace overview.
- `/forgot-password`: collect no address. `Preview fictional recovery` produces a visible simulated acknowledgement saying no message was sent and does not sign in.

### 12.2 Return-to and navigation rules

- `returnTo` stores only the current pathname; query/hash values from the protected request are not carried in UI004.
- Accept a return target only if it matches a canonical workspace/editor route pattern. Reject absolute URLs, protocol-relative URLs, encoded external URLs, auth/public routes, and unknown route shapes; fall back to the selected profile's active publication overview.
- After sign-in, replace-navigate to the accepted target. If the selected profile cannot access it, the target renders the generic access surface rather than silently switching to another tenant.
- Intentional logout replace-navigates protected routes to `/login` without a return target. Browser Back may revisit the URL, but the guard immediately returns to login and no protected view is restored.
- Logout from a public or auth route stays on that public pathname, clears the session, and updates the shell/auth surface in place.
- Back/forward between allowed protected routes retains URL order and re-resolves context. Context synchronization must not push extra history entries.
- A real browser reload recreates the in-memory demo environment at the canonical default; UI025 owns persistence. Default-session deep links therefore refresh identically. Tests may initialize a fresh environment with another explicit preset to verify signed-out/reviewer deep links without relying on prior state.

## 13. Loading, failure, and denial behavior

- **Loading:** use UI001 `ProgressIndicator` with visible labels such as `Loading simulated session` or `Loading workspace context`. Initial loading is announced politely once; repeated internal query steps are not separately announced.
- **Ready:** render active identity, role for the active organization, and context only after all required results resolve. Do not flash the previous identity/context during a switch.
- **Signed out:** redirect as §12 specifies; auth surfaces clearly say the app is a fictional demo.
- **Inaccessible/denied:** use one `AccessUnavailablePage` with the exact copy in §8.3 and a safe link to the current session's active workspace plus a link to the public home. Never include a retry button that implies access will appear randomly.
- **Temporary failure:** use UI001 `InlineMessage variant="error"` and a real `Retry` button. Show UI003's exact temporary-failure message. A user-triggered failure/retry transition is assertively announced; an initial failure is not redundantly announced as an alert.
- **Latency:** protected leaf content remains unsettled until the injected UI003 delay completes. Loading must appear without a real-time sleep in tests.
- **Denied service scenario:** evaluation occurs before record lookup per UI003. UI004 must not probe existence after a denied result.

Failure does not clear a valid session or change the current URL. Logout and reset remain available from session-level failure UI.

## 14. Non-leakage requirements

1. Unknown and known-but-inaccessible organization IDs produce byte-equivalent access-surface content and structure for the same route family.
2. Unknown, wrong-organization, and known-but-ungranted publication IDs produce byte-equivalent access-surface content and structure.
3. An edition behind an inaccessible publication is never queried. Unknown and wrong-publication editions under an allowed publication preserve UI003/UI002 edition-level equality.
4. UI-facing errors contain no requested IDs, foreign names, counts, alternate organizations/publications, grant enumeration, diagnostic reasons, stack traces, fixture indices, or HTTP concepts.
5. Loading duration is controlled only by the selected deterministic UI003 scenario; inaccessible/unknown branches do not add distinguishable random delay.
6. Test diagnostics may name their arranged input in test code and assertion messages, but no diagnostic field is added to the public state/DOM.
7. This non-leaking simulation is not evidence of production security or tenant isolation.

## 15. Reset and test-control semantics

The UI004 mock layer exposes a controller only to composition/tests:

```ts
export type SessionPreset =
  | "sahyadri-editor"
  | "konkan-reviewer"
  | "signed-out";

export interface MockSessionController {
  setPreset(preset: SessionPreset): void;
  getPreset(): SessionPreset;
  reset(): void;
}
```

- `setPreset` is synchronous test/demo configuration, validates the exact union at runtime, and replaces the session with a fresh clone.
- `reset` restores `sahyadri-editor` and canonical active context.
- The composed application mock environment exposes `reset()` that restores the UI003 canonical seed/scenario and UI004 session preset together before subscribers observe another state.
- Repeated reset is deep-equal to a fresh environment.
- Each environment owns its session, request generation, scenario, and data snapshot. Switching/resetting one environment cannot affect another.
- Public session actions and controller results are defensively copied; mutation cannot alter later reads.
- No module-global mutable session, random profile, current-time field, localStorage, sessionStorage, IndexedDB, cookie, service worker, filesystem record, or URL token is used.
- Feature components never import `MockSessionController`; only the application composition root and tests may do so.

## 16. Accessibility requirements

- Auth, loading, access-unavailable, and failure pages each render exactly one route `<h1>` using the existing `ROUTE_HEADING_ID` convention.
- Existing skip-link, focus-after-navigation, polite route announcement, and no-initial-route-announcement behavior remains intact across redirects, login completion, logout, switches, Back, and Forward.
- Loading has visible text and a polite status; it is not communicated by animation alone. Reduced-motion behavior remains UI001-owned.
- User-triggered failure is announced once; denial/inaccessible content present on initial render is ordinary page content, not an assertive alert.
- The identity/role, organization, and publication controls have persistent visible labels, use native `Select`/`Button`, work with keyboard alone, and retain visible focus.
- Current identity, active role, organization, and publication are available as text, not color/icon alone. IDs use `<bdi>` when displayed; UI004 normally displays names instead.
- `AccessUnavailablePage` and temporary-failure UI provide a clear next action with unique accessible names.
- Changing a selector announces the resulting page title through the existing route mechanism; it does not announce every option while browsing the list.
- Representative public/auth/workspace/editor/loading/denied/failure states pass `axe-core` with zero serious/critical violations.

## 17. Responsive and RTL requirements

- Preserve UI002's phone threshold, workspace disclosure, desktop layout, phone editor review component, and no-horizontal-scroll rule at 320 CSS pixels.
- On narrow workspace views, session/identity and organization/publication controls live inside the existing disclosure rather than creating a second competing menu. Logout remains keyboard-reachable.
- On desktop, the controls may share the header but must wrap using existing layout primitives; they may not crowd the status surface or breadcrumb.
- Editor keeps compact identity/role text plus Logout and Exit editor. It does not add organization/publication selectors; users exit the editor to switch context.
- `pub-demo-urdu-evening` continues to set `dir="rtl"` and `lang="ur-IN"` after service resolution. Labels, controls, error surfaces, and breadcrumbs use logical CSS and correct reading order.
- Auth/public surfaces use document direction unless a publication context is active. Profile/user names are isolated with bidi-safe markup where needed.
- No new physical-direction CSS property or raw color value is introduced.

## 18. Visual acceptance requirements

1. **VA-01 — Session hierarchy:** active identity and role are visually secondary to Pageinator and current workspace context, but readable without opening a menu.
2. **VA-02 — Loading:** loading surfaces occupy the main content area, retain stable shell dimensions, and use UI001 pending/progress treatment without fabricated data skeletons.
3. **VA-03 — Signed out:** auth entry pages have one clear primary fictional action, an explicit simulation explanation, and no credential-like field.
4. **VA-04 — Access unavailable:** denial/inaccessible uses one clear heading, concise generic explanation, visible demonstration qualification, and safe next actions; it must not resemble a not-found or transient error page.
5. **VA-05 — Temporary failure:** failure is visually distinct from access denial and includes a prominent Retry action without clearing the current context.
6. **VA-06 — Desktop:** workspace session controls align with existing header/navigation hierarchy and do not redesign placeholder product surfaces.
7. **VA-07 — Narrow viewport:** controls wrap/collapse without overlap, truncation of required labels, or horizontal page scrolling at 320 CSS pixels.
8. **VA-08 — RTL:** the Urdu workspace preserves coherent header, selector, breadcrumb, message, and action alignment using existing tokens/logical layout.

All new visual styling uses existing `--pg-*` tokens and UI001 primitives. UI004 does not require UI005-level marketing polish or alter later feature placeholders.

Visual acceptance criteria: **8**.

## 19. Implementation tasks

### Task 1 — Define session DTOs and service contract

- Add the exact §7 DTOs and `SimulatedSessionService` under `frontend/src/services/`.
- Re-export types/contracts from the service barrel without importing React or mocks.
- Completion: type assertions prove the exact minimal fields and six promise methods.

### Task 2 — Implement the isolated mock session environment

- Add the private access seed, service adapter, controller, cloning, reset, and application-environment composition under `frontend/src/mocks/`.
- Compose with injected UI003 services; do not import UI003's private seed.
- Completion: canonical profiles, actions, reset, defensive copying, and multi-environment isolation match §§7 and 15.

### Task 3 — Implement `SessionProvider` and session UI contract

- Add `frontend/src/features/auth/session-context.tsx` and the smallest supporting hooks/types.
- Resolve `SessionSnapshot`, profile users, active `UserDto`, and stale-request protection.
- Completion: all five session view states and all four mutation actions work without mock imports.

### Task 4 — Replace synchronous fixture route resolution

- Add/convert `WorkspaceRouteProvider` and its hook in `frontend/src/app/`.
- Resolve UI003 organization/publication/edition context, filtered switcher options, access ordering, scenario states, and release-only lookup.
- Completion: §8 and §9 access states are exhaustive and non-leaking.

### Task 5 — Add UI004 auth/session/access surfaces

- Add the four auth-route surfaces, shared session controls, `AccessUnavailablePage`, and retryable failure/loading surfaces under `frontend/src/features/auth/`.
- Reuse UI001 controls and exact messages; do not create one component per trivial text variant when a shared component is clearer.
- Completion: BR-01 through BR-04 behavior is visible and accessible.

### Task 6 — Integrate routes and migrate UI002 fixtures

- Create the integrated UI004 route composition, update `main.tsx`, inject both environments, and apply §11.2 deletion/migration/retention rules.
- Adapt the three shells minimally for session controls and async route context.
- Completion: one domain source remains and all 16 route cases pass.

### Task 7 — Preserve responsive, RTL, focus, and visual behavior

- Extend shell styling only where needed, using existing tokens/logical properties.
- Verify all §16–§18 requirements at desktop, 320px, and Urdu context.
- Completion: VA-01 through VA-08 and accessibility criteria pass.

### Task 8 — Add session/access behavioral tests

- Add focused UI004 contract, session, route-access, reset, scenario, and non-leakage tests.
- Use injected delay/fake timers, runtime forbidden-API spies, and table-driven equality cases.
- Completion: §§20 and 21 behavior is covered without real waits or assertion inflation.

### Task 9 — Update UI002/UI003 integration and boundary tests

- Update existing tests for the provider-backed integrated route tree; preserve their behavioral intent.
- Add static/import tests proving no duplicate domain fixtures and correct dependency direction.
- Completion: UI001/UI002/UI003 regressions remain green and the release-only exception is explicit.

### Task 10 — Final verification

- Run typecheck, full tests, and production build under the supported Node engine.
- Inspect dependency files and git hygiene; perform a real-browser viewport/focus check where jsdom cannot establish layout.
- Completion: all acceptance criteria pass with no dependency, backend, persistence, commit, or push.

Implementation tasks: **10**.

## 20. Test requirements

Tests exercise public services/providers/routes. Behavioral tests do not inspect private maps or arrays.

| Area | Required tests |
|---|---|
| Contract shape | Exact DTO fields, readonly nested grants/arrays, six promise methods, services independent of React/mocks. |
| Default session | Fresh environment resolves the Sahyadri editor user, both grants, canonical active context, and matching UI003 user/domain values. |
| Signed out/in | Preset and public actions produce exact snapshots; expected states resolve rather than reject. |
| Active user | Both profile IDs resolve through `UserQueryService`; unavailable/denied/failure are mapped truthfully. |
| Role/profile switch | Switch to Konkan reviewer and prove visible identity/role, active context, option lists, route, and access change together. |
| Organization switch | Default profile switches Sahyadri → Konkan; role becomes reviewer, Ratnagiri becomes active, and stale Sahyadri UI disappears. |
| Publication switch | Pune ↔ Urdu updates route, active session, label, locale/direction, and scoped options. |
| Accessible organization/publication/edition | Correct chains render through UI003 services and only granted options appear. |
| Inaccessible organization | Known ungranted and unknown IDs produce identical public state/DOM with no domain lookup. |
| Inaccessible publication | Unknown, wrong-organization, and known-ungranted cases produce identical output and do not query edition. |
| Edition hierarchy | Correct edition succeeds; unknown, same-org wrong-publication, and cross-org cases preserve UI003/UI002 non-leakage. |
| Denial | Known/unknown affected calls render the same access surface and exact qualification; no production claim. |
| Temporary failure | Distinct failure surface, URL/session retained, Retry reissues queries and can recover. |
| Loading/latency | Promise remains unsettled at the controlled boundary; loading is visible/announced; no real sleep. |
| Logout | Clears user/grants/active IDs, removes protected DOM, redirects correctly, and Back cannot restore protected content. |
| Reset/isolation | Repeated composed reset equals fresh environment; changing/resetting one environment does not affect another. |
| Defensive copying | Mutate returned profiles, access grants, publication arrays, and snapshots; later reads remain canonical. |
| Auth routes | Login/signup/verify/recovery exact actions and copy; no credential fields, form submission, token parsing, email/network action, or false success. |
| Public routes | Signed-out vs. signed-in header behavior without changing public leaf content. |
| Protected routes | All workspace/editor cases in §12, including accepted/rejected return targets and no protected-content flash. |
| Deep link/refresh | Fresh default deep links resolve directly; explicit signed-out/reviewer environments resolve deterministically; documented reload reset is tested. |
| Back/forward | Allowed route history order remains exact; context synchronization adds no entry; logout history remains guarded. |
| UI003 adapter integration | Runtime spies prove calls go through injected services; scenario targeting affects the expected surface; no consumer imports seed. |
| No competing fixtures | Static scan proves no UI002 org/publication/edition literals or arrays remain; access seed contains IDs/grants only; release-only fixture remains the sole exception. |
| Boundaries | `services` imports no mocks/React; feature/app imports contracts, not mock seeds/controllers; mock adapters point inward. |
| Forbidden behavior | Static scans plus restored runtime spies prove no fetch/XHR/WebSocket, auth/email action, cookie, storage, service worker, random/current-time identity, or filesystem persistence. |
| Accessibility/focus | Keyboard-only controls, redirect/login/logout focus, live-region policy, one h1, landmarks, labels, and representative axe checks. |
| Responsive/RTL | Desktop, 320px, phone-editor review, header disclosure, no overflow, Urdu direction/language, logical CSS. |
| Visual acceptance | Browser evidence for VA-01–VA-08 at desktop/narrow widths and loading/denied/failure states. |
| Regression | Existing UI001, UI002, and UI003 tests plus full typecheck/test/build remain green. |

## 21. Acceptance criteria

UI004 passes only if all criteria below pass.

1. **AC-01:** `/login`, `/signup`, `/verify`, and `/forgot-password` render UI004 surfaces using only canonical fictional profiles and contain no real credential/email/token collection.
2. **AC-02:** Login/signup/verify/recovery actions perform no network, email, provider, cookie, storage, or persistence operation and never claim a real account/message/verification exists.
3. **AC-03:** Changing demonstration identity/role, organization, or publication updates visible identity/role, filtered navigation/options, active session IDs, and route context consistently.
4. **AC-04:** Every inaccessible or scenario-denied protected route renders the specified generic denied state with the exact demonstration-only qualification.
5. **AC-05:** Logout atomically clears the session/grants/active selections and prevents protected fixture content from rendering until another fictional sign-in.
6. **AC-06:** Session DTOs contain exactly the fields and unions in §7.1, all readonly, with no production identity/session/capability fields.
7. **AC-07:** `SimulatedSessionService` exposes exactly the six §7.3 promise methods and expected outcomes resolve to `ServiceResult` rather than reject.
8. **AC-08:** A fresh environment begins signed in as `user-demo-sahyadri-editor` at Sahyadri/Pune with the exact two grants in §7.2.
9. **AC-09:** The Konkan reviewer profile contains only the Konkan/Ratnagiri reviewer grant and selects it canonically.
10. **AC-10:** Profile display identity is resolved through UI003 `UserQueryService`; UI004 stores no duplicate user display name.
11. **AC-11:** UI004's session seed contains only canonical user/org/publication IDs and grant/role relationships; it duplicates no organization/publication/edition names, locale, direction, or labels.
12. **AC-12:** Profile/role switch to Konkan reviewer removes Sahyadri options/content and replace-navigates to Konkan/Ratnagiri overview.
13. **AC-13:** Default-profile organization switch Sahyadri → Konkan selects Ratnagiri, changes visible role to reviewer, and adds no extra history entry beyond the user navigation.
14. **AC-14:** Publication switch Pune ↔ Urdu updates route and session together and preserves `en-IN`/LTR versus `ur-IN`/RTL behavior from UI003.
15. **AC-15:** Organization and publication selectors expose only options granted to the active profile and returned by UI003.
16. **AC-16:** Unknown and known-but-ungranted organization selections resolve to the exact same denied `ServiceResult` without mutating the session.
17. **AC-17:** Unknown, wrong-organization, and known-but-ungranted publication selections resolve to the exact same denied `ServiceResult` without mutating the session.
18. **AC-18:** `signOut` succeeds locally and clears state even when UI003 user/workspace operations are configured for denial or temporary failure.
19. **AC-19:** Protected route resolution follows §8.2 order and performs no organization/publication/edition lookup after an earlier signed-out or inaccessible decision.
20. **AC-20:** Unknown and known-but-inaccessible organization route inputs produce byte-equivalent access-surface DOM/copy with no requested/foreign identifier or name.
21. **AC-21:** Unknown, wrong-organization, and known-but-inaccessible publication route inputs produce byte-equivalent access-surface DOM/copy and no edition lookup.
22. **AC-22:** Unknown and wrong-publication editions under an allowed publication retain UI003's exact non-leaking edition-level result and UI002's generic invalid-context presentation.
23. **AC-23:** UI003 denial is evaluated before record lookup and renders identically for known and unknown route inputs at the affected access level.
24. **AC-24:** UI003 temporary failure renders a distinct retryable failure state, retains URL/session, and can recover after scenario normalization without appearing denied.
25. **AC-25:** UI003 latency produces a visible loading state until the controlled delay resolves, with no real-time sleep or random delay in tests.
26. **AC-26:** Stale session/context requests cannot overwrite a newer profile, organization, publication, logout, or reset result.
27. **AC-27:** Public routes remain available signed in and signed out; only the session affordance changes, not the public leaf content.
28. **AC-28:** The four auth routes follow §12.1 exactly, including recovery's non-sending acknowledgement and absence of credential-like fields.
29. **AC-29:** Signed-out workspace/editor deep links replace-redirect to login with a safely encoded canonical return path before any protected label/content renders.
30. **AC-30:** Successful fictional login accepts only canonical internal protected return paths; unsafe/unknown targets fall back to the profile's active overview, and logout does not preserve a return target.
31. **AC-31:** Workspace/editor allowed, inaccessible, invalid-child, denied, failure, and not-found cases remain distinct exactly as the 16-case route matrix specifies.
32. **AC-32:** Back/forward preserves visited URL order; route-to-session synchronization does not push hidden history entries; Back after logout cannot restore protected UI.
33. **AC-33:** A fresh application load deterministically restores the canonical default, and refresh-equivalent initialization at explicit signed-out/reviewer presets is order-independent in tests.
34. **AC-34:** UI003 is the sole user/organization/publication/edition data source; UI002's overlapping fixture literals, arrays, and provider are removed.
35. **AC-35:** `release-demo-001` remains the only UI002-owned route-context record, is clearly release-only/disposable, and is not added to UI003/UI004 DTOs or seeds.
36. **AC-36:** Durable service/app/feature code imports no mock seed/controller; mocks depend inward on service contracts; UI components receive services/state through composition/context.
37. **AC-37:** Repeated composed reset restores UI003 seed/normal scenario and UI004 default session atomically and deep-equals a fresh environment.
38. **AC-38:** Multiple application mock environments are isolated, and mutation of returned session/profile/grant arrays cannot affect later reads or another environment.
39. **AC-39:** UI004 uses no global mutable session, randomness/current time, browser/filesystem persistence, service worker, cookie/token, network/auth/email API, backend, or database.
40. **AC-40:** Auth/loading/denied/failure/public/workspace/editor states meet §16 keyboard, focus, announcement, landmark, label, and axe requirements.
41. **AC-41:** Existing phone workspace/editor-review and desktop behavior remains; new controls fit at 320 CSS pixels without horizontal page scrolling.
42. **AC-42:** Urdu publication context remains `dir="rtl"`/`lang="ur-IN"`; new UI uses logical CSS, existing tokens, and no raw color or physical-direction property.
43. **AC-43:** All eight visual acceptance requirements in §18 are verified without redesigning later feature placeholders.
44. **AC-44:** UI004 adds zero runtime and zero development dependencies; package manifest, lockfile, and dependency record are unchanged.
45. **AC-45:** No real auth/authorization, UI005+, backend, persistence, complete RBAC/ABAC, production schema, `EditableDocument`, or `ResolvedDocument` scope is introduced.
46. **AC-46:** Under a supported Node runtime, `npm run typecheck`, `npm test -- --run`, and `npm run build` succeed with all UI001, UI002, UI003, and UI004 tests green.

Acceptance criteria count: **46**.

## 22. Files and domain boundaries

Expected implementation shape:

```text
frontend/
  src/
    services/
      session-dtos.ts                 # UI-only session/profile/grant DTOs
      simulated-session-service.ts    # framework-free promise contract
      index.ts                         # adds UI004 exports
    mocks/
      session-seed.ts                 # private IDs/grants only
      create-mock-session-environment.ts
      create-mock-application-environment.ts
      index.ts                         # public factories/types, no seed export
    features/
      auth/
        session-context.tsx
        SessionControls.tsx
        AuthRouteScreen.tsx
        AccessUnavailablePage.tsx
        ContextStatusPage.tsx          # loading/failure presentation if shared
        index.ts
    app/
      contracts/
        route-context.ts               # migrated async resolved-state contract
      WorkspaceRouteProvider.tsx
      shells/
        PublicShell.tsx                # minimal session affordance integration
        WorkspaceShell.tsx             # provider state + filtered controls
        EditorShell.tsx                # compact identity/logout integration
    demo/
      ui002/
        release-fixtures.ts            # release-demo-001 only
        PlaceholderScreen.tsx           # retained
        EditorPhoneReviewPlaceholder.tsx
        EditorRouteContent.tsx
      ui004/
        routeTree.tsx                  # integrated disposable composition
    main.tsx
  tests/
    ui002/                              # adapted, not weakened
    ui003/                              # integration regressions retained
    ui004/
      contracts.test.ts
      session-and-reset.test.tsx
      route-access.test.tsx
      scenarios-and-nonleakage.test.tsx
      accessibility-responsive.test.tsx
      boundary.test.ts
```

Exact file grouping may be smaller where it improves clarity. Do not create one file per state, role, profile, or route.

Authorized implementation changes are limited to UI004 files plus the smallest required edits to `src/services/**`, `src/mocks/**`, `src/app/**`, `src/demo/ui002/**`, `src/main.tsx`, and UI002/UI003 tests for the mandated integration. UI001 source, package files, backend/worker/publishing/schema areas, and unrelated docs are out of scope.

## 23. Dependency policy

UI004 requires **zero new runtime dependencies and zero new development dependencies**. Existing React context/hooks, React Router, TypeScript, promises, UI001 primitives, UI003 services/scenarios, Vitest, Testing Library, axe-core, and browser APIs are sufficient.

No package manifest, lockfile, or `frontend/DEPENDENCIES.md` change is authorized. If implementation appears to require a state manager, auth SDK, schema library, fake server, or persistence library, stop and simplify to the explicit contracts above; such a dependency would be a scope/design error, not an adoption candidate for UI004.

## 24. Prohibited shortcuts

- Do not add email/password fields with a `type="password"` merely to look realistic.
- Do not call an auth/email/network API, submit a real form, store a token, or navigate to `mailto:`.
- Do not call client-side access checks production authorization or security.
- Do not expose all UI003 organizations/publications and merely disable inaccessible options; filter them before rendering.
- Do not look up a foreign/unknown organization or publication to decide which denial copy to show.
- Do not render a different message, DOM shape, timing, fallback suggestion, or count for unknown versus known-but-inaccessible input.
- Do not redirect temporary failure to login or access denial.
- Do not use raw fixture arrays, UI003's private seed, UI002's overlapping literals, or a generic `mockDb` in feature/UI code.
- Do not add session operations to UI003's scenario union or weaken UI003 error/scoping semantics.
- Do not persist session/profile/context in localStorage, sessionStorage, IndexedDB, cookies, URL tokens, or filesystem state; UI025 owns demo persistence.
- Do not add a full permission matrix, editable role administration, invitation flow, membership CRUD, or feature-action capability system.
- Do not invent a new shell, route family, global store, repository abstraction, or provider per state.
- Do not weaken or delete UI001/UI002/UI003 tests to accommodate asynchronous integration; adapt setup and retain behavior.
- Do not implement onboarding, dashboard, edition commands, team settings, or any later placeholder.
- Do not install, stage, commit, or push under this specification alone.

## 25. Completion checklist

- [ ] All 4 backlog acceptance requirements and 5 backlog test expectations are covered.
- [ ] Session DTOs/service contain only the exact §7 fields/methods.
- [ ] Canonical profiles/default/access grants match §7.2 and use UI003 IDs.
- [ ] `SessionProvider` and `WorkspaceRouteProvider` are the only React state boundaries needed.
- [ ] Access evaluation, state machines, exact denial copy, failure/retry, and non-leakage match §§8–14.
- [ ] All 16 route cases, auth-route behavior, return-to, deep-link, refresh, and history rules pass.
- [ ] Logout, reset, defensive copying, stale-result protection, and environment isolation pass.
- [ ] UI002 overlapping user/org/publication/edition fixture ownership is removed; release-only fixture remains.
- [ ] UI003 services/scenarios are reused without direct seed imports or competing records.
- [ ] Accessibility, responsive/RTL, and all 8 visual acceptance requirements pass.
- [ ] Zero dependencies are added and all prohibited APIs/scope are absent.
- [ ] All 10 implementation tasks and 46 acceptance criteria pass.
- [ ] Typecheck, full tests, build, and UI001/UI002/UI003 regressions pass under a supported Node runtime.
- [ ] No real authentication/authorization/backend/persistence is claimed or implemented.
- [ ] No commit or push occurs without separate authorization.

UI004 is ready for implementation. It has no architecture or product-owner blocker because every identity, role, grant, route outcome, and reset behavior here is explicitly fictional and bounded. Production identity-provider, membership/capability, security, and persistence decisions remain correctly deferred to their owning workstreams.
