/**
 * What a person may do with a publication's stories, from /me and the permission map (07 §12), as the API's
 * src/modules/stories/rules.ts decides it: who sees all stories, a Reporter's own, or none; who is the desk; who may
 * create. A story's own `can` (from the API) decides its edits, moves and assignment; these only shape the screens.
 */
import { reach, type PublicationAccess } from "@pageinator/contracts";
import type { OrgAccessDto } from "../../services/index.ts";

export function pubAccess(org: OrgAccessDto, publicationId: string): PublicationAccess {
  const publication = org.publications.find((candidate) => candidate.id === publicationId);
  return { roles: publication?.roles ?? [], grants: publication?.grants ?? [] };
}

/** All of a publication's stories, a Reporter's own, or none (Advertising's stories are the ads desk's, L2.6). */
export function storyScope(org: OrgAccessDto, publicationId: string): "all" | "own" | "none" {
  const here = pubAccess(org, publicationId);
  const seen = reach("story.view", org.orgRole, here);
  if (seen === "full") return "all";
  if (seen === null) return "none";
  if (here.roles.includes("photo_editor")) return "all";
  if (here.roles.includes("reporter")) return "own";
  return "none";
}

/** The desk: Owner, Admin, Chief Editor, Editor, Sub-editor (a full story.edit_any). */
export function isDesk(org: OrgAccessDto, publicationId: string): boolean {
  return reach("story.edit_any", org.orgRole, pubAccess(org, publicationId)) === "full";
}

export function mayCreate(org: OrgAccessDto, publicationId: string): boolean {
  return reach("story.create", org.orgRole, pubAccess(org, publicationId)) !== null;
}

/** media.upload: the desk, a Photo Editor, and a Reporter (their own). */
export function mayUpload(org: OrgAccessDto, publicationId: string): boolean {
  return reach("media.upload", org.orgRole, pubAccess(org, publicationId)) !== null;
}

/** media.view: whoever may see (and download) the publication's pictures; a Reporter's ◐ their own. */
export function mayViewMedia(org: OrgAccessDto, publicationId: string): boolean {
  return reach("media.view", org.orgRole, pubAccess(org, publicationId)) !== null;
}

/** edition.view: whoever may see the publication's editions (Advertising's and Prepress's ◐ too). */
export function mayViewEditions(org: OrgAccessDto, publicationId: string): boolean {
  return reach("edition.view", org.orgRole, pubAccess(org, publicationId)) !== null;
}

/** A full edition.create: Owner, Admin, Chief Editor, Editor (the API refuses a ◐ one). */
export function mayCreateEdition(org: OrgAccessDto, publicationId: string): boolean {
  return reach("edition.create", org.orgRole, pubAccess(org, publicationId)) === "full";
}

/** A full desk.export: "Send to the Desk" (Owner, Admin, Chief Editor, Editor). */
export function mayExport(org: OrgAccessDto, publicationId: string): boolean {
  return reach("desk.export", org.orgRole, pubAccess(org, publicationId)) === "full";
}
