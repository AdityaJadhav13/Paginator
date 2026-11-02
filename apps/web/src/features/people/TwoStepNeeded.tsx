import { Link } from "react-router";
import { Icon } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { OrgAccessDto } from "../../services/index.ts";
import { useSession } from "../auth/SessionProvider.tsx";
import { SignOutButton } from "../auth/SignOutButton.tsx";
import "./people.css";

/**
 * The organisation's rule needs two-step for this person's role, and this session was made without it: a warning
 * banner with the one thing to do (turn it on in Account security, or sign out to sign in again with the code).
 */
export function TwoStepNeeded({ org }: { readonly org: OrgAccessDto }) {
  const { t } = useI18n();
  const { state } = useSession();
  const enrolled = state.status === "ready" && state.session.user.twoFactorEnabled;
  return (
    <div className="pg-people-banner">
      <span className="pg-people-banner__icon">
        <Icon name="triangle-alert" size={20} />
        <span className="pg-visually-hidden">{t("message.warning")}</span>
      </span>
      <div className="pg-people-banner__body">
        <p className="pg-people-banner__heading">{t("twoStepNeeded.heading", { organization: org.org.name })}</p>
        <p className="pg-people-banner__text">
          {enrolled ? t("twoStepNeeded.signInAgain") : t("twoStepNeeded.turnOn", { organization: org.org.name })}
        </p>
      </div>
      <div className="pg-people-banner__action">
        {enrolled ? (
          <SignOutButton size="sm" />
        ) : (
          <Link className="pg-button pg-button--primary pg-button--sm" to={paths.accountSecurity()}>
            {t("shell.accountSecurity")}
          </Link>
        )}
      </div>
    </div>
  );
}
