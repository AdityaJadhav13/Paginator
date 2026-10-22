// Idempotency keys in the database (docs/product/10-l2-newsroom-plan.md §5.1; src/modules/requests/idempotency.ts).
// The key is claimed in the request's own transaction, so its work and its stored answer commit together or not at
// all: a request is never run twice, and a request that dies leaves no claim behind. A second request with the same
// key waits for the first's transaction up to CLAIM_WAIT, then gives up (the caller answers request_in_progress).
import { sql } from "kysely";
import type { Tx } from "./tenant.ts";

/** How long a request waits for another one holding its key. */
export const CLAIM_WAIT = "3s";

export type KeyRow = { org_id: string; user_id: string; key: string; route: string; request_sha256: string };
export type Stored = {
  route: string;
  request_sha256: string;
  status: string;
  response_status: number | null;
  response: unknown;
};

/** Claims the key for this transaction; null when it is claimed now, or the row another request left. */
export async function claimKey(tx: Tx, row: KeyRow): Promise<Stored | null> {
  await sql`set local lock_timeout = ${sql.lit(CLAIM_WAIT)}`.execute(tx);
  await tx
    .deleteFrom("app.idempotency_key")
    .where("key", "=", row.key)
    .where("expires_at", "<=", sql<Date>`now()`)
    .execute();
  const claimed = await tx
    .insertInto("app.idempotency_key")
    .values(row)
    .onConflict((conflict) => conflict.columns(["org_id", "user_id", "key"]).doNothing())
    .returning("key")
    .executeTakeFirst();
  await sql`set local lock_timeout to default`.execute(tx);
  if (claimed) return null;
  const found = await tx
    .selectFrom("app.idempotency_key")
    .select(["route", "request_sha256", "status", "response_status", "response"])
    .where("key", "=", row.key)
    .executeTakeFirst();
  return found ?? { route: "", request_sha256: "", status: "gone", response_status: null, response: null };
}

/** Stores the answer of the request that claimed the key; false when the claim is no longer this request's. */
export async function finishKey(tx: Tx, key: string, sha: string, status: number, response: unknown): Promise<boolean> {
  const done = await tx
    .updateTable("app.idempotency_key")
    .set({ status: "done", response_status: status, response: JSON.stringify(response) })
    .where("key", "=", key)
    .where("status", "=", "running")
    .where("request_sha256", "=", sha)
    .returning("key")
    .executeTakeFirst();
  return done !== undefined;
}
