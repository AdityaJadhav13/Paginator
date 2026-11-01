// The queue's Report (plan §2.2 step 3): each event goes to the API's inbox, app.engine_event, on the queue's own pool
// (as pgn_engine, which may only insert there), with the queue's job id as its unique key: a job reports one event, so a
// repeat (a job run again after its report, when finishing it was lost) is dropped. The NOTIFY that wakes the API's
// consumer goes in the same statement; the consumer also polls, so a lost wake-up only delays.
import type { Report } from "./tasks.ts";

export const INBOX_CHANNEL = "engine_events";

const INSERT = `with added as (
  insert into app.engine_event (org_id, job_id, kind, asset_id, payload) values ($1, $2, $3, $4, $5)
  on conflict do nothing
) select pg_notify('${INBOX_CHANNEL}', $2)`;

export const reportToInbox: Report = async (event, jobId, helpers) => {
  const asset = event.kind === "job.failed" ? event.target_id : event.asset_id;
  await helpers.withPgClient((client) =>
    client.query(INSERT, [event.org_id, jobId, event.kind, asset, JSON.stringify(event)]),
  );
};
