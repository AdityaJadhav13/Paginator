import { createContext, useContext, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { PublicShell } from "../../app/shells/PublicShell.tsx";
import { WorkspaceShell } from "../../app/shells/WorkspaceShell.tsx";
import { EditorShell } from "../../app/shells/EditorShell.tsx";
import { ScopedNotFoundShell } from "../../app/shells/ScopedNotFoundShell.tsx";
import { EditionWorkspaceLayout } from "../../app/EditionWorkspaceLayout.tsx";
import { NotFoundPage } from "../../app/NotFoundPage.tsx";
import { RouteAnnouncer } from "../../app/RouteAnnouncer.tsx";
import { WorkspaceRouteProvider } from "../../app/contracts/route-context.ts";
import { PATTERNS, ROUTE_LABELS, OWNING_UNIT } from "../../app/routes.ts";
import { SessionProvider } from "../../features/auth/SessionProvider.tsx";
import { AuthRouteScreen } from "../../features/auth/AuthRouteScreen.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment } from "../../mocks/index.ts";
import { PlaceholderScreen } from "../ui002/PlaceholderScreen.tsx";
import { EditorRouteContent } from "../ui002/EditorRouteContent.tsx";
import { RELEASE_FIXTURES } from "../ui002/release-fixtures.ts";
import "../../app/shell.css";

type LabeledRouteKey = keyof typeof ROUTE_LABELS & keyof typeof OWNING_UNIT;
function placeholder(key: LabeledRouteKey) {
  return <PlaceholderScreen title={ROUTE_LABELS[key]} owningUnit={OWNING_UNIT[key]} />;
}

function WorkspaceBoundary({ editor = false }: { readonly editor?: boolean }) {
  const environment = useEnvironment();
  return (
    <WorkspaceRouteProvider
      workspace={environment.workspace}
      releases={RELEASE_FIXTURES}
      getSessionMutationGeneration={environment.getSessionMutationGeneration}
    >
      {editor ? <EditorShell /> : <WorkspaceShell />}
    </WorkspaceRouteProvider>
  );
}

const EnvironmentContext = createContext<MockApplicationEnvironment | null>(null);
function useEnvironment() {
  const value = useContext(EnvironmentContext);
  if (!value) throw new Error("UI004 environment is unavailable.");
  return value;
}

export function Ui004Routes({ environment }: { readonly environment?: MockApplicationEnvironment }) {
  const [ownedEnvironment] = useState(() => createMockApplicationEnvironment());
  const activeEnvironment = environment ?? ownedEnvironment;
  return (
    <EnvironmentContext.Provider value={activeEnvironment}>
      <SessionProvider
        session={activeEnvironment.session}
        users={activeEnvironment.users}
        invalidatePendingMutations={activeEnvironment.invalidatePendingSessionMutations}
      >
        <RouteAnnouncer />
        <Routes>
          <Route element={<PublicShell />}>
            <Route path={PATTERNS.home} element={placeholder("home")} />
            <Route path={PATTERNS.features} element={placeholder("features")} />
            <Route path={PATTERNS.pricing} element={placeholder("pricing")} />
            <Route path={PATTERNS.security} element={placeholder("security")} />
            <Route path={PATTERNS.contact} element={placeholder("contact")} />
            <Route path={PATTERNS.login} element={<AuthRouteScreen kind="login" />} />
            <Route path={PATTERNS.signup} element={<AuthRouteScreen kind="signup" />} />
            <Route path={PATTERNS.forgotPassword} element={<AuthRouteScreen kind="forgot-password" />} />
            <Route path={PATTERNS.verify} element={<AuthRouteScreen kind="verify" />} />
            <Route path={PATTERNS.onboarding} element={placeholder("onboarding")} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>

          <Route path={PATTERNS.workspaceRoot} element={<WorkspaceBoundary />}>
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
            <Route path={PATTERNS.editionLayout} element={<EditionWorkspaceLayout />}>
              <Route index element={<Navigate to={PATTERNS.editionContent} replace />} />
              <Route path={PATTERNS.editionContent} element={placeholder("editionContent")} />
              <Route path={PATTERNS.editionGenerate} element={placeholder("editionGenerate")} />
              <Route path={PATTERNS.editionPreflight} element={placeholder("editionPreflight")} />
              <Route path={PATTERNS.editionExport} element={placeholder("editionExport")} />
            </Route>
          </Route>

          <Route path={PATTERNS.editionEditor} element={<WorkspaceBoundary editor />}>
            <Route index element={<EditorRouteContent />} />
          </Route>
          <Route path={`${PATTERNS.editionEditor}/*`} element={<ScopedNotFoundShell editor />} />
          <Route path="/org/:orgId/*" element={<ScopedNotFoundShell />} />
        </Routes>
      </SessionProvider>
    </EnvironmentContext.Provider>
  );
}

export function Ui004App() {
  return <BrowserRouter><Ui004Routes /></BrowserRouter>;
}
