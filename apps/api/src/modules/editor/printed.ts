// What a page prints against what the edition holds now: the articles part of the Desk's engine/deskprinted.py
// (article_sig, stale) and deskserver/press.py refresh_stale. The engine records what each page prints when it lays it
// out (runs/<run>/printed.json, kept as run_page.printed by run.finished) and when the editor saves it (the save's
// `printed`). Every read of a run's pages (the Pages board, the page editor, the release) compares those records with
// the edition's stories now, so a story changed after the layout (its text, headline, kicker, deck, byline, photo,
// caption or credit), taken out of the edition, or no longer laid out marks its page "needs saving" whatever path changed
// it; "Update text" and "Save page" clear it. The folio and the ads have release items of their own: a page's persisted
// reasons for them stay as its last save found them. The signatures are Python's, byte for byte
// (test/unit/printed.test.ts, against packages/contracts/test/fixtures/printed-sigs.json, which the worker's tests
// check against the Desk's own code); Python 3.11's NFC and white space come from @pageinator/desk-text, whose own
// parity tests cover every code point.
import { createHash } from "node:crypto";
import { deskNfc, nfc, split } from "@pageinator/desk-text";
import { type DeskTextValue, layoutEdition, layoutStories } from "../../db/layout.ts";
import type { Tx } from "../../db/tenant.ts";
import { frozenRequest } from "../layout/request.ts";
import { desk } from "./views.ts";

/** The record's way of making signatures (deskprinted.VERSION): another is never compared. */
export const PRINTED_VERSION = 3;

export const PRESS_MESSAGES = {
  "m.press.olderDesk":
    "This page was made by an older version of the Desk, which did not record what its PDF prints: lay the edition out again.",
  "m.press.olderRecord":
    "This page was made by an older version of the Desk, which recorded what its PDF prints in another way: open it in the page editor and save it (or lay out again).",
  "m.press.changed1":
    "An article on this page was changed since the page's PDF was made: open the page and save it (Save page sets the current text first).",
  "m.press.changedN":
    "{n} articles on this page were changed since the page's PDF was made: open the page and save it (Save page sets the current text first).",
  "m.press.gone1":
    "An article on this page was deleted from the edition: open the page and save it (Save page takes it off first).",
  "m.press.goneN":
    "{n} articles on this page were deleted from the edition: open the page and save it (Save page takes them off first).",
} as const;
type Code = keyof typeof PRESS_MESSAGES;
const say = (code: Code, n?: number) => desk(code, PRESS_MESSAGES[code], n === undefined ? null : { n });

/** The reasons this module decides (a page's persisted ones with these codes are replaced by today's). */
const ARTICLE_CODES = new Set<string>(Object.keys(PRESS_MESSAGES));

const str = (v: unknown) => (typeof v === "string" ? v : v ? String(v) : ""); // Python's str(v or "")
const words = (s: string) => split(s).join(" "); // " ".join(s.split())
const norm = (v: unknown) => words(nfc(str(v))); // deskprinted._n

/** deskprinted._lines: the body line by line as the engine reads it. */
function lines(body: unknown, brief: boolean): string[] {
  const out: string[] = [];
  for (const line of deskNfc(str(body)).split("\n")) {
    let s = words(line);
    if (brief && s.startsWith("##")) s = "##";
    if (s || (out.length > 0 && out.at(-1))) out.push(s);
  }
  return out;
}

/** json.dumps(value, ensure_ascii=False, sort_keys=True): Python's separators, keys sorted. */
function pyJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(pyJson).join(", ")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}: ${pyJson(v)}`).join(", ")}}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** deskprinted.article_sig: what an article prints (a short item: its headline and text only). */
export function articleSig(article: Record<string, unknown>, brief: boolean): string {
  const out: Record<string, unknown> = { headline: norm(article["headline"]), body: lines(article["body"], brief) };
  if (!brief) {
    const photo = isRecord(article["photo"]) ? article["photo"] : null;
    Object.assign(out, {
      kicker: norm(article["kicker"]),
      deck: norm(article["deck"]),
      byline: norm(article["byline"]),
      photo: photo ? [str(photo["id"]), norm(photo["caption"]), norm(photo["credit"])] : null,
    });
  }
  return createHash("sha256").update(pyJson(out), "utf8").digest("hex").slice(0, 20);
}

/** Why a page's PDF no longer prints what the edition holds ([] when it does): deskprinted.stale's articles part, and
 * press.refresh_stale's "no record" (fail closed). live: the edition's laid-out articles now, by id, in the Desk's shape
 * (the layout request's). A short item is compared as both kinds (the run's plan, which says which, stays on the engine
 * host): its record matches one of them exactly when what it prints is unchanged. */
export function articlesStale(printed: unknown, live: ReadonlyMap<string, Record<string, unknown>>): DeskTextValue[] {
  if (!isRecord(printed)) return [say("m.press.olderDesk")];
  if (printed["v"] !== PRINTED_VERSION) return [say("m.press.olderRecord")];
  const recorded = isRecord(printed["articles"]) ? printed["articles"] : {};
  const gone: string[] = [];
  const changed: string[] = [];
  for (const [id, sig] of Object.entries(recorded)) {
    const now = live.get(id);
    if (!now) gone.push(id);
    else if (sig !== articleSig(now, false) && sig !== articleSig(now, true)) changed.push(id);
  }
  const out: DeskTextValue[] = [];
  if (changed.length)
    out.push(changed.length === 1 ? say("m.press.changed1") : say("m.press.changedN", changed.length));
  if (gone.length) out.push(gone.length === 1 ? say("m.press.gone1") : say("m.press.goneN", gone.length));
  return out;
}

/** A record the Desk made, signed over the Desk's own text, signed again over the text the import stored (it cleans
 * each body as the API cleans typed text, which can join or split its lines): an article whose signature is its Desk
 * text's, of either kind, gets its hosted text's of that kind; one that differs (changed in the Desk after the page was
 * made) or that is not laid out now keeps its own, so the page still says so. */
export function resigned(
  printed: Record<string, unknown> | null,
  desk: ReadonlyMap<string, Record<string, unknown>>,
  live: ReadonlyMap<string, Record<string, unknown>>,
): Record<string, unknown> | null {
  if (!printed || printed["v"] !== PRINTED_VERSION || !isRecord(printed["articles"])) return printed;
  const articles = Object.entries(printed["articles"]).map(([id, sig]) => {
    const was = desk.get(id);
    const now = live.get(id);
    for (const brief of [false, true])
      if (was && now && sig === articleSig(was, brief)) return [id, articleSig(now, brief)] as const;
    return [id, sig] as const;
  });
  return { ...printed, articles: Object.fromEntries(articles) };
}

/** The edition's laid-out articles now, by id, in the Desk's shape (as "Update text" would bring them); none when the
 * edition is gone (every page's articles then read as deleted). */
export async function liveArticles(tx: Tx, publicationId: string, editionId: string) {
  const edition = await layoutEdition(tx, publicationId, editionId);
  if (!edition) return new Map<string, Record<string, unknown>>();
  const { articles } = frozenRequest(edition, await layoutStories(tx, publicationId, editionId), undefined, []);
  return new Map(articles.map((article) => [String(article["id"]), article]));
}

/** A run's page rows with their articles' reasons as of now: each done page's persisted reasons for anything else
 * (its folio, ads, the layout's setting) kept, the articles' decided again. */
export function withPrinted<
  T extends { readonly state: string; readonly stale: DeskTextValue[]; readonly printed: unknown },
>(rows: readonly T[], live: ReadonlyMap<string, Record<string, unknown>>): T[] {
  return rows.map((row) =>
    row.state !== "done"
      ? row
      : {
          ...row,
          stale: [
            ...row.stale.filter((why) => !ARTICLE_CODES.has(why.code ?? "")),
            ...articlesStale(row.printed, live),
          ],
        },
  );
}
