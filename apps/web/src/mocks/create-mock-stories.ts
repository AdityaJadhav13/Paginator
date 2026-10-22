/**
 * The stories double: a publication's stories answered as the API answers them (plan §5.2, §5.4; the API's
 * src/modules/stories): who sees which story (all, a Reporter's own, none), who edits and moves it, its version and
 * 409 story_changed with the story as it is now, the Idempotency-Key on create, paste and transitions, cursor pages.
 * The roles come from the same permission map the API uses (services/permissions.ts). Text is cleaned as the API's
 * cleanText (@pageinator/desk-text) cleans it: NFC, CR and CRLF to LF, control characters dropped, each line's trailing
 * space trimmed and the whole stripped; so an answer can differ from what was sent, as the real one does. An
 * Idempotency-Key replays its first answer only for the same body, and answers 422 idempotency_key_reused for another.
 * Its paste splits the text at lines of only `---` as the Desk does.
 * Fictional data only; deterministic (no clock, no randomness).
 */
import type {
  ApiProblem,
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
  | "stories.paste";

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
}

type Row = Omit<StoryDto, "can" | "commentCount" | "photo"> & { readonly orgId: string; readonly order: number };

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

export function createMockStories(deps: MockStoryDeps): { stories: StoryService; reset(): void; all(): readonly Row[] } {
  let rows = fixtures();
  let counter = 0;
  let clock = 0;
  /** Where a held or spiked story came from. */
  let before = new Map<string, StoryStatusDto>([["story-demo-005", "editing"]]);
  let keys = new Map<string, unknown>();

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
  const canComment = (s: MockStanding, story: Row, userId: string) => {
    const here = reach("comment.write", s.orgRole, s.access);
    return here === "full" || (here === "scoped" && theirs(story, userId));
  };

  function view(story: Row, s: MockStanding, userId: string): StoryDto {
    const { orgId: _org, order: _order, ...fields } = story;
    return {
      ...fields,
      reporter: { ...story.reporter },
      assignee: story.assignee ? { ...story.assignee } : null,
      edition: story.edition ? { ...story.edition } : null,
      updatedBy: { ...story.updatedBy },
      photo: null,
      commentCount: 0,
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
    permission: "story.view" | "story.create" | "story.edit_own" | "story.assign",
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
    const withCounts = changes.body !== undefined ? { ...next, words: words(next.body), isBrief: words(next.body) > 0 && words(next.body) <= 60 } : next;
    rows = rows.map((candidate) => (candidate.id === story.id ? withCounts : candidate));
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

  const stories: StoryService = {
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
        deskNote: input.deskNote ?? "",
        status: "draft",
        reporter: { id: person.userId, name: person.name },
        updatedAt: `2026-10-22T10:${String(clock).padStart(2, "0")}:00.000Z`,
        updatedBy: { id: person.userId, name: person.name },
        orgId,
        publicationId: pubId,
      });
      rows = [...rows, { ...made, order: 100 + counter }];
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
      const moved = view(touch(story, person, { status: target }, false), s, person.userId);
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
      return success(view(touch(story, person, { assignee }, false), s, person.userId));
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
          input: { headline: first.trim(), byline, body },
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

  return {
    stories,
    reset() {
      rows = fixtures();
      counter = 0;
      clock = 0;
      before = new Map([["story-demo-005", "editing"]]);
      keys = new Map();
    },
    all: () => rows,
  };
}
