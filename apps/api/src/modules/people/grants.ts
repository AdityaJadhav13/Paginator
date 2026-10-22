// Making an accepted invitation's grants real (docs/product/10-l2-newsroom-plan.md §4.3), and repairing those left
// half made. Better Auth's accept claims the invitation (pending → accepted) and makes the membership in identity;
// the grants live in app, on another pool, so they cannot be written in the same transaction:
//   - applyInvitation writes them from OUR invitation_grant rows (never from the client), with the person's row in
//     the organisation's directory, and is safe to run twice: a row already applied is skipped;
//   - repairInvitations, on every GET /me, finishes what an accept left: grants not applied (the app write failed
//     after the membership was made), and an invitation marked accepted with no membership at all (Better Auth's
//     own undo after a failed membership write failed too). A membership is made again only when the person was
//     never in the organisation's directory: one who was removed after accepting is never brought back.
import type { Database } from "../../db/pools.ts";
import type { Invitation } from "../../db/identity.ts";
import type { Tenant } from "../../db/tenant.ts";

export type Person = { id: string; name: string; email: string };

/** A name as the directory keeps it (app.person.display_name: 1 to 200 characters): trimmed and cut, or the email's
 * local part for a name with nothing in it. Sign-up refuses such names (auth.ts); this covers older accounts. */
export function displayName(name: string, email: string): string {
  const trimmed = [...name.trim()].slice(0, 200).join("");
  return trimmed !== "" ? trimmed : [...(email.split("@")[0] || "person")].slice(0, 200).join("");
}

function tenantOf(orgId: string, userId: string, requestId: string): Tenant {
  return { orgId, userId, pubIds: [], requestId };
}

/**
 * Applies the invitation's grants that are not applied yet; returns the publications they reach. `rejoin`: an accept
 * makes a removed person active again; a repair does not.
 */
export async function applyInvitation(
  database: Database,
  invitation: Pick<Invitation, "id" | "orgId">,
  person: Person,
  requestId: string,
  rejoin: boolean,
): Promise<string[]> {
  return database.withTenant(tenantOf(invitation.orgId, person.id, requestId), async (tx) => {
    const name = displayName(person.name, person.email);
    const row = { org_id: invitation.orgId, user_id: person.id, display_name: name, email: person.email };
    await tx
      .insertInto("app.person")
      .values(row)
      .onConflict((conflict) =>
        rejoin
          ? conflict
              .columns(["org_id", "user_id"])
              .doUpdateSet({ status: "active", removed_at: null, display_name: name, email: person.email })
          : conflict.columns(["org_id", "user_id"]).doNothing(),
      )
      .execute();
    const pending = await tx
      .selectFrom("app.invitation_grant")
      .select(["publication_id", "roles", "grants"])
      .where("invitation_id", "=", invitation.id)
      .where("applied_at", "is", null)
      .execute();
    for (const grant of pending) {
      await tx
        .insertInto("app.publication_grant")
        .values({
          org_id: invitation.orgId,
          publication_id: grant.publication_id,
          user_id: person.id,
          roles: grant.roles,
          grants: grant.grants,
        })
        .onConflict((conflict) =>
          conflict
            .columns(["org_id", "publication_id", "user_id"])
            .doUpdateSet({ roles: grant.roles, grants: grant.grants, updated_at: new Date() }),
        )
        .execute();
    }
    if (pending.length > 0) {
      await tx
        .updateTable("app.invitation_grant")
        .set({ applied_at: new Date() })
        .where("invitation_id", "=", invitation.id)
        .where("applied_at", "is", null)
        .execute();
    }
    const all = await tx
      .selectFrom("app.invitation_grant")
      .select("publication_id")
      .where("invitation_id", "=", invitation.id)
      .execute();
    return all.map((grant) => grant.publication_id);
  });
}

/** Finishes every accepted invitation of this person that an accept left half done. */
export async function repairInvitations(database: Database, person: Person, requestId: string): Promise<void> {
  for (const invitation of await database.identity.acceptedInvitations(person.email)) {
    const tenant = tenantOf(invitation.orgId, person.id, requestId);
    const member = await database.identity.membership(invitation.orgId, person.id);
    if (!member) {
      const known = await database.withTenant(tenant, (tx) =>
        tx.selectFrom("app.person").select("status").where("user_id", "=", person.id).executeTakeFirst(),
      );
      if (known) continue; // they were in the directory: removed since, never brought back
      if (await database.identity.addMember(invitation.orgId, person.id, invitation.role)) {
        await audit(database, tenant, "invitation.membership_repaired", invitation.id);
      }
    }
    const pending = await database.withTenant(tenant, (tx) =>
      tx
        .selectFrom("app.invitation_grant")
        .select("publication_id")
        .where("invitation_id", "=", invitation.id)
        .where("applied_at", "is", null)
        .execute(),
    );
    const directory = await database.withTenant(tenant, (tx) =>
      tx.selectFrom("app.person").select("status").where("user_id", "=", person.id).executeTakeFirst(),
    );
    if (pending.length === 0 && directory) continue;
    await applyInvitation(database, invitation, person, requestId, false);
    await audit(database, tenant, "invitation.grants_repaired", invitation.id);
  }
}

export async function audit(
  database: Database,
  tenant: Tenant,
  action: string,
  targetId: string,
  data: Record<string, unknown> = {},
  targetType = "invitation",
): Promise<void> {
  await database.withTenant(tenant, (tx) =>
    tx
      .insertInto("app.audit_event")
      .values({
        org_id: tenant.orgId,
        actor_kind: "user",
        actor_id: tenant.userId,
        action,
        target_type: targetType,
        target_id: targetId,
        data: JSON.stringify(data),
        request_id: tenant.requestId,
      })
      .execute(),
  );
}
