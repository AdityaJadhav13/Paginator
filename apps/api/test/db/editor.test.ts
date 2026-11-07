// The page editor on the API's side (docs/product/10-l2-newsroom-plan.md §1 L2.4, §2.4; migration 2026_12_03_0001),
// on a migrated clone, with the edit gateway stubbed by a small HTTP server in this file: it checks every request's
// signature as the gateway does and answers as a fictional engine would (its revisions per page; a change on an older
// one refused as stale), unless a test sets the next answer itself. Who may do what, another organisation, revisions
// kept once, the soft lock and its takeover, a move's marks, a save and its check (from app.pdf_check when the bytes
// were checked before), the history, the glyph and raster proxies, and the gateway down or not set up.
import { createHash, timingSafeEqual } from "node:crypto";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type EditCall,
  EditCall as EditCallSchema,
  GATEWAY_NONCE_HEADER,
  GATEWAY_SIGNATURE_HEADER,
  GATEWAY_TEST_VECTOR,
  GATEWAY_TIME_HEADER,
} from "@pageinator/contracts";
import type { Client, Notification } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signature } from "../../src/modules/editor/gateway.ts";
import { articleSig } from "../../src/modules/editor/printed.ts";
import { freshDatabase } from "./helpers.ts";
import { FROM_APP, type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const SECRET = GATEWAY_TEST_VECTOR.secret;
const CHECKER = "c".repeat(64);
const STORY = "d0123456789";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

// ------------------------------------------------------------------------------------------------ the gateway stub

const calls: EditCall[] = [];
/** each page's revision as the fictional engine holds it */
const engineRev = new Map<number, number>();
let next: ((call: EditCall) => unknown) | undefined;
/** a test's own answers, kept until it clears them (undefined: the engine's, or next's) */
let hook: ((call: EditCall) => unknown) | undefined;
const nonces = new Set<string>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function file(call: EditCall, name: string) {
  const key = `orgs/${call.org_id}/pubs/${call.pub_id}/runs/${call.run_id}/${name}`;
  return { key, version_id: `v-${name}`, sha256: sha(key), bytes: 100 };
}

function engine(call: EditCall): unknown {
  const n = call.page;
  const stored = (p: number) => call.state.pages.find((s) => s.page === p)?.rev ?? 0;
  const rev = (p: number) => Math.max(engineRev.get(p) ?? 0, stored(p));
  // a drawn view (open and the changes: the engine's draw) has items and fonts; state's has not
  const drawn = call.cmd !== "state";
  const view = (p: number) => ({
    page: p,
    rev: rev(p),
    modules: [],
    problems: [],
    also_on_pages: {},
    ...(drawn ? { items: [], fonts: {} } : {}),
  });
  const ok = (edits: unknown[] = [], extra = {}) => ({ ok: true, result: view(n), edits, text: null, ...extra });
  const stale = {
    ok: false,
    status: 409,
    code: "stale",
    error: { text: "Changed elsewhere.", code: null, params: null },
  };
  const bump = (p: number) => {
    engineRev.set(p, rev(p) + 1);
    return { page: p, rev: rev(p), modules: p === n ? (call.modules ?? []) : [] };
  };
  switch (call.cmd) {
    case "open":
    case "state":
      return ok();
    case "set":
    case "alternative":
    case "refresh":
      return call.base_rev !== rev(n) ? stale : ok([bump(n)]);
    case "move":
      return call.base_rev !== rev(n) ? stale : ok([bump(n), bump(call.to ?? 0)]);
    case "save":
      if (call.base_rev !== rev(n)) return stale;
      return ok([], {
        result: { rev: rev(n) },
        saved: {
          rev: rev(n),
          pdf: { ...file(call, `pages/0${n}/edit-${rev(n)}.pdf`), sha256: sha(`pdf ${n} ${rev(n)}`) },
          png: file(call, `pages/0${n}/edit-${rev(n)}.png`),
          thumb: file(call, `pages/0${n}/edit-${rev(n)}.thumb.png`),
          edition_pdf: file(call, "edition.pdf"),
          press_zip: file(call, "press-files.zip"),
          articles: ["a-0000000001"],
          pages_changed: {},
          printed: { v: 3, articles: {} },
          layout_problems: [],
          warnings: [],
          stale: [],
          error: null,
        },
      });
    case "check":
      return ok([], {
        result: {},
        checked: {
          passed: true,
          fails: 0,
          warnings: 2,
          report: file(call, "pages/01/check.txt"),
          checker_sha256: CHECKER,
        },
      });
  }
}

let gateway: Server;
let gatewayUrl = "";

// ------------------------------------------------------------------------------------------------ the newsroom

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
const { call } = n;
let a: Org;
let b: Org;
let ownerId: string;
let designer: Person;
let chief: Person;
let viewer: Person;
let reporter: Person;
let sub: Person;
let runId = "";
let pending = "";
const page = (p = 1, run = runId, org = a) => `/api/v1/orgs/${org.orgId}/pubs/${org.pubId}/runs/${run}/pages/${p}`;

beforeAll(async () => {
  gateway = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", async () => {
      const body = Buffer.concat(chunks);
      const time = String(request.headers[GATEWAY_TIME_HEADER] ?? "");
      const nonce = String(request.headers[GATEWAY_NONCE_HEADER] ?? "");
      const given = Buffer.from(String(request.headers[GATEWAY_SIGNATURE_HEADER] ?? ""), "hex");
      const want = Buffer.from(signature(SECRET, request.method ?? "", request.url ?? "", time, nonce, body), "hex");
      if (given.length !== want.length || !timingSafeEqual(given, want) || nonces.has(nonce))
        return response.writeHead(401).end();
      nonces.add(nonce);
      if (request.url?.startsWith("/v1/glyphs/")) {
        return response.end(JSON.stringify({ upem: 1000, glyphs: { "7": "M0 0L1 1Z" } }));
      }
      if (request.url?.startsWith("/v1/raster/")) return response.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      const edit = EditCallSchema.parse(JSON.parse(body.toString("utf8")));
      calls.push(edit);
      const answer = (await hook?.(edit)) ?? (next ? next(edit) : engine(edit));
      next = undefined;
      const status = (answer as { status?: number }).status ?? 200;
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  gatewayUrl = `http://127.0.0.1:${(gateway.address() as AddressInfo).port}`;
  it_ = await identityApp(db, { PGN_GATEWAY_URL: gatewayUrl, PGN_GATEWAY_SECRET: SECRET });
  su = await db.connect("postgres");
  a = await n.organisation();
  b = await n.organisation();
  ownerId = await n.userId(a.owner);
  const as = (role: string) => [{ publicationId: a.pubId, roles: [role], grants: [] }];
  designer = await n.member(a, as("page_designer"), "member", "designer");
  chief = await n.member(a, as("chief_editor"), "member", "chief");
  viewer = await n.member(a, as("viewer"), "member", "viewer");
  reporter = await n.member(a, as("reporter"), "member", "reporter");
  sub = await n.member(a, as("sub_editor"), "member", "sub");
  runId = await run("done", "2027-02-01");
  pending = await run("layout", "2027-02-02");
}, 90_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
  await new Promise<void>((resolve) => gateway.close(() => resolve()));
});

/** A layout run of a new edition of org a with four pages, made as the superuser. */
async function run(state: "done" | "layout", date: string): Promise<string> {
  const edition = await su.query<{ id: string }>(
    `insert into app.edition (org_id, publication_id, edition_date, desk_key, pages)
     values ($1, $2, $3::date, $3::text, 4) returning id`,
    [a.orgId, a.pubId, date],
  );
  const made = await su.query<{ id: string }>(
    `insert into app.layout_run (org_id, publication_id, edition_id, desk_key, state, finished_at, created_by,
       checker_sha256)
     values ($1, $2, $3, 'r-20270201-101500', $4, case when $4 = 'done' then now() end, $5, $6) returning id`,
    [a.orgId, a.pubId, edition.rows[0]?.id, state, ownerId, CHECKER],
  );
  const id = made.rows[0]?.id ?? "";
  for (const p of [1, 2, 3, 4]) {
    await su.query(
      // printed: a record of no article (these tests are not about what the pages print: printed.ts has its own)
      `insert into app.run_page (org_id, publication_id, run_id, page_no, role, state, articles, checked, printed)
       values ($1, $2, $3, $4, $5, 'done', $6, '{"passed": true, "fails": 0, "warnings": 0}', '{"v": 3, "articles": {}}')`,
      [a.orgId, a.pubId, id, p, p === 1 ? "front" : p === 4 ? "back" : "inside", JSON.stringify([`a-000000000${p}`])],
    );
  }
  return id;
}

const pageRow = async (p: number) =>
  (await su.query("select * from app.run_page where run_id = $1 and page_no = $2", [runId, p])).rows[0] as Record<
    string,
    unknown
  >;
const edits = async (p: number) =>
  (
    await su.query<{ rev: number; cause: string; author_id: string | null }>(
      "select rev, cause, author_id from app.page_edit where run_id = $1 and page_no = $2 order by rev",
      [runId, p],
    )
  ).rows;
const set = (who: Person, rev: number, p = 1) =>
  call("POST", `${page(p)}/edit/change`, who.cookie, {
    kind: "set",
    rev,
    modules: [{ story: STORY, x: 0, y: 0, w: 2, h: 50 }],
  });
const code = (reply: { json(): unknown }) => (reply.json() as { error: { code: string; current?: unknown } }).error;

// ------------------------------------------------------------------------------------------------ the tests

describe("who may edit a page", () => {
  it("another organisation finds nothing", async () => {
    const other = { ...a, ownerCookie: b.ownerCookie };
    expect((await call("GET", `${page(1)}/edit`, b.ownerCookie)).statusCode).toBe(404);
    expect((await call("POST", `${page(1)}/edit`, other.ownerCookie)).statusCode).toBe(404);
    // org b's own publication with org a's run id: the walls find no run
    const theirs = `/api/v1/orgs/${b.orgId}/pubs/${b.pubId}/runs/${runId}/pages/1`;
    expect((await call("GET", `${theirs}/edit`, b.ownerCookie)).statusCode).toBe(404);
    expect(
      (
        await call(
          "GET",
          `/api/v1/orgs/${b.orgId}/pubs/${b.pubId}/runs/${runId}/glyphs/${"a".repeat(24)}?ids=1`,
          b.ownerCookie,
        )
      ).statusCode,
    ).toBe(404);
  });

  it("refuses a viewer, a reporter and a sub-editor's limited cell; a viewer still sees the page", async () => {
    for (const who of [viewer, reporter, sub]) {
      expect((await call("POST", `${page(1)}/edit`, who.cookie)).statusCode, who.email).toBe(403);
      expect((await set(who, 0)).statusCode, who.email).toBe(403);
      expect((await call("POST", `${page(1)}/edit/lock`, who.cookie)).statusCode, who.email).toBe(403);
    }
    const seen = await call("GET", `${page(1)}/edit`, viewer.cookie);
    expect(seen.statusCode).toBe(200);
    expect(seen.json()).toMatchObject({ page: 1, rev: 0, lock: { holder: null, mine: false } });
  });

  it("refuses a page whose layout has not finished", async () => {
    const reply = await call("POST", `${page(1, pending)}/edit`, designer.cookie);
    expect([reply.statusCode, code(reply).code]).toEqual([409, "not_editable"]);
  });
});

describe("editing a page", () => {
  it("opens the page, taking its lock, with the run's flags", async () => {
    const reply = await call("POST", `${page(1)}/edit`, designer.cookie);
    expect(reply.statusCode).toBe(200);
    const body = reply.json();
    expect(body).toMatchObject({
      runId,
      page: 1,
      rev: 0,
      lock: { holder: { id: designer.id }, mine: true },
      pageState: { editedUnsaved: false, needsSave: false },
    });
    expect(body.flags).toEqual({
      filesCurrent: true,
      pagesToSave: [],
      pagesFailingCheck: [],
      pagesWithRepeats: [],
      pagesWithOverlaps: [],
    });
    expect(body.pages).toHaveLength(4);
    expect(calls.at(-1)).toMatchObject({ cmd: "open", base_rev: null, state: { pages: [], text: null } });
  });

  it("keeps a change as a revision and marks the page changed, not saved", async () => {
    const reply = await set(designer, 0);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ rev: 1, pageState: { editedUnsaved: true }, flags: { pagesToSave: [1] } });
    expect(await edits(1)).toEqual([{ rev: 1, cause: "set", author_id: designer.id }]);
    expect(await pageRow(1)).toMatchObject({ rev_seen: 1, edited_unsaved: true, layout_problems_now: [] });
    // the next call carries it: Postgres always wins
    await set(designer, 1);
    expect(calls.at(-1)?.state.pages).toEqual([
      { page: 1, rev: 1, modules: [{ story: STORY, x: 0, y: 0, w: 2, h: 50 }] },
    ]);
  });

  it("refuses a change on an older revision with the page as it is now", async () => {
    const reply = await set(designer, 0);
    expect(reply.statusCode).toBe(409);
    expect(code(reply)).toMatchObject({ code: "stale", current: { page: 1, rev: 2 } });
  });

  it("keeps each revision once, and catches up on those the gateway reports", async () => {
    next = () => ({
      ok: true,
      result: { page: 1, rev: 3, modules: [], problems: [{ kind: "overlap" }] },
      edits: [
        { page: 1, rev: 2, modules: [] }, // already kept
        { page: 1, rev: 3, modules: [] }, // the API stopped before it kept this one
      ],
      text: { "a-0000000001": null },
    });
    engineRev.set(1, 3);
    const reply = await call("GET", `${page(1)}/edit`, viewer.cookie);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ rev: 3, flags: { pagesWithOverlaps: [1] } });
    expect(await edits(1)).toEqual([
      { rev: 1, cause: "set", author_id: designer.id },
      { rev: 2, cause: "set", author_id: designer.id },
      { rev: 3, cause: "engine", author_id: null },
    ]);
    const text = await su.query("select overrides from app.run_text_override where run_id = $1", [runId]);
    expect(text.rows[0]?.overrides).toEqual({ "a-0000000001": null });
    await call("GET", `${page(1)}/edit`, viewer.cookie);
    expect(calls.at(-1)?.state.text).toEqual({ "a-0000000001": null });
  });

  it("marks the page a story moves to, and takes the mark back when the engine refuses", async () => {
    next = () => ({ ok: false, status: 400, code: "refused", error: { text: "No room.", code: null, params: null } });
    const refused = await call("POST", `${page(1)}/edit/change`, designer.cookie, {
      kind: "move",
      rev: 3,
      story: STORY,
      to: 2,
    });
    expect([refused.statusCode, code(refused).code]).toEqual([400, "edit_refused"]);
    expect(code(refused).current).toEqual({ text: "No room.", code: null, params: null });
    expect(await pageRow(2)).toMatchObject({ needs_save: false, needs_save_why: null });
    const moved = await call("POST", `${page(1)}/edit/change`, designer.cookie, {
      kind: "move",
      rev: 3,
      story: STORY,
      to: 2,
    });
    expect(moved.statusCode).toBe(200);
    expect(await pageRow(2)).toMatchObject({
      needs_save: true,
      edited_unsaved: true,
      needs_save_why: { code: "m.save.movedHere", params: { page: 1 } },
    });
    expect(await edits(2)).toEqual([{ rev: 1, cause: "moved_in", author_id: designer.id }]);
    const self = await call("POST", `${page(1)}/edit/change`, designer.cookie, {
      kind: "move",
      rev: 4,
      story: STORY,
      to: 1,
    });
    expect(self.statusCode).toBe(400);
  });
});

describe("the soft lock", () => {
  it("refuses another person's change while the lock is held, and hands it over 30 s after an ask", async () => {
    const locked = await set(chief, 4);
    expect(locked.statusCode).toBe(409);
    expect(code(locked)).toMatchObject({ code: "page_locked", current: { holder: { id: designer.id }, mine: false } });
    const ask = await call("POST", `${page(1)}/edit/takeover`, chief.cookie);
    expect(ask.json()).toMatchObject({ holder: { id: designer.id }, mine: false, askedBy: { id: chief.id } });
    // the holder sees the ask; the asker's beat does not take it yet
    expect((await call("POST", `${page(1)}/edit/lock`, designer.cookie)).json()).toMatchObject({
      mine: true,
      askedBy: { id: chief.id },
    });
    expect((await call("POST", `${page(1)}/edit/lock`, chief.cookie)).json()).toMatchObject({ mine: false });
    await su.query("update app.page_lock set asked_at = now() - interval '31 seconds' where run_id = $1", [runId]);
    const taken = await call("POST", `${page(1)}/edit/lock`, chief.cookie);
    expect(taken.json()).toMatchObject({ holder: { id: chief.id }, mine: true, askedBy: null });
    const audit = await su.query("select data from app.audit_event where action = 'editor.page_takeover'");
    expect(audit.rows[0]?.data).toMatchObject({ page: 1, from: designer.id });
    expect((await set(designer, 4)).statusCode).toBe(409);
  });

  it("lapses 75 s after the last beat, and is released", async () => {
    await su.query("update app.page_lock set expires_at = now() - interval '1 second' where run_id = $1", [runId]);
    expect((await call("GET", `${page(1)}/edit`, viewer.cookie)).json()).toMatchObject({ lock: { holder: null } });
    expect((await set(designer, 4)).statusCode).toBe(200); // a lapsed lock: the change takes it
    const released = await call("DELETE", `${page(1)}/edit/lock`, designer.cookie);
    expect(released.statusCode).toBe(204);
    expect((await su.query("select 1 from app.page_lock where run_id = $1", [runId])).rowCount).toBe(0);
  });
});

describe("the live hint", () => {
  it("is sent when a lock is taken or released, not at each beat", async () => {
    const heard: string[] = [];
    const hear = (note: Notification) => void heard.push(note.payload ?? "");
    su.on("notification", hear);
    await su.query("listen app_events");
    try {
      await call("POST", `${page(3)}/edit/lock`, designer.cookie); // taken
      await call("POST", `${page(3)}/edit/lock`, designer.cookie); // a beat
      await call("DELETE", `${page(3)}/edit/lock`, designer.cookie); // released
      await sleep(200);
      expect(heard).toHaveLength(2);
    } finally {
      await su.query("unlisten app_events");
      su.off("notification", hear);
    }
  });
});

describe("saving a page", () => {
  const checks = () => calls.filter((c) => c.cmd === "check").length;

  it("refuses a save of another revision than the page's now", async () => {
    const reply = await call("POST", `${page(1)}/edit/save`, designer.cookie, { rev: 2 });
    expect([reply.statusCode, code(reply).code]).toEqual([409, "stale"]);
  });

  it("records the page's files and the check, and reads the check of the same bytes from app.pdf_check", async () => {
    const before = checks();
    const reply = await call("POST", `${page(1)}/edit/save`, designer.cookie, { rev: 5 });
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({
      rev: 5,
      saved: { rev: 5, error: null, warnings: [], stale: [] },
      pageState: { editedUnsaved: false, needsSave: false, check: { passed: true, fails: 0, warnings: 2 } },
    });
    expect(calls.filter((c) => c.cmd === "save").at(-1)?.live?.edition).toMatchObject({ pages: 4 });
    expect(checks()).toBe(before + 1);
    const row = await pageRow(1);
    expect(row).toMatchObject({ pdf_rev: 5, edited: true, pdf_sha256: sha("pdf 1 5"), saved_by: designer.id });
    expect(row["checked"]).toEqual({ passed: true, fails: 0, warnings: 2 });
    const runRow = await su.query("select edition_pdf from app.layout_run where id = $1", [runId]);
    expect(runRow.rows[0]?.edition_pdf).toMatchObject({ version_id: "v-edition.pdf" });
    // the same bytes again: the verdict is read, not asked for
    const again = await call("POST", `${page(1)}/edit/save`, designer.cookie, { rev: 5 });
    expect(again.json()).toMatchObject({ pageState: { check: { passed: true } } });
    expect(checks()).toBe(before + 1);
    const audit = await su.query("select data from app.audit_event where action = 'editor.page_save'");
    expect(audit.rows[0]?.data).toEqual({ page: 1, rev: 5 });
  });

  it("lists the page's revisions newest first, with their authors and saves", async () => {
    const reply = await call("GET", `${page(1)}/edit/history`, viewer.cookie);
    expect(reply.statusCode).toBe(200);
    const items = reply.json().items as { rev: number; cause: string; author: unknown; saved: unknown }[];
    expect(items.map((i) => i.rev)).toEqual([5, 4, 3, 2, 1]);
    expect(items[0]).toMatchObject({ cause: "set", author: { id: designer.id }, saved: { passed: true } });
    expect(items[1]).toMatchObject({ cause: "move", saved: null });
    expect(items[2]).toMatchObject({ cause: "engine", author: null });
  });
});

describe("what the web is answered", () => {
  const drawn = (body: unknown) => (body as { view: Record<string, unknown> }).view;

  it("is a drawn view (items and fonts) for the page now, a save and a stale change", async () => {
    expect(drawn((await call("GET", `${page(1)}/edit`, viewer.cookie)).json())).toHaveProperty("items");
    const saved = await call("POST", `${page(1)}/edit/save`, designer.cookie, { rev: 5 });
    expect(drawn(saved.json())).toMatchObject({ items: [], fonts: {} });
    expect(calls.at(-1)?.cmd).toBe("open");
    const stale = await set(designer, 0);
    expect(drawn(code(stale).current)).toHaveProperty("items");
  });

  it("a save refused marks nothing: its marks go back, and a story locked elsewhere marks none", async () => {
    const before = await pageRow(1);
    const no = { ok: false, status: 400, code: "refused", error: { text: "Held.", code: "m.save.held", params: null } };
    hook = (c) => (c.cmd === "save" ? no : undefined);
    const refused = await call("POST", `${page(1)}/edit/save`, designer.cookie, { rev: 5 });
    expect([refused.statusCode, code(refused).code]).toEqual([400, "edit_refused"]);
    expect(await pageRow(1)).toMatchObject({ needs_save: false, needs_save_why: null, checked: before["checked"] });
    let markedThen: unknown;
    hook = async (c) => {
      if (c.cmd === "state") {
        const locked = { [STORY]: 3 };
        return {
          ok: true,
          result: { page: 1, rev: 5, also_on_pages: locked, locked_on_pages: locked },
          edits: [],
          text: null,
        };
      }
      if (c.cmd !== "save") return undefined;
      markedThen = [(await pageRow(1))["needs_save"], (await pageRow(3))["needs_save"]];
      return no;
    };
    try {
      const held = await call("POST", `${page(1)}/edit/save`, designer.cookie, { rev: 5 });
      expect([held.statusCode, code(held).code]).toEqual([400, "edit_refused"]);
    } finally {
      hook = undefined;
    }
    expect(markedThen).toEqual([false, false]);
  });

  it("a move waits for a save of its run, so the save never clears the move's mark", async () => {
    const rev2 = (await call("GET", `${page(2)}/edit`, viewer.cookie)).json().rev as number;
    hook = async (c) => {
      if (c.cmd === "save") await sleep(400); // the save is slow at the gateway
      return undefined;
    };
    try {
      const saving = call("POST", `${page(2)}/edit/save`, designer.cookie, { rev: rev2 });
      await sleep(150);
      const moving = call("POST", `${page(1)}/edit/change`, designer.cookie, {
        kind: "move",
        rev: 5,
        story: STORY,
        to: 2,
      });
      const [saved, moved] = await Promise.all([saving, moving]);
      expect([saved.statusCode, moved.statusCode]).toEqual([200, 200]);
    } finally {
      hook = undefined;
    }
    expect(await pageRow(2)).toMatchObject({ needs_save: true, needs_save_why: { code: "m.save.movedHere" } });
  });
});

describe("what the canvas draws with", () => {
  const files = () => `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/runs/${runId}`;

  it("proxies glyph outlines and rasters, kept by the browser", async () => {
    const glyphs = await call("GET", `${files()}/glyphs/${"ab".repeat(12)}?ids=7,8`, viewer.cookie);
    expect(glyphs.statusCode).toBe(200);
    expect(glyphs.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    expect(glyphs.json()).toEqual({ upem: 1000, glyphs: { "7": "M0 0L1 1Z" } });
    const raster = await call("GET", `${files()}/rasters/${"cd".repeat(12)}.jpg`, viewer.cookie);
    expect([raster.statusCode, raster.headers["content-type"], raster.rawPayload.length]).toEqual([
      200,
      "image/jpeg",
      4,
    ]);
    expect((await call("GET", `${files()}/glyphs/nothex?ids=1`, viewer.cookie)).statusCode).toBe(404);
    const bad = await call("GET", `${files()}/glyphs/${"ab".repeat(12)}?ids=1;2`, viewer.cookie);
    expect([bad.statusCode, bad.headers["cache-control"]]).toEqual([400, "no-store"]);
    expect((await call("GET", `${files()}/rasters/${"cd".repeat(12)}.png`, viewer.cookie)).statusCode).toBe(404);
  });
});

describe("without the gateway", () => {
  it("answers 503 editor_unavailable when it is down or not set up", async () => {
    const down = await identityApp(db, { PGN_GATEWAY_URL: "http://127.0.0.1:9", PGN_GATEWAY_SECRET: SECRET });
    const off = await identityApp(db);
    try {
      for (const app of [down, off]) {
        for (const [method, url, cookie, payload] of [
          ["GET", `${page(1)}/edit`, viewer.cookie, undefined],
          ["POST", `${page(1)}/edit`, designer.cookie, undefined],
          ["POST", `${page(1)}/edit/save`, designer.cookie, { rev: 6 }],
        ] as const) {
          const headers = { cookie, ...(method === "POST" ? FROM_APP : {}) };
          const reply = await app.app.inject({
            method,
            url,
            headers,
            ...(method === "POST" ? { payload: { ...payload } } : {}),
          });
          expect([reply.statusCode, (reply.json() as { error: { code: string } }).error.code], url).toEqual([
            503,
            "editor_unavailable",
          ]);
        }
      }
    } finally {
      await down.close();
      await off.close();
    }
  });
});

describe("what a save counts again", () => {
  const reason = (code: string) => ({ code, params: null, text: expect.any(String) });
  /** A run of a new edition (its pages print a-0000000001 … a-0000000004), and its edition. */
  async function freshRun(date: string) {
    const id = await run("done", date);
    const edition = await su.query<{ edition_id: string }>("select edition_id from app.layout_run where id = $1", [id]);
    return { id, editionId: edition.rows[0]?.edition_id ?? "" };
  }
  /** A story of the edition (a ready one is in the live content the save is sent). */
  async function story(editionId: string, desk: string, status = "ready") {
    const { rows } = await su.query<{ id: string }>(
      `insert into app.story (org_id, publication_id, edition_id, desk_key, status, reporter_id, language)
       values ($1, $2, $3, $4, $6, $5, 'mr') returning id`,
      [a.orgId, a.pubId, editionId, desk, ownerId, status],
    );
    await su.query(
      `insert into app.story_revision (org_id, publication_id, story_id, rev, headline, body, words, author_id)
       values ($1, $2, $3, 1, 'काल्पनिक बातमी (fictional)', 'शब्द शब्द', 2, $4)`,
      [a.orgId, a.pubId, rows[0]?.id, ownerId],
    );
  }
  /** Saves page p of run r at its revision now, the engine answering with the changes given. */
  async function save(r: string, p: number, change: Record<string, unknown>) {
    const rev = (await call("GET", `${page(p, r)}/edit`, viewer.cookie)).json().rev as number;
    hook = (c) => {
      if (c.cmd !== "save") return undefined;
      const answer = engine(c) as { saved: Record<string, unknown> };
      return { ...answer, saved: { ...answer.saved, ...change } };
    };
    try {
      const reply = await call("POST", `${page(p, r)}/edit/save`, designer.cookie, { rev });
      expect(reply.statusCode, reply.body).toBe(200);
    } finally {
      hook = undefined;
    }
  }
  const runRow = async (r: string) =>
    (await su.query("select not_placed, ad_rasters from app.layout_run where id = $1", [r])).rows[0] as {
      not_placed: unknown;
      ad_rasters: unknown;
    };

  it("lists the run's articles on no page after a save, as the Desk does; one back on a page leaves the list", async () => {
    const { id: r, editionId } = await freshRun("2027-02-05");
    // the layout left out a-0000000005; a-0000000003 was deleted from the edition after it
    const left = { article: "a-0000000005", reason: { text: "It did not fit.", code: null, params: null } };
    await su.query("update app.layout_run set not_placed = $2 where id = $1", [r, JSON.stringify([left])]);
    for (const desk of ["a-0000000001", "a-0000000004", "a-0000000005"]) await story(editionId, desk);
    await story(editionId, "a-0000000002", "held"); // still in the edition, not laid out: never "deleted"
    // page 1 now prints the story left out, and takes the stories of pages 2 and 3
    await save(r, 1, { articles: ["a-0000000001", "a-0000000005"], pages_changed: { "2": [], "3": [] } });
    expect(calls.filter((c) => c.cmd === "save").at(-1)?.live?.articles).toHaveLength(3);
    expect((await runRow(r)).not_placed).toEqual([
      { article: "a-0000000002", reason: reason("m.save.notPlacedEdited") },
      { article: "a-0000000003", reason: reason("m.save.deletedAfter") },
    ]);
    // a-0000000002 brought back onto page 1; the earlier entries keep their reasons
    await save(r, 1, { articles: ["a-0000000001", "a-0000000005", "a-0000000002"] });
    expect((await runRow(r)).not_placed).toEqual([{ article: "a-0000000003", reason: reason("m.save.deletedAfter") }]);
    const tab = await call(
      "GET",
      `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/editions/${editionId}/release`,
      chief.cookie,
    );
    const item = tab.json().preflight.items.find((i: { check: string }) => i.check === "not_placed");
    expect(item.stories.map((s: { deskKey: string }) => s.deskKey)).toEqual(["a-0000000003"]);
  });

  it("marks a page whose story changed after the layout: it needs saving, its approval and the release are refused, until it is saved", async () => {
    const { id: r, editionId } = await freshRun("2027-02-07");
    const key = (p: number) => `a-00000000${p}7`; // stories of this test's own (desk keys are one per publication)
    for (const p of [1, 2, 3, 4]) await story(editionId, key(p));
    const sigOf = (body: string) => articleSig({ headline: "काल्पनिक बातमी (fictional)", body }, false);
    const printed = (p: number, body: string) => ({
      v: 3,
      articles: { [key(p)]: sigOf(body) },
      folio: null,
      ads: {},
    });
    // each page prints its story as laid out (the engine's record, which run.finished keeps)
    for (const p of [1, 2, 3, 4]) {
      const pdf = { key: `laid-out-${p}.pdf`, version_id: "v", sha256: sha(`laid out ${p}`), bytes: 100 };
      await su.query(
        "update app.run_page set articles = $6, printed = $3, pdf = $4, pdf_sha256 = $5 where run_id = $1 and page_no = $2",
        [r, p, printed(p, "शब्द शब्द"), pdf, pdf.sha256, JSON.stringify([key(p)])],
      );
    }
    const base = `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}`;
    const board = async () => (await call("GET", `${base}/runs/${r}`, viewer.cookie)).json().pages[0];
    const tab = async () => (await call("GET", `${base}/editions/${editionId}/release`, chief.cookie)).json();
    const approve = (rev: number, pdfSha256: string) =>
      call("POST", `${base}/runs/${r}/pages/1/approve`, chief.cookie, { rev, pdfSha256 });
    expect(await board()).toMatchObject({ needsSave: false, needsSaveReasons: [] });
    // page 1's story corrected after the layout, whatever path wrote it (here straight in the database)
    const { rows } = await su.query<{ id: string }>(
      "select id from app.story where edition_id = $1 and desk_key = $2",
      [editionId, key(1)],
    );
    await su.query("update app.story_revision set body = 'नवे शब्द' where story_id = $1", [rows[0]?.id]);
    // the board and the editor say it, with the Desk's reason; the release refuses: saved fails, no approval
    expect(await board()).toMatchObject({ needsSave: true, needsSaveReasons: [reason("m.press.changed1")] });
    expect((await call("GET", `${page(1, r)}/edit`, viewer.cookie)).json().pageState.stale).toEqual([
      reason("m.press.changed1"),
    ]);
    const before = await tab();
    expect(before.preflight.items.find((i: { check: string }) => i.check === "saved")).toMatchObject({
      state: "failed",
      pages: [1],
    });
    expect(before.pages[0]).toMatchObject({ page: 1, needsSave: true });
    expect((await approve(before.pages[0].rev, before.pages[0].pdfSha256)).statusCode).toBe(409);
    // Update text and Save: the page prints the new text (the engine's record of it) and is current again
    await save(r, 1, { articles: [key(1)], printed: printed(1, "नवे शब्द") });
    expect(await board()).toMatchObject({ needsSave: false, needsSaveReasons: [] });
    const after = await tab();
    expect(after.preflight.items.find((i: { check: string }) => i.check === "saved").pages).not.toContain(1);
    expect(after.pages[0]).toMatchObject({ page: 1, needsSave: false });
    expect((await approve(after.pages[0].rev, after.pages[0].pdfSha256)).statusCode).toBe(200);
  });

  it("keeps the ad rasters a saved page prints, so the release's ad check passes without a new layout", async () => {
    const { id: r, editionId } = await freshRun("2027-02-06");
    await su.query("update app.edition set back_page_ads = true where id = $1", [editionId]);
    await su.query("update app.layout_run set ad_rasters = $2 where id = $1", [r, { "back-1": "d".repeat(64) }]);
    // the profile in use plans back-1 on page 4; the slot's artwork was replaced after the layout (ready now)
    const upload = await su.query<{ id: string }>(
      `insert into app.upload (org_id, publication_id, user_id, purpose, declared_type, declared_bytes, expires_at)
       values ($1, $2, $3, 'engine_dataset', 'application/zip', 100, now()) returning id`,
      [a.orgId, a.pubId, ownerId],
    );
    const plan = {
      pages: 4,
      back_page_ads: true,
      page_plan: [
        {
          page: 4,
          role: "back",
          template_role: "back",
          news_mm2: 1,
          ad_slots: [{ slot: "back-1", w_mm: 120, h_mm: 80 }],
        },
      ],
    };
    await su.query(
      `insert into app.engine_profile (org_id, publication_id, version, state, upload_id, dataset_sha256, dataset_bytes,
         config_version_id, config_sha256, engine_version, templates, grid, plans, created_by)
       values ($1, $2, 1, 'ready', $3, $4, 100, 'v1', $4, 'desk-engine/fictional', '{}', '{}', $5, $6)`,
      [a.orgId, a.pubId, upload.rows[0]?.id, "a".repeat(64), JSON.stringify([plan]), ownerId],
    );
    const asset = await su.query<{ id: string }>(
      `insert into app.asset (org_id, publication_id, desk_key, sha256, bytes, mime, width_px, height_px, uploaded_by)
       values ($1, $2, 'p-00000000a1', $3, 1024, 'image/jpeg', 945, 634, $4) returning id`,
      [a.orgId, a.pubId, "1".repeat(64), ownerId],
    );
    const raster = {
      key: `orgs/${a.orgId}/pubs/${a.pubId}/assets/x/r/ad.cmyk.gz`,
      version_id: "v1",
      sha256: "e".repeat(64),
    };
    await su.query(
      `insert into app.ad_slot_artwork (org_id, publication_id, edition_id, slot, asset_id, w_mm, h_mm, state, raster,
         set_by)
       values ($1, $2, $3, 'back-1', $4, 120, 80, 'ready', $5, $6)`,
      [a.orgId, a.pubId, editionId, asset.rows[0]?.id, { ...raster, bytes: 9, width_px: 945, height_px: 634 }, ownerId],
    );
    const adCheck = async () => {
      const tab = await call(
        "GET",
        `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/editions/${editionId}/release`,
        chief.cookie,
      );
      return tab.json().preflight.items.find((i: { check: string }) => i.check === "ad_artwork");
    };
    expect(await adCheck()).toMatchObject({ state: "failed", slots: ["back-1"], printsOld: true });
    // "Update text" and "Save" on the back page: the save is sent the ad, and answers the raster the page prints
    await save(r, 4, { ads: { "back-1": "e".repeat(64) } });
    expect(calls.filter((c) => c.cmd === "save").at(-1)?.live?.ads).toEqual({
      "back-1": { width_px: 945, height_px: 634, ppi: 200, raster: { ...raster, width_px: 945, height_px: 634 } },
    });
    expect((await runRow(r)).ad_rasters).toEqual({ "back-1": "e".repeat(64) });
    expect(await adCheck()).toMatchObject({ state: "passed", slots: [] });
    // a save whose PDF could not be stored records nothing; one that prints no ad there takes the slot out
    await save(r, 4, { ads: { "back-1": "f".repeat(64) }, pdf: null, png: null, thumb: null });
    expect((await runRow(r)).ad_rasters).toEqual({ "back-1": "e".repeat(64) });
    await save(r, 4, { ads: { "back-1": null } });
    expect((await runRow(r)).ad_rasters).toEqual({});
    expect(await adCheck()).toMatchObject({ state: "failed", slots: ["back-1"] });
  });
});
