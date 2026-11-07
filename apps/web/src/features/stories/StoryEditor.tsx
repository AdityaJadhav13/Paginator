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
import {
  Button,
  Checkbox,
  Cluster,
  Dialog,
  Field,
  Icon,
  InlineMessage,
  PageHeader,
  Panel,
  ProgressIndicator,
  Select,
  Stack,
  TextArea,
  TextInput,
} from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type PlainKey, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, MemberDto, SectionDto, StoryDto, TransitionTargetDto } from "../../services/index.ts";
import { useLayout } from "../layout/layout-context.tsx";
import { OfflineNotice, useOnline } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { useTeam } from "../people/services-context.tsx";
import { isDesk, mayCreate, mayUpload, mayViewMedia, storyScope } from "./access.ts";
import { CommentsPanel } from "./CommentsPanel.tsx";
import { PhotoPanel, type PhotoDefaults, type PhotoOutcome } from "./PhotoPanel.tsx";
import { currentStory } from "./conflict.ts";
import { draftKey, dropDraft, readDraft, writeDraft, type PendingCreate, type StoryDraft, type StoryFields } from "./drafts.ts";
import { moveKey, StatusChip, statusKey } from "./StatusChip.tsx";
import { useStories } from "./stories-context.tsx";
import { usePublicationEditions } from "../editions/editions-context.tsx";
import "./stories.css";
import "../news/news.css";

const AUTOSAVE_MS = 1500;
const TEXT_KEYS = ["headline", "kicker", "deck", "byline", "body"] as const;
const DESK_KEYS = ["priority", "pagePin", "editionId", "deskNote"] as const;
/** The photo's own fields: sent with PATCH …/photo, not with the story's PATCH. */
const PHOTO_KEYS = ["caption", "credit"] as const;
/** The story's own fields whoever edits it may send: its text and its section. */
const OWN_KEYS = [...TEXT_KEYS, "sectionId"] as const;
const ALL_KEYS = [...OWN_KEYS, ...DESK_KEYS, ...PHOTO_KEYS] as const;
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
  editionId: "glossary.edition.issue",
  sectionId: "editor.section",
  deskNote: "editor.deskNote",
  caption: "glossary.caption",
  credit: "glossary.photoCredit",
};

const EMPTY: StoryFields = {
  headline: "",
  kicker: "",
  deck: "",
  byline: "",
  body: "",
  priority: 3,
  pagePin: null,
  editionId: null,
  sectionId: null,
  deskNote: "",
  caption: "",
  credit: "",
};

function fieldsOf(story: StoryDto): StoryFields {
  return {
    headline: story.headline,
    kicker: story.kicker,
    deck: story.deck,
    byline: story.byline,
    body: story.body,
    priority: story.priority,
    pagePin: story.pagePin,
    editionId: story.edition?.id ?? null,
    sectionId: story.sectionId,
    deskNote: story.deskNote,
    caption: story.photo?.caption ?? "",
    credit: story.photo?.credit ?? "",
  };
}

/** The story's fields that differ (for its PATCH), among those the person may send; `all` adds the photo's. */
function changes(from: StoryFields, to: StoryFields, desk: boolean | "all"): Partial<StoryFields> {
  const keys: readonly FieldKey[] = desk === "all" ? ALL_KEYS : desk ? [...OWN_KEYS, ...DESK_KEYS] : OWN_KEYS;
  return Object.fromEntries(keys.filter((key) => from[key] !== to[key]).map((key) => [key, to[key]])) as Partial<StoryFields>;
}

/** The photo's caption and credit that differ (for PATCH …/photo). */
function photoChanges(from: StoryFields, to: StoryFields): { caption?: string; credit?: string } {
  return Object.fromEntries(PHOTO_KEYS.filter((key) => from[key] !== to[key]).map((key) => [key, to[key]]));
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

/**
 * A newer version heard live, merged field by field against what the boxes were based on (`base`): a field only they
 * changed takes theirs (`taken`); one only the person changed keeps the person's text, sent next on top of theirs; one
 * that already says what theirs says stays as typed. Null when both changed a field differently, or the person wrote a
 * caption or credit for a photo that has since changed: their next save then meets the new version, and the conflict
 * screen asks.
 */
function liveMerge(
  base: StoryFields,
  mine: StoryFields,
  theirs: StoryFields,
  photoChanged: boolean,
): { readonly fields: StoryFields; readonly saved: StoryFields; readonly taken: readonly FieldKey[] } | null {
  if (photoChanged && (mine.caption !== base.caption || mine.credit !== base.credit)) return null;
  const agrees = (key: FieldKey, value: StoryFields[FieldKey]) =>
    typeof value === "string" ? cleaned(value) === theirs[key] : value === theirs[key];
  const fields: Record<string, StoryFields[FieldKey]> = { ...mine };
  const saved: Record<string, StoryFields[FieldKey]> = { ...theirs };
  const taken: FieldKey[] = [];
  for (const key of ALL_KEYS) {
    if (agrees(key, mine[key])) saved[key] = mine[key];
    else if (agrees(key, base[key])) saved[key] = base[key];
    else if (mine[key] === base[key]) {
      fields[key] = theirs[key];
      taken.push(key);
    } else return null;
  }
  return { fields: fields as unknown as StoryFields, saved: saved as unknown as StoryFields, taken };
}

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
  // the versions this device's own change makes: one per request it sent (the photo's, then the story's)
  if (!draft.sending || draft.baseRevision === null || story.revision !== draft.baseRevision + (draft.sendingSteps ?? 1)) {
    return false;
  }
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
  /** The photo the person's caption and credit were written for (null: none). */
  readonly baseAssetId: string | null;
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
        <PageHeader title={t("glossary.story")} headingId={ROUTE_HEADING_ID} />
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
      photoEditor={(org.publications.find((publication) => publication.id === pubId)?.roles ?? []).includes("photo_editor")}
      mayUpload={mayUpload(org, pubId)}
      mayView={mayViewMedia(org, pubId)}
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
  photoEditor,
  mayUpload: uploads,
  mayView,
  onCreated,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly storyId: string | undefined;
  readonly userId: string;
  readonly desk: boolean;
  /** A Photo Editor of the publication: sets the photo of any story they see but a spiked one. */
  readonly photoEditor: boolean;
  /** media.upload on the publication. */
  readonly mayUpload: boolean;
  /** media.view on the publication: showing and downloading the original. */
  readonly mayView: boolean;
  readonly onCreated: (storyId: string) => void;
}) {
  const stories = useStories();
  const navigate = useNavigate();
  const { t, language } = useI18n();
  /** The publication's editions for the desk's Edition picker, with the story's own (it may not be listed yet). */
  const listedEditions = usePublicationEditions(orgId, pubId, desk);
  const layout = useLayout();
  /** The publication's sections for the Section picker (publication.view); none listed while they load, or if that fails. */
  const [sections, setSections] = useState<readonly SectionDto[]>([]);
  useEffect(() => {
    let live = true;
    void layout.listSections({ orgId, pubId }).then((result) => {
      if (live && result.ok) setSections(result.value.items);
    });
    return () => {
      live = false;
    };
  }, [layout, orgId, pubId]);
  const online = useOnline();
  const [loaded, setLoaded] = useState<Loaded>(storyId ? { status: "loading" } : { status: "ready" });
  const [story, setStory] = useState<StoryDto | null>(null);
  const editionDates = useMemo(() => {
    const dates = new Map((listedEditions ?? []).map((edition) => [edition.id, edition.date]));
    if (story?.edition && !dates.has(story.edition.id)) dates.set(story.edition.id, story.edition.date);
    return dates;
  }, [listedEditions, story?.edition]);
  /** What the boxes show: only the person's typing changes it (and opening, the conflict choice, restoring). */
  const [fields, setFields] = useState<StoryFields>(EMPTY);
  /** What was last sent and accepted (or opened): the base of the next change. Never the server's cleaned text. */
  const [saved, setSaved] = useState<StoryFields>(EMPTY);
  const [save, setSave] = useState<Save>({ state: "saved" });
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [offered, setOffered] = useState<StoryDraft | null>(null);
  const [moving, setMoving] = useState(false);
  /** Who took the photo off while the person was writing its caption (said with the caption kept). */
  const [photoGoneBy, setPhotoGoneBy] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [moveProblem, setMoveProblem] = useState<ApiProblem | null>(null);
  const [sendingBack, setSendingBack] = useState(false);
  /** The story was deleted, or is no longer the person's to see (a live update found it so). */
  const [gone, setGone] = useState(false);
  /** A live change waits for the box being typed in to be left, or the input method to end composing. */
  const held = useRef(false);
  const composing = useRef(false);
  /** The same, for rendering: no autosave and no read-only box while an input method composes (a half-made word). */
  const [composingNow, setComposingNow] = useState(false);
  /** The box the person was in when the story was taken out of their hands: it takes their typing until they leave it
   * (kept on this device, said to be unsaved), so no keystroke is refused unseen. */
  const [typingOn, setTypingOn] = useState<string | null>(null);
  /** A live fetch is queued and has not started: another event needs no other fetch. */
  const queued = useRef(false);
  /** The create sent without a known answer: its key and exact body, retried as they are. */
  const pendingCreate = useRef<PendingCreate | null>(null);
  /** The fields the pending create carries. */
  const createFields = useRef<StoryFields | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const busy = useRef(0);
  /** The change on its way to the API, and the version it was made on: every draft written meanwhile names it. */
  const sending = useRef<{ readonly fields: StoryFields; readonly baseRevision: number; readonly steps: number } | null>(null);
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
  /** The conflict screen, with the photo the person's caption and credit were written for. */
  const openConflict = (theirs: StoryDto, base: StoryFields, baseAssetId?: string | null) => {
    if (!mounted.current) return;
    setConflict({ theirs, base, baseAssetId: baseAssetId === undefined ? (latest.current.story?.photo?.assetId ?? null) : baseAssetId });
  };
  const key = draftKey(story?.id ?? storyId, pubId);
  const keyRef = useRef(key);
  keyRef.current = key;
  const editable = story ? story.can.edit : true;
  /** The API's canAttachPhoto: whoever edits the story, or a Photo Editor on any story they see but a spiked one. */
  const photoFor = useCallback(
    (of: StoryDto | null) => Boolean(of) && uploads && (of!.can.edit || (photoEditor && of!.status !== "spiked")),
    [photoEditor, uploads],
  );
  const mayPhoto = photoFor(story);
  const dirty = !same(fields, saved);
  /** The boxes take no typing while a question is open or a move is being made (nothing typed can then be lost). */
  const locked = !editable || conflict !== null || offered !== null || moving || gone;
  /** The chosen edition's page count, when it is listed; a page pin past it is refused by the API (400). */
  const editionPages = listedEditions?.find((edition) => edition.id === fields.editionId)?.pages ?? null;
  const pinPast = fields.pagePin !== null && editionPages !== null && fields.pagePin > editionPages;
  /** A box being composed in, or the one typed in when the story was taken away, is never made read only under them. */
  const boxLocked = (field: FieldKey) => locked && !composingNow && typingOn !== field;
  /** Text typed that can no longer be saved here (the story was moved out of the person's hands): kept, and said so. */
  const unsavable = Boolean(story) && !editable && Object.keys(changes(saved, fields, desk)).length > 0;
  const photoLocked = !mayPhoto || conflict !== null || offered !== null || moving || gone;
  /** A caption or credit typed that cannot be saved now: why, said with it (it is kept, read only, and drafted). */
  const photoKeysDirty = fields.caption !== saved.caption || fields.credit !== saved.credit;
  const keptBecause = !photoKeysDirty
    ? null
    : !story?.photo
      ? photoGoneBy
        ? t("photo.kept.removed", { name: photoGoneBy })
        : t("photo.kept.gone")
      : !mayPhoto
        ? t("photo.kept.notTheirs")
        : null;

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
      ...(onItsWay ? { sending: onItsWay.fields, sendingSteps: onItsWay.steps } : {}),
      photoAssetId: story?.photo?.assetId ?? null,
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
    const patch = changes(base, now, desk);
    // a caption or credit the person may not save now (no photo, or not theirs to change) is not sent, and not
    // counted as saved: it stays in the boxes' state and in the draft, shown to them as kept
    const photoOpen = Boolean(current.photo) && photoFor(current);
    const photoPatch = photoOpen ? photoChanges(base, now) : {};
    const sent = photoOpen ? now : { ...now, caption: base.caption, credit: base.credit };
    if (Object.keys(patch).length === 0 && Object.keys(photoPatch).length === 0) {
      if (mounted.current) setSaved(sent);
      return current;
    }
    if (mounted.current) setSave({ state: "saving" });
    // on this device first: if the page is closed before the answer, reopening can tell this change was its own
    const steps = (Object.keys(photoPatch).length > 0 ? 1 : 0) + (Object.keys(patch).length > 0 ? 1 : 0);
    sending.current = { fields: sent, baseRevision: current.revision, steps };
    writeDraft(userId, keyRef.current, {
      fields: latest.current.fields,
      base,
      baseRevision: current.revision,
      sending: sent,
      sendingSteps: steps,
      photoAssetId: current.photo?.assetId ?? null,
      savedAt: new Date().toISOString(),
    });
    // the photo's caption and credit first (their own PATCH), then the story's fields, each on the version before it
    let reached = current;
    let reachedBase = base;
    let result: Awaited<ReturnType<typeof stories.update>> = { ok: true, value: current };
    if (Object.keys(photoPatch).length > 0) {
      result = await stories.updatePhoto({
        orgId,
        pubId,
        storyId: current.id,
        baseRevision: current.revision,
        ...photoPatch,
        ...(keepalive ? { keepalive } : {}),
      });
      if (result.ok) {
        reached = result.value;
        reachedBase = { ...base, ...photoPatch };
      }
    }
    if (result.ok && Object.keys(patch).length > 0) {
      result = await stories.update({
        orgId,
        pubId,
        storyId: reached.id,
        patch: { baseRevision: reached.revision, ...patch },
        ...(keepalive ? { keepalive } : {}),
      });
    }
    sending.current = null;
    if (result.ok) latest.current = { ...latest.current, story: result.value, saved: sent };
    else if (reached !== current) latest.current = { ...latest.current, story: reached, saved: reachedBase };
    if (!mounted.current) return result.ok ? result.value : null;
    if (!result.ok) {
      if (reached !== current) settle(reached, reachedBase); // the photo's part arrived
      const base = reachedBase;
      const theirs = currentStory(result.error);
      if (theirs && sameAsMine(theirs, sent)) {
        // the newer version already says exactly this (this device's own change, sent as the page was left)
        settle(theirs, sent);
        setSave({ state: same(latest.current.fields, sent) ? "saved" : "pending" });
        if (same(latest.current.fields, sent)) dropDraft(userId, keyRef.current);
        return theirs;
      }
      if (theirs) {
        openConflict(theirs, base);
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
  }, [desk, navigate, onCreated, orgId, pubId, photoFor, stories, userId]);

  /**
   * One change of the story at a time, in the order asked: saves, the photo's changes and moves all name the version
   * the one before them left, so none of them conflicts with another of this screen's.
   */
  const enqueue = useCallback(<T,>(task: () => Promise<T>): Promise<T> => {
    busy.current += 1;
    if (mounted.current) setSaving(true);
    const run = chain.current.then(task, task).finally(() => {
      busy.current -= 1;
      if (busy.current === 0 && mounted.current) setSaving(false);
    });
    chain.current = run.catch(() => undefined);
    return run;
  }, []);

  /** Save now; a save asked for during another runs right after it. Resolves to the story once all have settled. */
  const flush = useCallback((): Promise<StoryDto | null> => enqueue(saveOnce), [enqueue, saveOnce]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  // autosave after a pause in typing; again after each save while something still waits
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!dirty || composingNow || conflict || offered || gone || !(editable || mayPhoto) || loaded.status !== "ready") return;
    setSave((previous) => (previous.state === "failed" || previous.state === "saving" ? previous : { state: "pending" }));
    timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [composingNow, conflict, dirty, editable, fields, flush, gone, loaded.status, mayPhoto, offered, saved]);

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
    const waiting = () => !same(latest.current.fields, latest.current.saved) || busy.current > 0 || pendingCreate.current !== null;
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
      const saved = await flush();
      if (!saved || !mounted.current) return false;
      const result = await enqueue(async () => {
        // the version as the queue leaves it (a photo change may have come between)
        const current = latest.current.story ?? saved;
        // one key per intent: the same move from the same version with the same comment is the same request
        const intent = `${to}@${current.revision}#${comment ?? ""}`;
        const idempotencyKey = moveKeys.current.get(intent) ?? randomUuid();
        moveKeys.current.set(intent, idempotencyKey);
        return stories.transition({
          orgId,
          pubId,
          storyId: current.id,
          to,
          baseRevision: current.revision,
          ...(comment ? { comment } : {}),
          idempotencyKey,
        });
      });
      if (!mounted.current) return result.ok;
      if (!result.ok) {
        const theirs = currentStory(result.error);
        if (theirs) openConflict(theirs, latest.current.saved);
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

  /**
   * The story's photo, set, replaced or taken off on the version the queue leaves (plan §5.2). On 409 story_changed:
   * when nothing the person sees changed (a move or an assignment came between), it is done again on the new
   * version; otherwise the conflict screen opens, and the photo waits to be attached again.
   */
  const photoChange = (
    run: (current: StoryDto, now: StoryFields) => ReturnType<typeof stories.removePhoto>,
    /** The base once the API has the change (from the base and the fields sent with it), and the boxes then. */
    after: { readonly base: (base: StoryFields, sent: StoryFields) => StoryFields; readonly boxes: (typed: StoryFields) => StoryFields },
    options: {
      /** The person left, or cancelled: nothing is sent any more. */
      readonly signal?: AbortSignal;
      /** The story as it is now already shows this change (its answer was lost, and a retry met it). */
      readonly done: (theirs: StoryDto) => boolean;
    },
  ) =>
    enqueue(async (): Promise<PhotoOutcome> => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (options.signal?.aborted || !mounted.current) return { ok: false, cancelled: true };
        const { story: current, fields: now, saved: base } = latest.current;
        if (!current) return { ok: false };
        const result = await run(current, now);
        if (result.ok) {
          settle(result.value, after.base(base, now));
          if (mounted.current) setFields((typed) => after.boxes(typed));
          if (mounted.current) setPhotoGoneBy(null);
          return { ok: true };
        }
        const theirs = currentStory(result.error);
        if (!theirs) return { ok: false, problem: result.error };
        if (options.done(theirs)) {
          // this very change is already there: done, not a conflict
          settle(theirs, after.base(base, now));
          if (mounted.current) setFields((typed) => after.boxes(typed));
          return { ok: true };
        }
        const photoChanged = (theirs.photo?.assetId ?? null) !== (current.photo?.assetId ?? null);
        const nothingSeenChanged = same(fieldsOf(theirs), fieldsOf(current)) && !photoChanged;
        if (nothingSeenChanged && attempt === 0) {
          settle(theirs, base);
          continue;
        }
        openConflict(theirs, base);
        return { ok: false, conflict: true, photoChanged };
      }
      return { ok: false };
    });
  /** A library picture's own caption and credit fill the story's where those are empty. */
  const attachPhoto = (assetId: string, signal?: AbortSignal, defaults?: PhotoDefaults) => {
    const filled = (now: StoryFields): StoryFields => ({
      ...now,
      caption: now.caption || (defaults?.caption ?? ""),
      credit: now.credit || (defaults?.credit ?? ""),
    });
    return photoChange(
      (current, now) =>
        stories.attachPhoto({ orgId, pubId, storyId: current.id, baseRevision: current.revision, assetId, caption: filled(now).caption, credit: filled(now).credit }),
      { base: (base, sent) => ({ ...base, caption: filled(sent).caption, credit: filled(sent).credit }), boxes: filled },
      { ...(signal ? { signal } : {}), done: (theirs) => theirs.photo?.assetId === assetId },
    );
  };
  const removePhoto = () =>
    photoChange(
      (current) => stories.removePhoto({ orgId, pubId, storyId: current.id, baseRevision: current.revision }),
      {
        base: (base) => ({ ...base, caption: "", credit: "" }),
        boxes: (typed) => ({ ...typed, caption: "", credit: "" }),
      },
      { done: (theirs) => theirs.photo === null },
    );

  /** Three-way: only what the person changed since `base`, on top of theirs; autosave then sends it. */
  const keepMine = (putCaption: boolean) => {
    if (!conflict) return;
    const theirStory = conflict.theirs;
    const theirs = fieldsOf(theirStory);
    const photoChanged = (theirStory.photo?.assetId ?? null) !== conflict.baseAssetId;
    const all = changes(conflict.base, fields, "all");
    // a caption written for another photo goes on theirs only when the person says so
    const mine: Partial<StoryFields> =
      photoChanged && theirStory.photo && !putCaption
        ? Object.fromEntries(Object.entries(all).filter(([key]) => key !== "caption" && key !== "credit"))
        : all;
    // with their photo gone, the person's caption and credit stay (kept, read only, not sent) until a photo returns
    setPhotoGoneBy(photoChanged && !theirStory.photo ? theirStory.updatedBy.name : null);
    setStory(theirStory);
    setSaved(theirs);
    setFields({ ...theirs, ...mine });
    setConflict(null);
  };
  const takeTheirs = () => {
    if (!conflict) return;
    setPhotoGoneBy(null);
    setStory(conflict.theirs);
    setSaved(fieldsOf(conflict.theirs));
    setFields(fieldsOf(conflict.theirs));
    dropDraft(userId, key);
    setConflict(null);
    setSave({ state: "saved" });
  };
  /** A newer version heard live, merged into the boxes (liveMerge), unless the person's own choice or typing comes first. */
  const applyLive = (fresh: StoryDto) => {
    held.current = false;
    const { story: current, fields: mine, saved: base, conflict: open, offered: asking } = latest.current;
    // the photo's state from the engine (L2.2) changes no version: taken as it comes, nothing else of the story
    if (current && fresh.revision === current.revision && fresh.photo && current.photo?.assetId === fresh.photo.assetId) {
      if (fresh.photo.status !== current.photo.status || fresh.photo.problem !== current.photo.problem) {
        const next = { ...current, photo: { ...current.photo, status: fresh.photo.status, problem: fresh.photo.problem } };
        latest.current = { ...latest.current, story: next };
        setStory(next);
      }
      return;
    }
    // the person's choice comes first; a version not newer is this screen's own change, already here
    if (!current || open || asking || fresh.revision <= current.revision) return;
    const theirs = fieldsOf(fresh);
    const merged = liveMerge(base, mine, theirs, (fresh.photo?.assetId ?? null) !== (current.photo?.assetId ?? null));
    if (!merged) return; // both changed a field: the next save meets their version, and the conflict screen asks
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset["field"] : undefined;
    if (composing.current || merged.taken.some((key) => key === focused)) {
      held.current = true; // never rewrite the box being typed in, nor any box while an input method composes
      return;
    }
    if (current.can.edit && !fresh.can.edit && focused && (ALL_KEYS as readonly string[]).includes(focused)) setTypingOn(focused);
    // at once, for a save queued right behind this
    latest.current = { ...latest.current, story: fresh, saved: merged.saved, fields: merged.fields };
    setStory(fresh);
    setSaved(merged.saved);
    // only boxes still as the merge saw them take theirs
    setFields((typed) => ({
      ...typed,
      ...Object.fromEntries(merged.taken.filter((key) => typed[key] === mine[key]).map((key) => [key, theirs[key]])),
    }));
    const name = fresh.updatedBy.name;
    if (fresh.status !== current.status) setNotice(t("editor.live.moved", { name, status: t(statusKey(fresh.status)) }));
    else if (merged.taken.length > 0) setNotice(t("editor.live.merged", { name }));
  };
  /** Fetches the story after this screen's own changes (the queue), so its own saves are never taken for theirs. */
  const refreshLive = () => {
    if (queued.current) return;
    queued.current = true;
    const run = chain.current.then(async () => {
      queued.current = false;
      const current = latest.current.story;
      if (!current || !mounted.current) return;
      const result = await stories.get({ orgId, pubId, storyId: current.id });
      if (!mounted.current) return;
      if (result.ok) applyLive(result.value);
      else if (result.error.kind === "answer" && result.error.status === 404) setGone(true);
      // any other failure keeps what is shown: the next update, or the next save, meets the new version
    });
    chain.current = run.catch(() => undefined);
  };
  useLiveEvents((event) => {
    if (event.type === "resync" || (event.type === "story" && event.storyId === latest.current.story?.id)) refreshLive();
  });
  const release = () => {
    setTypingOn(null);
    if (held.current && !composing.current) refreshLive();
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
      setFields({ ...fieldsOf(story), ...changes(draft.base, draft.fields, "all") });
      return;
    }
    if (ownSend(draft, story, userId) && draft.sending) {
      // the newer version is the change this device was sending: the rest goes on top of it
      setFields({ ...fieldsOf(story), ...changes(draft.sending, draft.fields, "all") });
      return;
    }
    // the story moved on since: the person chooses, field by field
    setFields(draft.fields);
    openConflict(story, draft.base, draft.photoAssetId === undefined ? (story.photo?.assetId ?? null) : draft.photoAssetId);
  };

  const backLink = (
    <Link className="pg-editor__back" to={paths.pubStories(orgId, pubId)}>
      <Icon name="arrow-left" size={16} />
      {t("editor.back")}
    </Link>
  );
  if (loaded.status === "loading") return <ProgressIndicator role="status" label={t("editor.loading")} />;
  if (loaded.status === "failed") {
    return (
      <Stack gap="4">
        <PageHeader title={t("glossary.story")} headingId={ROUTE_HEADING_ID} breadcrumbs={backLink} />
        <ProblemMessage problem={loaded.problem} live={loaded.live} />
        <Cluster gap="3">
          <Button variant="secondary" onClick={() => void open(true)}>
            {t("form.retry")}
          </Button>
        </Cluster>
      </Stack>
    );
  }

  const textLang = story?.language || undefined;
  /** The handlers every box of the story shares, on both of its forms (the document and the inspector's). */
  const boxForm = {
    noValidate: true,
    onSubmit: (event: FormEvent<HTMLFormElement>) => (event.preventDefault(), void flush()),
    "aria-busy": moving,
    onBlur: release,
    onCompositionStart: () => {
      composing.current = true;
      setComposingNow(true);
    },
    onCompositionEnd: () => {
      composing.current = false;
      setComposingNow(false);
      // the held live change goes in first (the queue), then autosave sends the composed text on its version
      release();
    },
  };
  const saveState = <SaveState save={save} dirty={dirty} editable={editable || mayPhoto} onSave={() => void flush()} />;
  const moves = story && !gone && story.can.transitions.length > 0 && (
    <section aria-labelledby="pg-editor-moves" className="pg-editor__moves">
      <h2 id="pg-editor-moves" className="pg-visually-hidden">
        {t("editor.moves")}
      </h2>
      <Cluster gap="2">
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
    </section>
  );
  return (
    <div className="pg-editor">
      <Stack gap="4">
        <PageHeader
          breadcrumbs={backLink}
          headingId={ROUTE_HEADING_ID}
          title={
            <span lang={story ? textLang : undefined} className="pg-editor__title">
              {story ? story.headline || t("editor.untitled") : t("editor.newTitle")}
            </span>
          }
          subtitle={
            story && (
              <span className="pg-editor__meta">
                <StatusChip status={story.status} />
                <span>{t("editor.reporter", { name: story.reporter.name })}</span>
                <span>{t("editor.words", { count: dirty ? countWords(fields.body) : story.words })}</span>
              </span>
            )
          }
          actions={
            <>
              {save.state !== "failed" && saveState}
              {story && !gone && (
                <Button
                  variant="quiet"
                  onClick={() => document.getElementById("pg-comments-heading")?.focus()}
                >
                  <Icon name="message-square" size={16} />
                  {t("editor.goToComments")}
                </Button>
              )}
              {moves}
            </>
          }
        />
        {moveProblem && <ProblemMessage problem={moveProblem} />}
        {(moving || saving) && moves && <p className="pg-type-body-small pg-editor__busy">{moving ? t("editor.moving") : t("editor.saving")}</p>}
        <OfflineNotice />
        {save.state === "failed" && saveState}
        <div aria-live="polite">
          {gone && (
            <InlineMessage variant="warning" heading={t("editor.gone.heading")} iconLabel={t("message.warning")}>
              {t("editor.gone.body")}
            </InlineMessage>
          )}
          {notice && <p className="pg-editor__notice">{notice}</p>}
          {unsavable && story && (
            <InlineMessage variant="warning" heading={t("editor.unsavable.heading")} iconLabel={t("message.warning")}>
              {t("editor.unsavable.body", { status: t(statusKey(story.status)) })}
            </InlineMessage>
          )}
        </div>

        {story?.madeWithClaude && (
          <InlineMessage variant="warning" heading={t("news.madeWithClaude")} iconLabel={t("message.warning")}>
            {t("news.madeWithClaude.body")}
          </InlineMessage>
        )}

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
          <ConflictPanel conflict={conflict} mine={fields} lang={textLang} editionDates={editionDates} sections={sections} onKeepMine={keepMine} onTakeTheirs={takeTheirs} />
        )}

        <div className="pg-editor__layout">
          <form {...boxForm} className={locked ? "pg-editor__paper pg-editor__paper--locked" : "pg-editor__paper"}>
            {!editable && (
              <p className="pg-editor__readonly">
                <Icon name="lock" size={16} />
                <span>{mayPhoto ? t("editor.photoOnly") : t("editor.readOnly")}</span>
              </p>
            )}
            <Field
              className="pg-editor__headline"
              label={t("glossary.headline")}
              description={story ? undefined : t("editor.headlineHint")}
              errors={save.state === "needs-headline" ? [t("editor.headlineMissing")] : []}
            >
              <TextInput
                lang={textLang}
                data-field="headline"
                value={fields.headline}
                readOnly={boxLocked("headline")}
                onChange={(event) => change("headline")(event.target.value)}
                onBlur={leaveBox}
              />
            </Field>
            <Field className="pg-editor__body" label={t("glossary.bodyText")}>
              <TextArea
                lang={textLang}
                rows={16}
                data-field="body"
                value={fields.body}
                readOnly={boxLocked("body")}
                onChange={(event) => change("body")(event.target.value)}
                onBlur={leaveBox}
              />
            </Field>
          </form>

          <aside className="pg-editor__inspector" aria-label={t("editor.inspector")}>
            <form {...boxForm} className="pg-editor__inspector-form">
              <Panel title={t("editor.panel.details")}>
                <Stack gap="4">
                  <Field label={t("glossary.byline")}>
                    <TextInput lang={textLang} data-field="byline" value={fields.byline} readOnly={boxLocked("byline")} onChange={(event) => change("byline")(event.target.value)} onBlur={leaveBox} />
                  </Field>
                  <Field label={t("glossary.kicker")}>
                    <TextInput lang={textLang} data-field="kicker" value={fields.kicker} readOnly={boxLocked("kicker")} onChange={(event) => change("kicker")(event.target.value)} onBlur={leaveBox} />
                  </Field>
                  <Field label={t("glossary.deck")}>
                    <TextInput lang={textLang} data-field="deck" value={fields.deck} readOnly={boxLocked("deck")} onChange={(event) => change("deck")(event.target.value)} onBlur={leaveBox} />
                  </Field>
                  <Field label={t("editor.section")}>
                    <Select value={fields.sectionId ?? ""} disabled={locked} onChange={(event) => change("sectionId")(event.target.value || null)}>
                      <option value="">{t("editor.noSection")}</option>
                      {/* the sections in use; the story's own stays shown when it is archived (or not listed) */}
                      {sections
                        .filter((section) => !section.archived || section.id === fields.sectionId)
                        .map((section) => (
                          <option key={section.id} value={section.id}>
                            {section.name}
                          </option>
                        ))}
                      {fields.sectionId !== null && !sections.some((section) => section.id === fields.sectionId) && (
                        <option value={fields.sectionId}>{t("editor.section.unlisted")}</option>
                      )}
                    </Select>
                  </Field>
                </Stack>
              </Panel>
              {!story && uploads && (
                <Panel title={t("glossary.photo")}>
                  <p className="pg-type-body-small">{t("photo.afterHeadline")}</p>
                </Panel>
              )}
              {story && (
                <PhotoPanel
                  orgId={orgId}
                  pubId={pubId}
                  story={story}
                  may={mayPhoto}
                  mayView={mayView}
                  locked={photoLocked}
                  keptBecause={keptBecause}
                  onDiscardKept={() => {
                    setFields((typed) => ({ ...typed, caption: latest.current.saved.caption, credit: latest.current.saved.credit }));
                    setPhotoGoneBy(null);
                  }}
                  caption={fields.caption}
                  credit={fields.credit}
                  lang={textLang}
                  onCaption={(value) => change("caption")(value)}
                  onCredit={(value) => change("credit")(value)}
                  onLeave={() => {
                    if (!photoLocked && dirty) void flush();
                  }}
                  onAttach={attachPhoto}
                  onRemove={removePhoto}
                />
              )}
              {desk && (
                <Panel title={t("editor.panel.desk")}>
                  <fieldset className="pg-editor__desk">
                    <legend className="pg-visually-hidden">{t("editor.desk")}</legend>
                    <Stack gap="4">
                      <div className="pg-editor__desk-row">
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
                        <Field
                          label={t("editor.pagePin")}
                          {...(pinPast && editionPages !== null ? { errors: [t("editor.pagePin.pastEdition", { pages: editionPages })] } : {})}
                        >
                          <Select
                            value={fields.pagePin === null ? "" : String(fields.pagePin)}
                            disabled={locked}
                            onChange={(event) => change("pagePin")(event.target.value === "" ? null : Number(event.target.value))}
                          >
                            <option value="">{t("editor.pagePin.any")}</option>
                            {/* the edition's pages (the API refuses a page past them); a pin already past them stays shown */}
                            {[...Array.from({ length: editionPages ?? 16 }, (_, index) => index + 1), ...(pinPast && fields.pagePin !== null ? [fields.pagePin] : [])].map((page) => (
                              <option key={page} value={page}>
                                {t("editor.pagePin.page", { page })}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                      <Field label={t("glossary.edition.issue")}>
                        <Select
                          value={fields.editionId ?? ""}
                          disabled={locked}
                          onChange={(event) => change("editionId")(event.target.value || null)}
                        >
                          <option value="">{t("stories.noEdition")}</option>
                          {[...editionDates].sort((a, b) => b[1].localeCompare(a[1])).map(([id, date]) => (
                            <option key={id} value={id}>
                              {formatDate(date, language)}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t("editor.deskNote")} description={t("editor.deskNoteHint")}>
                        <TextInput data-field="deskNote" value={fields.deskNote} readOnly={boxLocked("deskNote")} onChange={(event) => change("deskNote")(event.target.value)} onBlur={leaveBox} />
                      </Field>
                    </Stack>
                  </fieldset>
                </Panel>
              )}
            </form>

            {story?.newsSources && story.newsSources.length > 0 && (
              <Panel title={t("news.storySources")}>
                <Stack gap="2">
                  <p className="pg-type-body-small">{t("news.storySources.hint")}</p>
                  <ul className="pg-news__sources">
                    {story.newsSources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          <bdi>{source.title}</bdi>
                        </a>{" "}
                        <span className="pg-type-body-small">
                          (<bdi>{source.site}</bdi>)
                        </span>
                      </li>
                    ))}
                  </ul>
                </Stack>
              </Panel>
            )}

            {story && !gone && story.can.assign && (
              <Panel title={t("editor.panel.workflow")}>
                <Assignment orgId={orgId} pubId={pubId} story={story} onChanged={(next, text) => (setStory(next), setNotice(text))} onConflict={(theirs) => openConflict(theirs, latest.current.saved)} />
              </Panel>
            )}

            {story && !gone && <CommentsPanel orgId={orgId} pubId={pubId} storyId={story.id} mayComment={story.can.comment} />}
          </aside>
        </div>

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

function valueText(
  key: FieldKey,
  fields: StoryFields,
  t: Translate,
  editionName: (id: string) => string,
  sectionName: (id: string) => string,
): string {
  if (key === "priority") {
    const label = PRIORITIES.find(([level]) => level === fields.priority)?.[1];
    return label ? t(label) : String(fields.priority);
  }
  if (key === "pagePin") return fields.pagePin === null ? t("editor.pagePin.any") : t("editor.pagePin.page", { page: fields.pagePin });
  if (key === "editionId") return fields.editionId === null ? t("stories.noEdition") : editionName(fields.editionId);
  if (key === "sectionId") return fields.sectionId === null ? t("editor.noSection") : sectionName(fields.sectionId);
  return fields[key];
}

/** Every field where theirs and mine differ, side by side, and the two choices. */
function ConflictPanel({
  conflict,
  mine,
  lang,
  editionDates,
  sections,
  onKeepMine,
  onTakeTheirs,
}: {
  readonly conflict: Conflict;
  readonly mine: StoryFields;
  readonly lang: string | undefined;
  /** The publication's editions (id → date), to name the edition each version is in. */
  readonly editionDates: ReadonlyMap<string, string>;
  /** The publication's sections, to name the section each version is in. */
  readonly sections: readonly SectionDto[];
  readonly onKeepMine: (putCaption: boolean) => void;
  readonly onTakeTheirs: () => void;
}) {
  const { t, language } = useI18n();
  const [putCaption, setPutCaption] = useState(false);
  const theirStory = conflict.theirs;
  const editionName = (id: string) => {
    const date = editionDates.get(id) ?? (theirStory.edition?.id === id ? theirStory.edition.date : undefined);
    return date ? formatDate(date, language) : id;
  };
  const sectionName = (id: string) => sections.find((section) => section.id === id)?.name ?? t("editor.section.unlisted");
  const theirs = fieldsOf(theirStory);
  const name = theirStory.updatedBy.name;
  const theirAsset = theirStory.photo?.assetId ?? null;
  const photoChanged = theirAsset !== conflict.baseAssetId;
  const photoKeys = PHOTO_KEYS as readonly FieldKey[];
  // with the photo changed, its caption and credit are shown with it, not as ordinary fields
  const differing = ALL_KEYS.filter((key) => theirs[key] !== mine[key] && !(photoChanged && photoKeys.includes(key)));
  const textual = (key: FieldKey) => (TEXT_KEYS as readonly FieldKey[]).includes(key) || photoKeys.includes(key);
  const typedCaption = mine.caption !== conflict.base.caption || mine.credit !== conflict.base.credit;
  const statement = !photoChanged
    ? null
    : !theirAsset
      ? t("editor.conflict.photoRemoved", { name })
      : conflict.baseAssetId
        ? t("editor.conflict.photoReplaced", { name })
        : t("editor.conflict.photoAdded", { name });
  return (
    <section aria-labelledby="pg-editor-conflict" className="pg-editor__conflict">
      <Stack gap="4">
        <h2 id="pg-editor-conflict" className="pg-type-section-title">
          {t("editor.conflict.heading")}
        </h2>
        <p role="alert">{t("editor.conflict.body", { name })}</p>
        <p>{t("editor.conflict.keepHint")}</p>
        {statement && (
          <div>
            <h3 className="pg-type-body">
              <strong>{t("editor.conflict.photo")}</strong>
            </h3>
            <p>{statement}</p>
            {(typedCaption || mine.caption || mine.credit) && (
              <Stack gap="2">
                <p>{t("editor.conflict.captionFor")}</p>
                <div className="pg-editor__versions">
                  <div className="pg-editor__version">
                    <p className="pg-type-body-small">{t("editor.conflict.theirs")}</p>
                    <p lang={lang}>{theirs.caption}</p>
                    <p>{theirs.credit}</p>
                  </div>
                  <div className="pg-editor__version">
                    <p className="pg-type-body-small">{t("editor.conflict.mine")}</p>
                    <p lang={lang}>{mine.caption}</p>
                    <p>{mine.credit}</p>
                  </div>
                </div>
                {theirAsset ? (
                  <Checkbox label={t("editor.conflict.putCaption")} checked={putCaption} onChange={(event) => setPutCaption(event.target.checked)} />
                ) : (
                  <p>{t("editor.conflict.keptCaption")}</p>
                )}
              </Stack>
            )}
          </div>
        )}
        {differing.map((key) => (
          <div key={key}>
            <h3 className="pg-type-body">
              <strong>{t(FIELD_LABELS[key])}</strong>
            </h3>
            <div className="pg-editor__versions">
              <div className="pg-editor__version">
                <p className="pg-type-body-small">{t("editor.conflict.theirs")}</p>
                <p lang={textual(key) ? lang : undefined}>{valueText(key, theirs, t, editionName, sectionName)}</p>
              </div>
              <div className="pg-editor__version">
                <p className="pg-type-body-small">{t("editor.conflict.mine")}</p>
                <p lang={textual(key) ? lang : undefined}>{valueText(key, mine, t, editionName, sectionName)}</p>
              </div>
            </div>
          </div>
        ))}
        <Cluster gap="3">
          <Button onClick={() => onKeepMine(putCaption)}>{t("editor.conflict.keepMine")}</Button>
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
  const icon = save.state === "saving" ? "loader-circle" : dirty ? "pencil" : "circle-check";
  return (
    <p className="pg-editor__save" role="status">
      <Icon name={icon} size={16} />
      <span>{text}</span>
    </p>
  );
}

/** The send-back comment (a move to Draft needs one); the Newsroom board uses it too. */
export function SendBackDialog({
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
