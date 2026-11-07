/**
 * PublicShell (UI002 §7.1; docs/product/03-website-and-accounts.md §4.1). Wraps the public route family.
 *
 * The public site is in English and Marathi: the language switch in the header chooses, the browser remembers the
 * choice (src/i18n), and the shell's element carries the page's `lang`. Its header: the wordmark, the page links
 * (collapsed under ☰ on a phone), the language switch, Sign in and Book a demo when signed out (Book a demo only once
 * the API says the contact form is connected), or the signed-in person's controls. Its footer: the page links, the
 * Legal group (the privacy notice, the terms of use and the grievance officer: the owner's text, or a line saying it is
 * still to be supplied), the notice, the hosting line (planned) and the copyright line.
 *
 * `/onboarding` renders through the same shell without the sign-in affordance. The sign-in screens (03 §5.1) render
 * in the shell's sign-in variant: the logo and the language switch on top, the card, and the notice.
 *
 * Every word here comes from the catalogue (src/i18n): durable app code never reads the public feature's records.
 */
import { Outlet, Link, useLocation } from "react-router";
import { Container, Cluster, Stack } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { CollapsibleNav } from "../CollapsibleNav.tsx";
import { MAIN_LANDMARK_ID, paths } from "../routes.ts";
import { SignedInSessionControls } from "../../features/auth/SessionStatus.tsx";
import { useSession } from "../../features/auth/SessionProvider.tsx";
import { isAuthPath } from "../../features/auth/return-to.ts";
import { useContactConnection } from "../../features/contact/contact-context.tsx";
import { LanguageSwitch, useI18n, type PlainKey } from "../../i18n/index.ts";

const PAGES: readonly { to: string; label: PlainKey }[] = [
  { to: paths.features(), label: "public.nav.features" },
  { to: paths.pricing(), label: "public.nav.pricing" },
  { to: paths.security(), label: "public.nav.security" },
  { to: paths.contact(), label: "public.nav.contact" },
];

const LEGAL: readonly { to: string; label: PlainKey }[] = [
  { to: paths.legalPrivacy(), label: "public.legal.privacy" },
  { to: paths.legalTerms(), label: "public.legal.terms" },
  { to: paths.legalGrievance(), label: "public.legal.grievance" },
];
const LEGAL_GROUP_ID = "pg-site-footer-legal";

/** UI001's quiet action treatment plus its small body type step, on a router `Link` (no padding of its own). */
const SECONDARY_NAV_LINK_CLASS = "pg-button pg-button--quiet pg-type-body-small";

/** Western digits to Devanagari ones, for the Marathi copyright year. */
function digitsFor(language: string, value: number): string {
  const text = String(value);
  return language === "mr" ? text.replace(/[0-9]/g, (digit) => String.fromCharCode(0x0966 + Number(digit))) : text;
}

/** The sign-in screens' chrome: logo and language switch, the card, the notice. */
function SignInChrome() {
  const { language, t } = useI18n();
  return (
    <div className="pg-shell pg-shell--public pg-shell--auth" lang={language}>
      <SkipLink label={t("shell.skipLink")} />
      <header className="pg-shell__header">
        <Container>
          <Cluster gap="4" justify="space-between">
            <Link to={paths.home()} className="pg-shell__brand pg-type-section-title" lang="en">
              Pageinator
            </Link>
            <LanguageSwitch />
          </Cluster>
        </Container>
      </header>
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="pg-shell__footer">
        <Container>
          <p className="pg-type-body-small">{t("shell.notice")}</p>
        </Container>
      </footer>
    </div>
  );
}

function PublicChrome() {
  const location = useLocation();
  const isOnboarding = location.pathname === paths.onboarding();
  const { state } = useSession();
  const { language, t } = useI18n();
  const signedIn = state.status === "ready";
  // Book a demo only when the contact form sends (never while that is checked): no button to a dead end
  const connection = useContactConnection();

  return (
    <div className="pg-shell pg-shell--public pg-shell--site" lang={language}>
      <SkipLink label={t("shell.skipLink")} />
      <header className="pg-shell__header pg-site-header">
        <Container>
          <div className="pg-site-header__row">
            <Link to={paths.home()} className="pg-shell__brand pg-site-header__brand" lang="en">
              Pageinator
            </Link>
            <CollapsibleNav ariaLabel={t("public.nav.primary")} showLabel={t("public.nav.show")} hideLabel={t("public.nav.hide")}>
              <ul className="pg-site-header__links">
                {PAGES.map(({ to, label }) => (
                  <li key={to}>
                    <Link to={to} aria-current={location.pathname === to ? "page" : undefined}>
                      {t(label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </CollapsibleNav>
            <div className="pg-site-header__actions">
              <LanguageSwitch />
              {!isOnboarding && signedIn && <SignedInSessionControls />}
              {!isOnboarding && !signedIn && (
                <>
                  <Link to={paths.login()} className="pg-site-header__sign-in">
                    {t("public.signIn")}
                  </Link>
                  {connection === "connected" && (
                    <Link
                      to={`${paths.contact()}?intent=demo`}
                      className="pg-button pg-button--primary pg-button--sm pg-site-header__cta"
                    >
                      {t("public.bookDemo")}
                    </Link>
                  )}
                </>
              )}
            </div>
          </div>
        </Container>
      </header>
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="pg-shell__footer pg-site-footer">
        <Container>
          <Stack gap="4">
            <Cluster as="nav" aria-label={t("public.nav.secondary")} gap="5">
              <Link to={paths.home()} className={SECONDARY_NAV_LINK_CLASS}>
                {t("public.nav.home")}
              </Link>
              {PAGES.map(({ to, label }) => (
                <Link key={to} to={to} className={SECONDARY_NAV_LINK_CLASS}>
                  {t(label)}
                </Link>
              ))}
              <Link to={paths.login()} className={SECONDARY_NAV_LINK_CLASS}>
                {t("public.signIn")}
              </Link>
            </Cluster>
            <Cluster role="group" aria-labelledby={LEGAL_GROUP_ID} gap="5">
              <span id={LEGAL_GROUP_ID} className="pg-type-body-small">
                {t("public.legal.group")}
              </span>
              {LEGAL.map(({ to, label }) => (
                <Link key={to} to={to} className={SECONDARY_NAV_LINK_CLASS}>
                  {t(label)}
                </Link>
              ))}
            </Cluster>
            <p className="pg-type-body-small">{t("shell.notice")}</p>
            <p className="pg-type-body-small">{t("public.footer.hosting")}</p>
            <p className="pg-type-body-small">
              {t("public.footer.copyright", { year: digitsFor(language, new Date().getFullYear()) })}
            </p>
          </Stack>
        </Container>
      </footer>
    </div>
  );
}

export function PublicShell() {
  const location = useLocation();
  if (isAuthPath(location.pathname)) return <SignInChrome />;
  return <PublicChrome />;
}
