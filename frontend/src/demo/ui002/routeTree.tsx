/**
 * UI002 route assembly — disposable.
 *
 * References fixture IDs and placeholder components, so it lives in
 * the demo layer, not `src/app/**`. Durable shells and layouts never
 * import this module; it imports them. A reviewer can delete
 * `src/demo/ui002/**` and `src/app/**` still typechecks on its own
 * (UI002 §16).
 *
 * Uses the plain `<BrowserRouter>`/`<Routes>` declarative API, not the
 * data router (`createBrowserRouter`/`RouterProvider`): UI002 has no
 * loaders/actions, so the simpler API is sufficient (see UI002 §12 /
 * `DEPENDENCIES.md`). `WorkspaceShell` derives its breadcrumb's
 * "current section" label from the URL directly rather than via
 * `useMatches()`, which requires the data router.
 *
 * `Ui002Routes` is router-agnostic (no `<BrowserRouter>` of its own),
 * so tests can wrap it in `<MemoryRouter initialEntries={[...]}>` for
 * an isolated starting URL per test. `Ui002App` — what `main.tsx`
 * mounts — wraps it in the real `<BrowserRouter>`.
 */
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { PublicShell } from "../../app/shells/PublicShell.tsx";
import { WorkspaceShell } from "../../app/shells/WorkspaceShell.tsx";
import { EditorShell } from "../../app/shells/EditorShell.tsx";
import { EditionWorkspaceLayout } from "../../app/EditionWorkspaceLayout.tsx";
import { NotFoundPage } from "../../app/NotFoundPage.tsx";
import { RouteAnnouncer } from "../../app/RouteAnnouncer.tsx";
import { WorkspaceFixturesProvider } from "../../app/contracts/route-context.ts";
import { PATTERNS, ROUTE_LABELS, OWNING_UNIT } from "../../app/routes.ts";
import { PlaceholderScreen } from "./PlaceholderScreen.tsx";
import { EditorRouteContent } from "./EditorRouteContent.tsx";
import { UI002_FIXTURES } from "./fixtures.ts";
import "../../app/shell.css";

type LabeledRouteKey = keyof typeof ROUTE_LABELS & keyof typeof OWNING_UNIT;

function placeholder(key: LabeledRouteKey) {
  return <PlaceholderScreen title={ROUTE_LABELS[key]} owningUnit={OWNING_UNIT[key]} />;
}

export function Ui002Routes() {
  return (
    <WorkspaceFixturesProvider value={UI002_FIXTURES}>
      <RouteAnnouncer />
      <Routes>
        {/* Public family — §6 rows 1–10 */}
        <Route element={<PublicShell />}>
          <Route path={PATTERNS.home} element={placeholder("home")} />
          <Route path={PATTERNS.features} element={placeholder("features")} />
          <Route path={PATTERNS.pricing} element={placeholder("pricing")} />
          <Route path={PATTERNS.security} element={placeholder("security")} />
          <Route path={PATTERNS.contact} element={placeholder("contact")} />
          <Route path={PATTERNS.login} element={placeholder("login")} />
          <Route path={PATTERNS.signup} element={placeholder("signup")} />
          <Route path={PATTERNS.forgotPassword} element={placeholder("forgotPassword")} />
          <Route path={PATTERNS.verify} element={placeholder("verify")} />
          <Route path={PATTERNS.onboarding} element={placeholder("onboarding")} />

          {/* Not-found (§6, §8.2) — nested under PublicShell so it
              still gets skip-link/nav/footer chrome, matching "else
              Public" in the route table's fallback row. An org-scoped
              path that matches no WorkspaceShell child falls through
              react-router's whole workspaceRoot branch to this same
              catch-all, per "whichever shell can be determined, else
              Public". */}
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        {/* Workspace family — §6 rows 11–32 */}
        <Route path={PATTERNS.workspaceRoot} element={<WorkspaceShell />}>
          <Route path={PATTERNS.orgSettings} element={placeholder("orgSettings")} />
          <Route path={PATTERNS.orgBilling} element={placeholder("orgBilling")} />
          <Route path={PATTERNS.orgStorage} element={placeholder("orgStorage")} />

          <Route path={PATTERNS.pubOverview} element={placeholder("pubOverview")} />
          <Route path={PATTERNS.pubEditions} element={placeholder("pubEditions")} />
          <Route path={PATTERNS.pubStories} element={placeholder("pubStories")} />
          <Route path={PATTERNS.pubMedia} element={placeholder("pubMedia")} />
          <Route path={PATTERNS.pubAds} element={placeholder("pubAds")} />
          <Route path={PATTERNS.pubTemplates} element={placeholder("pubTemplates")} />
          <Route path={PATTERNS.pubNewsroom} element={placeholder("pubNewsroom")} />
          <Route path={PATTERNS.pubSources} element={placeholder("pubSources")} />
          <Route path={PATTERNS.pubArchive} element={placeholder("pubArchive")} />
          <Route path={PATTERNS.pubArchiveRelease} element={placeholder("pubArchiveRelease")} />
          <Route path={PATTERNS.pubBrand} element={placeholder("pubBrand")} />
          <Route path={PATTERNS.pubPrintProfiles} element={placeholder("pubPrintProfiles")} />
          <Route path={PATTERNS.pubTeam} element={placeholder("pubTeam")} />

          {/* Edition workspace — §6 rows 27–32 */}
          <Route path={PATTERNS.editionLayout} element={<EditionWorkspaceLayout />}>
            <Route index element={<Navigate to={PATTERNS.editionContent} replace />} />
            <Route path={PATTERNS.editionContent} element={placeholder("editionContent")} />
            <Route path={PATTERNS.editionGenerate} element={placeholder("editionGenerate")} />
            <Route path={PATTERNS.editionPreflight} element={placeholder("editionPreflight")} />
            <Route path={PATTERNS.editionExport} element={placeholder("editionExport")} />
          </Route>
        </Route>

        {/* Editor family — §6 row 33. Its own top-level route, not
            nested under workspaceRoot: EditorShell replaces
            WorkspaceShell's chrome entirely (§7.3). */}
        <Route path={PATTERNS.editionEditor} element={<EditorShell />}>
          <Route index element={<EditorRouteContent />} />
        </Route>

        {/* Shell-aware not-found routes. More-specific canonical
            branches above win route ranking; these preserve the shell
            and resolved prefix for an unknown terminal destination. */}
        <Route path={`${PATTERNS.editionEditor}/*`} element={<EditorShell notFound />} />
        <Route
          path="/org/:orgId/pub/:pubId/editions/:editionId/*"
          element={<WorkspaceShell notFound />}
        />
        <Route path="/org/:orgId/pub/:pubId/*" element={<WorkspaceShell notFound />} />
        <Route path="/org/:orgId/*" element={<WorkspaceShell notFound />} />
      </Routes>
    </WorkspaceFixturesProvider>
  );
}

export function Ui002App() {
  return (
    <BrowserRouter>
      <Ui002Routes />
    </BrowserRouter>
  );
}
