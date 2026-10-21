// src/db/schema.gen.ts against the migrations (the CI diff check of docs/product/10-l2-newsroom-plan.md §3.6), and
// the generator's type mapping against what pg really returns for each type.
import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { type Column, SCHEMA_FILE, TYPES, generate, render } from "../../src/db/codegen.ts";
import { freshDatabase } from "./helpers.ts";

const db = await freshDatabase();
afterAll(() => db.drop());

describe("schema.gen.ts", () => {
  it("is what the generator makes from the migrated schema", async () => {
    // if this fails: pnpm --filter @pageinator/api db:codegen (after migrating the development database)
    expect(await generate(db.migrator)).toBe(await readFile(SCHEMA_FILE, "utf8"));
  });

  it("maps each type to what pg returns for it", async () => {
    const owner = await db.connect("migrator");
    await owner.query("set role pgn_owner");
    await owner.query(`create table app.typed (
      bool bool, int2 int2, int4 int4, int8 int8, numeric numeric, float4 float4, float8 float8, text text,
      varchar varchar, uuid uuid, inet inet, timestamptz timestamptz, jsonb jsonb, text_list text[], uuid_list uuid[]
    )`);
    await owner.query(`insert into app.typed values (true, 1, 2, 3, 4.5, 5.5, 6.5, 't', 'v',
      '01900000-0000-7000-8000-000000000001', '192.0.2.1', now(), '{"a": 1}', '{a,b}',
      '{01900000-0000-7000-8000-000000000001}')`);
    const su = await db.connect("postgres");
    const row = (await su.query("select * from app.typed")).rows[0] as Record<string, unknown>;
    // the generator's own reading of the catalog (the clone now has app.typed, all of whose columns may be null)
    const generated = /export interface AppTyped \{\n([^}]*)\}/.exec(await generate(db.migrator))?.[1] ?? "";
    const declared = new Map(
      [...generated.matchAll(/^ {2}(\w+): (.+) \| null;$/gm)].map((match) => [match[1] ?? "", match[2] ?? ""]),
    );
    const expected: Record<string, (value: unknown) => boolean> = {
      boolean: (v) => typeof v === "boolean",
      number: (v) => typeof v === "number",
      string: (v) => typeof v === "string",
      Timestamp: (v) => v instanceof Date,
      Json: (v) => typeof v === "object" && v !== null,
      "string[]": (v) => Array.isArray(v) && v.every((item) => typeof item === "string"),
    };
    expect([...declared.keys()].sort()).toEqual(Object.keys(row).sort());
    // every mapped type has a column here (named after it), and arrays too
    expect(Object.keys(TYPES).filter((type) => !declared.has(type))).toEqual([]);
    for (const [column, type] of declared) {
      expect(expected[type]?.(row[column]), `${column}: ${type}, but pg returned ${JSON.stringify(row[column])}`).toBe(
        true,
      );
    }
  });

  it("refuses a type or a column it has no mapping for", () => {
    const column: Column = {
      table: "edition",
      column: "edition_date",
      type: "date",
      element: null,
      notNull: true,
      hasDefault: false,
      generated: false,
    };
    expect(() => render([column])).toThrow("app.edition.edition_date: the type date has no mapping yet");
    expect(() => render([{ ...column, type: "_date", element: "date" }])).toThrow("the type date[] has no mapping yet");
    expect(() => render([{ ...column, type: "text", generated: true }])).toThrow("generated columns have no mapping");
  });
});
