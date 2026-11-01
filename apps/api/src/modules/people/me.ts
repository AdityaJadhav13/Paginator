// GET and PATCH /api/v1/me (docs/product/10-l2-newsroom-plan.md §5.2): the signed-in person, their organisations,
// their roles and grants on each publication, and whether each organisation's two-step rule is met. GET first
// finishes any accepted invitation left half done (grants.ts).
import { Me, MePatch, type PublicationAccess } from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { Database } from "../../db/pools.ts";
import type { Client } from "../../db/tenant.ts";
import { actorOf, clientOf, needsTwoStep, orgView } from "../access/access.ts";
import type { Auth } from "../identity/auth.ts";
import type { Actor } from "../identity/session.ts";
import { repairInvitations } from "./grants.ts";

export type PeopleOptions = { auth: Auth; database: Database };

async function me(database: Database, actor: Actor, requestId: string, client: Client): Promise<Me> {
  const person = { id: actor.userId, name: actor.name, email: actor.email };
  await repairInvitations(database, person, requestId, client);
  const memberships: Me["memberships"] = [];
  for (const membership of await database.identity.memberships(actor.userId)) {
    const view = await orgView(database, actor, membership.orgId, requestId);
    if (!view) continue;
    const names = new Map(view.allPublications.map((pub) => [pub.id, pub.name]));
    const publications = [...view.publications].map(([id, access]: [string, PublicationAccess]) => ({
      id,
      name: names.get(id) ?? "",
      roles: [...access.roles],
      grants: [...access.grants],
    }));
    const roles = publications.flatMap((pub) => pub.roles);
    memberships.push({
      org: { id: membership.orgId, name: membership.orgName },
      orgRole: view.orgRole,
      twoStep: {
        required: needsTwoStep(view.mfaRequiredRoles, view.orgRole, roles),
        satisfied: actor.twoStep,
      },
      publications,
    });
  }
  return {
    user: {
      id: actor.userId,
      name: actor.name,
      email: actor.email,
      emailVerified: actor.emailVerified,
      twoFactorEnabled: actor.twoFactorEnabled,
      locale: actor.locale,
      uiDigits: actor.uiDigits,
    },
    memberships,
  };
}

export const meRoutes: FastifyPluginAsyncZod<PeopleOptions> = async (app, { auth, database }) => {
  app.get("/api/v1/me", { config: { access: "signed_in" }, schema: { response: { 200: Me } } }, async (request) =>
    me(database, actorOf(request), request.id, clientOf(request)),
  );

  app.patch(
    "/api/v1/me",
    { config: { access: "signed_in" }, schema: { body: MePatch, response: { 200: Me } } },
    async (request) => {
      const actor = actorOf(request);
      const patch = request.body;
      const context = await auth.$context;
      await context.internalAdapter.updateUser(actor.userId, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.uiDigits !== undefined ? { uiDigits: patch.uiDigits } : {}),
      });
      const name = patch.name;
      if (name !== undefined) {
        // each organisation's directory shows the new name
        for (const membership of await database.identity.memberships(actor.userId)) {
          const tenant = { orgId: membership.orgId, userId: actor.userId, pubIds: [], requestId: request.id };
          await database.withTenant(tenant, (tx) =>
            tx.updateTable("app.person").set({ display_name: name }).where("user_id", "=", actor.userId).execute(),
          );
        }
      }
      const updated: Actor = {
        ...actor,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
        ...(patch.uiDigits !== undefined ? { uiDigits: patch.uiDigits } : {}),
      };
      return me(database, updated, request.id, clientOf(request));
    },
  );
};
