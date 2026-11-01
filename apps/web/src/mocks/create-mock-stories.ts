/**
 * The stories double: a publication's stories answered as the API answers them (plan §5.2, §5.4; the API's
 * src/modules/stories): who sees which story (all, a Reporter's own, none), who edits and moves it, its version and
 * 409 story_changed with the story as it is now, the Idempotency-Key on create, paste and transitions, cursor pages.
 * The roles come from the same permission map the API uses (services/permissions.ts). Text is cleaned as the API's
 * cleanText (@pageinator/desk-text) cleans it: NFC, CR and CRLF to LF, control characters dropped, each line's trailing
 * space trimmed and the whole stripped; so an answer can differ from what was sent, as the real one does. An
 * Idempotency-Key replays its first answer only for the same body, and answers 422 idempotency_key_reused for another.
 * Its paste splits the text at lines of only `---` as the Desk does.
 *
 * Photos (plan §5.2, §6.2) as the API's src/modules/media: presign (JPEG, PNG or WebP up to 40 MiB; 60 an hour per
 * person and 2 GB a day per organisation, answered 429 slow_down; an Idempotency-Key replaying its first answer), the
 * file to the "store" (its size must be the declared one), complete (its type from its first bytes, else 422
 * not_a_picture), the story's photo set, changed or taken off on the story's version by whoever edits the story or a
 * Photo Editor, and the original only for whoever may see it.
 * Comments (plan §5.2) as the API's src/modules/stories/comments.ts: threads one level deep, oldest first; whoever sees
 * the story reads them (a Reporter their own stories'); whoever may comment writes one or a reply to a thread's first
 * comment (an Idempotency-Key replaying its first answer); its author changes its text; the author, the desk or the
 * story's reporter or assignee resolves or reopens a thread; a send-back's comment is a thread of the desk's.
 * Who is told (notify.ts): the desk's Editors and Sub-editors of a filed story, the reporter of one sent back, the
 * person given a story, and of a comment the story's reporter and assignee and the thread's writers; never the one
 * acting, and only members who would see the story (and read its comments). Each change is a live update (`emit`).
 * Editions (plan §1 L2.1) as the API's src/modules/editions: listed for edition.view, newest first, with their stories
 * counted; made by a full edition.create (one a date: 409 edition_exists with it as `current`; an Idempotency-Key
 * replaying its first answer); a story put in or taken out by its PATCH (`editionId`, the desk's); and "Send to the
 * Desk" (a full desk.export) answering a fictional ZIP of the edition's Ready stories, never a spiked one.
 * Fictional data only; deterministic (no clock, no randomness).
 */
import type {
  CommentDto,
  CommentService,
  DeskBundleDto,
  EditionService,
  PubEditionDto,
  LiveEventDto,
  ApiProblem,
  AssetDto,
  MediaService,
  PasteResultDto,
  ServiceResult,
  StoryDto,
  StoryListItemDto,
  StoryService,
  StoryStatusDto,
  TransitionTargetDto,
} from "../services/index.ts";
import { reach, type PublicationAccess } from "../services/permissions.ts";

export type MockStoryOperation =
  | "stories.list"
  | "stories.get"
  | "stories.create"
  | "stories.update"
  | "stories.transition"
  | "stories.assign"
  | "stories.paste"
  | "stories.photo"
  | "media.presign"
  | "media.send"
  | "media.complete"
  | "media.load"
  | "comments.list"
  | "comments.create"
  | "comments.update"
  | "editions.list"
  | "editions.create"
  | "editions.deskBundle";

/** The person's standing on a publication, as the API's access check finds it. */
export interface MockStanding {
  readonly orgRole: "owner" | "admin" | "member";
  readonly access: PublicationAccess;
  /** The organisation's two-step rule applies to them, and this session was made without it. */
  readonly twoStepBlocked: boolean;
}

export interface MockStoryDeps {
  person(): { readonly userId: string; readonly name: string } | undefined;
  /** undefined: not a member of the organisation, or no such publication in it (the API answers 404). */
  standing(userId: string, orgId: string, pubId: string): MockStanding | undefined;
  gate(operation: MockStoryOperation): Promise<ApiProblem | undefined>;
  signedOut<T>(): ServiceResult<T, ApiProblem>;
  nameOf(userId: string): string | undefined;
  /** The organisation's active members (who may be told of a change). */
  members?(orgId: string): readonly string[];
  /** Someone is told of a change (the notifications double). */
  notify?(orgId: string, userId: string, notice: MockStoryNotice): void;
  /** A change the API would send as a live update (the session double decides who hears it). */
  emit?(orgId: string, event: LiveEventDto): void;
}

/** What a story's change tells someone of (create-mock-notifications.ts MockNotice). */
export interface MockStoryNotice {
  readonly kind: "story_filed" | "story_sent_back" | "story_assigned" | "comment";
  readonly publicationId: string;
  readonly storyId: string;
  readonly commentId?: string;
  readonly actor: { readonly id: string; readonly name: string };
}

interface CommentRow {
  readonly id: string;
  readonly orgId: string;
  readonly pubId: string;
  readonly storyId: string;
  readonly parentId: string | null;
  readonly author: { readonly id: string; readonly name: string };
  body: string;
  readonly createdAt: string;
  updatedAt: string;
  resolved: { readonly at: string; readonly by: { readonly id: string; readonly name: string } } | null;
  readonly order: number;
}

/** Fictional comments: a thread with a reply on the filed story, and a resolved one. */
function commentFixtures(): CommentRow[] {
  const on = { orgId: SAHYADRI, pubId: PUNE, storyId: "story-demo-001" };
  return [
    {
      ...on,
      id: "comment-demo-001",
      parentId: null,
      author: EDITOR,
      body: "पहिल्या पावसाची तारीख तपासा.",
      createdAt: "2026-10-22T09:00:00.000Z",
      updatedAt: "2026-10-22T09:00:00.000Z",
      resolved: null,
      order: 1,
    },
    {
      ...on,
      id: "comment-demo-002",
      parentId: "comment-demo-001",
      author: REPORTER,
      body: "तपासतो, संध्याकाळपर्यंत कळवतो.",
      createdAt: "2026-10-22T09:10:00.000Z",
      updatedAt: "2026-10-22T09:10:00.000Z",
      resolved: null,
      order: 2,
    },
    {
      ...on,
      id: "comment-demo-003",
      parentId: null,
      author: SUBEDITOR,
      body: "Headline fits two columns.",
      createdAt: "2026-10-22T08:00:00.000Z",
      updatedAt: "2026-10-22T08:05:00.000Z",
      resolved: { at: "2026-10-22T08:20:00.000Z", by: EDITOR },
      order: 0,
    },
  ];
}

type Row = Omit<StoryDto, "can" | "commentCount"> & { readonly orgId: string; readonly order: number };

type Answer = Extract<ApiProblem, { kind: "answer" }>;
const answer = (status: number, code: string, message: string): Answer => ({
  kind: "answer",
  status,
  code,
  message,
  requestId: "mock-request",
});
const NOT_FOUND = answer(404, "not_found", "There is nothing here, or you do not have access to it.");
const NOT_ALLOWED = answer(403, "not_allowed", "Your role cannot do this. Ask an editor or the owner.");
const TWO_STEP = answer(403, "two_step_required", "Your role needs two-step sign-in. Set it up in Account → Security.");
const INVALID_TRANSITION = answer(409, "invalid_transition", "The story cannot move to that state from where it is.");
const invalid = (field: string, message: string): Answer => ({
  ...answer(400, "invalid_request", "Some fields are not right."),
  details: [{ field, message }],
});

const KEY_REUSED = answer(422, "idempotency_key_reused", "This key was already used with a different request.");

/** cleanText (@pageinator/desk-text clean.ts), for the double: NFC, LF only, no controls, no trailing space, stripped. */
export function cleanText(value: string | undefined): string {
  if (value === undefined) return "";
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .split("\n")
    .map((line) => line.replace(/\s+$/u, ""))
    .join("\n")
    .trim();
}

const success = <T,>(value: T): ServiceResult<T, ApiProblem> => ({ ok: true, value });
const failure = <T,>(problem: ApiProblem): ServiceResult<T, ApiProblem> => ({ ok: false, error: { ...problem } });

const SAHYADRI = "org-demo-sahyadri";
const PUNE = "pub-demo-pune-daily";
const EDITOR = { id: "user-demo-sahyadri-editor", name: "Sahyadri Demo Editor" };
const SUBEDITOR = { id: "user-demo-sahyadri-subeditor", name: "Sahyadri Demo Sub-editor" };
const REPORTER = { id: "user-demo-sahyadri-reporter", name: "Sahyadri Demo Reporter" };
const EDITION_A = { id: "edition-demo-2026-10-23", date: "2026-10-23" };
const EDITION_B = { id: "edition-demo-2026-10-24", date: "2026-10-24" };

type EditionRow = Omit<PubEditionDto, "counts"> & { readonly orgId: string; readonly publicationId: string };

/** The Pune Daily Ledger's two fictional editions, the ones its stories are in. */
function editionFixtures(): EditionRow[] {
  const edition = (fields: { id: string; date: string }, issue: string): EditionRow => ({
    ...fields,
    orgId: SAHYADRI,
    publicationId: PUNE,
    pages: 8,
    backPageAds: true,
    volume: "12",
    issue,
    price: "₹5",
    status: "planning",
  });
  return [edition(EDITION_A, "301"), edition(EDITION_B, "302")];
}

const words = (body: string) => body.split(/\s+/).filter((word) => word !== "").length;

function row(order: number, fields: Partial<Row> & Pick<Row, "id" | "headline" | "body" | "status" | "reporter">): Row {
  return {
    orgId: SAHYADRI,
    publicationId: PUNE,
    revision: 1,
    textRevision: 1,
    kicker: "",
    deck: "",
    byline: fields.reporter.name,
    bodyFormat: "desk-text/1",
    words: words(fields.body),
    isBrief: words(fields.body) > 0 && words(fields.body) <= 60,
    language: "mr",
    sectionId: null,
    priority: 3,
    pagePin: null,
    edition: null,
    assignee: null,
    dueAt: null,
    deskNote: "",
    updatedAt: `2026-10-22T0${order}:00:00.000Z`,
    updatedBy: fields.reporter,
    photo: null,
    ...fields,
    order,
  };
}

/** Fictional stories of the Pune Daily Ledger, one in each state the desk works with. */
function fixtures(): Row[] {
  return [
    row(1, {
      id: "story-demo-001",
      headline: "घाटात मान्सून लवकर दाखल",
      body: "पुणे जिल्ह्यातील घाट परिसरात या वर्षी मान्सून नेहमीपेक्षा आठवडाभर आधी पोहोचला. शेतकऱ्यांनी पेरणीची तयारी सुरू केली आहे.",
      status: "filed",
      reporter: REPORTER,
      edition: EDITION_A,
    }),
    row(2, {
      id: "story-demo-002",
      headline: "बाजार समितीची निवडणूक रविवारी",
      body: "बाजार समितीच्या संचालक मंडळासाठी रविवारी मतदान होणार आहे.",
      status: "draft",
      reporter: REPORTER,
    }),
    row(3, {
      id: "story-demo-003",
      headline: "Ring road work to resume next week",
      body: "Work on the eastern stretch of the ring road resumes on Monday after the monsoon pause, the corporation said.",
      language: "en",
      status: "editing",
      reporter: EDITOR,
      assignee: SUBEDITOR,
      edition: EDITION_A,
    }),
    row(4, {
      id: "story-demo-004",
      headline: "गुरुवारी पाणीपुरवठा बंद",
      body: "जलवाहिनीच्या दुरुस्तीसाठी गुरुवारी शहराच्या पूर्व भागात पाणीपुरवठा बंद राहील.",
      status: "ready",
      reporter: SUBEDITOR,
      edition: EDITION_B,
      photo: {
        assetId: "asset-demo-001",
        caption: "जलवाहिनीच्या दुरुस्तीचे काम",
        credit: "Fictional Photo Desk",
        status: "received",
        problem: null,
        widthPx: 1600,
        heightPx: 1088,
        previewUrl: null,
      },
      isBrief: false,
    }),
    row(5, {
      id: "story-demo-005",
      headline: "जुना पूल दुरुस्तीसाठी बंद",
      body: "नदीवरील जुना पूल दोन आठवडे दुरुस्तीसाठी बंद राहील.",
      status: "held",
      reporter: EDITOR,
    }),
  ];
}

interface MockAsset {
  readonly id: string;
  readonly orgId: string;
  readonly pubId: string;
  readonly uploadedBy: string;
  readonly mime: AssetDto["mime"];
  readonly bytes: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly data: Blob;
  readonly status: AssetDto["status"];
}

interface MockUpload {
  readonly id: string;
  readonly orgId: string;
  readonly pubId: string;
  readonly userId: string;
  readonly contentType: AssetDto["mime"];
  readonly bytes: number;
  file?: Blob;
  status: "presigned" | "completed" | "rejected";
  assetId?: string;
}

/** A one-pixel-ish PNG's first bytes, enough for the double to tell its type (a fictional picture). */
const FIXTURE_PICTURE = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 6, 64, 0, 0, 4, 176])], {
  type: "image/png",
});

const MAX_BYTES = 41_943_040;
const UPLOADS_PER_HOUR = 60;
const ORG_BYTES_PER_DAY = 2 * 1024 ** 3;
const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

async function headOf(blob: Blob): Promise<Uint8Array> {
  const part = blob.slice(0, 32);
  if (typeof part.arrayBuffer === "function") return new Uint8Array(await part.arrayBuffer());
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(part);
  });
}

/** The type from the first bytes, and a PNG's own width and height (a JPEG's or WebP's are fictional here). */
function sniff(head: Uint8Array): { mime: AssetDto["mime"]; widthPx: number; heightPx: number } | undefined {
  const at = (i: number) => head[i] ?? -1;
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return { mime: "image/jpeg", widthPx: 1600, heightPx: 1200 };
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    const word = (i: number) => ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0;
    return { mime: "image/png", widthPx: Math.max(1, word(16)), heightPx: Math.max(1, word(20)) };
  }
  const text = (from: number, to: number) => String.fromCharCode(...Array.from(head.slice(from, to)));
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return { mime: "image/webp", widthPx: 1600, heightPx: 1200 };
  return undefined;
}

export function createMockStories(deps: MockStoryDeps): {
  stories: StoryService;
  editions: EditionService;
  media: MediaService;
  comments: CommentService;
  /** Whether this person would hear the live update (the API's events.ts messageFor, with its confirm). */
  hears(userId: string, orgId: string, event: LiveEventDto): boolean;
  /** A story's headline and status as this person may see it now (the notifications list's join), or null. */
  shown(userId: string, orgId: string, storyId: string): { headline: string; status: StoryStatusDto } | null;
  reset(): void;
  all(): readonly Row[];
} {
  let rows = fixtures();
  let editionRows = editionFixtures();
  let editionCounter = 0;
  let comments = commentFixtures();
  let commentCounter = 0;
  let counter = 0;
  let clock = 0;
  /** Where a held or spiked story came from. */
  let before = new Map<string, StoryStatusDto>([["story-demo-005", "editing"]]);
  let keys = new Map<string, unknown>();
  const fixtureAssets = (): Map<string, MockAsset> =>
    new Map([
      [
        "asset-demo-001",
        {
          id: "asset-demo-001",
          orgId: SAHYADRI,
          pubId: PUNE,
          uploadedBy: SUBEDITOR.id,
          mime: "image/png",
          bytes: FIXTURE_PICTURE.size,
          widthPx: 1600,
          heightPx: 1088,
          data: FIXTURE_PICTURE,
          status: "received",
        },
      ],
    ]);
  let assets = fixtureAssets();
  let uploads = new Map<string, MockUpload>();
  let uploadCount = new Map<string, number>();
  let orgBytes = new Map<string, number>();
  let assetCounter = 0;

  const has = (standing: MockStanding, ...roles: string[]) =>
    roles.some((role) => (standing.access.roles as readonly string[]).includes(role));
  const scopeOf = (s: MockStanding): "all" | "own" | "none" => {
    const seen = reach("story.view", s.orgRole, s.access);
    if (seen === "full") return "all";
    if (seen === null) return "none";
    if (has(s, "photo_editor")) return "all";
    if (has(s, "reporter")) return "own";
    return "none";
  };
  const theirs = (story: Row, userId: string) => story.reporter.id === userId || story.assignee?.id === userId;
  const sees = (s: MockStanding, story: Row, userId: string) => {
    const scope = scopeOf(s);
    return scope === "all" || (scope === "own" && theirs(story, userId));
  };
  const isDesk = (s: MockStanding) => reach("story.edit_any", s.orgRole, s.access) === "full";
  const spikes = (s: MockStanding) => s.orgRole !== "member" || has(s, "chief_editor", "editor");
  const author = (s: MockStanding, story: Row, userId: string) =>
    theirs(story, userId) && reach("story.edit_own", s.orgRole, s.access) !== null;
  const canEdit = (s: MockStanding, story: Row, userId: string) => {
    if (!sees(s, story, userId)) return false;
    if (isDesk(s)) return story.status !== "spiked";
    return author(s, story, userId) && ["draft", "filed", "editing"].includes(story.status);
  };
  function transitions(s: MockStanding, story: Row, userId: string): TransitionTargetDto[] {
    if (!sees(s, story, userId)) return [];
    const desk = isDesk(s);
    const out: TransitionTargetDto[] = [];
    switch (story.status) {
      case "draft":
        if (author(s, story, userId)) out.push("filed");
        if (desk) out.push("held");
        break;
      case "filed":
        if (desk) out.push("editing", "ready", "draft", "held");
        break;
      case "editing":
        if (desk) out.push("ready", "draft", "held");
        break;
      case "ready":
        if (desk) out.push("draft", "held");
        break;
      case "placed":
        if (desk) out.push("held");
        break;
      case "held":
        if (desk) out.push("restore");
        break;
      case "spiked":
        if (spikes(s)) out.push("restore");
        return out;
    }
    if (spikes(s)) out.push("spiked");
    return out;
  }
  const canAssign = (s: MockStanding) => reach("story.assign", s.orgRole, s.access) !== null;
  /** canComment: whoever sees the story with comment.write (a Reporter's ◐: their own; a Viewer never). */
  const canComment = (s: MockStanding, story: Row, userId: string) => {
    if (!sees(s, story, userId)) return false;
    const here = reach("comment.write", s.orgRole, s.access);
    return here === "full" || (here === "scoped" && theirs(story, userId));
  };
  /** canReadComments: whoever sees the story with comment.read (a Reporter's ◐: their own). */
  const canReadComments = (s: MockStanding, story: Row, userId: string) => {
    if (!sees(s, story, userId)) return false;
    const here = reach("comment.read", s.orgRole, s.access);
    return here === "full" || (here === "scoped" && theirs(story, userId));
  };
  const canEditComment = (s: MockStanding, story: Row, comment: CommentRow, userId: string) =>
    comment.author.id === userId && canComment(s, story, userId);
  const canResolve = (s: MockStanding, story: Row, comment: CommentRow, userId: string) =>
    comment.parentId === null &&
    canComment(s, story, userId) &&
    (comment.author.id === userId || isDesk(s) || theirs(story, userId));

  /** Who among these, other than the one acting, is a member who sees the story (and may read its comments). */
  function audience(story: Row, candidates: readonly (string | null | undefined)[], actorId: string, comments = false): string[] {
    const members = new Set(deps.members?.(story.orgId) ?? []);
    const ids = [...new Set(candidates.filter((id): id is string => Boolean(id)))].filter((id) => id !== actorId && members.has(id));
    return ids.filter((id) => {
      const standing = deps.standing(id, story.orgId, story.publicationId);
      if (!standing || !sees(standing, story, id)) return false;
      return !comments || reach("comment.read", standing.orgRole, standing.access) !== null;
    });
  }
  function tell(story: Row, people: readonly string[], notice: Omit<MockStoryNotice, "publicationId" | "storyId">) {
    for (const userId of people) {
      deps.notify?.(story.orgId, userId, { ...notice, publicationId: story.publicationId, storyId: story.id });
    }
  }

  function view(story: Row, s: MockStanding, userId: string): StoryDto {
    const { orgId: _org, order: _order, ...fields } = story;
    return {
      ...fields,
      reporter: { ...story.reporter },
      assignee: story.assignee ? { ...story.assignee } : null,
      edition: story.edition ? { ...story.edition } : null,
      updatedBy: { ...story.updatedBy },
      photo: story.photo ? { ...story.photo } : null,
      commentCount: comments.filter((comment) => comment.storyId === story.id && comment.orgId === story.orgId).length,
      can: {
        edit: canEdit(s, story, userId),
        transitions: transitions(s, story, userId),
        comment: canComment(s, story, userId),
        assign: canAssign(s) && sees(s, story, userId),
      },
    };
  }

  const listItem = (story: StoryDto): StoryListItemDto => ({
    id: story.id,
    status: story.status,
    revision: story.revision,
    headline: story.headline,
    byline: story.byline,
    words: story.words,
    isBrief: story.isBrief,
    language: story.language,
    sectionId: story.sectionId,
    priority: story.priority,
    pagePin: story.pagePin,
    edition: story.edition,
    reporter: story.reporter,
    assignee: story.assignee,
    dueAt: story.dueAt,
    updatedAt: story.updatedAt,
  });

  /** The API's access check: signed in, a member, two-step if required, the route's permission. */
  async function check<T>(
    operation: MockStoryOperation,
    orgId: string,
    pubId: string,
    permission:
      | "story.view"
      | "story.create"
      | "story.edit_own"
      | "story.assign"
      | "media.upload"
      | "media.view"
      | "comment.read"
      | "comment.write"
      | "edition.view"
      | "edition.create"
      | "desk.export",
  ): Promise<ServiceResult<T, ApiProblem> | { person: { userId: string; name: string }; s: MockStanding }> {
    const problem = await deps.gate(operation);
    if (problem) return failure(problem);
    const person = deps.person();
    if (!person) return deps.signedOut();
    const s = deps.standing(person.userId, orgId, pubId);
    if (!s) return failure(NOT_FOUND);
    if (s.twoStepBlocked) return failure(TWO_STEP);
    if (reach(permission, s.orgRole, s.access) === null) return failure(NOT_ALLOWED);
    return { person, s };
  }
  const refused = <T,>(checked: object): checked is ServiceResult<T, ApiProblem> => "ok" in checked;

  function find(orgId: string, pubId: string, storyId: string): Row | undefined {
    return rows.find((story) => story.id === storyId && story.orgId === orgId && story.publicationId === pubId);
  }
  /** A story's edition from its `editionId`: one of this publication's, or none (null); undefined when unknown. */
  function placement(orgId: string, pubId: string, editionId: string | null): Row["edition"] | undefined {
    if (editionId === null) return null;
    const edition = editionRows.find((candidate) => candidate.id === editionId && candidate.orgId === orgId && candidate.publicationId === pubId);
    return edition ? { id: edition.id, date: edition.date } : undefined;
  }
  function touch(story: Row, by: { userId: string; name: string }, changes: Partial<Row>, text: boolean): Row {
    clock += 1;
    const next: Row = {
      ...story,
      ...changes,
      revision: story.revision + 1,
      textRevision: text ? story.textRevision + 1 : story.textRevision,
      updatedAt: `2026-10-22T10:${String(clock).padStart(2, "0")}:00.000Z`,
      updatedBy: { id: by.userId, name: by.name },
    };
    const brief = (row: Row) => !row.photo && words(row.body) > 0 && words(row.body) <= 60;
    const withCounts = changes.body !== undefined || "photo" in changes ? { ...next, words: words(next.body), isBrief: brief(next) } : next;
    rows = rows.map((candidate) => (candidate.id === story.id ? withCounts : candidate));
    deps.emit?.(story.orgId, { type: "story", publicationId: story.publicationId, storyId: story.id });
    return withCounts;
  }
  /** The first answer for this key and this body; KEY_REUSED for another body; undefined for a new key. */
  function replay<T>(key: string, scope: string, body: unknown): { readonly value: T } | typeof KEY_REUSED | undefined {
    const kept = keys.get(`${scope}:${key}`) as { body: string; value: T } | undefined;
    if (!kept) return undefined;
    return kept.body === JSON.stringify(body) ? { value: kept.value } : KEY_REUSED;
  }
  function keep(key: string, scope: string, body: unknown, value: unknown): void {
    keys.set(`${scope}:${key}`, { body: JSON.stringify(body), value });
  }
  const isReused = (outcome: object): outcome is typeof KEY_REUSED => "code" in outcome;

  const stories: Omit<StoryService, "attachPhoto" | "updatePhoto" | "removePhoto"> = {
    async list({ orgId, pubId, filter }) {
      const checked = await check<{ items: StoryListItemDto[]; nextCursor: string | null }>("stories.list", orgId, pubId, "story.view");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const q = filter.q?.trim().toLowerCase();
      const matching = rows
        .filter((story) => story.orgId === orgId && story.publicationId === pubId && sees(s, story, person.userId))
        .filter((story) => !filter.status || story.status === filter.status)
        .filter((story) => !filter.edition || story.edition?.id === filter.edition)
        .filter((story) => filter.assignee !== "me" || story.assignee?.id === person.userId)
        .filter((story) => !filter.reporter || story.reporter.id === filter.reporter)
        .filter((story) => !q || `${story.headline}\n${story.body}`.toLowerCase().includes(q))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.order - a.order);
      const limit = filter.limit ?? 50;
      const start = filter.cursor ? Number(filter.cursor.replace("cursor-", "")) : 0;
      if (!Number.isInteger(start) || start < 0) return failure(invalid("querystring.cursor", "is not a cursor this API gave"));
      const page = matching.slice(start, start + limit);
      return success({
        items: page.map((story) => listItem(view(story, s, person.userId))),
        nextCursor: start + limit < matching.length ? `cursor-${start + limit}` : null,
      });
    },

    async get({ orgId, pubId, storyId }) {
      const checked = await check<StoryDto>("stories.get", orgId, pubId, "story.view");
      if (refused(checked)) return checked;
      const story = find(orgId, pubId, storyId);
      if (!story || !sees(checked.s, story, checked.person.userId)) return failure(NOT_FOUND);
      return success(view(story, checked.s, checked.person.userId));
    },

    async create({ orgId, pubId, input, idempotencyKey }) {
      const checked = await check<StoryDto>("stories.create", orgId, pubId, "story.create");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const replayed = replay<string>(idempotencyKey, "create", input);
      if (replayed && isReused(replayed)) return failure(replayed);
      if (replayed) {
        const story = find(orgId, pubId, replayed.value);
        return story ? success(view(story, s, person.userId)) : failure(NOT_FOUND);
      }
      const desk = ["priority", "pagePin", "editionId", "deskNote"] as const;
      if (!isDesk(s) && desk.some((field) => input[field] !== undefined)) return failure(NOT_ALLOWED);
      const headline = cleanText(input.headline);
      if (headline === "") return failure(invalid("body.headline", "Every story needs a headline."));
      const edition = placement(orgId, pubId, input.editionId ?? null);
      if (edition === undefined) return failure(invalid("body.editionId", "is not an edition of this publication"));
      counter += 1;
      clock += 1;
      const made = row(0, {
        id: `story-new-${String(counter).padStart(3, "0")}`,
        headline,
        kicker: cleanText(input.kicker),
        deck: cleanText(input.deck),
        byline: cleanText(input.byline),
        body: cleanText(input.body),
        language: input.language ?? "mr",
        priority: input.priority ?? 3,
        pagePin: input.pagePin ?? null,
        edition,
        deskNote: input.deskNote ?? "",
        status: "draft",
        reporter: { id: person.userId, name: person.name },
        updatedAt: `2026-10-22T10:${String(clock).padStart(2, "0")}:00.000Z`,
        updatedBy: { id: person.userId, name: person.name },
        orgId,
        publicationId: pubId,
      });
      rows = [...rows, { ...made, order: 100 + counter }];
      deps.emit?.(orgId, { type: "story", publicationId: pubId, storyId: made.id });
      keep(idempotencyKey, "create", input, made.id);
      return success(view(made, s, person.userId));
    },

    async update({ orgId, pubId, storyId, patch }) {
      const checked = await check<StoryDto>("stories.update", orgId, pubId, "story.edit_own");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const story = find(orgId, pubId, storyId);
      if (!story || !sees(s, story, person.userId)) return failure(NOT_FOUND);
      if (patch.baseRevision !== story.revision) {
        return failure({ ...answer(409, "story_changed", "Someone changed this story."), current: view(story, s, person.userId) });
      }
      if (!canEdit(s, story, person.userId)) return failure(NOT_ALLOWED);
      const { baseRevision: _base, editionId: _edition, ...fields } = patch;
      const deskFields = ["priority", "pagePin", "deskNote"] as const;
      if (!isDesk(s) && (deskFields.some((field) => fields[field] !== undefined) || patch.editionId !== undefined)) {
        return failure(NOT_ALLOWED);
      }
      const textKeys = ["headline", "kicker", "deck", "byline", "body"] as const;
      const cleaned = Object.fromEntries(
        Object.entries(fields)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, (textKeys as readonly string[]).includes(key) ? cleanText(value as string) : value]),
      ) as Partial<Row>;
      if (cleaned.headline !== undefined && cleaned.headline === "") {
        return failure(invalid("body.headline", "Every story needs a headline."));
      }
      if (patch.editionId !== undefined) {
        const edition = placement(orgId, pubId, patch.editionId);
        if (edition === undefined) return failure(invalid("body.editionId", "is not an edition of this publication"));
        cleaned.edition = edition;
      }
      // as the API's checkPlacement: a page pin past the edition's last page is refused, nothing saved
      const pin = cleaned.pagePin === undefined ? story.pagePin : cleaned.pagePin;
      const placedIn = cleaned.edition === undefined ? story.edition : cleaned.edition;
      const pages = placedIn ? editionRows.find((candidate) => candidate.id === placedIn.id)?.pages : undefined;
      if (pin !== null && pages !== undefined && pin > pages) {
        return failure(invalid("body.pagePin", `is past the edition's last page (${pages})`));
      }
      const text = textKeys.some((key) => cleaned[key] !== undefined && cleaned[key] !== story[key]);
      const changes = cleaned;
      return success(view(touch(story, person, changes, text), s, person.userId));
    },

    async transition({ orgId, pubId, storyId, to, baseRevision, comment, idempotencyKey }) {
      const checked = await check<StoryDto>("stories.transition", orgId, pubId, "story.edit_own");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const replayed = replay<StoryDto>(idempotencyKey, "transition", { storyId, to, baseRevision, comment });
      if (replayed && isReused(replayed)) return failure(replayed);
      if (replayed) return success({ ...replayed.value });
      const story = find(orgId, pubId, storyId);
      if (!story || !sees(s, story, person.userId)) return failure(NOT_FOUND);
      if (baseRevision !== story.revision) {
        return failure({ ...answer(409, "story_changed", "Someone changed this story."), current: view(story, s, person.userId) });
      }
      if (!transitions(s, story, person.userId).includes(to)) {
        return failure(to === "filed" || isDesk(s) ? INVALID_TRANSITION : NOT_ALLOWED);
      }
      if (to === "draft" && (comment ?? "").trim() === "") {
        return failure(invalid("body.comment", "Say why the story goes back to its reporter."));
      }
      const target: StoryStatusDto = to === "restore" ? (before.get(story.id) ?? "draft") : to;
      if (to === "held" || to === "spiked") before = new Map(before).set(story.id, story.status);
      const after = touch(story, person, { status: target }, false);
      // a move's comment is a thread of the mover's on the story (a send-back's always has one)
      const note = cleanText(comment);
      const noteId = note === "" ? null : addComment(after, person, null, note).id;
      const actor = { id: person.userId, name: person.name };
      if (to === "filed") {
        const desk = (deps.members?.(orgId) ?? []).filter((id) => {
          const standing = deps.standing(id, orgId, pubId);
          return standing ? has(standing, "editor", "sub_editor") : false;
        });
        tell(after, audience(after, desk, person.userId), { kind: "story_filed", actor });
      }
      if (to === "draft" && noteId) {
        tell(after, audience(after, [after.reporter.id], person.userId), { kind: "story_sent_back", commentId: noteId, actor });
      }
      const moved = view(rows.find((candidate) => candidate.id === after.id) ?? after, s, person.userId);
      keep(idempotencyKey, "transition", { storyId, to, baseRevision, comment }, moved);
      return success(moved);
    },

    async assign({ orgId, pubId, storyId, baseRevision, userId }) {
      const checked = await check<StoryDto>("stories.assign", orgId, pubId, "story.assign");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const story = find(orgId, pubId, storyId);
      if (!story || !sees(s, story, person.userId)) return failure(NOT_FOUND);
      if (baseRevision !== story.revision) {
        return failure({ ...answer(409, "story_changed", "Someone changed this story."), current: view(story, s, person.userId) });
      }
      if (userId !== null && !deps.standing(userId, orgId, pubId)) {
        return failure(invalid("body.userId", "is not a member who reaches this publication"));
      }
      const assignee = userId === null ? null : { id: userId, name: deps.nameOf(userId) ?? userId };
      const after = touch(story, person, { assignee }, false);
      if (assignee && assignee.id !== story.assignee?.id) {
        tell(after, audience(after, [assignee.id], person.userId), { kind: "story_assigned", actor: { id: person.userId, name: person.name } });
      }
      return success(view(after, s, person.userId));
    },

    async paste({ orgId, pubId, text, editionId, idempotencyKey }) {
      const checked = await check<PasteResultDto>("stories.paste", orgId, pubId, "story.create");
      if (refused(checked)) return checked;
      const { s } = checked;
      const replayed = replay<PasteResultDto>(idempotencyKey, "paste", { text, editionId });
      if (replayed && isReused(replayed)) return failure(replayed);
      if (replayed) return success(replayed.value);
      if (!isDesk(s) && editionId !== undefined) return failure(NOT_ALLOWED);
      const parts = text.split(/\r?\n[ \t]*-{3,}[ \t]*(?:\r?\n|$)/);
      const created: StoryDto[] = [];
      const skipped: { headline: string; reason: string }[] = [];
      for (const part of parts) {
        const lines = part.split(/\r?\n/).filter((line) => line.trim() !== "");
        const [first, second, ...rest] = lines;
        if (first === undefined) continue;
        const byline = second && /^\s*(byline|वार्ताहर)\s*[:：]/i.test(second) ? second.replace(/^[^:：]*[:：]\s*/, "") : "";
        const body = (byline ? rest : [second, ...rest].filter((line) => line !== undefined)).join("\n").trim();
        if (body === "") {
          skipped.push({ headline: first.trim().slice(0, 200), reason: "Every article needs some text." });
          continue;
        }
        const made = await stories.create({
          orgId,
          pubId,
          input: { headline: first.trim(), byline, body, ...(editionId ? { editionId } : {}) },
          idempotencyKey: `${idempotencyKey}:${created.length}`,
        });
        if (made.ok) created.push(made.value);
      }
      if (created.length === 0) {
        return failure(
          invalid(
            "body.text",
            "No articles were found. Put each article's headline on its first line, its text below it, and a line with only --- between articles.",
          ),
        );
      }
      const result = { created, skipped };
      keep(idempotencyKey, "paste", { text, editionId }, result);
      return success(result);
    },
  };


  const PHOTO_NOT_THEIRS = NOT_ALLOWED;
  /** canAttachPhoto: whoever edits the story, or a Photo Editor of the publication on any story they see but a spiked one. */
  const mayPhoto = (s: MockStanding, story: Row, userId: string) =>
    canEdit(s, story, userId) || (story.status !== "spiked" && sees(s, story, userId) && has(s, "photo_editor"));
  /** maySee: all of the publication's pictures with a full media.view; a Reporter's own, or their stories' photos. */
  const maySeeAsset = (s: MockStanding, asset: MockAsset, userId: string) => {
    if (asset.status === "rejected") return false;
    const seen = reach("media.view", s.orgRole, s.access);
    if (seen === "full") return true;
    if (seen !== "scoped") return false;
    return asset.uploadedBy === userId || rows.some((story) => story.photo?.assetId === asset.id && theirs(story, userId));
  };
  const changed = (story: Row, s: MockStanding, userId: string) =>
    failure<StoryDto>({ ...answer(409, "story_changed", "Someone changed this story."), current: view(story, s, userId) });

  const photoOps = {
    async attachPhoto({ orgId, pubId, storyId, baseRevision, assetId, caption, credit }: Parameters<StoryService["attachPhoto"]>[0]) {
      const checked = await check<StoryDto>("stories.photo", orgId, pubId, "media.upload");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const story = find(orgId, pubId, storyId);
      if (!story || !sees(s, story, person.userId)) return failure<StoryDto>(NOT_FOUND);
      if (baseRevision !== story.revision) return changed(story, s, person.userId);
      if (!mayPhoto(s, story, person.userId)) return failure<StoryDto>(PHOTO_NOT_THEIRS);
      const asset = assets.get(assetId);
      if (asset && asset.pubId === pubId && asset.status !== "rejected" && !maySeeAsset(s, asset, person.userId)) {
        return failure<StoryDto>(NOT_FOUND);
      }
      if (!asset || asset.pubId !== pubId || asset.status === "rejected") {
        return failure<StoryDto>(invalid("body.assetId", "is not a picture of this publication"));
      }
      const photo = {
        assetId,
        caption: cleanText(caption),
        credit: cleanText(credit),
        status: asset.status,
        problem: null,
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
        previewUrl: null,
      };
      return success(view(touch(story, person, { photo }, false), s, person.userId));
    },
    async updatePhoto({ orgId, pubId, storyId, baseRevision, caption, credit }: Parameters<StoryService["updatePhoto"]>[0]) {
      const checked = await check<StoryDto>("stories.photo", orgId, pubId, "media.upload");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const story = find(orgId, pubId, storyId);
      if (!story || !sees(s, story, person.userId)) return failure<StoryDto>(NOT_FOUND);
      if (baseRevision !== story.revision) return changed(story, s, person.userId);
      if (!mayPhoto(s, story, person.userId)) return failure<StoryDto>(PHOTO_NOT_THEIRS);
      if (!story.photo) return failure<StoryDto>(NOT_FOUND);
      const photo = {
        ...story.photo,
        ...(caption !== undefined ? { caption: cleanText(caption) } : {}),
        ...(credit !== undefined ? { credit: cleanText(credit) } : {}),
      };
      return success(view(touch(story, person, { photo }, false), s, person.userId));
    },
    async removePhoto({ orgId, pubId, storyId, baseRevision }: Parameters<StoryService["removePhoto"]>[0]) {
      const checked = await check<StoryDto>("stories.photo", orgId, pubId, "media.upload");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const story = find(orgId, pubId, storyId);
      if (!story || !sees(s, story, person.userId)) return failure<StoryDto>(NOT_FOUND);
      if (baseRevision !== story.revision) return changed(story, s, person.userId);
      if (!mayPhoto(s, story, person.userId)) return failure<StoryDto>(PHOTO_NOT_THEIRS);
      if (!story.photo) return failure<StoryDto>(NOT_FOUND);
      return success(view(touch(story, person, { photo: null }, false), s, person.userId));
    },
  };
  const withPhotos: StoryService = { ...stories, ...photoOps };

  /** A new comment (or reply) on the story, and its live update; who is told is the caller's to decide. */
  function addComment(story: Row, by: { userId: string; name: string }, parentId: string | null, body: string): CommentRow {
    commentCounter += 1;
    clock += 1;
    const at = `2026-10-22T10:${String(clock).padStart(2, "0")}:00.000Z`;
    const made: CommentRow = {
      id: `comment-new-${String(commentCounter).padStart(3, "0")}`,
      orgId: story.orgId,
      pubId: story.publicationId,
      storyId: story.id,
      parentId,
      author: { id: by.userId, name: by.name },
      body,
      createdAt: at,
      updatedAt: at,
      resolved: null,
      order: 100 + commentCounter,
    };
    comments = [...comments, made];
    deps.emit?.(story.orgId, { type: "comment", publicationId: story.publicationId, storyId: story.id, commentId: made.id });
    return made;
  }
  const COMMENT_LIMIT = 10_000;
  /** cleanText for a comment: the Desk's cleaning, at most 10,000 characters, never empty. */
  function commentBody(body: string): { ok: true; body: string } | { ok: false; problem: Answer } {
    const text = cleanText(body);
    if (text === "") return { ok: false, problem: invalid("body.body", "A comment needs some text.") };
    const n = [...text].length;
    if (n > COMMENT_LIMIT) {
      return { ok: false, problem: invalid("body.body", `The comment is too long (${n} characters; the most is ${COMMENT_LIMIT}).`) };
    }
    return { ok: true, body: text };
  }
  const commentView = (comment: CommentRow, s: MockStanding, story: Row, userId: string): CommentDto => ({
    id: comment.id,
    storyId: comment.storyId,
    parentId: comment.parentId,
    author: { ...comment.author },
    body: comment.body,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    edited: comment.updatedAt > comment.createdAt,
    resolved: comment.resolved ? { at: comment.resolved.at, by: { ...comment.resolved.by } } : null,
    can: { edit: canEditComment(s, story, comment, userId), resolve: canResolve(s, story, comment, userId) },
  });

  const commentService: CommentService = {
    async list({ orgId, pubId, storyId }) {
      const checked = await check<CommentDto[]>("comments.list", orgId, pubId, "comment.read");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const story = find(orgId, pubId, storyId);
      if (!story || !canReadComments(s, story, person.userId)) return failure(NOT_FOUND);
      return success(
        comments
          .filter((comment) => comment.storyId === storyId && comment.orgId === orgId && comment.pubId === pubId)
          .sort((a, b) => a.order - b.order)
          .map((comment) => commentView(comment, s, story, person.userId)),
      );
    },

    async create({ orgId, pubId, storyId, body, parentId, idempotencyKey }) {
      const checked = await check<CommentDto>("comments.create", orgId, pubId, "comment.write");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const input = { storyId, body, ...(parentId ? { parentId } : {}) };
      const replayed = replay<string>(idempotencyKey, "comment", input);
      if (replayed && isReused(replayed)) return failure(replayed);
      if (replayed) {
        // a replay shows the comment again, if the person still reads the story's comments
        const kept = comments.find((comment) => comment.id === replayed.value);
        const story = kept ? find(orgId, pubId, kept.storyId) : undefined;
        if (!kept || !story || !canReadComments(s, story, person.userId)) return failure(NOT_FOUND);
        return success(commentView(kept, s, story, person.userId));
      }
      const story = find(orgId, pubId, storyId);
      if (!story || !canReadComments(s, story, person.userId)) return failure(NOT_FOUND);
      if (!canComment(s, story, person.userId)) return failure(NOT_ALLOWED);
      let parent: CommentRow | undefined;
      if (parentId !== undefined) {
        parent = comments.find((comment) => comment.id === parentId && comment.pubId === pubId);
        if (!parent || parent.storyId !== storyId || parent.parentId !== null) {
          return failure(invalid("body.parentId", "is not the first comment of a thread on this story"));
        }
      }
      const text = commentBody(body);
      if (!text.ok) return failure(text.problem);
      const made = addComment(story, person, parent?.id ?? null, text.body);
      const writers = parent ? comments.filter((comment) => comment.id === parent.id || comment.parentId === parent.id).map((comment) => comment.author.id) : [];
      tell(story, audience(story, [story.reporter.id, story.assignee?.id, ...writers], person.userId, true), {
        kind: "comment",
        commentId: made.id,
        actor: { id: person.userId, name: person.name },
      });
      keep(idempotencyKey, "comment", input, made.id);
      return success(commentView(made, s, story, person.userId));
    },

    async update({ orgId, pubId, commentId, patch }) {
      const checked = await check<CommentDto>("comments.update", orgId, pubId, "comment.write");
      if (refused(checked)) return checked;
      const { person, s } = checked;
      const comment = comments.find((candidate) => candidate.id === commentId && candidate.orgId === orgId && candidate.pubId === pubId);
      if (!comment) return failure(NOT_FOUND);
      const story = find(orgId, pubId, comment.storyId);
      if (!story || !canReadComments(s, story, person.userId)) return failure(NOT_FOUND);
      if (patch.body === undefined && patch.resolved === undefined) {
        return failure(invalid("body", "change the body, or resolve or reopen the thread"));
      }
      let body: string | undefined;
      if (patch.body !== undefined) {
        if (!canEditComment(s, story, comment, person.userId)) return failure(NOT_ALLOWED);
        const text = commentBody(patch.body);
        if (!text.ok) return failure(text.problem);
        if (text.body !== comment.body) body = text.body;
      }
      let resolve: boolean | undefined;
      if (patch.resolved !== undefined) {
        if (comment.parentId !== null) {
          return failure(invalid("body.resolved", "A reply is resolved with its thread's first comment."));
        }
        if (!canResolve(s, story, comment, person.userId)) return failure(NOT_ALLOWED);
        if (patch.resolved !== (comment.resolved !== null)) resolve = patch.resolved;
      }
      if (body !== undefined || resolve !== undefined) {
        clock += 1;
        const at = `2026-10-22T10:${String(clock).padStart(2, "0")}:00.000Z`;
        if (body !== undefined) {
          comment.body = body;
          comment.updatedAt = at;
        }
        if (resolve !== undefined) comment.resolved = resolve ? { at, by: { id: person.userId, name: person.name } } : null;
        deps.emit?.(orgId, { type: "comment", publicationId: pubId, storyId: story.id, commentId: comment.id });
      }
      return success(commentView(comment, s, story, person.userId));
    },
  };

  /** The API's messageFor: a story's update to whoever sees it; a comment's also needs comment.read. */
  function hears(userId: string, orgId: string, event: LiveEventDto): boolean {
    if (event.type === "resync" || event.type === "notification") return true;
    if (event.type === "edition") {
      const standing = deps.standing(userId, orgId, event.publicationId);
      return standing !== undefined && reach("edition.view", standing.orgRole, standing.access) !== null;
    }
    const story = rows.find((candidate) => candidate.id === event.storyId && candidate.orgId === orgId);
    const standing = story ? deps.standing(userId, orgId, story.publicationId) : undefined;
    if (!story || !standing || story.publicationId !== event.publicationId || !sees(standing, story, userId)) return false;
    return event.type === "story" || reach("comment.read", standing.orgRole, standing.access) !== null;
  }

  function shown(userId: string, orgId: string, storyId: string) {
    const story = rows.find((candidate) => candidate.id === storyId && candidate.orgId === orgId);
    const standing = story ? deps.standing(userId, orgId, story.publicationId) : undefined;
    return story && standing && sees(standing, story, userId) ? { headline: story.headline, status: story.status } : null;
  }

  function editionView(edition: EditionRow, s?: MockStanding): PubEditionDto {
    const { orgId: _org, publicationId: _pub, ...fields } = edition;
    // as the API: a role that sees no stories (Advertising) is not told how many there are
    if (s && scopeOf(s) === "none") return { ...fields, counts: null };
    const its = rows.filter((story) => story.orgId === edition.orgId && story.edition?.id === edition.id);
    return {
      ...fields,
      counts: {
        stories: its.length,
        ready: its.filter((story) => story.status === "ready").length,
        spiked: its.filter((story) => story.status === "spiked").length,
      },
    };
  }

  const editions: EditionService = {
    async list({ orgId, pubId }) {
      const checked = await check<readonly PubEditionDto[]>("editions.list", orgId, pubId, "edition.view");
      if (refused(checked)) return checked;
      const here = editionRows.filter((edition) => edition.orgId === orgId && edition.publicationId === pubId);
      return success([...here].sort((a, b) => b.date.localeCompare(a.date)).map((edition) => editionView(edition, checked.s)));
    },

    async create({ orgId, pubId, input, idempotencyKey }) {
      const checked = await check<PubEditionDto>("editions.create", orgId, pubId, "edition.create");
      if (refused(checked)) return checked;
      // a scoped ◐ (Advertising, Prepress) is refused: making an edition is the desk's
      if (reach("edition.create", checked.s.orgRole, checked.s.access) !== "full") return failure(NOT_ALLOWED);
      const replayed = replay<string>(idempotencyKey, "edition", input);
      if (replayed && isReused(replayed)) return failure(replayed);
      if (replayed) {
        const made = editionRows.find((edition) => edition.id === replayed.value);
        return made ? success(editionView(made)) : failure(NOT_FOUND);
      }
      const existing = editionRows.find((edition) => edition.orgId === orgId && edition.publicationId === pubId && edition.date === input.date);
      if (existing) {
        return failure({ ...answer(409, "edition_exists", "There is already an edition for that date."), current: editionView(existing) });
      }
      editionCounter += 1;
      const made: EditionRow = {
        id: `edition-new-${String(editionCounter).padStart(3, "0")}`,
        orgId,
        publicationId: pubId,
        date: input.date,
        pages: input.pages,
        backPageAds: input.backPageAds ?? true,
        volume: input.volume ?? "",
        issue: input.issue ?? "",
        price: input.price ?? "",
        status: "planning",
      };
      editionRows = [...editionRows, made];
      keep(idempotencyKey, "edition", input, made.id);
      deps.emit?.(orgId, { type: "edition", publicationId: pubId, editionId: made.id });
      return success(editionView(made));
    },

    async deskBundle({ orgId, pubId, editionId }) {
      const checked = await check<DeskBundleDto>("editions.deskBundle", orgId, pubId, "desk.export");
      if (refused(checked)) return checked;
      if (reach("desk.export", checked.s.orgRole, checked.s.access) !== "full") return failure(NOT_ALLOWED);
      const edition = editionRows.find((candidate) => candidate.id === editionId && candidate.orgId === orgId && candidate.publicationId === pubId);
      if (!edition) return failure(NOT_FOUND);
      const ready = rows.filter((story) => story.orgId === orgId && story.edition?.id === editionId && story.status === "ready");
      // a fictional ZIP: its first bytes, then the stories' ids
      const file = new Blob(["PK\u0003\u0004", ready.map((story) => story.id).join("\n")], { type: "application/zip" });
      return success({ file, filename: `pageinator-stories-${edition.date}.zip`, stories: ready.length });
    },
  };

  const media: MediaService = {
    async presign({ orgId, pubId, filename, contentType, bytes, idempotencyKey }) {
      const checked = await check<never>("media.presign", orgId, pubId, "media.upload");
      if (refused(checked)) return checked;
      const { person } = checked;
      const body = { filename, contentType, bytes };
      const replayed = replay<{ uploadId: string; url: string; fields: Record<string, string>; expiresAt: string }>(idempotencyKey, "presign", body);
      if (replayed && isReused(replayed)) return failure(replayed);
      if (replayed) return success(replayed.value);
      if (!(TYPES as readonly string[]).includes(contentType)) return failure(invalid("body.contentType", "must be JPEG, PNG or WebP"));
      if (bytes > MAX_BYTES) return failure(answer(413, "file_too_large", "This picture is larger than 40 MB."));
      const used = orgBytes.get(orgId) ?? 0;
      const count = uploadCount.get(person.userId) ?? 0;
      if (used + bytes > ORG_BYTES_PER_DAY || count >= UPLOADS_PER_HOUR) {
        return failure(answer(429, "slow_down", "Too many tries. Wait a minute and try again."));
      }
      orgBytes.set(orgId, used + bytes);
      uploadCount.set(person.userId, count + 1);
      const id = `upload-${String(uploads.size + 1).padStart(3, "0")}`;
      uploads.set(id, { id, orgId, pubId, userId: person.userId, contentType, bytes, status: "presigned" });
      const presigned = {
        uploadId: id,
        url: "mock-store://pgn-dev-work",
        fields: { key: `uploads/orgs/${orgId}/pubs/${pubId}/${id}`, "Content-Type": contentType, "x-amz-meta-upload-id": id },
        // the double has no clock: its policies do not run out (a test changes this answer to see one that has)
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
      keep(idempotencyKey, "presign", body, presigned);
      return success(presigned);
    },

    async send({ upload, file, onProgress, signal }) {
      const cancelled = answer(0, "upload_cancelled", "");
      if (signal?.aborted) return failure(cancelled);
      const problem = await deps.gate("media.send");
      if (problem) return failure(problem);
      const kept = uploads.get(upload.uploadId);
      if (!kept || upload.fields["Content-Type"] !== kept.contentType) return failure(answer(403, "upload_denied", "AccessDenied"));
      // the policy's content-length-range is the declared size exactly
      if (file.size !== kept.bytes) return failure(answer(400, "upload_size_mismatch", ""));
      onProgress?.(0.5);
      await Promise.resolve();
      if (signal?.aborted) return failure(cancelled);
      kept.file = file;
      onProgress?.(1);
      return success(undefined);
    },

    async complete({ orgId, pubId, uploadId }) {
      const checked = await check<AssetDto>("media.complete", orgId, pubId, "media.upload");
      if (refused(checked)) return checked;
      const { person } = checked;
      const upload = uploads.get(uploadId);
      if (!upload || upload.userId !== person.userId || upload.pubId !== pubId) return failure(NOT_FOUND);
      const asDto = (asset: MockAsset): AssetDto => ({
        id: asset.id,
        kind: "photo",
        status: asset.status,
        mime: asset.mime,
        bytes: asset.bytes,
        widthPx: asset.widthPx,
        heightPx: asset.heightPx,
        sha256: `fictional-${asset.id}`,
        createdAt: "2026-10-22T10:00:00.000Z",
      });
      if (upload.status === "completed" && upload.assetId) {
        const done = assets.get(upload.assetId);
        if (done) return success(asDto(done));
      }
      if (upload.status !== "presigned") return failure(answer(422, "not_a_picture", "This file is not a picture Pageinator can use."));
      if (!upload.file) return failure(invalid("params.u", "The file has not arrived yet."));
      const found = sniff(await headOf(upload.file));
      if (!found) {
        upload.status = "rejected";
        return failure({
          ...answer(422, "not_a_picture", "This file is not a picture Pageinator can use."),
          details: [{ field: "file", message: "The file was refused: it is not a JPEG, PNG or WebP picture." }],
        });
      }
      assetCounter += 1;
      const asset: MockAsset = {
        id: `asset-new-${String(assetCounter).padStart(3, "0")}`,
        orgId,
        pubId,
        uploadedBy: person.userId,
        ...found,
        bytes: upload.bytes,
        data: upload.file,
        status: "received",
      };
      assets = new Map(assets).set(asset.id, asset);
      upload.status = "completed";
      upload.assetId = asset.id;
      return success(asDto(asset));
    },

    fileUrl({ orgId, pubId, assetId }) {
      return `/api/v1/orgs/${encodeURIComponent(orgId)}/pubs/${encodeURIComponent(pubId)}/assets/${encodeURIComponent(assetId)}/file`;
    },

    async loadOriginal({ orgId, pubId, assetId }) {
      const checked = await check<Blob>("media.load", orgId, pubId, "media.view");
      if (refused(checked)) return checked;
      const asset = assets.get(assetId);
      if (!asset || asset.pubId !== pubId || !maySeeAsset(checked.s, asset, checked.person.userId)) return failure(NOT_FOUND);
      return success(asset.data);
    },
  };

  return {
    stories: withPhotos,
    editions,
    media,
    comments: commentService,
    hears,
    shown,
    reset() {
      comments = commentFixtures();
      commentCounter = 0;
      assets = fixtureAssets();
      uploads = new Map();
      uploadCount = new Map();
      orgBytes = new Map();
      assetCounter = 0;
      rows = fixtures();
      editionRows = editionFixtures();
      editionCounter = 0;
      counter = 0;
      clock = 0;
      before = new Map([["story-demo-005", "editing"]]);
      keys = new Map();
    },
    all: () => rows,
  };
}
