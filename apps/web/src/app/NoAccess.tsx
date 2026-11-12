/**
 * What a screen shows at an address the person's role does not open (a Reporter typing an admin screen's address):
 * a plain "no access" message and a link back to the organisation's home, instead of a page with only its title.
 * A screen may name its own reason (`heading`, `body`); the link is always there.
 */
import { Link, useParams } from "react-router";
import { InlineMessage, Stack } from "../ui/index.ts";
import { useI18n } from "../i18n/index.ts";
import { paths } from "./routes.ts";

export function NoAccess({ heading, body }: { readonly heading?: string; readonly body?: string }) {
  const { t } = useI18n();
  const { orgId } = useParams<{ orgId: string }>();
  return (
    <InlineMessage variant="info" heading={heading ?? t("site.noAccess.heading")} iconLabel={t("message.info")}>
      <Stack gap="2">
        <p>{body ?? t("site.noAccess.body")}</p>
        {orgId && (
          <p>
            <Link to={paths.orgHome(orgId)}>{t("site.noAccess.home")}</Link>
          </p>
        )}
      </Stack>
    </InlineMessage>
  );
}
