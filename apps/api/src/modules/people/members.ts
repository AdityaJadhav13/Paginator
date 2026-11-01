// The Team endpoints (docs/product/10-l2-newsroom-plan.md §5.2): an organisation's members, a member's organisation
// role and publication grants, and removing a member (their work stays). The organisation's Owner is made by
// scripts/bootstrap-org.ts and cannot be changed or removed here (a transfer comes later): that refusal is audited
// (auditRefusals, plugin.ts). Every change is audited in the transaction of its grants and directory row; the
// membership and its role are Better Auth's, on another pool, so they change last, just before that transaction
// commits: a failure before leaves everything as it was, and a member removed meanwhile (404) leaves no event.
import { Member, MemberPatch, type OrgRole, type PublicationGrant } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import type { Database } from "../../db/pools.ts";
import type { Tenant } from "../../db/tenant.ts";
import type { Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { accessOf, orgRoleOf, refused } from "../access/access.ts";
import { displayName } from "./grants.ts";
import type { PeopleOptions } from "./me.ts";

const OrgParams = z.strictObject({ o: z.string() });
const MemberParams = z.strictObject({ o: z.string(), userId: z.string() });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Checks that every publication of a grant list is the organisation's, once each (400 otherwise). */
export async function checkPublications(tx: Tx, grants: readonly PublicationGrant[], field: string): Promise<void> {
  const ids = grants.map((grant) => grant.publicationId);
  if (new Set(ids).size !== ids.length) {
    throw new ApiError("invalid_request", [{ field, message: "names a publication more than once" }]);
  }
  if (ids.length === 0) return;
  const found = await tx.selectFrom("app.publication").select("id").where("id", "in", ids).execute();
  if (found.length !== ids.length) {
    throw new ApiError("invalid_request", [{ field, message: "names a publication this organisation does not have" }]);
  }
}

async function grantsOf(tx: Tx, userId?: string): Promise<Map<string, PublicationGrant[]>> {
  let query = tx.selectFrom("app.publication_grant").select(["user_id", "publication_id", "roles", "grants"]);
  if (userId) query = query.where("user_id", "=", userId);
  const byUser = new Map<string, PublicationGrant[]>();
  for (const row of await query.orderBy("publication_id").execute()) {
    const list = byUser.get(row.user_id) ?? [];
    list.push({
      publicationId: row.publication_id,
      roles: row.roles as PublicationGrant["roles"],
      grants: row.grants as PublicationGrant["grants"],
    });
    byUser.set(row.user_id, list);
  }
  return byUser;
}

async function membersOf(database: Database, tenant: Tenant, only?: string): Promise<Member[]> {
  const members = (await database.identity.members(tenant.orgId)).filter((m) => !only || m.userId === only);
  const grants = await database.withTenant(tenant, (tx) => grantsOf(tx, only));
  return members.map((member) => ({
    userId: member.userId,
    name: member.name,
    email: member.email,
    orgRole: orgRoleOf(member.role) ?? "member",
    publications: grants.get(member.userId) ?? [],
    status: "active" as const,
    lastActiveAt: member.lastActiveAt ? member.lastActiveAt.toISOString() : null,
  }));
}

/** The member a change is about, refused with 404 (not a member) or 403 (the Owner). */
async function target(database: Database, orgId: string, userId: string): Promise<OrgRole> {
  if (!UUID.test(userId)) throw new ApiError("not_found");
  const membership = await database.identity.membership(orgId, userId);
  const role = membership ? orgRoleOf(membership.role) : null;
  if (!role) throw new ApiError("not_found");
  if (role === "owner") throw refused("the Owner is not changed or removed here");
  return role;
}

export const memberRoutes: FastifyPluginAsyncZod<PeopleOptions> = async (app, { database }) => {
  app.get(
    "/api/v1/orgs/:o/members",
    {
      config: { permission: "members.view" },
      schema: { params: OrgParams, response: { 200: z.strictObject({ items: z.array(Member) }) } },
    },
    async (request) => ({ items: await membersOf(database, accessOf(request).tenant) }),
  );

  app.patch(
    "/api/v1/orgs/:o/members/:userId",
    {
      config: { permission: "members.manage" },
      schema: { params: MemberParams, body: MemberPatch, response: { 200: Member } },
    },
    async (request) => {
      const { tenant } = accessOf(request);
      const userId = request.params.userId;
      await target(database, tenant.orgId, userId);
      const { orgRole, publications } = request.body;
      await database.withTenant(tenant, async (tx) => {
        if (publications !== undefined) {
          await checkPublications(tx, publications, "body.publications");
          await tx.deleteFrom("app.publication_grant").where("user_id", "=", userId).execute();
          for (const grant of publications) {
            await tx
              .insertInto("app.publication_grant")
              .values({
                org_id: tenant.orgId,
                publication_id: grant.publicationId,
                user_id: userId,
                roles: grant.roles,
                grants: grant.grants,
              })
              .execute();
          }
        }
        await recordAudit(tx, tenant, {
          action: "member.update",
          targetType: "person",
          targetId: userId,
          data: { orgRole, publications },
        });
        // last (Better Auth's pool): no member any more, as when removed at this very moment, undoes all of the above
        const still =
          orgRole !== undefined
            ? await database.identity.setMemberRole(tenant.orgId, userId, orgRole)
            : (await database.identity.membership(tenant.orgId, userId)) !== null;
        if (!still) throw new ApiError("not_found");
      });
      const [member] = await membersOf(database, tenant, userId);
      if (!member) throw new ApiError("not_found");
      return member;
    },
  );

  app.delete(
    "/api/v1/orgs/:o/members/:userId",
    { config: { permission: "members.manage" }, schema: { params: MemberParams } },
    async (request, reply) => {
      const { tenant } = accessOf(request);
      const userId = request.params.userId;
      await target(database, tenant.orgId, userId);
      const member = (await database.identity.members(tenant.orgId)).find((m) => m.userId === userId);
      if (!member) throw new ApiError("not_found");
      const removedAt = new Date();
      await database.withTenant(tenant, async (tx) => {
        // 1. their grants go, and their directory row says removed (a tombstone, made if it was never written), with
        //    the event
        await tx.deleteFrom("app.publication_grant").where("user_id", "=", userId).execute();
        await tx
          .insertInto("app.person")
          .values({
            org_id: tenant.orgId,
            user_id: userId,
            display_name: displayName(member.name, member.email),
            email: member.email,
            status: "removed",
            removed_at: removedAt,
          })
          .onConflict((conflict) =>
            conflict.columns(["org_id", "user_id"]).doUpdateSet({ status: "removed", removed_at: removedAt }),
          )
          .execute();
        await recordAudit(tx, tenant, { action: "member.remove", targetType: "person", targetId: userId });
        // 2. last (Better Auth's pool): the membership, and the invitations they accepted here closed, in one
        //    statement: from then on they reach nothing, and no repair (grants.ts) can make the membership again.
        //    Removed meanwhile by someone else: all of the above is undone (404)
        if (!(await database.identity.removeMember(tenant.orgId, userId, member.email))) {
          throw new ApiError("not_found");
        }
      });
      return reply.status(204).send();
    },
  );
};
