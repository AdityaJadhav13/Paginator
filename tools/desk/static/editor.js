/* Pageinator Desk — page editor.
 *
 * The page is drawn from the engine's display list with the very glyph outlines the print file embeds, so the screen
 * shows the same letters at the same places as the print file (its colours are an approximation). Stories (modules)
 * are moved and resized on the 8-column grid. Every change is sent to the engine, which sets the page again in well
 * under a second and keeps the change. A story's text is typed in the story panel (ordinary text boxes, so every
 * Marathi input method works); the engine sets the page again with it when you pause. "Save page" writes the print
 * file and checks it. Plain JavaScript, no libraries; all text goes into the page as text nodes (never as HTML).
 *
 * Requests: one change at a time goes to the engine; newer changes wait, and a waiting change gives way to a newer one
 * unless a lock changes between them (the engine checks each change against the one before). Another layout,
 * new text and saving wait for the changes on their way and allow no edits until they are answered. Every request is
 * made for the page shown when it started; an answer for a page the editor has left is dropped. Every change carries
 * the page's revision: a change made on an older view of the page (another window or tab changed it) is refused,
 * and the editor shows the page again as it is.
 *
 * The view (zoom, scrolling, the rulers) is the screen's alone: it never changes the page or what it prints. */

import {
  clampZoom,
  fitScale,
  fitWidthZoom,
  gridColumns,
  rulerLabel,
  rulerSteps,
  rulerTicks,
  unionBox,
  zoomToRect,
} from "./editor-view.js";

const $ = (sel) => document.querySelector(sel);
const PT_PER_MM = 72 / 25.4;
const HANDLE_PX = 7;
const DRAG_MIN_MM = 0.8; // a smaller pointer move is a click, not a drag
const SAME_MM = 0.01;
const MIN_H_MM = 10;
const RULER_PX = 20; // the rulers along the top and left of the view
const ZOOM_MARGIN_PX = 32; // room around a story zoomed to
const PREFS_KEY = "pageinator-desk.editor.v1"; // the editor's choices kept in this browser (the rulers)
const BAD = new Set(["overlap", "outside", "over", "cannot_set", "overset", "unset"]); // the print file would show these
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");
const SHIFT = MAC ? "⇧" : "Shift+"; // in messages that name a key
const params = new URLSearchParams(location.search);
const ID = {
  edition: params.get("edition") || "",
  run: params.get("run") || "",
  page: Number(params.get("page") || 1),
};

const S = {
  data: null, // the engine's answer: rev, modules, notes, problems, pool, grid, items, fonts
  modules: [], // what the editor shows (may be ahead of data while a change is on its way)
  selected: null, // story key
  undo: [],
  redo: [],
  zoom: 1, // a multiple of the scale at which the whole page fits the view
  view: { s: 1, ox: 0, oy: 0 }, // px per mm, and where the page's top-left corner is (px)
  fitTo: null, // what the view was fitted to and fits again when its size changes: "width", or a box (mm) zoomed to;
  // null: the whole page, at the zoom chosen
  rulers: readPrefs().rulers !== false, // shown unless hidden in this browser
  pointer: null, // the pointer over the view (px), marked on the rulers
  glyphs: new Map(), // "face:gid" -> Path2D
  upem: new Map(), // face -> units per em
  images: new Map(), // raster key -> HTMLImageElement
  drag: null,
  swapping: false,
  sending: false, // a change is on its way to the engine
  queued: null, // changes waiting for the one on its way, oldest first (null: none); sent one after the other
  inflight: null, // the change on its way (the state the first waiting change is set against)
  working: false, // another layout, new text or a save is being made: no edits meanwhile
  workText: "",
  textInline: false, // a save is setting the typed text itself
  saveAfter: false, // Save was asked while the page was being set
  saveRunning: false, // the page is being saved (a second Save meanwhile is not another save)
  refusals: 0, // changes refused or failed: a job waiting for them is dropped
  opening: false,
  switching: false,
  gen: 0, // which page the answers belong to: a new page (or a reload) makes a new one
  edits: 0, // changes made since the page was opened
  dirty: false, // the page has changes its print file does not have yet
  leaving: false,
  noticeKind: "",
  pages: null,
  run: null, // the run's status (when it was laid out)
};

// ------------------------------------------------------------------------------------------- server

const GET_TIMEOUT_MS = 20000; // a GET that gets no answer fails instead of being waited on for ever (glyphs: retried)

async function api(method, path, body) {
  // a GET (glyphs, the run's status) is quick or lost; the engine's own work (POST, PUT) may take long, and is waited for
  const quick = method === "GET" ? AbortSignal.timeout(GET_TIMEOUT_MS) : undefined;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: method === "GET" ? {} : { "X-Desk": "1", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: quick,
    });
  } catch (e) {
    if (quick && quick.aborted) throw new Error("The Desk did not answer in time.", { cause: e });
    throw e;
  }
  const data = await res.json().catch(() => undefined);
  if (res.ok && data === undefined) throw new Error("The Desk's answer could not be read."); // cut off, or damaged
  if (!res.ok) {
    const err = new Error((data && data.error) || `The Desk answered ${res.status}.`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const base = () =>
  `/api/editions/${encodeURIComponent(ID.edition)}/runs/${encodeURIComponent(ID.run)}/pages/${ID.page}`;
const rev = () => (S.data ? S.data.rev : undefined);

const waiters = [];
const sent = () => !S.sending && !S.queued;
const idle = () => sent() && !S.working && !S.opening;
const canEdit = () => !!S.data && !S.working && !S.opening && !S.switching;

function waitFor(pred) {
  return pred() ? Promise.resolve() : new Promise((resolve) => waiters.push({ pred, resolve }));
}

function settled() {
  for (let i = waiters.length - 1; i >= 0; i -= 1) {
    if (waiters[i].pred()) {
      waiters[i].resolve();
      waiters.splice(i, 1);
    }
  }
  tools();
  showBusy();
  if (canEdit() && S.noticeKind === "wait") notice("");
  if (canEdit() && S.saveAfter) {
    S.saveAfter = false;
    savePage();
  }
}

/** The run's record (when it was laid out, each page's state) and this page's line in it. */
async function runStatus(page) {
  try {
    const st = await api("GET", `/api/editions/${encodeURIComponent(ID.edition)}/runs/${encodeURIComponent(ID.run)}`);
    S.run = st;
    S.pages = (st.pages || []).length;
    return (st.pages || []).find((p) => p && p.page === page) || {};
  } catch {
    return {};
  }
}

/** A newer finished layout of the edition: this editor still changes the older one, so say so. */
async function newerRun() {
  try {
    const ed = await api("GET", `/api/editions/${encodeURIComponent(ID.edition)}`);
    const newer = (ed.runs || []).filter((r) => r && r.state === "done" && String(r.id) > ID.run);
    return newer.reduce((a, b) => (a && String(a.id) > String(b.id) ? a : b), null); // the newest of them
  } catch {
    return null;
  }
}

async function openPage() {
  const gen = S.gen;
  const url = base();
  S.opening = true;
  showBusy("Opening the page…");
  try {
    const data = await api("POST", `${url}/edit`, {});
    // the run's record is read after the engine answered: opening the page can mark it changed
    const [entry, later] = await Promise.all([runStatus(ID.page), newerRun()]);
    if (!(await accept(data, gen))) return;
    S.undo = [];
    S.redo = [];
    S.selected = null;
    S.edits = 0;
    title();
    tellDesk(); // opening can mark the page changed (its revision moved)
    sayOpened(entry, data, later);
    if (S.fitTo !== "width") S.fitTo = null; // a story zoomed to was on another page
    refit();
  } catch (e) {
    if (gen === S.gen) showProblem(e.message);
  } finally {
    if (gen === S.gen) {
      S.opening = false;
      renderPanels();
      settled();
    }
  }
}

/** The page as the engine has it now (after an error, or when another window changed it). */
async function resync(gen, why) {
  try {
    const data = await api("POST", `${base()}/edit`, {});
    if (!(await accept(data, gen))) return;
    if (why) {
      S.undo = [];
      S.redo = [];
      S.dirty = true;
      notice(`${why} Undo starts afresh from here.`, "error");
    }
  } catch {
    if (gen !== S.gen || !S.data) return;
    S.modules = copy(S.data.modules); // the engine kept the page as it was: show that
    invalidate();
    renderPanels();
    if (why) notice(why, "error");
  }
  setSaved(S.dirty ? "Changed · not saved" : "");
}

const deskChannel = "BroadcastChannel" in window ? new BroadcastChannel("pageinator-desk") : null;

/** The Desk page, if it is open in another tab, checks this layout's press files again. */
function tellDesk() {
  try {
    if (deskChannel) deskChannel.postMessage({ edition: ID.edition, run: ID.run });
  } catch {
    // the Desk page asks the server itself every few seconds
  }
}

function sayOpened(entry, data, later) {
  S.dirty = !!(entry.edited_unsaved || entry.needs_save || (entry.stale || []).length);
  const c = entry.pdfx_check || {};
  if (!Object.keys(entry).length) setSaved("");
  else if (entry.needs_save || (entry.stale || []).length) setSaved("Needs saving");
  else if (entry.edited_unsaved) setSaved("Changed · not saved");
  else if (entry.edited) setSaved(savedLabel(c));
  else setSaved("Automatic layout");
  const said = [];
  if (later)
    said.push(
      `A newer layout of this edition was made (${when(later.started)}). This page belongs to the older layout ` +
        `(${when(S.run && S.run.started)}): changes here do not reach the newer one.`,
    );
  if (entry.needs_save && entry.needs_save_reason) said.push(entry.needs_save_reason);
  else if (entry.edited_unsaved) said.push("Your changes to this page are kept. Save page makes its print file.");
  for (const why of entry.stale || []) said.push(why);
  const also = alsoText(data);
  if (also) said.push(also);
  notice(said.join(" "), also && !later ? "also" : "");
}

/** Stories on this page that are still on another page too (they leave it when this page is saved), and those of them
 * locked there (this page cannot be saved until they are unlocked there or taken off here). */
function alsoText(data) {
  const also = data.also_on_pages || {};
  const held = data.locked_on_pages || {};
  const pagesOf = (keys, at) => [...new Set(keys.map((k) => at[k]))].sort((a, b) => a - b);
  const free = Object.keys(also).filter((k) => !(k in held));
  const locked = Object.keys(held);
  const said = [];
  if (free.length) {
    const pages = pagesOf(free, also);
    const n = free.length;
    said.push(
      `${n === 1 ? "A story here is" : `${n} stories here are`} still on page ${pages.join(", ")} too: saving this ` +
        `page takes ${n === 1 ? "it" : "them"} off ${pages.length === 1 ? "that page" : "those pages"}.`,
    );
  }
  if (locked.length) {
    const n = locked.length;
    said.push(
      `${n === 1 ? `${cap(nameOf(locked[0]))} is` : `${n} stories here are`} also on page ` +
        `${pagesOf(locked, held).join(", ")}, locked there: this page cannot be saved until ${n === 1 ? "it is" : "they are"} ` +
        "unlocked there or taken off this page.",
    );
  }
  return said.join(" ");
}

/** Why this page cannot be saved now, in the server's words ("" when it can): a story on it is also on another page,
 * locked there (its save would take it off that page). The server checks it again at the save. */
function heldText(data) {
  const held = Object.entries(data.locked_on_pages || {}).sort((a, b) => a[1] - b[1]);
  if (!held.length) return "";
  const [story, n] = held[0];
  return (
    `This page cannot be saved yet: ${nameOf(story)} is also on page ${n}, locked there. Unlock it on page ${n}, or ` +
    "take it off this page, then save."
  );
}

/** Which stories are locked, and where. */
const lockKey = (mods) =>
  mods
    .filter((m) => m.locked)
    .map((m) => `${m.story}@${m.x},${m.y},${m.w},${m.h}`)
    .sort()
    .join("|");

async function send(modules) {
  if (S.sending) {
    // The engine sets each change against the one before it. A waiting change gives way to a newer one only when the
    // change before it, it and the newer one lock the same stories at the same places: a locked story unlocked and
    // then moved (also by undo) must reach the engine as two changes, or the engine refuses the move.
    const q = S.queued || [];
    const last = q[q.length - 1];
    const before = q.length > 1 ? q[q.length - 2] : S.inflight;
    if (last && lockKey(before) === lockKey(last) && lockKey(last) === lockKey(modules)) q[q.length - 1] = modules;
    else q.push(modules);
    S.queued = q;
    return;
  }
  const gen = S.gen;
  const url = base();
  S.sending = true;
  S.inflight = modules;
  showBusy();
  setSaved("Setting the page…");
  try {
    const data = await api("PUT", `${url}/edit`, { modules, rev: rev() });
    if (await accept(data, gen)) {
      S.dirty = true;
      setSaved("Changed · not saved");
      const also = alsoText(data);
      if (also) notice(also, "also");
      else if (S.noticeKind === "also") notice("");
    }
  } catch (e) {
    if (gen === S.gen) {
      S.queued = null; // the changes made on what failed are not sent
      S.refusals += 1; // nor a save or another layout asked meanwhile
      S.saveAfter = false;
      if (e.status === 409) await resync(gen, e.message);
      else {
        showProblem(e.message);
        await resync(gen);
      }
    }
  } finally {
    S.sending = false;
    S.inflight = null;
    const next = gen === S.gen && S.queued ? S.queued.shift() : null; // the oldest waiting change goes next
    if (!next || !S.queued.length) S.queued = null;
    if (next) send(next);
    else settled();
  }
}

/** The engine's answer on screen (glyphs first, so the page never draws with missing letters). false: it was for a
 * page the editor has left. */
async function accept(data, gen) {
  await loadGlyphs(data);
  if (gen !== S.gen) return false;
  if (S.data && data.rev !== S.data.rev) tellDesk(); // the page changed (by this window or the engine)
  S.data = data;
  S.modules = copy(S.queued ? S.queued[S.queued.length - 1] : data.modules); // the newest change shown
  if (S.selected && !S.modules.some((m) => m.story === S.selected)) S.selected = null;
  loadImages(data);
  invalidate();
  renderPanels();
  return true;
}

async function loadGlyphs(data) {
  const need = new Map(); // face -> Set(gid)
  for (const it of data.items) {
    if (it.t !== "text") continue;
    const f = data.fonts[it.f];
    if (!f) continue;
    S.upem.set(f.face, f.upem);
    let set = need.get(f.face);
    if (!set) need.set(f.face, (set = new Set()));
    for (const g of it.g) if (!S.glyphs.has(`${f.face}:${g[0]}`)) set.add(g[0]);
  }
  const jobs = [];
  for (const [face, set] of need) {
    const ids = [...set];
    for (let i = 0; i < ids.length; i += 3000) {
      const chunk = ids.slice(i, i + 3000);
      const url = `/api/glyphs/${face}?ids=${chunk.join(",")}`;
      jobs.push(
        // a lost answer is asked for again (twice), so the page never stays "Opening…"; a refusal is not
        api("GET", url)
          .catch((e) => (e.status ? Promise.reject(e) : api("GET", url)))
          .catch((e) => (e.status ? Promise.reject(e) : api("GET", url)))
          .then((r) => {
            for (const [gid, d] of Object.entries(r.glyphs)) S.glyphs.set(`${face}:${gid}`, new Path2D(d));
          }),
      );
    }
  }
  await Promise.all(jobs);
}

function loadImages(data) {
  for (const it of data.items) {
    if (it.t !== "img" || S.images.has(it.src)) continue;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => invalidate();
    img.src = `/files/rasters/${it.src}.jpg`;
    S.images.set(it.src, img);
  }
}

/** Another layout, new text or a save: after the changes on their way, with no edits until it is answered. → whether
 * it ran (it does not while the page cannot be changed). */
async function exclusive(text, job) {
  if (!canEdit()) return "busy";
  const gen = S.gen;
  const url = base();
  const refusals = S.refusals;
  const focused = document.activeElement; // a button that is off while the job runs gets the focus back after it
  S.working = true;
  S.workText = text;
  tools();
  showBusy();
  let outcome = "ok";
  try {
    await waitFor(sent);
    // a change on its way was refused or failed: the job was asked on a page that is not there any more
    if (S.refusals !== refusals) outcome = "dropped";
    else if (gen === S.gen && S.data) await job(gen, url);
  } catch (e) {
    outcome = "failed";
    S.saveAfter = false; // a Save asked meanwhile was for the page the job was to make: not for what is shown now
    if (gen === S.gen) {
      if (e.status === 409) await resync(gen, e.message);
      else showProblem(e.message);
    }
    S.saveAfter = false; // nor one asked while the page was shown again
  } finally {
    S.working = false;
    S.saveRunning = false;
    S.workText = "";
    if (gen === S.gen) renderPanels();
    settled();
    const lost = !document.activeElement || document.activeElement === document.body;
    if (lost && focused instanceof HTMLElement && focused.isConnected && !focused.disabled) focused.focus();
  }
  return outcome;
}

let altVariant = 0;

function another() {
  return exclusive("Laying the page out another way…", async (gen, url) => {
    const variant = (altVariant % 3) + 1;
    const before = copy(S.modules);
    const data = await api("POST", `${url}/alternative`, { variant, rev: rev() });
    if (!(await accept(data, gen))) return;
    altVariant = variant;
    pushUndo(before);
    S.redo = [];
    S.edits += 1;
    S.dirty = true;
    setSaved("Changed · not saved");
    const moved =
      before.length !== S.modules.length ||
      before.some((b) => !S.modules.some((m) => m.story === b.story && same(m, b)));
    notice(
      (!S.modules.some((m) => m.locked)
        ? ["", "Lead on the other side.", "Lead at another width.", "Lead on the other side, at another width."][
            variant
          ]
        : moved
          ? "The stories that are not locked are laid out another way around the locked ones, which stay where they are."
          : "Laid out around the locked stories, the page came out as it was: unlock a story to try other layouts.") +
        " Undo brings back the last one.",
    );
  });
}

/** The page's locked stories by name, before a request that may take stories off it (Update text). */
const lockedNames = () => new Map(S.modules.filter((m) => m.locked).map((m) => [m.story, nameOf(m.story)]));

/** What Update text (or the story panel) did to the page, in words. locked: lockedNames() from before it. */
function refreshSaid(data, locked = new Map()) {
  const n = (data.changed || []).length;
  const d = (data.dropped || []).length;
  const r = (data.removed || []).length;
  const said = [];
  if (n) said.push(`${n === 1 ? "1 story is" : `${n} stories are`} set with the new text.`);
  if (data.folio_changed) said.push("The volume, issue or price on this page is set as the edition has it now.");
  const ads = (data.ads_changed || []).length;
  if (ads)
    said.push(
      `${ads === 1 ? "An advertisement" : `${ads} advertisements`} on this page ${ads === 1 ? "is" : "are"} set as the edition has ${ads === 1 ? "it" : "them"} now.`,
    );
  if (d)
    said.push(
      `${d === 1 ? "1 story" : `${d} stories`} left the page: ${d === 1 ? "its" : "their"} articles were deleted or ` +
        "emptied.",
    );
  else if (r)
    said.push(`${r === 1 ? "1 article" : `${r} articles`} left the page: deleted from the edition, or emptied.`);
  const gone = (data.dropped || []).filter((k) => locked.has(k)); // a deleted article never prints, locked or not
  if (gone.length)
    said.push(
      cap(
        `${gone.map((k) => locked.get(k)).join(", ")} left the page although ${gone.length === 1 ? "it was" : "they were"} locked.`,
      ),
    );
  for (const k of data.kind_changes || []) {
    const head = (k.headline || articleHead(k.article)).slice(0, 60);
    said.push(
      k.now === "story"
        ? `“${head}” would now be a story of its own (its length, photo, priority or page changed); on this layout ` +
            "it stays with the short items until the edition is laid out again."
        : `“${head}” would now be a short item; on this layout it stays a story of its own until the edition is laid ` +
            "out again.",
    );
  }
  return { said, changed: n + d + r > 0 || !!data.folio_changed || ads > 0 };
}

/** The save state after a save, from the check's verdict. */
function savedLabel(c) {
  if (c && c.passed) return "Saved · PDF/X-1a check passed";
  if (c && c.fails)
    return `Saved · PDF/X-1a check: ${c.fails} problem${c.fails === 1 ? "" : "s"}, do not send this page`;
  return "Saved · the PDF/X-1a check could not run, do not send this page";
}

function refreshText() {
  return exclusive("Setting the articles' current text…", async (gen, url) => {
    const locked = lockedNames();
    const data = await api("POST", `${url}/refresh`, { rev: rev() });
    if (!(await accept(data, gen))) return;
    const { said, changed } = refreshSaid(data, locked);
    if (changed) {
      S.edits += 1;
      S.dirty = true;
      setSaved("Changed · not saved");
      said.push("Save page to make the print file.");
    } else if (!said.length) said.push("No text on this page has changed since it was last set.");
    notice(said.join(" "));
  });
}

function savePage() {
  return exclusive("Waiting for your last change…", async (gen, url) => {
    S.textInline = true; // typing on its way is set by this save itself (it holds the page meanwhile)
    S.saveRunning = true;
    S.saveAfter = false; // a Save asked while this one waited for the last change: this save is it
    T.others = null;
    T.textSaved = false;
    settled(); // a text save waiting for the page goes on now
    let typed;
    try {
      typed = await flushText(); // what was typed goes into the print file too
    } finally {
      S.textInline = false;
    }
    if (!typed) {
      notice(
        T.textSaved
          ? `The page was not saved. ${T.error}` // the text is saved; the page could not be set with it
          : `The page was not saved: your typed text could not be saved first. ${T.error || ""}`,
        "error",
      );
      return;
    }
    if (T.others) {
      // setting the typed text also set other changes (text corrected elsewhere, the folio, an ad): look first
      notice([...T.others, "Check the page, then press Save page again."].join(" "));
      T.others = null;
      return;
    }
    // the edition's current text, folio and ads first (a correction made elsewhere must not print in its old form);
    // on the page as this window shows it (a change made in another window is refused here, and shown)
    S.workText = "Setting the edition's current text first…";
    showBusy();
    const locked = lockedNames();
    const current = await api("POST", `${url}/refresh`, { rev: rev() });
    if (!(await accept(current, gen))) return;
    const now = refreshSaid(current, locked);
    if (now.changed) {
      S.edits += 1;
      S.dirty = true;
      setSaved("Changed · not saved");
      notice([...now.said, "Check the page, then press Save page again."].join(" "));
      return;
    }
    const held = heldText(S.data); // the page as the engine has it this moment (the server checks it again)
    if (held) return notice(held, "error");
    const bad = (S.data.problems || []).filter((p) => BAD.has(p.kind));
    if (bad.length) {
      const list = bad
        .slice(0, 6)
        .map((p) => `• ${problemText(p)}`)
        .join("\n");
      const ok = window.confirm(
        `This page still has ${bad.length === 1 ? "a problem" : `${bad.length} problems`}:\n\n${list}\n\n` +
          "The print file will show the page as it is now. Save it anyway?",
      );
      if (!ok) return;
    }
    S.workText = "Making the print file and checking it…";
    showBusy();
    const before = S.edits;
    const r = await api("POST", `${url}/save`, { rev: rev() }).finally(tellDesk); // the server marked the page meanwhile
    if (gen !== S.gen) return;
    // the page as it stands after the save (stories brought here have left their old pages)
    const after = await api("POST", `${url}/edit`, {}).catch(() => null);
    if (after) await accept(after, gen);
    if (gen !== S.gen) return;
    // the save's own checks stay on screen: only the print file is checked for lines touching in ink
    if (Array.isArray(r.problems)) {
      S.data = { ...S.data, problems: r.problems };
      renderPanels();
    }
    const again = Array.isArray(r.stale) && r.stale.length > 0; // the edition changed while the file was made
    // the page itself changed again meanwhile (another window): its new file prints the version saved, not this one
    const moved = !again && Array.isArray(r.pages_to_save) && r.pages_to_save.includes(ID.page);
    if (!r.error && !again && !moved && S.edits === before) S.dirty = false;
    setSaved(
      r.error
        ? "Saved · its files are not finished"
        : again
          ? "Saved · needs saving again"
          : moved
            ? "Saved · changed again since"
            : savedLabel(r.pdfx_check),
    );
    const said = [];
    if (r.error) said.push(r.error);
    if (again) said.push(...r.stale);
    if (moved) said.push("The page was changed again (in another window or tab) while it was saved: save it again.");
    const changed = Object.keys(r.pages_changed || {})
      .map(Number)
      .sort((a, b) => a - b);
    if (changed.length)
      said.push(
        `Stories moved here have left page ${changed.join(", ")}: open ${changed.length === 1 ? "it" : "them"}, ` +
          "fill the space and save.",
      );
    for (const p of (r.problems || []).filter((x) => x.kind === "touch")) said.push(problemText(p));
    if (r.press_ready === false) said.push(pressText(r));
    else if (r.press_ready === true)
      said.push("Every page is saved and checked: the press files on the Desk are current.");
    notice(said.join(" "), r.error ? "error" : "");
    invalidate();
  });
}

function pressText(r) {
  const pages = (list) => `page${list.length === 1 ? "" : "s"} ${list.join(", ")}`;
  const save = r.pages_to_save || [];
  const fail = r.pages_failing_check || [];
  const twice = r.pages_with_repeats || [];
  const out = [];
  if (save.length) out.push(`${pages(save)} still to save`);
  if (fail.length) out.push(`${pages(fail)} not passing the PDF/X-1a check`);
  if (twice.length) out.push(`${pages(twice)} print the same article: take it off one of them`);
  return `The press files are not current yet: ${out.join("; ") || "not every page is done"}.`;
}

// ------------------------------------------------------------------------------------------- edits

// A module is its place (x, y, w, h) and its attributes (locked, and crop: the photo crop, not built yet, always null;
// never changed in place, so a shallow copy is enough). A locked story keeps its place, width and height for this
// layout: every change that would move, resize or remove it is refused here, before anything is sent (the engine
// refuses it too).
const copy = (mods) => mods.map((m) => ({ ...m }));
const same = (a, b) =>
  a.w === b.w && Math.abs(a.x - b.x) < SAME_MM && Math.abs(a.y - b.y) < SAME_MM && Math.abs(a.h - b.h) < SAME_MM;
const sameAttrs = (a, b) =>
  !!a.locked === !!b.locked && JSON.stringify(a.crop ?? null) === JSON.stringify(b.crop ?? null);
const lockedHere = (story) => S.modules.some((m) => m.story === story && m.locked);

/** A change a lock refuses, said on the page (nothing is sent). what: what unlocking would allow ("move it", …). */
function refuseLocked(story, what) {
  notice(`${cap(nameOf(story))} is locked: unlock it (${SHIFT}L) to ${what}.`, "lock");
}

function pushUndo(modules) {
  S.undo.push(modules);
  if (S.undo.length > 200) S.undo.shift();
}

function apply(modules) {
  S.modules = modules;
  S.edits += 1;
  invalidate();
  renderPanels();
  send(copy(modules));
}

function commit(modules) {
  if (!canEdit()) return;
  pushUndo(copy(S.modules));
  S.redo = [];
  apply(modules);
}

function undo() {
  if (!canEdit() || !S.undo.length) return;
  S.redo.push(copy(S.modules));
  apply(S.undo.pop());
}

function redo() {
  if (!canEdit() || !S.redo.length) return;
  pushUndo(copy(S.modules));
  apply(S.redo.pop());
}

/** A story's place, width or height changed (a locked story's never is). */
function update(story, change) {
  const m = S.modules.find((x) => x.story === story);
  if (!m || same({ ...m, ...change }, m)) return renderPanels();
  if (m.locked) {
    renderPanels(); // the fields show its place again
    return refuseLocked(story, "move it or change its size");
  }
  commit(S.modules.map((x) => (x.story === story ? { ...x, ...change } : { ...x })));
}

/** A story's attributes changed (the lock), its place kept: one change and one undo step. */
function setAttrs(story, change) {
  const m = S.modules.find((x) => x.story === story);
  if (!m) return renderPanels();
  const next = { ...m, ...change };
  if (same(next, m) && sameAttrs(next, m)) return renderPanels();
  commit(S.modules.map((x) => (x.story === story ? next : { ...x })));
}

/** Lock a story in place for this layout, or unlock it (Shift+L, the story panel, the menu). */
function toggleLock(story) {
  if (!canEdit()) return;
  const m = S.modules.find((x) => x.story === story);
  if (!m) return;
  setAttrs(story, { locked: !m.locked });
  if (S.noticeKind === "lock") notice("");
  say(
    m.locked
      ? `${cap(nameOf(story))} is unlocked.`
      : `${cap(nameOf(story))} is locked in place: its place, width and height stay as they are.`,
  );
}

/** Every story of the page unlocked (the menu on the page's empty space): one change and one undo step. */
function unlockAll() {
  if (!canEdit()) return;
  if (!S.modules.some((m) => m.locked)) return notice("No story on this page is locked.", "lock");
  commit(S.modules.map((m) => ({ ...m, locked: false })));
  if (S.noticeKind === "lock") notice("");
  say("Every story on this page is unlocked.");
}

function removeStory(story) {
  if (!canEdit()) return;
  if (lockedHere(story)) return refuseLocked(story, "take it off the page");
  if (S.selected === story) S.selected = null;
  commit(S.modules.filter((m) => m.story !== story).map((m) => ({ ...m })));
}

function bringIn(story) {
  if (!canEdit()) return;
  const p = S.data.pool.find((x) => x.story === story);
  if (p && p.locked)
    return notice(`${cap(nameOf(story))} is locked on page ${p.on_page}: unlock it there to bring it here.`, "lock");
  const g = S.data.grid;
  const h = Math.min(90, g.news_bottom_mm - g.news_top_mm);
  S.selected = story;
  commit([...copy(S.modules), snapModule({ story, x: g.origin_mm, y: g.news_top_mm, w: 2, h, locked: false })]);
}

function swap(a, b) {
  if (!canEdit()) return;
  const ma = S.modules.find((m) => m.story === a);
  const mb = S.modules.find((m) => m.story === b);
  if (!ma || !mb) return;
  const held = [ma, mb].find((m) => m.locked);
  if (held) return refuseLocked(held.story, "move it");
  commit(S.modules.map((m) => (m.story === a ? { ...m, story: b } : m.story === b ? { ...m, story: a } : { ...m })));
  S.selected = b;
  renderPanels();
}

/** The story's height set to what its text needs at its width (the story panel, the menu). */
function fitHeight(story) {
  const m = S.modules.find((x) => x.story === story);
  const n = m && noteOf(m.story);
  if (!m || !n || n.fit === "fits" || n.fit === "none") return;
  const h = n.fit === "over" ? m.h + n.by_mm : m.h - n.by_mm;
  update(m.story, snapModule({ ...m, h }, "y"));
}

function startSwapping() {
  if (!S.selected || !canEdit()) return;
  if (lockedHere(S.selected)) return refuseLocked(S.selected, "move it");
  S.swapping = true;
  canvas.style.cursor = "crosshair";
  notice("Click the story to swap with, on the page or in the list “On this page” (Esc to stop).", "swap");
}

function stopSwapping() {
  S.swapping = false;
  canvas.style.cursor = "default";
  if (S.noticeKind === "swap") notice("");
}

// ------------------------------------------------------------------------------------------- geometry

const span = (w) => w * S.data.grid.column_mm + (w - 1) * S.data.grid.gutter_mm;
const pitch = () => S.data.grid.column_mm + S.data.grid.gutter_mm;
const colOf = (x) => Math.round((x - S.data.grid.origin_mm) / pitch());
const boxOf = (m) => ({ x0: m.x, y0: m.y, x1: m.x + span(m.w), y1: m.y + m.h });
const toPx = (x, y) => [S.view.ox + x * S.view.s, S.view.oy + y * S.view.s];
const toMm = (px, py) => [(px - S.view.ox) / S.view.s, (py - S.view.oy) / S.view.s];

/** The module on the grid, as the engine snaps it: whole columns; y and h in whole steps from the news area's top,
 * inside the news area. keep "h" (a move): a module pushed past the foot stops there with its height; keep "y" (a
 * resize): it keeps its top and is shortened to the foot. */
function snapModule(m, keep = "h") {
  const g = S.data.grid;
  const w = Math.max(1, Math.min(g.columns, Math.round(m.w)));
  const col = Math.max(0, Math.min(g.columns - w, colOf(m.x)));
  const step = g.snap_mm;
  const top = g.news_top_mm;
  const steps = Math.floor((g.news_bottom_mm - top) / step + 1e-9);
  const least = Math.ceil(MIN_H_MM / step - 1e-9);
  let yk = Math.max(0, Math.round((m.y - top) / step));
  let hk = Math.max(least, Math.round(m.h / step));
  if (keep === "h") {
    hk = Math.min(hk, steps);
    yk = Math.min(yk, steps - hk);
  } else {
    yk = Math.min(yk, steps - least);
    hk = Math.min(hk, steps - yk);
  }
  return { ...m, x: g.origin_mm + col * pitch(), y: top + yk * step, w, h: hk * step };
}

function hit(px, py) {
  // handles of the selected module first (a locked one has none), then the topmost module under the pointer
  const sel = S.modules.find((m) => m.story === S.selected);
  if (sel && !sel.locked) {
    const b = boxOf(sel);
    const [x1, y1] = toPx(b.x1, b.y1);
    const [x0, y0] = toPx(b.x0, b.y0);
    const nearR = Math.abs(px - x1) <= HANDLE_PX && py >= y0 && py <= y1;
    const nearB = Math.abs(py - y1) <= HANDLE_PX && px >= x0 && px <= x1;
    if (nearR && nearB) return { story: sel.story, part: "corner" };
    if (nearR) return { story: sel.story, part: "right" };
    if (nearB) return { story: sel.story, part: "bottom" };
  }
  const [x, y] = toMm(px, py);
  for (let i = S.modules.length - 1; i >= 0; i -= 1) {
    const b = boxOf(S.modules[i]);
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return { story: S.modules[i].story, part: "body" };
  }
  return null;
}

// ------------------------------------------------------------------------------------------- drawing

const canvas = $("#canvas");
const ctx = canvas.getContext("2d");
let content = null; // offscreen drawing of the page at the current view
let contentKey = "";

function invalidate() {
  contentKey = "";
  requestAnimationFrame(draw);
}

function cmyk(c) {
  const [C, M, Y, K] = c.map((v) => Math.max(0, Math.min(1, v)));
  return `rgb(${Math.round(255 * (1 - C) * (1 - K))},${Math.round(255 * (1 - M) * (1 - K))},${Math.round(255 * (1 - Y) * (1 - K))})`;
}

function size() {
  const r = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * dpr));
  const h = Math.max(1, Math.round(r.height * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    contentKey = "";
  }
  return { w: r.width, h: r.height, dpr };
}

/** The scale (px per mm) at which the whole page fits a view of w × h px: the zoom is a multiple of it. */
const pageFit = (w, h) => fitScale(w, h, S.data.grid.page_w_mm, S.data.grid.page_h_mm);

/** The page at the zoom chosen: centred across the view, and at its top once it is taller than the view. */
function fit() {
  if (!S.data) return;
  const { w, h } = size();
  const g = S.data.grid;
  const s = pageFit(w, h) * S.zoom;
  S.view = { s, ox: (w - g.page_w_mm * s) / 2, oy: Math.max(24, (h - g.page_h_mm * s) / 2) };
  if (S.zoom > 1) S.view.oy = 24;
  zoomLabel();
  invalidate();
}

function zoomLabel() {
  $("#zoom-label").textContent = `${Math.round(S.zoom * 100)}%`;
}

function drawContent(w, h, dpr) {
  const key = `${w}x${h}@${dpr}:${S.view.s}:${S.view.ox}:${S.view.oy}:${S.data ? S.data.items.length : 0}`;
  if (content && key === contentKey) return content;
  content = content || document.createElement("canvas");
  content.width = Math.round(w * dpr);
  content.height = Math.round(h * dpr);
  const c = content.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.fillStyle = "#3a3f47";
  c.fillRect(0, 0, content.width, content.height);
  const g = S.data.grid;
  const { s, ox, oy } = S.view;
  const k = dpr;
  c.fillStyle = "#ffffff";
  c.fillRect(ox * k, oy * k, g.page_w_mm * s * k, g.page_h_mm * s * k);
  // column guides of the news area
  c.strokeStyle = "rgba(139, 92, 246, 0.25)";
  c.lineWidth = 1;
  for (let i = 0; i < g.columns; i += 1) {
    for (const x of [g.origin_mm + i * pitch(), g.origin_mm + i * pitch() + g.column_mm]) {
      c.beginPath();
      c.moveTo((ox + x * s) * k, (oy + g.news_top_mm * s) * k);
      c.lineTo((ox + x * s) * k, (oy + g.news_bottom_mm * s) * k);
      c.stroke();
    }
  }
  for (const it of S.data.items) {
    if (it.t === "rect") {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.fillStyle = cmyk(it.c);
      c.fillRect((ox + it.x * s) * k, (oy + it.y * s) * k, it.w * s * k, it.h * s * k);
    } else if (it.t === "line") {
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.strokeStyle = cmyk(it.c);
      c.lineWidth = Math.max(0.6, (it.lw / PT_PER_MM) * s * k);
      c.beginPath();
      c.moveTo((ox + it.x1 * s) * k, (oy + it.y1 * s) * k);
      c.lineTo((ox + it.x2 * s) * k, (oy + it.y2 * s) * k);
      c.stroke();
    } else if (it.t === "img") {
      const img = S.images.get(it.src);
      c.setTransform(1, 0, 0, 1, 0, 0);
      if (img && img.complete && img.naturalWidth) {
        c.drawImage(img, (ox + it.x * s) * k, (oy + it.y * s) * k, it.w * s * k, it.h * s * k);
      } else {
        c.fillStyle = "#e5e7eb";
        c.fillRect((ox + it.x * s) * k, (oy + it.y * s) * k, it.w * s * k, it.h * s * k);
      }
    } else if (it.t === "text") {
      const f = S.data.fonts[it.f];
      if (!f) continue;
      const upem = f.upem;
      const unit = (it.s / PT_PER_MM / upem) * s * k; // px per font unit
      c.fillStyle = cmyk(it.c);
      for (const [gid, x, y] of it.g) {
        const p = S.glyphs.get(`${f.face}:${gid}`);
        if (!p) continue;
        c.setTransform(unit * (it.hs || 1), 0, 0, -unit, (ox + x * s) * k, (oy + y * s) * k);
        c.fill(p);
      }
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  contentKey = key;
  return content;
}

function draw() {
  if (!S.data) return;
  const { w, h, dpr } = size();
  const img = drawContent(w, h, dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(img, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const bad = new Set();
  for (const p of S.data.problems) if (BAD.has(p.kind)) p.stories.forEach((x) => bad.add(x));
  for (const m of S.modules) {
    const b = boxOf(m);
    const [x0, y0] = toPx(b.x0, b.y0);
    const [x1, y1] = toPx(b.x1, b.y1);
    const sel = m.story === S.selected;
    const typed = m.story === T.story;
    ctx.lineWidth = sel || typed ? 2 : 1;
    ctx.strokeStyle = sel
      ? "#2563eb"
      : typed
        ? "#0d9488"
        : bad.has(m.story)
          ? "rgba(220, 38, 38, 0.9)"
          : "rgba(37, 99, 235, 0.25)";
    if (bad.has(m.story) && !sel) {
      ctx.fillStyle = "rgba(220, 38, 38, 0.06)";
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    if (m.locked) {
      ctx.setLineDash([6, 4]); // locked: a dashed outline, a padlock, and no handles
      if (!sel && !typed && !bad.has(m.story)) ctx.strokeStyle = "rgba(30, 41, 59, 0.6)";
    }
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
    ctx.setLineDash([]);
    if (m.locked) drawPadlock(Math.max(x0 + 4, x1 - 22), y0 + 5);
    else if (sel) {
      ctx.fillStyle = "#2563eb";
      for (const [hx, hy] of [
        [x1, (y0 + y1) / 2],
        [(x0 + x1) / 2, y1],
        [x1, y1],
      ])
        ctx.fillRect(hx - 4, hy - 4, 8, 8);
    }
  }
  if (S.drag && S.drag.ghost) {
    const b = boxOf(S.drag.ghost);
    const [x0, y0] = toPx(b.x0, b.y0);
    const [x1, y1] = toPx(b.x1, b.y1);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "#f43f5e";
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(244, 63, 94, 0.08)";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = "#111827";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(`${S.drag.ghost.w} col × ${Math.round(S.drag.ghost.h)} mm`, x0 + 6, y0 - 6);
  }
  drawRulers(w, h);
}

/** A locked story's mark: a padlock on a white tile, 18 px square, at (x, y) in the view (px). */
function drawPadlock(x, y) {
  ctx.save();
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeStyle = "rgba(30, 41, 59, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x + 0.5, y + 0.5, 17, 17, 4);
  else ctx.rect(x + 0.5, y + 0.5, 17, 17);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "#1e293b"; // the shackle
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(x + 6, y + 9);
  ctx.lineTo(x + 6, y + 6.5);
  ctx.arc(x + 9, y + 6.5, 3, Math.PI, 0);
  ctx.lineTo(x + 12, y + 9);
  ctx.stroke();
  ctx.fillStyle = "#1e293b"; // the body
  ctx.fillRect(x + 4, y + 8.5, 10, 6.5);
  ctx.restore();
}

let frame = 0;

/** The view drawn again at the next frame (once, however often it is asked for), from the page drawing it keeps. */
function redraw() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    draw();
  });
}

const RULER = {
  ground: "#e5e7eb", // over the pasteboard
  page: "#fafafa", // along the page
  column: "rgba(139, 92, 246, 0.18)", // a column of the grid (the violet of the page's column guides)
  number: "#5b21b6",
  tick: "#6b7280",
  text: "#374151",
  edge: "#b9bfc8",
  pointer: "#e11d48",
};
const TICK_PX = { major: RULER_PX, mid: 8, minor: 4 };
const RULER_FONT = "9px system-ui, -apple-system, sans-serif";

/** The rulers along the top and left of the view, when shown: mm from the page's top-left corner, the grid's columns
 * numbered at their centres on the top one, and where the pointer is. They are drawn from the view itself, last, so
 * they follow every scroll and zoom; they cover the view's edges, never the page's content. */
function drawRulers(w, h) {
  if (!S.rulers) return;
  const R = RULER_PX;
  const g = S.data.grid;
  const { s, ox, oy } = S.view;
  const steps = rulerSteps(s);
  ctx.save();
  ctx.font = RULER_FONT;
  ctx.textBaseline = "top";

  // top: across the page, with its columns
  ctx.save();
  ctx.beginPath();
  ctx.rect(R, 0, w - R, R);
  ctx.clip();
  ctx.fillStyle = RULER.ground;
  ctx.fillRect(R, 0, w - R, R);
  ctx.fillStyle = RULER.page;
  ctx.fillRect(ox, 0, g.page_w_mm * s, R);
  const cols = gridColumns(g);
  ctx.fillStyle = RULER.column;
  for (const c of cols) ctx.fillRect(ox + c.x0 * s, 0, (c.x1 - c.x0) * s, R);
  const across = rulerTicks((R - ox) / s - steps.major, (w - ox) / s, steps);
  ctx.fillStyle = RULER.tick;
  ctx.beginPath();
  for (const t of across) ctx.rect(Math.round(ox + t.mm * s), R - TICK_PX[t.kind], 1, TICK_PX[t.kind]);
  ctx.fill();
  ctx.fillStyle = RULER.text;
  ctx.textAlign = "left";
  for (const t of across) if (t.label !== null) ctx.fillText(rulerLabel(t.label), Math.round(ox + t.mm * s) + 3, 1);
  ctx.font = "600 10px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  for (const c of cols) {
    const x = ox + c.mid * s;
    const room = ctx.measureText(String(c.n)).width + 6;
    if (room > (c.x1 - c.x0) * s) continue; // too narrow to number at this zoom
    ctx.fillStyle = RULER.page; // the number on a patch of its column, over the ticks
    ctx.fillRect(x - room / 2, 9, room, R - 10);
    ctx.fillStyle = RULER.column;
    ctx.fillRect(x - room / 2, 9, room, R - 10);
    ctx.fillStyle = RULER.number;
    ctx.fillText(String(c.n), x, 9);
  }
  ctx.restore();

  // left: down the page (numbers turned to read upwards)
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, R, R, h - R);
  ctx.clip();
  ctx.fillStyle = RULER.ground;
  ctx.fillRect(0, R, R, h - R);
  ctx.fillStyle = RULER.page;
  ctx.fillRect(0, oy, R, g.page_h_mm * s);
  const down = rulerTicks((R - oy) / s - steps.major, (h - oy) / s, steps);
  ctx.fillStyle = RULER.tick;
  ctx.beginPath();
  for (const t of down) ctx.rect(R - TICK_PX[t.kind], Math.round(oy + t.mm * s), TICK_PX[t.kind], 1);
  ctx.fill();
  ctx.fillStyle = RULER.text;
  ctx.textAlign = "right";
  for (const t of down) {
    if (t.label === null) continue;
    ctx.save();
    ctx.translate(1, Math.round(oy + t.mm * s) + 3);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(rulerLabel(t.label), 0, 0);
    ctx.restore();
  }
  ctx.restore();

  // the corner (the unit), the rulers' inner edges, and where the pointer is
  ctx.fillStyle = RULER.ground;
  ctx.fillRect(0, 0, R, R);
  ctx.fillStyle = RULER.text;
  ctx.textAlign = "center";
  ctx.fillText("mm", R / 2, 6);
  ctx.fillStyle = RULER.edge;
  ctx.fillRect(0, R - 1, w, 1);
  ctx.fillRect(R - 1, 0, 1, h);
  const p = S.pointer;
  if (p && p[0] >= R && p[1] >= R && p[0] < w && p[1] < h) {
    ctx.fillStyle = RULER.pointer;
    ctx.fillRect(Math.round(p[0]), 0, 1, R - 1);
    ctx.fillRect(0, Math.round(p[1]), R - 1, 1);
  }
  ctx.restore();
}

// ------------------------------------------------------------------------------------------- pointer and keys

function cancelDrag() {
  if (!S.drag) return;
  S.drag = null;
  requestAnimationFrame(draw);
}

/** Whether a point of the view (px) is on a ruler: the rulers are for reading, so a click there does nothing. */
const onRuler = (px, py) => S.rulers && (px < RULER_PX || py < RULER_PX);

/** Where the pointer is over the view (px; null: not over it), for the rulers' markers. */
function pointAt(p) {
  S.pointer = p;
  if (S.rulers && S.data) redraw();
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 2 || (MAC && e.ctrlKey && e.button === 0)) {
    M.pointerAt = performance.now(); // a right-click (a Ctrl+click on a Mac): the menu event follows
    return;
  }
  if (!S.data || e.button !== 0 || S.drag) return; // one pointer at a time
  canvas.focus();
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  if (onRuler(px, py)) return;
  const h = hit(px, py);
  if (S.swapping) {
    const from = S.selected;
    stopSwapping();
    if (h && from && h.story !== from) swap(from, h.story);
    return;
  }
  if (!h) {
    S.selected = null;
    renderPanels();
    invalidate();
    return;
  }
  S.selected = h.story;
  if (canEdit()) {
    const m = S.modules.find((x) => x.story === h.story);
    // a locked story is selected, never dragged: a drag on it only says why it does not move
    S.drag = { part: h.part, start: [px, py], from: { ...m }, ghost: null, pointer: e.pointerId, locked: !!m.locked };
    canvas.setPointerCapture(e.pointerId);
  }
  renderPanels();
  invalidate();
});

canvas.addEventListener("pointermove", (e) => {
  const r = canvas.getBoundingClientRect();
  const px = e.clientX - r.left;
  const py = e.clientY - r.top;
  if (!S.drag) {
    pointAt([px, py]); // a drag draws the view itself, at every move
    const h = S.data && !onRuler(px, py) ? hit(px, py) : null;
    canvas.style.cursor = S.swapping
      ? "crosshair"
      : !h
        ? "default"
        : lockedHere(h.story)
          ? "not-allowed"
          : h.part === "right"
            ? "ew-resize"
            : h.part === "bottom"
              ? "ns-resize"
              : h.part === "corner"
                ? "nwse-resize"
                : "move";
    return;
  }
  if (e.pointerId !== S.drag.pointer) return;
  S.pointer = [px, py];
  const dx = (px - S.drag.start[0]) / S.view.s;
  const dy = (py - S.drag.start[1]) / S.view.s;
  if (S.drag.locked) {
    if (!S.drag.told && Math.abs(dx) + Math.abs(dy) >= DRAG_MIN_MM) {
      S.drag.told = true; // said once per drag
      refuseLocked(S.drag.from.story, "move it");
    }
    return;
  }
  if (Math.abs(dx) + Math.abs(dy) < DRAG_MIN_MM) {
    // back where it started: no change
    if (S.drag.ghost) {
      S.drag.ghost = null;
      requestAnimationFrame(draw);
    }
    return;
  }
  const f = S.drag.from;
  let g = { ...f };
  if (S.drag.part === "body") g = { ...f, x: f.x + dx, y: f.y + dy };
  if (S.drag.part === "right" || S.drag.part === "corner") {
    // the left edge stays: at most the columns to the right of it
    const w = Math.round((span(f.w) + dx + S.data.grid.gutter_mm) / pitch());
    g.w = Math.max(1, Math.min(S.data.grid.columns - colOf(f.x), w));
  }
  if (S.drag.part === "bottom" || S.drag.part === "corner") g.h = f.h + dy;
  S.drag.ghost = snapModule(g, S.drag.part === "bottom" || S.drag.part === "corner" ? "y" : "h");
  requestAnimationFrame(draw);
});

canvas.addEventListener("pointerup", (e) => {
  const d = S.drag;
  if (!d || e.pointerId !== d.pointer) return;
  S.drag = null;
  if (d.ghost && !same(d.ghost, d.from)) {
    const g = d.ghost;
    update(d.from.story, { x: g.x, y: g.y, w: g.w, h: g.h });
    return;
  }
  invalidate();
});

canvas.addEventListener("pointercancel", cancelDrag); // the browser took the pointer (a gesture, a dialog)
canvas.addEventListener("lostpointercapture", cancelDrag); // after pointerup the drag is already over
canvas.addEventListener("pointerleave", () => pointAt(null));
canvas.addEventListener("dblclick", (e) => {
  const r = canvas.getBoundingClientRect();
  const [px, py] = [e.clientX - r.left, e.clientY - r.top];
  const h = S.data && !onRuler(px, py) && hit(px, py);
  if (h) openText(h.story);
});

window.addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return; // an input method is composing: its keys are not commands
  const mod = e.ctrlKey || e.metaKey;
  // letters by their key position, so the shortcuts work with a Marathi keyboard layout too
  if (mod && !e.altKey && e.code === "KeyS") {
    e.preventDefault(); // also in a text box: never the browser's own Save dialog
    if (canEdit()) savePage();
    else if (S.saveRunning) notice("The page is being saved.", "wait");
    else if (S.data) {
      S.saveAfter = true; // asked while the page is being set: saved as soon as it is
      notice("The page is saved as soon as it is set.", "wait");
    }
    return;
  }
  const t = e.target;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
  if (mod && e.code === "KeyZ") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if (mod && e.code === "KeyY") {
    e.preventDefault();
    redo();
    return;
  }
  if (e.key === "Escape") {
    if (S.drag) return cancelDrag();
    if (S.swapping) return stopSwapping();
    S.selected = null;
    renderPanels();
    return invalidate();
  }
  if (mod || e.altKey) return; // the browser's own shortcuts (Ctrl and +/-/0 zoom the browser)
  if (e.code === "Equal" || e.code === "NumpadAdd") return zoomBy(1.25);
  if (e.code === "Minus" || e.code === "NumpadSubtract") return zoomBy(0.8);
  if (e.code === "Digit0" || e.code === "Numpad0") return fitPage();
  // Shift+1 the whole page, Shift+2 the selected story, Shift+3 the page's width, Shift+R the rulers; not during a drag
  // (a drag is measured in the view it started in)
  const view = e.shiftKey && !S.drag ? VIEW_KEYS.get(e.code) : undefined;
  if (view) {
    e.preventDefault();
    if (!e.repeat) view();
    return;
  }
  // Shift+L locks the selected story in place, or unlocks it (by the key's position, as the keys above)
  if (e.shiftKey && e.code === "KeyL" && !S.drag) {
    e.preventDefault();
    if (e.repeat || !S.data) return;
    if (!S.modules.some((x) => x.story === S.selected))
      return notice(`Select a story on the page first: ${SHIFT}L locks it in place.`, "lock");
    return toggleLock(S.selected);
  }
  // the canvas's menu from the keyboard: Shift+F10, or the menu key (a button or a list keeps its own)
  if ((e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) && (t === canvas || t === document.body)) {
    e.preventDefault();
    if (!e.repeat && S.data && !S.drag) openMenuFromKeys();
    return;
  }
  if (e.key === "PageDown") return goPage(ID.page + 1);
  if (e.key === "PageUp") return goPage(ID.page - 1);
  if (!S.data || S.drag) return;
  const m = S.modules.find((x) => x.story === S.selected);
  // story keys act only while the page has the focus: not on a button or a list, nor when the focus fell to the body
  if (!m || t !== canvas) return;
  if (e.key === "Enter") {
    e.preventDefault();
    return openText(m.story);
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    return removeStory(m.story);
  }
  const step = e.shiftKey ? 5 : S.data.grid.snap_mm;
  const moves = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-pitch(), 0], ArrowRight: [pitch(), 0] };
  if (moves[e.key]) {
    e.preventDefault();
    if (m.locked) return refuseLocked(m.story, "move it");
    const [dx, dy] = moves[e.key];
    const g = snapModule({ ...m, x: m.x + dx, y: m.y + dy });
    update(m.story, { x: g.x, y: g.y });
  }
});

// ------------------------------------------------------------------------------------------- the canvas's menu

/* The menu of a story (a right-click on it, or Shift+F10 or the menu key while it is selected) or of the page's empty
 * space: a role="menu" list of buttons. The arrow keys, Home and End move in it, Enter or Space acts, Esc or Tab
 * closes it and the focus goes back to the page. An item a lock refuses stays in the menu, marked off, and says why. */
const M = { open: false, story: null, items: [], at: [0, 0], keyAt: -1e9, pointerAt: -1e9 }; // at: where it opened (px)

function menuItems(story) {
  if (!story)
    return [
      {
        label: "Unlock all on page",
        act: unlockAll,
        off: S.modules.some((m) => m.locked) ? "" : "No story on this page is locked.",
      },
    ];
  const locked = lockedHere(story);
  const n = noteOf(story);
  const held = (what) => (locked ? `${cap(nameOf(story))} is locked: unlock it (${SHIFT}L) to ${what}.` : "");
  const fits =
    !n || n.fit === "fits" ? "It already fits its box." : n.fit === "none" ? "It cannot be set at this width." : "";
  return [
    { label: "Edit text", key: "Enter", act: () => openText(story) },
    { label: "Fit height to text", act: () => fitHeight(story), off: held("change its size") || fits },
    { label: "Swap with…", act: startSwapping, off: held("move it") },
    { label: locked ? "Unlock" : "Lock in place", key: `${SHIFT}L`, act: () => toggleLock(story) },
    {
      label: "Remove from page",
      key: MAC ? "⌫" : "Del",
      act: () => removeStory(story),
      off: held("take it off the page"),
      danger: true,
    },
  ];
}

/** The menu of a story (or of the page: story null) at a point of the view (px), kept inside the view. */
function openMenu(story, at) {
  closeMenu();
  if (!S.data) return;
  if (S.swapping) stopSwapping();
  M.story = story;
  M.items = menuItems(story);
  M.at = at;
  M.open = true;
  const menu = $("#menu");
  menu.setAttribute("aria-label", story ? `Story ${headOf(story)}` : "The page");
  renderMenu();
  menu.hidden = false;
  placeMenu();
  menuFocus(0);
}

/** The menu's items as buttons; the one that had the focus keeps it. */
function renderMenu() {
  const menu = $("#menu");
  const focused = [...menu.children].indexOf(document.activeElement);
  menu.replaceChildren(
    ...M.items.map((it, i) =>
      el(
        "button",
        {
          type: "button",
          role: "menuitem",
          tabindex: "-1",
          class: it.danger ? "danger" : null,
          "aria-disabled": it.off ? "true" : null,
          title: it.off || null,
          "data-i": i,
        },
        el("span", {}, it.label),
        it.key ? el("span", { class: "key", "aria-hidden": "true" }, it.key) : null,
      ),
    ),
  );
  if (focused >= 0) menuFocus(focused);
}

/** The open menu at the point it was opened at, kept inside the view: when it opens, and when the view changes size
 * (a notice, the story panel), so it stays open with the focus in it. */
function placeMenu() {
  if (!M.open) return;
  const menu = $("#menu");
  const area = $("#wrap").getBoundingClientRect();
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(M.at[0], area.width - r.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(M.at[1], area.height - r.height - 4))}px`;
}

/** The open menu after the page changed (an answer came, a lock was set or lifted): its items as the page is now; it
 * closes when its story has left the page. */
function refreshMenu() {
  if (!M.open) return;
  if (M.story && !S.modules.some((m) => m.story === M.story)) return closeMenu();
  const items = menuItems(M.story);
  const shown = (list) => list.map((it) => `${it.label}\t${it.off || ""}`).join("\n");
  const changed = shown(items) !== shown(M.items);
  M.items = items;
  if (changed) renderMenu();
}

/** The menu from the keyboard: the selected story's, beside it; else the page's, at the view's top left. */
function openMenuFromKeys() {
  M.keyAt = performance.now(); // the browser may send its own menu event for the same key: not a second menu
  const m = S.modules.find((x) => x.story === S.selected);
  const edge = (S.rulers ? RULER_PX : 0) + 12;
  if (!m) return openMenu(null, [edge, edge]);
  const [x0, y0] = toPx(m.x, m.y);
  openMenu(m.story, [Math.max(edge, x0 + 12), Math.max(edge, y0 + 12)]);
}

/** The menu closed. The focus never falls to the page's body: from the menu it goes back to the page (a click that
 * closed it then moves it on, as clicks do). */
function closeMenu() {
  if (!M.open) return;
  const inside = $("#menu").contains(document.activeElement);
  M.open = false;
  M.story = null;
  M.items = [];
  $("#menu").hidden = true;
  $("#menu").replaceChildren();
  if (inside || document.activeElement === document.body) canvas.focus();
}

function menuFocus(i) {
  const items = [...$("#menu").children];
  if (items.length) items[(i + items.length) % items.length].focus();
}

/** An item chosen: done after the menu closes; one a lock refuses says why instead. */
function menuAct(i) {
  const it = M.items[i];
  if (!it) return;
  closeMenu();
  if (it.off) return notice(it.off, "lock");
  it.act();
}

$("#menu").addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest("[role='menuitem']") : null;
  if (b) menuAct(Number(b.dataset.i));
});
$("#menu").addEventListener("keydown", (e) => {
  if (e.isComposing || e.keyCode === 229) return;
  if (e.ctrlKey || e.metaKey) return closeMenu(); // undo, save …: the page's own keys, with the menu closed
  e.stopPropagation(); // the page's other keys do not act while the menu is open
  const items = [...$("#menu").children];
  const i = items.indexOf(document.activeElement);
  const to = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
  if (to !== undefined) {
    e.preventDefault();
    return menuFocus(to);
  }
  if (e.key === "Escape" || e.key === "Tab" || e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
    e.preventDefault();
    if (e.key !== "Escape" && e.key !== "Tab") M.keyAt = performance.now(); // its own menu event: not a new menu
    return closeMenu();
  }
  if (e.shiftKey && e.code === "KeyL" && M.story) {
    e.preventDefault();
    const story = M.story;
    closeMenu();
    return toggleLock(story);
  }
  // Enter and Space press the item that has the focus (the browser makes them a click)
});
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault(); // the page has its own menu
  const now = performance.now();
  const byPointer = now - M.pointerAt < 10000; // a right-click: the menu at the pointer
  M.pointerAt = -1e9;
  if (!S.data || S.drag) return;
  if (!byPointer) {
    // the menu key or Shift+F10: opened already by the key itself, else the selected story's (or the page's)
    if (now - M.keyAt >= 1000) openMenuFromKeys();
    M.keyAt = -1e9;
    return;
  }
  const r = canvas.getBoundingClientRect();
  const [px, py] = [e.clientX - r.left, e.clientY - r.top];
  if (onRuler(px, py)) return;
  canvas.focus();
  const h = hit(px, py);
  if (h && h.story !== S.selected) select(h.story);
  openMenu(h ? h.story : null, [px, py]);
});
$("#menu").addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("pointerdown", (e) => M.open && !$("#menu").contains(e.target) && closeMenu(), true);
window.addEventListener("blur", () => closeMenu());

// ------------------------------------------------------------------------------------------- view (zoom and rulers)

function zoomBy(f) {
  S.zoom = clampZoom(S.zoom * f);
  S.fitTo = null;
  fit();
}

/** The whole page in the view (Shift+1, 0, Fit). */
function fitPage() {
  S.zoom = 1;
  S.fitTo = null;
  fit();
}

/** The page's width fills the view (Shift+3), and fills it again when the view changes size. */
function fitWidth() {
  if (!S.data) return;
  const { w, h } = size();
  S.zoom = clampZoom(fitWidthZoom(w, h, S.data.grid.page_w_mm, S.data.grid.page_h_mm));
  S.fitTo = "width";
  fit();
}

/** The selected story fills the view, with a margin (Shift+2). It stays in view when the view changes size (the story
 * panel opening, the window) until you zoom or scroll yourself. */
function zoomToSelection() {
  if (!S.data) return;
  const box = unionBox(S.modules.filter((m) => m.story === S.selected).map(boxOf)); // one story is selected at a time
  if (!box) return say("Select a story on the page first: Shift+2 zooms to it.");
  showBox(box);
}

/** The view fitted around a box on the page (mm), inside the rulers. */
function showBox(box) {
  if (!S.data) return;
  const { w, h } = size();
  const r = S.rulers ? RULER_PX : 0;
  const v = zoomToRect(box, { x0: r, y0: r, x1: w, y1: h }, pageFit(w, h), ZOOM_MARGIN_PX);
  if (!v) return;
  S.zoom = v.zoom;
  S.view = { s: v.s, ox: v.ox, oy: v.oy };
  S.fitTo = box;
  zoomLabel();
  invalidate();
}

/** The view after its size changed: the page, its width or the story zoomed to, fitted again. */
function refit() {
  if (S.fitTo === "width") fitWidth();
  else if (S.fitTo) showBox(S.fitTo);
  else fit();
}

/** Shows or hides the rulers (Shift+R), and keeps the choice in this browser. */
function toggleRulers() {
  S.rulers = !S.rulers;
  writePrefs({ rulers: S.rulers });
  showRulers();
}

function showRulers() {
  $("#rulers").setAttribute("aria-pressed", S.rulers ? "true" : "false");
  $("#wrap").classList.toggle("rulers", S.rulers);
  redraw();
}

const VIEW_KEYS = new Map([
  ["Digit1", fitPage],
  ["Digit2", zoomToSelection],
  ["Digit3", fitWidth],
  ["KeyR", toggleRulers],
]);

/** The editor's choices kept in this browser ({rulers}); the editor works the same without them. */
function readPrefs() {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) || "null");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writePrefs(change) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...change }));
  } catch {
    // storage is blocked or full: the choice lasts while the page is open
  }
}

canvas.addEventListener(
  "wheel",
  (e) => {
    if (!S.data) return;
    e.preventDefault();
    closeMenu(); // it stood where the page was
    if (e.ctrlKey || e.metaKey) {
      const r = canvas.getBoundingClientRect();
      const [mx, my] = toMm(e.clientX - r.left, e.clientY - r.top);
      const f = Math.exp(-e.deltaY / 300);
      const before = S.view.s;
      S.zoom = clampZoom(S.zoom * f);
      const { w, h } = size();
      const s = pageFit(w, h) * S.zoom;
      S.view = { s, ox: e.clientX - r.left - mx * s, oy: e.clientY - r.top - my * s };
      if (before !== s) zoomLabel();
    } else {
      S.view = { ...S.view, ox: S.view.ox - e.deltaX, oy: S.view.oy - e.deltaY };
    }
    S.fitTo = null; // zoomed or scrolled by hand: a change of size keeps the zoom, not this place
    invalidate();
  },
  { passive: false },
);

// the page fills the space left to it (the window, or the story panel opening or resized); a menu open on it stays
new ResizeObserver(() => {
  refit();
  placeMenu(); // a menu open on the page stays open, inside the view
}).observe($("#wrap"));

// ------------------------------------------------------------------------------------------- panels

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "onclick") n.addEventListener("click", v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined) n.append(kid instanceof Node ? kid : String(kid));
  return n;
}

/** A list row that acts: a button inside the list item, so it works from the keyboard and lists stay lists. */
function row(liClass, attrs, ...kids) {
  return el("li", { class: liClass }, el("button", { type: "button", class: "row", ...attrs }, ...kids));
}

const SHORT_ITEMS = "(short items)";
const mr = (text) => el("span", text === SHORT_ITEMS ? {} : { lang: "mr" }, text); // Marathi inside English text
const langOf = (text) => (text === SHORT_ITEMS ? "en" : "mr");

const noteOf = (story) => (S.data ? S.data.notes.find((n) => n.story === story) : null);
const headOf = (story) => {
  const n = noteOf(story);
  if (n) return n.headline || SHORT_ITEMS;
  const p = S.data ? S.data.pool.find((x) => x.story === story) : null;
  return p ? p.headline : story;
};
const articleHead = (aid) => {
  const a = T.articles.find((x) => x.id === aid);
  if (a) return (a.headline || "").slice(0, 60);
  const n = S.data ? S.data.notes.find((x) => (x.articles || []).includes(aid)) : null;
  return n ? (n.headline || "a short item").slice(0, 60) : "an article";
};
/** A story in a message: its headline in quotes, or the column of short items. */
const nameOf = (story) => {
  const head = headOf(story);
  return head === SHORT_ITEMS ? "the column of short items" : `“${head.slice(0, 60)}”`;
};
const cap = (text) => text.charAt(0).toUpperCase() + text.slice(1); // a message that starts with a name

function fitText(n) {
  if (!n) return ["", ""];
  if (n.fit === "fits") return ["ok", "Fits its box exactly."];
  if (n.fit === "over") return ["bad", `The text needs ${Math.round(n.by_mm)} mm more — make the box taller or wider.`];
  if (n.fit === "short") return ["warn", `${Math.round(n.by_mm)} mm empty at the foot — make the box shorter.`];
  return ["bad", "Cannot be set at this width — make it wider."];
}

/** Buttons that start a request are off while the page cannot be changed. */
function tools() {
  const ok = canEdit();
  $("#save").disabled = !ok;
  $("#alt").disabled = !ok;
  $("#refresh").disabled = !ok;
  $("#undo").disabled = !ok || !S.undo.length;
  $("#redo").disabled = !ok || !S.redo.length;
  const moving = S.switching || S.working; // a save's result stays on screen until it is done
  $("#prev").disabled = moving || ID.page <= 1;
  $("#next").disabled = moving || (S.pages ? ID.page >= S.pages : false);
  $("#zoom-sel").disabled = !S.data || !S.modules.some((m) => m.story === S.selected); // the view only: never busy
}

function renderPanels() {
  tools();
  if (!S.data) return;
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : "";
  const also = S.data.also_on_pages || {};
  const held = S.data.locked_on_pages || {};
  const on = $("#on-page");
  on.replaceChildren(
    ...S.modules.map((m) => {
      const n = noteOf(m.story);
      const [cls, text] = fitText(n);
      const elsewhere = held[m.story]
        ? ` · locked on page ${held[m.story]} too: unlock it there, or take it off here, to save this page`
        : also[m.story]
          ? ` · still on page ${also[m.story]} until you save`
          : "";
      return row(
        `${m.story === S.selected ? "selected" : ""} ${cls === "ok" && !elsewhere ? "" : "warn"}`,
        {
          "aria-pressed": m.story === S.selected ? "true" : "false",
          "data-key": `on:${m.story}`,
          onclick: () => (S.swapping ? swapWith(m.story) : select(m.story)),
        },
        mr(headOf(m.story)),
        el(
          "span",
          { class: "meta" },
          `${m.w} col × ${Math.round(m.h)} mm${m.locked ? " · locked" : ""} · ${text}${elsewhere}`,
        ),
      );
    }),
  );
  const q = ($("#pool-search").value || "").trim();
  const pool = S.data.pool.filter((p) => !S.modules.some((m) => m.story === p.story) && (!q || p.headline.includes(q)));
  $("#pool").replaceChildren(
    ...pool.slice(0, 200).map((p) =>
      row(
        p.locked ? "locked" : "",
        {
          title: p.locked
            ? `Locked on page ${p.on_page}: unlock it there to bring it here`
            : p.on_page
              ? `Move this story here from page ${p.on_page} (it leaves that page when you save this one)`
              : "Bring this story onto the page",
          "data-key": `pool:${p.story}`,
          "aria-disabled": p.locked ? "true" : null, // still says why when pressed
          onclick: () => bringIn(p.story),
        },
        mr(p.headline),
        el(
          "span",
          { class: "meta" },
          `${p.brief ? "short items" : "story"}${p.locked ? ` · locked on page ${p.on_page}` : p.on_page ? ` · now on page ${p.on_page}` : " · not on any page"}`,
        ),
      ),
    ),
  );
  const m = S.modules.find((x) => x.story === S.selected);
  $("#props-empty").hidden = !!m;
  $("#props").hidden = !m;
  if (m) {
    const locked = !!m.locked; // its place, width and height cannot change: those controls are off
    $("#p-headline").textContent = headOf(m.story);
    $("#p-headline").lang = langOf(headOf(m.story));
    const [cls, text] = fitText(noteOf(m.story));
    const fitEl = $("#p-fit");
    fitEl.className = `fit ${cls}`;
    fitEl.textContent = text;
    $("#p-lock").setAttribute("aria-pressed", locked ? "true" : "false");
    $("#p-lock-note").hidden = !locked;
    $("#p-width").replaceChildren(
      ...Array.from({ length: S.data.grid.columns }, (_, i) =>
        el(
          "button",
          {
            type: "button",
            "aria-pressed": m.w === i + 1 ? "true" : "false",
            "data-key": `w:${i + 1}`,
            disabled: locked,
            onclick: () => update(m.story, snapModule({ ...m, w: i + 1 })),
          },
          i + 1,
        ),
      ),
    );
    const col = colOf(m.x);
    $("#p-col").replaceChildren(
      ...Array.from({ length: S.data.grid.columns - m.w + 1 }, (_, i) =>
        el(
          "button",
          {
            type: "button",
            "aria-pressed": col === i ? "true" : "false",
            "data-key": `c:${i + 1}`,
            disabled: locked,
            onclick: () => update(m.story, { x: S.data.grid.origin_mm + i * pitch() }),
          },
          i + 1,
        ),
      ),
    );
    for (const id of ["#p-height", "#p-y", "#p-fit-height", "#p-swap", "#p-remove"]) $(id).disabled = locked;
    if (!typing.has("#p-height")) $("#p-height").value = Math.round(m.h * 2) / 2;
    if (!typing.has("#p-y")) $("#p-y").value = Math.round(m.y * 2) / 2;
  }
  $("#problems").replaceChildren(...problemItems());
  storyFit();
  refreshMenu();
  if (focused) refocus(focused);
}

/** Focus back on the row or button with this key (it was drawn again), or on the story's row elsewhere. */
function refocus(key) {
  const story = key.slice(key.indexOf(":") + 1);
  const target =
    document.querySelector(`[data-key="${CSS.escape(key)}"]`) ||
    document.querySelector(`[data-key="${CSS.escape(`on:${story}`)}"]`) ||
    document.querySelector(`[data-key="${CSS.escape(`pool:${story}`)}"]`);
  if (target && document.activeElement !== target) target.focus();
}

/** A problem in words: [plain text for a question, the same as text and Marathi parts for the list]. */
function problemParts(p) {
  const names = (p.stories || []).map((x) => `“${(headOf(x) || "").slice(0, 40)}”`);
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  const one = names[0] || "";
  switch (p.kind) {
    case "overlap":
      return [names[0], " and ", names[1], ` overlap by ${Math.round(p.mm)} mm.`];
    case "outside":
      return [one, " is outside the news area, or over an advertisement or picture."];
    case "over":
      return [one, `: the text needs ${Math.round(p.mm)} mm more.`];
    case "overset":
      return [
        one,
        p.lines
          ? `: ${n(p.lines, "line", "lines")} of text do not fit and would not print.`
          : `: ${n(p.words, "word", "words")} of a subheading do not fit and would not print.`,
      ];
    case "unset":
      return [one, `: ${n(p.paragraphs, "paragraph", "paragraphs")} could not be set and would not print.`];
    case "short":
      return [one, `: ${Math.round(p.mm)} mm empty at its foot.`];
    case "cannot_set":
      return [one, " cannot be set at this width."];
    case "touch":
      return names.length > 1
        ? [
            ...names.flatMap((x, i) => (i ? [i === names.length - 1 ? " and " : ", ", x] : [x])),
            ": lines of these stories touch in ink. Check the page before sending it.",
          ]
        : [one, ": two of its lines touch in ink. Check the page before sending it."];
    case "empty":
      return [`About ${Math.round((p.mm2 || 0) / 100)} cm² of the news area is empty.`];
    default:
      return [String(p.kind)];
  }
}

const problemText = (p) => problemParts(p).join("");

function problemNodes(p) {
  const names = new Map((p.stories || []).map((x) => [`“${(headOf(x) || "").slice(0, 40)}”`, headOf(x)]));
  return problemParts(p).map((part) =>
    names.has(part) && names.get(part) !== SHORT_ITEMS ? el("span", { lang: "mr" }, part) : part,
  );
}

function problemItems() {
  const out = [];
  for (const p of S.data.problems) {
    const cls = BAD.has(p.kind) ? "bad" : "";
    out.push(
      p.stories && p.stories[0]
        ? row(
            cls,
            {
              title: "Select the story",
              "data-key": `prob:${p.kind}:${p.stories[0]}`,
              onclick: () => select(p.stories[0]),
            },
            ...problemNodes(p),
          )
        : el("li", { class: cls }, ...problemNodes(p)),
    );
  }
  if (!out.length) out.push(el("li", { class: "ok" }, "No problems: every story fits and nothing overlaps."));
  return out;
}

function select(story) {
  S.selected = story;
  renderPanels();
  invalidate();
}

function swapWith(story) {
  const from = S.selected;
  stopSwapping();
  if (from && story !== from) swap(from, story);
}

/** The save state beside the button. Read aloud only when a save ends (not at every move: that would be noise). */
function setSaved(text) {
  $("#save-state").textContent = text;
  $("#save-state").title = text; // the slot shows two lines at most: the whole status on hover
  if (text.startsWith("Saved")) say(text);
}

/** A longer message under the toolbar (what changed, what to do next); kind marks who may clear it. Screen readers
 * hear it from a live region that is always there (an error assertively). */
function notice(text, kind = "") {
  $("#notice-text").textContent = text || "";
  $("#notice").hidden = !text;
  $("#notice").classList.toggle("error", kind === "error");
  S.noticeKind = text ? kind : "";
  say(text || "", kind === "error");
}

const sayWaiting = new Map(); // live region → text about to be read
function say(text, urgent = false) {
  const live = urgent ? $("#alert") : $("#announce");
  if (sayWaiting.has(live)) {
    if (text) sayWaiting.set(live, [sayWaiting.get(live), text].filter(Boolean).join(" ")); // both are read
    return;
  }
  live.textContent = "";
  if (!text) return;
  sayWaiting.set(live, text);
  setTimeout(() => {
    live.textContent = sayWaiting.get(live) || ""; // a change the reader notices
    sayWaiting.delete(live);
  }, 50);
}

/** The busy note on the page: what is being done now (the longest job first). */
function showBusy(text) {
  const b = $("#busy");
  const msg = S.switching
    ? "Keeping your last change…"
    : S.opening
      ? text || "Opening the page…"
      : S.working
        ? S.workText
        : S.sending || S.queued
          ? "Setting the page…"
          : T.saving
            ? "Setting the page with the new text…"
            : "";
  b.hidden = !msg;
  if (msg && b.textContent !== msg) b.textContent = msg;
}

function showProblem(msg) {
  setSaved(S.dirty ? "Changed · not saved" : "");
  notice(msg, "error");
}

async function goPage(n) {
  if (n < 1 || (S.pages && n > S.pages) || n === ID.page || S.switching || S.working) return;
  closeMenu();
  cancelDrag();
  stopSwapping();
  if (!(await closeText(false))) return notice("Your typed text could not be saved: see the story panel.", "error");
  if (S.switching) return;
  S.switching = true; // no edits while the last ones are answered and the next page opens
  tools();
  showBusy();
  await waitFor(idle);
  S.gen += 1;
  S.saveAfter = false;
  ID.page = n;
  params.set("page", String(n));
  history.replaceState(null, "", `?${params.toString()}`);
  S.data = null;
  S.modules = [];
  S.undo = [];
  S.redo = [];
  S.selected = null;
  S.dirty = false;
  notice("");
  title();
  S.switching = false;
  await openPage();
}

const when = (iso) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "an earlier time";
};

function title() {
  $("#title").textContent = `Page ${ID.page}`;
  const parts = [ID.edition, S.pages ? `${S.pages} pages` : "", S.run ? `layout of ${when(S.run.started)}` : ""];
  $("#subtitle").textContent = parts.filter(Boolean).join(" · ");
  $("#subtitle").title = $("#subtitle").textContent; // cut short when the toolbar needs the room
  document.title = `Page ${ID.page} · ${ID.edition} · Pageinator Desk`;
}

/** Leaving with a change on its way may lose it; leaving with changes not saved leaves the print file behind. */
function leaveText() {
  if (textBusy()) return "Your last typing is not set on the page yet: it may be lost if you leave now.";
  if (!sent() || S.working) return "The page is still being set: your last change may be lost if you leave now.";
  if (S.dirty)
    return `Your changes to page ${ID.page} are kept, but its print file is made only when you save the page.`;
  return "";
}

// ------------------------------------------------------------------------------------------- story text

/* The story panel: the text of a story's article(s), in ordinary text boxes (so every Marathi input method works),
 * saved to the edition's article as you pause and set on the page by the engine. The page is never set with browser
 * text: what the page shows is still the engine's typesetting. */
const T = {
  story: null, // the story whose text is shown
  articles: [], // the edition's articles of that story
  pending: new Map(), // article id -> fields typed and not saved yet
  timer: 0,
  saving: false,
  fresh: false, // typed since the last save of the text began
  others: null, // what setting the typed text for a save also set (other stories, folio, ads): the save stops on it
  textSaved: false, // the typed text is saved, but the page could not be set with it (changed in another window, …)
  lastOk: true, // the last text save's outcome (a save waiting on one that was on its way uses it)
  invalid: new Set(), // articles whose typed text cannot be used (no paragraph): the page keeps the last good one
  error: "",
  letGo: false,
};
const TEXT_PAUSE_MS = 900;
const TEXT_FIELDS = [
  ["kicker", "Kicker", "input", 1, ""],
  ["byline", "Byline", "input", 1, ""],
  ["headline", "Headline", "textarea", 2, "wide"],
  ["deck", "Deck", "textarea", 2, "wide"],
  ["body", "Text — an empty line between paragraphs; a line starting with ## is a subheading", "textarea", 12, "wide"],
];
const textBusy = () => T.saving || T.pending.size > 0 || T.invalid.size > 0; // typed text not on the page yet

async function openText(story) {
  if (!S.data || !story) return;
  if (T.story && T.story !== story && !(await closeText(false))) return; // its text could not be saved: said
  const note = noteOf(story);
  const ids = note ? note.articles || [] : [];
  T.story = story;
  T.articles = [];
  $("#story").hidden = false;
  $("#story-title").textContent = headOf(story);
  $("#story-title").lang = langOf(headOf(story));
  $("#story-state").textContent = "Reading the text…";
  $("#story-articles").replaceChildren();
  storyFit();
  invalidate();
  try {
    const ed = await api("GET", `/api/editions/${encodeURIComponent(ID.edition)}`);
    if (T.story !== story) return;
    const live = new Map((ed.articles || []).map((a) => [a.id, a]));
    T.articles = ids.map((id) => live.get(id)).filter(Boolean);
    renderText(ids.length - T.articles.length);
    const first = $("#story-articles textarea[data-field='body']");
    if (first) first.focus();
  } catch (e) {
    $("#story-state").textContent = e.message;
  }
}

function renderText(gone) {
  const many = T.articles.length > 1 || String(T.story).startsWith("dbriefs"); // short items: headline and text
  const box = $("#story-articles");
  box.replaceChildren(
    ...T.articles.map((a) =>
      el(
        "fieldset",
        { class: "ed-article" },
        many ? el("legend", { lang: "mr" }, (a.headline || "").slice(0, 80)) : null,
        ...TEXT_FIELDS.filter(([k]) => !many || k === "headline" || k === "body").map(([k, label, tag, rows, cls]) => {
          const input = el(tag, {
            lang: k === "byline" || k === "kicker" ? null : "mr", // names and kickers may be in English
            rows: tag === "textarea" ? rows : null,
            spellcheck: "false",
            "data-field": k,
            "data-article": a.id,
          });
          input.value = a[k] || "";
          input.addEventListener("input", (e) => {
            if (!e.isComposing) textChanged(a.id, k, input.value);
          });
          input.addEventListener("compositionend", () => textChanged(a.id, k, input.value));
          return el("label", { class: cls }, el("span", {}, label), input);
        }),
      ),
    ),
  );
  if (gone)
    box.append(
      el(
        "p",
        { class: "muted small" },
        `${gone === 1 ? "One article" : `${gone} articles`} of this story ${gone === 1 ? "is" : "are"} no longer in ` +
          "the edition, so that text cannot be changed here.",
      ),
    );
  $("#story-state").textContent = T.articles.length
    ? "Type to change the text; the page is set again when you pause."
    : "This story's articles are no longer in the edition.";
}

/** The story's fit, shown above its text while typing. */
function storyFit() {
  if (!T.story) return;
  const f = $("#story-fit");
  if (!S.modules.some((m) => m.story === T.story)) {
    f.className = "fit warn";
    f.textContent = "This story is not on the page now.";
    return;
  }
  const [cls, text] = fitText(noteOf(T.story));
  f.className = `fit ${cls}`;
  f.textContent = text;
}

function textChanged(aid, field, value) {
  const p = T.pending.get(aid) || {};
  p[field] = value;
  T.pending.set(aid, p);
  T.fresh = true;
  $("#story-state").textContent = "Typing…";
  clearTimeout(T.timer);
  T.timer = setTimeout(flushText, TEXT_PAUSE_MS);
}

/** Saves what was typed to the articles, then sets the page again with it; typing meanwhile is saved next. → false
 * when some of it could not be saved (it stays in the boxes, and is tried again at the next change). */
async function flushText() {
  clearTimeout(T.timer);
  if (T.saving) {
    await waitFor(() => !T.saving);
    return T.lastOk && !T.pending.size && !T.invalid.size; // that save's own outcome counts too
  }
  if (!T.pending.size) return !T.invalid.size;
  T.saving = true;
  T.fresh = false;
  showBusy();
  const gen = S.gen;
  let ok = true;
  try {
    while (T.pending.size && gen === S.gen && ok) {
      const batch = [...T.pending];
      T.pending.clear();
      $("#story-state").textContent = "Saving the text…";
      let saved = 0;
      for (const [i, [aid, fields]] of batch.entries()) {
        const send = { ...fields };
        if ("body" in send && !hasParagraph(send.body)) {
          delete send.body; // a story needs some text: the page keeps the last text that had a paragraph
          T.invalid.add(aid);
          T.error = "A story needs at least one paragraph of text: the page keeps the last text that had one.";
          ok = false;
        }
        try {
          if (Object.keys(send).length) {
            await api(
              "PUT",
              `/api/editions/${encodeURIComponent(ID.edition)}/articles/${encodeURIComponent(aid)}`,
              send,
            );
            saved += 1;
            tellDesk(); // the article changed for the whole edition, whatever the page does next
            if ("body" in send) T.invalid.delete(aid);
          }
        } catch (e) {
          // what was not saved goes back to the boxes' list (typing since then wins), and is said
          for (const [a, f] of batch.slice(i)) T.pending.set(a, { ...f, ...(T.pending.get(a) || {}) });
          T.error = `${e.message} Your text is still here; change it to try again.`;
          ok = false;
          break;
        }
      }
      if (!saved) break;
      $("#story-state").textContent = "Setting the page with the new text…";
      for (;;) {
        // a save of the page sets the text itself; else wait until the page can change
        await waitFor(() => canEdit() || S.textInline || gen !== S.gen);
        if (gen !== S.gen) break;
        if (S.textInline) {
          try {
            await setText(gen, base());
          } catch (e) {
            if (e.status !== 409) throw e;
            // the text is saved, but the page changed in another window: it is shown as it is now, and the save stops
            await resync(gen, e.message);
            T.textSaved = true;
            T.error =
              "Your text is saved, but the page was changed in another window or tab; it is shown again as it is now.";
            ok = false;
          }
          break;
        }
        const outcome = await exclusive("Setting the page with the new text…", setText);
        if (outcome === "busy") continue;
        if (outcome !== "ok") {
          ok = false;
          T.textSaved = true;
          T.error = "The text is saved, but the page could not be set with it: press Update text.";
        }
        break;
      }
    }
    if (gen === S.gen)
      $("#story-state").textContent = !ok ? T.error : T.pending.size ? "Typing…" : "Saved · the page shows this text";
    storyFit();
  } catch (e) {
    ok = false;
    T.error = `${e.message} Your text is still here; change it to try again.`;
    $("#story-state").textContent = T.error;
  } finally {
    T.saving = false;
    if (T.pending.size && T.fresh) T.timer = setTimeout(flushText, TEXT_PAUSE_MS); // typed while saving
    settled();
  }
  if (ok && gen === S.gen) say("The page shows your text.");
  T.lastOk = ok && !T.pending.size && !T.invalid.size;
  return T.lastOk;
}

/** A body with at least one paragraph (a line that is not empty and not a ## subheading). */
const hasParagraph = (body) =>
  String(body || "")
    .split("\n")
    .some((line) => line.trim() && !line.trim().startsWith("##"));

/** The page set again with the articles' new text (Update text for this page). */
async function setText(gen, url) {
  const locked = lockedNames();
  const data = await api("POST", `${url}/refresh`, { rev: rev() });
  if (!(await accept(data, gen))) return;
  const { said, changed } = refreshSaid(data, locked);
  if (changed) {
    S.edits += 1;
    S.dirty = true;
    setSaved("Changed · not saved");
  }
  // the typed story alone needs no word; other stories set with their current text, articles gone, the folio, an ad
  // or a story that would now be of another kind do (and a save waiting on this text stops to let them be checked)
  const others =
    (data.changed || []).some((k) => k !== T.story) ||
    (data.dropped || []).length > 0 ||
    (data.removed || []).length > 0 ||
    !!data.folio_changed ||
    (data.ads_changed || []).length > 0 ||
    (data.kind_changes || []).length > 0;
  const notes = others ? said : said.filter((x) => !x.endsWith("set with the new text."));
  if (notes.length) notice(notes.join(" "));
  if (others && S.textInline) T.others = notes;
}

/** Closes the story panel after its text is saved. → false when typed text could not be saved: the panel stays (a
 * second close lets it go). */
async function closeText(refocus = true) {
  if (!T.story) return true;
  if ((T.pending.size || T.invalid.size) && !(await flushText()) && !T.letGo) {
    T.letGo = true;
    $("#story-state").textContent = `${T.error || "Your text could not be saved."} Close again to let it go.`;
    return false;
  }
  await waitFor(() => !T.saving);
  T.pending.clear();
  T.invalid.clear();
  T.letGo = false;
  T.story = null;
  T.articles = [];
  $("#story").hidden = true;
  $("#story-articles").replaceChildren();
  invalidate();
  if (refocus) canvas.focus();
}

// ------------------------------------------------------------------------------------------- start

$("#alt").addEventListener("click", another);
$("#refresh").addEventListener("click", refreshText);
$("#undo").addEventListener("click", undo);
$("#redo").addEventListener("click", redo);
$("#save").addEventListener("click", savePage);
$("#zoom-in").addEventListener("click", () => zoomBy(1.25));
$("#zoom-out").addEventListener("click", () => zoomBy(0.8));
$("#zoom-fit").addEventListener("click", fitPage);
$("#zoom-width").addEventListener("click", fitWidth);
$("#zoom-sel").addEventListener("click", zoomToSelection);
$("#rulers").addEventListener("click", toggleRulers);
$("#prev").addEventListener("click", () => goPage(ID.page - 1));
$("#next").addEventListener("click", () => goPage(ID.page + 1));
$("#pool-search").addEventListener("input", renderPanels);
$("#notice-close").addEventListener("click", () => notice(""));
$("#p-remove").addEventListener("click", () => S.selected && removeStory(S.selected));
$("#p-swap").addEventListener("click", startSwapping);
$("#p-text").addEventListener("click", () => S.selected && openText(S.selected));
$("#story-close").addEventListener("click", () => closeText());
$("#story").addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !e.isComposing) {
    e.preventDefault();
    closeText();
  }
});
$("#p-fit-height").addEventListener("click", () => S.selected && fitHeight(S.selected));
$("#p-lock").addEventListener("click", () => S.selected && toggleLock(S.selected));
$("#p-lock-note").textContent =
  `Locked in place for this layout: its place, width and height stay as they are, and it stays on this page. Unlock ` +
  `it (${SHIFT}L) to change them. Its text can still change.`;
const typing = new Set(); // number fields being typed in (the panel does not overwrite them meanwhile)
for (const [id, keyName] of [
  ["#p-height", "h"],
  ["#p-y", "y"],
]) {
  $(id).addEventListener("input", () => typing.add(id));
  $(id).addEventListener("blur", () => {
    typing.delete(id);
    renderPanels();
  });
  $(id).addEventListener("change", (e) => {
    typing.delete(id);
    const m = S.modules.find((x) => x.story === S.selected);
    const raw = String(e.target.value).trim();
    const v = Number(raw);
    if (!m || raw === "" || !Number.isFinite(v)) return renderPanels(); // an empty or unreadable value changes nothing
    update(m.story, snapModule({ ...m, [keyName]: v }, keyName === "h" ? "y" : "h"));
  });
}
if (MAC)
  for (const b of document.querySelectorAll("[title*='Ctrl+'], [title*='Shift+']"))
    b.title = b.title.replaceAll("Ctrl+", "⌘").replaceAll("Shift+", "⇧");
showRulers();
$("#back").href = `/?edition=${encodeURIComponent(ID.edition)}&step=run`;
$("#back").addEventListener("click", (e) => {
  if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; // another tab or window
  const why = leaveText();
  if (why && !window.confirm(`${why}\n\nLeave the editor?`)) {
    e.preventDefault();
    return;
  }
  S.leaving = true; // asked already: no second question from the browser
  setTimeout(() => (S.leaving = false), 3000); // the page did not leave after all
});
window.addEventListener("beforeunload", (e) => {
  if (!S.leaving && leaveText()) {
    e.preventDefault();
    e.returnValue = "";
  }
});

if (params.get("debug") === "1") window.__editor = { S, T, M, toPx, boxOf, leaveText }; // the Desk's browser checks

(async () => {
  title();
  tools();
  await openPage();
})();
