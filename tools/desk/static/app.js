// Pageinator Desk: the browser UI (tools/desk/static/app.js).
//
// The binding contract is tools/desk/CONTRACT.md. Plain JavaScript, no build step, no network beyond the local Desk
// server. Everything that comes from the server or from the keyboard goes into the page through textContent and
// attributes (the h() helper below), never through innerHTML.
//
// Every word this screen shows is in strings.js, in English and Marathi (t() looks it up in the language shown).
// The paper's own content and the server's messages are shown as they come.

import { LANGS, LANG_STORE_KEY, lang, saveLang, savedLang, setLang, t, tIn, tn } from "./strings.js";
import { splitPaste } from "./paste.js";

// ===================================================================== constants

const STEPS = ["edition", "articles", "ads", "run"];
const PRIORITY_KEY = { 1: "prio.lead", 2: "prio.top", 3: "prio.normal", 4: "prio.minor" };
const ROLE_KEY = { front: "role.front", inside: "role.inside", back: "role.back" };
const RUN_STATE_KEY = {
  queued: "state.queued",
  starting: "state.starting",
  planning: "state.planning",
  layout: "state.layout",
  finishing: "state.finishing",
  done: "state.done",
  failed: "state.failed",
  cancelled: "state.cancelled",
};
const PAGE_STATE_KEY = {
  waiting: "pstate.waiting",
  working: "pstate.working",
  done: "state.done",
  failed: "state.failed",
  cancelled: "state.cancelled",
};
// the folio's own words, as the front page prints them (the same in both languages)
const FOLIO_WORDS = { volume: "वर्ष", issue: "अंक", price: "किंमत" };
const FOLIO_LABEL_KEY = { volume: "ed.volume", issue: "ed.issue", price: "ed.price" };
const TERMINAL = new Set(["done", "failed", "cancelled"]);
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const IMAGE_BY_EXTENSION = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_UPLOAD_BYTES = 40 * 1024 * 1024;
const BRIEF_MAX_WORDS = 60;
const POLL_MS = 1500;
const FINISHED_POLL_MS = 5000; // a finished layout changes when its pages are edited, or its edition is (elsewhere)
const STATUS_MS = 15000;
const PREFS_KEY = "pageinator-desk.ui.v1";
const MEASURE_POLL_MS = 3000;
const WEEKDAY_KEYS = ["date.sun", "date.mon", "date.tue", "date.wed", "date.thu", "date.fri", "date.sat"];
const MONTH_KEYS = [
  "date.jan",
  "date.feb",
  "date.mar",
  "date.apr",
  "date.may",
  "date.jun",
  "date.jul",
  "date.aug",
  "date.sep",
  "date.oct",
  "date.nov",
  "date.dec",
];
const DEVANAGARI = /\p{Script=Devanagari}/u;
const LATIN_LETTER = /[A-Za-z]/;

const ICON_PATHS = {
  check: "M4.5 10.5l3.5 3.5 7.5-8",
  x: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  alert: "M10 3.2 18 16.8H2zM10 8.3v3.6M10 14.3v.2",
  info: "M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM10 9v5M10 6.3v.2",
  clock: "M10 2.5a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15zM10 6v4.3l2.8 1.8",
  plus: "M10 4.5v11M4.5 10h11",
  search: "M8.7 3.2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM12.8 12.8 17 17",
  download: "M10 3v9.5M6 8.8l4 4 4-4M3.5 16.5h13",
  upload: "M10 13V3.5M6 7.3l4-4 4 4M3.5 16.5h13",
  left: "M12.5 4.5 7 10l5.5 5.5",
  right: "M7.5 4.5 13 10l-5.5 5.5",
  pin: "M10 17.5v-6M6 11.5h8l-1.5-3V4.5h-5v4z",
  auto: "M3.5 10a6.5 6.5 0 0 1 11.3-4.4M16.5 10a6.5 6.5 0 0 1-11.3 4.4M15 2.8v3.1h-3.1M5 17.2v-3.1h3.1",
  page: "M5.5 2.5h6l3 3v12h-9zM11.5 2.5v3h3",
};

// ===================================================================== state

const state = {
  status: null, // GET /api/status, or { offline: true }
  statusTimer: 0,
  editions: [], // GET /api/editions, newest first
  editionsLoaded: false,
  loadError: "",
  editionId: null,
  detail: null, // GET /api/editions/<id>, normalised by normaliseDetail()
  detailError: "",
  seq: 0, // guards against answers for an edition that is no longer open
  step: "edition",
  query: "",
  filter: "all",
  lastResult: null, // placement results of the newest finished ("done") layout, per article
  run: null, // the layout shown in step 4: { id, status, error, timer, ... }
  runStarting: false,
  runStartError: "",
  editionDraft: null, // unsaved step-1 settings, kept across re-renders
  adLocal: {}, // slot -> what the server said about an upload or removal in this session
  adBust: {}, // slot -> cache-busting token for the preview image
  loadedAt: Date.now(),
  wordNote: null, // what the last Word import did: {edition, kind, text, lines}
};

let runUI = null; // the mounted progress panel of state.run (patched in place while polling)
let clockTimer = 0;

// ===================================================================== small helpers

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);

function str(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

function num(v, fallback = null) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function int(v) {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === "string" && /^\d{1,9}$/.test(v.trim())) return Number.parseInt(v.trim(), 10);
  return null;
}

function cmp(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

const pad2 = (n) => String(n).padStart(2, "0");

function fmtInt(n) {
  const v = num(n);
  return v === null ? "—" : Math.round(v).toLocaleString("en-IN");
}

/** A count for t(): a whole number (its plural form and its grouping follow it), or "—" when it is unknown. */
const count = (n) => (num(n) === null ? "—" : Math.round(num(n)));

function fmtMm(v) {
  const n = num(v);
  if (n === null) return "?";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtBytes(bytes) {
  const b = num(bytes, 0);
  if (b >= 1024 * 1024) return t("fmt.mb", { n: (b / (1024 * 1024)).toFixed(1) });
  if (b >= 1024) return t("fmt.kb", { n: Math.round(b / 1024) });
  return t("fmt.bytes", { n: b });
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(num(seconds, 0)));
  if (s < 60) return t("fmt.sec", { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("fmt.minSec", { m: String(m), s: pad2(s % 60) });
  return t("fmt.hourMin", { h: String(Math.floor(m / 60)), m: pad2(m % 60) });
}

function clip(text, max) {
  const chars = Array.from(str(text).replace(/\s+/g, " ").trim());
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : chars.join("");
}

function parseDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(value));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return { y, mo, d, wd: date.getUTCDay() };
}

function friendlyDate(value, withYear = true) {
  const p = parseDay(value);
  if (!p) return str(value) || t("date.undated");
  // the parts as text: a year is never grouped ("2026", not "2,026")
  const parts = { wd: t(WEEKDAY_KEYS[p.wd]), d: String(p.d), mon: t(MONTH_KEYS[p.mo - 1]), y: String(p.y) };
  return t(withYear ? "date.full" : "date.short", parts);
}

function timeOf(value) {
  const ms = Date.parse(str(value));
  return Number.isFinite(ms) ? ms : null;
}

function friendlyTime(ms) {
  if (ms === null || ms === undefined) return "";
  const d = new Date(ms);
  return t("date.time", {
    wd: t(WEEKDAY_KEYS[d.getDay()]),
    d: String(d.getDate()),
    mon: t(MONTH_KEYS[d.getMonth()]),
    hh: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
  });
}

function localDay(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Body words as the layout engine counts them (tools/desk/engine/deskarticles.py): every word of the paragraphs;
 *  a line starting with "##" is a subheading and does not count. */
function countWords(text) {
  let n = 0;
  for (const line of str(text).split("\n")) {
    const s = line.trim();
    if (!s || s.startsWith("##")) continue;
    n += s.split(/\s+/).length;
  }
  return n;
}

/** The lang attribute for a text the Desk did not write (the paper's content, a server message): Marathi when it is in
 * Devanagari; English when it has Latin letters on the Marathi screen; else nothing (it is in the screen's language). */
function langFor(text) {
  const s = str(text);
  if (DEVANAGARI.test(s)) return "mr";
  return lang() === "mr" && LATIN_LETTER.test(s) ? "en" : null;
}

/** A text the Desk did not write, inside a sentence of its own: in its own language. */
function foreign(text) {
  return h("span", { lang: langFor(text) }, str(text));
}

function fold(text) {
  return str(text).normalize("NFC").toLowerCase();
}

function debounce(fn, ms) {
  let timer = 0;
  const call = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      fn(...args);
    }, ms);
  };
  call.flush = (...args) => {
    // at once, instead of after the pause (when the screen is about to be drawn again)
    if (!timer) return;
    clearTimeout(timer);
    timer = 0;
    fn(...args);
  };
  return call;
}

function imageTypeOf(file) {
  if (IMAGE_TYPES.has(file.type)) return file.type;
  const ext = str(file.name).split(".").pop().toLowerCase();
  return file.type === "" && IMAGE_BY_EXTENSION[ext] ? IMAGE_BY_EXTENSION[ext] : null;
}

function domId(value) {
  return str(value).replace(/[^A-Za-z0-9_-]/g, "_");
}

// ===================================================================== DOM helpers

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const DOM_PROPS = new Set(["value", "checked", "disabled", "selected", "hidden", "required", "open", "multiple"]);
const SVG_NS = "http://www.w3.org/2000/svg";

/** Builds an element. Text children become text nodes; nothing is ever parsed as HTML. */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) setProps(el, props);
  addChildren(el, children);
  return el;
}

function setProps(el, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") el.className = Array.isArray(value) ? value.filter(Boolean).join(" ") : String(value);
    else if (key === "style") for (const [name, v] of Object.entries(value)) el.style.setProperty(name, String(v));
    else if (key === "dataset") for (const [name, v] of Object.entries(value)) el.dataset[name] = String(v);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (DOM_PROPS.has(key)) el[key] = value;
    else el.setAttribute(key, value === true ? "" : String(value));
  }
}

function addChildren(parent, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false || child === "") continue;
    if (Array.isArray(child)) addChildren(parent, child);
    else if (child instanceof Node) parent.append(child);
    else parent.append(String(child));
  }
}

function icon(name, extraClass) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", extraClass ? `icon ${extraClass}` : "icon");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", ICON_PATHS[name] || ICON_PATHS.info);
  svg.append(path);
  return svg;
}

/** Replaces an element's children; null, false and "" are skipped (replaceChildren would print "null"). */
function fill(el, ...children) {
  el.replaceChildren();
  addChildren(el, children);
  return el;
}

function spinner() {
  return h("span", { class: "spinner", "aria-hidden": "true" });
}

const brokenImages = new Set(); // first-choice URLs that failed every try: not asked for again

/**
 * An <img> that tries each URL in turn (the next one after a short pause, so a preview that is still being written
 * gets a second chance), then calls giveUp(img). Returns null at once when the first URL already failed before.
 */
function fallbackImage(urls, props, giveUp) {
  const list = urls.filter(Boolean);
  if (!list.length || brokenImages.has(list[0])) return null;
  const img = h("img", props);
  let index = 0;
  img.addEventListener("load", () => {
    img.hidden = false;
  });
  img.addEventListener("error", () => {
    img.hidden = true; // no broken-image icon while the next try is pending
    index += 1;
    if (index < list.length) {
      setTimeout(() => {
        if (img.isConnected) img.src = list[index];
      }, 1200);
    } else {
      brokenImages.add(list[0]);
      if (img.isConnected) giveUp(img);
    }
  });
  img.src = list[0];
  return img;
}

function withoutQuery(url) {
  return url ? url.split("?")[0] : null;
}

function setText(el, text) {
  if (el && el.textContent !== text) el.textContent = text;
}

function alertBox(message, kind = "error") {
  return h(
    "div",
    { class: `alert alert-${kind}`, role: kind === "error" ? "alert" : "status" },
    icon(kind === "error" ? "alert" : "check"),
    h("span", { lang: typeof message === "string" ? langFor(message) : null }, message),
  );
}

/** Puts a message into an alert slot (a fresh role=alert element, so screen readers announce it). */
function showAlert(slot, message, kind = "error") {
  if (!slot) return;
  if (message) slot.replaceChildren(alertBox(message, kind));
  else slot.replaceChildren();
}

function notice(kind, message, ...extra) {
  return h(
    "div",
    { class: `notice notice-${kind}` },
    icon(kind === "warn" ? "alert" : kind === "ok" ? "check" : "info"),
    h(
      "div",
      { class: "notice-body" },
      h("p", { lang: typeof message === "string" ? langFor(message) : null }, message),
      extra,
    ),
  );
}

function setFieldError(baseId, message) {
  const field = document.getElementById(baseId);
  const out = document.getElementById(`${baseId}-error`);
  if (out) out.replaceChildren(...(message ? [icon("alert"), h("span", {}, message)] : []));
  if (field && field.tagName !== "DIV") {
    if (message) field.setAttribute("aria-invalid", "true");
    else field.removeAttribute("aria-invalid");
  }
}

function toast(message, kind = "ok") {
  const box = $("#toasts");
  const el = h(
    "div",
    { class: `toast toast-${kind}` },
    icon(kind === "error" ? "alert" : kind === "info" ? "info" : "check"),
    h("span", { lang: typeof message === "string" ? langFor(message) : null }, message),
  );
  el.addEventListener("click", () => el.remove());
  box.append(el);
  while (box.children.length > 2) box.firstElementChild.remove();
  setTimeout(
    () => {
      el.classList.add("toast-leaving");
      setTimeout(() => el.remove(), 300);
    },
    kind === "error" ? 9000 : 4500,
  );
}

let announceTimer = 0;
function announce(message) {
  const el = $("#announcer");
  clearTimeout(announceTimer);
  el.textContent = "";
  announceTimer = setTimeout(() => {
    el.textContent = message;
  }, 60);
}

/** The data-focus-key of the focused element, when it is inside root. */
function focusKeyIn(root) {
  const el = document.activeElement;
  if (!el || el === document.body || !root || !root.contains(el)) return null;
  const keyed = el.closest("[data-focus-key]");
  return keyed ? keyed.dataset.focusKey : null;
}

function restoreFocus(key) {
  if (!key) return;
  const el = document.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
  if (el && !el.disabled && document.activeElement !== el) el.focus({ preventScroll: true });
}

// ===================================================================== server API

class ApiError extends Error {
  constructor(message, status = 0, key = null, params = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.key = key; // the Desk's own message (strings.js), so it can be shown again in another language
    this.params = params;
  }
}

/** An error in the Desk's own words. */
function deskError(key, params = {}, status = 0) {
  return new ApiError(t(key, params), status, key, params);
}

/**
 * What to keep of an error to show it later: the server's message as it came, or (for the Desk's own words) a
 * function giving it in the language shown then. msg() turns either into text.
 */
function errMsg(err) {
  if (err && err.key) return () => t(err.key, err.params);
  return err ? str(err.message) : "";
}

const msg = (m) => (typeof m === "function" ? m() : str(m));

/**
 * One request to the Desk server. Mutating requests carry X-Desk: 1 and a Content-Type (JSON, or the image's own
 * type for uploads). Errors come back as ApiError with the server's plain-language {"error"} message.
 */
async function api(method, path, options = {}) {
  const init = { method, headers: {}, cache: "no-store", credentials: "same-origin" };
  if (method !== "GET") {
    init.headers["X-Desk"] = "1";
    if (options.raw !== undefined) {
      init.headers["Content-Type"] = options.contentType;
      init.body = options.raw;
    } else {
      init.headers["Content-Type"] = "application/json";
      if (method !== "DELETE") init.body = JSON.stringify(options.json ?? {});
    }
  }
  if (options.signal) init.signal = options.signal;
  let response;
  try {
    response = await fetch(path, init);
  } catch {
    noteOffline();
    throw deskError("api.offline");
  }
  // any change the server took, even one it then refused part-way, can change a layout's press files: check again
  // here, and tell the other Desk windows of that edition (whatever layout they show)
  if (method !== "GET") {
    const changed = /^\/api\/editions\/([^/?]+)/.exec(path);
    try {
      if (changed) tellOthers(decodeURIComponent(changed[1])); // first: a drawing problem below must not stop it
    } catch {
      // a path that is not an edition's: nobody to tell
    }
    try {
      layoutChanged();
    } catch (err) {
      console.error(err); // a drawing problem must not turn a request that was answered into a failed one
    }
  }
  let data = null;
  try {
    const text = await response.text();
    if (text) data = JSON.parse(text);
  } catch {
    // not JSON (or the connection dropped): handled below as an unreadable answer
  }
  if (!response.ok) {
    if (isObj(data) && typeof data.error === "string" && data.error.trim())
      throw new ApiError(data.error.trim(), response.status);
    throw deskError("api.http", { status: String(response.status) }, response.status);
  }
  if (!isObj(data)) throw deskError("api.unreadable", {}, response.status);
  return data;
}

function seg(value) {
  const s = str(value);
  if (!s || s === "." || s === "..") throw deskError("api.badName");
  return encodeURIComponent(s);
}

function apiPath(...parts) {
  return `/api/editions/${parts.map(seg).join("/")}`;
}

function fileUrl(...parts) {
  try {
    return `/files/${parts.map(seg).join("/")}`;
  } catch {
    return null;
  }
}

/** A run output file name from the server: a plain file name, nothing else. */
function safeFile(name) {
  const s = str(name);
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(s) && !s.includes("..") ? s : null;
}

function withBust(url, token) {
  return url ? `${url}?v=${encodeURIComponent(str(token) || String(state.loadedAt))}` : null;
}

function noteOffline() {
  if (state.status && state.status.offline) return;
  state.status = { offline: true };
  renderStatus();
  clearTimeout(state.statusTimer);
  state.statusTimer = setTimeout(refreshStatus, 4000);
}

// ===================================================================== remembered view (this browser only)

function readPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return isObj(value) ? value : {};
  } catch {
    return {};
  }
}

function writePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ edition: state.editionId, step: state.step }));
  } catch {
    // storage is blocked or full: the page works without remembering
  }
}

// ===================================================================== derived data

function normaliseDetail(raw) {
  const d = isObj(raw) ? raw : {};
  return {
    edition: isObj(d.edition) ? d.edition : {},
    articles: arr(d.articles).filter((a) => isObj(a) && typeof a.id === "string" && a.id !== ""),
    ads: d.ads,
    plan: isObj(d.plan) ? d.plan : null,
    runs: arr(d.runs)
      .filter((r) => isObj(r) && typeof r.id === "string" && r.id !== "")
      .sort(newestRunFirst),
    measure: isObj(d.measure) ? d.measure : null, // background measuring of the stories: { state, measured, total }
    planError: str(d.plan_error), // why the plan is missing, when the server says
  };
}

/** Everything in the edition except the measuring progress: tells a real change from a progress tick. */
function detailSignature(d) {
  return JSON.stringify([d.edition, d.articles, d.ads, d.plan, d.runs]);
}

/** run status article_warnings → Map(article id → [warning texts]) */
function articleWarningsOf(status) {
  const out = new Map();
  for (const item of arr(isObj(status) ? status.article_warnings : null)) {
    if (!isObj(item) || typeof item.article !== "string") continue;
    const texts = arr(item.warnings)
      .map((w) => str(w).trim())
      .filter(Boolean);
    if (texts.length) out.set(item.article, [...(out.get(item.article) || []), ...texts]);
  }
  return out;
}

function runIdTime(id) {
  const m = /^r-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(str(id));
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}

function runStartTime(run) {
  if (!run) return null;
  const status = isObj(run.status) ? run.status : {};
  return timeOf(run.started) ?? timeOf(status.started) ?? runIdTime(run.id);
}

function newestRunFirst(a, b) {
  return (runStartTime(b) ?? 0) - (runStartTime(a) ?? 0) || cmp(b.id, a.id);
}

function editionPages() {
  const n = int(state.detail && state.detail.edition.pages);
  return n && n > 0 ? n : 8;
}

function backPageAds() {
  return !state.detail || state.detail.edition.back_page_ads !== false;
}

function planPages() {
  const plan = state.detail && state.detail.plan;
  return arr(plan && plan.pages)
    .filter((p) => isObj(p) && int(p.page) !== null)
    .sort((a, b) => int(a.page) - int(b.page));
}

function pageRole(n) {
  const p = planPages().find((x) => int(x.page) === n);
  if (p && ROLE_KEY[p.role]) return p.role;
  if (n === 1) return "front";
  return n === editionPages() && backPageAds() ? "back" : "inside";
}

function roleLabel(role) {
  return ROLE_KEY[role] ? t(ROLE_KEY[role]) : "";
}

function runStateLabel(s) {
  return RUN_STATE_KEY[s] ? t(RUN_STATE_KEY[s]) : "";
}

function pageName(n, role) {
  const r = roleLabel(role || pageRole(n));
  return r ? t("page.named", { n, role: r }) : t("page.n", { n });
}

function adSlots() {
  const out = [];
  for (const p of planPages()) {
    for (const s of arr(p.ad_slots)) {
      if (isObj(s) && typeof s.slot === "string" && s.slot !== "") out.push({ ...s, page: int(p.page), role: p.role });
    }
  }
  return out;
}

/** What the server knows about the ad image of a slot, or null. Accepts the shapes the contract leaves open. */
function adRecord(slot) {
  const ads = state.detail ? state.detail.ads : null;
  const fromList = (list) => list.find((x) => isObj(x) && x.slot === slot) || null;
  if (Array.isArray(ads)) return fromList(ads);
  if (!isObj(ads)) return null;
  for (const key of ["elements", "slots", "ads"]) {
    const pool = ads[key];
    if (isObj(pool) && isObj(pool[slot])) return pool[slot];
    if (Array.isArray(pool)) {
      const found = fromList(pool);
      if (found) return found;
    }
  }
  if (["elements", "slots", "ads", "schema"].includes(slot)) return null;
  if (isObj(ads[slot])) return ads[slot];
  return ads[slot] === true ? {} : null;
}

function adInfo(slot) {
  if (Object.prototype.hasOwnProperty.call(state.adLocal, slot)) return state.adLocal[slot];
  return adRecord(slot);
}

function hasPhoto(a) {
  return isObj(a.photo);
}

function wordsOf(a) {
  const n = num(a.words);
  return n !== null ? n : countWords(a.body);
}

function isBrief(a) {
  if (typeof a.is_brief === "boolean") return a.is_brief;
  return !hasPhoto(a) && wordsOf(a) <= BRIEF_MAX_WORDS;
}

function priorityOf(a) {
  const p = int(a.priority);
  return p !== null && p >= 1 && p <= 4 ? p : 3;
}

function pinOf(a) {
  const p = int(a.page);
  return p !== null && p > 0 ? p : null;
}

function sortedArticles(list) {
  return list
    .slice()
    .sort(
      (a, b) => priorityOf(a) - priorityOf(b) || (timeOf(a.created) ?? 0) - (timeOf(b.created) ?? 0) || cmp(a.id, b.id),
    );
}

function isSample(a) {
  return str(a.source).startsWith("sample:");
}

function computeHave(articles) {
  const have = { stories: 0, briefs: 0, photos: 0, words: 0 };
  for (const a of articles) {
    if (isBrief(a)) have.briefs += 1;
    else have.stories += 1;
    if (hasPhoto(a)) have.photos += 1;
    have.words += wordsOf(a);
  }
  return have;
}

/** The plan's needs, plus the page multipliers (front ×1, inside × pages−2, back ×1; no back ads = back is inside). */
function computeNeeds() {
  const plan = state.detail && state.detail.plan;
  const needs = plan && isObj(plan.needs) ? plan.needs : null;
  if (!needs) return null;
  const per = isObj(needs.per_role) ? needs.per_role : {};
  const pages = editionPages();
  const backAds = backPageAds();
  const mult = { front: 1, inside: Math.max(0, pages - (backAds ? 2 : 1)), back: backAds ? 1 : 0 };
  const total = {};
  for (const key of ["stories", "briefs", "photos", "words"]) {
    const given = num(needs[key]);
    if (given !== null) {
      total[key] = given;
      continue;
    }
    let sum = 0;
    let any = false;
    for (const role of ["front", "inside", "back"]) {
      const v = isObj(per[role]) ? num(per[role][key]) : null;
      if (v !== null && mult[role] > 0) {
        sum += v * mult[role];
        any = true;
      }
    }
    total[key] = any ? sum : null;
  }
  return { total, per, mult };
}

function pinCounts() {
  const counts = new Map();
  for (const a of state.detail ? state.detail.articles : []) {
    const pin = pinOf(a);
    if (pin) counts.set(pin, (counts.get(pin) || 0) + 1);
  }
  return counts;
}

/** Articles added to the edition after a finished layout started: the layout lists every article it was given, on a
 * page or as not placed, so these are the ones it never saw. */
function addedAfter(status) {
  if (!state.detail || !isObj(status) || str(status.state) !== "done") return 0;
  const seen = new Set(arr(status.not_placed).map((x) => (isObj(x) ? x.article : null)));
  for (const p of arr(status.pages)) if (isObj(p)) for (const id of arr(p.articles)) seen.add(id);
  return state.detail.articles.filter((a) => !seen.has(a.id)).length;
}

function isRunActive(run) {
  return !!run && (!isObj(run.status) || !TERMINAL.has(str(run.status.state)));
}

function activeRunSummary() {
  return state.detail ? state.detail.runs.find((r) => !TERMINAL.has(str(r.state))) || null : null;
}

function buildResult(summary, status) {
  const placed = new Map();
  const notPlaced = new Map();
  for (const p of arr(status.pages)) {
    if (!isObj(p)) continue;
    for (const id of arr(p.articles)) {
      if (typeof id === "string") placed.set(id, { page: int(p.page), failed: str(p.state) === "failed" });
    }
  }
  for (const item of arr(status.not_placed)) {
    if (isObj(item) && typeof item.article === "string") notPlaced.set(item.article, str(item.reason));
  }
  return {
    runId: summary.id,
    started: runStartTime({ ...summary, status }),
    placed,
    notPlaced,
    warnings: articleWarningsOf(status),
  };
}

function articleResult(a) {
  const r = state.lastResult;
  if (!r) return null;
  if (r.notPlaced.has(a.id)) {
    const reason = r.notPlaced.get(a.id);
    return {
      kind: "warn",
      icon: "alert",
      text: reason ? t("result.notPlacedWhy", { reason }) : t("result.notPlaced"),
      reason, // the server's words, in a sentence of the Desk's (shown in their own language)
    };
  }
  const hit = r.placed.get(a.id);
  const edited = r.started !== null && (timeOf(a.updated) ?? 0) > r.started + 1000;
  if (hit) {
    if (hit.failed) return { kind: "bad", icon: "x", text: t("result.pageFailed", { n: hit.page }), edited };
    return { kind: "ok", icon: "check", text: t("result.placed", { n: hit.page }), edited };
  }
  const created = timeOf(a.created);
  if (created !== null && r.started !== null && created > r.started) {
    return { kind: "muted", icon: "info", text: t("result.addedAfter") };
  }
  return { kind: "muted", icon: "info", text: t("result.notInReport") };
}

/** What to do about an article the layout did not place, from the server's reason (in English, as it sends it). */
function notPlacedHint(reason) {
  const r = fold(reason);
  if (/deleted from the edition/.test(r)) return t("hint.deleted");
  if (/taken off the pages in the editor/.test(r)) return t("hint.takenOff");
  if (/(long|space|fit|room|overflow|big|area|short of)/.test(r)) return t("hint.tooLong");
  if (/(pin|pinned)/.test(r)) return t("hint.pinnedFull");
  if (/(photo|image|picture)/.test(r)) return t("hint.photo");
  if (/(priority|minor)/.test(r)) return t("hint.priority");
  return t("hint.general");
}

function photoUrl(a) {
  const photo = a && isObj(a.photo) ? a.photo : null;
  if (!photo || !str(photo.id)) return null;
  return withBust(fileUrl(state.editionId, "photos", `${str(photo.id)}.jpg`), str(a.updated));
}

function adUrl(slot) {
  return withBust(fileUrl(state.editionId, "ads", `${slot}.jpg`), state.adBust[slot]);
}

function runFileUrl(runId, file) {
  const name = safeFile(file);
  return name ? fileUrl(state.editionId, "runs", runId, name) : null;
}

function engineBlocked() {
  const s = state.status;
  if (!s) return "";
  if (s.offline) return t("api.offline");
  if (s.engine_ok === false || s.config_ok === false) {
    return str(s.message) ? t("run.engineSetup", { reason: str(s.message) }) : t("run.engineSetupDefault");
  }
  return "";
}

// ===================================================================== engine status (top right)

async function refreshStatus() {
  clearTimeout(state.statusTimer);
  const wasDown = !state.status || !!state.status.offline;
  let ok = false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    state.status = await api("GET", "/api/status", { signal: ctrl.signal });
    ok = true;
  } catch {
    state.status = { offline: true };
  } finally {
    clearTimeout(timer);
  }
  renderStatus();
  if (state.step === "run") renderRunStart();
  if (ok && wasDown && state.loadError) loadEditionsAndOpen();
  state.statusTimer = setTimeout(refreshStatus, ok ? STATUS_MS : 5000);
}

function renderStatus() {
  const s = state.status;
  let kind = "unknown";
  let label = t("engine.checking");
  let message = ""; // the server's words when it gives them, else the Desk's
  if (s && s.offline) {
    kind = "bad";
    label = t("engine.offline");
    message = t("api.offline");
  } else if (s) {
    if (s.engine_ok === true && s.config_ok === true && s.icc_ok === false) {
      // layout works, but photos and ads cannot be converted for print yet (the server says why)
      kind = "warn";
      label = t("engine.partly");
      message = str(s.message) || t("engine.partlyWhy");
    } else if (s.engine_ok === true && s.config_ok === true) {
      kind = "ok";
      label = t("engine.ready");
      message = str(s.message);
    } else {
      kind = "warn";
      label = t("engine.setup");
      message = str(s.message) || t("engine.setupWhy");
    }
  }
  const box = $("#engine");
  box.dataset.kind = kind;
  setText($("#engine-label"), label);
  const short = $("#engine-short");
  setText(short, kind === "warn" ? message : "");
  if (langFor(short.textContent)) short.lang = langFor(short.textContent);
  else short.removeAttribute("lang");
  const iconName = { ok: "check", warn: "alert", bad: "x" }[kind] || "clock";
  $("#engine-icon").replaceChildren(icon(iconName));
  const parts = [];
  if (message) parts.push(h("p", { class: "status-message", lang: langFor(message) }, message));
  if (s && !s.offline) {
    const facts = h("dl", { class: "status-facts" });
    const fact = (term, value) => {
      if (value) facts.append(h("dt", {}, term), h("dd", {}, value));
    };
    const found = (ok, missing) => (ok === true ? t("engine.found") : ok === false ? missing : "");
    fact(t("engine.factEngine"), found(s.engine_ok, t("engine.notFound")));
    fact(
      t("engine.factSetup"),
      s.config_ok === true ? t("engine.setupDone") : s.config_ok === false ? t("engine.setupNotDone") : "",
    );
    fact(t("engine.factIcc"), found(s.icc_ok, t("engine.iccMissing")));
    fact(t("engine.factCores"), num(s.cores) ? t("engine.cores", { n: count(s.cores) }) : "");
    fact(t("engine.factHome"), str(s.home));
    fact(t("engine.factVersion"), str(s.version));
    if (facts.children.length) parts.push(facts);
  }
  parts.push(
    h("button", { type: "button", class: "btn btn-small", onclick: () => refreshStatus() }, t("engine.checkAgain")),
  );
  $("#engine-panel").replaceChildren(...parts);
}

// ===================================================================== loading editions

async function reloadEditionsList() {
  const data = await api("GET", "/api/editions");
  const list = arr(data.editions).filter((e) => isObj(e) && typeof e.id === "string" && e.id !== "");
  const suffix = (e) => {
    const m = /-(\d+)$/.exec(e.id.slice(10));
    return m ? Number(m[1]) : 0;
  };
  list.sort((a, b) => cmp(str(b.date) || b.id, str(a.date) || a.id) || suffix(b) - suffix(a) || cmp(b.id, a.id));
  state.editions = list;
  state.editionsLoaded = true;
  state.loadError = "";
  renderPicker();
}

async function loadEditionsAndOpen() {
  try {
    await reloadEditionsList();
  } catch (err) {
    state.editionsLoaded = true;
    state.loadError = errMsg(err);
    renderAll();
    return;
  }
  const prefs = readPrefs();
  // a link may name the edition and step (the page editor's "← Desk"); it is used once, then the address is plain
  const linked = new URLSearchParams(location.search);
  if (linked.has("edition") || linked.has("step")) history.replaceState(null, "", location.pathname);
  if (STEPS.includes(linked.get("step"))) state.step = linked.get("step");
  else if (STEPS.includes(prefs.step)) state.step = prefs.step;
  const ids = state.editions.map((e) => e.id);
  const wanted = ids.includes(linked.get("edition"))
    ? linked.get("edition")
    : state.editionId && ids.includes(state.editionId)
      ? state.editionId
      : prefs.edition;
  const target = ids.includes(wanted) ? wanted : ids[0];
  if (target) await openEdition(target);
  else {
    state.editionId = null;
    state.detail = null;
    renderAll();
  }
}

async function openEdition(id, options = {}) {
  stopRunPolling();
  stopMeasurePoll();
  state.run = null;
  runUI = null;
  state.editionId = id;
  state.detail = null;
  state.detailError = "";
  state.lastResult = null;
  state.editionDraft = null;
  state.adLocal = {};
  state.adBust = {};
  state.query = "";
  state.filter = "all";
  state.runStartError = "";
  if (options.step) state.step = options.step;
  writePrefs();
  renderAll();
  const seq = ++state.seq;
  try {
    const raw = await api("GET", apiPath(id));
    if (seq !== state.seq) return;
    state.detail = normaliseDetail(raw);
  } catch (err) {
    if (seq !== state.seq) return;
    state.detailError = errMsg(err);
    renderAll();
    return;
  }
  await syncRuns();
  if (seq !== state.seq) return;
  renderAll();
  scheduleMeasurePoll();
}

/** Reloads the open edition after a change. Throws only when asked to (the caller shows the error). */
async function refreshDetail(options = {}) {
  const id = state.editionId;
  if (!id) return;
  // a change made here can change whether the layout's press files are current: from now on they are not shown as
  // current until the server has answered a request made after the change (changed: false when nothing changed)
  if (options.changed !== false) layoutChanged();
  try {
    const raw = await api("GET", apiPath(id));
    if (state.editionId !== id) return;
    state.detail = normaliseDetail(raw);
    await syncRuns();
  } catch (err) {
    if (options.throwErrors) throw err;
    if (!options.quiet) toast(tn("api.reloadFailed", { error: foreign(err.message) }), "error");
  }
  if (state.editionId !== id) return;
  renderAll();
  scheduleMeasurePoll();
}

// While the server measures the stories in the background, the edition is re-read every 3 s. A tick that only moves
// the progress updates the progress line; anything else re-renders without disturbing typing (softRender).
let measureTimer = 0;

function stopMeasurePoll() {
  clearTimeout(measureTimer);
  measureTimer = 0;
}

function isMeasuring() {
  const m = state.detail ? state.detail.measure : null;
  return !!m && str(m.state) === "measuring";
}

function scheduleMeasurePoll() {
  stopMeasurePoll();
  if (isMeasuring()) measureTimer = setTimeout(pollMeasure, MEASURE_POLL_MS);
}

async function pollMeasure() {
  measureTimer = 0;
  const id = state.editionId;
  if (!id || !state.detail) return;
  let raw;
  try {
    raw = await api("GET", apiPath(id));
  } catch {
    if (state.editionId === id && !measureTimer) measureTimer = setTimeout(pollMeasure, MEASURE_POLL_MS * 2);
    return;
  }
  if (state.editionId !== id || !state.detail) return;
  const next = normaliseDetail(raw);
  const changed = detailSignature(next) !== detailSignature(state.detail);
  state.detail = next;
  if (changed) {
    await syncRuns();
    if (state.editionId !== id) return;
    softRender();
  } else renderMeasure();
  scheduleMeasurePoll();
}

/** Re-renders after a background change, keeping the step's text boxes (and what is being typed in them) in place. */
function softRender() {
  renderSteps();
  renderNeeds();
  const main = $("#main");
  const active = document.activeElement;
  const typing = !!active && main.contains(active) && active.matches("input, textarea, select");
  const listShapeSame = state.detail.articles.length > 0 === !!$("#article-count");
  if (state.step === "articles" && $("#article-list-host") && (listShapeSame || typing)) {
    setText($("#articles-lede"), articlesLede());
    renderMeasure();
    renderArticleList();
  } else if (!typing) renderMain();
  else renderMeasure();
  updateTitle();
}

function measureText() {
  if (!isMeasuring()) return "";
  const m = state.detail.measure;
  const done = int(m.measured);
  const total = int(m.total);
  return done !== null && total ? t("measure.progress", { done, total }) : t("measure.busy");
}

/** A quiet progress line; renderMeasure() keeps every copy of it current. */
function measureLine() {
  const text = measureText();
  return h("p", { class: "measure-line", hidden: !text }, spinner(), h("span", { class: "measure-text" }, text));
}

function renderMeasure() {
  const text = measureText();
  for (const line of $$(".measure-line")) {
    line.hidden = !text;
    setText($(".measure-text", line), text);
  }
}

/** Chooses the layout shown in step 4 and loads the placement results of the newest finished layout. */
async function syncRuns() {
  const d = state.detail;
  if (!d) return;
  const editionId = state.editionId;
  if (!state.run && d.runs.length) selectRun(d.runs[0].id, { render: false });
  const lastDone = d.runs.find((r) => str(r.state) === "done");
  if (!lastDone) {
    state.lastResult = null;
    return;
  }
  if (state.lastResult && state.lastResult.runId === lastDone.id) return;
  let status;
  if (state.run && state.run.id === lastDone.id && isObj(state.run.status) && str(state.run.status.state) === "done") {
    status = state.run.status;
  } else {
    try {
      status = await api("GET", apiPath(editionId, "runs", lastDone.id));
    } catch {
      return;
    }
  }
  if (state.editionId !== editionId) return;
  state.lastResult = buildResult(lastDone, status);
}

// ===================================================================== rendering: frame

function renderAll() {
  renderPicker();
  renderSteps();
  renderNeeds();
  renderMain();
}

function editionLabel(e) {
  const pages = int(e.pages);
  const m = /^\d{4}-\d{2}-\d{2}-(\d+)$/.exec(str(e.id));
  return [friendlyDate(str(e.date) || e.id), pages ? t("count.page", { n: pages }) : null, m ? `#${m[1]}` : null]
    .filter(Boolean)
    .join(" · ");
}

function renderPicker() {
  const select = $("#edition-select");
  const options = [];
  if (!state.editionsLoaded) options.push(h("option", { value: "" }, t("top.loading")));
  else if (state.loadError) options.push(h("option", { value: "" }, t("top.notAvailable")));
  else if (!state.editions.length) options.push(h("option", { value: "" }, t("top.noEditions")));
  else {
    for (const e of state.editions) {
      options.push(h("option", { value: e.id, selected: e.id === state.editionId }, editionLabel(e)));
    }
  }
  select.replaceChildren(...options);
  select.disabled = state.editions.length === 0;
  if (state.editionId && state.editions.some((e) => e.id === state.editionId)) select.value = state.editionId;
}

function stepSummaries() {
  const d = state.detail;
  const slots = adSlots();
  const filled = slots.filter((s) => adInfo(s.slot)).length;
  let run = t("sum.notLaidOut");
  let tone = "";
  const r = state.run;
  if (r && isObj(r.status)) {
    const s = str(r.status.state);
    if (!TERMINAL.has(s)) {
      const pages = arr(r.status.pages).filter(isObj);
      const done = pages.filter((p) => str(p.state) === "done").length;
      run = pages.length
        ? t("sum.layingOutOf", { done, total: pages.length })
        : runStateLabel(s) || t("pstate.working");
      tone = "busy";
    } else {
      run = s === "done" ? t("sum.doneAt", { time: friendlyTime(runStartTime(r)) }) : runStateLabel(s);
      tone = s === "done" ? "ok" : s === "failed" ? "bad" : "";
    }
  } else if (d.runs.length) {
    run = runStateLabel(str(d.runs[0].state)) || t("sum.laidOutBefore");
  }
  return {
    edition: {
      text: t("sum.edition", { n: editionPages(), date: friendlyDate(d.edition.date || state.editionId, false) }),
    },
    articles: { text: t("count.article", { n: d.articles.length }) },
    ads: {
      text: slots.length ? t("sum.adsFilled", { n: filled, total: slots.length }) : d.plan ? t("sum.noAdSpaces") : "",
    },
    run: { text: run, tone },
  };
}

function renderSteps() {
  const has = !!state.detail;
  const sums = has ? stepSummaries() : {};
  for (const button of $$(".step")) {
    const id = button.dataset.step;
    button.disabled = !has;
    if (has && id === state.step) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    const sum = sums[id] || { text: "" };
    setText($(".step-sub", button), sum.text);
    if (sum.tone) button.dataset.tone = sum.tone;
    else delete button.dataset.tone;
  }
}

function renderNeeds() {
  const section = $("#needs");
  const d = state.detail;
  if (!d) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  setText($("#needs-sub"), t(backPageAds() ? "needs.for" : "needs.forNoBackAds", { n: editionPages() }));
  const list = $("#needs-list");
  const needs = computeNeeds();
  const detail = $("#needs-detail");
  if (!needs) {
    list.replaceChildren(h("li", { class: "needs-missing" }, t("needs.missing")));
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  const have = computeHave(d.articles);
  list.replaceChildren(
    needRow(t("needs.stories"), have.stories, needs.total.stories),
    needRow(t("needs.briefs"), have.briefs, needs.total.briefs),
    needRow(t("needs.photos"), have.photos, needs.total.photos),
    needRow(t("needs.words"), have.words, needs.total.words),
  );
  $("#needs-per-page").replaceChildren(...perPageBreakdown(needs));
}

function needRow(label, have, need) {
  const known = need !== null && need !== undefined;
  const enough = known && have >= need;
  const stateName = !known ? "unknown" : enough ? "ok" : "short";
  const pct = known && need > 0 ? Math.min(100, (have / need) * 100) : known ? 100 : 0;
  let status;
  if (!known) status = [icon("info"), h("span", {}, t("needs.noFigure"))];
  else if (enough) status = [icon("check"), h("span", {}, t("needs.enough"))];
  else status = [icon("alert"), h("span", {}, t("needs.shortBy", { n: count(need - have) }))];
  return h(
    "li",
    { class: "need-row", dataset: { state: stateName } },
    h(
      "div",
      { class: "need-head" },
      h("span", { class: "need-label" }, label),
      h(
        "span",
        { class: "need-nums" },
        h("strong", {}, fmtInt(have)),
        h("span", { class: "need-of" }, ` / ${known ? fmtInt(need) : "—"}`),
      ),
    ),
    h(
      "div",
      { class: "need-bar", "aria-hidden": "true" },
      h("div", { class: "need-fill", style: { width: `${pct.toFixed(1)}%` } }),
    ),
    h("div", { class: "need-state" }, status),
  );
}

function perPageBreakdown(needs) {
  const rows = [];
  const roles = [
    ["front", t("needs.front")],
    ["inside", t("needs.inside")],
    ["back", t("needs.back")],
  ];
  for (const [role, label] of roles) {
    const times = needs.mult[role];
    const r = isObj(needs.per[role]) ? needs.per[role] : null;
    if (!times || !r) continue;
    const facts = [
      num(r.stories) !== null ? t("count.story", { n: count(r.stories) }) : null,
      num(r.briefs) ? t("count.brief", { n: count(r.briefs) }) : null,
      num(r.photos) !== null ? t("count.photo", { n: count(r.photos) }) : null,
      num(r.words) !== null ? t("count.word", { n: count(r.words) }) : null,
    ].filter(Boolean);
    rows.push(
      h(
        "div",
        { class: "per-role" },
        h(
          "div",
          { class: "per-role-head" },
          h("strong", {}, label),
          h("span", { class: "muted" }, times > 1 ? t("needs.timesEach", { n: times }) : `× ${times}`),
        ),
        h("p", { class: "per-role-facts" }, facts.join(" · ")),
      ),
    );
  }
  if (!backPageAds()) {
    rows.push(h("p", { class: "muted small" }, t("needs.backAsInside")));
  }
  if (!rows.length) rows.push(h("p", { class: "muted small" }, t("needs.noPerPage")));
  return rows;
}

function renderMain() {
  const main = $("#main");
  const key = focusKeyIn(main);
  let view;
  if (!state.editionsLoaded) view = loadingView(t("view.loadingEditions"));
  else if (state.loadError) view = offlineView();
  else if (!state.editions.length) view = noEditionsView();
  else if (state.detailError) view = detailErrorView();
  else if (!state.detail) view = loadingView(t("view.openingEdition"));
  else if (state.step === "articles") view = viewArticles();
  else if (state.step === "ads") view = viewAds();
  else if (state.step === "run") view = viewRun();
  else view = viewEdition();
  main.replaceChildren(view);
  if (state.detail && state.step === "articles") renderArticleList();
  if (state.detail && state.step === "run") {
    renderRunStart();
    patchRun();
  }
  restoreFocus(key);
  updateTitle();
}

function updateTitle() {
  let title = t("app.name");
  if (state.detail) {
    const date = friendlyDate(state.detail.edition.date || state.editionId, false);
    title = t("title.edition", { date, n: editionPages(), app: title });
    const r = state.run;
    if (r && isObj(r.status) && !TERMINAL.has(str(r.status.state))) {
      const pages = arr(r.status.pages).filter(isObj);
      const done = pages.filter((p) => str(p.state) === "done").length;
      title = t("title.running", { done, total: pages.length || editionPages(), title });
    }
  }
  if (document.title !== title) document.title = title;
}

function goStep(step, options = {}) {
  if (!STEPS.includes(step) || !state.detail) return;
  state.step = step;
  writePrefs();
  renderSteps();
  renderMain();
  if (step === "run" && state.run && !state.run.stopped) pollRun(state.run); // its press files as they are now
  if (options.focus !== false) {
    window.scrollTo(0, 0);
    const title = $("#step-title");
    if (title) title.focus({ preventScroll: true });
  }
}

function stepHeader(title, lede, ...actions) {
  return h(
    "div",
    { class: "step-head" },
    h(
      "div",
      {},
      h("h1", { id: "step-title", tabindex: "-1" }, title),
      lede ? h("p", { class: "step-lede" }, lede) : null,
    ),
    actions.length ? h("div", { class: "step-actions" }, actions) : null,
  );
}

function loadingView(text) {
  return h("p", { class: "loading" }, spinner(), text);
}

function offlineView() {
  return h(
    "section",
    { class: "step-view" },
    h(
      "div",
      { class: "card empty" },
      icon("alert", "empty-icon"),
      h("h1", { id: "step-title", tabindex: "-1" }, t("view.offlineTitle")),
      h("p", { lang: langFor(msg(state.loadError)) }, msg(state.loadError) || t("api.offline")),
      h(
        "button",
        { type: "button", class: "btn btn-primary", onclick: () => loadEditionsAndOpen() },
        t("view.tryAgain"),
      ),
    ),
  );
}

function noEditionsView() {
  return h(
    "section",
    { class: "step-view" },
    h(
      "div",
      { class: "card empty" },
      icon("page", "empty-icon"),
      h("h1", { id: "step-title", tabindex: "-1" }, t("view.noEditionsTitle")),
      h("p", {}, t("view.noEditionsLede")),
      h(
        "ol",
        { class: "empty-steps" },
        h("li", {}, t("view.empty1")),
        h("li", {}, t("view.empty2")),
        h("li", {}, t("view.empty3")),
        h("li", {}, t("view.empty4")),
      ),
      h(
        "div",
        {},
        h(
          "button",
          { type: "button", class: "btn btn-primary", dataset: { focusKey: "empty:new" }, onclick: openNewEdition },
          icon("plus"),
          t("view.createEdition"),
        ),
      ),
    ),
  );
}

function detailErrorView() {
  return h(
    "section",
    { class: "step-view" },
    h(
      "div",
      { class: "card empty" },
      icon("alert", "empty-icon"),
      h("h1", { id: "step-title", tabindex: "-1" }, t("view.cannotOpen")),
      h("p", { lang: langFor(msg(state.detailError)) }, msg(state.detailError)),
      h(
        "button",
        { type: "button", class: "btn btn-primary", onclick: () => openEdition(state.editionId) },
        t("view.tryAgain"),
      ),
    ),
  );
}

function planMissingNotice() {
  // the server's own reason (plan_error) when it gives one, else the engine status message
  const s = state.status;
  const reason = (state.detail && state.detail.planError) || (s && !s.offline ? str(s.message) : "");
  return notice("warn", reason ? tn("plan.missingWhy", { reason: foreign(reason) }) : t("plan.missing"));
}

// ===================================================================== step 1: edition

/** A folio field's label: the folio's own Marathi word (as the page prints it), with what it is in English. */
function folioLabel(name) {
  return tn(FOLIO_LABEL_KEY[name], { word: h("span", { class: "deva", lang: "mr" }, FOLIO_WORDS[name]) });
}

function editionValues(ed) {
  return {
    date: str(ed.date),
    pages: int(ed.pages) || 8,
    back_page_ads: ed.back_page_ads !== false,
    volume: str(ed.volume),
    issue: str(ed.issue),
    price: str(ed.price),
  };
}

function viewEdition() {
  const ed = state.detail.edition;
  const view = h("section", { class: "step-view", "aria-labelledby": "step-title" });
  view.append(
    stepHeader(t("step.edition"), t("ed.lede", { date: friendlyDate(ed.date || state.editionId), n: editionPages() })),
    editionSettingsCard(ed),
    pagePlanCard(),
    dangerCard(ed),
  );
  return view;
}

function editionSettingsCard(ed) {
  const saved = editionValues(ed);
  const draft = state.editionDraft && state.editionDraft.id === state.editionId ? state.editionDraft.values : null;
  const v = draft || saved;
  const alertSlot = h("div", { class: "alert-slot" });
  const pinWarn = h("div", {});
  const saveBtn = h(
    "button",
    { type: "submit", class: "btn btn-primary", dataset: { focusKey: "edition:save" } },
    t("ed.save"),
  );
  const undoBtn = h("button", { type: "button", class: "btn", dataset: { focusKey: "edition:undo" } }, t("ed.undo"));
  const pagesSeg = h("div", { class: "segmented" });
  for (const n of [4, 8, 16]) {
    pagesSeg.append(
      h("input", { type: "radio", name: "pages", id: `ed-pages-${n}`, value: String(n), checked: v.pages === n }),
      h("label", { for: `ed-pages-${n}` }, String(n)),
    );
  }
  const textField = (name) =>
    h(
      "div",
      { class: "field" },
      h("label", { for: `ed-${name}` }, folioLabel(name)),
      h("input", {
        type: "text",
        id: `ed-${name}`,
        name,
        class: "deva",
        lang: "mr",
        autocomplete: "off",
        value: v[name],
      }),
    );
  const form = h(
    "form",
    { class: "card", novalidate: true, "aria-labelledby": "settings-title" },
    h("h2", { class: "card-title", id: "settings-title" }, t("ed.settings")),
    h("p", { class: "card-lede" }, t("ed.settingsLede")),
    h(
      "div",
      { class: "settings-grid" },
      h(
        "div",
        { class: "field" },
        h("label", { for: "ed-date" }, t("ed.date")),
        h("input", { type: "date", id: "ed-date", name: "date", required: true, value: v.date }),
        h("p", { class: "field-error", id: "ed-date-error" }),
      ),
      h("fieldset", { class: "field" }, h("legend", {}, t("ed.pages")), pagesSeg),
      h(
        "div",
        { class: "field field-check", style: { "margin-top": "30px" } },
        h("input", {
          type: "checkbox",
          id: "ed-back-ads",
          name: "back_page_ads",
          checked: v.back_page_ads,
          "aria-describedby": "ed-back-ads-note",
        }),
        h("label", { for: "ed-back-ads" }, t("ed.backAds")),
        h("p", { class: "field-note", id: "ed-back-ads-note" }, t("ed.backAdsNote")),
      ),
    ),
    h("div", { class: "field-grid three" }, textField("volume"), textField("issue"), textField("price")),
    h("p", { class: "field-note", style: { margin: "-6px 0 16px" } }, t("ed.folioNote")),
    pinWarn,
    alertSlot,
    h("div", { class: "card-foot" }, saveBtn, undoBtn),
  );
  const read = () => ({
    date: form.elements.date.value,
    pages: Number(form.elements.pages.value) || saved.pages,
    back_page_ads: form.elements.back_page_ads.checked,
    volume: form.elements.volume.value,
    issue: form.elements.issue.value,
    price: form.elements.price.value,
  });
  const diff = () => {
    const now = read();
    const out = {};
    for (const key of Object.keys(now)) if (now[key] !== saved[key]) out[key] = now[key];
    return out;
  };
  const sync = () => {
    const changes = diff();
    const dirty = Object.keys(changes).length > 0;
    state.editionDraft = dirty ? { id: state.editionId, values: read() } : null;
    saveBtn.disabled = !dirty;
    undoBtn.hidden = !dirty;
    const pages = read().pages;
    const beyond = state.detail.articles.filter((a) => (pinOf(a) || 0) > pages).length;
    fill(pinWarn, beyond ? notice("warn", t("ed.pinnedBeyond", { n: beyond, pages })) : "");
  };
  form.addEventListener("input", sync);
  form.addEventListener("change", sync);
  undoBtn.addEventListener("click", () => {
    state.editionDraft = null;
    renderMain();
  });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const changes = diff();
    if (!parseDay(read().date)) {
      setFieldError("ed-date", t("ed.chooseDate"));
      form.elements.date.focus();
      return;
    }
    setFieldError("ed-date", "");
    if (!Object.keys(changes).length) return;
    saveBtn.disabled = true;
    saveBtn.replaceChildren(spinner(), t("common.saving"));
    showAlert(alertSlot, "");
    try {
      await api("PUT", apiPath(state.editionId), { json: changes });
      state.editionDraft = null;
      toast(t("ed.saved"));
      try {
        await reloadEditionsList();
      } catch {
        // the picker keeps its old label until the next reload
      }
      await refreshDetail();
    } catch (err) {
      showAlert(alertSlot, err.message);
      saveBtn.replaceChildren(t("ed.save"));
      saveBtn.disabled = false;
    }
  });
  sync();
  return form;
}

function pagePlanCard() {
  const card = h(
    "section",
    { class: "card", "aria-labelledby": "plan-title" },
    h("h2", { class: "card-title", id: "plan-title" }, t("plan.title")),
  );
  if (!state.detail.plan) {
    card.append(planMissingNotice());
    return card;
  }
  const pages = planPages();
  if (!pages.length) {
    card.append(h("p", { class: "muted" }, t("plan.none")));
    return card;
  }
  card.append(h("p", { class: "card-lede" }, t("plan.lede")));
  const pins = pinCounts();
  const grid = h("ol", { class: "plan-grid" });
  for (const p of pages) grid.append(planTile(p, pins.get(int(p.page)) || 0));
  card.append(grid);
  return card;
}

function planTile(p, pinned) {
  const n = int(p.page);
  const role = str(p.role);
  const slots = arr(p.ad_slots).filter(isObj);
  const adArea = slots.reduce((sum, s) => sum + Math.max(0, num(s.w_mm, 0)) * Math.max(0, num(s.h_mm, 0)), 0);
  const news = Math.max(0, num(p.news_mm2, 0));
  const share = adArea > 0 && news > 0 ? adArea / (adArea + news) : 0;
  const sheet = h("div", { class: "plan-sheet", "aria-hidden": "true" }, h("span", { class: "plan-num" }, String(n)));
  if (share > 0) {
    const pct = Math.min(85, Math.max(6, share * 100));
    sheet.append(h("span", { class: "plan-ads", style: { height: `${pct.toFixed(1)}%` } }, t("plan.ad")));
  }
  const meta = [t("plan.ads", { n: slots.length })];
  if (share > 0) meta.push(t("plan.share", { n: Math.round(share * 100) }));
  if (pinned) meta.push(t("plan.pinned", { n: pinned }));
  return h(
    "li",
    { class: "plan-tile", dataset: { role } },
    sheet,
    h(
      "div",
      { class: "plan-label" },
      h("strong", {}, t("page.n", { n })),
      ROLE_KEY[role] ? h("span", { class: "muted" }, ` · ${roleLabel(role)}`) : null,
    ),
    h("div", { class: "plan-meta" }, meta.join(" · ")),
  );
}

function dangerCard(ed) {
  const alertSlot = h("div", { class: "alert-slot" });
  const button = h(
    "button",
    { type: "button", class: "btn btn-danger-quiet", dataset: { focusKey: "edition:delete" } },
    t("ed.deleteButton"),
  );
  button.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: t("ed.deleteConfirmTitle"),
      message: t("ed.deleteConfirm", { date: friendlyDate(ed.date || state.editionId) }),
      confirm: t("ed.deleteOk"),
      danger: true,
    });
    if (!ok) return;
    try {
      await api("DELETE", apiPath(state.editionId));
      toast(t("ed.deleted"));
      stopRunPolling();
      stopMeasurePoll();
      state.run = null;
      state.editionId = null;
      state.detail = null;
      writePrefs();
      await loadEditionsAndOpen();
    } catch (err) {
      showAlert(alertSlot, err.message);
    }
  });
  return h(
    "section",
    { class: "card danger", "aria-labelledby": "danger-title" },
    h("h2", { class: "card-title", id: "danger-title" }, t("ed.deleteTitle")),
    h("p", { class: "card-lede" }, t("ed.deleteLede")),
    alertSlot,
    button,
  );
}

// ===================================================================== step 2: articles

function articlesLede() {
  const articles = state.detail ? state.detail.articles : [];
  if (!articles.length) return t("arts.ledeEmpty");
  const have = computeHave(articles);
  return [
    t("count.story", { n: have.stories }),
    t("count.brief", { n: have.briefs }),
    t("count.photo", { n: have.photos }),
    t("count.word", { n: have.words }),
  ].join(" · ");
}

let searchTyped = null; // the search box's pending (debounced) update, run at once before the screen is drawn again

function viewArticles() {
  const articles = state.detail.articles;
  if (state.filter === "notplaced" && !state.lastResult) state.filter = "all";
  const search = h("input", {
    type: "search",
    id: "article-search",
    placeholder: t("arts.searchPlaceholder"),
    autocomplete: "off",
    value: state.query,
    dataset: { focusKey: "articles:search" },
  });
  searchTyped = debounce(() => {
    state.query = search.value;
    if (search.isConnected) renderArticleList();
  }, 150);
  search.addEventListener("input", searchTyped);
  const toolbar = h(
    "div",
    { class: "toolbar" },
    h(
      "button",
      {
        type: "button",
        class: "btn btn-primary",
        dataset: { focusKey: "articles:add" },
        onclick: () => openArticleEditor(null),
      },
      icon("plus"),
      t("arts.add"),
    ),
    h(
      "button",
      { type: "button", class: "btn", dataset: { focusKey: "articles:paste" }, onclick: openPasteDialog },
      t("arts.paste"),
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn",
        dataset: { focusKey: "articles:word" },
        title: t("arts.wordTitle"),
        onclick: chooseWordFiles,
      },
      t("arts.word"),
    ),
    h(
      "button",
      { type: "button", class: "btn", dataset: { focusKey: "articles:import" }, onclick: openImportDialog },
      t("arts.import"),
    ),
    h(
      "div",
      { class: "search" },
      h("label", { for: "article-search", class: "sr-only" }, t("arts.searchLabel")),
      icon("search", "search-icon"),
      search,
    ),
  );
  const view = h("section", { class: "step-view", "aria-labelledby": "step-title" });
  const header = stepHeader(t("step.articles"), articlesLede());
  $(".step-lede", header).id = "articles-lede";
  // addChildren skips the word note when there is none (Element.append(null) would print "null")
  addChildren(view, [
    header,
    h("div", { class: "alert-slot", id: "articles-alert" }),
    toolbar,
    wordNote(),
    measureLine(),
  ]);
  if (articles.length) {
    view.append(
      h(
        "div",
        { class: "filter-row" },
        filterControl(),
        h("p", { class: "list-count", id: "article-count", "aria-live": "polite" }),
      ),
    );
    const r = state.lastResult;
    if (r) {
      view.append(
        h(
          "p",
          { class: "run-note" },
          r.started !== null ? t("arts.placementAt", { time: friendlyTime(r.started) }) : t("arts.placement"),
        ),
      );
    }
  }
  view.append(h("div", { id: "article-list-host" }));
  return view;
}

/** What the last Word import did, until it is closed (a toast is gone too soon to read a list of problems). */
function wordNote() {
  const n = state.wordNote;
  if (!n || n.edition !== state.editionId) return null;
  const close = h(
    "button",
    {
      type: "button",
      class: "btn btn-small",
      onclick: () => {
        state.wordNote = null;
        renderMain();
      },
    },
    t("common.close"),
  );
  const box = notice(
    n.kind,
    msg(n.text),
    n.lines.length
      ? h(
          "ul",
          {},
          n.lines.map((l) => h("li", {}, msg(l))),
        )
      : null,
    close,
  );
  box.setAttribute("role", "status");
  return box;
}

function filterControl() {
  const options = [
    ["all", t("arts.all")],
    ["photo", t("arts.withPhoto")],
    ["short", t("needs.briefs")],
    ["notplaced", t("arts.notPlaced")],
  ];
  const seg = h("div", { class: "segmented segmented-small" });
  for (const [value, label] of options) {
    const disabled = value === "notplaced" && !state.lastResult;
    seg.append(
      h("input", {
        type: "radio",
        name: "article-filter",
        id: `filter-${value}`,
        value,
        checked: state.filter === value,
        disabled,
        dataset: { focusKey: `filter:${value}` },
        onchange: () => {
          state.filter = value;
          renderArticleList();
        },
      }),
      h("label", { for: `filter-${value}`, title: disabled ? t("arts.notPlacedTitle") : null }, label),
    );
  }
  return h(
    "fieldset",
    { class: "filter" },
    h("legend", { class: "sr-only" }, t("arts.show")),
    h("span", { class: "filter-label", "aria-hidden": "true" }, t("arts.show")),
    seg,
  );
}

function filteredArticles() {
  const q = fold(state.query).trim();
  return sortedArticles(state.detail.articles).filter((a) => {
    if (state.filter === "photo" && !hasPhoto(a)) return false;
    if (state.filter === "short" && !isBrief(a)) return false;
    if (state.filter === "notplaced" && !(state.lastResult && state.lastResult.notPlaced.has(a.id))) return false;
    if (!q) return true;
    return [a.headline, a.kicker, a.deck, a.byline, a.body].some((text) => fold(text).includes(q));
  });
}

function renderArticleList() {
  const host = $("#article-list-host");
  if (!host || !state.detail) return;
  const all = state.detail.articles;
  const key = focusKeyIn(host);
  if (!all.length) {
    host.replaceChildren(
      h("div", { class: "card empty empty-small" }, h("h2", {}, t("arts.none")), h("p", {}, t("arts.noneHint"))),
    );
    return;
  }
  const shown = filteredArticles();
  const countLine = $("#article-count");
  if (countLine) {
    setText(
      countLine,
      shown.length === all.length
        ? t("arts.count", { n: all.length })
        : t("arts.showing", { n: shown.length, total: all.length }),
    );
  }
  if (!shown.length) {
    host.replaceChildren(
      h(
        "div",
        { class: "card empty empty-small" },
        h(
          "p",
          {},
          state.query.trim() ? tn("arts.noMatch", { query: foreign(state.query.trim()) }) : t("arts.noMatchFilter"),
        ),
        h(
          "button",
          {
            type: "button",
            class: "btn",
            onclick: () => {
              state.query = "";
              state.filter = "all";
              renderMain();
            },
          },
          t("arts.showAll"),
        ),
      ),
    );
    return;
  }
  const list = h("ul", { class: "article-list", id: "article-list", "aria-label": t("step.articles") });
  for (const a of shown) list.append(articleRow(a));
  host.replaceChildren(list);
  restoreFocus(key);
}

function articleThumb(a) {
  if (!hasPhoto(a)) return h("div", { class: "thumb thumb-none" }, t("arts.noPhoto"));
  const url = photoUrl(a);
  const fallbackText = t("arts.photoNoPreview");
  const img = fallbackImage([url, withoutQuery(url)], { alt: t("art.photo"), decoding: "async" }, (el) =>
    el.replaceWith(fallbackText),
  );
  return h("div", { class: "thumb" }, img || fallbackText);
}

function lastWarningsFor(id) {
  return state.lastResult ? state.lastResult.warnings.get(id) || [] : [];
}

/** A small badge for an article the last finished layout warned about; the texts are in its title and for readers. */
function warningBadge(a) {
  const warnings = lastWarningsFor(a.id);
  if (!warnings.length) return null;
  return h(
    "span",
    { class: "chip chip-warn", title: warnings.join("\n") },
    icon("alert"),
    t("arts.warnings", { n: warnings.length }),
    h("span", { class: "sr-only", lang: langFor(warnings.join("; ")) }, `: ${warnings.join("; ")}`),
  );
}

function articleRow(a) {
  const brief = isBrief(a);
  const prio = priorityOf(a);
  const pin = pinOf(a);
  const pages = editionPages();
  const headline = clip(a.headline, 400) || t("arts.noHeadline");
  const result = articleResult(a);
  const row = h("li", { class: "article-row", dataset: { id: a.id } });
  row.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, select, textarea, label")) return;
    openArticleEditor(a);
  });
  const chip = brief
    ? h("span", { class: "chip chip-short", title: t("arts.shortTitle") }, t("arts.shortChip"))
    : h("span", { class: `chip chip-p${prio}` }, t(PRIORITY_KEY[prio]));
  const pinLine = pin
    ? h(
        "span",
        { class: pin > pages ? "pin pin-bad" : "pin" },
        icon(pin > pages ? "alert" : "pin"),
        h("span", {}, pin > pages ? t("arts.pinMissing", { n: pin }) : t("page.n", { n: pin })),
      )
    : h("span", { class: "pin" }, icon("auto"), h("span", {}, t("arts.auto")));
  row.append(
    articleThumb(a),
    h(
      "div",
      { class: "article-main" },
      h(
        "div",
        { class: "article-tags" },
        chip,
        str(a.kicker).trim()
          ? h("span", { class: "article-kicker deva", lang: langFor(a.kicker) }, clip(a.kicker, 80))
          : null,
        isSample(a) ? h("span", { class: "chip chip-test", title: t("arts.testTitle") }, t("arts.test")) : null,
        warningBadge(a),
      ),
      h("h2", { class: "article-headline", lang: langFor(headline) }, headline),
      h(
        "p",
        { class: "article-meta" },
        h("span", {}, t("count.word", { n: count(wordsOf(a)) })),
        str(a.byline).trim() ? h("span", { class: "deva", lang: langFor(a.byline) }, clip(a.byline, 60)) : null,
      ),
    ),
    h(
      "div",
      { class: "article-place" },
      h("span", { class: "sr-only" }, `${t("arts.pageSr")} `),
      pinLine,
      result
        ? h(
            "span",
            { class: `result result-${result.kind}`, title: result.text },
            icon(result.icon),
            h(
              "span",
              {},
              result.reason ? tn("result.notPlacedWhy", { reason: foreign(result.reason) }) : result.text,
              result.edited ? h("span", { class: "result-edited" }, ` ${t("arts.editedSince")}`) : null,
            ),
          )
        : null,
    ),
    h(
      "div",
      { class: "article-actions" },
      h(
        "button",
        {
          type: "button",
          class: "btn btn-small",
          "aria-label": t("arts.editAria", { headline: clip(headline, 80) }),
          dataset: { focusKey: `edit:${a.id}` },
          onclick: () => openArticleEditor(a),
        },
        t("common.edit"),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-small btn-danger-quiet",
          "aria-label": t("arts.deleteAria", { headline: clip(headline, 80) }),
          dataset: { focusKey: `delete:${a.id}` },
          onclick: () => deleteArticle(a),
        },
        t("common.delete"),
      ),
    ),
  );
  return row;
}

function confirmDeleteArticle(a) {
  return confirmDialog({
    title: t("arts.deleteTitle"),
    message: t("arts.deleteMessage", { headline: clip(a.headline, 140) || t("arts.noHeadline") }),
    confirm: t("arts.deleteOk"),
    danger: true,
  });
}

async function deleteArticle(a) {
  const ok = await confirmDeleteArticle(a);
  if (!ok) return;
  const order = filteredArticles().map((x) => x.id);
  const index = order.indexOf(a.id);
  try {
    await api("DELETE", apiPath(state.editionId, "articles", a.id));
    toast(t("arts.deleted"));
    await refreshDetail();
    const next = filteredArticles().map((x) => x.id);
    const target = next[Math.min(Math.max(index, 0), next.length - 1)];
    restoreFocus(target ? `edit:${target}` : "articles:add");
  } catch (err) {
    showAlert($("#articles-alert"), err.message);
  }
}

// ===================================================================== article editor

const editor = { article: null, id: null, file: null, fileType: "", fileUrl: "", removePhoto: false, busy: false };
let editorBaseline = "";

function readArticleForm() {
  const f = $("#form-article").elements;
  const checked = $("#form-article input[name='priority']:checked");
  return {
    headline: f.headline.value,
    kicker: f.kicker.value,
    deck: f.deck.value,
    byline: f.byline.value,
    body: f.body.value,
    priority: checked ? Number(checked.value) : 3,
    page: f.page.value ? Number(f.page.value) : null,
    caption: f.caption.value,
    credit: f.credit.value,
  };
}

function editorSnapshot() {
  return JSON.stringify([
    readArticleForm(),
    editor.file ? [editor.file.name, editor.file.size] : null,
    editor.removePhoto,
  ]);
}

function isEditorDirty() {
  return $("#dlg-article").open && editorSnapshot() !== editorBaseline;
}

function articleOrigin(a) {
  const source = str(a.source);
  const how = source.startsWith("sample:")
    ? t("art.fromSample")
    : { typed: t("art.typed"), pasted: t("art.pasted"), word: t("art.fromWord") }[source] || "";
  const when = friendlyTime(timeOf(a.created));
  return [when ? t("art.addedAt", { time: when }) : "", how].filter(Boolean).join(" · ");
}

function fillPageSelect(select, pin) {
  const total = editionPages();
  const options = [h("option", { value: "" }, t("art.pageAuto"))];
  for (let n = 1; n <= total; n += 1) {
    const role = pageRole(n);
    options.push(h("option", { value: String(n) }, role === "inside" ? t("page.n", { n }) : pageName(n, role)));
  }
  if (pin && pin > total) options.push(h("option", { value: String(pin) }, t("art.pageMissing", { n: pin })));
  select.replaceChildren(...options);
  select.value = pin ? String(pin) : "";
}

function openArticleEditor(article) {
  if (!state.detail) return;
  const form = $("#form-article");
  form.reset();
  clearEditorFile();
  editor.article = article || null;
  editor.id = article ? article.id : null;
  editor.removePhoto = false;
  setText($("#article-title"), article ? t("art.edit") : t("art.new"));
  setText($("#article-sub"), article ? articleOrigin(article) : t("art.required"));
  const f = form.elements;
  f.headline.value = str(article && article.headline);
  f.kicker.value = str(article && article.kicker);
  f.deck.value = str(article && article.deck);
  f.byline.value = str(article && article.byline);
  f.body.value = str(article && article.body);
  const prio = article ? priorityOf(article) : 3;
  for (const radio of $$("#form-article input[name='priority']")) radio.checked = radio.value === String(prio);
  fillPageSelect(f.page, article ? pinOf(article) : null);
  const photo = article && hasPhoto(article) ? article.photo : null;
  f.caption.value = str(photo && photo.caption);
  f.credit.value = str(photo && photo.credit);
  for (const id of ["article-headline", "article-body", "article-photo"]) setFieldError(id, "");
  showAlert($("#article-alert"), "");
  $("#article-delete").hidden = !article;
  const warnings = article ? lastWarningsFor(article.id) : [];
  fill(
    $("#article-notes"),
    warnings.length
      ? h(
          "div",
          { class: "notice notice-warn" },
          icon("alert"),
          h(
            "div",
            {},
            h("p", {}, t("art.notes")),
            h(
              "ul",
              { class: "notice-list" },
              warnings.map((w) => h("li", { lang: langFor(w) }, w)),
            ),
          ),
        )
      : "",
  );
  setEditorBusy(false);
  renderEditorPhoto();
  updateEditorWords();
  editorBaseline = editorSnapshot();
  $("#dlg-article").showModal();
  f.headline.focus();
}

function clearEditorFile() {
  if (editor.fileUrl) URL.revokeObjectURL(editor.fileUrl);
  editor.file = null;
  editor.fileType = "";
  editor.fileUrl = "";
}

function renderEditorPhoto() {
  const box = $("#photo-preview");
  const existing = editor.article && hasPhoto(editor.article) ? editor.article.photo : null;
  const mode = editor.file ? "new" : existing && !editor.removePhoto ? "existing" : "none";
  const parts = [];
  if (mode === "new") {
    parts.push(
      h("img", { src: editor.fileUrl, alt: t("art.newPhotoAlt") }),
      h(
        "p",
        { class: "photo-note" },
        icon("info"),
        h("span", {}, tn("art.newPhotoNote", { name: foreign(editor.file.name), size: fmtBytes(editor.file.size) })),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-small",
          onclick: () => {
            clearEditorFile();
            renderEditorPhoto();
            updateEditorWords();
          },
        },
        existing && !editor.removePhoto ? t("art.keepOld") : t("art.dontUse"),
      ),
    );
  } else if (mode === "existing") {
    const url = photoUrl(editor.article);
    const missing = () => h("div", { class: "photo-missing" }, t("art.storedNoPreview"));
    const img = fallbackImage([url, withoutQuery(url)], { alt: t("art.photoAlt") }, (el) => el.replaceWith(missing()));
    parts.push(img || missing());
    const w = int(existing.width_px);
    const hgt = int(existing.height_px);
    if (w && hgt) parts.push(h("p", { class: "photo-note" }, t("art.pixels", { w: String(w), h: String(hgt) })));
  } else {
    parts.push(h("div", { class: "photo-empty" }, editor.removePhoto ? t("art.willRemove") : t("art.noPhoto")));
    if (editor.removePhoto) {
      parts.push(
        h(
          "button",
          {
            type: "button",
            class: "btn btn-small",
            onclick: () => {
              editor.removePhoto = false;
              renderEditorPhoto();
              updateEditorWords();
            },
          },
          t("art.keepPhoto"),
        ),
      );
    }
  }
  box.replaceChildren(...parts);
  // a newly chosen file is undone with the button under its preview; "Remove photo" is for the stored photo
  $("#article-photo-remove").hidden = mode !== "existing";
  setText($("#article-photo-label"), mode === "none" ? t("art.addPhoto") : t("art.replacePhoto"));
  const f = $("#form-article").elements;
  f.caption.disabled = mode === "none";
  f.credit.disabled = mode === "none";
}

function updateEditorWords() {
  const f = $("#form-article").elements;
  const words = countWords(f.body.value);
  const willHavePhoto = !!editor.file || (!!editor.article && hasPhoto(editor.article) && !editor.removePhoto);
  const short = words > 0 && words <= BRIEF_MAX_WORDS && !willHavePhoto;
  setText($("#article-words"), t("count.word", { n: words }));
  $("#article-short").hidden = !short;
  $("#article-short-note").hidden = !short;
}

function onPhotoChosen(e) {
  const input = e.currentTarget;
  const file = input.files && input.files[0];
  input.value = "";
  setFieldError("article-photo", "");
  if (!file) return;
  const type = imageTypeOf(file);
  if (!type) {
    setFieldError("article-photo", t("art.badType"));
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    setFieldError("article-photo", t("common.tooBig", { size: fmtBytes(file.size) }));
    return;
  }
  if (file.size === 0) {
    setFieldError("article-photo", t("art.emptyFile"));
    return;
  }
  clearEditorFile();
  editor.file = file;
  editor.fileType = type;
  editor.fileUrl = URL.createObjectURL(file);
  editor.removePhoto = false;
  renderEditorPhoto();
  updateEditorWords();
}

function setEditorBusy(on, text = "") {
  const hadFocus = document.activeElement;
  editor.busy = on;
  for (const id of ["article-save", "article-cancel", "article-delete"]) $(`#${id}`).disabled = on;
  $("#article-busy").replaceChildren(...(on ? [spinner(), text] : []));
  $("#form-article").setAttribute("aria-busy", on ? "true" : "false");
  if (!on && hadFocus && (hadFocus === document.body || hadFocus === $("#dlg-article"))) $("#article-save").focus();
}

function closeEditor() {
  const dlg = $("#dlg-article");
  if (dlg.open) dlg.close();
  clearEditorFile();
}

async function cancelEditor() {
  if (editor.busy) return;
  if (isEditorDirty()) {
    const ok = await confirmDialog({
      title: t("art.discardTitle"),
      message: t("art.discardMessage"),
      confirm: t("art.discardOk"),
      cancel: t("art.keepEditing"),
      danger: true,
    });
    if (!ok) return;
  }
  closeEditor();
}

async function saveArticle(e) {
  e.preventDefault();
  if (editor.busy) return;
  const v = readArticleForm();
  const f = $("#form-article").elements;
  let firstBad = null;
  if (!v.headline.trim()) {
    setFieldError("article-headline", t("art.needHeadline"));
    firstBad = f.headline;
  } else setFieldError("article-headline", "");
  if (!v.body.trim()) {
    setFieldError("article-body", t("art.needBody"));
    firstBad = firstBad || f.body;
  } else setFieldError("article-body", "");
  if (firstBad) {
    firstBad.focus();
    return;
  }
  const editionId = state.editionId;
  const fields = {
    headline: v.headline,
    kicker: v.kicker,
    deck: v.deck,
    byline: v.byline,
    body: v.body,
    priority: v.priority,
    page: v.page,
  };
  showAlert($("#article-alert"), "");
  setEditorBusy(true, t("common.saving"));
  let stage = "article";
  try {
    if (!editor.id) {
      const created = await api("POST", apiPath(editionId, "articles"), { json: fields });
      const art = isObj(created.article) ? created.article : created;
      if (!str(art.id)) throw deskError("api.noArticle");
      editor.id = art.id;
      editor.article = art;
      setText($("#article-title"), t("art.edit"));
      $("#article-delete").hidden = false;
    } else {
      const updated = await api("PUT", apiPath(editionId, "articles", editor.id), { json: fields });
      const art = isObj(updated.article) ? updated.article : updated;
      editor.article = { ...(editor.article || {}), ...art };
    }
    stage = "photo";
    const photo = hasPhoto(editor.article) ? editor.article.photo : null;
    if (editor.file) {
      setEditorBusy(true, t("art.uploading"));
      const query = new URLSearchParams({ caption: v.caption, credit: v.credit });
      await api("PUT", `${apiPath(editionId, "articles", editor.id, "photo")}?${query}`, {
        raw: editor.file,
        contentType: editor.fileType,
      });
      clearEditorFile();
    } else if (editor.removePhoto && photo) {
      await api("DELETE", apiPath(editionId, "articles", editor.id, "photo"));
    } else if (photo && (v.caption !== str(photo.caption) || v.credit !== str(photo.credit))) {
      await api("PUT", apiPath(editionId, "articles", editor.id, "photo-text"), {
        json: { caption: v.caption, credit: v.credit },
      });
    }
    const savedId = editor.id;
    setEditorBusy(false);
    closeEditor();
    toast(t("art.saved"));
    await refreshDetail();
    if (state.step === "articles") restoreFocus(`edit:${savedId}`);
  } catch (err) {
    const message = stage === "photo" ? tn("art.photoNotSaved", { error: foreign(err.message) }) : err.message;
    showAlert($("#article-alert"), message);
    if (stage === "photo") refreshDetail({ quiet: true });
  } finally {
    if (editor.busy) setEditorBusy(false);
  }
}

async function deleteFromEditor() {
  if (!editor.id || editor.busy) return;
  const ok = await confirmDeleteArticle(editor.article || {});
  if (!ok) return;
  setEditorBusy(true, t("art.deleting"));
  try {
    await api("DELETE", apiPath(state.editionId, "articles", editor.id));
    setEditorBusy(false);
    closeEditor();
    toast(t("arts.deleted"));
    await refreshDetail();
    restoreFocus("articles:add");
  } catch (err) {
    showAlert($("#article-alert"), err.message);
  } finally {
    if (editor.busy) setEditorBusy(false);
  }
}

// ===================================================================== paste several

function updatePasteCount() {
  const items = splitPaste($("#paste-text").value);
  const out = $("#paste-count");
  const preview = $("#paste-preview");
  if (!items.length) {
    out.replaceChildren(h("span", { class: "muted" }, t("paste.nothing")));
    preview.replaceChildren();
    return;
  }
  const noBody = items.filter((x) => !x.hasBody).length;
  fill(
    out,
    h("strong", {}, t("paste.looksLike", { n: items.length })),
    noBody ? h("span", { class: "muted" }, ` ${t("paste.noBody", { n: noBody })}`) : null,
  );
  const shown = items.slice(0, 8).map((x) => h("li", { lang: langFor(x.headline) }, clip(x.headline, 90)));
  if (items.length > 8) shown.push(h("li", {}, t("paste.more", { n: items.length - 8 })));
  preview.replaceChildren(...shown);
}

function openPasteDialog() {
  if (!state.detail) return;
  showAlert($("#paste-alert"), "");
  updatePasteCount();
  $("#dlg-paste").showModal();
  $("#paste-text").focus();
}

async function submitPaste(e) {
  e.preventDefault();
  const textArea = $("#paste-text");
  const items = splitPaste(textArea.value);
  if (!items.length) {
    showAlert($("#paste-alert"), t("paste.empty"));
    textArea.focus();
    return;
  }
  const submit = $("#paste-submit");
  submit.disabled = true;
  $("#paste-busy").replaceChildren(spinner(), t("paste.adding"));
  showAlert($("#paste-alert"), "");
  try {
    const res = await api("POST", apiPath(state.editionId, "articles", "bulk"), { json: { text: textArea.value } });
    const created = int(res.created) ?? arr(res.articles).length;
    const skipped = arr(res.skipped).filter(isObj);
    if (skipped.length) {
      // keep what was not added in the box, so nothing typed is lost; what was added is gone from it
      const left = new Set(skipped.map((s) => str(s.headline).trim()));
      textArea.value = items
        .filter((it) => left.has(it.headline.slice(0, 200)))
        .map((it) => it.text)
        .join("\n---\n");
      updatePasteCount();
      const list = skipped
        .map((s) => `“${clip(str(s.headline), 60)}” (${str(s.reason) || t("common.notAccepted")})`)
        .join("; ");
      showAlert($("#paste-alert"), [
        t("paste.added", { n: created }),
        " ",
        tn("paste.notAdded", { n: skipped.length, list: foreign(list) }),
      ]);
    } else {
      textArea.value = "";
      $("#dlg-paste").close();
      toast(t("count.added", { n: created }));
    }
    await refreshDetail();
  } catch (err) {
    showAlert($("#paste-alert"), err.message);
  } finally {
    submit.disabled = false;
    $("#paste-busy").replaceChildren();
  }
}

// ===================================================================== Word files

const DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
let wordBusy = false;

/** Opens the file chooser; each chosen .docx file's stories become articles (formatting is not kept). */
function chooseWordFiles() {
  if (!state.detail || wordBusy) return;
  const input = document.createElement("input");
  input.type = "file";
  input.accept = `.docx,${DOCX_TYPE}`;
  input.multiple = true;
  input.addEventListener("change", () => importWordFiles([...(input.files || [])]));
  input.click();
}

async function importWordFiles(files) {
  if (!files.length || wordBusy) return;
  wordBusy = true;
  const eid = state.editionId;
  let added = 0;
  let fromFiles = 0;
  const problems = [];
  const notes = [];
  toast(t("word.reading", { n: files.length }), "info");
  try {
    for (const file of files) {
      if (!/\.docx$/i.test(file.name)) {
        problems.push(() => t("word.notDocx", { file: file.name }));
        continue;
      }
      try {
        const res = await api("POST", apiPath(eid, "articles", "import-docx"), {
          raw: file,
          contentType: DOCX_TYPE,
        });
        const n = int(res.created) ?? arr(res.articles).length;
        added += n;
        if (n) fromFiles += 1;
        for (const s of arr(res.skipped).filter(isObj))
          problems.push(`${file.name}: “${clip(str(s.headline), 50)}” (${str(s.reason) || t("common.notAccepted")})`);
        for (const n of arr(res.notes)) notes.push(`${file.name}: ${str(n)}`);
      } catch (err) {
        problems.push(`${file.name}: ${err.message}`); // the server's words (or the Desk's, in the language then)
      }
    }
  } finally {
    wordBusy = false;
  }
  state.wordNote = {
    edition: eid,
    kind: problems.length ? "warn" : "ok",
    // in the language shown when it is drawn (the screen can change language while it is open)
    text: () => {
      if (!added) return t("word.noneAdded", { n: files.length });
      const from = t("word.fromFiles", { n: fromFiles });
      return fromFiles < files.length
        ? t("word.addedOf", { n: added, from, chosen: files.length })
        : t("word.added", { n: added, from });
    },
    lines: [...new Set([...problems, ...notes])],
  };
  if (added) toast(t("count.added", { n: added }));
  if (state.editionId === eid) await refreshDetail();
  if (state.editionId === eid && state.step === "articles") renderMain();
}

// ===================================================================== import a past edition (testing)

let importBusy = false;

async function openImportDialog() {
  if (!state.detail) return;
  const list = $("#import-list");
  showAlert($("#import-alert"), "");
  $("#import-progress").replaceChildren();
  list.replaceChildren(h("p", { class: "loading" }, spinner(), t("imp.looking")));
  $("#import-submit").disabled = true;
  $("#dlg-import").showModal();
  const editionId = state.editionId;
  try {
    const data = await api("GET", "/api/samples");
    if (state.editionId !== editionId || !$("#dlg-import").open) return;
    const samples = arr(data.samples).filter((s) => isObj(s) && str(s.name));
    if (!samples.length) {
      list.replaceChildren(h("p", {}, t("imp.none")));
      return;
    }
    const already = new Set(
      state.detail.articles
        .map((a) => str(a.source))
        .filter((s) => s.startsWith("sample:"))
        .map((s) => s.slice(7)),
    );
    const fieldset = h("fieldset", {}, h("legend", {}, t("imp.legend")));
    samples.forEach((s, i) => {
      const name = str(s.name);
      const facts = [
        int(s.pages) ? t("count.page", { n: int(s.pages) }) : null,
        num(s.stories) !== null ? t("count.story", { n: count(s.stories) }) : null,
        num(s.photos) !== null ? t("count.photo", { n: count(s.photos) }) : null,
        num(s.words) !== null ? t("count.word", { n: count(s.words) }) : null,
      ].filter(Boolean);
      fieldset.append(
        h(
          "label",
          { class: "sample", for: `sample-${i}` },
          h("input", { type: "checkbox", id: `sample-${i}`, value: name }),
          h("span", { class: "sample-title" }, s.date ? friendlyDate(s.date) : name),
          facts.length ? h("span", { class: "sample-facts" }, facts.join(" · ")) : null,
          s.date ? h("span", { class: "sample-name" }, name) : null,
          already.has(name) ? h("span", { class: "sample-already" }, t("imp.already")) : null,
        ),
      );
    });
    list.replaceChildren(fieldset);
    $("#import-submit").disabled = false;
    if (document.activeElement === $("#import-cancel")) $("#sample-0").focus();
  } catch (err) {
    list.replaceChildren();
    showAlert($("#import-alert"), err.message);
  }
}

async function submitImport(e) {
  e.preventDefault();
  if (importBusy) return;
  const names = $$("#import-list input[type='checkbox']:checked").map((input) => input.value);
  if (!names.length) {
    showAlert($("#import-alert"), t("imp.choose"));
    return;
  }
  importBusy = true;
  $("#import-submit").disabled = true;
  $("#import-cancel").disabled = true;
  for (const input of $$("#import-list input")) input.disabled = true;
  showAlert($("#import-alert"), "");
  $("#import-progress").replaceChildren(spinner(), t("imp.importing"));
  try {
    const res = await api("POST", apiPath(state.editionId, "import-sample"), { json: { samples: names } });
    importBusy = false;
    $("#dlg-import").close();
    toast(
      t("imp.done", {
        stories: t("count.story", { n: int(res.imported) ?? 0 }),
        photos: t("count.photo", { n: int(res.photos) ?? 0 }),
      }),
    );
    await refreshDetail();
  } catch (err) {
    showAlert($("#import-alert"), err.message);
    for (const input of $$("#import-list input")) input.disabled = false;
  } finally {
    importBusy = false;
    $("#import-submit").disabled = false;
    $("#import-cancel").disabled = false;
    $("#import-progress").replaceChildren();
  }
}

// ===================================================================== step 3: ads

function viewAds() {
  const view = h("section", { class: "step-view", "aria-labelledby": "step-title" });
  const slots = adSlots();
  const filled = slots.filter((s) => adInfo(s.slot)).length;
  view.append(
    stepHeader(t("step.ads"), slots.length ? t("ads.lede", { n: filled, total: slots.length }) : t("ads.ledeNone")),
  );
  if (!backPageAds()) {
    view.append(
      notice(
        "info",
        t("ads.backAllNews"),
        h("button", { type: "button", class: "btn btn-small", onclick: () => goStep("edition") }, t("ads.goStep1")),
      ),
    );
  }
  if (!state.detail.plan) {
    view.append(planMissingNotice());
    return view;
  }
  if (!slots.length) {
    view.append(h("div", { class: "card empty empty-small" }, h("p", {}, t("ads.none"))));
    return view;
  }
  const maxW = Math.max(1, ...slots.map((s) => num(s.w_mm, 0)));
  const maxH = Math.max(1, ...slots.map((s) => num(s.h_mm, 0)));
  const scale = Math.min(340 / maxW, 230 / maxH);
  const pages = [...new Set(slots.map((s) => s.page))];
  for (const page of pages) {
    const onPage = slots.filter((s) => s.page === page);
    const headingId = `ads-page-${page}`;
    view.append(
      h(
        "section",
        { class: "card", "aria-labelledby": headingId },
        h("h2", { class: "card-title", id: headingId }, pageName(page, onPage[0].role)),
        h("p", { class: "card-lede" }, t("count.adSpace", { n: onPage.length })),
        h(
          "div",
          { class: "ad-list" },
          onPage.map((s) => adCard(s, scale)),
        ),
      ),
    );
  }
  return view;
}

function adCard(slot, scale) {
  const w = num(slot.w_mm, 0);
  const hgt = num(slot.h_mm, 0);
  const info = adInfo(slot.slot);
  const has = !!info;
  const box = h("div", {
    class: has ? "ad-box" : "ad-box ad-box-empty",
    style: {
      width: `${Math.max(64, Math.round(w * scale))}px`,
      "aspect-ratio": w > 0 && hgt > 0 ? `${w} / ${hgt}` : "2 / 1",
    },
  });
  if (has) {
    const url = adUrl(slot.slot);
    const missing = () => h("span", { class: "ad-box-label" }, t("ads.noPreview"));
    const img = fallbackImage([url, withoutQuery(url)], { alt: t("ads.imageAlt", { slot: slot.slot }) }, (el) =>
      el.replaceWith(missing()),
    );
    box.append(img || missing());
  } else box.append(h("span", { class: "ad-box-label", "aria-hidden": "true" }, t("plan.ad")));
  const inputId = `ad-file-${domId(slot.slot)}`;
  const alertSlot = h("div", { class: "alert-slot" });
  const busy = h("p", { class: "busy-note", "aria-live": "polite" });
  const input = h("input", {
    type: "file",
    id: inputId,
    class: "file-input",
    accept: IMAGE_ACCEPT,
    "aria-describedby": `${inputId}-note`,
    dataset: { focusKey: `ad:file:${slot.slot}` },
  });
  const card = h("div", { class: "ad-card", dataset: { slot: slot.slot } });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) uploadAd(slot, file, { card, alertSlot, busy });
  });
  const minW = w > 0 ? Math.ceil((w / 25.4) * 200) : 0;
  const minH = hgt > 0 ? Math.ceil((hgt / 25.4) * 200) : 0;
  const wPx = info ? (int(info.w_px) ?? int(info.width_px)) : null;
  const hPx = info ? (int(info.h_px) ?? int(info.height_px)) : null;
  card.append(
    h("div", { class: "ad-visual" }, box),
    h(
      "div",
      { class: "ad-info" },
      h("h3", { class: "ad-title" }, t("ads.space", { slot: slot.slot })),
      h("p", { class: "ad-size" }, t("ads.size", { w: fmtMm(w), h: fmtMm(hgt) })),
      has
        ? h(
            "p",
            { class: "ad-state ad-state-ok" },
            icon("check"),
            h("span", {}, wPx && hPx ? t("ads.addedPx", { w: String(wPx), h: String(hPx) }) : t("ads.added")),
          )
        : h("p", { class: "ad-state" }, icon("info"), h("span", {}, t("ads.reserved"))),
      h(
        "p",
        { class: "field-note", id: `${inputId}-note` },
        minW && minH ? t("ads.noteMin", { w: minW, h: minH }) : t("ads.note"),
      ),
      h(
        "div",
        { class: "ad-actions" },
        h(
          "span",
          { class: "file-pick" },
          input,
          h(
            "label",
            { for: inputId, class: "btn btn-small" },
            icon("upload"),
            has ? t("ads.replace") : t("ads.upload"),
          ),
        ),
        has
          ? h(
              "button",
              {
                type: "button",
                class: "btn btn-small btn-danger-quiet",
                dataset: { focusKey: `ad:remove:${slot.slot}` },
                onclick: () => removeAd(slot, alertSlot),
              },
              t("common.remove"),
            )
          : null,
      ),
      busy,
      alertSlot,
    ),
  );
  return card;
}

async function uploadAd(slot, file, ui) {
  showAlert(ui.alertSlot, "");
  const type = imageTypeOf(file);
  if (!type) {
    showAlert(ui.alertSlot, t("ads.badType"));
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showAlert(ui.alertSlot, t("common.tooBig", { size: fmtBytes(file.size) }));
    return;
  }
  ui.card.classList.add("is-busy");
  ui.busy.replaceChildren(spinner(), t("ads.uploading"));
  try {
    const res = await api("PUT", apiPath(state.editionId, "ads", slot.slot), { raw: file, contentType: type });
    state.adLocal[slot.slot] = { w_px: int(res.w_px), h_px: int(res.h_px) };
    state.adBust[slot.slot] = String(Date.now());
    toast(t("ads.toastAdded", { slot: slot.slot }));
    await refreshDetail();
  } catch (err) {
    showAlert(ui.alertSlot, err.message);
  } finally {
    ui.card.classList.remove("is-busy");
    ui.busy.replaceChildren();
  }
}

async function removeAd(slot, alertSlot) {
  const ok = await confirmDialog({
    title: t("ads.removeTitle"),
    message: t("ads.removeMessage", { slot: slot.slot }),
    confirm: t("ads.removeOk"),
    danger: true,
  });
  if (!ok) return;
  try {
    await api("DELETE", apiPath(state.editionId, "ads", slot.slot));
    state.adLocal[slot.slot] = null;
    toast(t("ads.toastRemoved", { slot: slot.slot }));
    await refreshDetail();
    restoreFocus(`ad:file:${slot.slot}`);
  } catch (err) {
    showAlert(alertSlot, err.message);
  }
}

// ===================================================================== step 4: lay out & download

function viewRun() {
  const view = h("section", { class: "step-view", "aria-labelledby": "step-title" });
  view.append(
    stepHeader(t("step.run"), t("run.lede", { n: editionPages() })),
    h("div", { id: "run-start-host" }),
    h("div", { id: "run-panel" }),
    runHistory(),
  );
  return view;
}

function runGate() {
  const d = state.detail;
  const warnings = [];
  const active = activeRunSummary() || (isRunActive(state.run) && isObj(state.run.status) ? state.run : null);
  let blocked;
  if (active) blocked = t("run.running");
  else if (!d.articles.length) blocked = t("run.noArticles");
  else blocked = engineBlocked();
  const needs = computeNeeds();
  const have = computeHave(d.articles);
  if (needs && num(needs.total.stories) !== null && have.stories < needs.total.stories && d.articles.length) {
    warnings.push(t("run.warnStories", { n: have.stories, need: count(needs.total.stories) }));
  }
  if (needs && num(needs.total.photos) !== null && have.photos < needs.total.photos && d.articles.length) {
    warnings.push(t("run.warnPhotos", { n: have.photos, need: count(needs.total.photos) }));
  }
  const pages = editionPages();
  const beyond = d.articles.filter((a) => (pinOf(a) || 0) > pages).length;
  if (beyond) {
    warnings.push(t("run.warnPinned", { n: beyond, pages }));
  }
  const slots = adSlots();
  const empty = slots.filter((s) => !adInfo(s.slot)).length;
  if (empty) {
    warnings.push(t("run.warnAds", { n: empty, total: slots.length }));
  }
  const samples = d.articles.filter(isSample).length;
  if (samples) {
    warnings.push(t("run.warnSamples", { n: samples }));
  }
  return { blocked, warnings };
}

function renderRunStart() {
  const host = $("#run-start-host");
  if (!host || !state.detail) return;
  const gate = runGate();
  // once a layout is shown below (running or finished), the checks fold away so the progress and results come first
  const shown = state.run && isObj(state.run.status) ? str(state.run.status.state) : "";
  const collapse = shown !== "";
  const again = TERMINAL.has(shown);
  const signature = JSON.stringify([
    gate,
    state.runStarting,
    msg(state.runStartError),
    editionPages(),
    collapse,
    again,
    lang(),
  ]);
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  const key = focusKeyIn(host);
  const pages = editionPages();
  const button = h(
    "button",
    {
      type: "button",
      class: "btn btn-primary btn-big",
      disabled: !!gate.blocked || state.runStarting,
      "aria-describedby": "run-go-note",
      dataset: { focusKey: "run:start" },
      onclick: startRun,
    },
    state.runStarting ? [spinner(), t("run.starting")] : t(again ? "run.goAgain" : "run.go", { n: pages }),
  );
  const warningList = gate.warnings.length
    ? h(
        "ul",
        { class: "warn-list", "aria-label": t("run.beforeStart") },
        gate.warnings.map((w) => h("li", {}, icon("alert"), h("span", {}, w))),
      )
    : null;
  host.replaceChildren(
    h(
      "section",
      { class: "card run-start", "aria-label": t("run.startLabel") },
      warningList && collapse
        ? h(
            "details",
            { class: "warn-details", dataset: { focusKey: "run:checks" } },
            h("summary", {}, icon("alert"), t("run.checks", { n: gate.warnings.length })),
            warningList,
          )
        : warningList,
      h(
        "div",
        { class: "run-go" },
        button,
        h(
          "p",
          {
            class: gate.blocked ? "run-go-note is-blocked" : "run-go-note",
            id: "run-go-note",
            lang: gate.blocked ? langFor(gate.blocked) : null,
          },
          gate.blocked || t("run.timeNote"),
        ),
      ),
      measureLine(),
      state.runStartError ? alertBox(msg(state.runStartError)) : null,
    ),
  );
  restoreFocus(key);
}

async function startRun() {
  if (state.runStarting) return;
  const editionId = state.editionId;
  state.runStarting = true;
  state.runStartError = "";
  renderRunStart();
  try {
    const res = await api("POST", apiPath(editionId, "runs"), { json: {} });
    const runId = str(res.run);
    if (!runId) throw deskError("api.noRun");
    if (state.editionId !== editionId) return;
    state.runStarting = false;
    selectRun(runId, { render: false });
    toast(t("run.started", { n: editionPages() }));
    await refreshDetail({ quiet: true, changed: false });
  } catch (err) {
    state.runStarting = false;
    if (state.editionId !== editionId) return;
    if (err.status === 409) {
      const said = errMsg(err);
      state.runStartError = () => t("run.conflict", { error: msg(said) });
      await refreshDetail({ quiet: true, changed: false });
      const active = activeRunSummary();
      if (active && (!state.run || state.run.id !== active.id)) selectRun(active.id);
    } else {
      state.runStartError = errMsg(err);
    }
  } finally {
    state.runStarting = false;
    if (state.step === "run") {
      renderRunStart();
      patchRun();
    }
  }
}

function selectRun(runId, options = {}) {
  stopRunPolling();
  state.run = { id: runId, status: null, error: "", timer: 0, polledAt: 0, failures: 0, wasActive: false };
  const summary = state.detail ? state.detail.runs.find((r) => r.id === runId) : null;
  if (summary) state.run.started = summary.started;
  if (options.render !== false && state.step === "run") renderMain();
  pollRun(state.run);
}

function stopRunPolling() {
  if (state.run) {
    clearTimeout(state.run.timer);
    state.run.timer = 0;
    state.run.stopped = true;
  }
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = 0;
  }
}

async function pollRun(run) {
  if (state.run !== run || run.stopped || run.inFlight) return;
  clearTimeout(run.timer);
  run.timer = 0;
  run.inFlight = true;
  const editionId = state.editionId;
  const asked = run.changes || 0; // the changes this answer will have seen
  try {
    const status = await api("GET", apiPath(editionId, "runs", run.id));
    if (state.run !== run || state.editionId !== editionId) return;
    applyRunStatus(run, status);
    run.checked = Math.max(run.checked || 0, asked);
    run.error = "";
    run.failures = 0;
  } catch (err) {
    if (state.run !== run) return;
    run.failures += 1;
    if (err.status === 404) {
      run.gone = true;
      run.error = () => t("run.gone");
    } else {
      const said = errMsg(err);
      run.error = () => t("run.retrying", { error: msg(said) });
    }
  } finally {
    run.inFlight = false;
  }
  if (state.run !== run || run.stopped) return;
  const terminal = isObj(run.status) && TERMINAL.has(str(run.status.state));
  renderRunBits();
  if (terminal) {
    onRunFinished(run);
    // a check after the last change still to come (this answer was asked for before it): at once, unless the
    // server is not answering (then it is asked again later and later, as for a running layout)
    const due = run.failures
      ? Math.min(POLL_MS * 2 ** run.failures, 10000)
      : (run.changes || 0) > (run.checked || 0)
        ? 0
        : FINISHED_POLL_MS;
    if (!run.gone && !document.hidden) run.timer = setTimeout(() => pollRun(run), due);
    return;
  }
  if (run.gone) return;
  const delay = run.failures ? Math.min(POLL_MS * 2 ** run.failures, 10000) : POLL_MS;
  run.timer = setTimeout(() => pollRun(run), delay);
}

function applyRunStatus(run, status) {
  const previous = isObj(run.status) ? run.status : null;
  run.status = status;
  run.polledAt = Date.now();
  const now = str(status.state);
  if (!TERMINAL.has(now)) run.wasActive = true;
  if (!previous || !run.wasActive) return;
  const messages = [];
  if (str(previous.state) !== now && RUN_STATE_KEY[now])
    messages.push(t("run.sayState", { state: runStateLabel(now) }));
  const before = new Map(
    arr(previous.pages)
      .filter(isObj)
      .map((p) => [int(p.page), str(p.state)]),
  );
  for (const p of arr(status.pages)) {
    if (!isObj(p)) continue;
    const n = int(p.page);
    const s = str(p.state);
    if (before.get(n) !== s && (s === "done" || s === "failed"))
      messages.push(t(s === "done" ? "run.sayDone" : "run.sayFailed", { n }));
  }
  if (messages.length) announce(messages.join(" "));
}

function renderRunBits() {
  renderSteps();
  updateTitle();
  if (state.step === "run") {
    renderRunStart();
    patchRun();
  }
}

function onRunFinished(run) {
  if (clockTimer) {
    clearInterval(clockTimer);
    clockTimer = 0;
  }
  if (run.finishedSeen) return;
  run.finishedSeen = true;
  if (!run.wasActive) return;
  state.runStartError = ""; // e.g. "a layout is already running": no longer true
  const s = str(run.status.state);
  if (s === "done") toast(t("run.toastDone", { n: editionPages() }));
  else if (s === "failed") toast(t("run.toastFailed"), "error");
  else toast(t("run.toastCancelled"), "info");
  refreshDetail({ quiet: true, changed: false });
}

function elapsedText(run) {
  const status = isObj(run.status) ? run.status : null;
  let seconds = status ? num(status.elapsed_s) : null;
  if (seconds === null) return "";
  const s = str(status.state);
  if (!TERMINAL.has(s)) {
    if (run.polledAt) seconds += (Date.now() - run.polledAt) / 1000;
    return t("run.soFar", { time: fmtDuration(seconds) });
  }
  return t(s === "done" ? "run.took" : "run.stoppedAfter", { time: fmtDuration(seconds) });
}

function runPagesFor(run) {
  const status = isObj(run.status) ? run.status : null;
  const pages = arr(status && status.pages).filter((p) => isObj(p) && int(p.page) !== null);
  if (pages.length || !isRunActive(run)) return pages.slice().sort((a, b) => int(a.page) - int(b.page));
  return planPages().map((p) => ({ page: int(p.page), role: p.role, state: "waiting" }));
}

function buildRunUI(run) {
  const ui = { runId: run.id, lang: lang(), cards: new Map(), resultsSignature: null };
  ui.title = h("h2", { class: "run-title", id: "run-title" });
  ui.state = h("p", { class: "run-state" });
  ui.elapsed = h("p", { class: "run-elapsed" });
  ui.message = h("p", { class: "run-message" });
  ui.cancel = h(
    "button",
    {
      type: "button",
      class: "btn btn-danger-quiet",
      hidden: true,
      dataset: { focusKey: "run:cancel" },
      onclick: cancelRun,
    },
    t("run.cancel"),
  );
  ui.hint = h("p", { class: "run-hint" }, `${t("run.timeNote")} ${t("run.keepWorking")}`);
  ui.progress = h("progress", { class: "run-progress", max: "1", value: "0", "aria-labelledby": "run-progress-label" });
  ui.progressLabel = h("span", { class: "run-progress-label", id: "run-progress-label" });
  ui.progressRow = h("div", { class: "run-progress-row" }, ui.progress, ui.progressLabel);
  ui.alert = h("div", { class: "alert-slot" });
  ui.stale = h("div", { class: "run-stale" });
  ui.grid = h("ol", { class: "page-grid", "aria-label": t("ed.pages") });
  ui.results = h("div", { class: "run-results" });
  ui.root = h(
    "section",
    { class: "card run-card", "aria-labelledby": "run-title" },
    h(
      "div",
      { class: "run-head" },
      h("div", {}, ui.title, h("div", { class: "run-head-meta" }, ui.state, ui.elapsed), ui.message),
      ui.cancel,
    ),
    ui.hint,
    ui.progressRow,
    ui.alert,
    ui.stale,
    ui.grid,
    ui.results,
  );
  return ui;
}

function patchRun() {
  const host = $("#run-panel");
  if (!host) return;
  const run = state.run;
  if (!run) {
    host.replaceChildren();
    runUI = null;
    return;
  }
  if (!runUI || runUI.runId !== run.id || runUI.lang !== lang() || runUI.root.parentNode !== host) {
    runUI = buildRunUI(run);
    host.replaceChildren(runUI.root);
  }
  const ui = runUI;
  const key = focusKeyIn(ui.root);
  const status = isObj(run.status) ? run.status : null;
  const s = status ? str(status.state) : "";
  const terminal = TERMINAL.has(s);
  const started = runStartTime(run);
  setText(ui.title, started !== null ? t("run.layoutOf", { time: friendlyTime(started) }) : t("run.layout"));

  let tone = "busy";
  let stateIcon = spinner();
  if (s === "done") {
    tone = "ok";
    stateIcon = icon("check");
  } else if (s === "failed") {
    tone = "bad";
    stateIcon = icon("x");
  } else if (s === "cancelled") {
    tone = "muted";
    stateIcon = icon("x");
  }
  const stateText = status
    ? runStateLabel(s) || s || t("run.unknownState")
    : run.error
      ? t("top.notAvailable")
      : t("top.loading");
  if (ui.state.dataset.text !== stateText) {
    ui.state.dataset.text = stateText;
    ui.state.dataset.tone = tone;
    ui.state.replaceChildren(stateIcon, h("span", {}, stateText));
  }
  setText(ui.elapsed, elapsedText(run));
  // the engine's own progress message, unless it only repeats the state label ("Laying out" / "Laying out pages")
  const engineMessage = status && !terminal ? str(status.message).trim() : "";
  // (the engine speaks English: its message is matched with the English label)
  const label = RUN_STATE_KEY[s] ? tIn("en", RUN_STATE_KEY[s]) : s;
  const repeats = !!engineMessage && fold(label).startsWith(fold(engineMessage));
  setText(ui.message, repeats ? "" : engineMessage);
  if (langFor(ui.message.textContent)) ui.message.lang = langFor(ui.message.textContent);
  else ui.message.removeAttribute("lang");
  ui.cancel.hidden = !(status && !terminal);
  ui.hint.hidden = terminal || !status;

  const pages = runPagesFor(run);
  const done = pages.filter((p) => str(p.state) === "done").length;
  const failed = pages.filter((p) => str(p.state) === "failed").length;
  ui.progressRow.hidden = terminal || !status;
  ui.progress.max = Math.max(1, pages.length);
  ui.progress.value = done + failed;
  setText(
    ui.progressLabel,
    pages.length
      ? t(failed ? "run.progressFailed" : "run.progress", { n: done, total: pages.length, failed })
      : t("run.planning"),
  );

  const errors = [];
  if (run.error) errors.push(msg(run.error));
  if (status && str(status.error)) errors.push(str(status.error));
  else if (s === "failed" && str(status.message)) errors.push(str(status.message));
  const errorText = errors.join(" ");
  if (ui.alert.dataset.text !== errorText) {
    ui.alert.dataset.text = errorText;
    showAlert(ui.alert, errorText);
  }

  const newer = activeRunSummary();
  let staleText = "";
  if (newer && newer.id !== run.id) staleText = t("run.newer");
  else if (terminal && addedAfter(status) > 0) {
    // changes to what the pages print are shown on the pages themselves ("needs saving"); new articles are not
    staleText = t("run.addedAfter", { n: addedAfter(status) });
  }
  if (ui.stale.dataset.text !== staleText) {
    ui.stale.dataset.text = staleText;
    fill(ui.stale, staleText ? notice("info", staleText) : "");
  }

  patchCards(ui, run, pages);

  if (terminal) {
    const signature = JSON.stringify([
      status,
      (state.detail ? state.detail.articles : []).map((a) => [a.id, a.headline]),
      rechecking(), // "checking against your last change" until the server answered after it
      !!run.gone, // a layout no longer on the server is not current
      lang(),
    ]);
    if (ui.resultsSignature !== signature) {
      ui.resultsSignature = signature;
      ui.results.replaceChildren(...buildResults(run, status));
    }
  } else if (ui.resultsSignature !== null) {
    ui.resultsSignature = null;
    ui.results.replaceChildren();
  }
  restoreFocus(key);
  if (!terminal && status && !clockTimer) {
    clockTimer = setInterval(() => {
      if (runUI && state.run && runUI.runId === state.run.id) setText(runUI.elapsed, elapsedText(state.run));
    }, 1000);
  }
}

function patchCards(ui, run, pages) {
  const seen = new Set();
  let previous = null;
  for (const p of pages) {
    const n = int(p.page);
    seen.add(n);
    let card = ui.cards.get(n);
    if (!card) {
      card = { li: h("li", { class: "page-card" }), signature: "" };
      ui.cards.set(n, card);
    }
    const expected = previous ? previous.nextSibling : ui.grid.firstChild;
    if (card.li !== expected) ui.grid.insertBefore(card.li, expected);
    previous = card.li;
    const runState = isObj(run.status) ? str(run.status.state) : str(run.state);
    const signature = JSON.stringify([
      p.state,
      p.role,
      p.seconds,
      p.thumb,
      p.png,
      p.message,
      arr(p.warnings).length,
      p.pdfx_check || null,
      !!p.edited,
      !!p.edited_unsaved,
      !!p.needs_save,
      p.needs_save_reason || "",
      arr(p.stale).join("|"),
      runState,
      lang(),
    ]);
    if (card.signature !== signature) {
      card.signature = signature;
      fillCard(card.li, p, run, n);
    }
  }
  for (const [n, card] of ui.cards) {
    if (!seen.has(n)) {
      card.li.remove();
      ui.cards.delete(n);
    }
  }
}

function fillCard(li, p, run, n) {
  const s = PAGE_STATE_KEY[str(p.state)] ? str(p.state) : "waiting";
  li.dataset.state = s;
  const name = pageName(n, str(p.role) || pageRole(n));
  const thumbUrl = runFileUrl(run.id, p.thumb);
  const pngUrl = runFileUrl(run.id, p.png);
  const picture = thumbUrl || pngUrl;
  let thumb;
  if (picture && s === "done") {
    // the thumbnail, then (after a pause) the full-size preview, then a plain note
    const noPreview = () => h("span", { class: "small muted" }, t("run.noPreview"));
    const img = fallbackImage([thumbUrl, pngUrl], { alt: "", decoding: "async" }, (el) => el.replaceWith(noPreview()));
    thumb = h(
      "button",
      {
        type: "button",
        class: "page-thumb",
        "aria-label": t("run.openPreview", { page: name }),
        dataset: { focusKey: `thumb:${n}` },
        onclick: () => openPreview(run, n),
      },
      img || noPreview(),
    );
  } else {
    thumb = h("div", { class: "page-thumb", "aria-hidden": "true" }, String(n));
  }
  const seconds = num(p.seconds);
  const withTime = seconds !== null && (s === "working" || s === "done") ? ` · ${fmtDuration(seconds)}` : "";
  const stateIcon =
    s === "working" ? spinner() : icon(s === "done" ? "check" : s === "failed" || s === "cancelled" ? "x" : "clock");
  const check = isObj(p.pdfx_check) ? p.pdfx_check : null;
  const warnings = arr(p.warnings).filter((w) => str(w));
  fill(
    li,
    thumb,
    h("p", { class: "page-card-label" }, name),
    h("p", { class: "page-card-state" }, stateIcon, h("span", {}, `${t(PAGE_STATE_KEY[s])}${withTime}`)),
    s === "failed"
      ? h("p", { class: "page-card-msg", lang: langFor(p.message) }, str(p.message) || t("run.pageFailed"))
      : null,
    s === "done" && !picture ? h("p", { class: "page-card-msg muted" }, t("run.previewNotReady")) : null,
    warnings.length
      ? h("p", { class: "page-card-warn" }, icon("alert"), t("count.warning", { n: warnings.length }))
      : null,
    s === "done" && p.needs_save
      ? h(
          "p",
          { class: "page-card-warn", lang: langFor(p.needs_save_reason) },
          icon("alert"),
          str(p.needs_save_reason) || t("run.changedSave"),
        )
      : s === "done" && arr(p.stale).length
        ? arr(p.stale).map((why) => h("p", { class: "page-card-warn", lang: langFor(why) }, icon("alert"), str(why)))
        : s === "done" && p.edited_unsaved
          ? h("p", { class: "page-card-warn" }, icon("alert"), t("run.changedUnsaved"))
          : null,
    s === "done" && (isObj(run.status) ? str(run.status.state) : str(run.state)) === "done"
      ? h(
          "a",
          {
            class: "page-card-edit",
            href: `/static/editor.html?edition=${encodeURIComponent(state.editionId)}&run=${encodeURIComponent(run.id)}&page=${n}`,
          },
          p.edited ? t("run.editPageEdited") : t("run.editPage"),
        )
      : null,
    s === "done" && check
      ? check.passed
        ? h("p", { class: "page-card-check" }, icon("check"), t("run.checkPassed"))
        : h(
            "p",
            { class: "page-card-warn" },
            icon("alert"),
            check.fails ? t("run.checkProblems", { n: count(check.fails) }) : t("run.checkNotRun"),
          )
      : null,
  );
}

/** Did every page of a finished run pass the independent PDF/X-1a check, with no page changed since its file? */
/** A change (made here, or in a page editor of this layout) that the selected layout's status has not been checked
 * against yet. */
const rechecking = () => {
  const run = state.run;
  return !!run && !run.gone && (run.changes || 0) > (run.checked || 0);
};

const deskChannel = "BroadcastChannel" in window ? new BroadcastChannel("pageinator-desk") : null;

/** The edition or a layout of it changed: the selected layout's press files are checked again at once. */
function layoutChanged() {
  const run = state.run;
  if (!run || run.stopped) return;
  run.changes = (run.changes || 0) + 1;
  renderRunBits(); // "Checking…" at once, even while an answer asked for before the change is on its way
  pollRun(run);
}

/** The other Desk windows check again whatever layout of this edition they show (a change is edition-wide). */
function tellOthers(edition) {
  try {
    if (deskChannel) deskChannel.postMessage({ edition });
  } catch {
    // they ask the server themselves every few seconds
  }
}
const CHECKING = "checking"; // pressNotReady: the press files are being checked against a change just made

function allChecked(status) {
  if (rechecking() || (state.run && state.run.gone) || status.press_ready !== true) return false; // the server's verdict
  const pages = arr(status.pages).filter((p) => isObj(p) && p.state === "done");
  return pages.length > 0 && pages.every((p) => isObj(p.pdfx_check) && p.pdfx_check.passed === true);
}

/** Why the press files are not current (pages edited and not saved, pages not passing the check), or null. */
function pressNotReady(status) {
  const s = str(status.state);
  if (!TERMINAL.has(s)) return null; // while laying out, pages are unchecked
  if (s !== "done") return t("press.notFinished");
  if (state.run && state.run.gone) return t("press.gone");
  if (rechecking()) return CHECKING;
  if (status.press_ready === true) return null;
  const toSave = arr(status.pages_to_save)
    .map(int)
    .filter((n) => n !== null);
  const failing = arr(status.pages_failing_check)
    .map(int)
    .filter((n) => n !== null);
  const parts = [];
  // a layout that no longer fits the edition (made by an older Desk, another page count): saving pages cannot help
  const relayout = arr(status.pages).some(
    (p) => isObj(p) && arr(p.stale).some((why) => /lay the edition out again/i.test(str(why))),
  );
  if (relayout) parts.push(t("press.relayout"));
  else if (toSave.length) parts.push(t("press.toSave", { n: toSave.length, pages: toSave.join(", ") }));
  if (failing.length) parts.push(t("press.failing", { n: failing.length, pages: failing.join(", ") }));
  const twice = arr(status.pages_with_repeats)
    .map(int)
    .filter((n) => n !== null);
  if (twice.length) parts.push(t("press.repeats", { n: twice.length, pages: twice.join(", ") }));
  const over = arr(status.pages_with_overlaps)
    .map(int)
    .filter((n) => n !== null);
  if (over.length) parts.push(t("press.overlaps", { n: over.length, pages: over.join(", ") }));
  const failed = arr(status.pages)
    .filter((p) => isObj(p) && str(p.state) === "failed")
    .map((p) => int(p.page));
  if (failed.length) parts.push(t("press.failed", { n: failed.length, pages: failed.join(", ") }));
  return parts.length ? parts.join("; ") : t("press.notAll");
}

function headlineFor(id) {
  const a = state.detail ? state.detail.articles.find((x) => x.id === id) : null;
  return a ? clip(a.headline, 160) || t("arts.noHeadline") : null;
}

function fmtSeconds(value) {
  const s = num(value);
  if (s === null || s < 0) return null;
  if (s < 10) return t("fmt.sec", { n: s.toFixed(1) });
  if (s < 120) return t("fmt.sec", { n: Math.round(s) });
  return fmtDuration(s);
}

/** "Measured in 86 s · planned in 0.2 s · laid out in 41 s", from the run's timings (whichever are given). */
function timingsLine(status) {
  const timings = isObj(status.timings) ? status.timings : null;
  if (!timings) return null;
  const parts = [
    ["res.measured", timings.measure_s],
    ["res.planned", timings.plan_s],
    ["res.laidOut", timings.layout_s],
  ]
    .map(([key, value]) => (fmtSeconds(value) ? t(key, { time: fmtSeconds(value) }) : null))
    .filter(Boolean);
  if (!parts.length) return null;
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return h("p", { class: "run-timings" }, parts.join(" · "));
}

function articleWarningList(texts) {
  return h(
    "ul",
    { class: "article-warnings", "aria-label": t("res.articleWarnings") },
    texts.map((w) => h("li", {}, icon("alert"), h("span", { lang: langFor(w) }, w))),
  );
}

function buildResults(run, status) {
  const out = [];
  const s = str(status.state);
  const pages = arr(status.pages)
    .filter((p) => isObj(p) && int(p.page) !== null)
    .sort((a, b) => int(a.page) - int(b.page));
  const editionId = state.editionId;
  const pdfPages = pages.filter((p) => safeFile(p.pdf));
  const warnMap = articleWarningsOf(status);
  const shownWarnings = new Set();
  const timings = timingsLine(status);
  if (timings) out.push(timings);

  if (s === "done" || pdfPages.length) {
    const editionPdf = runFileUrl(run.id, status.edition_pdf);
    const zip = runFileUrl(run.id, status.zip);
    const download = (url, file, title, sub, missing) =>
      url
        ? h(
            "a",
            { class: "download", href: url, download: `${editionId}-${file}` },
            icon("download"),
            h("span", { class: "download-title" }, title),
            h("span", { class: "download-sub" }, sub),
          )
        : h("div", { class: "download-missing" }, icon("clock"), missing);
    const links = pdfPages.map((p) =>
      h(
        "a",
        {
          class: "btn btn-small",
          href: runFileUrl(run.id, p.pdf),
          download: `${editionId}-${safeFile(p.pdf)}`,
          "aria-label": t("res.pagePdf", { page: pageName(int(p.page), str(p.role)) }),
        },
        String(int(p.page)),
      ),
    );
    out.push(
      h(
        "section",
        { class: "results-block", "aria-labelledby": "downloads-title" },
        h("h3", { id: "downloads-title" }, t("res.downloads")),
        pressNotReady(status)
          ? h(
              "div",
              { class: "press-not-ready", role: "alert" },
              icon("alert"),
              h(
                "p",
                {},
                h("strong", {}, `${t("res.doNotSend")} `),
                pressNotReady(status) === CHECKING
                  ? t("res.checking")
                  : t("res.mismatch", { reasons: pressNotReady(status) }),
              ),
            )
          : null,
        h(
          "div",
          { class: "downloads" },
          download(
            editionPdf,
            safeFile(status.edition_pdf) || "edition.pdf",
            t("res.editionPdf"),
            t("res.editionPdfSub"),
            t("res.editionPdfMissing"),
          ),
          download(
            zip,
            safeFile(status.zip) || "press-files.zip",
            t("res.press"),
            allChecked(status)
              ? t("res.pressChecked")
              : pressNotReady(status)
                ? t("res.pressNotCurrent")
                : t("res.pressSeeChecks"),
            t("res.pressMissing"),
          ),
        ),
        links.length
          ? h("div", { class: "page-links" }, h("span", { class: "page-links-label" }, t("res.singlePages")), links)
          : null,
        h("div", { class: "honesty", role: "note" }, icon("alert"), h("p", {}, t("res.honesty"))),
      ),
    );
  }

  if (pages.length) {
    const report = h("ol", { class: "report" });
    for (const p of pages) {
      const n = int(p.page);
      const pageState = str(p.state);
      const ids = arr(p.articles).filter((id) => typeof id === "string");
      const seconds = num(p.seconds);
      const warnings = arr(p.warnings)
        .map((w) => str(w))
        .filter(Boolean);
      report.append(
        h(
          "li",
          { class: "report-page" },
          h(
            "h4",
            {},
            pageName(n, str(p.role)),
            h(
              "span",
              { class: "muted" },
              [t("count.article", { n: ids.length }), seconds !== null ? fmtDuration(seconds) : null]
                .filter(Boolean)
                .join(" · "),
            ),
          ),
          pageState === "failed"
            ? h(
                "p",
                { class: "report-failed" },
                icon("x"),
                h("span", {}, str(p.message) ? tn("res.failedWhy", { reason: foreign(p.message) }) : t("res.failed")),
              )
            : null,
          ids.length
            ? h(
                "ul",
                { class: "report-articles" },
                ids.map((id) => {
                  const headline = headlineFor(id);
                  const notes = warnMap.get(id) || [];
                  if (notes.length) shownWarnings.add(id);
                  return h(
                    "li",
                    {},
                    h(
                      "span",
                      { lang: headline ? langFor(headline) : null, class: headline ? null : "muted" },
                      headline || t("res.goneArticle"),
                    ),
                    notes.length ? articleWarningList(notes) : null,
                  );
                }),
              )
            : pageState === "failed"
              ? null
              : h("p", { class: "muted small" }, t("res.noArticles")),
          warnings.length
            ? h(
                "ul",
                { class: "report-warnings", "aria-label": t("res.warnings") },
                warnings.map((w) => h("li", {}, icon("alert"), h("span", { lang: langFor(w) }, w))),
              )
            : null,
        ),
      );
    }
    out.push(
      h(
        "section",
        { class: "results-block", "aria-labelledby": "report-title" },
        h("h3", { id: "report-title" }, t("res.report")),
        report,
      ),
    );
  }

  const notPlaced = arr(status.not_placed).filter((x) => isObj(x) && typeof x.article === "string");
  if (s === "done" || notPlaced.length) {
    const block = h(
      "section",
      { class: "results-block", "aria-labelledby": "notplaced-title" },
      h(
        "h3",
        { id: "notplaced-title" },
        notPlaced.length ? t("res.notPlacedN", { n: notPlaced.length }) : t("res.notPlaced"),
      ),
    );
    if (!notPlaced.length) {
      block.append(h("p", { class: "all-placed" }, icon("check"), t("res.allPlaced")));
    } else {
      const list = h("ul", { class: "not-placed" });
      for (const item of notPlaced) {
        const article = state.detail ? state.detail.articles.find((a) => a.id === item.article) : null;
        const headline = article ? clip(article.headline, 200) || t("arts.noHeadline") : null;
        const reason = str(item.reason);
        const notes = warnMap.get(item.article) || [];
        if (notes.length) shownWarnings.add(item.article);
        list.append(
          h(
            "li",
            { class: "not-placed-item" },
            h(
              "div",
              {},
              h(
                "p",
                { class: "not-placed-head", lang: headline ? langFor(headline) : null },
                headline || t("res.goneArticle"),
              ),
              h(
                "p",
                { class: "not-placed-reason" },
                icon("alert"),
                h("span", { lang: langFor(reason) }, reason || t("res.noReason")),
              ),
              h("p", { class: "not-placed-hint" }, notPlacedHint(reason)),
              notes.length ? articleWarningList(notes) : null,
            ),
            article
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "btn btn-small",
                    "aria-label": t("arts.editAria", { headline: clip(headline, 80) }),
                    dataset: { focusKey: `np:edit:${article.id}` },
                    onclick: () => openArticleEditor(article),
                  },
                  t("common.edit"),
                )
              : null,
          ),
        );
      }
      block.append(list);
    }
    out.push(block);
  }

  // warnings about articles that appear on no page and in no "not placed" entry
  const rest = [...warnMap].filter(([id]) => !shownWarnings.has(id));
  if (rest.length) {
    out.push(
      h(
        "section",
        { class: "results-block", "aria-labelledby": "notes-title" },
        h("h3", { id: "notes-title" }, t("res.otherWarnings")),
        h(
          "ul",
          { class: "report-articles report-other" },
          rest.map(([id, notes]) => {
            const headline = headlineFor(id);
            return h(
              "li",
              {},
              h(
                "span",
                { lang: headline ? langFor(headline) : null, class: headline ? null : "muted" },
                headline || t("res.goneArticle"),
              ),
              articleWarningList(notes),
            );
          }),
        ),
      ),
    );
  }
  return out;
}

function runHistory() {
  const runs = state.detail.runs;
  const section = h(
    "section",
    { class: "card", "aria-labelledby": "history-title" },
    h("h2", { class: "card-title", id: "history-title" }, t("hist.title")),
  );
  if (!runs.length) {
    section.append(h("p", { class: "muted" }, t("hist.none")));
    return section;
  }
  const list = h("ol", { class: "history-list" });
  for (const r of runs) {
    const current = !!state.run && state.run.id === r.id;
    const when = friendlyTime(runStartTime(r)) || r.id;
    const s = str(r.state);
    const tone = s === "done" ? "ok" : s === "failed" ? "bad" : s === "cancelled" ? "muted" : "busy";
    const stateIcon = tone === "ok" ? icon("check") : tone === "busy" ? icon("clock") : icon("x");
    list.append(
      h(
        "li",
        { class: current ? "history-item is-current" : "history-item", "aria-current": current ? "true" : null },
        h("span", { class: "history-when" }, when),
        h("span", { class: "history-state", dataset: { tone } }, stateIcon, runStateLabel(s) || s || t("hist.unknown")),
        current
          ? h("span", { class: "history-current" }, t("hist.shown"))
          : h(
              "button",
              {
                type: "button",
                class: "btn btn-small",
                "aria-label": t("hist.openAria", { time: when }),
                dataset: { focusKey: `run:open:${r.id}` },
                onclick: () => {
                  state.runStartError = "";
                  selectRun(r.id);
                  const title = $("#run-title");
                  if (title) title.scrollIntoView({ block: "start" });
                },
              },
              t("common.open"),
            ),
      ),
    );
  }
  section.append(list);
  return section;
}

async function cancelRun() {
  const run = state.run;
  if (!run) return;
  const ok = await confirmDialog({
    title: t("run.cancelTitle"),
    message: t("run.cancelMessage"),
    confirm: t("run.cancel"),
    cancel: t("run.keepGoing"),
    danger: true,
  });
  if (!ok || state.run !== run) return;
  try {
    await api("POST", apiPath(state.editionId, "runs", run.id, "cancel"), { json: {} });
    toast(t("run.cancelling"), "info");
    pollRun(run);
  } catch (err) {
    run.error = errMsg(err);
    patchRun();
  }
}

// ===================================================================== page preview

const preview = { run: null, pages: [], index: 0 };

function openPreview(run, pageNumber) {
  const pages = arr(run.status && run.status.pages)
    .filter((p) => isObj(p) && int(p.page) !== null && (safeFile(p.png) || safeFile(p.thumb)))
    .sort((a, b) => int(a.page) - int(b.page));
  if (!pages.length) return;
  preview.run = run;
  preview.pages = pages;
  preview.index = Math.max(
    0,
    pages.findIndex((p) => int(p.page) === pageNumber),
  );
  renderPreview();
  $("#dlg-preview").showModal();
  $("#preview-close").focus();
}

function renderPreview() {
  const p = preview.pages[preview.index];
  if (!p) return;
  const n = int(p.page);
  const name = pageName(n, str(p.role));
  setText($("#preview-title"), t("prev.title", { page: name, i: preview.index + 1, total: preview.pages.length }));
  const img = $("#preview-img");
  img.alt = t("prev.alt", { page: name });
  img.hidden = false;
  $("#preview-missing").hidden = true;
  img.src = runFileUrl(preview.run.id, p.png) || runFileUrl(preview.run.id, p.thumb) || "";
  $("#preview-prev").disabled = preview.index === 0;
  $("#preview-next").disabled = preview.index >= preview.pages.length - 1;
  const pdf = runFileUrl(preview.run.id, p.pdf);
  const link = $("#preview-pdf");
  link.hidden = !pdf;
  if (pdf) {
    link.href = pdf;
    link.setAttribute("download", `${state.editionId}-${safeFile(p.pdf)}`);
  }
  const body = $("#preview-body");
  body.scrollTop = 0;
  body.scrollLeft = 0;
  const active = document.activeElement;
  if (active && active.disabled) (preview.index === 0 ? $("#preview-next") : $("#preview-prev")).focus();
}

function movePreview(delta) {
  const next = preview.index + delta;
  if (next < 0 || next >= preview.pages.length) return;
  preview.index = next;
  renderPreview();
}

// ===================================================================== confirm dialog

let confirmResolve = null;

function confirmDialog({ title, message, confirm = t("common.ok"), cancel = t("common.cancel"), danger = false }) {
  const dlg = $("#dlg-confirm");
  if (confirmResolve) settleConfirm(false);
  setText($("#confirm-title"), title);
  setText($("#confirm-message"), message);
  const ok = $("#confirm-ok");
  ok.textContent = confirm;
  ok.className = danger ? "btn btn-danger" : "btn btn-primary";
  setText($("#confirm-cancel"), cancel);
  return new Promise((resolve) => {
    confirmResolve = resolve;
    dlg.showModal();
    $("#confirm-cancel").focus();
  });
}

function settleConfirm(value) {
  const resolve = confirmResolve;
  confirmResolve = null;
  const dlg = $("#dlg-confirm");
  if (dlg.open) dlg.close();
  if (resolve) resolve(value);
}

// ===================================================================== new edition dialog

let needsPreviewSeq = 0;

function openNewEdition() {
  const form = $("#form-new");
  form.reset();
  const f = form.elements;
  f.date.value = localDay(1);
  const latest = state.editions[0];
  const pages = int(latest && latest.pages);
  const defaultPages = pages === 4 || pages === 16 ? pages : 8;
  for (const radio of $$("#form-new input[name='pages']")) radio.checked = radio.value === String(defaultPages);
  f.back_page_ads.checked = true;
  const open = state.detail ? state.detail.edition : null;
  if (open) {
    f.volume.value = str(open.volume);
    f.price.value = str(open.price);
  }
  setText($("#new-issue-note"), open && str(open.issue) ? t("new.lastIssue", { issue: str(open.issue) }) : "");
  setFieldError("new-date", "");
  showAlert($("#new-alert"), "");
  $("#new-submit").disabled = false;
  updateNewEditionNotes();
  $("#dlg-new").showModal();
  f.date.focus();
}

function updateNewEditionNotes() {
  const f = $("#form-new").elements;
  const date = f.date.value;
  const taken = state.editions.some((e) => str(e.date) === date);
  setText(
    $("#new-date-note"),
    taken ? t("new.dateTaken", { date: friendlyDate(date) }) : parseDay(date) ? friendlyDate(date) : "",
  );
  refreshNeedsPreview();
}

const refreshNeedsPreview = debounce(async () => {
  const f = $("#form-new").elements;
  const pages = Number(f.pages.value) || 8;
  const backAds = f.back_page_ads.checked ? 1 : 0;
  const out = $("#new-needs");
  const seq = ++needsPreviewSeq;
  try {
    const plan = await api("GET", `/api/plan?pages=${pages}&back_ads=${backAds}`);
    if (seq !== needsPreviewSeq) return;
    const n = isObj(plan.needs) ? plan.needs : null;
    if (!n || num(n.stories) === null) {
      out.replaceChildren();
      return;
    }
    const parts = [
      t("count.story", { n: count(n.stories) }),
      num(n.briefs) ? t("count.brief", { n: count(n.briefs) }) : null,
      num(n.photos) !== null ? t("count.photo", { n: count(n.photos) }) : null,
      num(n.words) !== null ? t("count.word", { n: count(n.words) }) : null,
    ].filter(Boolean);
    out.replaceChildren(
      ...tn("new.needs", { lead: h("strong", {}, t("new.needsLead", { n: pages })), list: parts.join(", ") }),
    );
  } catch {
    if (seq === needsPreviewSeq) out.replaceChildren();
  }
}, 200);

async function submitNewEdition(e) {
  e.preventDefault();
  const f = $("#form-new").elements;
  const date = f.date.value;
  if (!parseDay(date)) {
    setFieldError("new-date", t("ed.chooseDate"));
    f.date.focus();
    return;
  }
  setFieldError("new-date", "");
  const body = {
    date,
    pages: Number(f.pages.value) || 8,
    back_page_ads: f.back_page_ads.checked,
    volume: f.volume.value,
    issue: f.issue.value,
    price: f.price.value,
  };
  const submit = $("#new-submit");
  submit.disabled = true;
  submit.replaceChildren(spinner(), t("new.creating"));
  showAlert($("#new-alert"), "");
  try {
    const res = await api("POST", "/api/editions", { json: body });
    const edition = isObj(res.edition) ? res.edition : res;
    const id = str(edition.id);
    $("#dlg-new").close();
    toast(t("new.created", { date: friendlyDate(date) }));
    try {
      await reloadEditionsList();
    } catch {
      // the list is reloaded again when the edition opens
    }
    if (id) await openEdition(id, { step: "articles" });
    else await loadEditionsAndOpen();
  } catch (err) {
    showAlert($("#new-alert"), err.message);
  } finally {
    submit.disabled = false;
    submit.replaceChildren(t("new.create"));
  }
}

// ===================================================================== the language shown (English or Marathi)

// static elements carry their key: data-t (their text) and data-t-<attribute> (an attribute's value)
const TRANSLATED_ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"];

/** Puts the language shown into the page's static parts (index.html) and its language switch. */
function applyLang() {
  document.documentElement.lang = lang();
  for (const el of $$("[data-t]")) setText(el, t(el.dataset.t));
  for (const name of TRANSLATED_ATTRIBUTES) {
    for (const el of $$(`[data-t-${name}]`)) el.setAttribute(name, t(el.getAttribute(`data-t-${name}`)));
  }
  for (const label of $$("[data-folio]")) fill(label, folioLabel(label.dataset.folio));
  fill($("#paste-help-1"), tn("paste.help1", { code: h("code", {}, "---") }));
  fill($("#paste-help-3"), tn("paste.help3", { code: h("code", {}, `${t("paste.byline")} …`) }));
  for (const radio of $$("#lang-switch input[name='lang']")) radio.checked = radio.value === lang();
}

/**
 * Shows the screen in another language without a reload. What is being typed stays: the edition's settings live in
 * state.editionDraft, the search in state.query (its pause is cut short), and the dialogs, where text is typed, are
 * modal (the switch cannot be reached while one is open) and fill their words in when they open.
 */
function changeLang(value, { save = true } = {}) {
  if (!LANGS.includes(value) || value === lang()) {
    applyLang();
    return;
  }
  if (searchTyped) searchTyped.flush();
  setLang(value);
  if (save) saveLang(value);
  applyLang();
  renderStatus();
  renderAll();
}

// ===================================================================== wiring

function wireStatic() {
  for (const slot of $$("[data-icon]")) slot.replaceWith(icon(slot.dataset.icon));

  const topbar = $("#topbar");
  const syncTopbar = () => document.documentElement.style.setProperty("--pg-topbar-h", `${topbar.offsetHeight}px`);
  if (typeof ResizeObserver === "function") new ResizeObserver(syncTopbar).observe(topbar);
  syncTopbar();

  $("#edition-select").addEventListener("change", (e) => {
    const id = e.currentTarget.value;
    if (id && id !== state.editionId) openEdition(id);
  });
  $("#btn-new-edition").addEventListener("click", openNewEdition);
  for (const button of $$(".step")) button.addEventListener("click", () => goStep(button.dataset.step));
  for (const radio of $$("#lang-switch input[name='lang']")) {
    radio.addEventListener("change", () => {
      if (radio.checked) changeLang(radio.value);
    });
  }
  // another Desk window or tab chose a language: this one follows
  window.addEventListener("storage", (e) => {
    if (e.key === LANG_STORE_KEY) changeLang(savedLang(), { save: false });
  });

  const engine = $("#engine");
  engine.addEventListener("toggle", () => {
    if (engine.open) refreshStatus();
  });
  engine.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && engine.open) {
      engine.open = false;
      $("summary", engine).focus();
    }
  });
  document.addEventListener("click", (e) => {
    if (engine.open && !engine.contains(e.target)) engine.open = false;
  });

  for (const button of $$("[data-close]")) {
    button.addEventListener("click", () => button.closest("dialog").close());
  }

  // new edition
  const newForm = $("#form-new");
  newForm.addEventListener("submit", submitNewEdition);
  newForm.addEventListener("input", updateNewEditionNotes);
  newForm.addEventListener("change", updateNewEditionNotes);
  newForm.elements.date.addEventListener("input", () => {
    if (parseDay(newForm.elements.date.value)) setFieldError("new-date", "");
  });

  // article editor
  const articleForm = $("#form-article");
  articleForm.addEventListener("submit", saveArticle);
  articleForm.elements.body.addEventListener("input", updateEditorWords);
  for (const id of ["article-headline", "article-body"]) {
    $(`#${id}`).addEventListener("input", (e) => {
      if (e.currentTarget.value.trim()) setFieldError(id, "");
    });
  }
  articleForm.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      articleForm.requestSubmit();
    }
  });
  $("#article-photo").addEventListener("change", onPhotoChosen);
  $("#article-photo-remove").addEventListener("click", () => {
    if (editor.file) clearEditorFile();
    if (editor.article && hasPhoto(editor.article)) editor.removePhoto = true;
    renderEditorPhoto();
    updateEditorWords();
    $("#article-photo").focus();
  });
  $("#article-cancel").addEventListener("click", cancelEditor);
  $("#article-delete").addEventListener("click", deleteFromEditor);
  const articleDialog = $("#dlg-article");
  articleDialog.addEventListener("cancel", (e) => {
    if (editor.busy || isEditorDirty()) {
      e.preventDefault();
      if (!editor.busy) cancelEditor();
    }
  });
  articleDialog.addEventListener("close", clearEditorFile);

  // paste
  $("#form-paste").addEventListener("submit", submitPaste);
  $("#paste-text").addEventListener("input", debounce(updatePasteCount, 150));
  $("#paste-cancel").addEventListener("click", () => $("#dlg-paste").close());

  // import
  $("#form-import").addEventListener("submit", submitImport);
  $("#import-cancel").addEventListener("click", () => {
    if (!importBusy) $("#dlg-import").close();
  });
  $("#dlg-import").addEventListener("cancel", (e) => {
    if (importBusy) e.preventDefault();
  });

  // confirm
  $("#form-confirm").addEventListener("submit", (e) => {
    e.preventDefault();
    settleConfirm(true);
  });
  $("#confirm-cancel").addEventListener("click", () => settleConfirm(false));
  $("#dlg-confirm").addEventListener("close", () => settleConfirm(false));

  // preview
  const previewDialog = $("#dlg-preview");
  const previewImage = $("#preview-img");
  previewImage.addEventListener("error", () => {
    previewImage.hidden = true;
    $("#preview-missing").hidden = false;
  });
  previewImage.addEventListener("load", () => {
    previewImage.hidden = false;
    $("#preview-missing").hidden = true;
  });
  $("#preview-prev").addEventListener("click", () => movePreview(-1));
  $("#preview-next").addEventListener("click", () => movePreview(1));
  $("#preview-close").addEventListener("click", () => previewDialog.close());
  for (const radio of $$("#dlg-preview input[name='zoom']")) {
    radio.addEventListener("change", () => {
      const body = $("#preview-body");
      body.classList.toggle("zoom-fit", radio.value === "fit" && radio.checked);
      body.classList.toggle("zoom-actual", radio.value === "actual" && radio.checked);
    });
  }
  previewDialog.addEventListener("keydown", (e) => {
    if (e.target && e.target.type === "radio") return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      movePreview(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      movePreview(-1);
    }
  });
  previewDialog.addEventListener("click", (e) => {
    if (e.target === previewDialog) previewDialog.close();
  });

  // keep the page honest when the window comes back
  const lookAgain = () => {
    refreshStatus();
    if (state.run && !state.run.stopped) pollRun(state.run); // also a finished one: its pages may have been edited
  };
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lookAgain();
  });
  if (deskChannel) {
    // a page editor or another Desk window changed this edition or a layout of it: any layout shown is checked
    deskChannel.onmessage = (e) => {
      const m = isObj(e.data) ? e.data : {};
      if (state.run && m.edition === state.editionId) layoutChanged();
    };
  }
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) lookAgain();
  });
  window.addEventListener("beforeunload", (e) => {
    const pasting = $("#dlg-paste") && $("#dlg-paste").open && $("#paste-text").value.trim() !== "";
    if (isEditorDirty() || importBusy || pasting) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
}

function init() {
  setLang(savedLang());
  applyLang();
  wireStatic();
  renderAll();
  renderStatus(); // "Checking the engine…" from the first paint, until /api/status answers
  refreshStatus();
  loadEditionsAndOpen();
}

init();
