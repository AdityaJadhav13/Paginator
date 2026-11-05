// AUDIT_ACTIONS (packages/contracts/src/audit.ts) is the catalogue of every action the API writes to app.audit_event.
// This test reads the API's source: the log has one writer, recordAudit() in src/db/audit.ts, whose action is typed
// AuditAction, and every call of it or of a helper over it (any function whose name says audit, called plainly or as
// a member, ns.recordAudit(…)) names its action as a literal among its arguments. Every action found must be in the
// catalogue, every entry must be written somewhere, and the table's name anywhere else (in any spelling: withSchema,
// quoted, in SQL text) fails the test, so a new action cannot reach the log without an entry.
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AUDIT_ACTIONS,
  AUDIT_ACTION_NAMES,
  AUDIT_ACTION_PATTERN,
  PUBLICATION_AUDIT_ACTIONS,
} from "@pageinator/contracts";
import { describe, expect, it } from "vitest";

const API = fileURLToPath(new URL("../../", import.meta.url));
const SKIP = [join("src", "db", "migrations"), join("src", "db", "schema.gen.ts")];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (SKIP.some((skip) => relative(API, path) === skip)) return [];
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** The text of a call's arguments: from just after its "(" to the matching ")". */
function argumentsAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "(") depth += 1;
    else if (text[i] === ")" && --depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

const DOTTED = /"([a-z][a-z_]*(?:\.[a-z][a-z_]*)+)"/g;

const WRITER = join("src", "db", "audit.ts");

type Found = { actions: Map<string, string[]>; strays: string[]; writers: number };

/** What one file writes: its inserts (the writer's), its strays (the table named anywhere else), and the actions its
 * audit calls name. */
function scan(where: string, text: string, found: Found): void {
  const add = (action: string) => found.actions.set(action, [...(found.actions.get(action) ?? []), where]);
  if (where === WRITER) {
    found.writers += [...text.matchAll(/insertInto\(\s*"app\.audit_event"/g)].length;
  } else if (/audit_event/.test(text)) {
    found.strays.push(`${where}: names audit_event (only src/db/audit.ts may: use recordAudit)`);
  }
  // every call of recordAudit, or of a helper whose name says audit, plain or as a member: the dotted literals among
  // its arguments
  for (const call of text.matchAll(/(?<!\w)(\w*[aA]udit\w*)\(/g)) {
    if (/function\s+$/.test(text.slice(Math.max(0, call.index - 16), call.index))) continue; // its definition
    const args = argumentsAt(text, call.index + (call[1] ?? "").length);
    for (const literal of args.matchAll(DOTTED)) add(literal[1] ?? "");
  }
}

function findWriters(): Found {
  const found: Found = { actions: new Map(), strays: [], writers: 0 };
  for (const file of [...sources(join(API, "src")), ...sources(join(API, "scripts"))]) {
    scan(relative(API, file), readFileSync(file, "utf8"), found);
  }
  return found;
}

describe("AUDIT_ACTIONS", () => {
  const found = findWriters();

  it("has one writer, recordAudit(), and no other mention of the table", () => {
    expect(found.writers).toBe(1);
    expect(found.strays).toEqual([]);
    expect(found.actions.size).toBeGreaterThanOrEqual(30);
  });

  it("has an entry for every action the API writes", () => {
    const missing = [...found.actions].filter(([action]) => !Object.hasOwn(AUDIT_ACTIONS, action));
    expect(missing.map(([action, where]) => `${action} (${where.join(", ")})`)).toEqual([]);
  });

  it("has no entry that nothing writes", () => {
    expect(AUDIT_ACTION_NAMES.filter((action) => !found.actions.has(action))).toEqual([]);
  });

  it("names each action as the table's check allows, and marks the organisation's", () => {
    expect(AUDIT_ACTION_NAMES.filter((action) => !AUDIT_ACTION_PATTERN.test(action))).toEqual([]);
    // the people, invitations and the organisation are the organisation's; a Chief Editor sees only the rest
    expect([...PUBLICATION_AUDIT_ACTIONS].sort()).toEqual(
      AUDIT_ACTION_NAMES.filter((action) => !/^(engine|invitation|member|org)\./.test(action)).sort(),
    );
    // the counts docs/product/10-l2-newsroom-plan.md §5.2 states
    expect([AUDIT_ACTION_NAMES.length, PUBLICATION_AUDIT_ACTIONS.length]).toEqual([98, 87]);
  });

  it("catches the table named in any form outside the writer, and a member call's action", () => {
    for (const planted of [
      'await tx.withSchema("app").insertInto("audit_event").values(row).execute();',
      'await sql`insert into "app"."audit_event" (org_id) values (${org})`.execute(tx);',
      "await sql`select * from app.audit_event`.execute(tx);",
      "const table = 'app.audit_event';",
      "const table = `audit_event`;",
    ]) {
      const found: Found = { actions: new Map(), strays: [], writers: 0 };
      scan(join("src", "modules", "planted.ts"), planted, found);
      expect(found.strays, planted).toHaveLength(1);
    }
    const found: Found = { actions: new Map(), strays: [], writers: 0 };
    scan(join("src", "modules", "planted.ts"), 'await ns.recordAudit(tx, t, { action: "story.planted" });', found);
    expect([...found.actions.keys()]).toEqual(["story.planted"]);
  });
});
