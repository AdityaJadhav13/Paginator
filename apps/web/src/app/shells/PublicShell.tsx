/**
 * PublicShell (UI002 §7.1). Wraps the public route family (§6 rows
 * 1–10). `/onboarding` renders through the same shell in a
 * pre-context variant that omits the sign-in/sign-up affordance.
 *
 * The sign-in screens (03 §5.1) render in the shell's sign-in variant:
 * the logo and the language switch on top, the card, and the notice,
 * in the language the person chose. The public pages exist in English
 * only for now, so their whole shell is an English scope (`lang="en"`)
 * whatever the interface language is.
 */
import { Outlet, Link, useLocation } from "react-router";
import { Container, Inline, Cluster, Stack } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { CollapsibleNav } from "../CollapsibleNav.tsx";
import { MAIN_LANDMARK_ID, paths, ROUTE_LABELS } from "../routes.ts";
import { SignedInSessionControls } from "../../features/auth/SessionStatus.tsx";
import { useSession } from "../../features/auth/SessionProvider.tsx";
import { isAuthPath } from "../../features/auth/return-to.ts";
import { LanguageScope, LanguageSwitch, useI18n } from "../../i18n/index.ts";

/** The five public destinations the footer's Secondary navigation lists. */
const SECONDARY_NAV = [
  { to: paths.home(), label: ROUTE_LABELS.home },
  { to: paths.features(), label: ROUTE_LABELS.features },
  { to: paths.pricing(), label: ROUTE_LABELS.pricing },
  { to: paths.security(), label: ROUTE_LABELS.security },
  { to: paths.contact(), label: ROUTE_LABELS.contact },
] as const;

/**
 * UI001's quiet action treatment plus its small body type step, reused on a
 * router `Link`. Between them they supply the tokenized action colour, the
 * type size and the absence of an underline without this shell declaring any
 * style of its own.
 *
 * No size modifier is applied on purpose: `pg-button--sm` would add its own
 * inline padding and inset the row from the notice beneath it, whereas
 * `pg-button` alone contributes no padding.
 */
const SECONDARY_NAV_LINK_CLASS = "pg-button pg-button--quiet pg-type-body-small";

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
  const { t } = useI18n();

  return (
    <div className="pg-shell pg-shell--public" lang="en">
      <SkipLink />
      <header className="pg-shell__header">
        <Container>
          <Inline gap="5" wrap="wrap" align="center">
            <Link to={paths.home()} className="pg-shell__brand pg-type-section-title">
              Pageinator
            </Link>
            <CollapsibleNav ariaLabel="Primary">
              <Cluster gap="4">
                <Link to={paths.home()}>{ROUTE_LABELS.home}</Link>
                <Link to={paths.features()}>{ROUTE_LABELS.features}</Link>
                <Link to={paths.pricing()}>{ROUTE_LABELS.pricing}</Link>
                <Link to={paths.security()}>{ROUTE_LABELS.security}</Link>
                <Link to={paths.contact()}>{ROUTE_LABELS.contact}</Link>
              </Cluster>
            </CollapsibleNav>
            {!isOnboarding && state.status === "ready" && <SignedInSessionControls />}
            {!isOnboarding && state.status !== "ready" && (
              <Cluster gap="3" justify="end">
                <Link to={paths.login()}>{ROUTE_LABELS.login}</Link>
                <Link to={paths.signup()}>{ROUTE_LABELS.signup}</Link>
              </Cluster>
            )}
          </Inline>
        </Container>
      </header>
      {/*
       * UI005 §20.4 edit 1: the content measure moved out of <main> and into
       * each route's own regions, because the public surfaces render
       * full-width bands that cannot live inside a constrained container.
       * Routes that previously relied on the shell's Container now wrap
       * themselves in one at their route element.
       */}
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="pg-shell__footer">
        <Container>
          {/*
           * UI005 §20.4 edit 2: conventional public-site footer navigation,
           * built entirely from UI001 primitives and their existing classes.
           */}
          <Stack gap="4">
            <Cluster as="nav" aria-label="Secondary" gap="5">
              {SECONDARY_NAV.map(({ to, label }) => (
                <Link key={to} to={to} className={SECONDARY_NAV_LINK_CLASS}>
                  {label}
                </Link>
              ))}
            </Cluster>
            <p className="pg-type-caption">{t("shell.notice")}</p>
          </Stack>
        </Container>
      </footer>
    </div>
  );
}

export function PublicShell() {
  const location = useLocation();
  if (isAuthPath(location.pathname)) return <SignInChrome />;
  return (
    <LanguageScope language="en">
      <PublicChrome />
    </LanguageScope>
  );
}
