/**
 * The one primary call to action shared by all five public surfaces (§20.1).
 *
 * Its destination is derived from the live session rather than hard-coded:
 * a signed-in reader lands in their workspace when they have one, and on the
 * signed-in page otherwise.
 *
 * It is a router `Link`, never a button that navigates, and it never mutates
 * session state. While the session is still loading it renders its
 * signed-out form rather than a spinner or a disabled control — a public
 * page must never present a dead primary action.
 */
import { Link } from "react-router";
import { paths } from "../../app/routes.ts";
import { useSession } from "../auth/SessionProvider.tsx";
import { t } from "./content.ts";

export interface PrimaryCtaProps {
  /** Extra classes for the band the CTA sits in. */
  readonly className?: string;
}

export function PrimaryCta({ className }: PrimaryCtaProps) {
  const { state } = useSession();

  const signedIn = state.status === "ready";
  const label = signedIn ? t("cta-primary-signed-in") : t("cta-primary-signed-out");
  // A signed-in person with no workspace yet lands on the signed-in page, which says what is open to them.
  const workspace = signedIn ? state.workspace : null;
  const destination = workspace
    ? paths.pubOverview(workspace.activeOrganizationId, workspace.activePublicationId)
    : paths.login();

  return (
    <Link
      to={destination}
      className={["pg-button", "pg-button--primary", "pg-button--lg", "pg-public__cta", className]
        .filter(Boolean)
        .join(" ")}
    >
      {label}
    </Link>
  );
}
