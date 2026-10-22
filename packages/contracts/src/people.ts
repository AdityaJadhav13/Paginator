// People, organisations and invitations (docs/product/10-l2-newsroom-plan.md §5.2): the shapes of /me, the Team
// endpoints and the invitation endpoints. Objects are strict (unknown keys refused) and responses are sent through
// these schemas, so a field that is not here never leaves the API.
import { z } from "zod";
import { Grant, OrgRole, PublicationRole, grantsFit } from "./permissions.ts";

const Id = z.uuid();
const Moment = z.iso.datetime({ offset: true });

export const Locale = z.enum(["en", "mr"]);
export const UiDigits = z.enum(["latin", "devanagari"]);

/** A person's roles and grants on one publication. */
export const PublicationGrant = z
  .strictObject({
    publicationId: Id,
    roles: z.array(PublicationRole).min(1).max(9),
    grants: z.array(Grant).max(2),
  })
  .refine((grant) => grantsFit(grant.roles, grant.grants), {
    error: "a grant goes only with a role allowed to hold it (page_approve and release_approve: editor)",
    path: ["grants"],
  });
export type PublicationGrant = z.infer<typeof PublicationGrant>;

export const Me = z.strictObject({
  user: z.strictObject({
    id: Id,
    name: z.string(),
    email: z.string(),
    emailVerified: z.boolean(),
    twoFactorEnabled: z.boolean(),
    locale: Locale,
    uiDigits: UiDigits,
  }),
  memberships: z.array(
    z.strictObject({
      org: z.strictObject({ id: Id, name: z.string() }),
      orgRole: OrgRole,
      twoStep: z.strictObject({ required: z.boolean(), satisfied: z.boolean() }),
      publications: z.array(
        z.strictObject({
          id: Id,
          name: z.string(),
          roles: z.array(PublicationRole),
          grants: z.array(Grant),
        }),
      ),
    }),
  ),
});
export type Me = z.infer<typeof Me>;

export const MePatch = z
  .strictObject({
    name: z.string().trim().min(1).max(200).optional(),
    locale: Locale.optional(),
    uiDigits: UiDigits.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, { error: "change at least one of name, locale, uiDigits" });
export type MePatch = z.infer<typeof MePatch>;

export const Member = z.strictObject({
  userId: Id,
  name: z.string(),
  email: z.string(),
  orgRole: OrgRole,
  publications: z.array(PublicationGrant),
  status: z.enum(["active", "removed"]),
  lastActiveAt: Moment.nullable(),
});
export type Member = z.infer<typeof Member>;

/** Admins invite and manage admins and members; an organisation's owner is made by bootstrap-org.ts only. */
export const InvitedRole = z.enum(["admin", "member"]);

export const MemberPatch = z
  .strictObject({
    orgRole: InvitedRole.optional(),
    publications: z.array(PublicationGrant).max(50).optional(),
  })
  .refine((patch) => patch.orgRole !== undefined || patch.publications !== undefined, {
    error: "change orgRole, publications, or both",
  });
export type MemberPatch = z.infer<typeof MemberPatch>;

export const InvitationCreate = z.strictObject({
  email: z.email().max(320),
  orgRole: InvitedRole,
  publications: z.array(PublicationGrant).max(50),
});
export type InvitationCreate = z.infer<typeof InvitationCreate>;

export const InvitationState = z.enum(["pending", "accepted", "rejected", "canceled", "expired"]);
export type InvitationState = z.infer<typeof InvitationState>;

export const Invitation = z.strictObject({
  id: Id,
  email: z.string(),
  orgRole: InvitedRole,
  publications: z.array(PublicationGrant),
  expiresAt: Moment,
  state: InvitationState,
});
export type Invitation = z.infer<typeof Invitation>;

/** What anyone with the link sees (GET /invitations/{id}): no email, no ids. */
export const PublicInvitation = z.strictObject({
  organization: z.strictObject({ name: z.string() }),
  inviter: z.strictObject({ name: z.string() }),
  roles: z.array(z.union([InvitedRole, PublicationRole])),
  expiresAt: Moment,
  state: InvitationState,
});
export type PublicInvitation = z.infer<typeof PublicInvitation>;

export const AcceptedInvitation = z.strictObject({ orgId: Id, publications: z.array(Id) });
export type AcceptedInvitation = z.infer<typeof AcceptedInvitation>;

/** The header that carries an invitation's id with a sign-up over HTTP (plan §4.3 step 4). */
export const INVITATION_HEADER = "X-Pageinator-Invitation";
