// The page editor's routes (docs/product/10-l2-newsroom-plan.md §1 L2.4, §2.4; packages/contracts/src/editor.ts), under
// /api/v1/orgs/:o/pubs/:p/runs/:r. Every call to the edit gateway carries the run's persisted state (each page's latest
// revision and the text overrides: Postgres always wins), and every answer's `edits` are kept as page revisions
// (a revision already kept is the same one: a catch-up), with the page flags of the Desk's editing.py.
//   - POST pages/:n/edit (layout.edit): open the page (cmd open; the soft lock taken when free) → EditorPage.
//   - GET pages/:n/edit (pages.view): the page now (cmd open: drawn, catching up) → EditorPage. Every EditorPage's view
//     is a drawn one (open or a change's answer); cmd state serves only the save's own checks.
//   - POST pages/:n/edit/change (layout.edit) EditChange → EditorPage. A change on an older revision: 409 stale with the
//     page now; while another person holds the page's lock: 409 page_locked with the lock. A move marks the page it
//     goes to "needs saving" first, and takes the mark back when the engine refuses it.
//   - POST pages/:n/edit/save (layout.edit) {rev} → EditorPage with `saved`: the page's state first (its revision must
//     be `rev`; the pages it takes stories from; a story locked elsewhere leaves the refusal to the gateway, nothing
//     marked), those pages and this one marked "needs saving" (the marks taken back when the gateway refuses), the
//     gateway's save, then the page's files, flags and the run's edition.pdf and press-files.zip; then the independent
//     check, read from app.pdf_check when these bytes were checked before, else asked of the gateway (cmd check) and
//     kept. Moves and saves of one run take turns (Database.withLock), so a save never clears a move's newer mark.
//   - GET pages/:n/edit/history (pages.view) → PageHistory.
//   - POST pages/:n/edit/lock (layout.edit): take or beat the lock (it lapses 75 s after the last beat; the web beats
//     every 30 s); the person who asked to take it over gets it once the ask is 30 s old → PageLock. DELETE releases.
//   - POST pages/:n/edit/takeover (layout.edit): ask for the lock (taken at once when nobody holds it) → PageLock.
//   - GET glyphs/:face?ids=… and rasters/:key.jpg (pages.view): the engine's glyph outlines and placed pictures,
//     through the gateway, kept by the browser (private, immutable: a font instance or a raster never changes).
// Pages are changed only once their layout run and the page are done (409 not_editable). layout.edit's ◐ cells (text
// only, images only, ads only) are not applied yet: only those who hold it fully may change a page. Without the
// gateway's settings every route answers 503 editor_unavailable.
import {
  EDIT_CALL_FORMAT,
  type EditAnswer,
  type EditCall,
  EditChange,
  type EditCommand,
  EditorPage,
  EditSave,
  FACE_KEY,
  PageHistory,
  PageLock,
  type StoredFile,
} from "@pageinator/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { recordAudit } from "../../db/audit.ts";
import {
  type Cause,
  type EditRun,
  afterSave,
  askLock,
  beforeSave,
  type Mark,
  cachedCheck,
  editPages,
  editRun,
  holdLock,
  lockOf,
  markNeedsSave,
  noteRevs,
  pageHistory,
  pagePdfs,
  persistedState,
  recordPageCheck,
  recordSave,
  releaseLock,
  storeEdits,
  storeText,
  unmark,
} from "../../db/editor.ts";
import { layoutEdition, layoutStories, recordCheck } from "../../db/layout.ts";
import type { Database } from "../../db/pools.ts";
import type { Tenant, Tx } from "../../db/tenant.ts";
import { ApiError } from "../../http/errors.ts";
import { type Access, accessOf, auditRefusals, refused } from "../access/access.ts";
import { frozenRequest } from "../layout/request.ts";
import type { Gateway } from "./gateway.ts";
import { UNFINISHED, editorPage, lockView, movedFrom, movedHere, placement, taking } from "./views.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = /^([1-9]|1[0-6])$/;
const IDS = /^[0-9]{1,5}(,[0-9]{1,5}){0,1999}$/;
const RASTER = /^([0-9a-f]{24})\.jpg$/;
const HISTORY_SHOWN = 500;
const IMMUTABLE = "private, max-age=31536000, immutable";

const OnePage = z.strictObject({ o: z.string(), p: z.string(), r: z.string(), n: z.string() });
const Glyphs = z.strictObject({ o: z.string(), p: z.string(), r: z.string(), face: z.string() });
const Raster = z.strictObject({ o: z.string(), p: z.string(), r: z.string(), file: z.string() });

export type EditorOptions = { database: Database; gateway: Gateway | undefined };

type Ok = Extract<EditAnswer, { ok: true }>;
const CAUSE: Partial<Record<EditCommand, Cause>> = {
  set: "set",
  alternative: "alternative",
  refresh: "refresh",
  move: "move",
  save: "save",
};
/** The answers whose result is the page's display list (its rev and problems). */
const DRAWN = new Set<EditCommand>(["open", "state", "set", "alternative", "refresh", "move"]);

const pageOf = (n: string) => {
  if (!PAGE.test(n)) throw new ApiError("not_found");
  return Number(n);
};

/** A refusal of the gateway or the engine, as the API answers it (stale is the caller's: it needs the page now). */
function refusal(answer: Extract<EditAnswer, { ok: false }>): ApiError {
  if (answer.code === "run_missing") return new ApiError("run_missing");
  if (answer.code === "refused")
    return new ApiError("edit_refused", [{ field: "page", message: answer.error.text }], answer.error);
  if (answer.code === "stale") return new ApiError("stale");
  return Object.assign(new ApiError("editor_unavailable"), { reason: answer.error.text });
}

export const editorRoutes: FastifyPluginAsyncZod<EditorOptions> = async (app, { database, gateway }) => {
  auditRefusals(app, database);

  const need = () => {
    if (!gateway) throw new ApiError("editor_unavailable");
    return gateway;
  };
  const fully = (access: Access) => {
    if (access.reach !== "full") throw refused("layout.edit's limited cells are not applied yet: only full holders");
  };

  /** The run and its pages: the run done and the page done, or 409 not_editable. */
  async function editable(tx: Tx, pub: string, r: string, n: number) {
    const run = UUID.test(r) ? await editRun(tx, pub, r) : undefined;
    if (!run) throw new ApiError("not_found");
    const pages = await editPages(tx, pub, r);
    const row = pages.find((p) => p.page_no === n);
    if (!row) throw new ApiError("not_found");
    if (run.state !== "done" || row.state !== "done") throw new ApiError("not_editable");
    return { run, pages };
  }

  /** Someone else holds a live lock: 409 page_locked; otherwise the caller takes or beats it. */
  async function holdOrRefuse(tx: Tx, tenant: Tenant, pub: string, r: string, n: number) {
    const lock = await lockOf(tx, pub, r, n, true);
    if (lock?.live && lock.holder_id !== tenant.userId)
      throw new ApiError("page_locked", undefined, lockView(lock, tenant.userId));
    await holdLock(tx, tenant, pub, r, n);
  }

  /** A move or a save of run r, one at a time (the marks of one never cross the other's). */
  const oneAtATime = <T>(r: string, fn: () => Promise<T>) => database.withLock(`editor:${r}`, fn);

  /** The edition's live content in the Desk's shape, as a layout request would hold it now. */
  async function liveOf(tx: Tx, pub: string, editionId: string) {
    const edition = await layoutEdition(tx, pub, editionId);
    if (!edition) throw new ApiError("not_found");
    const doc = frozenRequest(edition, await layoutStories(tx, pub, editionId), undefined, []);
    return { edition: doc.edition, articles: doc.articles };
  }

  async function callOf(
    tx: Tx,
    tenant: Tenant,
    pub: string,
    run: EditRun,
    n: number,
    cmd: EditCommand,
    extra: Partial<EditCall> = {},
  ): Promise<EditCall> {
    return {
      format: EDIT_CALL_FORMAT,
      org_id: tenant.orgId,
      pub_id: pub,
      run_id: run.id,
      edition_key: run.edition_key,
      run_key: run.desk_key,
      page: n,
      cmd,
      base_rev: null,
      state: {
        ...(await persistedState(tx, pub, run.id)),
        ...(cmd === "save" ? { pdfs: await pagePdfs(tx, pub, run.id) } : {}),
      },
      ...(cmd === "refresh" || cmd === "save" ? { live: await liveOf(tx, pub, run.edition_id) } : {}),
      ...extra,
    };
  }

  /** An answer kept: its revisions, the text overrides, and the pages' "changed, not saved" marks. */
  async function keep(
    tx: Tx,
    tenant: Tenant,
    pub: string,
    run: EditRun,
    n: number,
    cmd: EditCommand,
    answer: Ok,
    causes: ReadonlyMap<number, Cause> = new Map(),
  ) {
    const own = CAUSE[cmd] ?? "engine";
    await storeEdits(tx, tenant, pub, run.id, answer.edits, (page) =>
      page === n ? own : (causes.get(page) ?? "engine"),
    );
    if (answer.text !== null) await storeText(tx, tenant, pub, run.id, answer.text);
    const revs = new Map<number, number>();
    for (const edit of answer.edits) revs.set(edit.page, Math.max(edit.rev, revs.get(edit.page) ?? 0));
    const drawn = DRAWN.has(cmd);
    const rev = answer.result["rev"];
    if (drawn && typeof rev === "number" && Number.isInteger(rev)) revs.set(n, Math.max(rev, revs.get(n) ?? 0));
    await noteRevs(tx, pub, run.id, revs, drawn ? { page: n, kinds: placement(answer.result["problems"]) } : undefined);
  }

  async function pageNow(tx: Tx, tenant: Tenant, pub: string, run: EditRun, n: number, view: Record<string, unknown>) {
    const pages = await editPages(tx, pub, run.id);
    return editorPage(run, pages, n, view, lockView(await lockOf(tx, pub, run.id, n), tenant.userId));
  }

  /** The page as the engine holds it now (open: drawn, for the web; state: the save's own checks), its newer revisions
   * kept → [the run, the answer]. */
  async function pageCall(tenant: Tenant, pub: string, r: string, n: number, cmd: "open" | "state") {
    const g = need();
    const { run, call } = await database.withTenant(tenant, async (tx) => {
      const { run } = await editable(tx, pub, r, n);
      return { run, call: await callOf(tx, tenant, pub, run, n, cmd) };
    });
    const answer = await g.call(call);
    if (!answer.ok) throw refusal(answer);
    await database.withTenant(tenant, (tx) => keep(tx, tenant, pub, run, n, cmd, answer));
    return { run, answer };
  }

  /** 409 stale, with the page as it is now (when the gateway can say). */
  async function stale(tenant: Tenant, pub: string, r: string, n: number): Promise<ApiError> {
    try {
      const { run, answer } = await pageCall(tenant, pub, r, n, "open");
      const current = await database.withTenant(tenant, (tx) => pageNow(tx, tenant, pub, run, n, answer.result));
      return new ApiError("stale", undefined, current);
    } catch {
      return new ApiError("stale");
    }
  }

  // ------------------------------------------------------------------------------------------ the page

  app.post(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit",
    { config: { permission: "layout.edit" }, schema: { params: OnePage, response: { 200: EditorPage } } },
    async (request) => {
      const access = accessOf(request);
      fully(access);
      const tenant = access.tenant;
      const { p: pub, r } = request.params;
      const n = pageOf(request.params.n);
      const g = need();
      const { run, call } = await database.withTenant(tenant, async (tx) => {
        const { run } = await editable(tx, pub, r, n);
        const lock = await lockOf(tx, pub, r, n, true);
        if (!lock?.live || lock.holder_id === tenant.userId) await holdLock(tx, tenant, pub, r, n);
        return { run, call: await callOf(tx, tenant, pub, run, n, "open") };
      });
      const answer = await g.call(call);
      if (!answer.ok) throw answer.code === "stale" ? await stale(tenant, pub, r, n) : refusal(answer);
      return database.withTenant(tenant, async (tx) => {
        await keep(tx, tenant, pub, run, n, "open", answer);
        return pageNow(tx, tenant, pub, run, n, answer.result);
      });
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit",
    { config: { permission: "pages.view" }, schema: { params: OnePage, response: { 200: EditorPage } } },
    async (request) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, r } = request.params;
      const n = pageOf(request.params.n);
      const { run, answer } = await pageCall(tenant, pub, r, n, "open");
      return database.withTenant(tenant, (tx) => pageNow(tx, tenant, pub, run, n, answer.result));
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit/change",
    {
      config: { permission: "layout.edit" },
      schema: { params: OnePage, body: EditChange, response: { 200: EditorPage } },
    },
    async (request) => {
      const access = accessOf(request);
      fully(access);
      const tenant = access.tenant;
      const { p: pub, r } = request.params;
      const n = pageOf(request.params.n);
      const change = request.body;
      const g = need();
      const extra: Partial<EditCall> =
        change.kind === "set"
          ? { modules: change.modules }
          : change.kind === "alternative"
            ? { variant: change.variant }
            : change.kind === "move"
              ? { story: change.story, to: change.to }
              : {};
      const apply = async () => {
        const { run, call, mark } = await database.withTenant(tenant, async (tx) => {
          const { run, pages } = await editable(tx, pub, r, n);
          await holdOrRefuse(tx, tenant, pub, r, n);
          let mark: Mark | undefined;
          if (change.kind === "move") {
            const target = pages.find((p) => p.page_no === change.to);
            if (change.to === n || !target || target.state !== "done") {
              throw new ApiError("invalid_request", [
                { field: "body.to", message: "The story can go only to another page of this layout that is laid out." },
              ]);
            }
            // marked before the engine is asked: an engine or server that stops part-way leaves it marked
            mark = await markNeedsSave(tx, pub, r, change.to, movedHere(n));
          }
          return {
            run,
            mark,
            call: await callOf(tx, tenant, pub, run, n, change.kind, { ...extra, base_rev: change.rev }),
          };
        });
        const answer = await g.call(call);
        if (!answer.ok) {
          if (mark && answer.status !== 503) await database.withTenant(tenant, (tx) => unmark(tx, pub, r, [mark]));
          throw answer.code === "stale" ? await stale(tenant, pub, r, n) : refusal(answer);
        }
        const causes = new Map<number, Cause>(change.kind === "move" ? [[change.to, "moved_in"]] : []);
        return database.withTenant(tenant, async (tx) => {
          await keep(tx, tenant, pub, run, n, change.kind, answer, causes);
          return pageNow(tx, tenant, pub, run, n, answer.result);
        });
      };
      return change.kind === "move" ? oneAtATime(r, apply) : apply();
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit/save",
    {
      config: { permission: "layout.edit" },
      schema: { params: OnePage, body: EditSave, response: { 200: EditorPage } },
    },
    async (request) => {
      const access = accessOf(request);
      fully(access);
      const tenant = access.tenant;
      const { p: pub, r } = request.params;
      const n = pageOf(request.params.n);
      const { rev } = request.body;
      const g = need();
      await database.withTenant(tenant, async (tx) => {
        await editable(tx, pub, r, n);
        await holdOrRefuse(tx, tenant, pub, r, n);
      });
      const { run, saved } = await oneAtATime(r, async () => {
        // the page now: its revision must be the one saved, and it names the pages this save takes stories from
        const { run, answer: state } = await pageCall(tenant, pub, r, n, "state");
        if (state.result["rev"] !== rev) throw await stale(tenant, pub, r, n);
        const also = state.result["also_on_pages"];
        const others = [
          ...new Set(
            Object.values(also !== null && typeof also === "object" ? also : {}).filter(
              (x): x is number => Number.isInteger(x) && x !== n,
            ),
          ),
        ].sort((a, b) => a - b);
        // a story locked on another page (or a list that cannot be read): the gateway refuses in the Desk's words, and
        // nothing is marked first (deskserver/api.py _save)
        const held = state.result["locked_on_pages"];
        const refusing =
          held !== undefined && held !== null && (typeof held !== "object" || Object.keys(held).length > 0);
        const { call, marks } = await database.withTenant(tenant, async (tx) => {
          const marks: Mark[] = refusing
            ? []
            : await beforeSave(
                tx,
                pub,
                r,
                n,
                UNFINISHED,
                others.map((page) => ({ page, why: taking(n) })),
              );
          return { marks, call: await callOf(tx, tenant, pub, run, n, "save", { base_rev: rev }) };
        });
        const answer = await g.call(call);
        if (!answer.ok) {
          // refused before anything was written: the marks go back (an engine that stopped leaves them, as the Desk)
          if (answer.status !== 503) await database.withTenant(tenant, (tx) => unmark(tx, pub, r, marks));
          throw answer.code === "stale" ? await stale(tenant, pub, r, n) : refusal(answer);
        }
        const saved = answer.saved;
        if (!saved) throw new Error("the gateway's save answered no saved page");
        const folder = `orgs/${tenant.orgId}/pubs/${pub}/runs/${r}/`;
        const files = [saved.pdf, saved.png, saved.thumb, saved.edition_pdf, saved.press_zip];
        if (!files.every((file) => file === null || file.key.startsWith(folder)))
          throw new Error("the gateway's save named a file outside the run");
        const causes = new Map<number, Cause>(Object.keys(saved.pages_changed).map((page) => [Number(page), "taken"]));
        await database.withTenant(tenant, async (tx) => {
          await keep(tx, tenant, pub, run, n, "save", answer, causes);
          await afterSave(tx, tenant, pub, r, n, saved, movedFrom);
          if (saved.pdf) await recordSave(tx, tenant, pub, r, n, saved.rev, saved.pdf.sha256);
          await recordAudit(tx, tenant, {
            action: "editor.page_save",
            targetType: "layout_run",
            targetId: r,
            publicationId: pub,
            data: { page: n, rev: saved.rev },
          });
        });
        return { run, saved };
      });
      if (saved.pdf) await check(tenant, pub, run, n, saved.pdf, g);
      const { answer: view } = await pageCall(tenant, pub, r, n, "open");
      return database.withTenant(tenant, async (tx) => ({
        ...(await pageNow(tx, tenant, pub, run, n, view.result)),
        saved: { rev: saved.rev, error: saved.error, warnings: saved.warnings, stale: saved.stale },
      }));
    },
  );

  /** The saved PDF's independent check: app.pdf_check's verdict on these bytes, else the gateway's (kept) → passed, or
   * null when it could not run now (the page then shows no check; the next save asks again). */
  async function check(tenant: Tenant, pub: string, run: EditRun, n: number, pdf: StoredFile, g: Gateway) {
    const sha = pdf.sha256;
    const cached = await database.withTenant(tenant, async (tx) =>
      run.checker_sha256 ? cachedCheck(tx, sha, run.checker_sha256) : undefined,
    );
    if (cached) {
      const verdict = { passed: cached.passed, fails: cached.fails, warnings: cached.warnings };
      const report =
        cached.report_key && cached.report_version_id
          ? { key: cached.report_key, version_id: cached.report_version_id }
          : null;
      await database.withTenant(tenant, (tx) => recordPageCheck(tx, pub, run.id, n, sha, verdict, report));
      return verdict.passed;
    }
    let answer: EditAnswer;
    try {
      const call = await database.withTenant(tenant, (tx) => callOf(tx, tenant, pub, run, n, "check", { pdf }));
      answer = await g.call(call);
    } catch (error) {
      if (error instanceof ApiError && error.code === "editor_unavailable") return null;
      throw error;
    }
    if (!answer.ok || !answer.checked) return null;
    const checked = answer.checked;
    const verdict = { passed: checked.passed, fails: checked.fails, warnings: checked.warnings };
    await database.withTenant(tenant, async (tx) => {
      await recordCheck(tx, tenant.orgId, {
        sha256: sha,
        checkerSha256: checked.checker_sha256,
        ...verdict,
        report: checked.report,
      });
      await recordPageCheck(tx, pub, run.id, n, sha, verdict, checked.report);
    });
    return verdict.passed;
  }

  app.get(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit/history",
    { config: { permission: "pages.view" }, schema: { params: OnePage, response: { 200: PageHistory } } },
    async (request) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, r } = request.params;
      const n = pageOf(request.params.n);
      return database.withTenant(tenant, async (tx) => {
        const run = UUID.test(r) ? await editRun(tx, pub, r) : undefined;
        if (!run) throw new ApiError("not_found");
        const rows = await pageHistory(tx, pub, r, n, HISTORY_SHOWN);
        return {
          items: rows.map((row) => ({
            rev: row.rev,
            cause: row.cause,
            author: row.author_id !== null ? { id: row.author_id, name: row.author_name ?? "" } : null,
            createdAt: row.created_at.toISOString(),
            saved: row.saved_passed === null ? null : { passed: row.saved_passed },
          })),
        };
      });
    },
  );

  // ------------------------------------------------------------------------------------------ the soft lock

  /** The page's lock, for a page that can be edited. */
  async function lockRoute(access: Access, pub: string, r: string, n: number, act: (tx: Tx) => Promise<void>) {
    fully(access);
    const tenant = access.tenant;
    return database.withTenant(tenant, async (tx) => {
      await editable(tx, pub, r, n);
      await act(tx);
      return lockView(await lockOf(tx, pub, r, n), tenant.userId);
    });
  }

  app.post(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit/lock",
    { config: { permission: "layout.edit" }, schema: { params: OnePage, response: { 200: PageLock } } },
    async (request) => {
      const access = accessOf(request);
      const tenant = access.tenant;
      const { p: pub, r } = request.params;
      const n = pageOf(request.params.n);
      return lockRoute(access, pub, r, n, async (tx) => {
        const lock = await lockOf(tx, pub, r, n, true);
        if (!lock?.live || lock.holder_id === tenant.userId) return holdLock(tx, tenant, pub, r, n);
        // an ask unanswered for 30 s: the asker's next beat takes the page over
        if (lock.asked_by !== tenant.userId || !lock.ask_due) return;
        await holdLock(tx, tenant, pub, r, n);
        await recordAudit(tx, tenant, {
          action: "editor.page_takeover",
          targetType: "layout_run",
          targetId: r,
          publicationId: pub,
          data: { page: n, from: lock.holder_id },
        });
      });
    },
  );

  app.delete(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit/lock",
    { config: { permission: "layout.edit" }, schema: { params: OnePage } },
    async (request, reply) => {
      const access = accessOf(request);
      const { p: pub, r } = request.params;
      const n = pageOf(request.params.n);
      fully(access);
      await database.withTenant(access.tenant, async (tx) => {
        const run = UUID.test(r) ? await editRun(tx, pub, r) : undefined;
        if (!run) throw new ApiError("not_found");
        await releaseLock(tx, access.tenant, pub, r, n);
      });
      return reply.status(204).send();
    },
  );

  app.post(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/pages/:n/edit/takeover",
    { config: { permission: "layout.edit" }, schema: { params: OnePage, response: { 200: PageLock } } },
    async (request) => {
      const access = accessOf(request);
      const tenant = access.tenant;
      const { p: pub, r } = request.params;
      const n = pageOf(request.params.n);
      return lockRoute(access, pub, r, n, async (tx) => {
        const lock = await lockOf(tx, pub, r, n, true);
        if (!lock?.live || lock.holder_id === tenant.userId) return holdLock(tx, tenant, pub, r, n);
        await askLock(tx, tenant, pub, r, n);
      });
    },
  );

  // ------------------------------------------------------------------------------------------ what the canvas draws with

  /** The run, so that only someone who reaches it reaches its publication's home. */
  async function reachRun(tenant: Tenant, pub: string, r: string) {
    const run = UUID.test(r) ? await database.withTenant(tenant, (tx) => editRun(tx, pub, r)) : undefined;
    if (!run) throw new ApiError("not_found");
  }

  app.get(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/glyphs/:face",
    {
      config: { permission: "pages.view", immutable: true },
      schema: { params: Glyphs, querystring: z.strictObject({ ids: z.string() }) },
    },
    async (request, reply) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, r, face } = request.params;
      const { ids } = request.query;
      if (!FACE_KEY.test(face)) throw new ApiError("not_found");
      if (!IDS.test(ids))
        throw new ApiError("invalid_request", [
          { field: "query.ids", message: "Glyph ids must be up to 2000 numbers." },
        ]);
      const g = need();
      await reachRun(tenant, pub, r);
      const outlines = await g.glyphs(tenant.orgId, pub, face, ids);
      if (!outlines) throw new ApiError("not_found");
      return reply.header("cache-control", IMMUTABLE).type("application/json").send(JSON.stringify(outlines));
    },
  );

  app.get(
    "/api/v1/orgs/:o/pubs/:p/runs/:r/rasters/:file",
    { config: { permission: "pages.view", immutable: true }, schema: { params: Raster } },
    async (request, reply) => {
      const tenant = accessOf(request).tenant;
      const { p: pub, r, file } = request.params;
      const key = RASTER.exec(file)?.[1];
      if (!key) throw new ApiError("not_found");
      const g = need();
      await reachRun(tenant, pub, r);
      const jpeg = await g.raster(tenant.orgId, pub, key);
      if (!jpeg) throw new ApiError("not_found");
      return reply.header("cache-control", IMMUTABLE).type("image/jpeg").send(jpeg);
    },
  );
};
