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
          printed: { articles: {} },
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
      `insert into app.run_page (org_id, publication_id, run_id, page_no, role, state, articles, checked)
       values ($1, $2, $3, $4, $5, 'done', $6, '{"passed": true, "fails": 0, "warnings": 0}')`,
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
