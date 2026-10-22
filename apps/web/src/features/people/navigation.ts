/**
 * The workspace's navigation from the person's permissions (plan §10 PR 20, 07 §12, @pageinator/contracts): an entry
 * shows only when the API would let the person use it, and only when its screen is built. The placeholder screens of
 * the workspace stay out of the deployed app (plan §2.6); a development build lists them, so they can be worked on.
 */
import { reach, type Permission, type PublicationAccess } from "@pageinator/contracts";
import { paths } from "../../app/routes.ts";
import type { PlainKey } from "../../i18n/index.ts";
import type { OrgAccessDto } from "../../services/index.ts";

export interface NavEntry {
  readonly label: PlainKey;
  readonly to: string;
}

interface Rule {
  readonly label: PlainKey;
  readonly permission: Permission | "signed_in";
  /** A screen that works; the others are placeholders. */
  readonly built: boolean;
  readonly to: (orgId: string, pubId: string) => string;
}

const ORG_ENTRIES: readonly Rule[] = [
  { label: "nav.home", permission: "signed_in", built: true, to: (o) => paths.orgHome(o) },
  { label: "glossary.team", permission: "members.view", built: true, to: (o) => paths.orgTeam(o) },
  { label: "nav.orgSettings", permission: "org.settings", built: false, to: (o) => paths.orgSettings(o) },
  { label: "nav.billing", permission: "billing.manage", built: false, to: (o) => paths.orgBilling(o) },
  { label: "nav.storage", permission: "org.settings", built: false, to: (o) => paths.orgStorage(o) },
];

const PUBLICATION_ENTRIES: readonly Rule[] = [
  { label: "glossary.overview", permission: "overview.view", built: false, to: (o, p) => paths.pubOverview(o, p) },
  { label: "nav.editions", permission: "edition.view", built: false, to: (o, p) => paths.pubEditions(o, p) },
  { label: "glossary.stories", permission: "story.view", built: false, to: (o, p) => paths.pubStories(o, p) },
  { label: "nav.media", permission: "media.view", built: false, to: (o, p) => paths.pubMedia(o, p) },
  { label: "nav.ads", permission: "ads.view", built: false, to: (o, p) => paths.pubAds(o, p) },
  { label: "nav.templates", permission: "templates.view", built: false, to: (o, p) => paths.pubTemplates(o, p) },
  { label: "nav.newsroom", permission: "story.view", built: false, to: (o, p) => paths.pubNewsroom(o, p) },
  { label: "nav.sources", permission: "story.view", built: false, to: (o, p) => paths.pubSources(o, p) },
  { label: "glossary.archive", permission: "archive.view", built: false, to: (o, p) => paths.pubArchive(o, p) },
  { label: "nav.brand", permission: "brand.edit", built: false, to: (o, p) => paths.pubBrand(o, p) },
  { label: "nav.printProfiles", permission: "print_profiles.view", built: false, to: (o, p) => paths.pubPrintProfiles(o, p) },
  { label: "glossary.team", permission: "members.view", built: true, to: (o) => paths.orgTeam(o) },
];

/** The roles and grants a person holds across an organisation (for an "org" permission). */
export function orgAccess(org: OrgAccessDto): PublicationAccess {
  return {
    roles: [...new Set(org.publications.flatMap((publication) => publication.roles))],
    grants: [...new Set(org.publications.flatMap((publication) => publication.grants))],
  };
}

/** Whether the person may use a permission in this organisation, or on one of its publications. */
export function may(org: OrgAccessDto, permission: Permission, publicationId?: string): boolean {
  const publication = publicationId ? org.publications.find((candidate) => candidate.id === publicationId) : undefined;
  const access = publication ? { roles: publication.roles, grants: publication.grants } : orgAccess(org);
  return reach(permission, org.orgRole, access) !== null;
}

function allowed(rule: Rule, org: OrgAccessDto, publicationId: string | undefined, development: boolean): boolean {
  if (!rule.built && !development) return false;
  if (rule.permission === "signed_in") return true;
  // the API refuses every screen of the organisation (403 two_step_required) until this session has two-step
  if (org.twoStep.required && !org.twoStep.satisfied) return false;
  return may(org, rule.permission, publicationId);
}

/** The entries for an organisation's pages, or (with a publication) for a publication's pages. */
export function navigation(org: OrgAccessDto, publicationId: string | undefined, development: boolean): NavEntry[] {
  const rules = publicationId ? PUBLICATION_ENTRIES : ORG_ENTRIES;
  return rules
    .filter((rule) => allowed(rule, org, publicationId, development))
    .map((rule) => ({ label: rule.label, to: rule.to(org.org.id, publicationId ?? "") }));
}
