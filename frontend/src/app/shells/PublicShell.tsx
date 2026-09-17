/**
 * PublicShell (UI002 §7.1). Wraps the public route family (§6 rows
 * 1–10). `/onboarding` renders through the same shell in a
 * pre-context variant that omits the sign-in/sign-up affordance — the
 * only shell-variant rule in UI002; it does not require a fourth
 * shell.
 */
import { Outlet, Link, useLocation } from "react-router";
import { Container, Inline, Cluster } from "../../ui/index.ts";
import { SkipLink } from "../SkipLink.tsx";
import { CollapsibleNav } from "../CollapsibleNav.tsx";
import { MAIN_LANDMARK_ID, paths, ROUTE_LABELS } from "../routes.ts";

export function PublicShell() {
  const location = useLocation();
  const isOnboarding = location.pathname === paths.onboarding();

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
            {!isOnboarding && (
              <Cluster gap="3" justify="end">
                <Link to={paths.login()}>{ROUTE_LABELS.login}</Link>
                <Link to={paths.signup()}>{ROUTE_LABELS.signup}</Link>
              </Cluster>
            )}
          </Inline>
        </Container>
      </header>
      <main id={MAIN_LANDMARK_ID} tabIndex={-1}>
        <Container>
          <Outlet />
        </Container>
      </main>
      <footer className="pg-shell__footer">
        <Container>
          <p className="pg-type-caption">
            Pageinator is a fictional product simulation. No real accounts, payments, or press services exist here.
          </p>
        </Container>
      </footer>
    </div>
  );
}
