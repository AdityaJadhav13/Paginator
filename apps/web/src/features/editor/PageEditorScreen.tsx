/**
 * The page editor, hosted (docs/product/10-l2-newsroom-plan.md §1 L2.4): a port of the Desk's editor
 * (tools/desk/static/editor.js) onto the API's editor routes. A done page of the board run opens with its soft lock
 * (heartbeat every 30 s, released on leaving); the engine sets every change. The editor's rules, as the Desk's:
 *  - changes go one at a time, each carrying the page's revision; a newer change replaces one still waiting when they
 *    lock the same stories at the same places (editor.js send: a story unlocked and then moved reaches the engine as
 *    two changes, or the engine refuses the move);
 *  - an answer older than the page shown is ignored; one without the drawn page keeps the page shown and asks again;
 *  - a change on an older revision is refused (409 stale) and the page is shown as it is now, with a notice;
 *  - undo and redo are stacks of the page's module lists (Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z), each step sent as a change;
 *  - "Try another layout", "Update text", a move to another page and "Save page" wait for the changes on their way and
 *    hold the page while they run; the story panel's "Update" after a text save runs once the changes have settled;
 *  - a refusal of the engine is said in its own words;
 *  - someone else holding the page: read-only, with "Ask to take over"; the holder sees the ask and may hand over;
 *  - an approved page (L2.5) is read-only, with who approved it and "Unlock" (page.unlock); a saved page with its check
 *    known may be approved here (page.approve, with the revision and SHA-256 of the release view); a change the API
 *    refuses as approved meanwhile (409 page_approved) reloads the page and says why.
 * Desktop first: under 900 px the page gives way to "Use a larger screen to edit pages", and is not opened (no lock).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Badge, Button, Field, InlineMessage, PageHeader, Panel, Select, Stack, Toolbar } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type PlainKey } from "../../i18n/index.ts";
import type {
  ApiProblem,
  DeskTextDto,
  EditChangeDto,
  EditorPageDto,
  PageHistoryDto,
  PageLockDto,
  ReleasePageDto,
} from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { layoutAccess } from "../layout/access.ts";
import { DeskWords } from "../layout/desk-text.tsx";
import { useLayout } from "../layout/layout-context.tsx";
import { checkText, roleText } from "../layout/layout-words.tsx";
import { useRelease } from "../release/release-context.tsx";
import { useEditor } from "./editor-context.tsx";
import { PageCanvas } from "./PageCanvas.tsx";
import { StoryText, type ArticleRef, type Draft } from "./StoryText.tsx";
import { clampZoom, missingGlyphs, problemMsg, readView, snapModule, type Module, type PageView } from "./view.ts";
import "../layout/layout.css";
import "./editor.css";

export const HEARTBEAT_MS = 30_000;
const GLYPH_CHUNK = 2000; // the API's most glyph ids per request
const UNDO_MAX = 200;

type Busy = "another" | "refresh" | "save" | "move";

const copy = (mods: readonly Module[]) => mods.map((m) => ({ ...m }));

/** Which stories are locked, and where (editor.js lockKey). */
const lockKey = (mods: readonly Module[] | null) =>
  (mods ?? [])
    .filter((m) => m.locked)
    .map((m) => `${m.story}@${m.x},${m.y},${m.w},${m.h}`)
    .sort()
    .join("|");

const WIDE = "(min-width: 900px)";
/** Wide enough to edit a page (a browser without matchMedia counts as wide). */
function useWide(): boolean {
  const query = () => typeof window.matchMedia !== "function" || window.matchMedia(WIDE).matches;
  const [wide, setWide] = useState(query);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(WIDE);
    const on = () => setWide(list.matches);
    list.addEventListener("change", on);
    return () => list.removeEventListener("change", on);
  }, []);
  return wide;
}

export function PageEditorScreen() {
  const {
    orgId = "",
    pubId = "",
    edition: editionId = "",
    runId = "",
    page: pageParam = "",
  } = useParams<{ orgId: string; pubId: string; edition: string; runId: string; page: string }>();
  const page = Number(pageParam);
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const access = layoutAccess(org, pubId);
  const mayEdit = access.view && access.edit;
  const where = useMemo(() => ({ orgId, pubId, runId, page }), [orgId, pubId, runId, page]);
  const wide = useWide();
  return (
    <Stack gap="4" className="pg-editor">
      <PageHeader
        title={t("pageEditor.editPage", { page: pageParam })}
        headingId={ROUTE_HEADING_ID}
        actions={
          <Link to={`${paths.pubEditionLayout(orgId, pubId, editionId)}?tab=pages`}>{t("pageEditor.back")}</Link>
        }
      />
      <OfflineNotice />
      <p className="pg-editor__narrow">{t("pageEditor.narrow")}</p>
      {wide && access.view && Number.isInteger(page) && page >= 1 && (
        <PageEditor
          key={`${runId}:${page}`}
          where={where}
          editionId={editionId}
          mayEdit={mayEdit}
          approve={access.approve}
          unlock={access.unlock}
        />
      )}
    </Stack>
  );
}

interface Where {
  readonly orgId: string;
  readonly pubId: string;
  readonly runId: string;
  readonly page: number;
}

function PageEditor({
  where,
  editionId,
  mayEdit,
  approve,
  unlock,
}: {
  readonly where: Where;
  readonly editionId: string;
  readonly mayEdit: boolean;
  /** page.approve, page.unlock */
  readonly approve: boolean;
  readonly unlock: boolean;
}) {
  const editor = useEditor();
  const release = useRelease();
  const layout = useLayout();
  const { t, language } = useI18n();
  const tx = t as unknown as (key: string, params?: Record<string, string | number>) => string;

  const [data, setData] = useState<EditorPageDto | null>(null);
  const [view, setView] = useState<PageView | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [modules, setModulesState] = useState<readonly Module[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<readonly (readonly Module[])[]>([]);
  const [redoStack, setRedoStack] = useState<readonly (readonly Module[])[]>([]);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [loadProblem, setLoadProblem] = useState<ApiProblem | null>(null);
  const [lock, setLock] = useState<PageLockDto | null>(null);
  const [asked, setAsked] = useState(false);
  const [history, setHistory] = useState<PageHistoryDto["items"] | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [moveTo, setMoveTo] = useState("");
  const [drawn, setDrawn] = useState(0);
  const [storyIds, setStoryIds] = useState<ReadonlyMap<string, string | null>>(new Map());
  /** the page in the release view: its revision, SHA-256 and check, for "Approve" */
  const [releasePage, setReleasePage] = useState<ReleasePageDto | null>(null);
  const [approving, setApproving] = useState(false);

  // what the callbacks need now, whatever render they were made in
  const q = useRef({
    sending: false,
    inflight: null as Module[] | null,
    queued: null as Module[][] | null,
    rev: 0,
    alt: 0,
    alive: true,
    shown: false,
    /** "Update" asked while changes were on their way: it runs when they have settled */
    refreshAfter: false,
    /** an exclusive action is running (a second click does nothing) */
    exclusive: false,
  });
  const refreshRef = useRef<() => void>(() => {});
  const drafts = useRef(new Map<string, Draft>());
  const modulesRef = useRef<readonly Module[]>([]);
  const lockRef = useRef<PageLockDto | null>(null);
  const askedRef = useRef(false);
  const glyphs = useRef(new Map<string, Path2D>());
  const images = useRef(new Map<string, HTMLImageElement>());

  const setModules = (next: readonly Module[]) => {
    modulesRef.current = next;
    setModulesState(next);
  };
  const keepLock = (next: PageLockDto) => {
    lockRef.current = next;
    setLock(next);
  };

  const readOnly = !mayEdit || !lock?.mine || !!data?.approval;
  const canEdit = !!view && !readOnly && busy === null;

  const loadHistory = useCallback(async () => {
    const r = await editor.history(where);
    if (q.current.alive && r.ok) setHistory(r.value.items);
  }, [editor, where]);

  /** The engine's answer on screen (outlines first, so the page never draws with missing letters). */
  const accept = useCallback(
    async function accept(next: EditorPageDto, again = true): Promise<boolean> {
      if (next.rev < q.current.rev) return false; // older than the page shown (answers can cross)
      const v = readView(next.view);
      if (!v) {
        if (!q.current.shown || !again) {
          if (!q.current.shown) setUnreadable(true);
          return false;
        }
        // an answer without the drawn page: the page shown stays, and the page as it is now is asked for
        const r = await editor.get(where);
        return q.current.alive && r.ok ? accept(r.value, false) : false;
      }
      for (const [face, ids] of missingGlyphs(v, glyphs.current)) {
        for (let i = 0; i < ids.length; i += GLYPH_CHUNK) {
          const r = await editor.glyphs({ ...where, face, ids: ids.slice(i, i + GLYPH_CHUNK) });
          if (!r.ok) {
            setProblem(r.error);
            continue;
          }
          for (const [gid, d] of Object.entries(r.value.glyphs)) glyphs.current.set(`${face}:${gid}`, new Path2D(d));
        }
      }
      if (!q.current.alive || next.rev < q.current.rev) return false;
      for (const it of v.items) {
        if (it.t !== "img" || images.current.has(it.src)) continue;
        const img = new Image();
        img.decoding = "async";
        img.onload = () => setDrawn((n) => n + 1);
        img.src = editor.rasterUrl({ ...where, key: it.src });
        images.current.set(it.src, img);
      }
      q.current.rev = next.rev;
      q.current.shown = true;
      setUnreadable(false);
      setData(next);
      setView(v);
      keepLock(next.lock);
      const shown = q.current.queued?.at(-1) ?? v.modules; // the newest change shown
      setModules(shown);
      setSelected((s) => (s && shown.some((m) => m.story === s) ? s : null));
      setDrawn((n) => n + 1);
      void loadHistory();
      return true;
    },
    [editor, where, loadHistory],
  );

  const reload = useCallback(async () => {
    const r = await editor.get(where);
    if (!q.current.alive) return;
    if (r.ok) await accept(r.value);
    else setProblem(r.error);
  }, [editor, where, accept]);

  /** A change refused or failed: a stale one shows the page as it is now. */
  const failed = async (error: ApiProblem) => {
    q.current.queued = null; // the changes made on what failed are not sent
    const code = error.kind === "answer" ? error.code : "";
    const current = error.kind === "answer" && code === "stale" ? error.current : undefined;
    if (current) {
      await accept(current as EditorPageDto);
      setUndoStack([]);
      setRedoStack([]);
      setNotice(t("pageEditor.stale"));
    } else if (code === "page_locked") {
      setNotice(t("pageEditor.pageLocked"));
      await reload();
    } else if (code === "page_approved") {
      setNotice(t("pageEditor.approvedRefused"));
      await reload();
    } else {
      setProblem(error);
      await reload();
    }
  };

  const send = async (mods: Module[]): Promise<void> => {
    const c = q.current;
    if (c.sending) {
      // a waiting change gives way to a newer one only when the change before it, it and the newer one lock the same
      // stories at the same places (editor.js send)
      const queue = c.queued ?? [];
      const last = queue.at(-1);
      const before = queue.length > 1 ? queue.at(-2)! : c.inflight;
      if (last && lockKey(before) === lockKey(last) && lockKey(last) === lockKey(mods)) queue[queue.length - 1] = mods;
      else queue.push(mods);
      c.queued = queue;
      return;
    }
    c.sending = true;
    c.inflight = mods;
    setSending(true);
    setProblem(null);
    const r = await editor.change({ ...where, change: { kind: "set", rev: c.rev, modules: mods } });
    if (!c.alive) return;
    if (r.ok) await accept(r.value);
    else await failed(r.error);
    c.sending = false;
    c.inflight = null;
    const next = c.queued?.shift() ?? null; // the oldest waiting change goes next
    if (!next || !c.queued?.length) c.queued = null;
    if (next) return send(next);
    setSending(false);
    if (c.refreshAfter) {
      c.refreshAfter = false;
      refreshRef.current();
    }
  };

  const apply = (next: readonly Module[]) => {
    setModules(next);
    void send(copy(next));
  };
  // (the page now is taken before the change: an updater runs later, after it)
  const commit = (next: readonly Module[]) => {
    if (!canEdit) return;
    const now = copy(modulesRef.current);
    setUndoStack((u) => [...u, now].slice(-UNDO_MAX));
    setRedoStack([]);
    apply(next);
  };
  const undo = () => {
    if (!canEdit || !undoStack.length) return;
    const now = copy(modulesRef.current);
    setRedoStack((r) => [...r, now]);
    apply(undoStack[undoStack.length - 1]!);
    setUndoStack((u) => u.slice(0, -1));
  };
  const redo = () => {
    if (!canEdit || !redoStack.length) return;
    const now = copy(modulesRef.current);
    setUndoStack((u) => [...u, now].slice(-UNDO_MAX));
    apply(redoStack[redoStack.length - 1]!);
    setRedoStack((r) => r.slice(0, -1));
  };

  /** Another layout, new text, a move or a save: after the changes on their way, holding the page while it runs. */
  const exclusive = async (kind: Busy, change: EditChangeDto | null, done: (next: EditorPageDto) => void) => {
    if (!canEdit || q.current.sending || q.current.queued || q.current.exclusive) return;
    q.current.exclusive = true;
    const before = copy(modulesRef.current);
    setBusy(kind);
    setProblem(null);
    setNotice(null);
    const r = change ? await editor.change({ ...where, change }) : await editor.save({ ...where, rev: q.current.rev });
    q.current.exclusive = false;
    if (!q.current.alive) return;
    setBusy(null);
    if (!r.ok) return failed(r.error);
    if (!(await accept(r.value))) return;
    if (kind !== "save" && kind !== "refresh") {
      setUndoStack((u) => [...u, before].slice(-UNDO_MAX));
      setRedoStack([]);
    }
    done(r.value);
  };

  const another = () => {
    const variant = ((q.current.alt % 3) + 1) as 1 | 2 | 3;
    void exclusive("another", { kind: "alternative", rev: q.current.rev, variant }, () => {
      q.current.alt = variant;
      setNotice(`${t(ALT[variant - 1]!)} ${t("pageEditor.altUndo")}`);
    });
  };
  const refresh = () =>
    void exclusive("refresh", { kind: "refresh", rev: q.current.rev }, () => setNotice(t("pageEditor.refreshed")));
  refreshRef.current = refresh;
  /** After a text save: now, or once the changes on their way have settled. */
  const refreshSoon = () => {
    if (q.current.sending) q.current.refreshAfter = true;
    else refresh();
  };
  const save = () => void exclusive("save", null, () => {});
  const moveToPage = (story: string, to: number) => {
    if (lockedHere(story)) return setNotice(t("pageEditor.lockedPage", { name: nameOf(story) }));
    const name = nameOf(story);
    void exclusive("move", { kind: "move", rev: q.current.rev, story, to }, () => {
      setMoveTo("");
      setNotice(t("pageEditor.moved", { name, page: to }));
    });
  };

  // ---------------------------------------------------------------------------------------- open, lock, leave
  useEffect(() => {
    const alive = { alive: true }; // this mount's (StrictMode mounts twice)
    q.current.alive = true;
    void (async () => {
      const r = mayEdit ? await editor.open(where) : await editor.get(where);
      if (!alive.alive) return;
      if (r.ok) await accept(r.value);
      else setLoadProblem(r.error);
    })();
    const tick = async () => {
      const held = lockRef.current;
      if (!held) return;
      if (held.mine) {
        const r = await editor.heartbeat(where);
        if (alive.alive && r.ok) keepLock(r.value);
        if (alive.alive && r.ok && !r.value.mine) await reload(); // it was handed over meanwhile
      } else if (askedRef.current) {
        const r = await editor.takeover(where);
        if (alive.alive && r.ok && r.value.mine) {
          askedRef.current = false;
          setAsked(false);
          await reload();
        } else if (alive.alive && r.ok) keepLock(r.value);
      } else if (mayEdit && !held.holder) {
        const r = await editor.open(where); // the page is free: take it
        if (alive.alive && r.ok) await accept(r.value);
      } else await reload(); // someone else's: follow their changes
    };
    const timer = setInterval(() => void tick(), HEARTBEAT_MS);
    const leave = () => {
      if (lockRef.current?.mine) void editor.release(where); // keepalive: it outlives the page
    };
    window.addEventListener("pagehide", leave);
    return () => {
      alive.alive = false;
      q.current.alive = false;
      clearInterval(timer);
      window.removeEventListener("pagehide", leave);
      leave();
    };
    // the page opens once per mount (the screen's key is the run and page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the run's stories, to reach an article's story in the newsroom (LayoutPage.stories: deskKey → storyId)
  useEffect(() => {
    let alive = true;
    void layout.getRun(where).then((r) => {
      if (!alive || !r.ok) return;
      const ids = new Map<string, string | null>();
      for (const p of r.value.pages) for (const s of p.stories) ids.set(s.deskKey, s.storyId);
      for (const s of r.value.notPlaced) ids.set(s.deskKey, s.storyId);
      setStoryIds(ids);
    });
    return () => {
      alive = false;
    };
  }, [layout, where]);

  // the page in the release view, again whenever the page is saved at a new revision
  const savedRev = data && !data.pageState.editedUnsaved ? data.rev : null;
  const loadReleasePage = useCallback(async () => {
    if (!approve) return;
    const r = await release.get({ orgId: where.orgId, pubId: where.pubId, editionId });
    if (q.current.alive && r.ok)
      setReleasePage(r.value.pages.find((p) => p.runId === where.runId && p.page === where.page) ?? null);
  }, [approve, release, where, editionId]);
  useEffect(() => {
    if (savedRev !== null) void loadReleasePage();
  }, [loadReleasePage, savedRev]);

  /** Approve (bound to the release view's revision and bytes) or unlock; then the page and its approval again. */
  const approval = async (kind: "approve" | "unlock") => {
    setApproving(true);
    setProblem(null);
    setNotice(null);
    const r =
      kind === "unlock"
        ? await release.unlockPage(where)
        : await release.approvePage({ ...where, rev: releasePage!.rev, pdfSha256: releasePage!.pdfSha256! });
    if (!q.current.alive) return;
    setApproving(false);
    if (!r.ok && r.error.kind === "answer" && r.error.code === "approval_stale")
      setNotice(t("editionRelease.page.changed"));
    else if (!r.ok) setProblem(r.error);
    await reload();
    await loadReleasePage();
  };

  // undo and redo from the keyboard (by key position, so a Marathi layout works too); Esc stops swapping
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (e.isComposing) return;
    const target = e.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
      return;
    if (e.key === "Escape" && swapping) return setSwapping(false);
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // ---------------------------------------------------------------------------------------- names and actions
  const noteOf = (story: string) => view?.notes.find((n) => n.story === story);
  const poolOf = (story: string) => view?.pool.find((p) => p.story === story);
  const nameOf = (story: string) => {
    const n = noteOf(story);
    if (n && !n.headline) return t("pageEditor.shortColumn");
    const head = n?.headline ?? poolOf(story)?.headline ?? story;
    return `“${head.slice(0, 60)}”`;
  };
  const lockedHere = (story: string) => modulesRef.current.some((m) => m.story === story && m.locked);
  const sizeText = (m: Module) => t("pageEditor.size", { n: m.w, h: String(Math.round(m.h)) });

  const pick = (story: string | null) => {
    if (swapping && story && selected && story !== selected) {
      setSwapping(false);
      setNotice(null);
      return swap(selected, story);
    }
    setSelected(story);
  };
  const change = (next: Module) => {
    if (lockedHere(next.story)) return setNotice(t("pageEditor.lockedMove", { name: nameOf(next.story) }));
    commit(modulesRef.current.map((m) => (m.story === next.story ? { ...m, ...next } : { ...m })));
  };
  const swap = (a: string, b: string) => {
    const ma = modulesRef.current.find((m) => m.story === a);
    const mb = modulesRef.current.find((m) => m.story === b);
    if (!ma || !mb) return;
    const held = [ma, mb].find((m) => m.locked);
    if (held) return setNotice(t("pageEditor.lockedMove", { name: nameOf(held.story) }));
    // the places change hands; each story keeps its own attributes (its crop belongs to its photo)
    const place = (m: Module) => ({ x: m.x, y: m.y, w: m.w, h: m.h });
    commit(
      modulesRef.current.map((m) =>
        m.story === a ? { ...m, ...place(mb) } : m.story === b ? { ...m, ...place(ma) } : { ...m },
      ),
    );
    setSelected(b);
  };
  const remove = (story: string) => {
    if (lockedHere(story)) return setNotice(t("pageEditor.lockedOff", { name: nameOf(story) }));
    setSelected(null);
    commit(modulesRef.current.filter((m) => m.story !== story).map((m) => ({ ...m })));
  };
  const bringIn = (story: string) => {
    const p = poolOf(story);
    if (!view || !p) return;
    if (p.locked && p.on_page) return setNotice(t("pageEditor.lockedThere", { name: nameOf(story), page: p.on_page }));
    const g = view.grid;
    const h = Math.min(90, g.news_bottom_mm - g.news_top_mm);
    setSelected(story);
    commit([
      ...copy(modulesRef.current),
      snapModule(g, { story, x: g.origin_mm, y: g.news_top_mm, w: 2, h, locked: false }),
    ]);
  };
  const toggleLock = (story: string) =>
    commit(modulesRef.current.map((m) => (m.story === story ? { ...m, locked: !m.locked } : { ...m })));

  const askTakeover = async () => {
    const r = await editor.takeover(where);
    if (!r.ok) return setProblem(r.error);
    keepLock(r.value);
    if (r.value.mine) return reload();
    askedRef.current = true;
    setAsked(true);
  };
  const handOver = async () => {
    const r = await editor.release(where);
    if (!r.ok) return setProblem(r.error);
    await reload();
  };

  const articles = useMemo((): ArticleRef[] => {
    if (!selected) return [];
    const n = view?.notes.find((x) => x.story === selected) ?? view?.pool.find((x) => x.story === selected);
    return (n?.articles ?? []).map((article) => ({
      article,
      storyId: storyIds.get(article) ?? null,
      headline: n?.headline ?? "",
    }));
  }, [selected, view, storyIds]);

  // ---------------------------------------------------------------------------------------- the screen
  if (loadProblem) return <ProblemMessage problem={loadProblem} />;
  if (unreadable)
    return <InlineMessage variant="error" heading={t("pageEditor.unreadable")} iconLabel={t("message.error")} />;
  if (!data || !view) {
    return (
      <p role="status" className="pg-layout__note">
        {t("pageEditor.loading")}
      </p>
    );
  }

  const sel = modules.find((m) => m.story === selected) ?? null;
  const otherPages = data.pages.filter((p) => p.page !== data.page && p.state === "done");
  const role =
    view.role === "front" || view.role === "inside" || view.role === "back" ? roleText(view.role, t) : view.role;
  const busyText: Record<Busy, string> = {
    another: t("pageEditor.busy.another"),
    refresh: t("pageEditor.busy.refresh"),
    save: t("pageEditor.busy.save"),
    move: t("pageEditor.busy.move", { page: moveTo || "…" }),
  };
  const ps = data.pageState;
  const status = sending
    ? t("pageEditor.state.setting")
    : ps.editedUnsaved
      ? t("pageEditor.state.changed")
      : ps.needsSave || ps.stale.length > 0
        ? t("pageEditor.state.needsSave")
        : t("pageEditor.state.saved");
  const approveWhy =
    ps.editedUnsaved || ps.needsSave || ps.stale.length > 0 || releasePage?.needsSave
      ? t("editionRelease.page.needsSave")
      : releasePage && !releasePage.pdfSha256
        ? t("editionRelease.page.noPdf")
        : releasePage && !releasePage.check
          ? t("editionRelease.page.notChecked")
          : null;
  const problemText = (p: PageView["problems"][number]) => {
    const m = problemMsg(p, nameOf);
    if (!m) return p.kind;
    const [key, params] = m;
    return tx(params["n"] === 1 && `${key}.one` in CATALOGUE_ONE ? `${key}.one` : key, params);
  };

  return (
    <div className="pg-editor__wide">
      <Stack gap="4">
        <p className="pg-layout__note">{t("pageEditor.title", { page: data.page, role })}</p>
        {lock && !lock.mine && lock.holder && (
          <InlineMessage variant="info" heading={t("pageEditor.lockedHeading")} iconLabel={t("message.info")}>
            <span>{t("pageEditor.lockedBy", { name: lock.holder.name })}</span>{" "}
            {mayEdit &&
              (asked ? (
                <span>{t("pageEditor.asked", { name: lock.holder.name })}</span>
              ) : (
                <Button variant="secondary" size="sm" onClick={() => void askTakeover()}>
                  {t("pageEditor.askTakeover")}
                </Button>
              ))}
          </InlineMessage>
        )}
        {lock?.mine && lock.askedBy && (
          <InlineMessage
            variant="warning"
            heading={t("pageEditor.asksYou", { name: lock.askedBy.name })}
            iconLabel={t("message.warning")}
          >
            <Button variant="secondary" size="sm" onClick={() => void handOver()}>
              {t("pageEditor.handOver")}
            </Button>
          </InlineMessage>
        )}
        {data.approval ? (
          <InlineMessage
            variant="info"
            heading={t("pageEditor.approved", {
              name: data.approval.by.name,
              time: formatDateTime(data.approval.at, language),
            })}
            iconLabel={t("message.info")}
          >
            {/* InlineMessage wraps its children in a <p> already */}
            <span>{unlock ? t("pageEditor.approvedUnlock") : t("pageEditor.approvedAsk")}</span>{" "}
            {unlock && (
              <Button variant="secondary" size="sm" disabled={approving} onClick={() => void approval("unlock")}>
                {t("editionRelease.page.unlock")}
              </Button>
            )}
          </InlineMessage>
        ) : (
          approve && (
            <div className="pg-editor__status">
              <Button
                variant="secondary"
                size="sm"
                disabled={approving || sending || busy !== null || !!approveWhy || !releasePage}
                onClick={() => void approval("approve")}
              >
                {t("editionRelease.page.approve")}
              </Button>
              {approveWhy && <span className="pg-layout__note">{approveWhy}</span>}
            </div>
          )
        )}
        <Toolbar label={t("pageEditor.toolbar")}>
          <Button variant="quiet" size="sm" disabled={!canEdit || !undoStack.length} onClick={undo}>
            {t("pageEditor.undo")}
          </Button>
          <Button variant="quiet" size="sm" disabled={!canEdit || !redoStack.length} onClick={redo}>
            {t("pageEditor.redo")}
          </Button>
          <Button variant="secondary" size="sm" disabled={!canEdit || sending} onClick={another}>
            {t("pageEditor.another")}
          </Button>
          <Button variant="secondary" size="sm" disabled={!canEdit || sending} onClick={refresh}>
            {t("pageEditor.refresh")}
          </Button>
          <Button variant="primary" size="sm" disabled={!canEdit || sending} onClick={save}>
            {t("pageEditor.save")}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setZoom((z) => clampZoom(z / 1.25))}>
            {t("pageEditor.zoomOut")}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setZoom(1)}>
            {t("pageEditor.zoomFit")}
          </Button>
          <Button variant="quiet" size="sm" onClick={() => setZoom((z) => clampZoom(z * 1.25))}>
            {t("pageEditor.zoomIn")}
          </Button>
        </Toolbar>
        <div aria-live="polite" className="pg-editor__status">
          <Badge tone={sending || busy ? "info" : ps.editedUnsaved || ps.needsSave ? "warning" : "success"}>
            {busy ? busyText[busy] : status}
          </Badge>
          {ps.needsSaveReason && !ps.editedUnsaved && <DeskWords text={ps.needsSaveReason} />}
          {notice && <p className="pg-editor__notice">{notice}</p>}
        </div>
        {problem && <Problem problem={problem} />}
        {data.saved && <SavedResult data={data} />}
        <div className="pg-editor__main">
          <PageCanvas
            view={view}
            modules={modules}
            selected={selected}
            zoom={zoom}
            glyphs={glyphs.current}
            images={images.current}
            drawn={drawn}
            label={t("pageEditor.canvas")}
            sizeText={sizeText}
            onPick={pick}
            onChange={change}
            onLocked={(story) => setNotice(t("pageEditor.lockedMove", { name: nameOf(story) }))}
          />
          <div className="pg-editor__side">
            <Panel title={t("pageEditor.selected")} headingLevel={2}>
              {!sel ? (
                <p className="pg-layout__note">{t("pageEditor.noSelection")}</p>
              ) : (
                <Stack gap="3">
                  <p className="pg-editor__head">
                    {nameOf(sel.story)} <span className="pg-layout__note">{sizeText(sel)}</span>
                  </p>
                  <div className="pg-editor__actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!canEdit || modules.length < 2}
                      onClick={() => {
                        setSwapping(!swapping);
                        setNotice(swapping ? null : t("pageEditor.swapHow"));
                      }}
                    >
                      {swapping ? t("pageEditor.swapStop") : t("pageEditor.swap")}
                    </Button>
                    <Button variant="secondary" size="sm" disabled={!canEdit} onClick={() => remove(sel.story)}>
                      {t("pageEditor.remove")}
                    </Button>
                    <Button variant="quiet" size="sm" disabled={!canEdit} onClick={() => toggleLock(sel.story)}>
                      {sel.locked ? t("pageEditor.unlock") : t("pageEditor.lock")}
                    </Button>
                  </div>
                  {otherPages.length === 0 ? (
                    <p className="pg-layout__note">{t("pageEditor.noOtherPage")}</p>
                  ) : (
                    <div className="pg-editor__actions">
                      <Field label={t("pageEditor.moveTo")}>
                        <Select value={moveTo} disabled={!canEdit} onChange={(e) => setMoveTo(e.target.value)}>
                          <option value="">—</option>
                          {otherPages.map((p) => (
                            <option key={p.page} value={String(p.page)}>
                              {t("pageEditor.pageOption", { page: p.page })}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!canEdit || sending || !moveTo}
                        onClick={() => moveToPage(sel.story, Number(moveTo))}
                      >
                        {t("pageEditor.move")}
                      </Button>
                    </div>
                  )}
                </Stack>
              )}
            </Panel>
            {sel && (
              <Panel title={t("pageEditor.text")} headingLevel={2}>
                <StoryText
                  key={sel.story}
                  orgId={where.orgId}
                  pubId={where.pubId}
                  articles={articles}
                  disabled={!canEdit}
                  drafts={drafts.current}
                  onSaved={refreshSoon}
                />
              </Panel>
            )}
            <Panel title={t("pageEditor.onPage")} headingLevel={2}>
              <ul className="pg-layout__list">
                {modules.map((m) => (
                  <li key={m.story}>
                    <Button variant="quiet" size="sm" aria-pressed={m.story === selected} onClick={() => pick(m.story)}>
                      {swapping && m.story !== selected
                        ? `${t("pageEditor.swapWith")}: ${nameOf(m.story)}`
                        : nameOf(m.story)}
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel title={t("pageEditor.pool")} headingLevel={2}>
              {view.pool.length === 0 ? (
                <p className="pg-layout__note">{t("pageEditor.poolNone")}</p>
              ) : (
                <ul className="pg-layout__list">
                  {view.pool.map((p) => (
                    <li key={p.story} className="pg-editor__row">
                      <span>
                        {nameOf(p.story)}
                        {p.on_page !== null && (
                          <span className="pg-layout__note"> {t("pageEditor.onOther", { page: p.on_page })}</span>
                        )}
                      </span>
                      <Button variant="quiet" size="sm" disabled={!canEdit} onClick={() => bringIn(p.story)}>
                        {t("pageEditor.bringIn")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title={t("pageEditor.problems")} headingLevel={2}>
              {view.problems.length === 0 ? (
                <p className="pg-layout__note">{t("pageEditor.noProblems")}</p>
              ) : (
                <ul className="pg-layout__list">
                  {view.problems.map((p, i) => {
                    const first = p.stories?.[0];
                    return (
                      <li key={i}>
                        {first ? (
                          <Button variant="quiet" size="sm" onClick={() => setSelected(first)}>
                            {problemText(p)}
                          </Button>
                        ) : (
                          problemText(p)
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
            <Panel title={t("pageEditor.history")} headingLevel={2}>
              {!history || history.length === 0 ? (
                <p className="pg-layout__note">{t("pageEditor.historyNone")}</p>
              ) : (
                <ul className="pg-layout__list">
                  {history.map((h) => (
                    <li key={h.rev}>
                      {t("pageEditor.historyItem", { rev: h.rev, cause: t(CAUSE[h.cause]) })}
                      {h.saved && ` (${h.saved.passed ? t("pageEditor.historySaved") : t("pageEditor.historyFailed")})`}
                      <span className="pg-layout__note">
                        {" "}
                        {t("pageEditor.historyBy", {
                          who: h.author?.name ?? t("pageEditor.someone"),
                          time: formatDateTime(h.createdAt, language),
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </Stack>
    </div>
  );
}

const ALT = ["pageEditor.alt.1", "pageEditor.alt.2", "pageEditor.alt.3"] as const;
const CAUSE: Readonly<Record<PageHistoryDto["items"][number]["cause"], PlainKey>> = {
  set: "pageEditor.cause.set",
  alternative: "pageEditor.cause.alternative",
  refresh: "pageEditor.cause.refresh",
  move: "pageEditor.cause.move",
  moved_in: "pageEditor.cause.moved_in",
  save: "pageEditor.cause.save",
  taken: "pageEditor.cause.taken",
  engine: "pageEditor.cause.engine",
};

/** The keys that have a one-form (".one"), for the problems' plurals. */
const CATALOGUE_ONE = {
  "pageEditor.p.oversetLines.one": true,
  "pageEditor.p.oversetWords.one": true,
  "pageEditor.p.unset.one": true,
} as const;

/** A problem; the engine's refusal in its own words. */
function Problem({ problem }: { readonly problem: ApiProblem }) {
  const { t } = useI18n();
  if (problem.kind !== "answer" || problem.code !== "edit_refused" || !problem.current)
    return <ProblemMessage problem={problem} />;
  return (
    <InlineMessage variant="error" heading={t("error.edit_refused")} iconLabel={t("message.error")} live>
      <DeskWords text={problem.current as DeskTextDto} />
    </InlineMessage>
  );
}

/** What a save stored and found: the independent check in the plan's exact words, its warnings, why the page prints
 * older content, and a step after the export that failed. */
function SavedResult({ data }: { readonly data: EditorPageDto }) {
  const { t } = useI18n();
  const saved = data.saved!;
  const check = data.pageState.check;
  const ok = !saved.error && !!check?.passed;
  return (
    <div>
      <InlineMessage
        variant={saved.error || (check && !check.passed) ? "error" : ok && !saved.stale.length ? "success" : "warning"}
        heading={saved.error ? t("pageEditor.saveError") : t("pageEditor.savedHeading")}
        iconLabel={t(ok ? "message.success" : "message.warning")}
        live
      >
        {checkText(check, t)}
        {saved.error && (
          <>
            {" "}
            <DeskWords text={saved.error} />
          </>
        )}
      </InlineMessage>
      {saved.warnings.length > 0 && (
        <>
          <p>{t("pageEditor.saveWarnings")}</p>
          <ul>
            {saved.warnings.map((w, i) => (
              <li key={i}>
                <DeskWords text={w} />
              </li>
            ))}
          </ul>
        </>
      )}
      {saved.stale.length > 0 && (
        <>
          <p>{t("pageEditor.saveStale")}</p>
          <ul>
            {saved.stale.map((w, i) => (
              <li key={i}>
                <DeskWords text={w} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
