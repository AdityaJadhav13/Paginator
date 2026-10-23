// Who is told of what (06 §11, L2.1's defaults; docs/product/10-l2-newsroom-plan.md §5.4). Each notice is written in
// the transaction of the change it tells of, so it exists exactly when the change does: a story's move, assignment or
// comment in that request's transaction; an accepted invitation in the transaction that writes its grants and the
// person's directory row (applyInvitation, src/modules/people/grants.ts), so a notice that fails undoes the accept and
// the invitee can try again. Its email, if any, is collected in an outbox and sent once that transaction has committed
// (sendAll).
//   - A story filed to the desk: its Editors and Sub-editors, in app.
//   - A story sent back with a comment: its reporter, in app and by email.
//   - A story given to someone: that person, in app.
//   - A comment: the story's reporter and assignee and, for a reply, everyone who has written in the thread, in app.
//   - An invitation accepted: the person who sent it, in app and by email.
// Nobody is told of their own action, and only active members who would see the story (and, for a comment, may read
// comments) are told: the same rules as the routes (src/modules/stories/rules.ts).
import {
  type OrgRole,
  type Permission,
  type PublicationAccess,
  type PublicationRole,
  reach,
} from "@pageinator/contracts";
import type { IdentityStore } from "../../db/identity.ts";
import {
  type NewNotification,
  type Recipient,
  activePeople,
  addNotifications,
  grantsOn,
  withRoles,
} from "../../db/notifications.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { type Access, orgRoleOf } from "../access/access.ts";
import { type StoryFacts, sees } from "../stories/rules.ts";
import { invitationAcceptedEmail, sentBackEmail } from "./emails.ts";
import { type Mail, type Mailer, RecipientError } from "./mailer.ts";

export type Outbox = Mail[];

export type NotifierOptions = { identity: IdentityStore; origin: string };

export type Notifier = ReturnType<typeof notifier>;

const unique = (ids: readonly (string | null | undefined)[]) => [...new Set(ids.filter((id): id is string => !!id))];

export function notifier({ identity, origin }: NotifierOptions) {
  /** The people among these, other than the one acting, who are active members and see the story (and reach the
   * permission, when one is named). */
  async function audience(
    tx: Tx,
    tenant: Tenant,
    publicationId: string,
    candidates: readonly (string | null | undefined)[],
    story: StoryFacts,
    needs?: Permission,
  ): Promise<Recipient[]> {
    const ids = unique(candidates).filter((id) => id !== tenant.userId);
    if (ids.length === 0) return [];
    const [people, grants, roles] = await Promise.all([
      activePeople(tx, ids),
      grantsOn(tx, publicationId, ids),
      identity.memberRoles(tenant.orgId, ids),
    ]);
    return people.filter((person) => {
      const stored = roles.get(person.userId);
      const orgRole: OrgRole | null = stored ? orgRoleOf(stored) : null;
      if (!orgRole) return false;
      const here = grants.get(person.userId) as PublicationAccess | undefined;
      const manager = orgRole === "owner" || orgRole === "admin";
      if (!manager && !here) return false;
      const theirs = here ?? { roles: [] as PublicationRole[], grants: [] };
      const access = { orgRole, publications: new Map([[publicationId, theirs]]) } as unknown as Access;
      if (!sees(access, publicationId, story, person.userId)) return false;
      return needs === undefined || reach(needs, orgRole, theirs) !== null;
    });
  }

  const storyNotice = (
    kind: NewNotification["kind"],
    tenant: Tenant,
    publicationId: string,
    storyId: string,
    extra: { commentId?: string } = {},
    emailed = false,
  ) => {
    return (person: Recipient): NewNotification => ({
      userId: person.userId,
      kind,
      targetType: "story",
      targetId: storyId,
      data: { publicationId, storyId, ...extra, actorId: tenant.userId },
      emailed,
    });
  };

  return {
    async storyFiled(tx: Tx, tenant: Tenant, publicationId: string, storyId: string, story: StoryFacts) {
      const desk = await withRoles(tx, publicationId, ["editor", "sub_editor"]);
      const told = await audience(tx, tenant, publicationId, desk, story);
      await addNotifications(tx, tenant.orgId, told.map(storyNotice("story_filed", tenant, publicationId, storyId)));
    },

    async storySentBack(
      tx: Tx,
      tenant: Tenant,
      publicationId: string,
      story: StoryFacts & { id: string; headline: string },
      comment: { id: string; body: string },
      outbox: Outbox,
    ) {
      const [reporter] = await audience(tx, tenant, publicationId, [story.reporterId], story);
      if (!reporter) return;
      const emailed = reporter.email !== null;
      const notice = storyNotice(
        "story_sent_back",
        tenant,
        publicationId,
        story.id,
        { commentId: comment.id },
        emailed,
      );
      await addNotifications(tx, tenant.orgId, [notice(reporter)]);
      if (!reporter.email) return;
      const [by] = await activePeople(tx, [tenant.userId]);
      const language = (await identity.languages([reporter.userId])).get(reporter.userId) ?? "en";
      outbox.push({
        ...sentBackEmail({
          language,
          name: reporter.name,
          by: by?.name ?? "",
          headline: story.headline,
          comment: comment.body,
          origin,
          orgId: tenant.orgId,
          publicationId,
        }),
        to: reporter.email,
      });
    },

    async storyAssigned(tx: Tx, tenant: Tenant, publicationId: string, storyId: string, story: StoryFacts) {
      const told = await audience(tx, tenant, publicationId, [story.assigneeId], story);
      await addNotifications(tx, tenant.orgId, told.map(storyNotice("story_assigned", tenant, publicationId, storyId)));
    },

    async commented(
      tx: Tx,
      tenant: Tenant,
      publicationId: string,
      story: StoryFacts & { id: string },
      comment: { id: string },
      threadAuthors: readonly string[],
    ) {
      const candidates = [story.reporterId, story.assigneeId, ...threadAuthors];
      const told = await audience(tx, tenant, publicationId, candidates, story, "comment.read");
      await addNotifications(
        tx,
        tenant.orgId,
        told.map(storyNotice("comment", tenant, publicationId, story.id, { commentId: comment.id })),
      );
    },

    async invitationAccepted(
      tx: Tx,
      tenant: Tenant,
      invitation: { id: string; inviterId: string; orgName: string },
      joined: { name: string },
      outbox: Outbox,
    ) {
      if (invitation.inviterId === tenant.userId) return;
      const [inviter] = await activePeople(tx, [invitation.inviterId]);
      if (!inviter) return;
      const emailed = inviter.email !== null;
      await addNotifications(tx, tenant.orgId, [
        {
          userId: inviter.userId,
          kind: "invitation_accepted",
          targetType: "invitation",
          targetId: invitation.id,
          data: { invitationId: invitation.id, actorId: tenant.userId },
          emailed,
        },
      ]);
      if (!inviter.email) return;
      const language = (await identity.languages([inviter.userId])).get(inviter.userId) ?? "en";
      outbox.push({
        ...invitationAcceptedEmail({
          language,
          name: inviter.name,
          joined: joined.name,
          organization: invitation.orgName,
          origin,
          orgId: tenant.orgId,
        }),
        to: inviter.email,
      });
    },
  };
}

/** Sends what the outbox holds (after the change committed). An address the mailer refuses is reported, not thrown:
 * the change has happened. */
export function sendAll(mailer: Mailer, outbox: Outbox, onRefused: (kind: Mail["kind"]) => void): void {
  for (const mail of outbox) {
    try {
      mailer.send(mail);
    } catch (error) {
      if (!(error instanceof RecipientError)) throw error;
      onRefused(mail.kind);
    }
  }
  outbox.length = 0;
}
