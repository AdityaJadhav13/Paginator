/** The names of roles and grants (07 §12, @pageinator/contracts), in the interface language. */
import type { CatalogueKey, Language, Translate } from "../../i18n/index.ts";

/** Role codes and their names; an unknown code is shown as it is. */
const ROLE_NAMES = {
  owner: "glossary.owner",
  admin: "role.admin",
  member: "role.member",
  chief_editor: "glossary.chiefEditor",
  editor: "glossary.editor",
  sub_editor: "glossary.subEditor",
  reporter: "glossary.reporter",
  page_designer: "glossary.pageDesigner",
  photo_editor: "glossary.photoEditor",
  advertising: "role.advertising",
  prepress: "glossary.prepress",
  viewer: "glossary.viewer",
} as const satisfies Readonly<Record<string, CatalogueKey>>;

const GRANT_NAMES = {
  page_approve: "grant.page_approve",
  release_approve: "grant.release_approve",
} as const satisfies Readonly<Record<string, CatalogueKey>>;

export type RoleNameKey = (typeof ROLE_NAMES)[keyof typeof ROLE_NAMES];

export function roleName(role: string, t: Translate): string {
  return Object.hasOwn(ROLE_NAMES, role) ? t(ROLE_NAMES[role as keyof typeof ROLE_NAMES]) : role;
}

export function grantName(grant: string, t: Translate): string {
  return Object.hasOwn(GRANT_NAMES, grant) ? t(GRANT_NAMES[grant as keyof typeof GRANT_NAMES]) : grant;
}

/** Names joined the language's own way: "Page designer and Reporter", "पान मांडणीकार आणि वार्ताहर". */
export function listOf(names: readonly string[], language: Language): string {
  return new Intl.ListFormat(language, { type: "conjunction" }).format(names);
}

/** "member" is everyone's organisation role, so it is named only when alone. */
export function roleList(roles: readonly string[], language: Language, name: (key: RoleNameKey) => string): string {
  const shown = roles.length > 1 ? roles.filter((role) => role !== "member") : roles;
  return listOf(
    shown.map((role) => (Object.hasOwn(ROLE_NAMES, role) ? name(ROLE_NAMES[role as keyof typeof ROLE_NAMES]) : role)),
    language,
  );
}

/** A publication's roles and grants as one list: "Editor and Can approve pages". */
export function rolesAndGrants(
  publication: { readonly roles: readonly string[]; readonly grants: readonly string[] },
  language: Language,
  t: Translate,
): string {
  return listOf(
    [...publication.roles.map((role) => roleName(role, t)), ...publication.grants.map((grant) => grantName(grant, t))],
    language,
  );
}
