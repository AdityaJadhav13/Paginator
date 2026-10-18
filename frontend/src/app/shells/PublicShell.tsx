/**
 * PublicShell (UI002 §7.1). Wraps the public route family (§6 rows
 * 1–10). `/onboarding` renders through the same shell in a
 * pre-context variant that omits the sign-in/sign-up affordance — the
 * only shell-variant rule in UI002; it does not require a fourth
 * shell.
 */
import { Outlet, Link, useLocation } from "react-router";
import { Container, Inline, Cluster, Stack } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { CollapsibleNav } from "../CollapsibleNav.tsx";
import { MAIN_LANDMARK_ID, paths, ROUTE_LABELS } from "../routes.ts";
import { SignedInSessionControls } from "../../features/auth/SessionStatus.tsx";
import { useSession } from "../../features/auth/SessionProvider.tsx";

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

export function PublicShell() {
  const location = useLocation();
  const isOnboarding = location.pathname === paths.onboarding();
  const isAuthRoute = [paths.login(), paths.signup(), paths.forgotPassword(), paths.verify()].includes(location.pathname);
  const { state } = useSession();

  return (
    <div className="pg-shell pg-shell--public">
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
            {!isOnboarding && !isAuthRoute && state.status === "ready" && <SignedInSessionControls />}
            {!isOnboarding && !isAuthRoute && state.status !== "ready" && (
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
       * themselves in one at their route element, so rows 6–10 are unchanged.
       */}
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="pg-shell__footer">
        <Container>
          {/*
           * UI005 §20.4 edit 2: conventional public-site footer navigation.
           *
           * Built entirely from UI001 primitives and their existing classes,
           * so this shell change needs no stylesheet of its own: `Cluster`
           * supplies the wrapping row and tokenized gap, `Stack` the
           * separation from the notice below, and the quiet-button classes
           * the tokenized link colour and size — the same reuse of
           * `pg-button` on a router `Link` that the public primary call to
           * action already relies on.
           */}
          <Stack gap="4">
            <Cluster as="nav" aria-label="Secondary" gap="5">
              {SECONDARY_NAV.map(({ to, label }) => (
                <Link key={to} to={to} className={SECONDARY_NAV_LINK_CLASS}>
                  {label}
                </Link>
              ))}
            </Cluster>
            <p className="pg-type-caption">
              Pageinator is a fictional product simulation. No real accounts, payments, or press services exist here.
            </p>
          </Stack>
        </Container>
      </footer>
    </div>
  );
}
