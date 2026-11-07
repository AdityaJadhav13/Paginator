// The first Owner of an organisation (docs/product/10-l2-newsroom-plan.md §4.3 step 6), run on the server by
// scripts/bootstrap-org.ts:
//   1. the Owner's account, made from the server (sign-up over HTTP needs an invitation), with no password and its
//      address unconfirmed; one email, a welcome with a link to choose a password (72 hours): choosing it through the
//      emailed link confirms the address too (auth.ts onPasswordReset), so the Owner can sign in;
//   2. the organisation, made by Better Auth as a system action (no session), with the Owner as its owner member;
//   3. its settings, the Owner's directory row and the first publication, in one transaction under its wall, audited.
// No one-time secret guards it: running it needs a shell on the server and the database settings, which already give
// every power it uses (plan §4.3, changed 2026-10-22).
import { randomBytes } from "node:crypto";
import { recordAudit } from "../../db/audit.ts";
import type { Database } from "../../db/pools.ts";
import { type Auth, WELCOMED } from "../identity/auth.ts";
import { WELCOME_LINK_HOURS, welcomeEmail } from "../identity/emails.ts";
import type { Mailer } from "../notifications/mailer.ts";

export type Bootstrap = {
  owner: { name: string; email: string };
  organization: { name: string; slug: string };
  publication: { name: string; slug: string; languages: string[]; primaryLanguage: string; digitStyle: string };
};

export class BootstrapError extends Error {}

/**
 * The Owner's welcome: a link to choose their password, made as Better Auth's own reset link is (a "reset-password:"
 * verification value, stored hashed, opened by /reset-password/:token), but living WELCOME_LINK_HOURS instead of the
 * reset link's hour: Better Auth has one reset-token life for all, so the welcome makes its own token.
 */
async function sendWelcome(
  auth: Auth,
  mailer: Mailer,
  owner: { id: string; name: string; email: string },
  input: Bootstrap,
) {
  const context = await auth.$context;
  const token = randomBytes(18).toString("base64url");
  await context.internalAdapter.createVerificationValue({
    identifier: `reset-password:${token}`,
    value: owner.id,
    expiresAt: new Date(Date.now() + WELCOME_LINK_HOURS * 3600_000),
  });
  const url = `${context.baseURL}/reset-password/${token}?callbackURL=${encodeURIComponent("/reset-password")}`;
  const mail = welcomeEmail({
    name: owner.name,
    organization: input.organization.name,
    url,
    origin: new URL(context.baseURL).origin,
    lang: input.publication.primaryLanguage === "mr" ? "mr" : "en",
  });
  mailer.send({ ...mail, to: owner.email });
}

export async function bootstrapOrg(
  auth: Auth,
  mailer: Mailer,
  database: Database,
  input: Bootstrap,
  requestId = "bootstrap-org",
): Promise<{ orgId: string; ownerId: string; publicationId: string }> {
  const context = await auth.$context;
  const email = input.owner.email.trim().toLowerCase();
  let owner = (await context.internalAdapter.findUserByEmail(email))?.user ?? null;
  if (!owner) {
    await auth.api.signUpEmail({
      // a server call with this callback sends no "confirm your address" email (auth.ts): the welcome is the only one
      body: { name: input.owner.name, email, password: randomBytes(32).toString("base64url"), callbackURL: WELCOMED },
    });
    owner = (await context.internalAdapter.findUserByEmail(email))?.user ?? null;
    if (!owner) throw new BootstrapError("The owner's account was not made.");
    await sendWelcome(auth, mailer, owner, input);
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
    // the system acts (a script on the server): no person, no client
    await recordAudit(tx, tenant, {
      action: "org.bootstrap",
      actorKind: "system",
      targetType: "organization",
      targetId: organization.id,
      publicationId: id,
      data: { owner: ownerId, publication: id },
    });
    return id;
  });
  return { orgId: organization.id, ownerId, publicationId };
}
