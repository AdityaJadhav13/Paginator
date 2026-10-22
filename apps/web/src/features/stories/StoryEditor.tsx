/**
 * The story editor, /org/:orgId/pub/:pubId/stories/:storyId and …/stories/new (plan §10 PR 22), phone first.
 *
 * No keystroke is ever lost or changed:
 * - The boxes show only what the person typed. The API's cleaned text is never written into a box being edited: the
 *   server's text enters the boxes only on opening, "Use their version", "Keep my version" (a merge) and restoring.
 *   What was last sent and accepted (`saved`) is what the next change is measured against.
 * - Autosave: a pause in typing, or leaving a box, sends what changed against the story's version (`baseRevision`). A
 *   save asked for while one is in flight runs right after it; the page being left (pagehide, hidden, unmount) sends
 *   what waits, and the browser warns before closing while anything is unsaved.
 * - A new story is created once it has a headline, with an Idempotency-Key kept with its exact body: a retry after a
 *   lost answer sends the same body (and a reload, from the draft); what was typed since goes in a change after it.
 *   The screen, its boxes, focus and caret stay as they are when the story gets its own address.
 * - 409 story_changed: a three-way merge. Every field that differs is shown, theirs and mine; "Keep my version" puts
 *   only what the person changed on top of theirs, "Use their version" takes theirs. Autosave waits for the choice.
 * - Unsaved text is kept on this device (drafts.ts) with what it was based on; restoring it applies only the person's
 *   changes, through the conflict screen when the story moved on meanwhile.
 * - The boxes are read only while the conflict or the restore question is open, and while a move is being made.
 * - Moves from the story's own `can.transitions`, each with an Idempotency-Key per intent (the send-back comment is
 *   part of it); sending back asks why. Given to: whoever may assign (`can.assign`).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Cluster, Dialog, Field, InlineMessage, ProgressIndicator, Select, Stack, TextArea, TextInput } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type PlainKey, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, MemberDto, StoryDto, TransitionTargetDto } from "../../services/index.ts";
import { OfflineNotice, useOnline } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useTeam } from "../people/services-context.tsx";
import { isDesk, mayCreate, storyScope } from "./access.ts";
import { currentStory } from "./conflict.ts";
import { draftKey, dropDraft, readDraft, writeDraft, type PendingCreate, type StoryDraft, type StoryFields } from "./drafts.ts";
import { moveKey, StatusChip, statusKey } from "./StatusChip.tsx";
import { useStories } from "./stories-context.tsx";
import "./stories.css";

const AUTOSAVE_MS = 1500;
const TEXT_KEYS = ["headline", "kicker", "deck", "byline", "body"] as const;
const DESK_KEYS = ["priority", "pagePin", "deskNote"] as const;
const ALL_KEYS = [...TEXT_KEYS, ...DESK_KEYS] as const;
type FieldKey = keyof StoryFields;

const PRIORITIES = [
  [1, "editor.priority.1"],
  [2, "editor.priority.2"],
  [3, "editor.priority.3"],
  [4, "editor.priority.4"],
] as const;

const FIELD_LABELS: Readonly<Record<FieldKey, PlainKey>> = {
  headline: "glossary.headline",
  kicker: "glossary.kicker",
  deck: "glossary.deck",
  byline: "glossary.byline",
  body: "glossary.bodyText",
  priority: "editor.priority",
  pagePin: "editor.pagePin",
  deskNote: "editor.deskNote",
};

const EMPTY: StoryFields = { headline: "", kicker: "", deck: "", byline: "", body: "", priority: 3, pagePin: null, deskNote: "" };

function fieldsOf(story: StoryDto): StoryFields {
  return {
    headline: story.headline,
    kicker: story.kicker,
    deck: story.deck,
    byline: story.byline,
    body: story.body,
    priority: story.priority,
    pagePin: story.pagePin,
    deskNote: story.deskNote,
  };
}

/** The fields that differ, among those the person may send. */
function changes(from: StoryFields, to: StoryFields, desk: boolean): Partial<StoryFields> {
  const keys: readonly FieldKey[] = desk ? ALL_KEYS : TEXT_KEYS;
  return Object.fromEntries(keys.filter((key) => from[key] !== to[key]).map((key) => [key, to[key]])) as Partial<StoryFields>;
}

const same = (a: StoryFields, b: StoryFields) => ALL_KEYS.every((key) => a[key] === b[key]);

/** The API's cleanText as far as comparing goes: NFC, LF only, no trailing space on a line, stripped. */
const cleaned = (text: string) =>
  text
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .trim();

/** Theirs is exactly mine, as the API cleans text: no choice to make (a change of this device's that arrived late). */
function sameAsMine(theirs: StoryDto, mine: StoryFields): boolean {
  const kept = fieldsOf(theirs);
  return ALL_KEYS.every((key) =>
    typeof mine[key] === "string" ? cleaned(mine[key] as string) === kept[key] : mine[key] === kept[key],
  );
}

/**
 * Whether the story's newer version is this device's own change, sent just before the draft was left (the tab
 * closed while it was on its way): one version on, by this person, with exactly what was being sent.
 */
function ownSend(draft: StoryDraft, story: StoryDto, userId: string): boolean {
  if (!draft.sending || draft.baseRevision === null || story.revision !== draft.baseRevision + 1) return false;
  if (story.updatedBy.id !== userId) return false;
  const theirs = fieldsOf(story);
  const sending = draft.sending;
  return ALL_KEYS.every((key) =>
    typeof sending[key] === "string" ? cleaned(sending[key] as string) === theirs[key] : sending[key] === theirs[key],
  );
}
const countWords = (body: string) => body.split(/\s+/).filter((word) => word !== "").length;
/** No answer came, or the server failed: the change may have been made. A refusal is an answer: nothing was made. */
const unknownOutcome = (problem: ApiProblem) =>
  problem.kind !== "answer" || (problem.status >= 500 && problem.code !== "slow_down");

type Save =
  | { readonly state: "saved" }
  | { readonly state: "pending" }
  | { readonly state: "saving" }
  | { readonly state: "needs-headline" }
  | { readonly state: "failed"; readonly problem: ApiProblem };

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready" };

/** Theirs (the story as it is now), and what mine was written on. */
interface Conflict {
  readonly theirs: StoryDto;
  readonly base: StoryFields;
}

export function StoryEditor() {
  const { orgId = "", pubId = "", storyId: param } = useParams<{ orgId: string; pubId: string; storyId: string }>();
  // one route for both, so that creating the story (new → its id) keeps this screen and what is being typed
  const storyId = param === "new" ? undefined : param;
  const { state } = useSession();
  const { t } = useI18n();
  /** A story this screen just created: its new address must not open it afresh (the text being typed stays). */
  const created = useRef<string | null>(null);
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  if (state.status !== "ready" || !org || (org.twoStep.required && !org.twoStep.satisfied)) return null;
  if (storyScope(org, pubId) === "none" || (!storyId && !mayCreate(org, pubId))) {
    return (
      <Stack gap="4">
        <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
          {t("glossary.story")}
        </h1>
        <InlineMessage variant="info" heading={t("stories.noAccess.heading")} iconLabel={t("message.info")}>
          {t("stories.noAccess.body")}
        </InlineMessage>
      </Stack>
    );
  }
  const fresh = storyId && storyId !== created.current ? storyId : undefined;
  return (
    <EditorContent
      key={`${pubId}:${fresh ?? "new"}`}
      orgId={orgId}
      pubId={pubId}
      storyId={fresh}
      userId={state.session.user.id}
      desk={isDesk(org, pubId)}
      onCreated={(id) => {
        created.current = id;
      }}
    />
  );
}

function EditorContent({
  orgId,
  pubId,
  storyId,
  userId,
  desk,
  onCreated,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly storyId: string | undefined;
  readonly userId: string;
  readonly desk: boolean;
  readonly onCreated: (storyId: string) => void;
}) {
  const stories = useStories();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const online = useOnline();
  const [loaded, setLoaded] = useState<Loaded>(storyId ? { status: "loading" } : { status: "ready" });
  const [story, setStory] = useState<StoryDto | null>(null);
  /** What the boxes show: only the person's typing changes it (and opening, the conflict choice, restoring). */
  const [fields, setFields] = useState<StoryFields>(EMPTY);
  /** What was last sent and accepted (or opened): the base of the next change. Never the server's cleaned text. */
  const [saved, setSaved] = useState<StoryFields>(EMPTY);
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [offered, setOffered] = useState<StoryDraft | null>(null);
  const [moving, setMoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [moveProblem, setMoveProblem] = useState<ApiProblem | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  /** The create sent without a known answer: its key and exact body, retried as they are. */
  const pendingCreate = useRef<PendingCreate | null>(null);
  /** The fields the pending create carries. */
  const createFields = useRef<StoryFields | null>(null);
  const inflight = useRef<Promise<StoryDto | null> | null>(null);
  /** The change on its way to the API, and the version it was made on: every draft written meanwhile names it. */
  const sending = useRef<{ readonly fields: StoryFields; readonly baseRevision: number } | null>(null);
  const moveKeys = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const leaving = useRef(false);
  const latest = useRef({ fields, saved, story, conflict, offered });
  latest.current = { fields, saved, story, conflict, offered };
  /** The story and the base as a save leaves them, at once: a save queued behind it reads them before React renders. */
  const settle = (next: StoryDto, base: StoryFields) => {
    latest.current = { ...latest.current, story: next, saved: base };
    setStory(next);
    setSaved(base);
  };
  const key = draftKey(story?.id ?? storyId, pubId);
  const keyRef = useRef(key);
  keyRef.current = key;
  const editable = story ? story.can.edit : true;
  const dirty = !same(fields, saved);
  /** The boxes take no typing while a question is open or a move is being made (nothing typed can then be lost). */
  const locked = !editable || conflict !== null || offered !== null || moving;

  // open: the story, then any text this device kept for it
  const open = useCallback(
    async (live: boolean) => {
      if (!storyId) {
        const draft = readDraft(userId, draftKey(undefined, pubId));
        if (draft && (!same(draft.fields, EMPTY) || draft.create)) setOffered(draft);
        return;
      }
      const result = await stories.get({ orgId, pubId, storyId });
      if (!mounted.current) return;
      if (!result.ok) return setLoaded({ status: "failed", problem: result.error, live });
      setStory(result.value);
      setFields(fieldsOf(result.value));
      setSaved(fieldsOf(result.value));
      setLoaded({ status: "ready" });
      const draft = readDraft(userId, draftKey(storyId, pubId));
      if (draft && !same(draft.fields, fieldsOf(result.value))) setOffered(draft);
      else if (draft) dropDraft(userId, draftKey(storyId, pubId));
    },
    [orgId, pubId, stories, storyId, userId],
  );
  useEffect(() => {
    void open(false);
  }, [open]);

  // every change is kept on this device until the API has it (never while the restore question is open: the boxes
  // still show the API's text then)
  useEffect(() => {
    if (offered || (!dirty && !pendingCreate.current)) return;
    const onItsWay = sending.current;
    writeDraft(userId, key, {
      fields,
      base: conflict?.base ?? saved,
      baseRevision: onItsWay?.baseRevision ?? story?.revision ?? null,
      ...(onItsWay ? { sending: onItsWay.fields } : {}),
      ...(pendingCreate.current ? { create: pendingCreate.current } : {}),
      savedAt: new Date().toISOString(),
    });
  }, [conflict, dirty, fields, key, offered, saved, story?.revision, userId]);

  /** One save: what changed since `saved`, or the create. Null when nothing could be saved. */
  const saveOnce = useCallback(async (): Promise<StoryDto | null> => {
    const { fields: now, saved: base, story: current, conflict: open, offered: asking } = latest.current;
    if (open || asking) return null; // the person's choice comes first
    if (current && same(now, base)) return current;
    const keepalive = leaving.current;
    if (!current) {
      if (!pendingCreate.current) {
        if (now.headline.trim() === "") {
          if (mounted.current) setSave({ state: "needs-headline" });
          return null;
        }
        pendingCreate.current = { key: randomUuid(), input: { ...changes(EMPTY, now, desk), headline: now.headline } };
        createFields.current = now;
        // the key and its body go on this device first: a retry after a lost answer, even after a reload, is the same
        writeDraft(userId, draftKey(undefined, pubId), {
          fields: now,
          base: EMPTY,
          baseRevision: null,
          create: pendingCreate.current,
          savedAt: new Date().toISOString(),
        });
      }
      const create = pendingCreate.current;
      const sentFields = createFields.current ?? { ...EMPTY, ...create.input };
      if (mounted.current) setSave({ state: "saving" });
      const result = await stories.create({ orgId, pubId, input: create.input, idempotencyKey: create.key });
      if (!result.ok) {
        // an answer means nothing was made: the next try is a new create of whatever the boxes hold then
        if (!unknownOutcome(result.error)) {
          pendingCreate.current = null;
          createFields.current = null;
        }
        if (mounted.current) setSave({ state: "failed", problem: result.error });
        return null;
      }
      const made = result.value;
      pendingCreate.current = null;
      createFields.current = null;
      dropDraft(userId, draftKey(undefined, pubId));
      latest.current = { ...latest.current, story: made, saved: sentFields };
      if (!mounted.current) {
        // the screen is gone: what was typed after the create waits on this device, under the story's own key
        const typed = latest.current.fields;
        if (!same(typed, sentFields)) {
          writeDraft(userId, made.id, { fields: typed, base: sentFields, baseRevision: made.revision, savedAt: new Date().toISOString() });
        }
        return made;
      }
      settle(made, sentFields);
      const typedSince = !same(latest.current.fields, sentFields);
      setSave({ state: typedSince ? "pending" : "saved" });
      onCreated(made.id);
      // the same screen takes the story's own address: no remount, and the person keeps typing where they were
      navigate(paths.pubStory(orgId, pubId, made.id), { replace: true, state: { keepFocus: true } });
      return made;
    }
    const sent = now;
    const patch = changes(base, sent, desk);
    if (Object.keys(patch).length === 0) {
      if (mounted.current) setSaved(sent);
      return current;
    }
    if (mounted.current) setSave({ state: "saving" });
    // on this device first: if the page is closed before the answer, reopening can tell this change was its own
    sending.current = { fields: sent, baseRevision: current.revision };
    writeDraft(userId, keyRef.current, {
      fields: latest.current.fields,
      base,
      baseRevision: current.revision,
      sending: sent,
      savedAt: new Date().toISOString(),
    });
    const result = await stories.update({
      orgId,
      pubId,
      storyId: current.id,
      patch: { baseRevision: current.revision, ...patch },
      ...(keepalive ? { keepalive } : {}),
    });
    sending.current = null;
    if (result.ok) latest.current = { ...latest.current, story: result.value, saved: sent };
    if (!mounted.current) return result.ok ? result.value : null;
    if (!result.ok) {
      const theirs = currentStory(result.error);
      if (theirs && sameAsMine(theirs, sent)) {
        // the newer version already says exactly this (this device's own change, sent as the page was left)
        settle(theirs, sent);
        setSave({ state: same(latest.current.fields, sent) ? "saved" : "pending" });
        if (same(latest.current.fields, sent)) dropDraft(userId, keyRef.current);
        return theirs;
      }
      if (theirs) {
        setConflict({ theirs, base });
        setSave({ state: "pending" });
      } else setSave({ state: "failed", problem: result.error });
      return null;
    }
    const answer = result.value;
    settle(answer, sent); // what was sent, not the server's cleaned text: the boxes keep exactly what was typed
    const typedSince = !same(latest.current.fields, sent);
    if (!typedSince) dropDraft(userId, keyRef.current);
    setSave({ state: typedSince ? "pending" : "saved" });
    return answer;
  }, [desk, navigate, onCreated, orgId, pubId, stories, userId]);

  /** Save now; a save asked for during another runs right after it. Resolves to the story once all have settled. */
  const flush = useCallback((): Promise<StoryDto | null> => {
    if (inflight.current) return inflight.current.then(() => flushRef.current());
    if (mounted.current) setSaving(true);
    const run = saveOnce().finally(() => {
      inflight.current = null;
      if (mounted.current) setSaving(false);
    });
    inflight.current = run;
    return run;
  }, [saveOnce]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // autosave after a pause in typing; again after each save while something still waits
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!dirty || conflict || offered || !editable || loaded.status !== "ready") return;
    setSave((previous) => (previous.state === "failed" || previous.state === "saving" ? previous : { state: "pending" }));
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [conflict, dirty, editable, fields, flush, loaded.status, offered, saved]);

  // back online: send what waited
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current && latest.current && !same(latest.current.fields, latest.current.saved)) void flush();
    wasOnline.current = online;
  }, [flush, online]);

  // leaving the page or the screen: send what waits (the draft stays on this device until the API has it), and have
  // the browser ask before closing while something is unsaved
  useEffect(() => {
    mounted.current = true;
    const waiting = () => !same(latest.current.fields, latest.current.saved) || inflight.current !== null || pendingCreate.current !== null;
    const sendNow = () => {
      if (!waiting()) return;
      leaving.current = true;
      void flushRef.current().finally(() => {
        leaving.current = false;
      });
    };
    const hidden = () => document.visibilityState === "hidden" && sendNow();
    const warn = (event: BeforeUnloadEvent) => {
      if (!waiting()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("pagehide", sendNow);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("pagehide", sendNow);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("beforeunload", warn);
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
      if (waiting()) {
        leaving.current = true;
        void flushRef.current();
      }
    };
  }, []);

  const change = (field: FieldKey) => (value: string | number | null) => {
    setNotice(null);
    setFields((current) => ({ ...current, [field]: value }));
  };
  const leaveBox = () => {
    if (!locked && dirty) void flush();
  };

  const move = async (to: TransitionTargetDto, comment?: string): Promise<boolean> => {
    setNotice(null);
    setMoveProblem(null);
    setMoving(true);
    try {
      const current = await flush();
      if (!current || !mounted.current) return false;
      // one key per intent: the same move from the same version with the same comment is the same request
      const intent = `${to}@${current.revision}#${comment ?? ""}`;
      const idempotencyKey = moveKeys.current.get(intent) ?? randomUuid();
      moveKeys.current.set(intent, idempotencyKey);
      const result = await stories.transition({
        orgId,
        pubId,
        storyId: current.id,
        to,
        baseRevision: current.revision,
        ...(comment ? { comment } : {}),
        idempotencyKey,
      });
      if (!mounted.current) return result.ok;
      if (!result.ok) {
        const theirs = currentStory(result.error);
        if (theirs) setConflict({ theirs, base: latest.current.saved });
        else setMoveProblem(result.error);
        return false;
      }
      // a move changes the state, not the text: the boxes (read only meanwhile) stay as they are
      latest.current = { ...latest.current, story: result.value };
      setStory(result.value);
      setNotice(t("editor.moved", { status: t(statusKey(result.value.status)) }));
      return true;
    } finally {
      if (mounted.current) setMoving(false);
    }
  };

  /** Three-way: only what the person changed since `base`, on top of theirs; autosave then sends it. */
  const keepMine = () => {
    if (!conflict) return;
    const theirs = fieldsOf(conflict.theirs);
    const mine = changes(conflict.base, fields, true);
    setStory(conflict.theirs);
    setSaved(theirs);
    setFields({ ...theirs, ...mine });
    setConflict(null);
  };
  const takeTheirs = () => {
    if (!conflict) return;
    setStory(conflict.theirs);
    setSaved(fieldsOf(conflict.theirs));
    setFields(fieldsOf(conflict.theirs));
    dropDraft(userId, key);
    setConflict(null);
    setSave({ state: "saved" });
  };
  const restore = () => {
    if (!offered) return;
    const draft = offered;
    setOffered(null);
    if (!story) {
      // a story not created yet: its text, and the create it may have sent already
      setFields(draft.fields);
      pendingCreate.current = draft.create ?? null;
      createFields.current = draft.create ? { ...EMPTY, ...draft.create.input } : null;
      return;
    }
    if (draft.baseRevision === story.revision) {
      setFields({ ...fieldsOf(story), ...changes(draft.base, draft.fields, true) });
      return;
    }
    if (ownSend(draft, story, userId) && draft.sending) {
      // the newer version is the change this device was sending: the rest goes on top of it
      setFields({ ...fieldsOf(story), ...changes(draft.sending, draft.fields, true) });
      return;
    }
    // the story moved on since: the person chooses, field by field
    setFields(draft.fields);
    setConflict({ theirs: story, base: draft.base });
  };

  if (loaded.status === "loading") return <ProgressIndicator role="status" label={t("editor.loading")} />;
  if (loaded.status === "failed") {
    return (
      <Stack gap="4">
        <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
          {t("glossary.story")}
        </h1>
        <ProblemMessage problem={loaded.problem} live={loaded.live} />
        <Cluster gap="3">
          <Button variant="secondary" onClick={() => void open(true)}>
            {t("form.retry")}
          </Button>
          <Link to={paths.pubStories(orgId, pubId)}>{t("editor.back")}</Link>
        </Cluster>
      </Stack>
    );
  }

  const textLang = story?.language || undefined;
  return (
    <div className="pg-editor">
      <Stack gap="5">
        <p>
          <Link to={paths.pubStories(orgId, pubId)}>{t("editor.back")}</Link>
        </p>
        <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1} lang={story ? textLang : undefined}>
          {story ? story.headline || t("editor.untitled") : t("editor.newTitle")}
        </h1>
        <OfflineNotice />
        {story && (
          <p className="pg-type-body-small">
            <StatusChip status={story.status} /> {t("editor.reporter", { name: story.reporter.name })} ·{" "}
            {t("editor.words", { count: dirty ? countWords(fields.body) : story.words })}
          </p>
        )}
        <SaveState save={save} dirty={dirty} editable={editable} onSave={() => void flush()} />
        <div aria-live="polite">{notice && <p>{notice}</p>}</div>
        {!editable && <p>{t("editor.readOnly")}</p>}

        {offered && (
          <InlineMessage variant="warning" heading={t("editor.draft.heading")} iconLabel={t("message.warning")}>
            <Stack gap="3">
              <p>{t("editor.draft.body", { date: formatDateTime(offered.savedAt, language) })}</p>
              {story && offered.baseRevision !== null && offered.baseRevision !== story.revision && !ownSend(offered, story, userId) && (
                <p>{t("editor.draft.changedSince")}</p>
              )}
              <Cluster gap="3">
                <Button onClick={restore}>{t("editor.draft.restore")}</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    dropDraft(userId, key);
                    setOffered(null);
                  }}
                >
                  {t("editor.draft.discard")}
                </Button>
              </Cluster>
            </Stack>
          </InlineMessage>
        )}

        {conflict && (
          <ConflictPanel conflict={conflict} mine={fields} lang={textLang} onKeepMine={keepMine} onTakeTheirs={takeTheirs} />
        )}

        <form noValidate onSubmit={(event) => (event.preventDefault(), void flush())} aria-busy={moving}>
          <Stack gap="4">
            <Field
              label={t("glossary.headline")}
              description={story ? undefined : t("editor.headlineHint")}
              errors={save.state === "needs-headline" ? [t("editor.headlineMissing")] : []}
            >
              <TextInput
                lang={textLang}
                value={fields.headline}
                readOnly={locked}
                onChange={(event) => change("headline")(event.target.value)}
                onBlur={leaveBox}
              />
            </Field>
            {/* phone first: the text comes right after the headline */}
            <Field label={t("glossary.bodyText")}>
              <TextArea
                lang={textLang}
                rows={16}
                value={fields.body}
                readOnly={locked}
                onChange={(event) => change("body")(event.target.value)}
                onBlur={leaveBox}
              />
            </Field>
            <Field label={t("glossary.byline")}>
              <TextInput lang={textLang} value={fields.byline} readOnly={locked} onChange={(event) => change("byline")(event.target.value)} onBlur={leaveBox} />
            </Field>
            <Field label={t("glossary.kicker")}>
              <TextInput lang={textLang} value={fields.kicker} readOnly={locked} onChange={(event) => change("kicker")(event.target.value)} onBlur={leaveBox} />
            </Field>
            <Field label={t("glossary.deck")}>
              <TextInput lang={textLang} value={fields.deck} readOnly={locked} onChange={(event) => change("deck")(event.target.value)} onBlur={leaveBox} />
            </Field>
            {desk && (
              <fieldset className="pg-radio-group">
                <legend className="pg-radio-group__legend">{t("editor.desk")}</legend>
                <Stack gap="3">
                  <Cluster gap="4">
                    <Field label={t("editor.priority")}>
                      <Select
                        value={String(fields.priority)}
                        disabled={locked}
                        onChange={(event) => change("priority")(Number(event.target.value))}
                      >
                        {PRIORITIES.map(([level, label]) => (
                          <option key={level} value={level}>
                            {t(label)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t("editor.pagePin")}>
                      <Select
                        value={fields.pagePin === null ? "" : String(fields.pagePin)}
                        disabled={locked}
                        onChange={(event) => change("pagePin")(event.target.value === "" ? null : Number(event.target.value))}
                      >
                        <option value="">{t("editor.pagePin.any")}</option>
                        {Array.from({ length: 16 }, (_, index) => index + 1).map((page) => (
                          <option key={page} value={page}>
                            {t("editor.pagePin.page", { page })}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </Cluster>
                  <Field label={t("editor.deskNote")} description={t("editor.deskNoteHint")}>
                    <TextInput value={fields.deskNote} readOnly={locked} onChange={(event) => change("deskNote")(event.target.value)} onBlur={leaveBox} />
                  </Field>
                </Stack>
              </fieldset>
            )}
          </Stack>
        </form>

        {story && story.can.transitions.length > 0 && (
          <section aria-labelledby="pg-editor-moves">
            <Stack gap="3">
              <h2 id="pg-editor-moves" className="pg-type-section-title">
                {t("editor.moves")}
              </h2>
              {moveProblem && <ProblemMessage problem={moveProblem} />}
              <Cluster gap="3">
                {story.can.transitions.map((to) => (
                  <Button
                    key={to}
                    variant={to === "spiked" ? "danger" : to === "filed" || to === "ready" ? "primary" : "secondary"}
                    disabled={moving || conflict !== null}
                    aria-busy={moving}
                    onClick={() => (to === "draft" ? setSendingBack(true) : void move(to))}
                  >
                    {t(moveKey(to))}
                  </Button>
                ))}
              </Cluster>
              {(moving || saving) && <p className="pg-type-body-small">{moving ? t("editor.moving") : t("editor.saving")}</p>}
            </Stack>
          </section>
        )}

        {story && story.can.assign && (
          <Assignment orgId={orgId} pubId={pubId} story={story} onChanged={(next, text) => (setStory(next), setNotice(text))} onConflict={(theirs) => setConflict({ theirs, base: latest.current.saved })} />
        )}

        {sendingBack && (
        <SendBackDialog
          open={sendingBack}
          onClose={() => setSendingBack(false)}
          onSend={async (comment) => {
            const moved = await move("draft", comment);
            if (moved) setSendingBack(false);
            return moved;
          }}
        />
        )}
      </Stack>
    </div>
  );
}

function valueText(key: FieldKey, fields: StoryFields, t: Translate): string {
  if (key === "priority") {
    const label = PRIORITIES.find(([level]) => level === fields.priority)?.[1];
    return label ? t(label) : String(fields.priority);
  }
  if (key === "pagePin") return fields.pagePin === null ? t("editor.pagePin.any") : t("editor.pagePin.page", { page: fields.pagePin });
  return fields[key];
}

/** Every field where theirs and mine differ, side by side, and the two choices. */
function ConflictPanel({
  conflict,
  mine,
  lang,
  onKeepMine,
  onTakeTheirs,
}: {
  readonly conflict: Conflict;
  readonly mine: StoryFields;
  readonly lang: string | undefined;
  readonly onKeepMine: () => void;
  readonly onTakeTheirs: () => void;
}) {
  const { t } = useI18n();
  const theirs = fieldsOf(conflict.theirs);
  const differing = ALL_KEYS.filter((key) => theirs[key] !== mine[key]);
  const textual = (key: FieldKey) => (TEXT_KEYS as readonly FieldKey[]).includes(key);
  return (
    <section aria-labelledby="pg-editor-conflict" className="pg-editor__conflict">
      <Stack gap="4">
        <h2 id="pg-editor-conflict" className="pg-type-section-title">
          {t("editor.conflict.heading")}
        </h2>
        <p role="alert">{t("editor.conflict.body", { name: conflict.theirs.updatedBy.name })}</p>
        <p>{t("editor.conflict.keepHint")}</p>
        {differing.map((key) => (
          <div key={key}>
            <h3 className="pg-type-body">
              <strong>{t(FIELD_LABELS[key])}</strong>
            </h3>
            <div className="pg-editor__versions">
              <div className="pg-editor__version">
                <p className="pg-type-body-small">{t("editor.conflict.theirs")}</p>
                <p lang={textual(key) ? lang : undefined}>{valueText(key, theirs, t)}</p>
              </div>
              <div className="pg-editor__version">
                <p className="pg-type-body-small">{t("editor.conflict.mine")}</p>
                <p lang={textual(key) ? lang : undefined}>{valueText(key, mine, t)}</p>
              </div>
            </div>
          </div>
        ))}
        <Cluster gap="3">
          <Button onClick={onKeepMine}>{t("editor.conflict.keepMine")}</Button>
          <Button variant="secondary" onClick={onTakeTheirs}>
            {t("editor.conflict.takeTheirs")}
          </Button>
        </Cluster>
      </Stack>
    </section>
  );
}

function SaveState({
  save,
  dirty,
  editable,
  onSave,
}: {
  readonly save: Save;
  readonly dirty: boolean;
  readonly editable: boolean;
  readonly onSave: () => void;
}) {
  const { t } = useI18n();
  if (!editable) return null;
  if (save.state === "failed") {
    return (
      <Stack gap="3">
        <InlineMessage variant="warning" heading={t("editor.saveFailed")} iconLabel={t("message.warning")} />
        <ProblemMessage problem={save.problem} live={false} />
        <div>
          <Button variant="secondary" onClick={onSave}>
            {t("editor.saveNow")}
          </Button>
        </div>
      </Stack>
    );
  }
  const text = save.state === "saving" ? t("editor.saving") : dirty ? t("editor.unsaved") : t("editor.saved");
  return (
    <p className="pg-type-body-small" role="status">
      {text}
    </p>
  );
}

function SendBackDialog({
  open,
  onClose,
  onSend,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onSend: (comment: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [comment, setComment] = useState("");
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (comment.trim() === "") return setMissing(true);
    setMissing(false);
    setPending(true);
    const sent = await onSend(comment.trim());
    setPending(false);
    if (sent) setComment("");
  };
  return (
    <Dialog open={open} onClose={onClose} title={t("editor.sendBack.title")} closeLabel={t("shell.closeDialog")} dismissible={!pending}>
      <form noValidate onSubmit={submit} aria-busy={pending}>
        <Stack gap="4">
          <Field
            label={t("editor.sendBack.comment")}
            description={t("editor.sendBack.hint")}
            errors={missing ? [t("editor.sendBack.missing")] : []}
          >
            <TextArea rows={4} value={comment} onChange={(event) => setComment(event.target.value)} />
          </Field>
          <Cluster gap="3">
            <Button type="submit">{t("move.draft")}</Button>
            <Button variant="secondary" onClick={onClose}>
              {t("security.cancel")}
            </Button>
          </Cluster>
        </Stack>
      </form>
    </Dialog>
  );
}

/** Who the story is given to. The candidates: the team (when the person may see it), else the people this story names. */
function Assignment({
  orgId,
  pubId,
  story,
  onChanged,
  onConflict,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly story: StoryDto;
  readonly onChanged: (story: StoryDto, notice: string) => void;
  readonly onConflict: (story: StoryDto) => void;
}) {
  const stories = useStories();
  const team = useTeam();
  const { state } = useSession();
  const { t } = useI18n();
  const [members, setMembers] = useState<readonly MemberDto[] | null>(null);
  const [chosen, setChosen] = useState(story.assignee?.id ?? "");
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => setChosen(story.assignee?.id ?? ""), [story.assignee?.id]);
  useEffect(() => {
    let active = true;
    void team.listMembers({ orgId }).then((result) => {
      if (active && result.ok) setMembers(result.value);
    });
    return () => {
      active = false;
    };
  }, [orgId, team]);

  const candidates = useMemo(() => {
    const people = new Map<string, string>();
    if (members) {
      for (const member of members) {
        const reaches = member.orgRole !== "member" || member.publications.some((grant) => grant.publicationId === pubId);
        if (member.status === "active" && reaches) people.set(member.userId, member.name);
      }
    }
    if (state.status === "ready") people.set(state.session.user.id, state.session.user.name);
    people.set(story.reporter.id, story.reporter.name);
    if (story.assignee) people.set(story.assignee.id, story.assignee.name);
    return [...people].sort((a, b) => a[1].localeCompare(b[1]));
  }, [members, pubId, state, story.assignee, story.reporter]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    setPending(true);
    const userId = chosen === "" ? null : chosen;
    const result = await stories.assign({ orgId, pubId, storyId: story.id, baseRevision: story.revision, userId });
    setPending(false);
    if (!result.ok) {
      const theirs = currentStory(result.error);
      if (theirs) onConflict(theirs);
      else setProblem(result.error);
      return;
    }
    onChanged(
      result.value,
      result.value.assignee ? t("editor.assigned", { name: result.value.assignee.name }) : t("editor.unassigned"),
    );
  };

  return (
    <form noValidate onSubmit={submit} aria-busy={pending}>
      <Stack gap="3">
        {problem && <ProblemMessage problem={problem} />}
        <Cluster gap="3">
          <Field label={t("editor.assignee")}>
            <Select value={chosen} onChange={(event) => setChosen(event.target.value)}>
              <option value="">{t("editor.assign.none")}</option>
              {candidates.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" variant="secondary">
            {t("editor.assign.submit")}
          </Button>
        </Cluster>
      </Stack>
    </form>
  );
}
