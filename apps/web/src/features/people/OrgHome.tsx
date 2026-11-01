/**
 * An organisation's home, /org/:orgId: where sign-in lands. It says the person's role here, their roles on each of
 * its publications (from /me), and links to what is built for them: Team and the audit log, if they may see them, and their account's
 * security. The newsroom screens come with later PRs (plan §10), so this page says they are still being built.
 */
import { Link, useParams } from "react-router";
import { Stack } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import { useSession } from "../auth/SessionProvider.tsx";
import { may } from "./navigation.ts";
import { roleName, rolesAndGrants } from "./roles.ts";
import { storyScope } from "../stories/access.ts";

export function OrgHome() {
  const { orgId } = useParams<{ orgId: string }>();
  const { state } = useSession();
  const { t, language } = useI18n();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  if (!org) return null; // the shell says why the organisation cannot be opened
  // the shell says when the organisation needs two-step first
  const blocked = org.twoStep.required && !org.twoStep.satisfied;
  return (
    <Stack gap="5">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
        {org.org.name}
      </h1>
      <p>{t("orgHome.role", { role: roleName(org.orgRole, t) })}</p>
      <section aria-labelledby="pg-org-publications">
        <Stack gap="3">
          <h2 id="pg-org-publications" className="pg-type-section-title">
            {t("orgHome.publications")}
          </h2>
          {org.publications.length === 0 ? (
            <p>{t("orgHome.noPublications")}</p>
          ) : (
            <ul>
              {org.publications.map((publication) => (
                <li key={publication.id}>
                  {publication.roles.length + publication.grants.length > 0
                    ? t("orgHome.publicationRoles", {
                        publication: publication.name,
                        roles: rolesAndGrants(publication, language, t),
                      })
                    : publication.name}
                  {!blocked && storyScope(org, publication.id) !== "none" && (
                    <>
                      {" "}
                      <Link to={paths.pubStories(org.org.id, publication.id)}>
                        {t("orgHome.stories", { publication: publication.name })}
                      </Link>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </section>
      <ul>
        {!blocked && may(org, "members.view") && (
          <li>
            <Link to={paths.orgTeam(org.org.id)}>{t("glossary.team")}</Link>
          </li>
        )}
        {!blocked && may(org, "audit.view") && (
          <li>
            <Link to={paths.orgAudit(org.org.id)}>{t("nav.audit")}</Link>
          </li>
        )}
        <li>
          <Link to={paths.accountSecurity()}>{t("shell.accountSecurity")}</Link>
        </li>
      </ul>
      <p>{t("orgHome.next")}</p>
    </Stack>
  );
}
