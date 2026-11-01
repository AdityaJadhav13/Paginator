// Reading the audit log (docs/product/10-l2-newsroom-plan.md §5.2; GET /api/v1/orgs/:o/audit):
//   - the list is newest first within an organisation (audit_event_by_org, migration 2026_11_01_0002); filtering by
//     who acted ("what did this person do?") and by publication (a Chief Editor's view, and the `publication` filter)
//     get an index each, so neither scans the organisation's whole log;
//   - a read wall: a transaction reads only the events of the publications it reaches (app.current_pubs()) and the
//     organisation's own (no publication), as a restrictive policy beside the organisation wall. Owner and Admin reach
//     every publication, so they read everything; a Chief Editor's narrower view (their publications, and no
//     organisation-level action) is the API's, in src/db/audit.ts. It is for reading only: each writer names the
//     publication its route was checked for, and org.bootstrap names the first publication before anyone reaches it.
import { type Kysely, sql } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    create index audit_event_by_actor on app.audit_event (org_id, actor_id, at desc);
    create index audit_event_by_publication on app.audit_event (org_id, publication_id, at desc);
    create policy pub_read_wall on app.audit_event as restrictive for select
      using (publication_id is null or publication_id = any ((select app.current_pubs())::uuid[]));
  `.execute(db);
}
