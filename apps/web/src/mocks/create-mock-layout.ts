/**
 * Editions and layout's double (docs/product/10-l2-newsroom-plan.md §1 L2.3), answered as the API's layout routes: the
 * engine profiles (settings.view to list, settings.edit to make one from an uploaded dataset bundle), an edition's
 * layout (pages.view: readiness from its stories, the back-page ad slots, the active, last and board runs), ad slots
 * set and cleared (layout.generate or ads.manage), runs started and cancelled (layout.generate; 409 run_active,
 * layout_refused, run_finished) and a run's files by link (previews pages.view, PDFs proof.view, the press ZIP
 * export.press). The engine is the controller: tests (and the demo) move a run on, finish it, fit an ad and finish a
 * profile's setup; each change is heard live (`layout`, `profile`). The publication's sections (publication.view to list,
 * settings.edit to make, rename, move, archive; 409 section_exists), as the sections routes. Fictional data only.
 */
import type {
  AdSlotDto,
  ApiProblem,
  DeskTextDto,
  EditionLayoutDto,
  EngineProfileDto,
  LayoutPageDto,
  LayoutRunDto,
  LayoutService,
  LiveEventDto,
  OnboardingDto,
  SectionDto,
  ServiceResult,
} from "../services/index.ts";
import type { TemplateCandidateDto, TemplateOutlineDto } from "../services/layout-service.ts";
import { reach, type Permission } from "../services/permissions.ts";
import type { MockStanding, MockStoryDeps } from "./create-mock-stories.ts";

export type MockLayoutOperation =
  | "layout.profiles"
  | "layout.profileCreate"
  | "layout.get"
  | "layout.ads"
  | "layout.run"
  | "layout.cancel"
  | "layout.files"
  | "layout.sections"
  | "layout.templates"
  | "layout.templateChoose"
  | "layout.onboarding";

/** What the double needs of the stories double: the edition, its stories, a picture and an upload. */
export interface MockLayoutDeps {
  readonly person: MockStoryDeps["person"];
  readonly standing: MockStoryDeps["standing"];
  readonly signedOut: MockStoryDeps["signedOut"];
  gate(operation: MockLayoutOperation): Promise<ApiProblem | undefined>;
  emit(orgId: string, event: LiveEventDto): void;
  edition(
    orgId: string,
    pubId: string,
    editionId: string,
  ): { readonly pages: number; readonly backPageAds: boolean } | undefined;
  stories(
    orgId: string,
    pubId: string,
    editionId: string,
  ): readonly {
    readonly id: string;
    readonly headline: string;
    readonly status: string;
    readonly words: number;
    readonly isBrief: boolean;
    readonly pagePin: number | null;
    readonly photo: { readonly status: string } | null;
  }[];
  assetReady(orgId: string, pubId: string, assetId: string): boolean | undefined;
  upload(
    orgId: string,
    pubId: string,
    uploadId: string,
  ):
    | { readonly contentType: string; readonly bytes: number; readonly filename: string; readonly userId: string }
    | undefined;
}

export interface MockLayoutController {
  /** The engine's progress: the run's state, its pages' states and its message. */
  progress(
    runId: string,
    patch: {
      readonly state?: "planning" | "layout" | "finishing";
      readonly pages?: readonly (readonly [number, LayoutPageDto["state"]])[];
      readonly message?: DeskTextDto | null;
    },
  ): void;
  /** The run ended: done (every page laid out and checked, unless `failedPage`), or failed with the Desk's words. */
  finish(
    runId: string,
    outcome?: {
      readonly state?: "done" | "failed";
      readonly error?: DeskTextDto;
      readonly message?: DeskTextDto;
      readonly failedPage?: number;
    },
  ): void;
  /** The ad's artwork fitted into its slot, or refused with the Desk's words. */
  fitAd(editionId: string, slot: string, problem?: DeskTextDto): void;
  /** The profile's setup ended: ready, or failed with the engine's code and words. */
  setUp(profileId: string, error?: { readonly code: string; readonly message: DeskTextDto }): void;
  /** The newest run of an edition (its id), active or not. */
  latestRun(editionId: string): string | undefined;
  /** The onboarding job's heartbeat: its step and how far (L4). */
  onboardProgress(id: string, progress: NonNullable<OnboardingDto["progress"]>): void;
  /** The onboarding job ended: ready (a fictional report and each file's check), rejected with the set's reason, or
   * failed (a worker.… code). `files` replaces the checks. */
  onboardFinish(
    id: string,
    outcome?: {
      readonly state?: "ready" | "rejected" | "failed";
      readonly code?: string;
      readonly params?: Record<string, string | number> | null;
      readonly files?: readonly NonNullable<OnboardingDto["files"][number]["check"]>[];
    },
  ): void;
}

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
const SECTION_EXISTS = answer(409, "section_exists", "This paper already has a section of that name.");
const KEY_REUSED = answer(422, "idempotency_key_reused", "This key was already used with a different request.");
const success = <T>(value: T): ServiceResult<T, ApiProblem> => ({ ok: true, value });
const failure = <T>(problem: ApiProblem): ServiceResult<T, ApiProblem> => ({ ok: false, error: { ...problem } });
const desk = (code: string, text: string, params: Record<string, string | number> | null = null): DeskTextDto => ({
  text,
  code,
  params,
});
/** A page as the layout made it: nothing edited in the page editor (the double does not model saves). */
const SAVED: Pick<LayoutPageDto, "editedUnsaved" | "needsSave" | "needsSaveReasons"> = {
  editedUnsaved: false,
  needsSave: false,
  needsSaveReasons: [],
};

const SAHYADRI = "org-demo-sahyadri";
const PUNE = "pub-demo-pune-daily";
const EDITION_B = "edition-demo-2026-10-24";
const SHA = (digit: string) => digit.repeat(64);
const EDITOR = { id: "user-demo-sahyadri-editor", name: "Sahyadri Demo Editor" };

/** What a paper of 4, 8 or 16 pages needs (a fictional plan; the engine's comes from the paper's own pages). */
const NEEDS: Readonly<Record<number, { stories: number; briefs: number; photos: number; words: number }>> = {
  4: { stories: 10, briefs: 3, photos: 4, words: 3200 },
  8: { stories: 18, briefs: 6, photos: 8, words: 6400 },
  16: { stories: 34, briefs: 12, photos: 16, words: 12800 },
};
/** The back page's ad slots when the edition carries back-page ads (fictional sizes). */
const BACK_SLOTS = [
  { slot: "back-1", wMm: 330, hMm: 170 },
  { slot: "back-2", wMm: 162, hMm: 100 },
] as const;

interface ProfileRow {
  readonly orgId: string;
  readonly pubId: string;
  value: EngineProfileDto;
  /** the template candidates its setup recorded, per role (null: none recorded) */
  candidates?: Record<string, TemplateCandidateDto[]> | null;
}

const TEMPLATE_ROLES = ["front", "inside_imprint", "inside", "back"] as const;
interface OnboardingRow {
  readonly orgId: string;
  readonly pubId: string;
  value: OnboardingDto;
}
const ONBOARDING_ACTIVE = answer(409, "onboarding_active", "This paper's design is being learned now. Wait or cancel.");
const ONBOARDING_FINISHED = answer(409, "onboarding_finished", "This has already ended.");
const ONBOARDING_NOT_READY = answer(409, "onboarding_not_ready", "The design is not ready to use.");
/** What the engine read from a fictional paper's past editions (aggregates only). */
const ONBOARD_REPORT: NonNullable<OnboardingDto["report"]> = {
  editions: 14,
  pages: 112,
  calibration_editions: 9,
  page_w_mm: 330,
  page_h_mm: 520,
  grid: { columns: 8, column_width_mm: 38.5, gutter_mm: 4.2 },
  grids_seen: 2,
  script: "deva",
  excluded_share: 0.03,
  roles: { front: 14, inside_imprint: 14, inside: 70, back: 14 },
};
const PROFILE_SETTING_UP = answer(
  409,
  "profile_setting_up",
  "An engine profile is being set up now. Wait until it is ready or has failed, then choose again.",
);
const NO_PROFILE = answer(
  409,
  "no_profile",
  "This paper has no engine profile ready yet. Upload its dataset bundle in Settings first.",
);
/** A fictional broadsheet outline (330 × 520 mm): a masthead band on the front, a folio line inside, ads on the back. */
function outline(role: string, variant: number): TemplateOutlineDto {
  const top = role === "front" ? 95 + variant * 10 : 28;
  const bottom = role === "back" ? 330 : 505;
  return {
    pageWMm: 330,
    pageHMm: 520,
    news: [[12, top, 318, bottom]],
    kept: [
      role === "front"
        ? { kind: "masthead", box: [12, 10, 318, 70 + variant * 10] }
        : { kind: "furniture", box: [12, 10, 318, 20] },
      { kind: "rule", box: [12, top - 4, 318, top - 3.5] },
      ...(role === "inside_imprint" ? [{ kind: "furniture", box: [12, 508, 318, 514] as [number, number, number, number] }] : []),
    ],
    adSlots:
      role === "back"
        ? [
            [12, 340, 318, 510],
            [12, 335, 170, 338],
          ].slice(0, 1 + (variant % 2)) as [number, number, number, number][]
        : [],
  };
}
const candidatesFixture = (): Record<string, TemplateCandidateDto[]> =>
  Object.fromEntries(
    TEMPLATE_ROLES.map((r) => [
      r,
      [0, 1, 2].map((v) => ({
        name: `${r.replace("_", "-")}-2026-10-${String(20 - v * 7).padStart(2, "0")}`,
        date: `2026-10-${String(20 - v * 7).padStart(2, "0")}`,
        page: r === "front" ? 1 : r === "inside_imprint" ? 2 : r === "inside" ? 3 : 8,
        outline: outline(r, v),
      })),
    ]),
  );
const TEMPLATES = Object.fromEntries(TEMPLATE_ROLES.map((r) => [r, `${r.replace("_", "-")}-2026-10-20`]));
interface RunRow {
  readonly orgId: string;
  readonly pubId: string;
  value: LayoutRunDto;
}
interface SlotRow {
  state: AdSlotDto["state"];
  assetId: string | null;
  problem: DeskTextDto | null;
}

/** A fictional page preview: a grey page with a headline bar and columns of text. */
const PAGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 70"><rect width="50" height="70" fill="#fff"/>' +
  '<rect x="4" y="4" width="42" height="7" fill="#333"/><rect x="4" y="14" width="26" height="18" fill="#bbb"/>' +
  Array.from(
    { length: 12 },
    (_, i) => `<rect x="${i % 2 ? 27 : 4}" y="${35 + Math.floor(i / 2) * 5}" width="19" height="2" fill="#999"/>`,
  ).join("") +
  "</svg>";

const deskKey = (storyId: string) =>
  `a-${storyId
    .replace(/[^0-9a-f]/g, "")
    .padStart(10, "0")
    .slice(-10)}`;
const role = (page: number, pages: number): LayoutPageDto["role"] =>
  page === 1 ? "front" : page === pages ? "back" : "inside";

function profileFixtures(): ProfileRow[] {
  const base = {
    datasetBytes: 734_003_200,
    engineVersion: "desk-engine 0.9.4 (fictional)",
    templates: TEMPLATES,
    grid: { columns: 8, columnMm: 38.5, gutterMm: 4.2 },
    error: null,
    basedOn: null,
    templateChoice: null,
    createdBy: EDITOR,
  };
  return [
    {
      orgId: SAHYADRI,
      pubId: PUNE,
      value: {
        ...base,
        id: "profile-demo-2",
        version: 2,
        state: "ready",
        datasetSha256: SHA("b"),
        configSha256: SHA("c"),
        createdAt: "2026-10-20T06:00:00.000Z",
        updatedAt: "2026-10-20T06:12:00.000Z",
      },
      candidates: candidatesFixture(),
    },
    {
      orgId: SAHYADRI,
      pubId: PUNE,
      value: {
        ...base,
        id: "profile-demo-1",
        version: 1,
        state: "ready",
        datasetSha256: SHA("a"),
        configSha256: SHA("d"),
        createdAt: "2026-10-12T06:00:00.000Z",
        updatedAt: "2026-10-12T06:10:00.000Z",
      },
    },
  ];
}

export function createMockLayout(deps: MockLayoutDeps): {
  layout: LayoutService;
  controller: MockLayoutController;
  reset(): void;
} {
  let profiles = profileFixtures();
  let onboardings: OnboardingRow[] = [];
  let runs = new Map<string, RunRow>();
  let slots = new Map<string, Map<string, SlotRow>>();
  let keys = new Map<string, { body: string; value: unknown }>();
  /** each publication's sections: in use first, in their order, then the archived */
  let sections = new Map<string, SectionDto[]>();
  let counter = 0;
  let clock = 0;
  const now = () => {
    clock += 1;
    return `2026-10-24T09:${String(clock % 60).padStart(2, "0")}:00.000+05:30`;
  };

  async function check(
    operation: MockLayoutOperation,
    orgId: string,
    pubId: string,
    allowed: (s: MockStanding) => boolean,
  ): Promise<
    { problem: ServiceResult<never, ApiProblem> } | { person: { userId: string; name: string }; s: MockStanding }
  > {
    const problem = await deps.gate(operation);
    if (problem) return { problem: failure(problem) };
    const person = deps.person();
    if (!person) return { problem: deps.signedOut() };
    const s = deps.standing(person.userId, orgId, pubId);
    if (!s) return { problem: failure(NOT_FOUND) };
    if (s.twoStepBlocked) return { problem: failure(TWO_STEP) };
    if (!allowed(s)) return { problem: failure(NOT_ALLOWED) };
    return { person, s };
  }
  const can = (permission: Permission) => (s: MockStanding) => reach(permission, s.orgRole, s.access) !== null;
  const tell = (orgId: string, pubId: string, editionId: string, runId: string | null) =>
    deps.emit(orgId, { type: "layout", publicationId: pubId, editionId, runId });

  const inUse = (orgId: string, pubId: string) =>
    profiles.find((row) => row.orgId === orgId && row.pubId === pubId && row.value.state === "ready")?.value ?? null;

  function slotsOf(editionId: string, pages: number, backPageAds: boolean): AdSlotDto[] {
    if (!backPageAds) return [];
    const kept = slots.get(editionId) ?? new Map<string, SlotRow>();
    return BACK_SLOTS.map((plan) => {
      const row = kept.get(plan.slot) ?? { state: "empty" as const, assetId: null, problem: null };
      return {
        slot: plan.slot,
        page: pages,
        wMm: plan.wMm,
        hMm: plan.hMm,
        state: row.state,
        assetId: row.assetId,
        problem: row.problem,
      };
    });
  }

  function readiness(orgId: string, pubId: string, editionId: string, pages: number): EditionLayoutDto["readiness"] {
    const stories = deps.stories(orgId, pubId, editionId);
    const counted = stories.filter((story) => story.status === "ready" || story.status === "placed");
    const ref = (story: (typeof stories)[number]) => ({
      storyId: story.id,
      deskKey: deskKey(story.id),
      headline: story.headline || null,
    });
    return {
      needs: { ...NEEDS[pages]! },
      have: {
        stories: counted.filter((story) => !story.isBrief).length,
        briefs: counted.filter((story) => story.isBrief).length,
        photos: counted.filter((story) => story.photo).length,
        words: counted.reduce((sum, story) => sum + story.words, 0),
      },
      notReady: stories
        .filter((story) => !["ready", "placed", "spiked"].includes(story.status))
        .map((story) => ({ ...ref(story), status: story.status })),
      blockers: counted.flatMap((story) => {
        if (story.photo?.status === "received") {
          return [{ ...ref(story), code: "photo_preparing", message: "Its photo is still being prepared." }];
        }
        if (story.photo && story.photo.status !== "ready") {
          return [
            { ...ref(story), code: "photo_refused", message: "Its photo was refused: choose another, or take it off." },
          ];
        }
        if (story.pagePin !== null && story.pagePin > pages) {
          return [
            {
              ...ref(story),
              code: "page_pin",
              message: `It is pinned to page ${story.pagePin}, which this edition does not have.`,
            },
          ];
        }
        return [];
      }),
      measure: counted.length > 0 ? { state: "done", measured: counted.length, total: counted.length } : null,
    };
  }

  const ofEdition = (editionId: string) =>
    [...runs.values()].filter((row) => row.value.editionId === editionId).map((row) => row.value);
  const ACTIVE = ["queued", "planning", "layout", "finishing"];
  const clone = <T>(value: T): T => structuredClone(value);

  /** A done run's page: laid out, previewed and checked. */
  function donePage(page: number, pages: number, storyRefs: LayoutPageDto["stories"], warnings = 0): LayoutPageDto {
    return {
      page,
      role: role(page, pages),
      state: "done",
      stories: storyRefs,
      pdf: true,
      preview: true,
      check: { passed: true, fails: 0, warnings },
      warnings:
        warnings > 0
          ? [
              desk(
                "m.warn.emptyFoot",
                "About 18 mm of the page is left empty at the foot — add a short item or a photo",
                { mm: 18 },
              ),
            ]
          : [],
      message: null,
      ...SAVED,
    };
  }

  /** The Pune Daily Ledger's 24 October edition was laid out once (fictional): its board. */
  function boardFixture(): RunRow {
    const pages = 8;
    const lead = { storyId: "story-demo-004", deskKey: deskKey("story-demo-004"), headline: "गुरुवारी पाणीपुरवठा बंद" };
    const list: LayoutPageDto[] = Array.from({ length: pages }, (_, index) =>
      donePage(index + 1, pages, index === 0 ? [lead] : [], index === 0 ? 2 : 0),
    );
    list[2] = { ...list[2]!, check: { passed: false, fails: 3, warnings: 0 } };
    list[5] = {
      ...list[5]!,
      state: "failed",
      pdf: false,
      preview: false,
      check: null,
      message: desk("m.run.outOfTime", "the layout search ran out of time"),
    };
    return {
      orgId: SAHYADRI,
      pubId: PUNE,
      value: {
        id: "run-demo-001",
        editionId: EDITION_B,
        deskKey: "r-20261024-081500",
        state: "done",
        message: desk("m.run.madeN", "7 pages made.", { n: 7 }),
        error: null,
        profileVersion: 2,
        createdBy: EDITOR,
        createdAt: "2026-10-24T08:15:00.000+05:30",
        startedAt: "2026-10-24T08:15:02.000+05:30",
        finishedAt: "2026-10-24T08:17:16.000+05:30",
        elapsedS: 134,
        pages: list,
        notPlaced: [
          {
            storyId: null,
            deskKey: "a-00000000f1",
            headline: "Fictional brief left over",
            reason: desk(
              "m.plan.noRoom",
              "No room left — add pages, lower another story's priority, or pin it to a page",
            ),
          },
        ],
        files: { editionPdf: true, pressZip: true },
        timings: { layout: 98, check: 22 },
      },
    };
  }
  runs = new Map([["run-demo-001", boardFixture()]]);

  function view(
    orgId: string,
    pubId: string,
    editionId: string,
    pages: number,
    backPageAds: boolean,
  ): EditionLayoutDto {
    const profile = inUse(orgId, pubId);
    const mine = ofEdition(editionId).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    return {
      editionId,
      profile: profile ? { id: profile.id, version: profile.version } : null,
      readiness: profile ? readiness(orgId, pubId, editionId, pages) : null,
      slots: slotsOf(editionId, pages, backPageAds),
      active: clone(mine.find((run) => ACTIVE.includes(run.state)) ?? null),
      last: clone(mine.find((run) => !ACTIVE.includes(run.state)) ?? null),
      board: clone(mine.find((run) => run.state === "done") ?? null),
    };
  }

  const fileRule = (name: string): Permission =>
    name === "press-files.zip"
      ? "export.press"
      : name === "edition.pdf" || /^page-\d\d\.pdf$/.test(name)
        ? "proof.view"
        : "pages.view";

  const sectionsOf = (orgId: string, pubId: string) => {
    const key = `${orgId}/${pubId}`;
    if (!sections.has(key)) sections.set(key, []);
    return sections.get(key)!;
  };
  const sectionList = (list: SectionDto[]) => {
    list.sort((x, y) => Number(x.archived) - Number(y.archived)); // stable: the order in use is kept
    return success({ items: list.map((section) => ({ ...section })) });
  };
  const named = (list: readonly SectionDto[], name: string, except?: string) =>
    list.some((s) => !s.archived && s.id !== except && s.name.toLowerCase() === name.toLowerCase());

  const layout: LayoutService = {
    async listSections({ orgId, pubId }) {
      const checked = await check("layout.sections", orgId, pubId, can("publication.view"));
      if ("problem" in checked) return checked.problem;
      return sectionList(sectionsOf(orgId, pubId));
    },
    async addSection({ orgId, pubId, name }) {
      const checked = await check("layout.sections", orgId, pubId, can("settings.edit"));
      if ("problem" in checked) return checked.problem;
      const list = sectionsOf(orgId, pubId);
      if (named(list, name.trim())) return failure(SECTION_EXISTS);
      counter += 1;
      list.push({ id: `section-new-${String(counter).padStart(3, "0")}`, name: name.trim(), archived: false, stories: 0 });
      return sectionList(list);
    },
    async changeSection({ orgId, pubId, id, change }) {
      const checked = await check("layout.sections", orgId, pubId, can("settings.edit"));
      if ("problem" in checked) return checked.problem;
      const list = sectionsOf(orgId, pubId);
      const at = list.findIndex((s) => s.id === id);
      const section = list[at];
      if (!section) return failure(NOT_FOUND);
      const name = change.name?.trim() ?? section.name;
      const archived = change.archived ?? section.archived;
      if (!archived && named(list, name, id)) return failure(SECTION_EXISTS);
      const wasArchived = section.archived;
      list.splice(at, 1);
      const inUse = list.filter((s) => !s.archived).length;
      const place = archived ? list.length : Math.min(change.position ?? (wasArchived ? inUse : at), inUse);
      list.splice(place, 0, { ...section, name, archived });
      return sectionList(list);
    },
    async listProfiles({ orgId, pubId }) {
      const checked = await check("layout.profiles", orgId, pubId, can("settings.view"));
      if ("problem" in checked) return checked.problem;
      const items = profiles.filter((row) => row.orgId === orgId && row.pubId === pubId).map((row) => clone(row.value));
      return success({ items, inUse: inUse(orgId, pubId)?.id ?? null });
    },
    async createProfile({ orgId, pubId, uploadId, idempotencyKey }) {
      const checked = await check("layout.profileCreate", orgId, pubId, can("settings.edit"));
      if ("problem" in checked) return checked.problem;
      const body = JSON.stringify({ uploadId });
      const kept = keys.get(idempotencyKey);
      if (kept) return kept.body === body ? success(clone(kept.value as EngineProfileDto)) : failure(KEY_REUSED);
      const upload = deps.upload(orgId, pubId, uploadId);
      if (!upload || upload.contentType !== "application/zip") return failure(NOT_FOUND);
      counter += 1;
      const at = now();
      const version =
        Math.max(
          0,
          ...profiles.filter((row) => row.orgId === orgId && row.pubId === pubId).map((row) => row.value.version),
        ) + 1;
      const value: EngineProfileDto = {
        id: `profile-new-${String(counter).padStart(3, "0")}`,
        version,
        state: "setting_up",
        datasetSha256: SHA("e"),
        datasetBytes: upload.bytes,
        configSha256: null,
        engineVersion: null,
        templates: null,
        grid: null,
        error: null,
        basedOn: null,
        templateChoice: null,
        createdBy: { id: checked.person.userId, name: checked.person.name },
        createdAt: at,
        updatedAt: at,
      };
      profiles = [{ orgId, pubId, value }, ...profiles];
      keys = new Map(keys).set(idempotencyKey, { body, value: clone(value) });
      return success(clone(value));
    },
    async getOnboarding({ orgId, pubId }) {
      const checked = await check("layout.onboarding", orgId, pubId, can("settings.view"));
      if ("problem" in checked) return checked.problem;
      const [current, ...history] = onboardings
        .filter((row) => row.orgId === orgId && row.pubId === pubId)
        .map((row) => clone(row.value));
      return success({ current: current ?? null, history: history.slice(0, 10) });
    },
    async startOnboarding({ orgId, pubId, uploadIds, idempotencyKey }) {
      const checked = await check("layout.onboarding", orgId, pubId, can("settings.edit"));
      if ("problem" in checked) return checked.problem;
      const body = JSON.stringify({ uploadIds, permission: true });
      const kept = keys.get(idempotencyKey);
      if (kept) return kept.body === body ? success(clone(kept.value as OnboardingDto)) : failure(KEY_REUSED);
      const mine = onboardings.filter((row) => row.orgId === orgId && row.pubId === pubId);
      if (mine.some((row) => row.value.state === "queued" || row.value.state === "working"))
        return failure(ONBOARDING_ACTIVE);
      const files = uploadIds.map((uploadId) => deps.upload(orgId, pubId, uploadId));
      if (
        files.length < 3 ||
        files.length > 40 ||
        files.some((file) => !file || file.contentType !== "application/pdf" || file.userId !== checked.person.userId)
      )
        return failure(answer(400, "invalid_request", "Some fields are not right."));
      counter += 1;
      const at = now();
      const value: OnboardingDto = {
        id: `onboarding-new-${String(counter).padStart(3, "0")}`,
        state: "queued",
        progress: null,
        files: files.map((file, i) => ({ n: i + 1, name: file!.filename, bytes: file!.bytes, check: null })),
        report: null,
        problem: null,
        profileId: null,
        createdBy: { id: checked.person.userId, name: checked.person.name },
        createdAt: at,
        updatedAt: at,
      };
      onboardings = [{ orgId, pubId, value }, ...onboardings];
      keys = new Map(keys).set(idempotencyKey, { body, value: clone(value) });
      deps.emit(orgId, { type: "onboarding", publicationId: pubId, onboardingId: value.id });
      return success(clone(value));
    },
    async cancelOnboarding({ orgId, pubId, id }) {
      const checked = await check("layout.onboarding", orgId, pubId, can("settings.edit"));
      if ("problem" in checked) return checked.problem;
      const row = onboardings.find((one) => one.value.id === id && one.orgId === orgId && one.pubId === pubId);
      if (!row) return failure(NOT_FOUND);
      if (row.value.state !== "queued" && row.value.state !== "working") return failure(ONBOARDING_FINISHED);
      row.value = { ...row.value, state: "cancelled", progress: null, updatedAt: now() };
      deps.emit(orgId, { type: "onboarding", publicationId: pubId, onboardingId: id });
      return success(clone(row.value));
    },
    async adoptOnboarding({ orgId, pubId, id, idempotencyKey }) {
      const checked = await check("layout.onboarding", orgId, pubId, can("settings.edit"));
      if ("problem" in checked) return checked.problem;
      const body = JSON.stringify({ id });
      const kept = keys.get(idempotencyKey);
      if (kept) return kept.body === body ? success(clone(kept.value as EngineProfileDto)) : failure(KEY_REUSED);
      const row = onboardings.find((one) => one.value.id === id && one.orgId === orgId && one.pubId === pubId);
      if (!row) return failure(NOT_FOUND);
      if (row.value.state !== "ready") return failure(ONBOARDING_NOT_READY);
      const mine = profiles.filter((one) => one.orgId === orgId && one.pubId === pubId);
      if (mine.some((one) => one.value.state === "setting_up")) return failure(PROFILE_SETTING_UP);
      counter += 1;
      const at = now();
      const value: EngineProfileDto = {
        id: `profile-new-${String(counter).padStart(3, "0")}`,
        version: Math.max(0, ...mine.map((one) => one.value.version)) + 1,
        state: "setting_up",
        datasetSha256: SHA("9"),
        datasetBytes: 52_428_800,
        configSha256: null,
        engineVersion: null,
        templates: null,
        grid: null,
        error: null,
        basedOn: null,
        templateChoice: null,
        createdBy: { id: checked.person.userId, name: checked.person.name },
        createdAt: at,
        updatedAt: at,
      };
      profiles = [{ orgId, pubId, value }, ...profiles];
      row.value = { ...row.value, state: "used", profileId: value.id, updatedAt: at };
      keys = new Map(keys).set(idempotencyKey, { body, value: clone(value) });
      deps.emit(orgId, { type: "onboarding", publicationId: pubId, onboardingId: id });
      deps.emit(orgId, { type: "profile", publicationId: pubId, profileId: value.id });
      return success(clone(value));
    },
    async makeTestEdition({ orgId, pubId, idempotencyKey }) {
      const checked = await check("layout.onboarding", orgId, pubId, can("layout.generate"));
      if ("problem" in checked) return checked.problem;
      const kept = keys.get(idempotencyKey);
      if (kept) return success(clone(kept.value as { editionId: string; stories: number }));
      if (!inUse(orgId, pubId)) return failure(NO_PROFILE);
      // shortcut: the double answers its demo edition instead of making one of sample stories; enough for the screens
      const value = { editionId: EDITION_B, stories: deps.stories(orgId, pubId, EDITION_B).length };
      keys = new Map(keys).set(idempotencyKey, { body: "", value });
      return success(clone(value));
    },
    async getTemplates({ orgId, pubId }) {
      const checked = await check("layout.templates", orgId, pubId, can("templates.view"));
      if ("problem" in checked) return checked.problem;
      const mine = profiles.filter((row) => row.orgId === orgId && row.pubId === pubId);
      const used = mine.find((row) => row.value.state === "ready");
      const busy = mine.find((row) => row.value.state === "setting_up");
      const value = used?.value;
      return success(
        clone({
          inUse: value ? { id: value.id, version: value.version } : null,
          roles: value
            ? TEMPLATE_ROLES.map((r) => ({
                role: r,
                chosen: value.templates?.[r] ?? null,
                candidates: used?.candidates?.[r] ?? [],
              }))
            : [],
          candidatesKnown: !!used?.candidates,
          grid: value?.grid ?? null,
          settingUp: busy ? { id: busy.value.id, version: busy.value.version } : null,
          history: mine.map((row) => row.value),
        }),
      );
    },
    async chooseTemplate({ orgId, pubId, choice, idempotencyKey }) {
      const checked = await check("layout.templateChoose", orgId, pubId, can("templates.edit"));
      if ("problem" in checked) return checked.problem;
      const body = JSON.stringify(choice);
      const kept = keys.get(idempotencyKey);
      if (kept) return kept.body === body ? success(clone(kept.value as EngineProfileDto)) : failure(KEY_REUSED);
      const mine = profiles.filter((row) => row.orgId === orgId && row.pubId === pubId);
      if (mine.some((row) => row.value.state === "setting_up")) return failure(PROFILE_SETTING_UP);
      const base = mine.find((row) => row.value.state === "ready");
      if (!base) return failure(NO_PROFILE);
      const { role: r, page } = choice;
      if (r !== undefined && !(base.candidates?.[r] ?? []).some((c) => c.name === page))
        return failure({
          ...answer(400, "invalid_request", "Some fields are not right."),
          details: [{ field: "body.page", message: "This page of the dataset cannot serve as that template." }],
        });
      counter += 1;
      const at = now();
      const value: EngineProfileDto = {
        ...base.value,
        id: `profile-new-${String(counter).padStart(3, "0")}`,
        version: Math.max(...mine.map((row) => row.value.version)) + 1,
        state: "setting_up",
        configSha256: null,
        engineVersion: null,
        templates: null,
        grid: null,
        error: null,
        basedOn: { id: base.value.id, version: base.value.version },
        templateChoice: r !== undefined && page !== undefined ? { [r]: page } : {},
        createdBy: { id: checked.person.userId, name: checked.person.name },
        createdAt: at,
        updatedAt: at,
      };
      profiles = [{ orgId, pubId, value, candidates: base.candidates ?? candidatesFixture() }, ...profiles];
      keys = new Map(keys).set(idempotencyKey, { body, value: clone(value) });
      deps.emit(orgId, { type: "profile", publicationId: pubId, profileId: value.id });
      return success(clone(value));
    },
    async getLayout({ orgId, pubId, editionId }) {
      const checked = await check("layout.get", orgId, pubId, can("pages.view"));
      if ("problem" in checked) return checked.problem;
      const edition = deps.edition(orgId, pubId, editionId);
      if (!edition) return failure(NOT_FOUND);
      return success(view(orgId, pubId, editionId, edition.pages, edition.backPageAds));
    },
    async setAd({ orgId, pubId, editionId, slot, assetId }) {
      const checked = await check("layout.ads", orgId, pubId, (s) => can("layout.generate")(s) || can("ads.manage")(s));
      if ("problem" in checked) return checked.problem;
      const edition = deps.edition(orgId, pubId, editionId);
      const plan = edition
        ? slotsOf(editionId, edition.pages, edition.backPageAds).find((one) => one.slot === slot)
        : undefined;
      if (!edition || !plan) return failure(NOT_FOUND);
      if (ofEdition(editionId).some((run) => ACTIVE.includes(run.state))) {
        return failure(
          answer(
            409,
            "run_active",
            "Ads cannot be changed while the pages are being made. Wait until that finishes, or cancel it.",
          ),
        );
      }
      if (deps.assetReady(orgId, pubId, assetId) !== true)
        return failure({
          ...answer(400, "invalid_request", "Some fields are not right."),
          details: [{ field: "body.assetId", message: "is not a ready picture of the library" }],
        });
      const mine = slots.get(editionId) ?? new Map<string, SlotRow>();
      mine.set(slot, { state: "preparing", assetId, problem: null });
      slots = new Map(slots).set(editionId, mine);
      tell(orgId, pubId, editionId, null);
      return success({ ...plan, state: "preparing", assetId, problem: null });
    },
    async clearAd({ orgId, pubId, editionId, slot }) {
      const checked = await check("layout.ads", orgId, pubId, (s) => can("layout.generate")(s) || can("ads.manage")(s));
      if ("problem" in checked) return checked.problem;
      const edition = deps.edition(orgId, pubId, editionId);
      if (!edition || !slotsOf(editionId, edition.pages, edition.backPageAds).some((one) => one.slot === slot))
        return failure(NOT_FOUND);
      slots.get(editionId)?.delete(slot);
      tell(orgId, pubId, editionId, null);
      return success(undefined);
    },
    async startRun({ orgId, pubId, editionId, idempotencyKey }) {
      const checked = await check("layout.run", orgId, pubId, can("layout.generate"));
      if ("problem" in checked) return checked.problem;
      const body = JSON.stringify({ editionId });
      const kept = keys.get(idempotencyKey);
      if (kept) return kept.body === body ? success(clone(runs.get(kept.value as string)!.value)) : failure(KEY_REUSED);
      const edition = deps.edition(orgId, pubId, editionId);
      if (!edition) return failure(NOT_FOUND);
      const active = ofEdition(editionId).find((run) => ACTIVE.includes(run.state));
      if (active)
        return failure({
          ...answer(409, "run_active", "Pages for this edition are already being made."),
          current: clone(active),
        });
      const profile = inUse(orgId, pubId);
      const ready = readiness(orgId, pubId, editionId, edition.pages);
      if (!profile || !ready || ready.have.stories + ready.have.briefs === 0 || ready.blockers.length > 0) {
        return failure({
          ...answer(409, "layout_refused", "This edition cannot be laid out yet."),
          ...(ready && ready.blockers.length > 0
            ? { details: ready.blockers.map((one) => ({ field: one.deskKey, message: one.message })) }
            : {}),
        });
      }
      counter += 1;
      const at = now();
      const id = `run-new-${String(counter).padStart(3, "0")}`;
      const value: LayoutRunDto = {
        id,
        editionId,
        deskKey: `r-20261024-${String(100000 + counter).slice(1)}0`,
        state: "queued",
        message: desk("m.run.starting", "Starting…"),
        error: null,
        profileVersion: profile.version,
        createdBy: { id: checked.person.userId, name: checked.person.name },
        createdAt: at,
        startedAt: null,
        finishedAt: null,
        elapsedS: 0,
        pages: Array.from({ length: edition.pages }, (_, index) => ({
          page: index + 1,
          role: role(index + 1, edition.pages),
          state: "waiting" as const,
          stories: [],
          pdf: false,
          preview: false,
          check: null,
          warnings: [],
          message: null,
          ...SAVED,
        })),
        notPlaced: [],
        files: { editionPdf: false, pressZip: false },
        timings: null,
      };
      runs = new Map(runs).set(id, { orgId, pubId, value });
      keys = new Map(keys).set(idempotencyKey, { body, value: id });
      tell(orgId, pubId, editionId, id);
      return success(clone(value));
    },
    async getRun({ orgId, pubId, runId }) {
      const checked = await check("layout.get", orgId, pubId, can("pages.view"));
      if ("problem" in checked) return checked.problem;
      const row = runs.get(runId);
      return row && row.orgId === orgId && row.pubId === pubId ? success(clone(row.value)) : failure(NOT_FOUND);
    },
    async cancelRun({ orgId, pubId, runId }) {
      const checked = await check("layout.cancel", orgId, pubId, can("layout.generate"));
      if ("problem" in checked) return checked.problem;
      const row = runs.get(runId);
      if (!row || row.orgId !== orgId || row.pubId !== pubId) return failure(NOT_FOUND);
      if (!ACTIVE.includes(row.value.state))
        return failure(answer(409, "run_finished", "This run has already finished."));
      const before = row.value.state === "queued";
      row.value = {
        ...row.value,
        state: "cancelled",
        message: before
          ? desk("m.run.cancelledBefore", "Cancelled before it started.")
          : desk("m.run.cancelled", "Cancelled."),
        finishedAt: now(),
        pages: row.value.pages.map((page) => (page.state === "done" ? page : { ...page, state: "cancelled" })),
      };
      tell(orgId, pubId, row.value.editionId, runId);
      return success(clone(row.value));
    },
    async fileLink({ orgId, pubId, runId, name }) {
      const row = runs.get(runId);
      const checked = await check("layout.files", orgId, pubId, can(fileRule(name)));
      if ("problem" in checked) return checked.problem;
      if (!row || row.orgId !== orgId || row.pubId !== pubId) return failure(NOT_FOUND);
      const page = /^page-(\d\d)\./.exec(name)?.[1];
      const shown = row.value.pages.find((one) => one.page === Number(page));
      const exists =
        name === "edition.pdf"
          ? row.value.files.editionPdf
          : name === "press-files.zip"
            ? row.value.files.pressZip
            : name.endsWith(".pdf")
              ? row.value.state === "done" && !!shown?.pdf
              : !!shown?.preview;
      if (!exists) return failure(NOT_FOUND);
      return success({ url: `mock-store://runs/${runId}/${name}`, expiresAt: "2099-01-01T00:05:00.000Z" });
    },
    async loadFile(input) {
      const link = await layout.fileLink(input);
      if (!link.ok) return link;
      return success(new Blob([PAGE_SVG], { type: "image/svg+xml" }));
    },
  };

  const controller: MockLayoutController = {
    progress(runId, patch) {
      const row = runs.get(runId);
      if (!row || !ACTIVE.includes(row.value.state)) return;
      const states = new Map(patch.pages ?? []);
      row.value = {
        ...row.value,
        state: patch.state ?? row.value.state,
        // the browser's own clock: the screen counts the time so far from it
        startedAt: row.value.startedAt ?? new Date().toISOString(),
        ...(patch.message !== undefined ? { message: patch.message } : {}),
        pages: row.value.pages.map((page) => {
          const state = states.get(page.page);
          return state ? { ...page, state, preview: state === "done" } : page;
        }),
      };
      tell(row.orgId, row.pubId, row.value.editionId, runId);
    },
    finish(runId, outcome = {}) {
      const row = runs.get(runId);
      if (!row || !ACTIVE.includes(row.value.state)) return;
      const total = row.value.pages.length;
      if (outcome.state === "failed") {
        row.value = {
          ...row.value,
          state: "failed",
          error: outcome.error ?? desk("m.run.noPages", "The layout engine finished but made no pages."),
          message: outcome.message ?? null,
          // the browser's own clock, as startedAt: the screen counts the time it took from both
          finishedAt: new Date().toISOString(),
          pages: row.value.pages.map((page) => ({ ...page, state: page.state === "done" ? "done" : "failed" })),
        };
      } else {
        const stories = deps
          .stories(row.orgId, row.pubId, row.value.editionId)
          .filter((story) => story.status === "ready" || story.status === "placed");
        const made = total - (outcome.failedPage ? 1 : 0);
        row.value = {
          ...row.value,
          state: "done",
          message: desk("m.run.madeN", `${made} pages made.`, { n: made }),
          finishedAt: now(),
          elapsedS: 131,
          pages: row.value.pages.map((page) =>
            page.page === outcome.failedPage
              ? { ...page, state: "failed", message: desk("m.run.pageFailed", "layout failed") }
              : donePage(
                  page.page,
                  total,
                  page.page === 1
                    ? stories.map((story) => ({
                        storyId: story.id,
                        deskKey: deskKey(story.id),
                        headline: story.headline,
                      }))
                    : [],
                  page.page === 1 ? 2 : 0,
                ),
          ),
          files: { editionPdf: true, pressZip: true },
          timings: { layout: 96, check: 21 },
        };
      }
      tell(row.orgId, row.pubId, row.value.editionId, runId);
    },
    fitAd(editionId, slot, problem) {
      const row = slots.get(editionId)?.get(slot);
      if (!row) return;
      row.state = problem ? "failed" : "ready";
      row.problem = problem ?? null;
      tell(SAHYADRI, PUNE, editionId, null);
    },
    setUp(profileId, error) {
      const row = profiles.find((candidate) => candidate.value.id === profileId);
      if (!row || row.value.state !== "setting_up") return;
      const base = profiles.find((candidate) => candidate.value.id === row.value.basedOn?.id)?.value;
      row.value = error
        ? { ...row.value, state: "failed", error: clone(error), updatedAt: now() }
        : {
            ...row.value,
            state: "ready",
            configSha256: SHA("f"),
            engineVersion: "desk-engine 0.9.4 (fictional)",
            templates: { ...(base?.templates ?? TEMPLATES), ...row.value.templateChoice },
            grid: { columns: 8, columnMm: 38.5, gutterMm: 4.2 },
            updatedAt: now(),
          };
      if (!error && row.candidates === undefined) row.candidates = candidatesFixture();
      deps.emit(row.orgId, { type: "profile", publicationId: row.pubId, profileId });
    },
    onboardProgress(id, progress) {
      const row = onboardings.find((one) => one.value.id === id);
      if (!row || (row.value.state !== "queued" && row.value.state !== "working")) return;
      row.value = { ...row.value, state: "working", progress: { ...progress }, updatedAt: now() };
      deps.emit(row.orgId, { type: "onboarding", publicationId: row.pubId, onboardingId: id });
    },
    onboardFinish(id, outcome = {}) {
      const row = onboardings.find((one) => one.value.id === id);
      if (!row || (row.value.state !== "queued" && row.value.state !== "working")) return;
      const state = outcome.state ?? "ready";
      const checks =
        outcome.files ??
        row.value.files.map((file) => ({
          n: file.n,
          status: file.n === 2 ? ("warning" as const) : ("ok" as const),
          date: `2026-09-${String(file.n).padStart(2, "0")}`,
          pages: 8,
          notes: file.n === 2 ? [{ code: "onboard.untested_program" as const, count: null }] : [],
        }));
      const code = outcome.code ?? (state === "failed" ? "worker.crashed" : "onboard.too_few_editions");
      row.value = {
        ...row.value,
        state,
        progress: null,
        files: row.value.files.map((file) => ({ ...file, check: checks.find((c) => c.n === file.n) ?? null })),
        report: state === "ready" ? clone(ONBOARD_REPORT) : null,
        problem: state === "ready" ? null : { code, params: outcome.params ?? null, message: `Fictional: ${code}` },
        updatedAt: now(),
      };
      deps.emit(row.orgId, { type: "onboarding", publicationId: row.pubId, onboardingId: id });
    },
    latestRun(editionId) {
      return ofEdition(editionId).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0]?.id;
    },
  };

  return {
    layout,
    controller,
    reset() {
      profiles = profileFixtures();
      onboardings = [];
      runs = new Map([["run-demo-001", boardFixture()]]);
      slots = new Map();
      keys = new Map();
      sections = new Map();
      counter = 0;
      clock = 0;
    },
  };
}
