// Idempotency keys (docs/product/10-l2-newsroom-plan.md §5.1): a create or a transition carries an Idempotency-Key (a
// UUID), so a phone can retry "Send to desk" safely. app.idempotency_key keeps one row per organisation, user and key
// for 24 hours, under the organisation wall and the user's own wall (src/db/idempotency.ts):
//   - the key is claimed, the work done and its answer stored in ONE transaction: they commit together, or nothing
//     does, so a request runs at most once, and a failed request can be sent again;
//   - the same key with the same request (method, route, path parameters and body) replays the stored answer;
//   - with another request it answers 422 idempotency_key_reused; while the first is still running, a second waits up
//     to CLAIM_WAIT for it, then answers 409 request_in_progress.
// A replay passes the route's access check again (it is a request like any other), and the route rebuilds what it
// shows (replay): a person who lost sight of a story gets 404, not its old text.
import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { claimKey, finishKey } from "../../db/idempotency.ts";
import type { Database } from "../../db/pools.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A route's answer, and what is kept for a replay (the answer itself unless the route keeps less). */
export type Answer = { status: number; body: unknown; stored?: unknown };

/** JSON with every object's keys sorted, so that the same request always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function requestKey(request: FastifyRequest): string {
  const value = request.headers["idempotency-key"];
  const key = Array.isArray(value) ? undefined : value;
  if (!key || !UUID.test(key)) {
    throw new ApiError("invalid_request", [
      { field: "headers.idempotency-key", message: "Send a new UUID with each change, and the same one to retry it." },
    ]);
  }
  return key.toLowerCase();
}

export async function idempotent(
  database: Database,
  request: FastifyRequest,
  tenant: Tenant,
  run: (tx: Tx) => Promise<Answer>,
  /** The answer to show again from what was stored, or null when the person may no longer see it. */
  replay: (stored: unknown, tx: Tx) => Promise<unknown>,
): Promise<{ status: number; body: unknown }> {
  const key = requestKey(request);
  const route = `${request.method} ${request.routeOptions.url ?? ""}`.slice(0, 200);
  const sha = createHash("sha256")
    .update(canonical({ params: request.params, body: request.body ?? null }))
    .digest("hex");
  try {
    return await database.withTenant(tenant, async (tx) => {
      const stored = await claimKey(tx, {
        org_id: tenant.orgId,
        user_id: tenant.userId,
        key,
        route,
        request_sha256: sha,
      });
      if (stored) {
        if (stored.route !== route || stored.request_sha256 !== sha) throw new ApiError("idempotency_key_reused");
        if (stored.status !== "done") throw new ApiError("request_in_progress");
        const body = await replay(stored.response, tx);
        if (body === null) throw new ApiError("not_found");
        return { status: stored.response_status ?? 200, body };
      }
      const answer = await run(tx);
      if (!(await finishKey(tx, key, sha, answer.status, answer.stored ?? answer.body))) {
        throw new ApiError("request_in_progress");
      }
      return { status: answer.status, body: answer.body };
    });
  } catch (error) {
    // another request holds the key longer than CLAIM_WAIT (lock_not_available)
    if ((error as { code?: unknown }).code === "55P03") throw new ApiError("request_in_progress");
    throw error;
  }
}
