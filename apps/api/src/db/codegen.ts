// The Kysely types of the tables in schema app (src/db/schema.gen.ts), generated from a migrated database's catalog
// (docs/product/10-l2-newsroom-plan.md §3.6). The plan names kysely-codegen 0.20.0. It is not used: one of its
// dependencies (argparse, through cosmiconfig and js-yaml) has the Python-2.0 licence, which tools/ts/check-licences.ts
// does not allow. Each Postgres type maps to what pg returns for it. A type with no mapping stops the generator, so a
// new column type gets a deliberate one (a date is read as its text: src/db/parsers.ts gives the app pool that parser).
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import type { MigratorSettings } from "./migrate.ts";

export const SCHEMA_FILE = fileURLToPath(new URL("./schema.gen.ts", import.meta.url));

/** The TypeScript type of each Postgres type that pg returns as it is (int8 and numeric come back as strings). */
export const TYPES: Readonly<Record<string, string>> = {
  bool: "boolean",
  int2: "number",
  int4: "number",
  int8: "string",
  numeric: "string",
  float4: "number",
  float8: "number",
  text: "string",
  varchar: "string",
  uuid: "string",
  inet: "string",
  timestamptz: "Timestamp",
  date: "string",
  jsonb: "Json",
};

export type Column = {
  table: string;
  column: string;
  type: string;
  /** an array's element type, else null */
  element: string | null;
  notNull: boolean;
  hasDefault: boolean;
  generated: boolean;
};

const CATALOG = `
  select c.relname as "table", a.attname as "column", t.typname as "type", e.typname as "element",
    a.attnotnull as "notNull", a.atthasdef or a.attidentity = 'd' as "hasDefault",
    a.attgenerated <> '' or a.attidentity = 'a' as "generated"
  from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    join pg_catalog.pg_type t on t.oid = a.atttypid
    left join pg_catalog.pg_type e on e.oid = t.typelem and t.typcategory = 'A'
  where n.nspname = 'app' and c.relkind in ('r', 'p')`;

const HEADER = `// Generated from the migrated schema app by \`pnpm --filter @pageinator/api db:codegen\` (src/db/codegen.ts): do not
// edit it. The database tests (pnpm test:db) fail while it differs from the migrations.
import type { ColumnType } from "kysely";

export type Generated<T> =
  T extends ColumnType<infer S, infer I, infer U> ? ColumnType<S, I | undefined, U> : ColumnType<T, T | undefined, T>;
export type Json = ColumnType<JsonValue, string, string>;
export type JsonValue = JsonValue[] | { [key: string]: JsonValue } | boolean | number | string | null;
export type Timestamp = ColumnType<Date, Date | string, Date | string>;
`;

function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function typeOf(column: Column): string {
  const where = `app.${column.table}.${column.column}`;
  if (column.generated) throw new Error(`${where}: generated columns have no mapping yet (src/db/codegen.ts)`);
  const mapped = column.element === null ? TYPES[column.type] : TYPES[column.element];
  const name = column.element === null ? column.type : `${column.element}[]`;
  if (mapped === undefined) throw new Error(`${where}: the type ${name} has no mapping yet (src/db/codegen.ts)`);
  const type = column.element === null ? mapped : `${mapped}[]`;
  const nullable = column.notNull ? type : `${type} | null`;
  return column.hasDefault ? `Generated<${nullable}>` : nullable;
}

function interfaceName(table: string): string {
  return `App${table
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")}`;
}

/** The file's text for these columns: tables and columns in name order, so the output depends on nothing else. */
export function render(columns: readonly Column[]): string {
  const tables = [...new Set(columns.map((column) => column.table))].sort(byName);
  const interfaces = tables.map((table) => {
    const fields = columns
      .filter((column) => column.table === table)
      .sort((a, b) => byName(a.column, b.column))
      .map((column) => `  ${column.column}: ${typeOf(column)};\n`);
    return `\nexport interface ${interfaceName(table)} {\n${fields.join("")}}\n`;
  });
  const db = tables.map((table) => `  "app.${table}": ${interfaceName(table)};\n`).join("");
  return `${HEADER}${interfaces.join("")}\nexport interface DB {\n${db}}\n`;
}

/** Reads the catalog of the database these settings name (as pgn_migrator: the catalog is readable by every role). */
export async function generate(settings: MigratorSettings): Promise<string> {
  const client = new Client({
    host: settings.host,
    port: settings.port,
    database: settings.name,
    user: "pgn_migrator",
    password: settings.password,
    application_name: "pageinator-codegen",
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    return render((await client.query<Column>(CATALOG)).rows);
  } finally {
    await client.end();
  }
}
