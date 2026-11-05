// Making an accepted invitation's grants real (docs/product/10-l2-newsroom-plan.md §4.3), and repairing those left
// half made. Better Auth's accept claims the invitation (pending → accepted) and makes the membership in identity;
// the grants live in app, on another pool, so they cannot be written in the same transaction:
//   - applyInvitation writes them from OUR invitation_grant rows (never from the client), with the person's row in
//     the organisation's directory, and is safe to run twice: a row already applied is skipped;
//   - repairInvitations, on every GET /me, finishes what an accept left: grants not applied (the app write failed
//     after the membership was made), and an invitation marked accepted with no membership at all (Better Auth's
//     own undo after a failed membership write failed too). A membership is made again only when the person was
//     never in the organisation's directory: one who was removed after accepting is never brought back.
import type { AuditAction } from "@pageinator/contracts";
import type { Database } from "../../db/pools.ts";
import type { Invitation } from "../../db/identity.ts";
import { recordAudit } from "../../db/audit.ts";
import type { Client, Tenant, Tx } from "../../db/tenant.ts";

export type Person = { id: string; name: string; email: string };

/** A name as the directory keeps it (app.person.display_name: 1 to 200 characters): trimmed and cut, or the email's
 * local part for a name with nothing in it. Sign-up refuses such names (auth.ts); this covers older accounts. */
export function displayName(name: string, email: string): string {
  const trimmed = [...name.trim()].slice(0, 200).join("");
  return trimmed !== "" ? trimmed : [...(email.split("@")[0] || "person")].slice(0, 200).join("");
}

function tenantOf(orgId: string, userId: string, requestId: string, client?: Client): Tenant {
  return { orgId, userId, pubIds: [], requestId, ...(client ? { client } : {}) };
}

/**
 * Applies the invitation's grants that are not applied yet; returns the publications they reach. `rejoin`: an accept
 * makes a removed person active again; a repair does not.
 */
export async function applyInvitation(
  database: Database,
  invitation: Pick<Invitation, "id" | "orgId">,
  person: Person,
  who: { requestId: string; client?: Client },
  rejoin: boolean,
  /** More to write in the same transaction (the accept's notice and event, a repair's event), given the publications
   * the invitation reaches and whether this call wrote anything (a directory row or a grant): all of it is saved, or
   * none. */
  also?: (tx: Tx, tenant: Tenant, publications: string[], changed: boolean) => Promise<void>,
): Promise<string[]> {
  const tenant = tenantOf(invitation.orgId, person.id, who.requestId, who.client);
  return database.withTenant(tenant, async (tx) => {
    const name = displayName(person.name, person.email);
    const row = { org_id: invitation.orgId, user_id: person.id, display_name: name, email: person.email };
    const written = await tx
      .insertInto("app.person")
      .values(row)
      .onConflict((conflict) =>
        rejoin
          ? conflict
              .columns(["org_id", "user_id"])
              .doUpdateSet({ status: "active", removed_at: null, display_name: name, email: person.email })
          : conflict.columns(["org_id", "user_id"]).doNothing(),
      )
      .returning("user_id")
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
    // what this call really wrote: an accept and a repair running together (a GET /me during the accept) both see the
    // grants pending, but only the first marks them applied; the other's insert and update wait for it and touch nothing
    let marked = 0n;
    if (pending.length > 0) {
      const [result] = await tx
        .updateTable("app.invitation_grant")
        .set({ applied_at: new Date() })
        .where("invitation_id", "=", invitation.id)
        .where("applied_at", "is", null)
        .execute();
      marked = result?.numUpdatedRows ?? 0n;
    }
    const all = await tx
      .selectFrom("app.invitation_grant")
      .select("publication_id")
      .where("invitation_id", "=", invitation.id)
      .execute();
    const publications = all.map((grant) => grant.publication_id);
    if (also) await also(tx, tenant, publications, written.length > 0 || marked > 0n);
    return publications;
  });
}

/** Finishes every accepted invitation of this person that an accept left half done. */
export async function repairInvitations(
  database: Database,
  person: Person,
  requestId: string,
  client?: Client,
): Promise<void> {
  for (const invitation of await database.identity.acceptedInvitations(person.email)) {
    const tenant = tenantOf(invitation.orgId, person.id, requestId, client);
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
    await applyInvitation(
      database,
      invitation,
      person,
      { requestId, ...(client ? { client } : {}) },
      false,
      async (tx, t, _publications, changed) => {
        // logged only when the repair really wrote something, not when an accept running beside it had done it all
        if (changed) {
          await recordAudit(tx, t, {
            action: "invitation.grants_repaired",
            targetType: "invitation",
            targetId: invitation.id,
          });
        }
      },
    );
  }
}

export async function audit(
  database: Database,
  tenant: Tenant,
  action: AuditAction,
  targetId: string,
  data: Record<string, unknown> = {},
  targetType = "invitation",
): Promise<void> {
  await database.withTenant(tenant, (tx) => recordAudit(tx, tenant, { action, targetType, targetId, data }));
}
