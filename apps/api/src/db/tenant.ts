// withTenant (docs/product/10-l2-newsroom-plan.md §3.2): one transaction as one user of one organisation. Its first
// statement sets the context that the row-level security policies read through app.current_org(),
// app.current_user() and app.current_pubs(). Each setting is local to the transaction (set_config's third argument),
// so a pooled connection carries nothing over to the next transaction; a query outside withTenant sees no rows.
// After a failed statement Postgres refuses every statement but ROLLBACK, and turns COMMIT into ROLLBACK, so withTenant
// rejects when fn caught such an error and returned (TransactionAbortedError). To recover from an expected failure
// inside fn, run the statement in a savepoint: sql`savepoint s`, then sql`rollback to savepoint s` on failure.
import { type Kysely, type Transaction, sql } from "kysely";
import type { DB } from "./schema.gen.ts";

declare const madeByWithTenant: unique symbol;
/** A transaction made by withTenant. Repositories accept only this, never the pool, so no query runs without the
 * tenant's context. */
export type Tx = Transaction<DB> & { readonly [madeByWithTenant]: true };

export type Tenant = {
  orgId: string;
  userId: string;
  /** The publications this user may reach in this organisation: every one for Owner and Admin (plan §3.2). */
  pubIds: readonly string[];
  /** The request's id, recorded with audit events. */
  requestId: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** The tenant is not well formed; nothing was sent to the database. */
export class TenantError extends Error {}

/** fn returned, but its transaction had already failed (fn caught the error): nothing it wrote was saved. */
export class TransactionAbortedError extends Error {}

/** The names of the fields that are not well formed (never their values: they may come from a request). */
function malformed(tenant: Tenant): string[] {
  return [
    UUID.test(tenant.orgId) ? "" : "orgId",
    UUID.test(tenant.userId) ? "" : "userId",
    Array.isArray(tenant.pubIds) && tenant.pubIds.every((id) => UUID.test(id)) ? "" : "pubIds",
    REQUEST_ID.test(tenant.requestId) ? "" : "requestId",
  ].filter((name) => name !== "");
}

export async function withTenant<T>(db: Kysely<DB>, tenant: Tenant, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const bad = malformed(tenant);
  if (bad.length > 0) throw new TenantError(`withTenant was given a malformed ${bad.join(", ")}`);
  // Every id is a checked UUID, so the array literal cannot carry anything else.
  const pubIds = `{${tenant.pubIds.join(",")}}`;
  return db.transaction().execute(async (trx) => {
    await sql`select set_config('app.org_id', ${tenant.orgId}, true), set_config('app.user_id', ${tenant.userId}, true),
      set_config('app.pub_ids', ${pubIds}, true), set_config('app.request_id', ${tenant.requestId}, true)`.execute(trx);
    const result = await fn(trx as Tx);
    try {
      await sql`select 1`.execute(trx); // fails with 25P02 when the transaction has failed
    } catch (error) {
      if ((error as { code?: unknown }).code !== "25P02") throw error;
      const message = "A statement inside withTenant failed and fn went on, so the transaction saved nothing";
      throw new TransactionAbortedError(message, { cause: error });
    }
    return result;
  });
}
