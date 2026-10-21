// Pageinator Desk: the browser UI (tools/desk/static/app.js).
//
// The binding contract is tools/desk/CONTRACT.md. Plain JavaScript, no build step, no network beyond the local Desk
// server. Everything that comes from the server or from the keyboard goes into the page through textContent and
// attributes (the h() helper below), never through innerHTML.

// ===================================================================== constants

const STEPS = ["edition", "articles", "ads", "run"];
const PRIORITY_LABEL = { 1: "Lead", 2: "Top", 3: "Normal", 4: "Minor" };
const ROLE_LABEL = { front: "Front", inside: "Inside", back: "Back" };
const RUN_STATE_LABEL = {
  queued: "Waiting to start",
  starting: "Starting",
  planning: "Planning the pages",
  layout: "Laying out pages",
  finishing: "Making the PDFs and previews",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
const PAGE_STATE_LABEL = {
  waiting: "Waiting",
  working: "Laying out",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};
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
const OFFLINE_MESSAGE = "Can't reach the Desk server. Check that it is still running on this Mac, then try again.";
const RUN_TIME_NOTE = "Laying out pages in parallel — usually 1 to 4 minutes.";
const MEASURE_POLL_MS = 3000;
const HONESTY_NOTE =
  "Every page PDF is written as PDF/X-1a and then checked by an independent PDF/X-1a checker (the result is on each " +
  "page above). The press has accepted a text-only test page from this writer; pages with photos or ads have not " +
  "been press-tested yet — print one test page before a real edition.";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEVANAGARI = /\p{Script=Devanagari}/u;

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

function plural(n, one, many) {
  return `${fmtInt(n)} ${n === 1 ? one : many || `${one}s`}`;
}

function fmtMm(v) {
  const n = num(v);
  if (n === null) return "?";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function fmtBytes(bytes) {
  const b = num(bytes, 0);
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  if (b >= 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} bytes`;
}

function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(num(seconds, 0)));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${pad2(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${pad2(m % 60)} min`;
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
  if (!p) return str(value) || "Undated";
  return `${WEEKDAYS[p.wd]} ${p.d} ${MONTHS[p.mo - 1]}${withYear ? ` ${p.y}` : ""}`;
}

function timeOf(value) {
  const t = Date.parse(str(value));
  return Number.isFinite(t) ? t : null;
}

function friendlyTime(t) {
  if (t === null || t === undefined) return "";
  const d = new Date(t);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
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

function langFor(text) {
  return DEVANAGARI.test(str(text)) ? "mr" : null;
}

function fold(text) {
  return str(text).normalize("NFC").toLowerCase();
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
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
    h("span", {}, message),
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
    h("div", { class: "notice-body" }, h("p", {}, message), extra),
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
    h("span", {}, message),
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
  constructor(message, status = 0) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

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
    throw new ApiError(OFFLINE_MESSAGE, 0);
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
    const message =
      isObj(data) && typeof data.error === "string" && data.error.trim()
        ? data.error.trim()
        : `The Desk server could not do that (HTTP ${response.status}).`;
    throw new ApiError(message, response.status);
  }
  if (!isObj(data)) throw new ApiError("The Desk server sent an answer this page cannot read.", response.status);
  return data;
}

function seg(value) {
  const s = str(value);
  if (!s || s === "." || s === "..") throw new ApiError("This item has a name the Desk cannot use.");
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
  if (p && ROLE_LABEL[p.role]) return p.role;
  if (n === 1) return "front";
  return n === editionPages() && backPageAds() ? "back" : "inside";
}

function pageName(n, role) {
  const r = ROLE_LABEL[role || pageRole(n)];
  return r ? `Page ${n} · ${r}` : `Page ${n}`;
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
    return { kind: "warn", icon: "alert", text: reason ? `Not placed: ${reason}` : "Not placed" };
  }
  const hit = r.placed.get(a.id);
  const edited = r.started !== null && (timeOf(a.updated) ?? 0) > r.started + 1000;
  if (hit) {
    if (hit.failed) return { kind: "bad", icon: "x", text: `Page ${hit.page} failed in the last layout`, edited };
    return { kind: "ok", icon: "check", text: `Placed on page ${hit.page}`, edited };
  }
  const created = timeOf(a.created);
  if (created !== null && r.started !== null && created > r.started) {
    return { kind: "muted", icon: "info", text: "Added after the last layout" };
  }
  return { kind: "muted", icon: "info", text: "Not in the last layout's report" };
}

function notPlacedHint(reason) {
  const r = fold(reason);
  if (/deleted from the edition/.test(r)) return "Nothing to do: it was deleted on purpose.";
  if (/taken off the pages in the editor/.test(r))
    return "Bring it back onto a page in the page editor, if it must go in.";
  if (/(long|space|fit|room|overflow|big|area|short of)/.test(r)) {
    return "Too long for the space left — shorten it, pin it to another page, or add pages.";
  }
  if (/(pin|pinned)/.test(r)) return "The page it is pinned to is full — pin it to another page, or set it to Auto.";
  if (/(photo|image|picture)/.test(r)) return "Check its photo — try another one, or remove it.";
  if (/(priority|minor)/.test(r)) return "Raise its priority if it must go in.";
  return "Shorten it, raise its priority, pin it to another page, or add pages.";
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
  if (s.offline) return OFFLINE_MESSAGE;
  if (s.engine_ok === false || s.config_ok === false) {
    return `The layout engine needs setup first: ${str(s.message) || "see the engine status at the top right."}`;
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
  let label = "Checking the engine…";
  let message = "";
  if (s && s.offline) {
    kind = "bad";
    label = "Offline";
    message = OFFLINE_MESSAGE;
  } else if (s) {
    if (s.engine_ok === true && s.config_ok === true && s.icc_ok === false) {
      // layout works, but photos and ads cannot be converted for print yet (the server says why)
      kind = "warn";
      label = "Partly ready";
      message = str(s.message) || "Photos and ads cannot be converted for print until the colour profile is set up.";
    } else if (s.engine_ok === true && s.config_ok === true) {
      kind = "ok";
      label = "Engine ready";
      message = str(s.message);
    } else {
      kind = "warn";
      label = "Setup needed";
      message = str(s.message) || "The layout engine is not set up yet.";
    }
  }
  const box = $("#engine");
  box.dataset.kind = kind;
  setText($("#engine-label"), label);
  setText($("#engine-short"), kind === "warn" ? message : "");
  const iconName = { ok: "check", warn: "alert", bad: "x" }[kind] || "clock";
  $("#engine-icon").replaceChildren(icon(iconName));
  const parts = [];
  if (message) parts.push(h("p", { class: "status-message" }, message));
  if (s && !s.offline) {
    const facts = h("dl", { class: "status-facts" });
    const fact = (term, value) => {
      if (value) facts.append(h("dt", {}, term), h("dd", {}, value));
    };
    fact("Layout engine", s.engine_ok === true ? "found" : s.engine_ok === false ? "not found" : "");
    fact("Engine setup", s.config_ok === true ? "done" : s.config_ok === false ? "not done yet" : "");
    fact("Colour profile", s.icc_ok === true ? "found" : s.icc_ok === false ? "missing (photos and ads)" : "");
    fact("Processor cores", num(s.cores) ? `${s.cores} (pages are laid out in parallel)` : "");
    fact("Desk home", str(s.home));
    fact("Version", str(s.version));
    if (facts.children.length) parts.push(facts);
  }
  parts.push(h("button", { type: "button", class: "btn btn-small", onclick: () => refreshStatus() }, "Check again"));
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
    state.loadError = err.message;
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
    state.detailError = err.message;
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
    if (!options.quiet) toast(`Could not reload the edition: ${err.message}`, "error");
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
  return done !== null && total
    ? `Measuring stories for layout: ${fmtInt(done)} of ${fmtInt(total)}`
    : "Measuring stories for layout…";
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
  return [friendlyDate(str(e.date) || e.id), pages ? `${pages} pages` : null, m ? `#${m[1]}` : null]
    .filter(Boolean)
    .join(" · ");
}

function renderPicker() {
  const select = $("#edition-select");
  const options = [];
  if (!state.editionsLoaded) options.push(h("option", { value: "" }, "Loading…"));
  else if (state.loadError) options.push(h("option", { value: "" }, "Not available"));
  else if (!state.editions.length) options.push(h("option", { value: "" }, "No editions yet"));
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
  let run = "Not laid out yet";
  let tone = "";
  const r = state.run;
  if (r && isObj(r.status)) {
    const s = str(r.status.state);
    if (!TERMINAL.has(s)) {
      const pages = arr(r.status.pages).filter(isObj);
      const done = pages.filter((p) => str(p.state) === "done").length;
      run = pages.length ? `Laying out · ${done} of ${pages.length}` : RUN_STATE_LABEL[s] || "Laying out";
      tone = "busy";
    } else {
      run = s === "done" ? `Done · ${friendlyTime(runStartTime(r))}` : RUN_STATE_LABEL[s];
      tone = s === "done" ? "ok" : s === "failed" ? "bad" : "";
    }
  } else if (d.runs.length) {
    run = RUN_STATE_LABEL[str(d.runs[0].state)] || "Laid out before";
  }
  return {
    edition: { text: `${editionPages()} pages · ${friendlyDate(d.edition.date || state.editionId, false)}` },
    articles: { text: plural(d.articles.length, "article") },
    ads: { text: slots.length ? `${filled} of ${slots.length} filled` : d.plan ? "No ad spaces" : "" },
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
  setText($("#needs-sub"), `For ${editionPages()} pages${backPageAds() ? "" : " · the back page is all news"}`);
  const list = $("#needs-list");
  const needs = computeNeeds();
  const detail = $("#needs-detail");
  if (!needs) {
    list.replaceChildren(
      h("li", { class: "needs-missing" }, "Not available yet: the page plan needs the layout engine to be set up."),
    );
    detail.hidden = true;
    return;
  }
  detail.hidden = false;
  const have = computeHave(d.articles);
  list.replaceChildren(
    needRow("Stories", have.stories, needs.total.stories),
    needRow("Short items", have.briefs, needs.total.briefs),
    needRow("Photos", have.photos, needs.total.photos),
    needRow("Words", have.words, needs.total.words),
  );
  $("#needs-per-page").replaceChildren(...perPageBreakdown(needs));
}

function needRow(label, have, need) {
  const known = need !== null && need !== undefined;
  const enough = known && have >= need;
  const stateName = !known ? "unknown" : enough ? "ok" : "short";
  const pct = known && need > 0 ? Math.min(100, (have / need) * 100) : known ? 100 : 0;
  let status;
  if (!known) status = [icon("info"), h("span", {}, "No figure in the plan")];
  else if (enough) status = [icon("check"), h("span", {}, "Enough")];
  else status = [icon("alert"), h("span", {}, `Short by ${fmtInt(need - have)}`)];
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
    ["front", "Front page"],
    ["inside", "Inside pages"],
    ["back", "Back page"],
  ];
  for (const [role, label] of roles) {
    const count = needs.mult[role];
    const r = isObj(needs.per[role]) ? needs.per[role] : null;
    if (!count || !r) continue;
    const facts = [
      num(r.stories) !== null ? plural(r.stories, "story", "stories") : null,
      num(r.briefs) ? plural(r.briefs, "short item") : null,
      num(r.photos) !== null ? plural(r.photos, "photo") : null,
      num(r.words) !== null ? plural(r.words, "word") : null,
    ].filter(Boolean);
    rows.push(
      h(
        "div",
        { class: "per-role" },
        h(
          "div",
          { class: "per-role-head" },
          h("strong", {}, label),
          h("span", { class: "muted" }, `× ${count}${count > 1 ? " · each" : ""}`),
        ),
        h("p", { class: "per-role-facts" }, facts.join(" · ")),
      ),
    );
  }
  if (!backPageAds()) {
    rows.push(h("p", { class: "muted small" }, "The back page has no ads, so it counts as an inside page."));
  }
  if (!rows.length) rows.push(h("p", { class: "muted small" }, "The plan has no per-page figures."));
  return rows;
}

function renderMain() {
  const main = $("#main");
  const key = focusKeyIn(main);
  let view;
  if (!state.editionsLoaded) view = loadingView("Loading editions…");
  else if (state.loadError) view = offlineView();
  else if (!state.editions.length) view = noEditionsView();
  else if (state.detailError) view = detailErrorView();
  else if (!state.detail) view = loadingView("Opening the edition…");
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
  let title = "Pageinator Desk";
  if (state.detail) {
    title = `${friendlyDate(state.detail.edition.date || state.editionId, false)} · ${editionPages()} pages — ${title}`;
    const r = state.run;
    if (r && isObj(r.status) && !TERMINAL.has(str(r.status.state))) {
      const pages = arr(r.status.pages).filter(isObj);
      const done = pages.filter((p) => str(p.state) === "done").length;
      title = `Laying out ${done}/${pages.length || editionPages()} · ${title}`;
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
      h("h1", { id: "step-title", tabindex: "-1" }, "The Desk server is not answering"),
      h("p", {}, state.loadError || OFFLINE_MESSAGE),
      h("button", { type: "button", class: "btn btn-primary", onclick: () => loadEditionsAndOpen() }, "Try again"),
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
      h("h1", { id: "step-title", tabindex: "-1" }, "No editions yet — create today's edition"),
      h("p", {}, "An edition is one day's paper. You make it in four steps:"),
      h(
        "ol",
        { class: "empty-steps" },
        h("li", {}, "Choose the date and the number of pages."),
        h("li", {}, "Enter or paste the articles, with their photos."),
        h("li", {}, "Add the ad images."),
        h("li", {}, "Lay out the paper and download the PDFs."),
      ),
      h(
        "div",
        {},
        h(
          "button",
          { type: "button", class: "btn btn-primary", dataset: { focusKey: "empty:new" }, onclick: openNewEdition },
          icon("plus"),
          "Create an edition",
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
      h("h1", { id: "step-title", tabindex: "-1" }, "This edition could not be opened"),
      h("p", {}, state.detailError),
      h(
        "button",
        { type: "button", class: "btn btn-primary", onclick: () => openEdition(state.editionId) },
        "Try again",
      ),
    ),
  );
}

function planMissingNotice() {
  // the server's own reason (plan_error) when it gives one, else the engine status message
  const s = state.status;
  const reason = (state.detail && state.detail.planError) || (s && !s.offline ? str(s.message) : "");
  return notice("warn", `The page plan is not available yet.${reason ? ` ${reason}` : ""}`);
}

// ===================================================================== step 1: edition

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
    stepHeader("Edition", `${friendlyDate(ed.date || state.editionId)} · ${editionPages()} pages`),
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
    "Save settings",
  );
  const undoBtn = h("button", { type: "button", class: "btn", dataset: { focusKey: "edition:undo" } }, "Undo changes");
  const pagesSeg = h("div", { class: "segmented" });
  for (const n of [4, 8, 16]) {
    pagesSeg.append(
      h("input", { type: "radio", name: "pages", id: `ed-pages-${n}`, value: String(n), checked: v.pages === n }),
      h("label", { for: `ed-pages-${n}` }, String(n)),
    );
  }
  const textField = (name, mr, en) =>
    h(
      "div",
      { class: "field" },
      h("label", { for: `ed-${name}` }, h("span", { class: "deva", lang: "mr" }, mr), ` / ${en}`),
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
    h("h2", { class: "card-title", id: "settings-title" }, "Settings"),
    h("p", { class: "card-lede" }, "Changing the pages or the back-page ads changes the page plan below."),
    h(
      "div",
      { class: "settings-grid" },
      h(
        "div",
        { class: "field" },
        h("label", { for: "ed-date" }, "Date"),
        h("input", { type: "date", id: "ed-date", name: "date", required: true, value: v.date }),
        h("p", { class: "field-error", id: "ed-date-error" }),
      ),
      h("fieldset", { class: "field" }, h("legend", {}, "Pages"), pagesSeg),
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
        h("label", { for: "ed-back-ads" }, "Back page has ads"),
        h("p", { class: "field-note", id: "ed-back-ads-note" }, "Untick it when the last page is all news."),
      ),
    ),
    h(
      "div",
      { class: "field-grid three" },
      textField("volume", "वर्ष", "Volume"),
      textField("issue", "अंक", "Issue"),
      textField("price", "किंमत", "Price"),
    ),
    h(
      "p",
      { class: "field-note", style: { margin: "-6px 0 16px" } },
      "Volume, issue and price are optional. They are printed in the front-page folio where the template has a place " +
        "for them; leave a box empty to keep the template's own text.",
    ),
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
    fill(
      pinWarn,
      beyond
        ? notice(
            "warn",
            `${plural(beyond, "article is", "articles are")} pinned to a page above ${pages}. ` +
              "The Desk will place them itself; change their page in step 2 to choose one.",
          )
        : "",
    );
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
      setFieldError("ed-date", "Choose the date this edition is for.");
      form.elements.date.focus();
      return;
    }
    setFieldError("ed-date", "");
    if (!Object.keys(changes).length) return;
    saveBtn.disabled = true;
    saveBtn.replaceChildren(spinner(), "Saving…");
    showAlert(alertSlot, "");
    try {
      await api("PUT", apiPath(state.editionId), { json: changes });
      state.editionDraft = null;
      toast("Edition settings saved");
      try {
        await reloadEditionsList();
      } catch {
        // the picker keeps its old label until the next reload
      }
      await refreshDetail();
    } catch (err) {
      showAlert(alertSlot, err.message);
      saveBtn.replaceChildren("Save settings");
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
    h("h2", { class: "card-title", id: "plan-title" }, "Page plan"),
  );
  if (!state.detail.plan) {
    card.append(planMissingNotice());
    return card;
  }
  const pages = planPages();
  if (!pages.length) {
    card.append(h("p", { class: "muted" }, "The page plan lists no pages."));
    return card;
  }
  card.append(
    h(
      "p",
      { class: "card-lede" },
      "One tile per page. Hatched blocks are ad spaces, drawn at their share of the page where the sizes are known.",
    ),
  );
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
    sheet.append(h("span", { class: "plan-ads", style: { height: `${pct.toFixed(1)}%` } }, "AD"));
  }
  const meta = [`ads: ${slots.length}`];
  if (share > 0) meta.push(`about ${Math.round(share * 100)}% of the page`);
  if (pinned) meta.push(`${pinned} pinned`);
  return h(
    "li",
    { class: "plan-tile", dataset: { role } },
    sheet,
    h(
      "div",
      { class: "plan-label" },
      h("strong", {}, `Page ${n}`),
      ROLE_LABEL[role] ? h("span", { class: "muted" }, ` · ${ROLE_LABEL[role]}`) : null,
    ),
    h("div", { class: "plan-meta" }, meta.join(" · ")),
  );
}

function dangerCard(ed) {
  const alertSlot = h("div", { class: "alert-slot" });
  const button = h(
    "button",
    { type: "button", class: "btn btn-danger-quiet", dataset: { focusKey: "edition:delete" } },
    "Delete this edition",
  );
  button.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Delete this edition?",
      message:
        `The edition of ${friendlyDate(ed.date || state.editionId)} — its articles, photos, ads and layouts — moves to ` +
        "the trash folder in the Desk home and disappears from this list.",
      confirm: "Delete edition",
      danger: true,
    });
    if (!ok) return;
    try {
      await api("DELETE", apiPath(state.editionId));
      toast("Edition moved to the trash");
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
    h("h2", { class: "card-title", id: "danger-title" }, "Delete"),
    h(
      "p",
      { class: "card-lede" },
      "Moves this edition to the trash folder in the Desk home. Nothing is erased from the disk.",
    ),
    alertSlot,
    button,
  );
}

// ===================================================================== step 2: articles

function articlesLede() {
  const articles = state.detail ? state.detail.articles : [];
  if (!articles.length) return "Type, paste or import the articles for this edition.";
  const have = computeHave(articles);
  return [
    plural(have.stories, "story", "stories"),
    plural(have.briefs, "short item"),
    plural(have.photos, "photo"),
    plural(have.words, "word"),
  ].join(" · ");
}

function viewArticles() {
  const articles = state.detail.articles;
  if (state.filter === "notplaced" && !state.lastResult) state.filter = "all";
  const search = h("input", {
    type: "search",
    id: "article-search",
    placeholder: "Search headlines and text",
    autocomplete: "off",
    value: state.query,
    dataset: { focusKey: "articles:search" },
  });
  search.addEventListener(
    "input",
    debounce(() => {
      state.query = search.value;
      renderArticleList();
    }, 150),
  );
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
      "Add article",
    ),
    h(
      "button",
      { type: "button", class: "btn", dataset: { focusKey: "articles:paste" }, onclick: openPasteDialog },
      "Paste several",
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn",
        dataset: { focusKey: "articles:word" },
        title: "Add the stories of one or more Word (.docx) files",
        onclick: chooseWordFiles,
      },
      "Word files…",
    ),
    h(
      "button",
      { type: "button", class: "btn", dataset: { focusKey: "articles:import" }, onclick: openImportDialog },
      "Import a past edition (for testing)",
    ),
    h(
      "div",
      { class: "search" },
      h("label", { for: "article-search", class: "sr-only" }, "Search articles"),
      icon("search", "search-icon"),
      search,
    ),
  );
  const view = h("section", { class: "step-view", "aria-labelledby": "step-title" });
  const header = stepHeader("Articles", articlesLede());
  $(".step-lede", header).id = "articles-lede";
  view.append(header, h("div", { class: "alert-slot", id: "articles-alert" }), toolbar, wordNote(), measureLine());
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
          `Placement shown from the last finished layout${r.started !== null ? `, ${friendlyTime(r.started)}` : ""}.`,
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
    "Close",
  );
  const box = notice(
    n.kind,
    n.text,
    n.lines.length
      ? h(
          "ul",
          {},
          n.lines.map((l) => h("li", {}, l)),
        )
      : null,
    close,
  );
  box.setAttribute("role", "status");
  return box;
}

function filterControl() {
  const options = [
    ["all", "All"],
    ["photo", "With photo"],
    ["short", "Short items"],
    ["notplaced", "Not placed in last run"],
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
      h("label", { for: `filter-${value}`, title: disabled ? "Shown after the first finished layout" : null }, label),
    );
  }
  return h(
    "fieldset",
    { class: "filter" },
    h("legend", { class: "sr-only" }, "Show"),
    h("span", { class: "filter-label", "aria-hidden": "true" }, "Show"),
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
    return [a.headline, a.kicker, a.deck, a.byline, a.body].some((t) => fold(t).includes(q));
  });
}

function renderArticleList() {
  const host = $("#article-list-host");
  if (!host || !state.detail) return;
  const all = state.detail.articles;
  const key = focusKeyIn(host);
  if (!all.length) {
    host.replaceChildren(
      h(
        "div",
        { class: "card empty empty-small" },
        h("h2", {}, "No articles yet"),
        h("p", {}, "Add one with “Add article”, paste several at once, or import a past edition to try the layout."),
      ),
    );
    return;
  }
  const shown = filteredArticles();
  const count = $("#article-count");
  if (count) {
    setText(
      count,
      shown.length === all.length
        ? `${plural(all.length, "article")}, sorted by priority`
        : `Showing ${fmtInt(shown.length)} of ${plural(all.length, "article")}`,
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
          state.query.trim() ? `No articles match “${state.query.trim()}”.` : "No articles match this filter.",
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
          "Show all articles",
        ),
      ),
    );
    return;
  }
  const list = h("ul", { class: "article-list", id: "article-list", "aria-label": "Articles" });
  for (const a of shown) list.append(articleRow(a));
  host.replaceChildren(list);
  restoreFocus(key);
}

function articleThumb(a) {
  if (!hasPhoto(a)) return h("div", { class: "thumb thumb-none" }, "no photo");
  const url = photoUrl(a);
  const fallbackText = "photo · no preview";
  const img = fallbackImage([url, withoutQuery(url)], { alt: "Photo", decoding: "async" }, (el) =>
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
    warnings.length === 1 ? "Warning" : `${warnings.length} warnings`,
    h("span", { class: "sr-only" }, `: ${warnings.join("; ")}`),
  );
}

function articleRow(a) {
  const brief = isBrief(a);
  const prio = priorityOf(a);
  const pin = pinOf(a);
  const pages = editionPages();
  const headline = clip(a.headline, 400) || "(no headline)";
  const result = articleResult(a);
  const row = h("li", { class: "article-row", dataset: { id: a.id } });
  row.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, select, textarea, label")) return;
    openArticleEditor(a);
  });
  const chip = brief
    ? h(
        "span",
        { class: "chip chip-short", title: "60 words or fewer and no photo: set in the news-in-brief column" },
        "Short",
      )
    : h("span", { class: `chip chip-p${prio}` }, PRIORITY_LABEL[prio]);
  const pinLine = pin
    ? h(
        "span",
        { class: pin > pages ? "pin pin-bad" : "pin" },
        icon(pin > pages ? "alert" : "pin"),
        h("span", {}, pin > pages ? `Page ${pin} — not in this edition` : `Page ${pin}`),
      )
    : h("span", { class: "pin" }, icon("auto"), h("span", {}, "Auto"));
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
        isSample(a)
          ? h("span", { class: "chip chip-test", title: "Imported from a past edition for testing" }, "Test import")
          : null,
        warningBadge(a),
      ),
      h("h2", { class: "article-headline", lang: langFor(headline) }, headline),
      h(
        "p",
        { class: "article-meta" },
        h("span", {}, plural(wordsOf(a), "word")),
        str(a.byline).trim() ? h("span", { class: "deva", lang: langFor(a.byline) }, clip(a.byline, 60)) : null,
      ),
    ),
    h(
      "div",
      { class: "article-place" },
      h("span", { class: "sr-only" }, "Page: "),
      pinLine,
      result
        ? h(
            "span",
            { class: `result result-${result.kind}`, title: result.text },
            icon(result.icon),
            h("span", {}, result.text, result.edited ? h("span", { class: "result-edited" }, " (edited since)") : null),
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
          "aria-label": `Edit: ${clip(headline, 80)}`,
          dataset: { focusKey: `edit:${a.id}` },
          onclick: () => openArticleEditor(a),
        },
        "Edit",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-small btn-danger-quiet",
          "aria-label": `Delete: ${clip(headline, 80)}`,
          dataset: { focusKey: `delete:${a.id}` },
          onclick: () => deleteArticle(a),
        },
        "Delete",
      ),
    ),
  );
  return row;
}

async function deleteArticle(a) {
  const ok = await confirmDialog({
    title: "Delete this article?",
    message: `“${clip(a.headline, 140) || "(no headline)"}” will be removed from this edition, with its photo.`,
    confirm: "Delete article",
    danger: true,
  });
  if (!ok) return;
  const order = filteredArticles().map((x) => x.id);
  const index = order.indexOf(a.id);
  try {
    await api("DELETE", apiPath(state.editionId, "articles", a.id));
    toast("Article deleted");
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
    ? "test import from a past edition"
    : { typed: "typed in", pasted: "pasted", word: "from a Word file" }[source] || "";
  const when = friendlyTime(timeOf(a.created));
  return [when ? `Added ${when}` : "", how].filter(Boolean).join(" · ");
}

function fillPageSelect(select, pin) {
  const total = editionPages();
  const options = [h("option", { value: "" }, "Auto (the Desk chooses)")];
  for (let n = 1; n <= total; n += 1) {
    const role = pageRole(n);
    options.push(h("option", { value: String(n) }, role === "inside" ? `Page ${n}` : pageName(n, role)));
  }
  if (pin && pin > total) options.push(h("option", { value: String(pin) }, `Page ${pin} (not in this edition)`));
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
  setText($("#article-title"), article ? "Edit article" : "New article");
  setText($("#article-sub"), article ? articleOrigin(article) : "Fields marked * are required.");
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
            h("p", {}, "The last layout noted:"),
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
      h("img", { src: editor.fileUrl, alt: "The new photo you chose" }),
      h(
        "p",
        { class: "photo-note" },
        icon("info"),
        h("span", {}, `${editor.file.name} (${fmtBytes(editor.file.size)}) — uploaded when you save.`),
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
        existing && !editor.removePhoto ? "Keep the old photo" : "Don't use this photo",
      ),
    );
  } else if (mode === "existing") {
    const url = photoUrl(editor.article);
    const missing = () => h("div", { class: "photo-missing" }, "Photo stored — no preview available.");
    const img = fallbackImage([url, withoutQuery(url)], { alt: "The article's photo" }, (el) =>
      el.replaceWith(missing()),
    );
    parts.push(img || missing());
    const w = int(existing.width_px);
    const hgt = int(existing.height_px);
    if (w && hgt) parts.push(h("p", { class: "photo-note" }, `${w} × ${hgt} pixels`));
  } else {
    parts.push(
      h("div", { class: "photo-empty" }, editor.removePhoto ? "The photo will be removed when you save." : "No photo"),
    );
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
          "Keep the photo",
        ),
      );
    }
  }
  box.replaceChildren(...parts);
  // a newly chosen file is undone with the button under its preview; "Remove photo" is for the stored photo
  $("#article-photo-remove").hidden = mode !== "existing";
  setText($("#article-photo-label"), mode === "none" ? "Add a photo" : "Replace photo");
  const f = $("#form-article").elements;
  f.caption.disabled = mode === "none";
  f.credit.disabled = mode === "none";
}

function updateEditorWords() {
  const f = $("#form-article").elements;
  const words = countWords(f.body.value);
  const willHavePhoto = !!editor.file || (!!editor.article && hasPhoto(editor.article) && !editor.removePhoto);
  const short = words > 0 && words <= BRIEF_MAX_WORDS && !willHavePhoto;
  setText($("#article-words"), plural(words, "word"));
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
    setFieldError("article-photo", "Use a JPEG, PNG or WebP photo.");
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    setFieldError("article-photo", `This file is ${fmtBytes(file.size)}. The limit is 40 MB.`);
    return;
  }
  if (file.size === 0) {
    setFieldError("article-photo", "This file is empty.");
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
      title: "Discard your changes?",
      message: "Your changes to this article have not been saved.",
      confirm: "Discard changes",
      cancel: "Keep editing",
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
    setFieldError("article-headline", "Write a headline.");
    firstBad = f.headline;
  } else setFieldError("article-headline", "");
  if (!v.body.trim()) {
    setFieldError("article-body", "Write the body text.");
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
  setEditorBusy(true, "Saving…");
  let stage = "article";
  try {
    if (!editor.id) {
      const created = await api("POST", apiPath(editionId, "articles"), { json: fields });
      const art = isObj(created.article) ? created.article : created;
      if (!str(art.id)) throw new ApiError("The Desk server did not return the new article.");
      editor.id = art.id;
      editor.article = art;
      setText($("#article-title"), "Edit article");
      $("#article-delete").hidden = false;
    } else {
      const updated = await api("PUT", apiPath(editionId, "articles", editor.id), { json: fields });
      const art = isObj(updated.article) ? updated.article : updated;
      editor.article = { ...(editor.article || {}), ...art };
    }
    stage = "photo";
    const photo = hasPhoto(editor.article) ? editor.article.photo : null;
    if (editor.file) {
      setEditorBusy(true, "Uploading the photo…");
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
    toast("Article saved");
    await refreshDetail();
    if (state.step === "articles") restoreFocus(`edit:${savedId}`);
  } catch (err) {
    const message =
      stage === "photo" ? `The article text is saved, but the photo change is not: ${err.message}` : err.message;
    showAlert($("#article-alert"), message);
    if (stage === "photo") refreshDetail({ quiet: true });
  } finally {
    if (editor.busy) setEditorBusy(false);
  }
}

async function deleteFromEditor() {
  if (!editor.id || editor.busy) return;
  const a = editor.article || {};
  const ok = await confirmDialog({
    title: "Delete this article?",
    message: `“${clip(a.headline, 140) || "(no headline)"}” will be removed from this edition, with its photo.`,
    confirm: "Delete article",
    danger: true,
  });
  if (!ok) return;
  setEditorBusy(true, "Deleting…");
  try {
    await api("DELETE", apiPath(state.editionId, "articles", editor.id));
    setEditorBusy(false);
    closeEditor();
    toast("Article deleted");
    await refreshDetail();
    restoreFocus("articles:add");
  } catch (err) {
    showAlert($("#article-alert"), err.message);
  } finally {
    if (editor.busy) setEditorBusy(false);
  }
}

// ===================================================================== paste several

function splitPaste(text) {
  const chunks = [];
  let current = [];
  for (const line of str(text).replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "---") {
      chunks.push(current);
      current = [];
    } else current.push(line);
  }
  chunks.push(current);
  return chunks
    .map((lines) => lines.join("\n").trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split("\n");
      const rest = lines.slice(1);
      if (rest.length && /^byline\s*:/i.test(rest[0].trim())) rest.shift();
      return { headline: lines[0].trim(), hasBody: rest.join("\n").trim() !== "", text: chunk };
    });
}

function updatePasteCount() {
  const items = splitPaste($("#paste-text").value);
  const out = $("#paste-count");
  const preview = $("#paste-preview");
  if (!items.length) {
    out.replaceChildren(h("span", { class: "muted" }, "Nothing pasted yet."));
    preview.replaceChildren();
    return;
  }
  const noBody = items.filter((x) => !x.hasBody).length;
  fill(
    out,
    h("strong", {}, `Looks like ${plural(items.length, "article")}.`),
    noBody
      ? h(
          "span",
          { class: "muted" },
          ` ${plural(noBody, "of them has", "of them have")} a headline but no body text yet.`,
        )
      : null,
  );
  const shown = items.slice(0, 8).map((x) => h("li", { lang: langFor(x.headline) }, clip(x.headline, 90)));
  if (items.length > 8) shown.push(h("li", {}, `…and ${items.length - 8} more`));
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
    showAlert($("#paste-alert"), "Paste at least one article first.");
    textArea.focus();
    return;
  }
  const submit = $("#paste-submit");
  submit.disabled = true;
  $("#paste-busy").replaceChildren(spinner(), "Adding…");
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
      showAlert(
        $("#paste-alert"),
        `Added ${plural(created, "article")}. Not added: ` +
          skipped.map((s) => `“${clip(str(s.headline), 60)}” (${str(s.reason) || "not accepted"})`).join("; ") +
          ". They are still in the box: fix them and add again.",
      );
    } else {
      textArea.value = "";
      $("#dlg-paste").close();
      toast(`Added ${plural(created, "article")}`);
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
  toast(`Reading ${plural(files.length, "Word file")}…`, "info");
  try {
    for (const file of files) {
      if (!/\.docx$/i.test(file.name)) {
        problems.push(`${file.name}: not a .docx file (save it as .docx in Word)`);
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
          problems.push(`${file.name}: “${clip(str(s.headline), 50)}” (${str(s.reason) || "not accepted"})`);
        for (const n of arr(res.notes)) notes.push(`${file.name}: ${str(n)}`);
      } catch (err) {
        problems.push(`${file.name}: ${err.message}`);
      }
    }
  } finally {
    wordBusy = false;
  }
  state.wordNote = {
    edition: eid,
    kind: problems.length ? "warn" : "ok",
    text: added
      ? `Added ${plural(added, "article")} from ${plural(fromFiles, "Word file")}` +
        (fromFiles < files.length ? ` (of ${files.length} chosen).` : ".")
      : `No article was added from ${plural(files.length, "Word file")}.`,
    lines: [...new Set([...problems, ...notes])],
  };
  if (added) toast(`Added ${plural(added, "article")}`);
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
  list.replaceChildren(h("p", { class: "loading" }, spinner(), "Looking for past editions…"));
  $("#import-submit").disabled = true;
  $("#dlg-import").showModal();
  const editionId = state.editionId;
  try {
    const data = await api("GET", "/api/samples");
    if (state.editionId !== editionId || !$("#dlg-import").open) return;
    const samples = arr(data.samples).filter((s) => isObj(s) && str(s.name));
    if (!samples.length) {
      list.replaceChildren(h("p", {}, "No past editions were found in the dataset."));
      return;
    }
    const already = new Set(
      state.detail.articles
        .map((a) => str(a.source))
        .filter((s) => s.startsWith("sample:"))
        .map((s) => s.slice(7)),
    );
    const fieldset = h("fieldset", {}, h("legend", {}, "Past editions"));
    samples.forEach((s, i) => {
      const name = str(s.name);
      const facts = [
        int(s.pages) ? `${s.pages} pages` : null,
        num(s.stories) !== null ? plural(s.stories, "story", "stories") : null,
        num(s.photos) !== null ? plural(s.photos, "photo") : null,
        num(s.words) !== null ? plural(s.words, "word") : null,
      ].filter(Boolean);
      fieldset.append(
        h(
          "label",
          { class: "sample", for: `sample-${i}` },
          h("input", { type: "checkbox", id: `sample-${i}`, value: name }),
          h("span", { class: "sample-title" }, s.date ? friendlyDate(s.date) : name),
          facts.length ? h("span", { class: "sample-facts" }, facts.join(" · ")) : null,
          s.date ? h("span", { class: "sample-name" }, name) : null,
          already.has(name) ? h("span", { class: "sample-already" }, "Already imported into this edition") : null,
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
    showAlert($("#import-alert"), "Choose at least one past edition.");
    return;
  }
  importBusy = true;
  $("#import-submit").disabled = true;
  $("#import-cancel").disabled = true;
  for (const input of $$("#import-list input")) input.disabled = true;
  showAlert($("#import-alert"), "");
  $("#import-progress").replaceChildren(spinner(), "Importing — this can take a minute.");
  try {
    const res = await api("POST", apiPath(state.editionId, "import-sample"), { json: { samples: names } });
    importBusy = false;
    $("#dlg-import").close();
    toast(
      `Imported ${plural(int(res.imported) ?? 0, "story", "stories")} and ${plural(int(res.photos) ?? 0, "photo")}`,
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
    stepHeader(
      "Ads",
      slots.length
        ? `${filled} of ${plural(slots.length, "ad space")} filled. Spaces without an image print as a grey box marked AD.`
        : "Ad spaces come from the page plan.",
    ),
  );
  if (!backPageAds()) {
    view.append(
      notice(
        "info",
        "The back page is all news (no ad spaces). Change this in step 1.",
        h("button", { type: "button", class: "btn btn-small", onclick: () => goStep("edition") }, "Go to step 1"),
      ),
    );
  }
  if (!state.detail.plan) {
    view.append(planMissingNotice());
    return view;
  }
  if (!slots.length) {
    view.append(h("div", { class: "card empty empty-small" }, h("p", {}, "This edition has no ad spaces.")));
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
        h("p", { class: "card-lede" }, plural(onPage.length, "ad space")),
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
    const missing = () => h("span", { class: "ad-box-label" }, "Image stored — no preview");
    const img = fallbackImage([url, withoutQuery(url)], { alt: `Ad image for space ${slot.slot}` }, (el) =>
      el.replaceWith(missing()),
    );
    box.append(img || missing());
  } else box.append(h("span", { class: "ad-box-label", "aria-hidden": "true" }, "AD"));
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
      h("h3", { class: "ad-title" }, `Ad space ${slot.slot}`),
      h("p", { class: "ad-size" }, `${fmtMm(w)} × ${fmtMm(hgt)} mm`),
      has
        ? h(
            "p",
            { class: "ad-state ad-state-ok" },
            icon("check"),
            h("span", {}, wPx && hPx ? `Image added (fitted at ${wPx} × ${hPx} pixels)` : "Image added"),
          )
        : h("p", { class: "ad-state" }, icon("info"), h("span", {}, "Reserved space — prints as a grey box marked AD")),
      h(
        "p",
        { class: "field-note", id: `${inputId}-note` },
        minW && minH
          ? `JPEG, PNG or WebP, up to 40 MB. For a sharp print use at least ${fmtInt(minW)} × ${fmtInt(minH)} pixels. ` +
              "The image is fitted inside the space, with white around it if the shapes differ."
          : "JPEG, PNG or WebP, up to 40 MB.",
      ),
      h(
        "div",
        { class: "ad-actions" },
        h(
          "span",
          { class: "file-pick" },
          input,
          h("label", { for: inputId, class: "btn btn-small" }, icon("upload"), has ? "Replace image" : "Upload image"),
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
              "Remove",
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
    showAlert(ui.alertSlot, "Use a JPEG, PNG or WebP image.");
    return;
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    showAlert(ui.alertSlot, `This file is ${fmtBytes(file.size)}. The limit is 40 MB.`);
    return;
  }
  ui.card.classList.add("is-busy");
  ui.busy.replaceChildren(spinner(), "Uploading and converting…");
  try {
    const res = await api("PUT", apiPath(state.editionId, "ads", slot.slot), { raw: file, contentType: type });
    state.adLocal[slot.slot] = { w_px: int(res.w_px), h_px: int(res.h_px) };
    state.adBust[slot.slot] = String(Date.now());
    toast(`Ad image added to space ${slot.slot}`);
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
    title: "Remove this ad image?",
    message: `Space ${slot.slot} will print as a grey box marked AD until you upload another image.`,
    confirm: "Remove image",
    danger: true,
  });
  if (!ok) return;
  try {
    await api("DELETE", apiPath(state.editionId, "ads", slot.slot));
    state.adLocal[slot.slot] = null;
    toast(`Ad image removed from space ${slot.slot}`);
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
    stepHeader(
      "Lay out & download",
      `Lay out the ${editionPages()}-page paper, check the pages, then download the PDFs.`,
    ),
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
  if (active) blocked = "A layout is running. Follow it below, or cancel it to start again.";
  else if (!d.articles.length) blocked = "Add articles first (step 2) — there is nothing to lay out yet.";
  else blocked = engineBlocked();
  const needs = computeNeeds();
  const have = computeHave(d.articles);
  if (needs && num(needs.total.stories) !== null && have.stories < needs.total.stories && d.articles.length) {
    warnings.push(
      `You have ${fmtInt(have.stories)} of about ${fmtInt(needs.total.stories)} stories — some pages may come out short.`,
    );
  }
  if (needs && num(needs.total.photos) !== null && have.photos < needs.total.photos && d.articles.length) {
    warnings.push(
      `You have ${fmtInt(have.photos)} of about ${fmtInt(needs.total.photos)} photos the paper usually carries.`,
    );
  }
  const pages = editionPages();
  const beyond = d.articles.filter((a) => (pinOf(a) || 0) > pages).length;
  if (beyond) {
    warnings.push(
      `${plural(beyond, "article is", "articles are")} pinned to a page this ${pages}-page edition does not have — ` +
        "the Desk will place them itself (change their page in step 2 to choose one).",
    );
  }
  const slots = adSlots();
  const empty = slots.filter((s) => !adInfo(s.slot)).length;
  if (empty) {
    warnings.push(
      `${empty} of ${plural(slots.length, "ad space")} ${empty === 1 ? "has" : "have"} no image — ` +
        `${empty === 1 ? "it prints" : "they print"} as a grey box marked AD.`,
    );
  }
  const samples = d.articles.filter(isSample).length;
  if (samples) {
    warnings.push(
      `${plural(samples, "article is a test import", "articles are test imports")} from a past edition. ` +
        "Delete them before you lay out a real edition.",
    );
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
  const signature = JSON.stringify([gate, state.runStarting, state.runStartError, editionPages(), collapse, again]);
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
    state.runStarting ? [spinner(), "Starting…"] : `Lay out the ${pages}-page paper${again ? " again" : ""}`,
  );
  const warningList = gate.warnings.length
    ? h(
        "ul",
        { class: "warn-list", "aria-label": "Before you start" },
        gate.warnings.map((w) => h("li", {}, icon("alert"), h("span", {}, w))),
      )
    : null;
  host.replaceChildren(
    h(
      "section",
      { class: "card run-start", "aria-label": "Start a layout" },
      warningList && collapse
        ? h(
            "details",
            { class: "warn-details", dataset: { focusKey: "run:checks" } },
            h("summary", {}, icon("alert"), `${plural(gate.warnings.length, "thing")} to check before the next layout`),
            warningList,
          )
        : warningList,
      h(
        "div",
        { class: "run-go" },
        button,
        h(
          "p",
          { class: gate.blocked ? "run-go-note is-blocked" : "run-go-note", id: "run-go-note" },
          gate.blocked || RUN_TIME_NOTE,
        ),
      ),
      measureLine(),
      state.runStartError ? alertBox(state.runStartError) : null,
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
    if (!runId) throw new ApiError("The Desk server did not say which layout it started.");
    if (state.editionId !== editionId) return;
    state.runStarting = false;
    selectRun(runId, { render: false });
    toast(`Started laying out the ${editionPages()}-page paper`);
    await refreshDetail({ quiet: true, changed: false });
  } catch (err) {
    state.runStarting = false;
    if (state.editionId !== editionId) return;
    if (err.status === 409) {
      state.runStartError = `${err.message} The running layout is shown below.`;
      await refreshDetail({ quiet: true, changed: false });
      const active = activeRunSummary();
      if (active && (!state.run || state.run.id !== active.id)) selectRun(active.id);
    } else {
      state.runStartError = err.message;
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
      run.error = "This layout could not be found on the Desk server any more.";
    } else run.error = `${err.message} Trying again…`;
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
  if (str(previous.state) !== now && RUN_STATE_LABEL[now]) messages.push(`Layout: ${RUN_STATE_LABEL[now]}.`);
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
      messages.push(`Page ${n} ${s === "done" ? "is done" : "failed"}.`);
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
  if (s === "done") toast(`The ${editionPages()}-page paper is laid out`);
  else if (s === "failed") toast("The layout failed — the details are in step 4", "error");
  else toast("Layout cancelled", "info");
  refreshDetail({ quiet: true, changed: false });
}

function elapsedText(run) {
  const status = isObj(run.status) ? run.status : null;
  let seconds = status ? num(status.elapsed_s) : null;
  if (seconds === null) return "";
  const s = str(status.state);
  if (!TERMINAL.has(s)) {
    if (run.polledAt) seconds += (Date.now() - run.polledAt) / 1000;
    return `${fmtDuration(seconds)} so far`;
  }
  return s === "done" ? `Took ${fmtDuration(seconds)}` : `Stopped after ${fmtDuration(seconds)}`;
}

function runPagesFor(run) {
  const status = isObj(run.status) ? run.status : null;
  const pages = arr(status && status.pages).filter((p) => isObj(p) && int(p.page) !== null);
  if (pages.length || !isRunActive(run)) return pages.slice().sort((a, b) => int(a.page) - int(b.page));
  return planPages().map((p) => ({ page: int(p.page), role: p.role, state: "waiting" }));
}

function buildRunUI(run) {
  const ui = { runId: run.id, cards: new Map(), resultsSignature: null };
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
    "Cancel layout",
  );
  ui.hint = h(
    "p",
    { class: "run-hint" },
    `${RUN_TIME_NOTE} You can keep working in the other steps; changes you make now go into the next layout.`,
  );
  ui.progress = h("progress", { class: "run-progress", max: "1", value: "0", "aria-labelledby": "run-progress-label" });
  ui.progressLabel = h("span", { class: "run-progress-label", id: "run-progress-label" });
  ui.progressRow = h("div", { class: "run-progress-row" }, ui.progress, ui.progressLabel);
  ui.alert = h("div", { class: "alert-slot" });
  ui.stale = h("div", { class: "run-stale" });
  ui.grid = h("ol", { class: "page-grid", "aria-label": "Pages" });
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
  if (!runUI || runUI.runId !== run.id || runUI.root.parentNode !== host) {
    runUI = buildRunUI(run);
    host.replaceChildren(runUI.root);
  }
  const ui = runUI;
  const key = focusKeyIn(ui.root);
  const status = isObj(run.status) ? run.status : null;
  const s = status ? str(status.state) : "";
  const terminal = TERMINAL.has(s);
  const started = runStartTime(run);
  setText(ui.title, started !== null ? `Layout of ${friendlyTime(started)}` : "Layout");

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
  const stateText = status ? RUN_STATE_LABEL[s] || s || "Unknown state" : run.error ? "Not available" : "Loading…";
  if (ui.state.dataset.text !== stateText) {
    ui.state.dataset.text = stateText;
    ui.state.dataset.tone = tone;
    ui.state.replaceChildren(stateIcon, h("span", {}, stateText));
  }
  setText(ui.elapsed, elapsedText(run));
  // the engine's own progress message, unless it only repeats the state label ("Laying out" / "Laying out pages")
  const engineMessage = status && !terminal ? str(status.message).trim() : "";
  const repeats = !!engineMessage && fold(stateText).startsWith(fold(engineMessage));
  setText(ui.message, repeats ? "" : engineMessage);
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
    pages.length ? `${done} of ${pages.length} pages done${failed ? `, ${failed} failed` : ""}` : "Planning the pages…",
  );

  const errors = [];
  if (run.error) errors.push(run.error);
  if (status && str(status.error)) errors.push(str(status.error));
  else if (s === "failed" && str(status.message)) errors.push(str(status.message));
  const errorText = errors.join(" ");
  if (ui.alert.dataset.text !== errorText) {
    ui.alert.dataset.text = errorText;
    showAlert(ui.alert, errorText);
  }

  const newer = activeRunSummary();
  let staleText = "";
  if (newer && newer.id !== run.id) staleText = "A newer layout is running. Open it from the list below to follow it.";
  else if (terminal && addedAfter(status) > 0) {
    // changes to what the pages print are shown on the pages themselves ("needs saving"); new articles are not
    const n = addedAfter(status);
    staleText =
      `${plural(n, "article was", "articles were")} added after this layout, which does not have ` +
      `${n === 1 ? "it" : "them"}: lay out again to place ${n === 1 ? "it" : "them"} (that starts every page ` +
      "afresh; page edits are not kept).";
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
  const s = PAGE_STATE_LABEL[str(p.state)] ? str(p.state) : "waiting";
  li.dataset.state = s;
  const name = pageName(n, str(p.role) || pageRole(n));
  const thumbUrl = runFileUrl(run.id, p.thumb);
  const pngUrl = runFileUrl(run.id, p.png);
  const picture = thumbUrl || pngUrl;
  let thumb;
  if (picture && s === "done") {
    // the thumbnail, then (after a pause) the full-size preview, then a plain note
    const noPreview = () => h("span", { class: "small muted" }, "No preview");
    const img = fallbackImage([thumbUrl, pngUrl], { alt: "", decoding: "async" }, (el) => el.replaceWith(noPreview()));
    thumb = h(
      "button",
      {
        type: "button",
        class: "page-thumb",
        "aria-label": `${name}: open a large preview`,
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
    h("p", { class: "page-card-state" }, stateIcon, h("span", {}, `${PAGE_STATE_LABEL[s]}${withTime}`)),
    s === "failed" ? h("p", { class: "page-card-msg" }, str(p.message) || "This page could not be laid out.") : null,
    s === "done" && !picture ? h("p", { class: "page-card-msg muted" }, "Preview not ready yet.") : null,
    warnings.length ? h("p", { class: "page-card-warn" }, icon("alert"), plural(warnings.length, "warning")) : null,
    s === "done" && p.needs_save
      ? h(
          "p",
          { class: "page-card-warn" },
          icon("alert"),
          str(p.needs_save_reason) || "Changed: open the page and save it.",
        )
      : s === "done" && arr(p.stale).length
        ? arr(p.stale).map((why) => h("p", { class: "page-card-warn" }, icon("alert"), str(why)))
        : s === "done" && p.edited_unsaved
          ? h(
              "p",
              { class: "page-card-warn" },
              icon("alert"),
              "Changed in the editor, not saved: its print file is older.",
            )
          : null,
    s === "done" && (isObj(run.status) ? str(run.status.state) : str(run.state)) === "done"
      ? h(
          "a",
          {
            class: "page-card-edit",
            href: `/static/editor.html?edition=${encodeURIComponent(state.editionId)}&run=${encodeURIComponent(run.id)}&page=${n}`,
          },
          p.edited ? "Edit page (edited)" : "Edit page",
        )
      : null,
    s === "done" && check
      ? check.passed
        ? h("p", { class: "page-card-check" }, icon("check"), "PDF/X-1a check passed")
        : h(
            "p",
            { class: "page-card-warn" },
            icon("alert"),
            check.fails
              ? `PDF/X-1a check: ${plural(check.fails, "problem")} — do not send to the press`
              : "PDF/X-1a check did not run",
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
  if (s !== "done") return "this layout did not finish: lay the edition out again";
  if (state.run && state.run.gone) return "this layout could not be found on the Desk server any more";
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
  if (relayout) parts.push("this layout no longer fits the edition: lay the edition out again");
  else if (toSave.length)
    parts.push(
      `${toSave.length === 1 ? "page" : "pages"} ${toSave.join(", ")} still to save in the page editor (open ` +
        `${toSave.length === 1 ? "it" : "them"} and press Save page)`,
    );
  if (failing.length)
    parts.push(`${failing.length === 1 ? "page" : "pages"} ${failing.join(", ")} not passing the PDF/X-1a check`);
  const twice = arr(status.pages_with_repeats)
    .map(int)
    .filter((n) => n !== null);
  if (twice.length)
    parts.push(`pages ${twice.join(", ")} print the same article: take it off one of them in the page editor`);
  const failed = arr(status.pages)
    .filter((p) => isObj(p) && str(p.state) === "failed")
    .map((p) => int(p.page));
  if (failed.length) parts.push(`${failed.length === 1 ? "page" : "pages"} ${failed.join(", ")} could not be laid out`);
  return parts.length ? parts.join("; ") : "not every page is laid out and checked";
}

function headlineFor(id) {
  const a = state.detail ? state.detail.articles.find((x) => x.id === id) : null;
  return a ? clip(a.headline, 160) || "(no headline)" : null;
}

function fmtSeconds(value) {
  const s = num(value);
  if (s === null || s < 0) return null;
  if (s < 10) return `${s.toFixed(1)} s`;
  if (s < 120) return `${Math.round(s)} s`;
  return fmtDuration(s);
}

/** "Measured in 86 s · planned in 0.2 s · laid out in 41 s", from the run's timings (whichever are given). */
function timingsLine(status) {
  const t = isObj(status.timings) ? status.timings : null;
  if (!t) return null;
  const parts = [
    ["measured", t.measure_s],
    ["planned", t.plan_s],
    ["laid out", t.layout_s],
  ]
    .map(([label, value]) => (fmtSeconds(value) ? `${label} in ${fmtSeconds(value)}` : null))
    .filter(Boolean);
  if (!parts.length) return null;
  parts[0] = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  return h("p", { class: "run-timings" }, parts.join(" · "));
}

function articleWarningList(texts) {
  return h(
    "ul",
    { class: "article-warnings", "aria-label": "Warnings for this article" },
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
    const download = (url, file, title, sub) =>
      url
        ? h(
            "a",
            { class: "download", href: url, download: `${editionId}-${file}` },
            icon("download"),
            h("span", { class: "download-title" }, title),
            h("span", { class: "download-sub" }, sub),
          )
        : h("div", { class: "download-missing" }, icon("clock"), `${title}: not made in this layout.`);
    const links = pdfPages.map((p) =>
      h(
        "a",
        {
          class: "btn btn-small",
          href: runFileUrl(run.id, p.pdf),
          download: `${editionId}-${safeFile(p.pdf)}`,
          "aria-label": `PDF of ${pageName(int(p.page), str(p.role))}`,
        },
        String(int(p.page)),
      ),
    );
    out.push(
      h(
        "section",
        { class: "results-block", "aria-labelledby": "downloads-title" },
        h("h3", { id: "downloads-title" }, "Downloads"),
        pressNotReady(status)
          ? h(
              "div",
              { class: "press-not-ready", role: "alert" },
              icon("alert"),
              h(
                "p",
                {},
                h("strong", {}, "Do not send these press files yet. "),
                pressNotReady(status) === CHECKING
                  ? "Checking them against your last change…"
                  : `They do not match the pages: ${pressNotReady(status)}.`,
              ),
            )
          : null,
        h(
          "div",
          { class: "downloads" },
          download(
            editionPdf,
            safeFile(status.edition_pdf) || "edition.pdf",
            "Edition PDF",
            "All pages, for reading and proofs",
          ),
          download(
            zip,
            safeFile(status.zip) || "press-files.zip",
            "Press files",
            allChecked(status)
              ? "One PDF per page, each passed the PDF/X-1a check — ZIP"
              : pressNotReady(status)
                ? "Not current — see the note above"
                : "One PDF per page, ZIP — see the page checks",
          ),
        ),
        links.length
          ? h("div", { class: "page-links" }, h("span", { class: "page-links-label" }, "Single page PDFs:"), links)
          : null,
        h("div", { class: "honesty", role: "note" }, icon("alert"), h("p", {}, HONESTY_NOTE)),
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
              [plural(ids.length, "article"), seconds !== null ? fmtDuration(seconds) : null]
                .filter(Boolean)
                .join(" · "),
            ),
          ),
          pageState === "failed"
            ? h(
                "p",
                { class: "report-failed" },
                icon("x"),
                h("span", {}, `Failed: ${str(p.message) || "this page could not be laid out."}`),
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
                      headline || "(an article that is no longer in this edition)",
                    ),
                    notes.length ? articleWarningList(notes) : null,
                  );
                }),
              )
            : pageState === "failed"
              ? null
              : h("p", { class: "muted small" }, "No articles on this page."),
          warnings.length
            ? h(
                "ul",
                { class: "report-warnings", "aria-label": "Warnings" },
                warnings.map((w) => h("li", {}, icon("alert"), h("span", {}, w))),
              )
            : null,
        ),
      );
    }
    out.push(
      h(
        "section",
        { class: "results-block", "aria-labelledby": "report-title" },
        h("h3", { id: "report-title" }, "What went where"),
        report,
      ),
    );
  }

  const notPlaced = arr(status.not_placed).filter((x) => isObj(x) && typeof x.article === "string");
  if (s === "done" || notPlaced.length) {
    const block = h(
      "section",
      { class: "results-block", "aria-labelledby": "notplaced-title" },
      h("h3", { id: "notplaced-title" }, notPlaced.length ? `Not placed (${notPlaced.length})` : "Not placed"),
    );
    if (!notPlaced.length) {
      block.append(h("p", { class: "all-placed" }, icon("check"), "Every article was placed."));
    } else {
      const list = h("ul", { class: "not-placed" });
      for (const item of notPlaced) {
        const article = state.detail ? state.detail.articles.find((a) => a.id === item.article) : null;
        const headline = article ? clip(article.headline, 200) || "(no headline)" : null;
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
                headline || "(an article that is no longer in this edition)",
              ),
              h("p", { class: "not-placed-reason" }, icon("alert"), h("span", {}, reason || "No reason given.")),
              h("p", { class: "not-placed-hint" }, notPlacedHint(reason)),
              notes.length ? articleWarningList(notes) : null,
            ),
            article
              ? h(
                  "button",
                  {
                    type: "button",
                    class: "btn btn-small",
                    "aria-label": `Edit: ${clip(headline, 80)}`,
                    dataset: { focusKey: `np:edit:${article.id}` },
                    onclick: () => openArticleEditor(article),
                  },
                  "Edit",
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
        h("h3", { id: "notes-title" }, "Other warnings"),
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
                headline || "(an article that is no longer in this edition)",
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
    h("h2", { class: "card-title", id: "history-title" }, "Earlier layouts of this edition"),
  );
  if (!runs.length) {
    section.append(h("p", { class: "muted" }, "None yet. Your layouts are listed here, newest first."));
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
        h("span", { class: "history-state", dataset: { tone } }, stateIcon, RUN_STATE_LABEL[s] || s || "Unknown"),
        current
          ? h("span", { class: "history-current" }, "Shown above")
          : h(
              "button",
              {
                type: "button",
                class: "btn btn-small",
                "aria-label": `Open the layout of ${when}`,
                dataset: { focusKey: `run:open:${r.id}` },
                onclick: () => {
                  state.runStartError = "";
                  selectRun(r.id);
                  const title = $("#run-title");
                  if (title) title.scrollIntoView({ block: "start" });
                },
              },
              "Open",
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
    title: "Cancel this layout?",
    message: "The Desk stops laying out this edition. You can start a new layout at any time.",
    confirm: "Cancel layout",
    cancel: "Keep going",
    danger: true,
  });
  if (!ok || state.run !== run) return;
  try {
    await api("POST", apiPath(state.editionId, "runs", run.id, "cancel"), { json: {} });
    toast("Cancelling the layout…", "info");
    pollRun(run);
  } catch (err) {
    run.error = err.message;
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
  setText($("#preview-title"), `${name} — ${preview.index + 1} of ${preview.pages.length}`);
  const img = $("#preview-img");
  img.alt = `${name}: preview of the laid-out page`;
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

function confirmDialog({ title, message, confirm = "OK", cancel = "Cancel", danger = false }) {
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
  setText($("#new-issue-note"), open && str(open.issue) ? `Last: ${str(open.issue)}` : "");
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
    taken
      ? `There is already an edition for ${friendlyDate(date)}. Creating another makes a second one for the same day.`
      : parseDay(date)
        ? friendlyDate(date)
        : "",
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
      plural(n.stories, "story", "stories"),
      num(n.briefs) ? plural(n.briefs, "short item") : null,
      num(n.photos) !== null ? plural(n.photos, "photo") : null,
      num(n.words) !== null ? plural(n.words, "word") : null,
    ].filter(Boolean);
    out.replaceChildren(
      h("strong", {}, `A ${pages}-page paper usually needs about `),
      `${parts.join(", ")}. Bring about 15–20% extra.`,
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
    setFieldError("new-date", "Choose the date this edition is for.");
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
  submit.replaceChildren(spinner(), "Creating…");
  showAlert($("#new-alert"), "");
  try {
    const res = await api("POST", "/api/editions", { json: body });
    const edition = isObj(res.edition) ? res.edition : res;
    const id = str(edition.id);
    $("#dlg-new").close();
    toast(`Edition for ${friendlyDate(date)} created`);
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
    submit.replaceChildren("Create edition");
  }
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
  wireStatic();
  renderAll();
  refreshStatus();
  loadEditionsAndOpen();
}

init();
