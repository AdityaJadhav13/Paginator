// The per-email sign-in lock reserves each attempt before its password is checked (src/modules/identity/sign-in-guard.ts):
// identity.sign_in_failure counts the attempts still being checked beside the wrong passwords. A new migration, not a
// change to 0003, because development databases already hold 0003.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    alter table identity.sign_in_failure add column checking integer not null default 0 check (checking >= 0);
    alter table identity.sign_in_failure alter column checking drop default;
  `.execute(db);
}
