/**
 * The page editor's double (docs/product/10-l2-newsroom-plan.md §1 L2.4), answered as the API's editor routes: one
 * fictional page per run and page number, opened, changed (set, alternative, refresh, move; a change on an older
 * revision is 409 stale with `current`), saved (the independent check passes with one warning), its history, and the
 * lock held by the caller. Glyph outlines are squares. Permissions are not modelled: the screen hides what the API
 * would refuse from /me, and tests stub a refusal where they need one. Fictional data only.
 */
import type { ApiProblem, EditorPageDto, EditorService, PageHistoryDto, PageLockDto } from "../services/index.ts";

type Module = { story: string; x: number; y: number; w: number; h: number; locked?: boolean };

const GRID = {
  page_w_mm: 330,
  page_h_mm: 520,
  origin_mm: 15,
  column_mm: 46,
  gutter_mm: 4,
  columns: 6,
  news_top_mm: 60,
  news_bottom_mm: 500,
  snap_mm: 5,
};
const FACE = "0123456789abcdef01234567";
const span = (w: number) => w * GRID.column_mm + (w - 1) * GRID.gutter_mm;
const STORIES: Readonly<Record<string, { headline: string; articles: string[] }>> = {
  d0000000001: { headline: "गुरुवारी पाणीपुरवठा बंद", articles: ["a-00000de004"] },
  d0000000002: { headline: "Fictional market report", articles: ["a-00000000f2"] },
  d0000000003: { headline: "Fictional brief left over", articles: ["a-00000000f1"] },
};
const ME = { id: "01900000-0000-7000-8000-000000000001", name: "Fictional Editor" };

interface PageRow {
  rev: number;
  modules: Module[];
  edited: boolean;
  history: PageHistoryDto["items"];
}

export function createMockEditor(): { readonly editor: EditorService; reset(): void } {
  let pages = new Map<string, PageRow>();
  const key = (runId: string, page: number) => `${runId}:${page}`;
  const row = (runId: string, page: number): PageRow => {
    let found = pages.get(key(runId, page));
    if (!found) {
      found = {
        rev: 0,
        modules: [
          { story: "d0000000001", x: 15, y: 60, w: 4, h: 120, locked: false },
          { story: "d0000000002", x: 215, y: 60, w: 2, h: 120, locked: false },
        ],
        edited: false,
        history: [],
      };
      pages.set(key(runId, page), found);
    }
    return found;
  };
  const lock: PageLockDto = { holder: ME, mine: true, expiresAt: null, askedBy: null };
  const answer = (runId: string, page: number, saved: EditorPageDto["saved"] = null): EditorPageDto => {
    const r = row(runId, page);
    const on = new Set(r.modules.map((m) => m.story));
    return {
      runId,
      editionId: "edition-demo-2026-10-24",
      page,
      pages: [1, 2].map((n) => ({ page: n, role: n === 1 ? "front" : "inside", state: "done" })),
      rev: r.rev,
      view: {
        page,
        role: page === 1 ? "front" : "inside",
        rev: r.rev,
        modules: r.modules.map((m) => ({ ...m })),
        notes: r.modules.map((m) => ({ story: m.story, fit: "fits", by_mm: 0, ...STORIES[m.story] })),
        problems: [],
        pool: Object.entries(STORIES)
          .filter(([story]) => !on.has(story))
          .map(([story, s]) => ({ story, ...s, brief: true, on_page: null, locked: false })),
        grid: GRID,
        also_on_pages: {},
        locked_on_pages: {},
        items: [
          ...r.modules.map((m) => ({ t: "rect", x: m.x, y: m.y, w: span(m.w), h: 8, c: [0, 0, 0, 0.2] })),
          ...r.modules.map((m) => ({
            t: "text",
            f: "F0",
            s: 12,
            hs: 1,
            c: [0, 0, 0, 1],
            g: [
              [1, m.x + 2, m.y + 20],
              [2, m.x + 7, m.y + 20],
            ],
          })),
        ],
        fonts: { F0: { face: FACE, upem: 1000 } },
        fixed_items: [],
      },
      lock,
      flags: {
        filesCurrent: !r.edited,
        pagesToSave: r.edited ? [page] : [],
        pagesFailingCheck: [],
        pagesWithRepeats: [],
        pagesWithOverlaps: [],
      },
      pageState: {
        editedUnsaved: r.edited,
        needsSave: false,
        needsSaveReason: null,
        check: saved ? { passed: true, fails: 0, warnings: 1 } : null,
        stale: [],
      },
      saved,
    };
  };
  const stale = (runId: string, page: number): ApiProblem => ({
    kind: "answer",
    status: 409,
    code: "stale",
    message: "The page changed meanwhile.",
    current: answer(runId, page),
  });
  const step = (r: PageRow, cause: PageHistoryDto["items"][number]["cause"]) => {
    r.rev += 1;
    r.edited = cause !== "save";
    r.history.unshift({ rev: r.rev, cause, author: ME, createdAt: "2026-10-24T09:00:00.000+05:30", saved: null });
  };
  const editor: EditorService = {
    async open({ runId, page }) {
      return { ok: true, value: answer(runId, page) };
    },
    async get({ runId, page }) {
      return { ok: true, value: answer(runId, page) };
    },
    async change({ runId, page, change }) {
      const r = row(runId, page);
      if (change.rev !== r.rev) return { ok: false, error: stale(runId, page) };
      if (change.kind === "set") r.modules = change.modules.map((m) => ({ ...m }));
      else if (change.kind === "alternative") r.modules = r.modules.map((m, i) => ({ ...m, y: 60 + i * 130 }));
      else if (change.kind === "move") r.modules = r.modules.filter((m) => m.story !== change.story);
      if (change.kind !== "refresh") step(r, change.kind);
      return { ok: true, value: answer(runId, page) };
    },
    async save({ runId, page, rev }) {
      const r = row(runId, page);
      if (rev !== r.rev) return { ok: false, error: stale(runId, page) };
      step(r, "save");
      r.history[0] = { ...r.history[0]!, saved: { passed: true } };
      return {
        ok: true,
        value: answer(runId, page, { rev: r.rev, error: null, warnings: [{ text: "Fictional warning.", code: null, params: null }], stale: [] }),
      };
    },
    async history({ runId, page }) {
      return { ok: true, value: { items: row(runId, page).history } };
    },
    async heartbeat() {
      return { ok: true, value: lock };
    },
    async release() {
      return { ok: true, value: undefined };
    },
    async takeover() {
      return { ok: true, value: lock };
    },
    async glyphs({ ids }) {
      return { ok: true, value: { upem: 1000, glyphs: Object.fromEntries(ids.map((id) => [String(id), "M0 0H500V700H0Z"])) } };
    },
    rasterUrl() {
      return "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    },
  };
  return {
    editor,
    reset() {
      pages = new Map();
    },
  };
}
