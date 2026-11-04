// The layout jobs' enqueues and cancel (L2.3; plan §2.2), made by the API's migration 2026_12_02_0001 as APP_ENQUEUE
// is: SECURITY DEFINER, pgn_app's only, only for app.current_org(). The API builds each payload and checks it with its
// contract (EngineSetupPayload, EngineMeasurePayload, EngineLayoutPayload, MediaAdPayload) first; the wrapper checks
// again that it names the caller's organisation. Owned by the API part of L2.3.
//   - engine.setup: queue engine-cpu, job key profile:<id>, 2 attempts;
//   - engine.measure: queue engine-cpu, job key measure:<edition> (a newer snapshot replaces a waiting one), 8 s after
//     the last change, 1 attempt, after any layout (priority 10);
//   - engine.layout: queue engine-cpu, job key run:<run>, 1 attempt (never retried), first (priority 0);
//   - media.ad: no named queue, job key ad:<artwork>, MAX_ATTEMPTS.
// engine-cpu is one Graphile named queue: one of its jobs runs at a time (the Desk's rule: one layout at a time, never a
// measure during a layout).
// app.cancel_engine_job(org, key): removes a run's or a measure's job when no worker holds it (queue.remove_job; a held
// one only loses its key and its retries), and always tells the queue (NOTIFY engine_cancel, the key), which stops a
// running one. 'measure:*' only tells (every running measure stops: a layout comes first). The API checks, under the
// organisation's walls, that the run or the edition the key names is the caller's before it calls this.
import { MAX_ATTEMPTS } from "./queue.ts";

// `target`: the table and the payload field naming the row the job is for, which must be the caller's organisation's
// (a definer function skips the walls: without this an organisation could take or replace another's job key).
const wrapper = (name: string, target: [string, string], addJob: string) => `
create function app.${name}(org_id uuid, payload jsonb)
returns bigint language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if org_id is null or org_id is distinct from app.current_org() or payload->>'org_id' is distinct from org_id::text
      or not exists (select 1 from app.${target[0]} t
                     where t.org_id = ${name}.org_id and t.id = (payload->>'${target[1]}')::uuid) then
    raise exception 'a job for another organisation' using errcode = 'insufficient_privilege';
  end if;
  return (${addJob}).id;
end
$$;
revoke execute on function app.${name}(uuid, jsonb) from public;
grant execute on function app.${name}(uuid, jsonb) to pgn_app;
`;

export const APP_ENQUEUE_LAYOUT = `
${wrapper(
  "enqueue_engine_setup",
  ["engine_profile", "profile_id"],
  `queue.add_job('engine.setup', payload::json, queue_name => 'engine-cpu', max_attempts => 2,
    job_key => 'profile:' || (payload->>'profile_id'), priority => 0)`,
)}
${wrapper(
  "enqueue_engine_measure",
  ["edition", "edition_id"],
  `queue.add_job('engine.measure', payload::json, queue_name => 'engine-cpu', run_at => now() + interval '8 seconds',
    max_attempts => 1, job_key => 'measure:' || (payload->>'edition_id'), priority => 10, job_key_mode => 'replace')`,
)}
${wrapper(
  "enqueue_engine_layout",
  ["layout_run", "run_id"],
  `queue.add_job('engine.layout', payload::json, queue_name => 'engine-cpu', max_attempts => 1,
    job_key => 'run:' || (payload->>'run_id'), priority => 0)`,
)}
${wrapper(
  "enqueue_media_ad",
  ["ad_slot_artwork", "artwork_id"],
  `queue.add_job('media.ad', payload::json, max_attempts => ${MAX_ATTEMPTS}, job_key => 'ad:' || (payload->>'artwork_id'))`,
)}
create function app.cancel_engine_job(org_id uuid, job_key text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if org_id is null or org_id is distinct from app.current_org() then
    raise exception 'a job for another organisation' using errcode = 'insufficient_privilege';
  end if;
  if job_key is null or (job_key <> 'measure:*'
      and job_key !~ '^(run|measure):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'not a run''s or a measure''s job key' using errcode = 'invalid_parameter_value';
  end if;
  -- the run or the edition the key names must be the caller's: a definer function skips the walls
  if job_key like 'run:%' then
    if not exists (select 1 from app.layout_run t
                   where t.org_id = cancel_engine_job.org_id and t.id = substr(job_key, 5)::uuid) then
      raise exception 'a job for another organisation' using errcode = 'insufficient_privilege';
    end if;
  elsif job_key <> 'measure:*' then
    if not exists (select 1 from app.edition t
                   where t.org_id = cancel_engine_job.org_id and t.id = substr(job_key, 9)::uuid) then
      raise exception 'a job for another organisation' using errcode = 'insufficient_privilege';
    end if;
  end if;
  if job_key <> 'measure:*' then
    perform queue.remove_job(job_key);
  end if;
  perform pg_notify('engine_cancel', job_key);
end
$$;
revoke execute on function app.cancel_engine_job(uuid, text) from public;
grant execute on function app.cancel_engine_job(uuid, text) to pgn_app;
`;
