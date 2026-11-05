// The tenancy proof's checks (docs/product/10-l2-newsroom-plan.md §4.8): (a) the catalog meta-test and (b) the
// cross-tenant generator. Each lists the problems it finds instead of failing at the first, so the planted-defect tests
// can show that every check catches what it is for. Both read the catalog, so a new table is checked without anyone
// adding it here: (a) then asks for its rights to be listed below, and (b) for a fixture (test/db/fixtures.ts).
import type { Client } from "pg";
import { FIXTURES, type Fixture, ORG_A, ORG_B, type Org, insertion, seed } from "../db/fixtures.ts";
import type { TestDatabase } from "../db/helpers.ts";

/** The organisation wall and the publication wall, as Postgres prints them. (The plan's §3.2 spelling of the second,
 * `any ((select app.current_pubs()))`, reads as a subquery of uuid[] rows and fails; the cast makes it an array.) */
export const ORG_WALL = "(org_id = ( SELECT app.current_org() AS current_org))";
export const PUB_WALL = "(publication_id = ANY (( SELECT app.current_pubs() AS current_pubs)::uuid[]))";

/** App tables with a publication_id column that only the organisation wall guards, each with its reason. Every other
 * app table with a publication_id column, nullable or not, is a content table and needs the publication wall. */
export const ORG_ONLY: Readonly<Record<string, string>> = {
  audit_event:
    "the organisation's own log: its rows without a publication are read by the organisation's people; a restrictive " +
    "read wall (pub_read_wall, migration 2026_11_26_0001) hides other publications' events",
  publication_grant: "read to work out which publications a user may reach (plan §3.2)",
  invitation_grant: "read with an invitation, before its person may reach any publication (plan §3.2)",
};
const isContent = (table: { name: string; pub: boolean }) => table.pub && !Object.hasOwn(ORG_ONLY, table.name);

/** pgn_app's rights on each app table. A table missing here is a problem: its rights must be decided. */
export const APP_RIGHTS: Readonly<Record<string, readonly string[]>> = {
  audit_event: ["INSERT", "SELECT"],
  invitation_grant: ["INSERT", "SELECT", "UPDATE"],
  org_settings: ["INSERT", "SELECT", "UPDATE"],
  person: ["INSERT", "SELECT", "UPDATE"],
  publication: ["INSERT", "SELECT", "UPDATE"],
  // the content tables (migrations 2026_11_20_*): only a story's photo is ever deleted, and status changes and
  // bundles only grow; closed revisions refuse every change by trigger
  comment: ["INSERT", "SELECT", "UPDATE"],
  desk_bundle: ["INSERT", "SELECT"],
  desk_bundle_revision: ["INSERT", "SELECT"],
  edition: ["INSERT", "SELECT", "UPDATE"],
  idempotency_key: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  section: ["INSERT", "SELECT", "UPDATE"],
  story: ["INSERT", "SELECT", "UPDATE"],
  story_photo: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  story_revision: ["INSERT", "SELECT", "UPDATE"],
  story_status_change: ["INSERT", "SELECT"],
  // photo originals (migration 2026_11_23_0001): an asset is soft-deleted, an upload only changes state
  asset: ["INSERT", "SELECT", "UPDATE"],
  upload: ["INSERT", "SELECT", "UPDATE"],
  upload_quota: ["INSERT", "SELECT", "UPDATE"],
  // Word imports (migration 2026_11_30_0001): an import only changes state, never removed
  import_job: ["INSERT", "SELECT", "UPDATE"],
  // the news finder (migration 2026_12_01_0001): sources are removed, and items and topics purged after three days;
  // drafts only change state, and the AI spend only grows
  news_settings: ["INSERT", "SELECT", "UPDATE"],
  news_source: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  news_topic: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  news_item: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  news_draft_job: ["INSERT", "SELECT", "UPDATE"],
  ai_usage: ["INSERT", "SELECT"],
  // hosted layout (migration 2026_12_02_0001): profiles and runs only change state, pages are rewritten while their
  // run goes on, a check's verdict is never changed, and an ad slot's artwork is replaced and removed
  engine_profile: ["INSERT", "SELECT", "UPDATE"],
  layout_run: ["INSERT", "SELECT", "UPDATE"],
  run_page: ["INSERT", "SELECT", "UPDATE"],
  edition_measure: ["INSERT", "SELECT", "UPDATE"],
  pdf_check: ["INSERT", "SELECT"],
  ad_slot_artwork: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  // the page editor (migration 2026_12_03_0001): revisions and saves only grow, the text overrides are rewritten, and
  // a page's soft lock is taken, beaten, handed over and released
  page_edit: ["INSERT", "SELECT"],
  page_save: ["INSERT", "SELECT"],
  run_text_override: ["INSERT", "SELECT", "UPDATE"],
  page_lock: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  // release (migration 2026_12_04_0001): approvals, releases, their files and deliveries are only added (an unlock, an
  // archive check and the press's confirmation are column grants, COLUMN_RIGHTS); the press test is rewritten
  page_approval: ["INSERT", "SELECT"],
  release: ["INSERT", "SELECT"],
  release_file: ["INSERT", "SELECT"],
  delivery: ["INSERT", "SELECT"],
  press_test: ["INSERT", "SELECT", "UPDATE"],
  // the ads cut-off (migration 2026_12_05_0002): the settings are rewritten; an alert is only added
  ad_settings: ["INSERT", "SELECT", "UPDATE"],
  ad_cutoff_alert: ["INSERT", "SELECT"],
  // the sidebar screens (migration 2026_12_06_0001): the edition defaults are rewritten; a print profile only added
  edition_defaults: ["INSERT", "SELECT", "UPDATE"],
  print_profile: ["INSERT", "SELECT"],
  // onboarding a new paper (migration 2026_12_07_0001): an onboarding only changes state, never removed
  paper_onboarding: ["INSERT", "SELECT", "UPDATE"],
  // the ads desk (migration 2026_12_05_0001): advertisers are archived and bookings cancelled, never removed; a
  // placement is taken out; a plan page is rewritten
  advertiser: ["INSERT", "SELECT", "UPDATE"],
  ad_booking: ["INSERT", "SELECT", "UPDATE"],
  ad_placement: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  flatplan_page: ["INSERT", "SELECT", "UPDATE"],
  // notifications (migration 2026_11_24_0001): never deleted; only read_at and emailed_at change (COLUMN_RIGHTS)
  notification: ["INSERT", "SELECT"],
  publication_grant: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  // the engine (migration 2026_11_27_0001): renditions only grow; the inbox's rows are added (the sweep's) and marked
  // processed (COLUMN_RIGHTS), never removed
  rendition: ["INSERT", "SELECT"],
  engine_event: ["INSERT", "SELECT"],
};

/** pgn_engine's rights on app tables: only adding to the inbox (plan §3.1). */
export const ENGINE_APP_RIGHTS: Readonly<Record<string, readonly string[]>> = { engine_event: ["INSERT"] };

/** The rights on Graphile Worker's tables in schema queue (migration 2026_11_27_0001): pgn_engine's ENGINE_GRANTS
 * (apps/engine-queue), and pgn_app's for the sweep (read the jobs, remove a spent one). */
export const QUEUE_RIGHTS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  pgn_engine: {
    migrations: ["SELECT"],
    _private_jobs: ["DELETE", "SELECT", "UPDATE"],
    _private_job_queues: ["SELECT", "UPDATE"],
    _private_tasks: ["INSERT", "SELECT"],
    _private_known_crontabs: ["SELECT"],
  },
  pgn_app: { _private_jobs: ["DELETE", "SELECT"], _private_tasks: ["SELECT"] },
};

/** The queue's tables pgn_app reaches, for the sweep: job payloads are ids only, of every organisation by design (the
 * sweep writes each job's failure under its own organisation's wall). */
const QUEUE_REACH = ["queue._private_jobs", "queue._private_tasks"];

/** Permissive policies an app table may have beside its organisation wall, as `name role command` (command r select,
 * a insert): the engine's report, and the system reader's flag (plan §3.2). Any other widens the wall. */
export const OPENINGS: Readonly<Record<string, readonly string[]>> = {
  engine_event: ["engine_consumer pgn_app r", "engine_reports pgn_engine a"],
};

/** The SECURITY DEFINER functions there may be, each executable by pgn_app alone: the enqueue wrapper. */
export const DEFINERS = [
  "app.enqueue_media_ingest",
  "app.enqueue_docx_import",
  "app.enqueue_news_collect",
  "app.enqueue_news_draft",
  "app.enqueue_engine_setup",
  "app.enqueue_engine_measure",
  "app.enqueue_engine_layout",
  "app.enqueue_media_ad",
  "app.enqueue_engine_onboard",
  "app.cancel_engine_job",
];

/** The column-level grants allowed, as `schema.table role RIGHT (columns)`: any other is a problem. */
export const COLUMN_RIGHTS: readonly string[] = [
  "app.engine_event pgn_app UPDATE (outcome, processed_at, retry_at, tries)",
  "app.notification pgn_app UPDATE (emailed_at, read_at)",
  "app.page_approval pgn_app UPDATE (unlocked_at, unlocked_by)",
  "app.release pgn_app UPDATE (manifest_key, manifest_sha256, manifest_version_id, verified_at)",
  "app.delivery pgn_app UPDATE (confirm_note, confirmed_at, confirmed_by, press_person)",
];

/** pgn_auth's rights on each identity table: Better Auth's own (it reads and writes them as it needs), and ours,
 * with auth_event append-only. A table missing here is a problem. Identity tables have no row-level security: no other
 * role may use the schema at all (plan §3.1, ADR-025's identity zone). */
export const IDENTITY_RIGHTS: Readonly<Record<string, readonly string[]>> = {
  user: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  session: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  account: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  verification: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  rateLimit: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  organization: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  member: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  invitation: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  twoFactor: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  totp_used: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  auth_event: ["INSERT", "SELECT"],
  sign_in_failure: ["DELETE", "INSERT", "SELECT", "UPDATE"],
  // a new paper's application (migration 2026_12_07_0002): it changes state, never removed
  paper_application: ["INSERT", "SELECT", "UPDATE"],
};

/** The schemas each login role may use; none may create anything anywhere. */
export const SCHEMA_USAGE: Readonly<Record<string, readonly string[]>> = {
  pgn_migrator: [],
  pgn_app: ["app", "queue"],
  pgn_auth: ["identity"],
  pgn_engine: ["app", "queue"],
  pgn_listen: [],
};
const LOGINS = Object.keys(SCHEMA_USAGE);
const ROLES = ["pgn_owner", ...LOGINS];
/** Our schemas. Any other (Postgres's own pg_* and information_schema aside) is a problem, and every check below runs
 * over every schema, ours or not. */
const SCHEMAS = ["app", "identity", "queue", "migrations", "public"];
const USER_SCHEMA = "n.nspname !~ '^pg_' and n.nspname <> 'information_schema'";
/** The login roles, and PUBLIC (role OID 0 to the has_*_privilege functions). */
const GRANTEES = "(select oid, rolname from pg_roles where rolname = any ($1) union all select 0, 'public')";

/** The functions pgn_app may execute (in app); no other role may execute any function of ours. */
export const APP_FUNCTIONS = ["current_org", "current_pubs", "current_user"];

const RIGHTS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];

export type CatalogOptions = {
  rights?: Readonly<Record<string, readonly string[]>>;
  identityRights?: Readonly<Record<string, readonly string[]>>;
};

const same = (a: readonly string[], b: readonly string[]) => [...a].sort().join(",") === [...b].sort().join(",");

/** (a) Row-level security, roles, ownership and rights, read from the catalog (as the superuser). */
export async function catalogProblems(su: Client, options: CatalogOptions = {}): Promise<string[]> {
  const rights = options.rights ?? APP_RIGHTS;
  const identityRights = options.identityRights ?? IDENTITY_RIGHTS;
  const problems: string[] = [];
  const add = (problem: string) => problems.push(problem);

  // Schemas: only ours.
  const schemas = await su.query<{ name: string }>(
    `select nspname as name from pg_namespace n where ${USER_SCHEMA} order by 1`,
  );
  for (const { name } of schemas.rows) {
    if (!SCHEMAS.includes(name)) add(`schema ${name} is not one of ours (${SCHEMAS.join(", ")})`);
  }
  for (const schema of SCHEMAS) {
    if (!schemas.rows.some((row) => row.name === schema)) add(`schema ${schema} is missing`);
  }

  // Relations in app: only tables (and their indexes and sequences) belong there. A view or a materialized view would
  // need walls of its own.
  const relations = await su.query<{ name: string; kind: string }>(
    `select relname as name, relkind as kind from pg_class
     where relnamespace = 'app'::regnamespace and relkind not in ('r', 'p', 'i', 'I', 'S') order by 1`,
  );
  for (const { name, kind } of relations.rows) add(`app.${name} is a relation of kind ${kind}, not a table`);

  const tables = await su.query<{ name: string; rls: boolean; forced: boolean; org: boolean; pub: boolean }>(
    `select c.relname as name, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
       exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and a.attnotnull
               and a.atttypid = 'uuid'::regtype and not a.attisdropped) as org,
       exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'publication_id'
               and not a.attisdropped) as pub
     from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p') order by 1`,
  );
  const policies = await su.query<{
    table: string;
    name: string;
    permissive: boolean;
    all: boolean;
    to: string;
    using: string | null;
    check: string | null;
  }>(
    `select c.relname as table, p.polname as name, p.polpermissive as permissive,
       p.polcmd = '*' and p.polroles = '{0}' as all,
       p.polname || ' ' || array_to_string(array(select rolname from pg_roles where oid = any (p.polroles)), ',')
         || case when p.polroles = '{0}' then 'public' else '' end || ' ' || p.polcmd::text as to,
       pg_get_expr(p.polqual, p.polrelid) as using, pg_get_expr(p.polwithcheck, p.polrelid) as check
     from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'app'::regnamespace`,
  );
  const walls = (table: string, name: string, permissive: boolean, text: string) => {
    const policy = policies.rows.find((p) => p.table === table && p.name === name && p.permissive === permissive);
    return policy !== undefined && policy.all && policy.using === text && policy.check === text;
  };
  for (const table of tables.rows) {
    const t = `app.${table.name}`;
    if (!table.org) add(`${t} has no org_id column (uuid, not null)`);
    if (!table.rls) add(`${t}: row-level security is off`);
    else if (!table.forced) add(`${t}: row-level security is not forced, so its owner would pass the walls`);
    if (!walls(table.name, "org_wall", true, ORG_WALL)) add(`${t} lacks the organisation wall (policy org_wall)`);
    for (const p of policies.rows.filter((p) => p.table === table.name && p.permissive && p.name !== "org_wall")) {
      if (!(OPENINGS[table.name] ?? []).includes(p.to))
        add(`${t}: the permissive policy ${p.name} widens the organisation wall`);
    }
    if (isContent(table) && !walls(table.name, "pub_wall", false, PUB_WALL)) {
      add(`${t} is a content table without the publication wall (restrictive policy pub_wall)`);
    }
    if (rights[table.name] === undefined) add(`${t}: pgn_app's rights on it are not listed (test/tenancy/checks.ts)`);
  }

  // Rights on every relation of every schema: pgn_app holds exactly the listed rights on the app tables, and no login
  // role nor PUBLIC holds any other right on any table, view or sequence, column-level grants included.
  const held = await su.query<{ schema: string; name: string; kind: string; role: string; rights: string[] }>(
    `select n.nspname as schema, c.relname as name, c.relkind as kind, r.rolname::text as role,
       case when c.relkind = 'S'
         then array(select p from unnest(array['USAGE', 'SELECT', 'UPDATE']) p
                    where has_sequence_privilege(r.oid, c.oid, p))
         else array(select p from unnest($2::text[]) p where has_table_privilege(r.oid, c.oid, p)) end as rights
     from pg_class c join pg_namespace n on n.oid = c.relnamespace cross join ${GRANTEES} r
     where ${USER_SCHEMA} and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') order by 1, 2, 4`,
    [LOGINS, RIGHTS],
  );
  const listed = new Set<string>();
  for (const row of held.rows) {
    const table = row.kind === "r" || row.kind === "p";
    const zone =
      table && row.schema === "app" && row.role === "pgn_app"
        ? rights
        : table && row.schema === "app" && row.role === "pgn_engine"
          ? ENGINE_APP_RIGHTS
          : table && row.schema === "identity" && row.role === "pgn_auth"
            ? identityRights
            : table && row.schema === "queue"
              ? QUEUE_RIGHTS[row.role]
              : undefined;
    if (table && row.schema === "identity" && identityRights[row.name] === undefined && !listed.has(row.name)) {
      listed.add(row.name);
      add(`identity.${row.name}: pgn_auth's rights on it are not listed (test/tenancy/checks.ts)`);
    }
    const want = zone?.[row.name] ?? [];
    if (!same(row.rights, want)) {
      const has = row.rights.join(", ") || "no rights";
      add(`${row.schema}.${row.name}: ${row.role} has ${has}, not ${want.join(", ") || "none"}`);
    }
  }
  // column-level grants: exactly COLUMN_RIGHTS (pgn_app may change only a notification's read_at and emailed_at)
  const columnGrants = await su.query<{ grant: string }>(
    `select n.nspname || '.' || c.relname || ' ' || r.rolname::text || ' ' || x.privilege_type
         || ' (' || string_agg(a.attname, ', ' order by a.attname) || ')' as grant
     from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
     cross join lateral aclexplode(a.attacl) x
     join (select oid, rolname from pg_roles union all select 0, 'public') r on r.oid = x.grantee
     where ${USER_SCHEMA} and a.attnum > 0 and a.attacl is not null
     group by n.nspname, c.relname, r.rolname, x.privilege_type order by 1`,
  );
  const columns = columnGrants.rows.map((row) => row.grant);
  for (const grant of columns) if (!COLUMN_RIGHTS.includes(grant)) add(`${grant} is a column-level grant not listed`);
  for (const grant of COLUMN_RIGHTS) if (!columns.includes(grant)) add(`${grant} is missing`);

  // Roles: none can bypass anything; pgn_owner cannot sign in; the only membership is the migrator's SET ROLE.
  const roles = await su.query<{ name: string; login: boolean; unsafe: boolean }>(
    `select rolname as name, rolcanlogin as login,
       rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication as unsafe
     from pg_roles where rolname = any ($1) order by 1`,
    [ROLES],
  );
  for (const role of ROLES) {
    const found = roles.rows.find((r) => r.name === role);
    if (!found) add(`role ${role} is missing`);
    else {
      if (found.unsafe) add(`${role} is a superuser, or can bypass row-level security, create roles or databases`);
      if (found.login !== (role !== "pgn_owner")) add(`${role} ${found.login ? "can" : "cannot"} sign in`);
    }
  }
  const members = await su.query<{ grant: string }>(
    `select m.rolname || ' in ' || r.rolname || ' inherit ' || a.inherit_option || ' set ' || a.set_option
       || ' admin ' || a.admin_option as grant
     from pg_auth_members a join pg_roles r on r.oid = a.roleid join pg_roles m on m.oid = a.member
     where r.rolname = any ($1) or m.rolname = any ($1) order by 1`,
    [ROLES],
  );
  const memberships = members.rows.map((row) => row.grant);
  if (!same(memberships, ["pgn_migrator in pgn_owner inherit false set true admin false"])) {
    add(`role memberships are ${memberships.join("; ") || "none"}`);
  }

  // Ownership: the login roles own nothing, pgn_owner owns everything in every schema but public, and public is empty.
  const owned = await su.query<{ role: string; count: number }>(
    `select r.rolname as role, count(*)::int as count from pg_shdepend d join pg_roles r on r.oid = d.refobjid
     where d.deptype = 'o' and r.rolname = any ($1) group by 1 order by 1`,
    [LOGINS],
  );
  for (const { role, count } of owned.rows) add(`${role} owns ${count} object(s)`);
  const others = await su.query<{ object: string }>(
    `select n.nspname || '.' || c.relname as object from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where ${USER_SCHEMA} and n.nspname <> 'public' and c.relowner <> 'pgn_owner'::regrole
     union all select n.nspname || '.' || p.proname || '()' from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where ${USER_SCHEMA} and n.nspname <> 'public' and p.proowner <> 'pgn_owner'::regrole
     union all select n.nspname from pg_namespace n
       where ${USER_SCHEMA} and n.nspname <> 'public' and n.nspowner <> 'pgn_owner'::regrole
     order by 1`,
  );
  for (const { object } of others.rows) add(`${object} is not owned by pgn_owner`);
  const inPublic = await su.query<{ object: string }>(
    `select 'public.' || relname as object from pg_class where relnamespace = 'public'::regnamespace
     union all select 'public.' || proname || '()' from pg_proc where pronamespace = 'public'::regnamespace order by 1`,
  );
  for (const { object } of inPublic.rows) add(`${object} is in the public schema, which must stay empty`);

  // Schemas: each login role uses exactly its own; nobody, PUBLIC included, may create anything in any schema.
  const schemaRights = await su.query<{ role: string; schema: string; usage: boolean; create: boolean }>(
    `select r.rolname::text as role, n.nspname as schema, has_schema_privilege(r.oid, n.oid, 'USAGE') as usage,
       has_schema_privilege(r.oid, n.oid, 'CREATE') as create
     from ${GRANTEES} r cross join pg_namespace n where ${USER_SCHEMA} order by 1, 2`,
    [LOGINS],
  );
  for (const role of [...LOGINS, "public"]) {
    const rows = schemaRights.rows.filter((row) => row.role === role);
    const uses = rows.filter((row) => row.usage).map((row) => row.schema);
    if (!same(uses, SCHEMA_USAGE[role] ?? [])) add(`${role} may use the schemas ${uses.join(", ") || "none"}`);
    for (const row of rows.filter((row) => row.create)) add(`${role} may create objects in schema ${row.schema}`);
  }

  // Functions in every schema: none runs as its owner; each sets its search_path; only pgn_app may execute, and only
  // its three.
  const functions = await su.query<{ name: string; definer: boolean; path: boolean; executors: string[] }>(
    `select n.nspname || '.' || p.proname as name, p.prosecdef as definer,
       coalesce(exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'), false) as path,
       array(select r.rolname::text from ${GRANTEES} r
             where has_function_privilege(r.oid, p.oid, 'EXECUTE') order by 1) as executors
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where ${USER_SCHEMA} order by 1`,
    [LOGINS],
  );
  for (const fn of functions.rows) {
    if (fn.definer && !DEFINERS.includes(fn.name)) add(`${fn.name}() runs with its owner's rights (SECURITY DEFINER)`);
    // Graphile Worker's own functions set none; nobody may execute them (below), and they run only under the wrapper
    if (!fn.path && !fn.name.startsWith("queue.")) add(`${fn.name}() does not set its search_path`);
    const want =
      fn.name === "app.current_org"
        ? ["pgn_app", "pgn_engine"] // pgn_engine's insert into the inbox passes the organisation wall's check
        : [...APP_FUNCTIONS.map((name) => `app.${name}`), ...DEFINERS].includes(fn.name)
          ? ["pgn_app"]
          : [];
    if (!same(fn.executors, want)) add(`${fn.name}() may be executed by ${fn.executors.join(", ") || "nobody"}`);
  }

  // The database: the same rights as the development database (infra/docker/postgres-init.sql), and no other
  // database open to the login roles.
  const databases = await su.query<{ name: string; acl: string[] | null }>(
    `select datname as name, datacl::text[] as acl from pg_database
     where datname in (current_database(), 'pageinator')`,
  );
  const here = databases.rows.find((row) => row.name !== "pageinator") ?? databases.rows[0];
  const reference = databases.rows.find((row) => row.name === "pageinator");
  if (!reference) add("the development database (pageinator) is missing, so its rights cannot be compared");
  else if (!same(here?.acl ?? [], reference.acl ?? [])) {
    add(`this database's rights (${(here?.acl ?? []).join(", ")}) differ from pageinator's`);
  }
  const open = await su.query<{ role: string; database: string }>(
    `select r.rolname::text as role, d.datname as database from ${GRANTEES} r cross join pg_database d
     where d.datname in ('postgres', 'template1') and has_database_privilege(r.oid, d.oid, 'CONNECT')`,
    [LOGINS],
  );
  for (const { role, database } of open.rows) add(`${role} may connect to ${database}`);
  return problems;
}

type Rows = { total: number; foreign: number };

/** Runs fn in a transaction as pgn_app with the given context (as withTenant sets it), then rolls it back. */
async function as<T>(app: Client, context: { org?: Org; pubs?: readonly string[] }, fn: () => Promise<T>) {
  await app.query("begin");
  try {
    if (context.org) {
      await app.query(
        "select set_config('app.org_id', $1, true), set_config('app.user_id', $2, true), " +
          "set_config('app.pub_ids', $3, true), set_config('app.request_id', 'tenancy-test', true)",
        [context.org.id, context.org.user, `{${(context.pubs ?? context.org.pubs.map((p) => p.id)).join(",")}}`],
      );
    }
    return await fn();
  } finally {
    await app.query("rollback");
  }
}

type Outcome = { rows: number } | { code: string; message: string };

/** What a statement did (the rows it touched, or the error it raised), undone at once so each attempt starts from the
 * seeded rows. */
async function attempt(app: Client, text: string, values: unknown[]): Promise<Outcome> {
  await app.query("savepoint attempt");
  try {
    return { rows: (await app.query(text, values)).rowCount ?? 0 };
  } catch (error) {
    const { code = "", message = "" } = error as { code?: string; message?: string };
    return { code, message };
  } finally {
    await app.query("rollback to savepoint attempt");
  }
}

const REFUSED_BY_WALL = /new row violates row-level security policy/;

/** (b) Seeds both organisations' rows of every app table, then checks, as pgn_app, that each organisation sees and
 * writes only its own, that nothing is visible without the context, and that the publication wall holds. */
export async function crossTenantProblems(
  db: TestDatabase,
  fixtures: readonly Fixture[] = FIXTURES,
): Promise<string[]> {
  const problems: string[] = [];
  const add = (problem: string) => problems.push(problem);
  const su = await db.connect("postgres");
  const counts = await seed(su, fixtures);
  const tables = await su.query<{ name: string; pub: boolean; insert: boolean; update: boolean; delete: boolean }>(
    `select c.relname as name,
       exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'publication_id'
               and not a.attisdropped) as pub,
       has_table_privilege('pgn_app', c.oid, 'INSERT') as insert,
       has_table_privilege('pgn_app', c.oid, 'UPDATE') as update,
       has_table_privilege('pgn_app', c.oid, 'DELETE') as delete
     from pg_class c where c.relnamespace = 'app'::regnamespace and c.relkind in ('r', 'p')
       and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id')
     order by 1`,
  );
  if (tables.rows.length === 0) add("no app table has an org_id: nothing was checked");
  // Only the app tables are seeded and checked here, so pgn_app must not reach any other relation ((a) says the same).
  const outside = await su.query<{ relation: string }>(
    `select n.nspname || '.' || c.relname as relation from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where ${USER_SCHEMA} and n.nspname <> 'app' and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_table_privilege('pgn_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') order by 1`,
  );
  for (const { relation } of outside.rows) {
    if (!QUEUE_REACH.includes(relation)) add(`${relation}: pgn_app can reach it outside app, so it is not checked`);
  }
  const app = await db.connect("app");
  for (const table of tables.rows) {
    const t = `app.${table.name}`;
    const fixture = fixtures.find((f) => f.table === table.name);
    if (!fixture) {
      add(`${t} has no fixture (test/db/fixtures.ts), so it cannot be checked`);
      continue;
    }
    for (const [me, other] of [
      [ORG_A, ORG_B],
      [ORG_B, ORG_A],
    ] as const) {
      const own = counts.get(`${table.name} ${me.id}`) ?? 0;
      await as(app, { org: me }, async () => {
        const seen = await app.query<Rows>(
          `select count(*)::int as total, count(*) filter (where org_id = $1)::int as foreign from ${t}`,
          [other.id],
        );
        const { total, foreign } = seen.rows[0] ?? { total: 0, foreign: 0 };
        if (foreign > 0) add(`${t}: under ${me.name}, ${foreign} row(s) of ${other.name} can be read`);
        if (total - foreign !== own)
          add(`${t}: under ${me.name}, ${total - foreign} of its own ${own} row(s) can be read`);

        const foreignRow = insertion(table.name, fixture.row(other, other.pubs[0]));
        const inserted = await attempt(app, foreignRow.text, foreignRow.values);
        if (!refused(inserted, table.insert))
          add(`${t}: under ${me.name}, writing a row of ${other.name} ${what(inserted)}`);
        const moved = await attempt(app, `update ${t} set org_id = $1 where org_id = $2`, [other.id, me.id]);
        if (own > 0 && !refused(moved, table.update))
          add(`${t}: under ${me.name}, moving its rows to ${other.name} ${what(moved)}`);
        const updated = await attempt(app, `update ${t} set org_id = org_id where org_id = $1`, [other.id]);
        if (!untouched(updated, table.update))
          add(`${t}: under ${me.name}, updating ${other.name}'s rows ${what(updated)}`);
        const deleted = await attempt(app, `delete from ${t} where org_id = $1`, [other.id]);
        if (!untouched(deleted, table.delete))
          add(`${t}: under ${me.name}, deleting ${other.name}'s rows ${what(deleted)}`);
      });
    }
    await as(app, {}, async () => {
      const seen = await app.query<{ total: number }>(`select count(*)::int as total from ${t}`);
      const total = seen.rows[0]?.total ?? 0;
      if (total > 0) add(`${t}: outside withTenant, ${total} row(s) can be read`);
    });
    if (isContent(table)) {
      const [first, second] = ORG_A.pubs;
      if (!second) throw new Error("the publication wall check needs two publications in ORG_A");
      await as(app, { org: ORG_A, pubs: [first.id] }, async () => {
        // a row with no publication counts too: the wall hides it from every publication
        const seen = await app.query<{ foreign: number }>(
          `select count(*) filter (where publication_id is distinct from $1)::int as foreign from ${t}`,
          [first.id],
        );
        const foreign = seen.rows[0]?.foreign ?? 0;
        if (foreign > 0) add(`${t}: a user of ${first.name} only can read ${foreign} row(s) of ${second.name}`);
        const otherPub = insertion(table.name, fixture.row(ORG_A, second));
        const inserted = await attempt(app, otherPub.text, otherPub.values);
        if (!refused(inserted, table.insert))
          add(`${t}: a user of ${first.name} only, writing a row of ${second.name}, ${what(inserted)}`);
      });
      await as(app, { org: ORG_A, pubs: [] }, async () => {
        const seen = await app.query<{ total: number }>(`select count(*)::int as total from ${t}`);
        const total = seen.rows[0]?.total ?? 0;
        if (total > 0) add(`${t}: a user of no publication can read ${total} row(s)`);
      });
    }
  }
  return problems;
}

/** Refused as it must be: by the walls when the role has the right, else for want of the right. */
function refused(result: Outcome, granted: boolean): boolean {
  if ("rows" in result) return false;
  return (
    result.code === "42501" &&
    (granted ? REFUSED_BY_WALL.test(result.message) : /permission denied/.test(result.message))
  );
}

/** Touched no row (the walls hid them all), or refused for want of the right. */
function untouched(result: Outcome, granted: boolean): boolean {
  if ("rows" in result) return granted && result.rows === 0;
  return !granted && result.code === "42501" && /permission denied/.test(result.message);
}

function what(result: Outcome): string {
  return "rows" in result
    ? `was allowed (${result.rows} row(s))`
    : `failed otherwise (${result.code}: ${result.message})`;
}
