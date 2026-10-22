// Who may do what (docs/product/10-l2-newsroom-plan.md §4.2), shared by the API, which enforces it, and the web, which
// hides only what the API would refuse. Taken row by row from 07-roles-settings-mobile.md §12; where §12 is silent,
// doc 11 §2 (docs/architecture/v2/11_PLATFORM_SECURITY_OPS.md) applies, and each such row says so.
//
// A person's permissions in one publication are those of their organisation role, plus those of each role they hold
// on that publication, plus those of their grants. Owner and Admin hold every permission on every publication of the
// organisation (Admin all but billing). A cell of §12 marked ◐ ("own stories", "photos only", …) is "scoped": the
// person may use the endpoint, and the service applies the rule of the cell to what they reach (from PR 17).
import { z } from "zod";

export const ORG_ROLES = ["owner", "admin", "member"] as const;
export const OrgRole = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof OrgRole>;

export const PUBLICATION_ROLES = [
  "chief_editor",
  "editor",
  "sub_editor",
  "reporter",
  "page_designer",
  "photo_editor",
  "advertising",
  "prepress",
  "viewer",
] as const;
export const PublicationRole = z.enum(PUBLICATION_ROLES);
export type PublicationRole = z.infer<typeof PublicationRole>;

/** Grants given on top of roles (§12's "Can approve pages", "Can approve release"). */
export const GRANTS = ["page_approve", "release_approve"] as const;
export const Grant = z.enum(GRANTS);
export type Grant = z.infer<typeof Grant>;

/** The roles a grant may go with: §12 gives "Can approve pages" and "Can approve release" to the Editor column only
 * (the Chief Editor approves without one). A grant on anyone else is refused when given, and counts for nothing. */
export const GRANT_HOLDERS: Readonly<Record<Grant, readonly PublicationRole[]>> = {
  page_approve: ["editor"],
  release_approve: ["editor"],
};

/** Whether each grant goes with one of the roles allowed to hold it. */
export function grantsFit(roles: readonly PublicationRole[], grants: readonly Grant[]): boolean {
  return grants.every((grant) => GRANT_HOLDERS[grant].some((role) => roles.includes(role)));
}

/** "full": the whole cell; "scoped": a ◐ cell, narrowed by the service. */
export type Reach = "full" | "scoped";
type Cells = Partial<Record<PublicationRole, Reach>>;

type Rule = {
  /** "org": checked for the organisation (the union of the person's roles on all its publications); "publication":
   * checked for one publication. */
  scope: "org" | "publication";
  /** §12's row, or doc 11's. */
  row: string;
  roles: Cells;
  grants?: readonly Grant[];
  /** Admin lacks it unless a grant says otherwise (billing, later). */
  ownerOnly?: true;
};

const ALL: Cells = Object.fromEntries(PUBLICATION_ROLES.map((role) => [role, "full"])) as Cells;
const ALL_BUT_VIEWER: Cells = Object.fromEntries(Object.entries(ALL).filter(([role]) => role !== "viewer"));
const F = "full";
const S = "scoped";

export const PERMISSIONS = {
  "overview.view": {
    scope: "publication",
    row: "Overview",
    roles: { ...ALL, reporter: S, advertising: S },
  },
  "edition.view": {
    scope: "publication",
    row: "Editions: create, Plan tab (view)",
    roles: {
      chief_editor: F,
      editor: F,
      sub_editor: F,
      page_designer: F,
      photo_editor: F,
      advertising: S,
      prepress: S,
      viewer: F,
    },
  },
  "edition.create": {
    scope: "publication",
    row: "Editions: create, Plan tab",
    roles: { chief_editor: F, editor: F, advertising: S, prepress: S },
  },
  "edition.edit": {
    scope: "publication",
    row: "Editions: create, Plan tab",
    roles: { chief_editor: F, editor: F, advertising: S, prepress: S },
  },
  "edition.delete": { scope: "publication", row: "Delete draft edition", roles: { chief_editor: F } },
  "story.view": {
    scope: "publication",
    row: "Content desk · Stories library",
    roles: { ...ALL, reporter: S, photo_editor: S, advertising: S },
  },
  "story.create": {
    scope: "publication",
    row: "doc 11 §2 story.create (§12 silent)",
    roles: { chief_editor: F, editor: F, sub_editor: F, reporter: F },
  },
  "story.edit_own": {
    scope: "publication",
    row: "Story text edit (Reporter: own, before Ready)",
    roles: { chief_editor: F, editor: F, sub_editor: F, reporter: S },
  },
  "story.edit_any": {
    scope: "publication",
    row: "Story text edit (Page Designer: box text only)",
    roles: { chief_editor: F, editor: F, sub_editor: F, page_designer: S },
  },
  "story.assign": {
    scope: "publication",
    row: "doc 11 §2 story.edit any / assign priority / select for edition (§12 silent)",
    roles: { chief_editor: F, editor: F, sub_editor: F },
  },
  "media.view": {
    scope: "publication",
    row: "Media library",
    roles: {
      chief_editor: F,
      editor: F,
      sub_editor: F,
      reporter: S,
      page_designer: F,
      photo_editor: F,
      prepress: F,
      viewer: F,
    },
  },
  "media.upload": {
    scope: "publication",
    row: "Media library (Reporter: upload own)",
    roles: { chief_editor: F, editor: F, sub_editor: F, reporter: S, photo_editor: F },
  },
  "ads.view": {
    scope: "publication",
    row: "Ads desk (view)",
    roles: { chief_editor: F, editor: F, page_designer: F, advertising: F, prepress: F },
  },
  "ads.manage": { scope: "publication", row: "Ads desk", roles: { advertising: F } },
  "pages.view": { scope: "publication", row: "Pages tab · History tab", roles: ALL },
  "layout.generate": {
    scope: "publication",
    row: "Generate",
    roles: { chief_editor: F, editor: F, page_designer: F },
  },
  "layout.edit": {
    scope: "publication",
    row: "Editor: layout",
    roles: {
      chief_editor: F,
      editor: F,
      sub_editor: S,
      page_designer: F,
      photo_editor: S,
      advertising: S,
      prepress: S,
    },
  },
  "comment.read": { scope: "publication", row: "Comments (read)", roles: { ...ALL, reporter: S } },
  "comment.write": {
    scope: "publication",
    row: "Comments (write)",
    roles: { ...ALL_BUT_VIEWER, reporter: S }, // Viewer: read only
  },
  "page.approve": {
    scope: "publication",
    row: "Approve page",
    roles: { chief_editor: F },
    grants: ["page_approve"],
  },
  "page.unlock": { scope: "publication", row: "Unlock approved page", roles: { chief_editor: F } },
  "preflight.run": {
    scope: "publication",
    row: "Preflight: run",
    roles: { chief_editor: F, editor: F, sub_editor: F, page_designer: F, prepress: F },
  },
  "preflight.override": {
    scope: "publication",
    row: "Preflight: override a warning",
    roles: { chief_editor: F, prepress: F },
  },
  "export.press": {
    scope: "publication",
    row: "Export press master / send to press",
    roles: { chief_editor: F, prepress: F },
  },
  "proof.view": { scope: "publication", row: "Proof PDF, page images", roles: ALL },
  "release.approve": {
    scope: "publication",
    row: "Approve release",
    roles: { chief_editor: F },
    grants: ["release_approve"],
  },
  "release.correct": { scope: "publication", row: "Correct and republish", roles: { chief_editor: F } },
  "archive.view": { scope: "publication", row: "Archive view / download", roles: ALL },
  "archive.reprint": { scope: "publication", row: "Archive reprint", roles: { chief_editor: F, prepress: F } },
  "archive.legal_hold": { scope: "publication", row: "Legal hold / delete", roles: {} },
  "epaper.publish": { scope: "publication", row: "E-paper publish", roles: { chief_editor: F, editor: F } },
  "templates.view": {
    scope: "publication",
    row: "Templates and styles (view)",
    roles: { chief_editor: F, editor: F, page_designer: F, prepress: F },
  },
  "templates.edit": {
    scope: "publication",
    row: "Templates and styles",
    roles: { chief_editor: F, page_designer: F },
  },
  "publication.view": {
    scope: "publication",
    row: "any role on the publication (§12 shows every screen of it to every role)",
    roles: ALL,
  },
  "settings.view": {
    scope: "publication",
    row: "Publication settings (view)",
    roles: { chief_editor: F, editor: F, prepress: F },
  },
  "settings.edit": { scope: "publication", row: "Publication settings", roles: { chief_editor: F } },
  "print_profiles.view": {
    scope: "publication",
    row: "Print profiles (view)",
    roles: { chief_editor: F, prepress: F },
  },
  "print_profiles.edit": { scope: "publication", row: "Print profiles", roles: { prepress: F } },
  "fonts.view": {
    scope: "publication",
    row: "Fonts (view)",
    roles: { chief_editor: F, page_designer: F, prepress: F },
  },
  "fonts.edit": { scope: "publication", row: "Fonts", roles: { page_designer: F, prepress: F } },
  "brand.edit": { scope: "publication", row: "Brand", roles: { chief_editor: F, page_designer: F } },
  "desk.export": {
    scope: "publication",
    row: "the Desk story bundle (§12 and doc 11 silent: the desk roles that select stories for an edition)",
    roles: { chief_editor: F, editor: F },
  },
  "members.view": { scope: "org", row: "Team (view)", roles: { chief_editor: F } },
  "members.manage": { scope: "org", row: "Team; doc 11 §2 org.members.manage", roles: {} },
  "org.settings": { scope: "org", row: "Organization, storage", roles: {} },
  "audit.view": { scope: "org", row: "Audit log (Chief Editor: their publications)", roles: { chief_editor: S } },
  "billing.manage": { scope: "org", row: "Billing", roles: {}, ownerOnly: true },
} as const satisfies Record<string, Rule>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_NAMES = Object.keys(PERMISSIONS) as Permission[];
export const PermissionName = z.enum(PERMISSION_NAMES as [Permission, ...Permission[]]);

/** One publication's roles and grants for a person. */
export type PublicationAccess = { roles: readonly PublicationRole[]; grants: readonly Grant[] };

/**
 * What a person reaches with a permission: "full", "scoped", or null for nothing.
 * - publication: their roles and grants on that one publication (ignored for Owner and Admin);
 * - for an "org" permission, pass the union of their roles and grants on all the organisation's publications.
 */
export function reach(permission: Permission, orgRole: OrgRole, access: PublicationAccess): Reach | null {
  const rule: Rule = PERMISSIONS[permission];
  if (orgRole === "owner") return "full";
  if (orgRole === "admin") return rule.ownerOnly ? null : "full";
  let best: Reach | null = null;
  for (const role of access.roles) {
    const cell = rule.roles[role];
    if (cell === "full") return "full";
    if (cell === "scoped") best = "scoped";
  }
  const held = (grant: Grant) =>
    access.grants.includes(grant) && GRANT_HOLDERS[grant].some((r) => access.roles.includes(r));
  if (rule.grants?.some(held)) return "full";
  return best;
}
