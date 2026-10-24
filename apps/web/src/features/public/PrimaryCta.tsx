/**
 * The primary call to action (03 §4.1): "Book a demo", to /contact?intent=demo. On /pricing it is "Talk to us about a
 * pilot", to /contact?intent=pilot. A signed-in person with a workspace gets "Open your workspace" instead.
 *
 * It is a router `Link`, never a button that navigates, and it never changes the session. While the session is still
 * loading it shows its signed-out form: a public page never shows a dead primary action.
 */
import { Link } from "react-router";
import { paths } from "../../app/routes.ts";
import { useSession } from "../auth/SessionProvider.tsx";
import { usePublicText } from "./usePublicText.ts";

export type CtaIntent = "demo" | "pilot";

const LABEL: Record<CtaIntent, string> = { demo: "cta-book-demo", pilot: "cta-pilot" };

/** /contact with the form's intent preset. */
export function contactPath(intent: "demo" | "pilot" | "press" | "other"): string {
  return `${paths.contact()}?intent=${intent}`;
}

export interface PrimaryCtaProps {
  readonly intent?: CtaIntent;
  readonly className?: string;
}

export function PrimaryCta({ intent = "demo", className }: PrimaryCtaProps) {
  const { state } = useSession();
  const { t } = usePublicText();
  const workspace = state.status === "ready" ? state.workspace : null;
  const label = workspace ? t("cta-open-workspace") : t(LABEL[intent]);
  const destination = workspace ? paths.orgHome(workspace.activeOrganizationId) : contactPath(intent);

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
