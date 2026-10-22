// Invitations (docs/product/10-l2-newsroom-plan.md §4.3, §5.2). An Owner or Admin invites by email, with an
// organisation role (admin or member) and roles and grants per publication. Better Auth keeps the invitation (its id,
// a random UUID, is the secret of the link) and decides the accept: the same email, verified, pending, unexpired,
// claimed atomically. Our invitation_grant rows say what it grants; they are applied from our table only, never from
// the client (grants.ts). The email is ours, sent once the grants are written, so it can name every role.
import {
  AcceptedInvitation,
  Invitation,
  InvitationCreate,
  type InvitationState,
  type PublicationGrant,
  PublicInvitation,
} from "@pageinator/contracts";
import { APIError } from "better-auth/api";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Config } from "../../config.ts";
import type { Invitation as StoredInvitation } from "../../db/identity.ts";
import type { Database } from "../../db/pools.ts";
import type { Tenant } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf, actorOf } from "../access/access.ts";
import { invitationEmail } from "../identity/emails.ts";
import { authHeaders } from "../identity/headers.ts";
import { type Mailer, RecipientError } from "../notifications/mailer.ts";
import { applyInvitation, audit } from "./grants.ts";
import type { PeopleOptions } from "./me.ts";
import { checkPublications } from "./members.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** withTenant needs a user; a signed-out reader of an invitation has none (no policy of these tables reads it). */
const NOBODY = "00000000-0000-0000-0000-000000000000";

const OrgParams = z.strictObject({ o: z.string() });
const InvitationParams = z.strictObject({ o: z.string(), id: z.string() });
const PublicParams = z.strictObject({ id: z.string() });

export type InvitationOptions = PeopleOptions & { config: Config; mailer: Mailer };

function stateOf(invitation: StoredInvitation, now = Date.now()): InvitationState {
  if (invitation.status === "pending" && invitation.expiresAt.getTime() <= now) return "expired";
  return invitation.status;
}

async function grantsOf(database: Database, tenant: Tenant, invitationId: string): Promise<PublicationGrant[]> {
  const rows = await database.withTenant(tenant, (tx) =>
    tx
      .selectFrom("app.invitation_grant")
      .select(["publication_id", "roles", "grants"])
      .where("invitation_id", "=", invitationId)
      .orderBy("publication_id")
      .execute(),
  );
  return rows.map((row) => ({
    publicationId: row.publication_id,
    roles: row.roles as PublicationGrant["roles"],
    grants: row.grants as PublicationGrant["grants"],
  }));
}

async function view(database: Database, tenant: Tenant, invitation: StoredInvitation): Promise<Invitation> {
  return {
    id: invitation.id,
    email: invitation.email,
    orgRole: invitation.role === "admin" ? "admin" : "member",
    publications: await grantsOf(database, tenant, invitation.id),
    expiresAt: invitation.expiresAt.toISOString(),
    state: stateOf(invitation),
  };
}

/** An invitation of this organisation, or 404. */
async function ofOrg(database: Database, orgId: string, id: string): Promise<StoredInvitation> {
  const invitation = UUID.test(id) ? await database.identity.invitation(id) : null;
  if (!invitation || invitation.orgId !== orgId) throw new ApiError("not_found");
  return invitation;
}

function code(error: unknown): string | undefined {
  return error instanceof APIError ? (error.body as { code?: string } | undefined)?.code : undefined;
}

export const invitationRoutes: FastifyPluginAsyncZod<InvitationOptions> = async (
  app,
  { auth, database, config, mailer },
) => {
  const origin = config.publicOrigin;

  function sendInvitation(
    invitation: { id: string; email: string; orgName: string },
    inviter: string,
    roles: string[],
  ) {
    const mail = invitationEmail({
      inviter,
      organization: invitation.orgName,
      roles,
      url: `${origin}/invite/${invitation.id}`,
      origin,
    });
    try {
      mailer.send({ ...mail, to: invitation.email });
    } catch (error) {
      if (!(error instanceof RecipientError)) throw error;
      app.log.warn({ kind: mail.kind }, error.message);
    }
  }
  const rolesOf = (orgRole: string, grants: readonly PublicationGrant[]) => [
    orgRole,
    ...new Set(grants.flatMap((grant) => grant.roles)),
  ];

  app.post(
    "/api/v1/orgs/:o/invitations",
    {
      config: { permission: "members.manage" },
      schema: { params: OrgParams, body: InvitationCreate, response: { 201: Invitation } },
    },
    async (request, reply) => {
      const { tenant } = accessOf(request);
      const actor = actorOf(request);
      const { email, orgRole, publications } = request.body;
      await database.withTenant(tenant, (tx) => checkPublications(tx, publications, "body.publications"));
      let created: { id: string };
      try {
        created = (await auth.api.createInvitation({
          headers: authHeaders(request),
          body: { email, role: orgRole, organizationId: tenant.orgId },
        })) as { id: string };
      } catch (error) {
        if (code(error) === "USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION") {
          throw new ApiError("invalid_request", [{ field: "body.email", message: "is already a member" }]);
        }
        if (code(error) === "INVITATION_LIMIT_REACHED") {
          throw new ApiError("invalid_request", [{ field: "body.email", message: "too many pending invitations" }]);
        }
        throw error;
      }
      try {
        await database.withTenant(tenant, async (tx) => {
          for (const grant of publications) {
            await tx
              .insertInto("app.invitation_grant")
              .values({
                org_id: tenant.orgId,
                invitation_id: created.id,
                publication_id: grant.publicationId,
                roles: grant.roles,
                grants: grant.grants,
              })
              .execute();
          }
        });
      } catch (error) {
        // an invitation must never be accepted without the grants it was made with
        await auth.api.cancelInvitation({ headers: authHeaders(request), body: { invitationId: created.id } });
        throw error;
      }
      const invitation = await ofOrg(database, tenant.orgId, created.id);
      await audit(database, tenant, "invitation.create", invitation.id, { orgRole, publications });
      sendInvitation(invitation, actor.name, rolesOf(orgRole, publications));
      return reply.status(201).send(await view(database, tenant, invitation));
    },
  );

  app.get(
    "/api/v1/orgs/:o/invitations",
    {
      config: { permission: "members.manage" },
      schema: { params: OrgParams, response: { 200: z.strictObject({ items: z.array(Invitation) }) } },
    },
    async (request) => {
      const { tenant } = accessOf(request);
      const pending = await database.identity.pendingInvitations(tenant.orgId);
      return { items: await Promise.all(pending.map((invitation) => view(database, tenant, invitation))) };
    },
  );

  app.post(
    "/api/v1/orgs/:o/invitations/:id/resend",
    {
      config: { permission: "members.manage" },
      schema: { params: InvitationParams, response: { 200: Invitation } },
    },
    async (request) => {
      const { tenant } = accessOf(request);
      const actor = actorOf(request);
      const found = await ofOrg(database, tenant.orgId, request.params.id);
      if (found.status !== "pending") throw new ApiError("not_found");
      // Better Auth gives a live invitation its full time again, under the same id; for one that has expired it makes a
      // new invitation (its pending search skips expired ones). Whatever id it answers is the one we go on with.
      const answered = (await auth.api.createInvitation({
        headers: authHeaders(request),
        body: {
          email: found.email,
          role: found.role === "admin" ? "admin" : "member",
          organizationId: tenant.orgId,
          resend: true,
        },
      })) as { id: string };
      if (answered.id !== found.id) {
        try {
          await database.withTenant(tenant, async (tx) => {
            const grants = await tx
              .selectFrom("app.invitation_grant")
              .select(["publication_id", "roles", "grants"])
              .where("invitation_id", "=", found.id)
              .execute();
            for (const grant of grants) {
              await tx
                .insertInto("app.invitation_grant")
                .values({ org_id: tenant.orgId, invitation_id: answered.id, ...grant })
                .execute();
            }
          });
        } catch (error) {
          await auth.api.cancelInvitation({ headers: authHeaders(request), body: { invitationId: answered.id } });
          throw error;
        }
        await auth.api.cancelInvitation({ headers: authHeaders(request), body: { invitationId: found.id } });
      }
      const invitation = await ofOrg(database, tenant.orgId, answered.id);
      await audit(
        database,
        tenant,
        "invitation.resend",
        invitation.id,
        answered.id === found.id ? {} : { replaces: found.id },
      );
      const answer = await view(database, tenant, invitation);
      sendInvitation(invitation, actor.name, rolesOf(answer.orgRole, answer.publications));
      return answer;
    },
  );

  app.delete(
    "/api/v1/orgs/:o/invitations/:id",
    { config: { permission: "members.manage" }, schema: { params: InvitationParams } },
    async (request, reply) => {
      const { tenant } = accessOf(request);
      const invitation = await ofOrg(database, tenant.orgId, request.params.id);
      if (invitation.status !== "pending") throw new ApiError("not_found");
      await auth.api.cancelInvitation({ headers: authHeaders(request), body: { invitationId: invitation.id } });
      await audit(database, tenant, "invitation.cancel", invitation.id);
      return reply.status(204).send();
    },
  );

  // what anyone with the link sees, 20 times an hour per address (on top of the API's own per-address limit)
  const lookups = app.createRateLimit({ max: 20, timeWindow: 3600_000, keyGenerator: (r) => `invitation:${r.ip}` });
  app.get(
    "/api/v1/invitations/:id",
    {
      config: { access: "public" },
      preHandler: async (request, reply) => {
        const limit = await lookups(request);
        if (limit.isAllowed || !limit.isExceeded) return;
        reply.header("retry-after", limit.ttlInSeconds);
        throw new ApiError("slow_down");
      },
      schema: { params: PublicParams, response: { 200: PublicInvitation } },
    },
    async (request) => {
      const invitation = UUID.test(request.params.id) ? await database.identity.invitation(request.params.id) : null;
      if (!invitation) throw new ApiError("not_found");
      const tenant = { orgId: invitation.orgId, userId: NOBODY, pubIds: [], requestId: request.id };
      const grants = await grantsOf(database, tenant, invitation.id);
      return {
        organization: { name: invitation.orgName },
        inviter: { name: invitation.inviterName },
        roles: rolesOf(invitation.role === "admin" ? "admin" : "member", grants) as PublicInvitation["roles"],
        expiresAt: invitation.expiresAt.toISOString(),
        state: stateOf(invitation),
      };
    },
  );

  app.post(
    "/api/v1/invitations/:id/accept",
    { config: { access: "signed_in" }, schema: { params: PublicParams, response: { 200: AcceptedInvitation } } },
    async (request) => {
      const actor = actorOf(request);
      const id = request.params.id;
      if (!UUID.test(id)) throw new ApiError("not_found");
      try {
        await auth.api.acceptInvitation({ headers: authHeaders(request), body: { invitationId: id } });
      } catch (error) {
        const which = code(error);
        if (which === "EMAIL_VERIFICATION_REQUIRED_BEFORE_ACCEPTING_OR_REJECTING_INVITATION") {
          throw new ApiError("not_allowed");
        }
        // not found, expired, already used, or for another email: the same answer
        if (error instanceof APIError && error.statusCode < 500) throw new ApiError("not_found");
        throw error;
      }
      const invitation = await database.identity.invitation(id);
      if (!invitation) throw new ApiError("not_found");
      const person = { id: actor.userId, name: actor.name, email: actor.email };
      let publications: string[];
      try {
        publications = await applyInvitation(database, invitation, person, request.id, true);
      } catch (error) {
        // never a member without their directory row and grants: the accept is undone, and can be tried again
        await database.identity.undoAccept(invitation.orgId, actor.userId, invitation.id);
        throw error;
      }
      const tenant = { orgId: invitation.orgId, userId: actor.userId, pubIds: [], requestId: request.id };
      await audit(database, tenant, "invitation.accept", invitation.id, { publications });
      return { orgId: invitation.orgId, publications };
    },
  );
};
