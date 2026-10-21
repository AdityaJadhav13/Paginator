// Two fictional organisations (docs/product/10-l2-newsroom-plan.md §7.2), and one row of every app table for each.
// Every name is fictional and every address is at example.test (a reserved domain).
import { type Client, escapeIdentifier } from "pg";

export type Pub = {
  id: string;
  name: string;
  slug: string;
  languages: string[];
  primary_language: string;
  digit_style: string;
};
export type Org = { id: string; name: string; user: string; person: string; email: string; pubs: [Pub, ...Pub[]] };

const id = (tail: string) => `01900000-0000-7000-8000-${tail.padStart(12, "0")}`;

export const ORG_A: Org = {
  id: id("a"),
  name: "Kalpaniknagar Media (fictional)",
  user: id("a01"),
  person: "Reporter A (fictional)",
  email: "reporter.a@example.test",
  pubs: [
    {
      id: id("a11"),
      name: "काल्पनिकनगर वार्ता",
      slug: "kalpaniknagar-varta",
      languages: ["mr"],
      primary_language: "mr",
      digit_style: "devanagari",
    },
    {
      id: id("a12"),
      name: "Kalpaniknagar Express",
      slug: "kalpaniknagar-express",
      languages: ["en"],
      primary_language: "en",
      digit_style: "latin",
    },
  ],
};

export const ORG_B: Org = {
  id: id("b"),
  name: "Example Press B",
  user: id("b01"),
  person: "Reporter B (fictional)",
  email: "reporter.b@example.test",
  pubs: [
    {
      id: id("b11"),
      name: "Example Press B Daily",
      slug: "example-press-b-daily",
      languages: ["en", "mr"],
      primary_language: "en",
      digit_style: "latin",
    },
  ],
};

/**
 * How to make rows of each app table, parents first: once per organisation, or once per publication of it (the
 * publication table, and the content tables from PR 16). The cross-tenant test fails for a table that has no entry
 * here, so every new table needs one.
 */
export type Fixture = {
  table: string;
  per: "org" | "publication";
  row: (org: Org, pub: Pub) => Record<string, unknown>;
};

export const FIXTURES: Fixture[] = [
  { table: "org_settings", per: "org", row: (org) => ({ org_id: org.id }) },
  { table: "publication", per: "publication", row: (org, pub) => ({ ...pub, org_id: org.id }) },
  {
    table: "person",
    per: "org",
    row: (org) => ({ org_id: org.id, user_id: org.user, display_name: org.person, email: org.email }),
  },
  {
    table: "audit_event",
    per: "org",
    row: (org, pub) => ({
      org_id: org.id,
      publication_id: pub.id,
      actor_kind: "user",
      actor_id: org.user,
      action: "test.seeded",
      target_type: "publication",
      target_id: pub.id,
    }),
  },
];

/** The statement that inserts row into app.<table>. */
export function insertion(table: string, row: Record<string, unknown>): { text: string; values: unknown[] } {
  const columns = Object.keys(row);
  const names = columns.map(escapeIdentifier).join(", ");
  const places = columns.map((_, i) => `$${i + 1}`).join(", ");
  return {
    text: `insert into app.${escapeIdentifier(table)} (${names}) values (${places})`,
    values: Object.values(row),
  };
}

/** Inserts row into app.<table> with the client's rights (the superuser's ignore row-level security). */
export async function insert(client: Client, table: string, row: Record<string, unknown>): Promise<void> {
  const { text, values } = insertion(table, row);
  await client.query(text, values);
}

/** Seeds both organisations' rows, as the superuser; returns how many rows of each table each organisation has. */
export async function seed(su: Client, fixtures: readonly Fixture[] = FIXTURES): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const fixture of fixtures) {
    for (const org of [ORG_A, ORG_B]) {
      const pubs = fixture.per === "org" ? [org.pubs[0]] : org.pubs;
      for (const pub of pubs) await insert(su, fixture.table, fixture.row(org, pub));
      counts.set(`${fixture.table} ${org.id}`, pubs.length);
    }
  }
  return counts;
}
