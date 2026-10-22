import { Link } from "react-router";
import { InlineMessage } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { OrgAccessDto } from "../../services/index.ts";
import { useSession } from "../auth/SessionProvider.tsx";

/** The organisation's rule needs two-step for this person's role, and this session was made without it. */
export function TwoStepNeeded({ org }: { readonly org: OrgAccessDto }) {
  const { t } = useI18n();
  const { state } = useSession();
  const enrolled = state.status === "ready" && state.session.user.twoFactorEnabled;
  return (
    <InlineMessage
      variant="warning"
      heading={t("twoStepNeeded.heading", { organization: org.org.name })}
      iconLabel={t("message.warning")}
    >
      {enrolled ? (
        t("twoStepNeeded.signInAgain")
      ) : (
        <>
          {t("twoStepNeeded.turnOn", { organization: org.org.name })}{" "}
          <Link to={paths.accountSecurity()}>{t("shell.accountSecurity")}</Link>
        </>
      )}
    </InlineMessage>
  );
}
