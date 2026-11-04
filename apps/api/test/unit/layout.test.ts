// Hosted layout without a database (src/modules/layout): the Desk's words the API says itself (equal to
// tools/desk/engine/messages.json), the readiness and the frozen request built from an edition's rows, the inbox's
// reading of the engine's events, and who hears the layout and profile live hints.
import { readFileSync } from "node:fs";
import type { PublicationAccess } from "@pageinator/contracts";
import { describe, expect, it } from "vitest";
import type { ArtworkRow, LayoutEdition, LayoutStory, Plan } from "../../src/db/layout.ts";
import { isLayoutEvent, layoutTarget } from "../../src/modules/layout/inbox.ts";
import { blockerOf, frozenRequest, planFor, readiness, slotsOf } from "../../src/modules/layout/request.ts";
import { CANCELLED, CANCELLED_BEFORE, RESTARTED } from "../../src/modules/layout/views.ts";
import { STARTING } from "../../src/db/layout.ts";
import { messageFor } from "../../src/modules/notifications/events.ts";

const MESSAGES = JSON.parse(
  readFileSync(new URL("../../../../tools/desk/engine/messages.json", import.meta.url), "utf8"),
) as Record<string, string>;

const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const at = new Date("2027-01-02T03:04:05.000Z");

const EDITION: LayoutEdition = {
  id: id(1),
  desk_key: "2027-01-02",
  date: "2027-01-02",
  pages: 8,
  back_page_ads: true,
  volume: "",
  issue: "",
  price: "",
  created_at: at,
  updated_at: at,
  folio_changed_at: null,
  timezone: "Asia/Kolkata",
};
const PLAN = {
  pages: 8,
  back_page_ads: true,
  page_plan: [
    { page: 8, role: "back", template_role: "back", news_mm2: 1, ad_slots: [{ slot: "back-1", w_mm: 100, h_mm: 50 }] },
  ],
  needs: { stories: 10, briefs: 2, photos: 3, words: 4000, per_role: {}, spare_share: 0 },
} as unknown as Plan;
const CMYK = {
  key: "orgs/o/pubs/p/assets/a/r/cmyk-x.cmyk.gz",
  version_id: "v",
  sha256: "a".repeat(64),
  width_px: 40,
  height_px: 30,
};

let k = 0;
function story(o: Partial<LayoutStory> = {}): LayoutStory {
  k += 1;
  return {
    id: id(100 + k),
    desk_key: `a-${String(k).padStart(10, "0")}`,
    status: "ready",
    headline: `Fictional ${k}`,
    kicker: "",
    deck: "",
    byline: "",
    body: "One.\n\nTwo.",
    words: 100,
    priority: 3,
    page_pin: null,
    origin: "typed",
    created_at: at,
    updated_at: at,
    photo_attached: false,
    photo_status: null,
    photo_deleted: null,
    photo_desk_key: null,
    photo_caption: null,
    photo_credit: null,
    cmyk: null,
    ...o,
  };
}
const photo = (status: LayoutStory["photo_status"], cmyk: LayoutStory["cmyk"] = CMYK): Partial<LayoutStory> => ({
  photo_attached: true,
  photo_status: status,
  photo_deleted: false,
  photo_desk_key: "p-0000000001",
  photo_caption: "c",
  photo_credit: "r",
  cmyk,
});

describe("the Desk's words", () => {
  it("are the Desk's own", () => {
    for (const words of [RESTARTED, CANCELLED, CANCELLED_BEFORE, STARTING]) {
      expect(MESSAGES[words.code ?? ""]).toBe(words.text);
    }
  });
});

describe("readiness and the frozen request", () => {
  const brief = story({ words: 30 });
  const pictured = story(photo("ready"));
  const preparing = story(photo("received", null));
  const refused = story(photo("rejected"));
  const pinned = story({ page_pin: 12 });
  const hashed = story({ body: "One.\n\n## #Two" });
  const placed = story({ status: "placed" });
  const draft = story({ status: "draft" });
  const all = [brief, pictured, preparing, refused, pinned, hashed, placed, draft];

  it("counts the Ready and Placed stories, and names what blocks a run", () => {
    const got = readiness(PLAN, EDITION, all, null);
    expect(got.needs).toEqual({ stories: 10, briefs: 2, photos: 3, words: 4000 });
    expect(got.have).toEqual({ stories: 7, briefs: 1, photos: 3, words: 630 });
    expect(got.notReady.map((s) => s.status)).toEqual(["draft"]);
    expect(got.blockers.map((b) => [b.storyId, b.code])).toEqual([
      [preparing.id, "photo_preparing"],
      [refused.id, "photo_unusable"],
      [pinned.id, "page_pin"],
      [hashed.id, "subheading"],
    ]);
    expect(blockerOf(story({ page_pin: 8 }), 8)).toBeNull();
  });

  it("freezes the unblocked stories and the ready ads of the plan, in the Desk's shape", () => {
    const art = (slot: string, state: ArtworkRow["state"]): ArtworkRow => ({
      id: id(50),
      edition_id: EDITION.id,
      slot,
      asset_id: id(51),
      w_mm: "100.00",
      h_mm: "50.00",
      state,
      raster: state === "ready" ? { ...CMYK, bytes: 9 } : null,
      preview: null,
      params_hash: null,
      problem: null,
    });
    const doc = frozenRequest(EDITION, all, PLAN, [art("back-1", "ready"), art("gone", "ready")]);
    expect(doc.articles.map((a) => a["id"])).toEqual([brief.desk_key, pictured.desk_key, placed.desk_key]);
    expect(doc.articles[1]?.["photo"]).toEqual({
      id: "p-0000000001",
      caption: "c",
      credit: "r",
      width_px: 40,
      height_px: 30,
      raster: CMYK,
    });
    expect(doc.ads).toEqual({ "back-1": { width_px: 40, height_px: 30, ppi: 200, raster: CMYK } });
    expect(doc.edition).toMatchObject({ schema: "pageinator.desk.edition/1", id: "2027-01-02", pages: 8 });
    expect(slotsOf(PLAN, []).map((s) => [s.slot, s.page, s.state])).toEqual([["back-1", 8, "empty"]]);
    expect(planFor([PLAN], { pages: 8, back_page_ads: false })).toBeUndefined();
  });
});

describe("the engine's layout events", () => {
  const base = { org_id: id(1), pub_id: id(2), sha256: "a".repeat(64) };
  it("are told from the others, each by its own target", () => {
    const ad = { ...base, kind: "ad.rejected", artwork_id: id(3), asset_id: id(4) } as const;
    const measure = { ...base, kind: "measure.status", edition_id: id(5) } as const;
    const run = { ...base, kind: "run.progress", run_id: id(6) } as const;
    const failed = { ...base, kind: "job.failed", job_kind: "media.ad", target_id: id(7) } as const;
    for (const [event, target] of [
      [ad, id(3)],
      [measure, id(5)],
      [run, id(6)],
      [failed, id(7)],
    ] as const) {
      expect(isLayoutEvent(event as never)).toBe(true);
      expect(layoutTarget(event as never)).toBe(target);
    }
    expect(isLayoutEvent({ ...base, kind: "news.collected", run_id: id(8) } as never)).toBe(false);
    expect(isLayoutEvent({ ...base, kind: "job.failed", job_kind: "media.ingest", target_id: id(8) } as never)).toBe(
      false,
    );
  });
});

describe("the layout and profile live hints", () => {
  const who = (roles: string[]) => ({
    orgId: id(1),
    userId: id(9),
    access: {
      orgRole: "member" as const,
      publications: new Map<string, PublicationAccess>([
        [id(2), { roles: roles as PublicationAccess["roles"], grants: [] }],
      ]),
    },
  });
  const layout = { v: 1, type: "layout", org: id(1), pub: id(2), edition: id(3), run: null } as const;
  const profile = { v: 1, type: "profile", org: id(1), pub: id(2), profile: id(4) } as const;
  it("go to those who may view the pages, and the settings", () => {
    expect(messageFor(who(["viewer"]), layout)).toEqual({
      event: "layout",
      data: { publicationId: id(2), editionId: id(3), runId: null },
    });
    expect(messageFor(who(["viewer"]), profile)).toBeNull();
    expect(messageFor(who(["chief_editor"]), profile)).toEqual({
      event: "profile",
      data: { publicationId: id(2), profileId: id(4) },
    });
    expect(messageFor({ ...who(["viewer"]), orgId: id(8) }, layout)).toBeNull();
  });
});
