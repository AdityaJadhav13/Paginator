import { createContext, useContext, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { PublicShell } from "../app/shells/PublicShell.tsx";
import { WorkspaceShell } from "../app/shells/WorkspaceShell.tsx";
import { EditorShell } from "../app/shells/EditorShell.tsx";
import { ScopedNotFoundShell } from "../app/shells/ScopedNotFoundShell.tsx";
import { EditionWorkspaceLayout } from "../app/EditionWorkspaceLayout.tsx";
import { NotFoundPage } from "../app/NotFoundPage.tsx";
import { RouteAnnouncer } from "../app/RouteAnnouncer.tsx";
import { WorkspaceRouteProvider } from "../app/contracts/route-context.ts";
import { PATTERNS, ROUTE_LABELS, OWNING_UNIT } from "../app/routes.ts";
import { SessionProvider } from "../features/auth/SessionProvider.tsx";
import { AuthRouteScreen } from "../features/auth/AuthRouteScreen.tsx";
import { createMockApplicationEnvironment, type MockApplicationEnvironment } from "../mocks/index.ts";
import { PlaceholderScreen } from "../demo/ui002/PlaceholderScreen.tsx";
import { Container } from "../ui/index.ts";
import { HomePage, FeaturesPage, PricingPage, SecurityPage, ContactPage } from "../features/public/index.ts";
import { EditorRouteContent } from "../demo/ui002/EditorRouteContent.tsx";
import { RELEASE_FIXTURES } from "../demo/ui002/release-fixtures.ts";
import "../app/shell.css";

type LabeledRouteKey = keyof typeof ROUTE_LABELS & keyof typeof OWNING_UNIT;
function placeholder(key: LabeledRouteKey) {
  return <PlaceholderScreen title={ROUTE_LABELS[key]} owningUnit={OWNING_UNIT[key]} />;
}

/**
 * UI005 §20.4 moved the content measure out of PublicShell's <main> so the
 * public surfaces can render full-width bands. Every other public-shell
 * route supplies the measure here instead, which keeps rows 6-10 (auth and
 * onboarding) rendering exactly as they did before.
 */
function measured(element: ReactNode) {
  return <Container>{element}</Container>;
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

export function AppRoutes({ environment }: { readonly environment?: MockApplicationEnvironment }) {
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
            <Route path={PATTERNS.home} element={<HomePage />} />
            <Route path={PATTERNS.features} element={<FeaturesPage />} />
            <Route path={PATTERNS.pricing} element={<PricingPage />} />
            <Route path={PATTERNS.security} element={<SecurityPage />} />
            <Route path={PATTERNS.contact} element={<ContactPage />} />
            <Route path={PATTERNS.login} element={measured(<AuthRouteScreen kind="login" />)} />
            <Route path={PATTERNS.signup} element={measured(<AuthRouteScreen kind="signup" />)} />
            <Route path={PATTERNS.forgotPassword} element={measured(<AuthRouteScreen kind="forgot-password" />)} />
            <Route path={PATTERNS.verify} element={measured(<AuthRouteScreen kind="verify" />)} />
            <Route path={PATTERNS.onboarding} element={measured(placeholder("onboarding"))} />
            <Route path="*" element={measured(<NotFoundPage />)} />
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

export function AppRoot() {
  return <BrowserRouter><AppRoutes /></BrowserRouter>;
}
