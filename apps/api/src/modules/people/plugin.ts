// People on /api/v1 (docs/product/10-l2-newsroom-plan.md §5.2): /me, the Team endpoints and the invitations.
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { type InvitationOptions, invitationRoutes } from "./invitations.ts";
import { meRoutes } from "./me.ts";
import { memberRoutes } from "./members.ts";

export const peopleRoutes: FastifyPluginAsyncZod<InvitationOptions> = async (app, options) => {
  await app.register(meRoutes, options);
  await app.register(memberRoutes, options);
  await app.register(invitationRoutes, options);
};
