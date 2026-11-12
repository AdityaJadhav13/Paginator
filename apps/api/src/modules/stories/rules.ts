// Who may see, edit, move and assign a story (docs/product/10-l2-newsroom-plan.md §5.2, §5.4; 07 §12): the "scoped"
// cells of the permission map made concrete, without a database. The access check (src/modules/access) has already
// let the person use the route; these rules decide what they reach on it.
//   - Seeing stories: a full story.view sees all; a Reporter's ◐ "own stories" sees the stories they report or are
//     given (the assignee); a Photo
//     Editor's ◐ "photos" sees all (read only: the photos are theirs to attach, PR 18); Advertising's ◐ "ads tab" sees
//     none (the ads desk is L2.6).
//   - Editing: the desk (a full story.edit_any: Owner, Admin, Chief Editor, Editor, Sub-editor) edits any story but a
//     spiked one; a Reporter edits their own story (reported or given) before it is Ready (Draft, Filed, Editing). A Page Designer's
//     ◐ "box text only" is the page editor's (L2.4), so the stories API lets them read only. Placement (priority, page
//     pin, edition) and the desk's note are the desk's.
//   - Moving (§5.4, proposed): the author sends a Draft to the desk; the desk picks it up, marks it ready, sends it
//     back (with a comment) and holds it; the Chief Editor and the Editor spike and restore. Placed is the system's.
import type { PublicationAccess, PublicationRole, StoryStatus, TransitionTarget } from "@pageinator/contracts";
import { reach } from "@pageinator/contracts";
import type { Access } from "../access/access.ts";

export type Scope = "all" | "own" | "none";

export type StoryFacts = { status: StoryStatus; reporterId: string; assigneeId: string | null };

/** A Reporter's "own stories": those they report, and those given to them. */
const theirs = (story: StoryFacts, userId: string) => story.reporterId === userId || story.assigneeId === userId;

/** The person's roles and grants on the publication (Owner and Admin have none, and need none). */
function on(access: Access, publicationId: string): PublicationAccess {
  return access.publications.get(publicationId) ?? { roles: [], grants: [] };
}

const has = (here: PublicationAccess, ...roles: PublicationRole[]) => roles.some((role) => here.roles.includes(role));

/** Which of a publication's stories the person sees. */
export function storyScope(access: Access, publicationId: string): Scope {
  const here = on(access, publicationId);
  const seen = reach("story.view", access.orgRole, here);
  if (seen === "full") return "all";
  if (seen === null) return "none";
  if (has(here, "photo_editor")) return "all";
  if (has(here, "reporter")) return "own";
  return "none";
}

export function sees(access: Access, publicationId: string, story: StoryFacts, userId: string): boolean {
  const scope = storyScope(access, publicationId);
  return scope === "all" || (scope === "own" && theirs(story, userId));
}

/** The desk of a publication: a full story.edit_any. */
export function isDesk(access: Access, publicationId: string): boolean {
  return reach("story.edit_any", access.orgRole, on(access, publicationId)) === "full";
}

/** Who may spike and restore: Owner, Admin, the Chief Editor and the Editor (§5.4). */
export function spikes(access: Access, publicationId: string): boolean {
  if (access.orgRole === "owner" || access.orgRole === "admin") return true;
  return has(on(access, publicationId), "chief_editor", "editor");
}

/** May the person edit the story's text (and its language and section)? */
export function canEdit(access: Access, publicationId: string, story: StoryFacts, userId: string): boolean {
  if (!sees(access, publicationId, story, userId)) return false;
  if (isDesk(access, publicationId)) return story.status !== "spiked";
  const own = reach("story.edit_own", access.orgRole, on(access, publicationId)) !== null;
  return own && theirs(story, userId) && ["draft", "filed", "editing"].includes(story.status);
}

/** The changes of state the person may make now. */
export function transitionsFor(
  access: Access,
  publicationId: string,
  story: StoryFacts,
  userId: string,
): TransitionTarget[] {
  if (!sees(access, publicationId, story, userId)) return [];
  const desk = isDesk(access, publicationId);
  const spiker = spikes(access, publicationId);
  const author = theirs(story, userId) && reach("story.edit_own", access.orgRole, on(access, publicationId)) !== null;
  const out: TransitionTarget[] = [];
  switch (story.status) {
    case "draft":
      if (author) out.push("filed");
      if (desk) out.push("held");
      break;
    case "filed":
      if (desk) out.push("editing", "ready", "draft", "held");
      break;
    case "editing":
      if (desk) out.push("ready", "draft", "held");
      break;
    case "ready":
      if (desk) out.push("draft", "held");
      break;
    case "placed":
      if (desk) out.push("held");
      break;
    case "held":
      if (desk) out.push("restore");
      break;
    case "spiked":
      if (spiker) out.push("restore");
      return out;
  }
  if (spiker) out.push("spiked");
  return out;
}

/** May the person assign the story (and set when it is due)? */
export function canAssign(access: Access, publicationId: string): boolean {
  return reach("story.assign", access.orgRole, on(access, publicationId)) !== null;
}

/** May the person read the story's comments: whoever sees the story with comment.read (a Reporter's ◐: their own
 * stories, which are the ones they see). */
export function canReadComments(access: Access, publicationId: string, story: StoryFacts, userId: string): boolean {
  if (!sees(access, publicationId, story, userId)) return false;
  const here = reach("comment.read", access.orgRole, on(access, publicationId));
  return here === "full" || (here === "scoped" && theirs(story, userId));
}

/** May the person comment on the story: whoever sees it with comment.write (a Reporter's ◐: their own stories; a
 * Viewer never). A send-back's comment is the desk's, with the move. */
export function canComment(access: Access, publicationId: string, story: StoryFacts, userId: string): boolean {
  if (!sees(access, publicationId, story, userId)) return false;
  const here = reach("comment.write", access.orgRole, on(access, publicationId));
  if (here === "full") return true;
  return here === "scoped" && theirs(story, userId);
}

/** A comment as the rules see it. */
export type CommentFacts = { authorId: string; parentId: string | null };

/** May the person change the comment's text: its author, while they may comment on the story. */
export function canEditComment(
  access: Access,
  publicationId: string,
  story: StoryFacts,
  comment: CommentFacts,
  userId: string,
): boolean {
  return comment.authorId === userId && canComment(access, publicationId, story, userId);
}

/** May the person resolve (or reopen) the thread a comment starts: whoever may comment and wrote it, the desk, or the
 * story's own reporter or assignee. A reply starts no thread. */
export function canResolve(
  access: Access,
  publicationId: string,
  story: StoryFacts,
  comment: CommentFacts,
  userId: string,
): boolean {
  if (comment.parentId !== null || !canComment(access, publicationId, story, userId)) return false;
  return comment.authorId === userId || isDesk(access, publicationId) || theirs(story, userId);
}

/** May the person delete the story: the desk, or its author while it is a Draft. */
export function canDelete(access: Access, publicationId: string, story: StoryFacts, userId: string): boolean {
  if (!sees(access, publicationId, story, userId)) return false;
  if (isDesk(access, publicationId)) return true;
  return story.reporterId === userId && story.status === "draft" && canEdit(access, publicationId, story, userId);
}

/** May the person give the story its photo, or change or remove it: whoever edits the story, and a Photo Editor
 * of the publication on any story they see but a spiked one (plan §5.2: the photos are theirs to attach). */
export function canAttachPhoto(access: Access, publicationId: string, story: StoryFacts, userId: string): boolean {
  if (canEdit(access, publicationId, story, userId)) return true;
  if (story.status === "spiked" || !sees(access, publicationId, story, userId)) return false;
  return has(on(access, publicationId), "photo_editor");
}

/** Which of a publication's pictures the person may download: all with a full media.view; a Reporter's ◐ the ones
 * they uploaded or that are the photo of one of their stories; none without media.view. */
export function mediaScope(access: Access, publicationId: string): Scope {
  const seen = reach("media.view", access.orgRole, on(access, publicationId));
  return seen === "full" ? "all" : seen === "scoped" ? "own" : "none";
}

/** Who sets an ad slot (ads.manage or layout.generate) may pick its picture: without media.view, the ready pictures of
 * the library and their previews only (an Advertising person; L2.3). */
export function picksAds(access: Access, publicationId: string): boolean {
  const here = on(access, publicationId);
  return !!(reach("ads.manage", access.orgRole, here) || reach("layout.generate", access.orgRole, here));
}

/** Whose pictures' own facts the person may change: all of the publication's with a full media.upload, a Reporter's ◐
 * the ones they uploaded; none without media.upload. Only "all" deletes a picture. */
export function uploadScope(access: Access, publicationId: string): Scope {
  const may = reach("media.upload", access.orgRole, on(access, publicationId));
  return may === "full" ? "all" : may === "scoped" ? "own" : "none";
}
