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
export type Org = {
  id: string;
  name: string;
  user: string;
  person: string;
  email: string;
  /** An invitation's id (Better Auth's, in identity; app keeps only the id). */
  invitation: string;
  pubs: [Pub, ...Pub[]];
};

const id = (tail: string) => `01900000-0000-7000-8000-${tail.padStart(12, "0")}`;

export const ORG_A: Org = {
  id: id("a"),
  name: "Kalpaniknagar Media (fictional)",
  user: id("a01"),
  person: "Reporter A (fictional)",
  email: "reporter.a@example.test",
  invitation: id("a21"),
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
  invitation: id("b21"),
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
    table: "publication_grant",
    per: "publication",
    row: (org, pub) => ({ org_id: org.id, publication_id: pub.id, user_id: org.user, roles: ["reporter"] }),
  },
  {
    table: "invitation_grant",
    per: "publication",
    row: (org, pub) => ({
      org_id: org.id,
      invitation_id: org.invitation,
      publication_id: pub.id,
      roles: ["editor"],
      grants: ["page_approve"],
    }),
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
  // the content tables (migrations 2026_11_20_*): one of each per publication, naming the rows above
  {
    table: "section",
    per: "publication",
    row: (org, pub) => ({ ...inPub(org, pub), id: childId(pub, 1), name: "शहर (fictional)", color_tag: "blue" }),
  },
  {
    table: "edition",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 2),
      edition_date: "2026-10-21",
      desk_key: "2026-10-21",
      pages: 8,
    }),
  },
  {
    table: "story",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 3),
      edition_id: childId(pub, 2),
      section_id: childId(pub, 1),
      desk_key: "a-0123456789",
      reporter_id: org.user,
      language: pub.primary_language,
    }),
  },
  {
    table: "story_revision",
    per: "publication",
    // open, as a revision is while its author edits it (a closed one refuses every change, whoever makes it)
    row: (org, pub) => ({
      ...inPub(org, pub),
      story_id: childId(pub, 3),
      rev: 1,
      headline: "काल्पनिकनगरात पाऊस (fictional)",
      body: "पहिला परिच्छेद.",
      words: 2,
      author_id: org.user,
    }),
  },
  {
    table: "comment",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 4),
      target_id: childId(pub, 3),
      author_id: org.user,
      body: "Check the date (fictional).",
    }),
  },
  {
    table: "story_status_change",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      story_id: childId(pub, 3),
      from_status: "draft",
      to_status: "filed",
      changed_by: org.user,
      comment_id: childId(pub, 4),
    }),
  },
  {
    table: "asset",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 5),
      desk_key: "p-0123456789",
      sha256: "1".repeat(64),
      bytes: 1024,
      mime: "image/jpeg",
      width_px: 640,
      height_px: 480,
      uploaded_by: org.user,
    }),
  },
  {
    table: "upload",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 7),
      user_id: org.user,
      purpose: "story_photo",
      declared_type: "image/jpeg",
      declared_bytes: 1024,
      status: "completed",
      asset_id: childId(pub, 5),
      expires_at: "2026-11-01T00:15:00Z",
    }),
  },
  // a Word import (migration 2026_11_30_0001), of the publication's upload
  {
    table: "import_job",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 10),
      user_id: org.user,
      upload_id: childId(pub, 7),
      sha256: "3".repeat(64),
      bytes: 1024,
    }),
  },
  // the news finder (migration 2026_12_01_0001): a source, a topic and an item of it, a draft, and a Claude call
  { table: "news_settings", per: "publication", row: (org, pub) => ({ ...inPub(org, pub), house_style: "Short." }) },
  {
    table: "news_source",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 11),
      name: "Kalpaniknagar Times (fictional)",
      url: "https://news.example.test/feed.xml",
      language: "en",
    }),
  },
  {
    table: "news_topic",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 12),
      title_mr: "काल्पनिक पूल",
      title_en: "A fictional bridge",
      importance: 3,
    }),
  },
  {
    table: "news_item",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 13),
      source_id: childId(pub, 11),
      topic_id: childId(pub, 12),
      title: "A fictional bridge opens",
      summary: "",
      link: `https://news.example.test/${pub.id}/bridge`,
      hash: "4".repeat(64),
    }),
  },
  {
    table: "news_draft_job",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 14),
      user_id: org.user,
      topic_id: childId(pub, 12),
      language: "en",
      length: "standard",
      find_photo: false,
    }),
  },
  {
    table: "ai_usage",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      purpose: "group",
      model: "claude-opus-5-5",
      input_tokens: 10,
      output_tokens: 5,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      cost_inr: "0.01",
    }),
  },
  // hosted layout (migration 2026_12_02_0001): a ready profile, a done run of the edition with its first page, an ad
  // slot's artwork, the edition's measuring, and a check's verdict per organisation
  {
    table: "engine_profile",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 15),
      version: 1,
      state: "ready",
      upload_id: childId(pub, 7),
      dataset_version_id: "v1",
      dataset_sha256: "4".repeat(64),
      dataset_bytes: 2048,
      config_version_id: "v1",
      config_sha256: "5".repeat(64),
      engine_version: "fictional-1",
      templates: JSON.stringify({ front: "page1" }),
      grid: JSON.stringify({ columns: 8, column_width_mm: 32, gutter_mm: 4 }),
      plans: JSON.stringify([]),
      created_by: org.user,
    }),
  },
  {
    table: "layout_run",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 16),
      edition_id: childId(pub, 2),
      desk_key: "r-20261021-101500",
      state: "done",
      request_version_id: "v1",
      request_sha256: "6".repeat(64),
      profile_id: childId(pub, 15),
      finished_at: "2026-10-21T10:20:00Z",
      created_by: org.user,
    }),
  },
  {
    table: "run_page",
    per: "publication",
    row: (org, pub) => ({ ...inPub(org, pub), run_id: childId(pub, 16), page_no: 1, role: "front", state: "done" }),
  },
  {
    table: "page_edit",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      run_id: childId(pub, 16),
      page_no: 1,
      rev: 1,
      modules: "[]",
      cause: "set",
      author_id: org.user,
    }),
  },
  {
    table: "page_save",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      run_id: childId(pub, 16),
      page_no: 1,
      rev: 1,
      pdf_sha256: "8".repeat(64),
      saved_by: org.user,
    }),
  },
  {
    table: "run_text_override",
    per: "publication",
    row: (org, pub) => ({ ...inPub(org, pub), run_id: childId(pub, 16), overrides: "{}" }),
  },
  {
    table: "page_lock",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      run_id: childId(pub, 16),
      page_no: 1,
      holder_id: org.user,
      expires_at: "2026-10-21T10:21:15Z",
    }),
  },
  // release (migration 2026_12_04_0001): an approval of the run's first page, a release of it with its file and a
  // delivery, and the publication's press test
  {
    table: "page_approval",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      run_id: childId(pub, 16),
      page_no: 1,
      rev: 0,
      pdf_sha256: "8".repeat(64),
      approved_by: org.user,
    }),
  },
  {
    table: "release",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 18),
      edition_id: childId(pub, 2),
      run_id: childId(pub, 16),
      number: 1,
      kind: "release",
      approved_by: org.user,
      retain_until: "2036-10-21T10:30:00Z",
    }),
  },
  {
    table: "release_file",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      release_id: childId(pub, 18),
      page_no: 1,
      name: "2026-10-21_P01.pdf",
      rev: 0,
      sha256: "8".repeat(64),
      bytes: 100,
      archive_key: `orgs/${org.id}/pubs/${pub.id}/editions/${childId(pub, 2)}/releases/${childId(pub, 18)}/pages/2026-10-21_P01.pdf`,
      archive_version_id: "v1",
    }),
  },
  {
    table: "delivery",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      release_id: childId(pub, 18),
      sent_by: org.user,
      files: JSON.stringify([{ name: "2026-10-21_P01.pdf", sha256: "8".repeat(64), bytes: 100 }]),
    }),
  },
  {
    table: "press_test",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      page_sha256: "8".repeat(64),
      accepted_on: "2026-10-20",
      recorded_by: org.user,
    }),
  },
  { table: "ad_settings", per: "publication", row: (org, pub) => ({ ...inPub(org, pub), updated_by: org.user }) },
  {
    table: "ad_cutoff_alert",
    per: "publication",
    row: (org, pub) => ({ ...inPub(org, pub), edition_date: "2026-10-21", bookings: "{}", told: 0 }),
  },
  // the ads desk (migration 2026_12_05_0001): an advertiser, its booking (with the asset as artwork) placed in the
  // edition's slot, and a plan page naming the section
  {
    table: "advertiser",
    per: "publication",
    row: (org, pub) => ({ ...inPub(org, pub), id: childId(pub, 19), name: "Example Jewellers", created_by: org.user }),
  },
  {
    table: "ad_booking",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 20),
      advertiser_id: childId(pub, 19),
      w_mm: "100.00",
      h_mm: "50.00",
      colour: "colour",
      slot: "back-1",
      dates: "{2026-10-21}",
      artwork_asset_id: childId(pub, 5),
      artwork_set_by: org.user,
      artwork_set_at: "2026-10-20T10:00:00Z",
      created_by: org.user,
    }),
  },
  {
    table: "ad_placement",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      edition_id: childId(pub, 2),
      slot: "back-1",
      booking_id: childId(pub, 20),
    }),
  },
  {
    table: "flatplan_page",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      edition_id: childId(pub, 2),
      page_no: 1,
      section_id: childId(pub, 1),
      note: "A fictional note",
      updated_by: org.user,
    }),
  },
  {
    table: "ad_slot_artwork",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 17),
      edition_id: childId(pub, 2),
      slot: "back-1",
      asset_id: childId(pub, 5),
      w_mm: "100.00",
      h_mm: "50.00",
      set_by: org.user,
    }),
  },
  {
    table: "edition_measure",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      edition_id: childId(pub, 2),
      sha256: "7".repeat(64),
      version_id: "v1",
    }),
  },
  {
    table: "pdf_check",
    per: "org",
    row: (org) => ({ org_id: org.id, sha256: "8".repeat(64), checker_sha256: "9".repeat(64), passed: true }),
  },
  { table: "upload_quota", per: "org", row: (org) => ({ org_id: org.id, day: "2026-11-01", bytes: 1024 }) },
  {
    table: "story_photo",
    per: "publication",
    row: (org, pub) => ({ ...inPub(org, pub), story_id: childId(pub, 3), asset_id: childId(pub, 5) }),
  },
  {
    table: "desk_bundle",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      id: childId(pub, 6),
      edition_id: childId(pub, 2),
      key: `orgs/${org.id}/pubs/${pub.id}/desk-bundles/${childId(pub, 9)}.zip`,
      sha256: "0".repeat(64),
      created_by: org.user,
    }),
  },
  {
    table: "desk_bundle_revision",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      bundle_id: childId(pub, 6),
      story_id: childId(pub, 3),
      rev: 1,
      version: 1,
    }),
  },
  {
    table: "notification",
    per: "org",
    row: (org) => ({
      org_id: org.id,
      user_id: org.user,
      kind: "story_filed",
      target_type: "story",
      target_id: childId(org.pubs[0], 3),
      data: JSON.stringify({ publicationId: org.pubs[0].id, storyId: childId(org.pubs[0], 3), actorId: org.user }),
    }),
  },
  // the engine (migration 2026_11_27_0001): a rendition of each publication's asset, and an inbox row per organisation
  {
    table: "rendition",
    per: "publication",
    row: (org, pub) => ({
      ...inPub(org, pub),
      asset_id: childId(pub, 5),
      purpose: "preview",
      params_hash: "0".repeat(32),
      key: `orgs/${org.id}/pubs/${pub.id}/assets/${childId(pub, 5)}/r/preview-${"0".repeat(32)}.jpg`,
      version_id: "v1",
      sha256: "2".repeat(64),
      bytes: 10,
      mime: "image/jpeg",
      width_px: 10,
      height_px: 10,
    }),
  },
  {
    table: "engine_event",
    per: "org",
    row: (org) => ({
      org_id: org.id,
      job_id: `job-${org.id}`,
      kind: "job.failed",
      asset_id: childId(org.pubs[0], 5),
      payload: JSON.stringify({ kind: "job.failed" }),
    }),
  },
  {
    table: "idempotency_key",
    per: "org",
    row: (org) => ({
      org_id: org.id,
      user_id: org.user,
      key: id(`${org.id.slice(-1)}c1`),
      route: "POST /orgs/{o}/pubs/{p}/stories",
      request_sha256: "0".repeat(64),
    }),
  },
];

function inPub(org: Org, pub: Pub): { org_id: string; publication_id: string } {
  return { org_id: org.id, publication_id: pub.id };
}

/** The n-th fixed id under a publication (its id's last three digits, then n), so rows can name each other. */
export function childId(pub: Pub, n: number): string {
  return id(`${pub.id.slice(-3)}${n.toString(16).padStart(9, "0")}`);
}

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
