import { createContext, useContext, useState, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { PublicShell } from "../app/shells/PublicShell.tsx";
import { WorkspaceShell } from "../app/shells/WorkspaceShell.tsx";
import { EditorShell } from "../app/shells/EditorShell.tsx";
import { AccountShell } from "../app/shells/AccountShell.tsx";
import { ScopedNotFoundShell } from "../app/shells/ScopedNotFoundShell.tsx";
import { EditionWorkspaceLayout } from "../app/EditionWorkspaceLayout.tsx";
import { NotFoundPage } from "../app/NotFoundPage.tsx";
import { RouteAnnouncer } from "../app/RouteAnnouncer.tsx";
import { WorkspaceRouteProvider } from "../app/contracts/route-context.ts";
import { PATTERNS, ROUTE_LABELS, OWNING_UNIT } from "../app/routes.ts";
import { createApiEnvironment } from "../api/environment.ts";
import { AccountProvider } from "../features/auth/account-context.tsx";
import { ForgotPasswordScreen } from "../features/auth/ForgotPasswordScreen.tsx";
import { InvitationScreen } from "../features/auth/InvitationScreen.tsx";
import { ResetPasswordScreen } from "../features/auth/ResetPasswordScreen.tsx";
import { SessionProvider } from "../features/auth/SessionProvider.tsx";
import { SignedOutRedirect } from "../features/auth/SignedOutRedirect.tsx";
import { SignInScreen } from "../features/auth/SignInScreen.tsx";
import { SignUpScreen } from "../features/auth/SignUpScreen.tsx";
import { PaperOnboardingScreen } from "../features/paper-onboarding/PaperOnboardingScreen.tsx";
import { VerifyEmailScreen } from "../features/auth/VerifyEmailScreen.tsx";
import { TwoStepScreen } from "../features/auth/TwoStepScreen.tsx";
import { OrgHome } from "../features/people/OrgHome.tsx";
import { SecurityScreen } from "../features/people/SecurityScreen.tsx";
import { PeopleProvider } from "../features/people/services-context.tsx";
import { TeamScreen } from "../features/people/TeamScreen.tsx";
import { AuditScreen } from "../features/people/AuditScreen.tsx";
import { StoriesProvider } from "../features/stories/stories-context.tsx";
import { MediaProvider } from "../features/stories/media-context.tsx";
import { NewsroomProvider } from "../features/live/live-context.tsx";
import { StoriesScreen } from "../features/stories/StoriesScreen.tsx";
import { StoryEditor } from "../features/stories/StoryEditor.tsx";
import { EditionsProvider } from "../features/editions/editions-context.tsx";
import { EditionsScreen } from "../features/editions/EditionsScreen.tsx";
import { MediaScreen } from "../features/media/MediaScreen.tsx";
import { NewsProvider } from "../features/news/news-context.tsx";
import { SourcesScreen } from "../features/news/SourcesScreen.tsx";
import { LayoutProvider } from "../features/layout/layout-context.tsx";
import { EditionLayoutScreen } from "../features/layout/EditionLayoutScreen.tsx";
import { EngineProfileScreen } from "../features/layout/EngineProfileScreen.tsx";
import { EditorProvider } from "../features/editor/editor-context.tsx";
import { PageEditorScreen } from "../features/editor/PageEditorScreen.tsx";
import { ReleaseProvider } from "../features/release/release-context.tsx";
import { AdsProvider } from "../features/ads/ads-context.tsx";
import { AdsScreen } from "../features/ads/AdsScreen.tsx";
import { PublicationOverview } from "../features/people/PublicationOverview.tsx";
import { I18nProvider } from "../i18n/index.ts";
import type { ServiceEnvironment } from "../services/index.ts";
import { PlaceholderScreen } from "../demo/ui002/PlaceholderScreen.tsx";
import { Container } from "../ui/index.ts";
import { HomePage, FeaturesPage, PricingPage, SecurityPage, ContactPage, LegalPage } from "../features/public/index.ts";
import { ContactProvider } from "../features/contact/contact-context.tsx";
import { EditorRouteContent } from "../demo/ui002/EditorRouteContent.tsx";
import "../app/shell.css";
import { TemplatesScreen } from "../features/templates/TemplatesScreen.tsx";
import { NewsroomScreen } from "../features/newsroom/NewsroomScreen.tsx";
import { ArchiveScreen } from "../features/archive/ArchiveScreen.tsx";
import { ArchiveReleaseScreen } from "../features/archive/ArchiveReleaseScreen.tsx";
import { BrandScreen } from "../features/brand/BrandScreen.tsx";
import { PrintProfilesScreen } from "../features/print-profiles/PrintProfilesScreen.tsx";
import { OrgSettingsScreen } from "../features/settings/OrgSettingsScreen.tsx";
import { PublicationSettingsScreen } from "../features/settings/PublicationSettingsScreen.tsx";

type LabeledRouteKey = keyof typeof ROUTE_LABELS & keyof typeof OWNING_UNIT;
/** A screen still to be built: English, and in a development build only (plan §2.6). */
function placeholder(key: LabeledRouteKey) {
  return (
    <div lang="en">
      <PlaceholderScreen title={ROUTE_LABELS[key]} owningUnit={OWNING_UNIT[key]} />
    </div>
  );
}

const DEVELOPMENT = import.meta.env.DEV;

/**
 * UI005 §20.4 moved the content measure out of PublicShell's <main> so the
 * public surfaces can render full-width bands. Every other public-shell
 * route supplies the measure here instead.
 */
function measured(element: ReactNode) {
  return <Container>{element}</Container>;
}

function WorkspaceBoundary({ editor = false }: { readonly editor?: boolean }) {
  const environment = useEnvironment();
  return (
    <WorkspaceRouteProvider
      workspace={environment.workspace}
      getSessionMutationGeneration={environment.getSessionMutationGeneration}
    >
      {editor && DEVELOPMENT ? <EditorShell /> : <WorkspaceShell />}
    </WorkspaceRouteProvider>
  );
}

const EnvironmentContext = createContext<ServiceEnvironment | null>(null);
function useEnvironment() {
  const value = useContext(EnvironmentContext);
  if (!value) throw new Error("The service environment is unavailable.");
  return value;
}

/**
 * The route tree. It runs on the real API (src/api) unless a test passes the
 * test double (src/mocks).
 */
export function AppRoutes({ environment }: { readonly environment?: ServiceEnvironment }) {
  const [ownedEnvironment] = useState(() => environment ?? createApiEnvironment());
  const activeEnvironment = environment ?? ownedEnvironment;
  return (
    <I18nProvider>
      <EnvironmentContext.Provider value={activeEnvironment}>
        <AccountProvider account={activeEnvironment.account}>
          <PeopleProvider security={activeEnvironment.security} team={activeEnvironment.team} audit={activeEnvironment.audit}>
          <StoriesProvider stories={activeEnvironment.stories}>
          <EditionsProvider editions={activeEnvironment.editions}>
          <MediaProvider media={activeEnvironment.media}>
          <NewsProvider news={activeEnvironment.news}>
          <LayoutProvider layout={activeEnvironment.layout}>
          <EditorProvider editor={activeEnvironment.editor}>
          <ReleaseProvider release={activeEnvironment.release}>
          <AdsProvider ads={activeEnvironment.ads}>
          <ContactProvider contact={activeEnvironment.contact}>
          <NewsroomProvider
            comments={activeEnvironment.comments}
            notifications={activeEnvironment.notifications}
            live={activeEnvironment.live}
          >
          <SessionProvider
            session={activeEnvironment.session}
            access={activeEnvironment.access}
            invalidatePendingMutations={activeEnvironment.invalidatePendingSessionMutations}
            onSignedOut={activeEnvironment.onSignedOut}
          >
            <RouteAnnouncer />
            <SignedOutRedirect />
            <Routes>
              <Route element={<PublicShell />}>
                <Route path={PATTERNS.home} element={<HomePage />} />
                <Route path={PATTERNS.features} element={<FeaturesPage />} />
                <Route path={PATTERNS.pricing} element={<PricingPage />} />
                <Route path={PATTERNS.security} element={<SecurityPage />} />
                <Route path={PATTERNS.contact} element={<ContactPage />} />
                <Route path={PATTERNS.legalPrivacy} element={<LegalPage doc="privacy" />} />
                <Route path={PATTERNS.legalTerms} element={<LegalPage doc="terms" />} />
                <Route path={PATTERNS.legalGrievance} element={<LegalPage doc="grievance" />} />
                <Route path={PATTERNS.login} element={<SignInScreen />} />
                <Route path={PATTERNS.signup} element={<SignUpScreen service={activeEnvironment.paperSignup} />} />
                <Route path={PATTERNS.forgotPassword} element={<ForgotPasswordScreen />} />
                <Route path={PATTERNS.resetPassword} element={<ResetPasswordScreen />} />
                <Route path={PATTERNS.verify} element={<VerifyEmailScreen />} />
                <Route path={PATTERNS.invitation} element={<InvitationScreen />} />
                <Route path={PATTERNS.twoStep} element={<TwoStepScreen />} />
                <Route
                  path={PATTERNS.onboarding}
                  element={measured(<PaperOnboardingScreen service={activeEnvironment.paperSignup} />)}
                />
                <Route path="*" element={measured(<NotFoundPage />)} />
              </Route>

              <Route element={<AccountShell />}>
                <Route path={PATTERNS.accountSecurity} element={<SecurityScreen />} />
              </Route>

              <Route path={PATTERNS.workspaceRoot} element={<WorkspaceBoundary />}>
                <Route index element={<OrgHome />} />
                <Route path={PATTERNS.orgTeam} element={<TeamScreen />} />
                <Route path={PATTERNS.orgAudit} element={<AuditScreen />} />
                <Route path={PATTERNS.pubStories} element={<StoriesScreen />} />
                <Route path={PATTERNS.pubStory} element={<StoryEditor />} />
                <Route path={PATTERNS.pubEditions} element={<EditionsScreen />} />
                <Route path={PATTERNS.pubMedia} element={<MediaScreen />} />
                <Route path={PATTERNS.pubSources} element={<SourcesScreen />} />
                <Route path={PATTERNS.pubEditionLayout} element={<EditionLayoutScreen />} />
                <Route path={PATTERNS.pubPageEditor} element={<PageEditorScreen />} />
                <Route path={PATTERNS.pubEngineProfile} element={<EngineProfileScreen />} />
                <Route path={PATTERNS.pubAds} element={<AdsScreen />} />
                <Route path={PATTERNS.pubOverview} element={<PublicationOverview />} />
                <Route path={PATTERNS.pubTemplates} element={<TemplatesScreen />} />
                <Route path={PATTERNS.pubNewsroom} element={<NewsroomScreen />} />
                <Route path={PATTERNS.pubArchive} element={<ArchiveScreen />} />
                <Route path={PATTERNS.pubArchiveRelease} element={<ArchiveReleaseScreen />} />
                <Route path={PATTERNS.pubBrand} element={<BrandScreen />} />
                <Route path={PATTERNS.pubPrintProfiles} element={<PrintProfilesScreen />} />
                <Route path={PATTERNS.orgSettings} element={<OrgSettingsScreen settings={activeEnvironment.settings} />} />
                <Route path={PATTERNS.pubSettings} element={<PublicationSettingsScreen settings={activeEnvironment.settings} />} />
                {DEVELOPMENT && (
                  <>
                    <Route path={PATTERNS.orgBilling} element={placeholder("orgBilling")} />
                    <Route path={PATTERNS.orgStorage} element={placeholder("orgStorage")} />
                    <Route path={PATTERNS.pubTeam} element={placeholder("pubTeam")} />
                    <Route path={PATTERNS.editionLayout} element={<EditionWorkspaceLayout />}>
                      <Route index element={<Navigate to={PATTERNS.editionContent} replace />} />
                      <Route path={PATTERNS.editionContent} element={placeholder("editionContent")} />
                      <Route path={PATTERNS.editionGenerate} element={placeholder("editionGenerate")} />
                      <Route path={PATTERNS.editionPreflight} element={placeholder("editionPreflight")} />
                      <Route path={PATTERNS.editionExport} element={placeholder("editionExport")} />
                    </Route>
                  </>
                )}
              </Route>

              {DEVELOPMENT && (
                <>
                  <Route path={PATTERNS.editionEditor} element={<WorkspaceBoundary editor />}>
                    <Route index element={<EditorRouteContent />} />
                  </Route>
                  <Route path={`${PATTERNS.editionEditor}/*`} element={<ScopedNotFoundShell editor />} />
                </>
              )}
              <Route path="/org/:orgId/*" element={<ScopedNotFoundShell />} />
            </Routes>
          </SessionProvider>
          </NewsroomProvider>
          </ContactProvider>
          </AdsProvider>
          </ReleaseProvider>
          </EditorProvider>
          </LayoutProvider>
          </NewsProvider>
          </MediaProvider>
          </EditionsProvider>
          </StoriesProvider>
          </PeopleProvider>
        </AccountProvider>
      </EnvironmentContext.Provider>
    </I18nProvider>
  );
}

export function AppRoot() {
  // no transitions: in one the old screen stays up and takes input for a moment after a link click (a typed email
  // went into the sign-in field, and the forgot-password form that replaced it was empty)
  return <BrowserRouter useTransitions={false}><AppRoutes /></BrowserRouter>;
}
