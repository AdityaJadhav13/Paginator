// The page editor, hosted (docs/product/10-l2-newsroom-plan.md §1 L2.4, §2.4; the Desk's editor is the reference:
// tools/desk/static/editor.js, tools/desk/deskserver/editing.py, tools/desk/engine/deskedit.py). Three parts:
//   1. the edit gateway's wire (snake case, as Python writes it): the API's signed calls to the engine host's gateway
//      (apps/engine-worker/pgn_worker/gateway.py), which keeps one Desk EditService per publication home;
//   2. the HTTP shapes the API answers and the web reads (camel case);
//   3. the page flags (a TypeScript port of the Desk's press.press_state).
// Postgres always wins: every call carries the run's persisted state (each page's latest {rev, modules} and the run's
// text overrides), the gateway writes those files before the engine is asked, and every answer carries `edits`, the
// {rev, modules} of every page file the call changed, which the API keeps as app.page_edit revisions (append-only).
// One exception keeps revisions from going backwards: a page file whose rev is HIGHER than the state's (a change the
// engine made whose answer the API did not keep yet: a call in flight, or an answer lost to a crash) is never written
// back; the gateway reports it in `edits` instead, so the API catches up (Postgres then has it). A file at the state's
// rev or lower, or with other modules at the same rev, is rewritten from the state.
// "Update text" and a save bring the edition's live content (`live`: its text, folio and ready ads) into the run; a save
// reports the ad rasters its page prints (SavedPage.ads), which the API keeps in layout_run.ad_rasters, so the release's
// ad check passes for artwork changed after the layout once its page is updated and saved, without a new layout.
// Wording (plan §2.3): "Independent PDF/X-1a check"; never "PDF/X-valid" or "press-ready".
import { z } from "zod";

import { OrgId, Uuid7 } from "./ids.ts";
import { DeskEditionKey, DeskRunKey, DeskSlot, DeskText, RasterRef, StoredFile } from "./layout.ts";
import { PageApproval } from "./release.ts";

const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Moment = z.iso.datetime({ offset: true });
const Id = z.uuid();
const PageNo = z.number().int().min(1).max(16);
const Rev = z
  .number()
  .int()
  .min(0)
  .max(2 ** 31 - 1);
const Mm = z.number().min(-10_000).max(10_000);

// ------------------------------------------------------------------------------------------------ the gateway's wire

/** The gateway's private port on the engine host (plan §2.4). */
export const GATEWAY_PORT = 8790;
/** Request headers: X-Pgn-Time (Unix seconds, ASCII digits), X-Pgn-Nonce (32 lower-case hex, random for each request)
 * and X-Pgn-Signature (64 lower-case hex). */
export const GATEWAY_TIME_HEADER = "x-pgn-time";
export const GATEWAY_NONCE_HEADER = "x-pgn-nonce";
export const GATEWAY_SIGNATURE_HEADER = "x-pgn-signature";
/** A request older or newer than this many seconds is refused (401), and a nonce seen within it is a replay (401). */
export const GATEWAY_WINDOW_S = 60;

/** The signed text: HMAC-SHA256(secret, `${METHOD}\n${path with query}\n${time}\n${nonce}\n${hex SHA-256 of the body
 * bytes}`), as lower-case hex. The secret is PGN_GATEWAY_SECRET (at least 32 bytes, given as 64+ hex characters) on
 * both sides. */
export function gatewaySigningText(
  method: string,
  path: string,
  time: string,
  nonce: string,
  bodySha256: string,
): string {
  return `${method.toUpperCase()}\n${path}\n${time}\n${nonce}\n${bodySha256}`;
}

/** One vector both sides test against (the Python gateway's tests and the API's client tests). */
export const GATEWAY_TEST_VECTOR = {
  secret: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  method: "POST",
  path: "/v1/call",
  time: "1800000000",
  nonce: "0123456789abcdef0123456789abcdef",
  body: '{"cmd":"state"}',
  bodySha256: "81e308d450787fd147ecbd6b00c6e32af9cdd0c486301c51a2855fdd11d118a3",
  signature: "594f881860b9126515509dbb23cbd8593db76278816c9ec27efac5aedd2cf11a",
} as const;

/** A story's module on a page (deskedit's module): x and y its top-left corner in mm, w its width in grid columns, h its
 * height in mm. locked and crop are the module's attributes (kept as the engine gives them back). */
export const EditModule = z.looseObject({
  story: z.string().regex(/^(d[0-9a-f]{10}|dbriefs[0-9]{1,3})$/),
  x: Mm,
  y: Mm,
  w: z.number().int().min(1).max(40),
  h: Mm,
  locked: z.boolean().optional(),
  crop: z.unknown().optional(),
});
export type EditModule = z.infer<typeof EditModule>;
const Modules = z.array(EditModule).max(40);

/** A page's persisted state: its latest revision (0: the layout's own, no edit yet). */
export const PageEditState = z.strictObject({ page: PageNo, rev: Rev, modules: Modules });
export type PageEditState = z.infer<typeof PageEditState>;

/** The run's text overrides (edit-articles.json's "articles": {article id: the article in the Desk's shape, or null when it
 * was deleted}). */
export const TextOverrides = z.record(z.string().regex(/^a-[0-9a-f]{10}$/), z.unknown().nullable());

export const EDIT_COMMANDS = ["open", "state", "set", "alternative", "refresh", "move", "save", "check"] as const;
export const EditCommand = z.enum(EDIT_COMMANDS);
export type EditCommand = z.infer<typeof EditCommand>;
export const EDIT_CALL_FORMAT = "pageinator.edit-call/1";

/** POST /v1/call (signed). The gateway checks the run's working files are in the home (request.json, plan.json,
 * printed.json, the page's manifest; else 409 editor.run_missing), writes `state` (each page's edit file whose
 * {rev, modules} differ from the file, and edit-articles.json when `text` differs; an open page whose file it rewrote is
 * opened again, reload), and for refresh and save first writes the edition's live `articles`, `edition` and `ads` (with
 * their photo and ad rasters, pinned, as a layout's request names them) to editions/<edition>/, so "Update text" brings
 * the edition's current ads onto the page as it brings its text. Then the engine command:
 *  open → the engine's open (draw); state → state; set → set(modules, base_rev); alternative → alternative(variant,
 *  base_rev); refresh → refresh(base_rev); move → move(story, to, base_rev);
 *  save → the Desk's save: state, refused when a story is locked elsewhere, export(base_rev), the page's previews
 *  (render_page), the run's page PDFs merged into edition.pdf and press-files.zip, each stored under
 *  runs/<run_id>/pages/NN/edit-<rev>.{pdf,png,thumb.png} and runs/<run_id>/edition.pdf, press-files.zip, and the
 *  SHA-256 of each ad raster the page prints (SavedPage.ads, which the API keeps in layout_run.ad_rasters);
 *  check → the independent PDF/X-1a check of the page's PDF `pdf` (pinned), its report stored beside it. */
export const EditCall = z.strictObject({
  format: z.literal(EDIT_CALL_FORMAT),
  org_id: OrgId,
  pub_id: Uuid7,
  run_id: Uuid7,
  edition_key: DeskEditionKey,
  run_key: DeskRunKey,
  page: PageNo,
  cmd: EditCommand,
  base_rev: Rev.nullable(),
  modules: Modules.optional(),
  variant: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  story: z
    .string()
    .regex(/^(d[0-9a-f]{10}|dbriefs[0-9]{1,3})$/)
    .optional(),
  to: PageNo.optional(),
  /** check: the saved PDF to check */
  pdf: StoredFile.optional(),
  state: z.strictObject({
    pages: z.array(PageEditState).max(16),
    text: TextOverrides.nullable(),
    /** save: each page's PDF as Postgres holds it (app.run_page.pdf). edition.pdf and press-files.zip are made from the
     * saved page and these: a local page PDF whose SHA-256 differs (a save whose answer was lost) is replaced by the
     * stored version, and a page not named is left out. */
    pdfs: z
      .array(z.strictObject({ page: PageNo, pdf: StoredFile }))
      .max(16)
      .optional(),
  }),
  /** refresh and save: the edition's live content in the Desk's shape (a layout request's `edition`, `articles` and
   * `ads`, built now: modules/layout/request.ts frozenRequest) */
  live: z
    .strictObject({
      edition: z.record(z.string(), z.unknown()),
      articles: z.array(z.unknown()).max(2000),
      ads: z.record(
        DeskSlot,
        z.strictObject({
          width_px: z.number().int().min(1).max(100_000),
          height_px: z.number().int().min(1).max(100_000),
          ppi: z.number().int().min(1).max(10_000),
          raster: RasterRef,
        }),
      ),
    })
    .optional(),
});
export type EditCall = z.infer<typeof EditCall>;

/** What a save stored and found. */
export const SavedPage = z.strictObject({
  rev: Rev,
  /** null: the page's PDF could not be stored (error says so); the answer's `edits` still stand */
  pdf: StoredFile.nullable(),
  png: StoredFile.nullable(),
  thumb: StoredFile.nullable(),
  edition_pdf: StoredFile.nullable(),
  press_zip: StoredFile.nullable(),
  /** the Desk's article ids the page prints now */
  articles: z.array(z.string().regex(/^a-[0-9a-f]{10}$/)).max(200),
  /** other pages a story was taken from: page → their article ids now */
  pages_changed: z.record(z.string().regex(/^([1-9]|1[0-6])$/), z.array(z.string())),
  /** what the page prints (deskprinted) */
  printed: z.record(z.string(), z.unknown()).nullable(),
  /** each ad slot of the page: the SHA-256 of the ad raster it prints, null when it prints none or the run's raster
   * is not provably the one printed (an older gateway's answer without it: none) */
  ads: z.record(DeskSlot, Sha256.nullable()).default({}),
  /** the problem kinds a print file must never have (overlap, outside; "unreadable" fails closed) */
  layout_problems: z.array(z.string().max(40)).max(20),
  /** the page card's warnings after the save (editing._warnings and deskprinted.unset) */
  warnings: z.array(DeskText).max(50),
  /** why the page prints older content than the edition holds now (deskprinted.stale); [] when current */
  stale: z.array(DeskText).max(50),
  /** a step after the export failed (previews, merge): the page stays "needs saving" with these words */
  error: DeskText.nullable(),
});
export type SavedPage = z.infer<typeof SavedPage>;

export const CheckedPage = z.strictObject({
  passed: z.boolean(),
  fails: z.number().int().min(0).nullable(),
  warnings: z.number().int().min(0).nullable(),
  report: StoredFile.nullable(),
  checker_sha256: Sha256,
});
export type CheckedPage = z.infer<typeof CheckedPage>;

/** The gateway's answer. ok: `result` is the engine's answer as it is (a display list for open/set/alternative/refresh/
 * move: {page, role, rev, modules, notes, problems, pool, grid, also_on_pages, locked_on_pages, items, fonts,
 * fixed_items, msgs?, …}), `edits` every page file the call changed ({rev, modules}, this page's and others': a move's
 * target, a save's pages a story was taken from), `text` the run's overrides when the call changed them. Not ok: the
 * engine's refusal or the gateway's (status 400 refused, 409 stale (a change on an older revision: the page is
 * reloaded) or run_missing, 503 engine unavailable), in the Desk's words. */
export const EditAnswer = z.union([
  z.strictObject({
    ok: z.literal(true),
    result: z.record(z.string(), z.unknown()),
    edits: z.array(PageEditState).max(16),
    text: TextOverrides.nullable(),
    saved: SavedPage.optional(),
    checked: CheckedPage.optional(),
  }),
  z.strictObject({
    ok: z.literal(false),
    status: z.union([z.literal(400), z.literal(409), z.literal(503)]),
    code: z.enum(["refused", "stale", "run_missing", "engine"]),
    error: DeskText,
  }),
]);
export type EditAnswer = z.infer<typeof EditAnswer>;

/** GET /v1/glyphs/<org>/<pub>/<face>?ids=1,2,3 (signed) → {upem, glyphs: {gid: SVG path data in font units, y up}}.
 * GET /v1/raster/<org>/<pub>/<key>.jpg (signed) → image/jpeg. face and key: 24 lower-case hex. */
export const GlyphOutlines = z.strictObject({
  upem: z.number().int().min(16).max(16384),
  glyphs: z.record(z.string().regex(/^[0-9]{1,5}$/), z.string()),
});
export type GlyphOutlines = z.infer<typeof GlyphOutlines>;
export const FACE_KEY = /^[0-9a-f]{24}$/;

// ------------------------------------------------------------------------------------------------ the page flags

/** One page's inputs to the press rule (press.press_state's per-page fields). */
export const PageFlagsInput = z.strictObject({
  page: PageNo,
  state: z.enum(["waiting", "working", "done", "failed", "cancelled"]),
  articles: z.array(z.string()),
  needsSave: z.boolean(),
  editedUnsaved: z.boolean(),
  stale: z.array(z.unknown()),
  checkPassed: z.boolean(),
  edited: z.boolean(),
  layoutProblems: z.array(z.string()).nullable(),
  layoutProblemsNow: z.array(z.string()).nullable(),
});
export type PageFlagsInput = z.infer<typeof PageFlagsInput>;

/** press.press_state, renamed for the screen's wording: filesCurrent (the Desk's press_ready) means only that the run's
 * files print what the edition holds now and each passed the independent check; never "press-ready". */
export const PressFlags = z.strictObject({
  filesCurrent: z.boolean(),
  pagesToSave: z.array(PageNo),
  pagesFailingCheck: z.array(PageNo),
  pagesWithRepeats: z.array(PageNo),
  pagesWithOverlaps: z.array(PageNo),
});
export type PressFlags = z.infer<typeof PressFlags>;

/** press.PLACEMENT, and "unreadable" (editing.placement's fail-closed kind, which press.py itself does not count: the
 * port counts it, as editing.py's docstring says it should). */
const PLACEMENT = new Set(["overlap", "outside", "unreadable"]);

/** press.press_state (tools/desk/deskserver/press.py), page by page. An edited page saved by an older Desk without
 * layout_problems is not a case here (hosted pages always carry the list); a list that is not a list fails closed. */
export function pressFlags(runState: string, pages: readonly PageFlagsInput[]): PressFlags {
  const sorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);
  const done = pages.filter((p) => p.state === "done");
  const unsaved = sorted(pages.filter((p) => p.needsSave || p.editedUnsaved || p.stale.length > 0).map((p) => p.page));
  const unchecked = sorted(done.filter((p) => !p.checkPassed).map((p) => p.page));
  const on = new Map<string, number[]>();
  for (const p of done) for (const a of new Set(p.articles)) on.set(a, [...(on.get(a) ?? []), p.page]);
  const repeats = sorted([...on.values()].filter((w) => w.length > 1).flat());
  const placement = (p: PageFlagsInput) =>
    [p.layoutProblems, p.layoutProblemsNow].some(
      (kinds) => kinds !== null && (!Array.isArray(kinds) || kinds.some((k) => PLACEMENT.has(k))),
    );
  const overlaps = sorted(done.filter(placement).map((p) => p.page));
  const filesCurrent =
    runState === "done" &&
    pages.length > 0 &&
    pages.every((p) => p.state === "done") &&
    !unsaved.length &&
    !unchecked.length &&
    !repeats.length &&
    !overlaps.length;
  return {
    filesCurrent,
    pagesToSave: unsaved,
    pagesFailingCheck: unchecked,
    pagesWithRepeats: repeats,
    pagesWithOverlaps: overlaps,
  };
}

// ------------------------------------------------------------------------------------------------ the API's HTTP shapes
// Routes (all under /api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n; layout.edit, except GET … which needs pages.view):
//   POST   …/edit            open the page (takes the soft lock when free) → EditorPage
//   GET    …/edit            the page as the engine holds it now (drawn, after catching up) → EditorPage
//   POST   …/edit/change     EditChange → EditorPage; 409 stale (with `current`: the page now), 409 page_locked
//   POST   …/edit/save       {rev} → EditorPage with `saved`; the check runs (or is read from app.pdf_check)
//   GET    …/edit/history    → PageHistory
//   POST   …/edit/lock       heartbeat (every 30 s) → PageLock; DELETE …/edit/lock releases it
//   POST   …/edit/takeover   ask to take over (the holder sees it; it is the asker's after 30 s unanswered) → PageLock
// GET /api/v1/orgs/:o/pubs/:p/runs/:r/glyphs/:face?ids=… (pages.view) → GlyphOutlines; …/runs/:r/rasters/:key.jpg →
// image/jpeg: from the organisation's own home, through the gateway.

export const EditChange = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("set"), rev: Rev, modules: Modules }),
  z.strictObject({
    kind: z.literal("alternative"),
    rev: Rev,
    variant: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  }),
  /** "Update text": the stories' current text (their latest revisions) set on the page */
  z.strictObject({ kind: z.literal("refresh"), rev: Rev }),
  /** a story of this page moved to another page of the run */
  z.strictObject({
    kind: z.literal("move"),
    rev: Rev,
    story: z.string().regex(/^(d[0-9a-f]{10}|dbriefs[0-9]{1,3})$/),
    to: PageNo,
  }),
]);
export type EditChange = z.infer<typeof EditChange>;
export const EditSave = z.strictObject({ rev: Rev });

export const PageLock = z.strictObject({
  /** who holds the page now (null: nobody) */
  holder: z.strictObject({ id: Id, name: z.string() }).nullable(),
  /** the caller holds it */
  mine: z.boolean(),
  expiresAt: Moment.nullable(),
  /** someone asked to take over (shown to the holder) */
  askedBy: z.strictObject({ id: Id, name: z.string() }).nullable(),
});
export type PageLock = z.infer<typeof PageLock>;

/** The page in the editor: the engine's display list as it came (`view`: draw's result, the Desk's shape, read by the
 * editor's canvas port), the run's other pages (for "move to page"), the lock, the flags and, after a save, its result. */
export const EditorPage = z.strictObject({
  runId: Id,
  editionId: Id,
  page: PageNo,
  pages: z.array(z.strictObject({ page: PageNo, role: z.string(), state: z.string() })).max(16),
  rev: Rev,
  view: z.record(z.string(), z.unknown()),
  lock: PageLock,
  flags: PressFlags,
  /** this page: changed and not saved, needs saving (with why), the independent check of its saved PDF */
  pageState: z.strictObject({
    editedUnsaved: z.boolean(),
    needsSave: z.boolean(),
    needsSaveReason: DeskText.nullable(),
    check: z
      .strictObject({ passed: z.boolean(), fails: z.number().nullable(), warnings: z.number().nullable() })
      .nullable(),
    stale: z.array(DeskText),
  }),
  saved: z
    .strictObject({ rev: Rev, error: DeskText.nullable(), warnings: z.array(DeskText), stale: z.array(DeskText) })
    .nullable(),
  /** the page's approval that counts now (L2.5): while it stands the page is locked (changes answer 409
   * page_approved) until someone with page.unlock unlocks it */
  approval: PageApproval.nullable(),
});
export type EditorPage = z.infer<typeof EditorPage>;

export const PAGE_EDIT_CAUSES = [
  "set",
  "alternative",
  "refresh",
  "move",
  "moved_in",
  "save",
  "taken",
  "engine",
] as const;
export const PageEditCause = z.enum(PAGE_EDIT_CAUSES);

export const PageHistory = z.strictObject({
  items: z
    .array(
      z.strictObject({
        rev: Rev,
        cause: PageEditCause,
        author: z.strictObject({ id: Id, name: z.string() }).nullable(),
        createdAt: Moment,
        /** a save of this revision: its check */
        saved: z.strictObject({ passed: z.boolean() }).nullable(),
      }),
    )
    .max(500),
});
export type PageHistory = z.infer<typeof PageHistory>;
