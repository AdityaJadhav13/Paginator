// A new paper's applications in the database (identity.paper_application, migration 2026_12_07_0002), on the auth pool
// (pgn_auth): no organisation's connection can read them. The token is kept only as its SHA-256.
import { createHash, randomBytes } from "node:crypto";
import type { Pool } from "pg";

/** How long a confirmation link works. */
export const CONFIRM_TTL_MS = 24 * 3_600_000;

export type ApplicationState = "unconfirmed" | "waiting" | "approved" | "refused";
export type Application = {
  id: string;
  paperName: string;
  ownerName: string;
  email: string;
  language: "en" | "mr";
  state: ApplicationState;
  createdAt: Date;
  confirmedAt: Date | null;
  decidedBy: string | null;
  decidedAt: Date | null;
  reason: string | null;
  orgId: string | null;
};

const COLUMNS = `id, paper_name as "paperName", owner_name as "ownerName", email, language, state,
  created_at as "createdAt", confirmed_at as "confirmedAt", decided_by as "decidedBy", decided_at as "decidedAt",
  reason, org_id as "orgId"`;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export type ApplicationInput = { paperName: string; ownerName: string; email: string; language: "en" | "mr" };

export function signupStore(pool: Pool) {
  return {
    /** Keeps an application and returns the token to email; null when this address has one open already (its link
     * still works, or it waits for approval): nothing is sent then. An unconfirmed one whose link expired starts
     * again with the new details. */
    async apply(input: ApplicationInput): Promise<string | null> {
      const token = newToken();
      const values = [input.paperName, input.ownerName, input.email.toLowerCase(), input.language, hashToken(token)];
      const ttl = `${CONFIRM_TTL_MS} milliseconds`;
      const renewed = await pool.query(
        `update identity.paper_application set paper_name = $1, owner_name = $2, language = $4, token_hash = $5,
           token_expires_at = now() + $6::interval, created_at = now()
         where email = $3 and state = 'unconfirmed' and token_expires_at <= now()`,
        [...values, ttl],
      );
      if (renewed.rowCount === 1) return token;
      const made = await pool.query(
        `insert into identity.paper_application (paper_name, owner_name, email, language, token_hash, token_expires_at)
         values ($1, $2, $3, $4, $5, now() + $6::interval)
         on conflict (email) where state in ('unconfirmed', 'waiting') do nothing`,
        [...values, ttl],
      );
      return made.rowCount === 1 ? token : null;
    },

    /** Confirms the address of the application this token belongs to, once, before it expires: it then waits for
     * approval. Null for a token unknown, used or expired. */
    async confirm(token: string): Promise<Application | null> {
      const { rows } = await pool.query<Application>(
        `update identity.paper_application set state = 'waiting', confirmed_at = now(), token_hash = null
         where token_hash = $1 and state = 'unconfirmed' and token_expires_at > now() returning ${COLUMNS}`,
        [hashToken(token)],
      );
      return rows[0] ?? null;
    },

    /** The applications in these states, oldest first. */
    async list(states: readonly ApplicationState[]): Promise<Application[]> {
      const { rows } = await pool.query<Application>(
        `select ${COLUMNS} from identity.paper_application where state = any ($1) order by created_at, id`,
        [states],
      );
      return rows;
    },

    async get(id: string): Promise<Application | null> {
      const { rows } = await pool.query<Application>(
        `select ${COLUMNS} from identity.paper_application where id = $1::uuid`,
        [id],
      );
      return rows[0] ?? null;
    },

    /** Records the operator's decision on a waiting application; null when it is not waiting (any more). */
    async decide(
      id: string,
      by: string,
      decision: { state: "approved"; orgId: string } | { state: "refused"; reason: string | null },
    ): Promise<Application | null> {
      const { rows } = await pool.query<Application>(
        `update identity.paper_application set state = $3, decided_by = $2, decided_at = now(), org_id = $4,
           reason = $5
         where id = $1::uuid and state = 'waiting' returning ${COLUMNS}`,
        [
          id,
          by,
          decision.state,
          decision.state === "approved" ? decision.orgId : null,
          decision.state === "refused" ? decision.reason : null,
        ],
      );
      return rows[0] ?? null;
    },
  };
}

export type SignupStore = ReturnType<typeof signupStore>;
