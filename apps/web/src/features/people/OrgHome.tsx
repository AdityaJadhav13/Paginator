/**
 * An organisation's home, /org/:orgId: where sign-in lands. A welcome header with the person's role here, a card for
 * each of its publications with their roles on it (from /me) and links to its Stories and Editions when they may see
 * them, and quick links to what is built for them: Team and the audit log, if they may see them, and their account's
 * security. The other newsroom screens come with later PRs (plan §10), so this page says they are still being built.
 */
import { Link, useParams } from "react-router";
import { Icon, PageHeader, Stack, type IconName } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import { useSession } from "../auth/SessionProvider.tsx";
import { may } from "./navigation.ts";
import { roleName, rolesAndGrants } from "./roles.ts";
import { mayViewEditions, storyScope } from "../stories/access.ts";
import { TodayCard } from "../layout/TodayCard.tsx";
import "./org-home.css";

export function OrgHome() {
  const { orgId } = useParams<{ orgId: string }>();
  const { state } = useSession();
  const { t, language } = useI18n();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  if (!org) return null; // the shell says why the organisation cannot be opened
  // the shell says when the organisation needs two-step first
  const blocked = org.twoStep.required && !org.twoStep.satisfied;
  const quick: { to: string; icon: IconName; label: string; about: string }[] = [
    ...(!blocked && may(org, "members.view")
      ? [{ to: paths.orgTeam(org.org.id), icon: "users" as const, label: t("glossary.team"), about: t("orgHome.quick.team") }]
      : []),
    ...(!blocked && may(org, "audit.view")
      ? [{ to: paths.orgAudit(org.org.id), icon: "scroll-text" as const, label: t("nav.audit"), about: t("orgHome.quick.audit") }]
      : []),
    { to: paths.accountSecurity(), icon: "shield-check", label: t("shell.accountSecurity"), about: t("orgHome.quick.security") },
  ];
  return (
    <Stack gap="6">
      <PageHeader title={org.org.name} headingId={ROUTE_HEADING_ID} subtitle={t("orgHome.role", { role: roleName(org.orgRole, t) })} />
      <section aria-labelledby="pg-org-publications" className="pg-org-home__section">
        <h2 id="pg-org-publications" className="pg-org-home__heading">
          {t("orgHome.publications")}
        </h2>
        {org.publications.length === 0 ? (
          <p className="pg-org-home__empty">{t("orgHome.noPublications")}</p>
        ) : (
          <ul className="pg-org-home__cards">
            {org.publications.map((publication) => {
              const stories = !blocked && storyScope(org, publication.id) !== "none";
              const editions = !blocked && mayViewEditions(org, publication.id);
              return (
                <li key={publication.id} className="pg-org-home__card">
                  <div className="pg-org-home__card-head">
                    <span className="pg-org-home__card-icon">
                      <Icon name="newspaper" size={20} />
                    </span>
                    <h3 className="pg-org-home__card-title">{publication.name}</h3>
                  </div>
                  {publication.roles.length + publication.grants.length > 0 && (
                    <p className="pg-org-home__card-text">
                      {t("orgHome.yourRoles", { roles: rolesAndGrants(publication, language, t) })}
                    </p>
                  )}
                  {(stories || editions) && (
                    <div className="pg-org-home__card-links">
                      {stories && (
                        <Link to={paths.pubStories(org.org.id, publication.id)}>
                          <Icon name="file-text" size={16} />
                          {t("orgHome.stories", { publication: publication.name })}
                        </Link>
                      )}
                      {editions && (
                        <Link to={paths.pubEditions(org.org.id, publication.id)}>
                          <Icon name="calendar-days" size={16} />
                          {t("editions.list", { publication: publication.name })}
                        </Link>
                      )}
                    </div>
                  )}
                  {editions && <TodayCard org={org} pubId={publication.id} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <section aria-labelledby="pg-org-quick" className="pg-org-home__section">
        <h2 id="pg-org-quick" className="pg-org-home__heading">
          {t("orgHome.quick")}
        </h2>
        <ul className="pg-org-home__quick">
          {quick.map((link) => (
            <li key={link.to} className="pg-org-home__tile">
              <span className="pg-org-home__card-icon">
                <Icon name={link.icon} size={20} />
              </span>
              <div>
                <Link to={link.to} className="pg-org-home__tile-link">
                  {link.label}
                </Link>
                <p className="pg-org-home__card-text">{link.about}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <p className="pg-org-home__note">
        <Icon name="info" size={16} />
        {t("orgHome.next")}
      </p>
    </Stack>
  );
}
