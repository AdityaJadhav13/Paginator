/**
 * A publication's Overview, /org/:orgId/pub/:pubId/overview: the publication's card of the organisation's home, on its
 * own page: the person's roles on it, its Stories and Editions when they may see them, and today's edition (the Today
 * card). Only what is built is shown; nothing here is a sample.
 */
import { useParams } from "react-router";
import { PageHeader, Stack } from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import { useSession } from "../auth/SessionProvider.tsx";
import { PublicationLinks } from "./OrgHome.tsx";
import { rolesAndGrants } from "./roles.ts";
import "./org-home.css";

export function PublicationOverview() {
  const { orgId, pubId } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t, language } = useI18n();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  if (!org || !publication) return null; // the shell says why the publication cannot be opened
  return (
    <Stack gap="6">
      <PageHeader
        title={t("glossary.overview")}
        headingId={ROUTE_HEADING_ID}
        subtitle={
          publication.roles.length + publication.grants.length > 0
            ? `${publication.name} · ${t("orgHome.yourRoles", { roles: rolesAndGrants(publication, language, t) })}`
            : publication.name
        }
      />
      <PublicationLinks org={org} publication={publication} />
    </Stack>
  );
}
