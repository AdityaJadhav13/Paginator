// The first Owner of an organisation (docs/product/10-l2-newsroom-plan.md §4.3 step 6), run on the server by
// scripts/bootstrap-org.ts:
//   1. the Owner's account, made from the server (sign-up over HTTP needs an invitation), with a random password
//      nobody sees; Better Auth emails the verification link, and we email a password-reset link, so the Owner
//      chooses their own password and confirms their address before they can sign in;
//   2. the organisation, made by Better Auth as a system action (no session), with the Owner as its owner member;
//   3. its settings, the Owner's directory row and the first publication, in one transaction under its wall, audited.
// No one-time secret guards it: running it needs a shell on the server and the database settings, which already give
// every power it uses (plan §4.3, changed 2026-10-22).
import { randomBytes } from "node:crypto";
import type { Database } from "../../db/pools.ts";
import type { Auth } from "../identity/auth.ts";

export type Bootstrap = {
  owner: { name: string; email: string };
  organization: { name: string; slug: string };
  publication: { name: string; slug: string; languages: string[]; primaryLanguage: string; digitStyle: string };
};

export class BootstrapError extends Error {}

/** Where the Owner's confirmation link sends them once the address is confirmed. */
export const CONFIRMED_PATH = "/verify?confirmed=1";

export async function bootstrapOrg(
  auth: Auth,
  database: Database,
  input: Bootstrap,
  requestId = "bootstrap-org",
): Promise<{ orgId: string; ownerId: string; publicationId: string }> {
  const context = await auth.$context;
  const email = input.owner.email.trim().toLowerCase();
  let owner = (await context.internalAdapter.findUserByEmail(email))?.user ?? null;
  if (!owner) {
    await auth.api.signUpEmail({
      // the confirmation link lands on the web app's own page (apps/web VerifyEmailScreen: /verify?confirmed=1)
      body: {
        name: input.owner.name,
        email,
        password: randomBytes(32).toString("base64url"),
        callbackURL: CONFIRMED_PATH,
      },
    });
    owner = (await context.internalAdapter.findUserByEmail(email))?.user ?? null;
    if (!owner) throw new BootstrapError("The owner's account was not made.");
    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });
  }
  const taken = await context.adapter.findOne({
    model: "organization",
    where: [{ field: "slug", value: input.organization.slug }],
  });
  if (taken) throw new BootstrapError(`An organisation with the slug ${input.organization.slug} exists already.`);
  const organization = (await auth.api.createOrganization({
    body: { name: input.organization.name, slug: input.organization.slug, userId: owner.id },
  })) as { id: string } | null;
  if (!organization) throw new BootstrapError("The organisation was not made.");
  const tenant = { orgId: organization.id, userId: owner.id, pubIds: [], requestId };
  const ownerId = owner.id;
  const ownerName = owner.name;
  const publicationId = await database.withTenant(tenant, async (tx) => {
    await tx.insertInto("app.org_settings").values({ org_id: organization.id }).execute();
    await tx
      .insertInto("app.person")
      .values({ org_id: organization.id, user_id: ownerId, display_name: ownerName, email })
      .execute();
    const { id } = await tx
      .insertInto("app.publication")
      .values({
        org_id: organization.id,
        name: input.publication.name,
        slug: input.publication.slug,
        languages: input.publication.languages,
        primary_language: input.publication.primaryLanguage,
        digit_style: input.publication.digitStyle,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    await tx
      .insertInto("app.audit_event")
      .values({
        org_id: organization.id,
        publication_id: id,
        actor_kind: "system",
        action: "org.bootstrap",
        target_type: "organization",
        target_id: organization.id,
        data: JSON.stringify({ owner: ownerId, publication: id }),
        request_id: requestId,
      })
      .execute();
    return id;
  });
  return { orgId: organization.id, ownerId, publicationId };
}
