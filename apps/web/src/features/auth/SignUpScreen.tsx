/**
 * /signup: Pageinator accounts come only with an invitation (plan §4.1, §4.3), so this page says how to get one. The
 * sign-up form itself is on the invitation's own page (/invite/:id).
 */
import { Link } from "react-router";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import { AuthCard } from "./AuthCard.tsx";

export function SignUpScreen() {
  const { t } = useI18n();
  return (
    <AuthCard title={t("signUp.title")}>
      <p>{t("signUp.byInvitation")}</p>
      <p>
        {t("signUp.haveAccount")} <Link to={paths.login()}>{t("glossary.signIn")}</Link>
      </p>
    </AuthCard>
  );
}
