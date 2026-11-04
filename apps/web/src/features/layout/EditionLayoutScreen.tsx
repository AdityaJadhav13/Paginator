/**
 * An edition's layout, /org/:orgId/pub/:pubId/editions/:edition/layout (plan §1 L2.3, §2.6): the Desk's needs panel,
 * back-page ads, "Lay out" with its progress, the Pages board and the release (L2.5), as five tabs (GET
 * …/editions/:e/layout and …/release, pages.view).
 *   - Readiness: what the paper needs (the engine's plan of the profile in use) against what the edition has, its
 *     stories not Ready yet, what stops a layout, and the measuring ahead of it.
 *   - Ads: each back-page slot with its size and picture (chosen from the media library), its state in the Desk's words.
 *   - Lay out: start a run (layout.generate, an Idempotency-Key kept while its answer is unknown), its progress page by
 *     page and its time, cancel it; the last run's outcome in the Desk's words.
 *   - Pages: every page of the newest done run, its preview, its independent PDF/X-1a check, its stories and warnings,
 *     the stories not placed with the reason, the downloads each person may have (a 5-minute link each), and each
 *     page's approval (Approve / Unlock, from the release view).
 *   - Release: features/release/ReleaseTab.tsx.
 * A live `layout` update of this edition, a story of the publication or a `resync` fetches it again; while a run is
 * active it is also fetched every 3 s, in case a live update is missed (as the Word import does).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { STORY_STATUSES } from "@pageinator/contracts";
import {
  Badge,
  Button,
  Cluster,
  Dialog,
  Drawer,
  EmptyState,
  Icon,
  InlineMessage,
  PageHeader,
  Panel,
  ProgressIndicator,
  Stack,
  Table,
  TableCell,
  TableHeader,
  Tabs,
} from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type Translate } from "../../i18n/index.ts";
import type {
  AdSlotDto,
  ApiProblem,
  DeskTextDto,
  EditionLayoutDto,
  LayoutPageDto,
  LayoutRunDto,
  PubEditionDto,
  ReleasePageDto,
  StoryStatusDto,
} from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { usePublicationEditions } from "../editions/editions-context.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { MediaGrid } from "../media/MediaGrid.tsx";
import { StatusChip } from "../stories/StatusChip.tsx";
import { useMedia } from "../stories/media-context.tsx";
import { layoutAccess, type LayoutAccess } from "./access.ts";
import { DeskWords } from "./desk-text.tsx";
import { useLayout } from "./layout-context.tsx";
import { PageApproval, ReleaseTab, useEditionRelease } from "../release/ReleaseTab.tsx";
import {
  ACTIVE_STATES,
  CheckBadge,
  duration,
  follow,
  pageFile,
  pageStateText,
  roleText,
  RunStateBadge,
} from "./layout-words.tsx";
import "./layout.css";

export const POLL_MS = 3000;
const TABS = ["readiness", "ads", "run", "pages", "release"] as const;
type Tab = (typeof TABS)[number];

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly value: EditionLayoutDto };

interface Where {
  readonly orgId: string;
  readonly pubId: string;
  readonly editionId: string;
}

export function EditionLayoutScreen() {
  const {
    orgId = "",
    pubId = "",
    edition: editionId = "",
  } = useParams<{ orgId: string; pubId: string; edition: string }>();
  const { state } = useSession();
  const { t, language } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const access = layoutAccess(org, pubId);
  const editions = usePublicationEditions(orgId, pubId, access.view);
  const edition = editions?.find((candidate) => candidate.id === editionId);
  const title = edition
    ? t("editionLayout.title", { date: formatDate(edition.date, language) })
    : t("glossary.edition.issue");
  const subtitle = [publication?.name, edition ? t("editions.pages", { count: edition.pages }) : undefined]
    .filter(Boolean)
    .join(" · ");
  return (
    <Stack gap="5" className="pg-layout">
      <PageHeader title={title} headingId={ROUTE_HEADING_ID} {...(subtitle ? { subtitle } : {})} />
      <OfflineNotice />
      {access.view && <LayoutContent where={{ orgId, pubId, editionId }} edition={edition} access={access} />}
    </Stack>
  );
}

function LayoutContent({
  where,
  edition,
  access,
}: {
  readonly where: Where;
  readonly edition: PubEditionDto | undefined;
  readonly access: LayoutAccess;
}) {
  const layout = useLayout();
  const { t } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [search, setSearch] = useSearchParams();
  const asked = search.get("tab");
  const tab: Tab = (TABS as readonly string[]).includes(asked ?? "") ? (asked as Tab) : "readiness";
  const ask = useRef(0);
  const { orgId, pubId, editionId } = where;
  const release = useEditionRelease(where);

  const fetchLayout = useCallback(
    async (live: boolean) => {
      const mine = ++ask.current;
      const result = await layout.getLayout({ orgId, pubId, editionId });
      if (mine !== ask.current) return; // a newer answer is on its way
      setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error, live });
    },
    [layout, orgId, pubId, editionId],
  );
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchLayout(false);
  }, [fetchLayout]);
  useLiveEvents((event) => {
    const here =
      (event.type === "layout" && event.editionId === editionId) ||
      ((event.type === "story" || event.type === "edition") && event.publicationId === pubId);
    if (here || event.type === "resync") void fetchLayout(true);
  });
  const value = load.status === "ready" ? load.value : null;
  // a run under way, an ad being fitted or stories being measured: asked again every 3 s in case a live update is missed
  const moving =
    !!value &&
    (value.active !== null ||
      value.slots.some((slot) => slot.state === "preparing") ||
      value.readiness?.measure?.state === "measuring" ||
      value.readiness?.measure?.state === "waiting");
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void fetchLayout(true), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchLayout, moving]);

  const choose = (next: string) =>
    setSearch(
      (now) => {
        const params = new URLSearchParams(now);
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  if (load.status === "loading") return <ProgressIndicator role="status" label={t("editionLayout.loading")} />;
  if (load.status === "failed") {
    return (
      <Stack gap="3">
        <ProblemMessage problem={load.problem} live={load.live} />
        {!(load.problem.kind === "answer" && (load.problem.status === 403 || load.problem.status === 404)) && (
          <div>
            <Button variant="secondary" onClick={() => void fetchLayout(true)}>
              {t("form.retry")}
            </Button>
          </div>
        )}
      </Stack>
    );
  }
  const data = load.value;
  const refresh = () => void fetchLayout(true);
  return (
    <Stack gap="4">
      {!data.profile && (
        <InlineMessage variant="info" heading={t("editionLayout.noProfile")} iconLabel={t("message.info")}>
          {access.settings && (
            <Link to={paths.pubEngineProfile(orgId, pubId)}>{t("editionLayout.noProfile.link")}</Link>
          )}
        </InlineMessage>
      )}
      <Tabs
        label={t("editionLayout.tabs")}
        selectedId={tab}
        onSelect={choose}
        tabs={[
          {
            id: "readiness",
            label: t("editionLayout.tab.readiness"),
            panel: <ReadinessTab where={where} data={data} />,
          },
          {
            id: "ads",
            label: t("editionLayout.tab.ads"),
            panel: <AdsTab where={where} data={data} edition={edition} may={access.ads} onChanged={refresh} />,
          },
          {
            id: "run",
            label: t("editionLayout.tab.run"),
            panel: (
              <RunTab
                where={where}
                data={data}
                edition={edition}
                access={access}
                onChanged={refresh}
                onPages={() => choose("pages")}
              />
            ),
          },
          {
            id: "pages",
            label: t("editionLayout.tab.pages"),
            panel: (
              <PagesTab
                where={where}
                run={data.board}
                access={access}
                pages={release.load.status === "ready" ? release.load.value.pages : []}
                onApproval={release.refresh}
              />
            ),
          },
          {
            id: "release",
            label: t("editionLayout.tab.release"),
            panel: (
              <ReleaseTab
                where={where}
                load={release.load}
                access={access}
                onRefresh={release.refresh}
                onTab={choose}
                edition={edition}
              />
            ),
          },
        ]}
      />
    </Stack>
  );
}

/** A story of the layout: a link to it when the person may open it, else its headline. */
function StoryName({
  orgId,
  pubId,
  story,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly story: { readonly storyId: string | null; readonly headline: string | null };
}) {
  const { t } = useI18n();
  const name = story.headline || t("editionLayout.untitled");
  return story.storyId ? <Link to={paths.pubStory(orgId, pubId, story.storyId)}>{name}</Link> : <span>{name}</span>;
}

const isStatus = (status: string): status is StoryStatusDto => (STORY_STATUSES as readonly string[]).includes(status);

// ------------------------------------------------------------------------------------------------------- Readiness

function ReadinessTab({ where, data }: { readonly where: Where; readonly data: EditionLayoutDto }) {
  const { t } = useI18n();
  const readiness = data.readiness;
  if (!readiness) return <p className="pg-layout__note">{t("editionLayout.needs.none")}</p>;
  const { needs, have, measure } = readiness;
  const rows = [
    ["stories", t("editionLayout.needs.stories")],
    ["briefs", t("editionLayout.needs.briefs")],
    ["photos", t("editionLayout.needs.photos")],
    ["words", t("editionLayout.needs.words")],
  ] as const;
  const measured =
    measure &&
    (measure.state === "waiting"
      ? t("editionLayout.measure.waiting")
      : measure.state === "measuring"
        ? t("editionLayout.measure.measuring", { measured: measure.measured, total: measure.total })
        : measure.state === "done"
          ? t("editionLayout.measure.done", { measured: measure.measured, total: measure.total })
          : measure.state === "stopped"
            ? t("editionLayout.measure.stopped")
            : t("editionLayout.measure.failed"));
  return (
    <Stack gap="5">
      <div aria-live="polite">{measured && <p className="pg-layout__note">{measured}</p>}</div>
      <Panel title={t("editionLayout.needs.heading")} flush>
        <Table caption={t("editionLayout.needs.heading")}>
          <thead>
            <tr>
              <TableHeader>{t("editionLayout.needs.what")}</TableHeader>
              <TableHeader numeric>{t("editionLayout.needs.needs")}</TableHeader>
              <TableHeader numeric>{t("editionLayout.needs.has")}</TableHeader>
              <TableHeader>{t("editionLayout.needs.state")}</TableHeader>
            </tr>
          </thead>
          <tbody>
            {rows.map(([key, label]) => {
              const short = needs[key] - have[key];
              return (
                <tr key={key}>
                  <TableCell>{label}</TableCell>
                  <TableCell numeric>{needs[key]}</TableCell>
                  <TableCell numeric>{have[key]}</TableCell>
                  <TableCell>
                    {short > 0 ? (
                      <Badge tone="warning" icon="triangle-alert">
                        {t("editionLayout.needs.shortBy", { count: short })}
                      </Badge>
                    ) : (
                      <Badge tone="success" icon="circle-check">
                        {t("editionLayout.needs.enough")}
                      </Badge>
                    )}
                  </TableCell>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <p className="pg-layout__note pg-layout__pad">{t("editionLayout.needs.note")}</p>
      </Panel>
      {readiness.blockers.length > 0 && (
        <Panel title={t("editionLayout.blockers.heading", { count: readiness.blockers.length })}>
          <ul className="pg-layout__list">
            {readiness.blockers.map((blocker) => (
              <li key={`${blocker.deskKey}-${blocker.code}`}>
                <StoryName orgId={where.orgId} pubId={where.pubId} story={blocker} />
                <span className="pg-layout__note" lang="en">
                  {blocker.message}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title={t("editionLayout.notReady.heading", { count: readiness.notReady.length })}>
        {readiness.notReady.length === 0 ? (
          <p>{t("editionLayout.notReady.none")}</p>
        ) : (
          <Stack gap="3">
            <p className="pg-layout__note">{t("editionLayout.notReady.body")}</p>
            <ul className="pg-layout__list">
              {readiness.notReady.map((story) => (
                <li key={story.deskKey}>
                  <StoryName orgId={where.orgId} pubId={where.pubId} story={story} />
                  {isStatus(story.status) && <StatusChip status={story.status} />}
                </li>
              ))}
            </ul>
          </Stack>
        )}
      </Panel>
    </Stack>
  );
}

// ------------------------------------------------------------------------------------------------------------- Ads

function SlotState({ slot, t }: { readonly slot: AdSlotDto; readonly t: Translate }) {
  if (slot.state === "empty")
    return (
      <Badge tone="neutral" icon="image">
        {t("editionLayout.ads.empty")}
      </Badge>
    );
  if (slot.state === "preparing")
    return (
      <Badge tone="info" icon="loader-circle">
        {t("editionLayout.ads.preparing")}
      </Badge>
    );
  if (slot.state === "ready")
    return (
      <Badge tone="success" icon="circle-check">
        {t("editionLayout.ads.ready")}
      </Badge>
    );
  return (
    <Badge tone="danger" icon="circle-x">
      {t("editionLayout.ads.failed")}
    </Badge>
  );
}

function AdsTab({
  where,
  data,
  edition,
  may,
  onChanged,
}: {
  readonly where: Where;
  readonly data: EditionLayoutDto;
  readonly edition: PubEditionDto | undefined;
  readonly may: boolean;
  readonly onChanged: () => void;
}) {
  const layout = useLayout();
  const media = useMedia();
  const { t } = useI18n();
  const [picking, setPicking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const { slots } = data;
  if (slots.length === 0) {
    return (
      <Stack gap="2">
        <p>{t("editionLayout.ads.none")}</p>
        {edition && !edition.backPageAds && <p className="pg-layout__note">{t("editionLayout.ads.allNews")}</p>}
      </Stack>
    );
  }
  const filled = slots.filter((slot) => slot.state === "ready").length;
  const act = async (run: () => Promise<{ ok: boolean; error?: ApiProblem }>) => {
    setBusy(true);
    setProblem(null);
    const result = await run();
    setBusy(false);
    if (!result.ok && result.error) setProblem(result.error);
    onChanged();
  };
  return (
    <Stack gap="4">
      <p>{t("editionLayout.ads.lede", { filled, total: slots.length })}</p>
      {may && <p className="pg-layout__note">{t("editionLayout.ads.note")}</p>}
      {problem && <ProblemMessage problem={problem} />}
      <ul className="pg-layout__slots">
        {slots.map((slot) => (
          <li key={slot.slot}>
            <Panel title={t("editionLayout.ads.space", { slot: slot.slot })} headingLevel={3}>
              <Stack gap="3">
                <p className="pg-layout__note">
                  {t("editionLayout.ads.where", { page: slot.page, width: slot.wMm, height: slot.hMm })}
                </p>
                {slot.assetId && slot.state !== "empty" && (
                  <div className="pg-layout__thumb">
                    <img
                      src={`${media.fileUrl({ orgId: where.orgId, pubId: where.pubId, assetId: slot.assetId })}?variant=preview`}
                      alt={t("editionLayout.ads.picture", { slot: slot.slot })}
                    />
                  </div>
                )}
                <div>
                  <SlotState slot={slot} t={t} />
                </div>
                {slot.problem && (
                  <p>
                    <DeskWords text={slot.problem} />
                  </p>
                )}
                {may && (
                  <Cluster gap="3">
                    <Button variant="secondary" disabled={busy} onClick={() => setPicking(slot.slot)}>
                      <Icon name="image" size={16} />
                      {slot.state === "empty" ? t("editionLayout.ads.choose") : t("editionLayout.ads.replace")}
                    </Button>
                    {slot.state !== "empty" && (
                      <Button variant="danger" disabled={busy} onClick={() => setRemoving(slot.slot)}>
                        {t("editionLayout.ads.remove")}
                      </Button>
                    )}
                  </Cluster>
                )}
              </Stack>
            </Panel>
          </li>
        ))}
      </ul>
      {may && (
        <Drawer
          open={picking !== null}
          onClose={() => setPicking(null)}
          title={t("editionLayout.ads.pick", { slot: picking ?? "" })}
          closeLabel={t("shell.closeDialog")}
          size="wide"
        >
          {picking !== null && (
            <MediaGrid
              orgId={where.orgId}
              pubId={where.pubId}
              compact
              picker
              onChoose={(item) => {
                const slot = picking;
                setPicking(null);
                void act(() => layout.setAd({ ...where, slot, assetId: item.id }));
              }}
            />
          )}
        </Drawer>
      )}
      {removing !== null && (
        <Dialog
          open
          onClose={() => setRemoving(null)}
          title={t("editionLayout.ads.removeTitle")}
          closeLabel={t("shell.closeDialog")}
        >
          <Stack gap="4">
            <p>{t("editionLayout.ads.removeMessage", { slot: removing })}</p>
            <Cluster gap="3">
              <Button
                variant="danger"
                onClick={() => {
                  const slot = removing;
                  setRemoving(null);
                  void act(() => layout.clearAd({ ...where, slot }));
                }}
              >
                {t("editionLayout.ads.remove")}
              </Button>
              <Button variant="secondary" onClick={() => setRemoving(null)}>
                {t("editionLayout.ads.keep")}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
    </Stack>
  );
}

// --------------------------------------------------------------------------------------------------------- Lay out

/** Seconds the run has taken: from its start (ticking while it runs), else as the API counted them. */
function useElapsed(run: LayoutRunDto | null): number {
  const active = !!run && ACTIVE_STATES.includes(run.state);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => tick((count) => count + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  if (!run) return 0;
  if (active && run.startedAt) return Math.max(run.elapsedS, (Date.now() - Date.parse(run.startedAt)) / 1000);
  return endedAfter(run);
}

/** Seconds an ended run took, start to end: a run failed later by the stalled-run check took that long, whatever the
 * engine last counted. */
export function endedAfter(run: LayoutRunDto): number {
  const from = run.startedAt ?? run.createdAt;
  const span = run.finishedAt ? (Date.parse(run.finishedAt) - Date.parse(from)) / 1000 : 0;
  return Math.max(run.elapsedS, span);
}

const sameWords = (a: DeskTextDto | null, b: DeskTextDto | null) =>
  !!a && !!b && a.text === b.text && a.code === b.code;

/** No answer came, or the server failed: the run may have started, so a retry keeps the key. */
const unknownOutcome = (problem: ApiProblem) =>
  problem.kind !== "answer" || (problem.status >= 500 && problem.code !== "slow_down");

function RunTab({
  where,
  data,
  edition,
  access,
  onChanged,
  onPages,
}: {
  readonly where: Where;
  readonly data: EditionLayoutDto;
  readonly edition: PubEditionDto | undefined;
  readonly access: LayoutAccess;
  readonly onChanged: () => void;
  readonly onPages: () => void;
}) {
  const layout = useLayout();
  const { t, language } = useI18n();
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState<"idle" | "asking" | "busy">("idle");
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const key = useRef<string | null>(null);
  const { active, last, readiness } = data;
  const elapsed = useElapsed(active);
  const pages = edition?.pages ?? active?.pages.length ?? last?.pages.length ?? 0;

  const start = async () => {
    setStarting(true);
    setProblem(null);
    key.current ??= randomUuid();
    const result = await layout.startRun({ ...where, idempotencyKey: key.current });
    setStarting(false);
    if (result.ok || !unknownOutcome(result.error)) key.current = null;
    if (!result.ok) setProblem(result.error);
    onChanged();
  };
  const cancel = async () => {
    if (!active) return;
    setCancelling("busy");
    setProblem(null);
    const result = await layout.cancelRun({ ...where, runId: active.id });
    setCancelling("idle");
    if (!result.ok) setProblem(result.error);
    onChanged();
  };

  const emptyAds = data.slots.filter((slot) => slot.state === "empty").length;
  const blocked = (readiness?.blockers.length ?? 0) > 0;
  const nothing = readiness ? readiness.have.stories + readiness.have.briefs === 0 : false;
  const warnings = [
    ...(readiness && readiness.have.stories < readiness.needs.stories
      ? [t("editionLayout.run.warnStories", { have: readiness.have.stories, need: readiness.needs.stories })]
      : []),
    ...(emptyAds > 0 ? [t("editionLayout.run.warnAds", { count: emptyAds })] : []),
  ];

  return (
    <Stack gap="5">
      {problem && <ProblemMessage problem={problem} />}
      {problem?.kind === "answer" && problem.code === "layout_refused" && (problem.details?.length ?? 0) > 0 && (
        <ul className="pg-layout__list" aria-label={t("editionLayout.run.refusedWhy")}>
          {problem.details?.map((detail) => (
            <li key={`${detail.field}-${detail.message}`} lang="en">
              {detail.message}
            </li>
          ))}
        </ul>
      )}
      {active ? (
        <Panel
          title={t("editionLayout.run.heading")}
          {...(access.generate
            ? {
                actions: (
                  <Button variant="danger" disabled={cancelling !== "idle"} onClick={() => setCancelling("asking")}>
                    {t("editionLayout.run.cancel")}
                  </Button>
                ),
              }
            : {})}
        >
          <Stack gap="3">
            <div aria-live="polite" className="pg-layout__status">
              <RunStateBadge state={active.state} t={t} />
              <span>{t("editionLayout.run.soFar", { time: duration(elapsed, t) })}</span>
              {cancelling === "busy" && <span>{t("editionLayout.run.cancelling")}</span>}
            </div>
            {active.message && (
              <p>
                <DeskWords text={active.message} />
              </p>
            )}
            <p className="pg-layout__note">
              {t("editionLayout.run.progress", {
                done: active.pages.filter((page) => page.state === "done").length,
                total: active.pages.length,
              })}
            </p>
            <ul className="pg-layout__progress" aria-label={t("editionLayout.board.pages")}>
              {active.pages.map((page) => (
                <li key={page.page} data-state={page.state}>
                  <span>{t("editionLayout.page.title", { page: page.page, role: roleText(page.role, t) })}</span>
                  <span className="pg-layout__note">{pageStateText(page.state, t)}</span>
                </li>
              ))}
            </ul>
          </Stack>
        </Panel>
      ) : (
        access.generate && (
          <Panel title={t("editionLayout.tab.run")}>
            <Stack gap="3">
              {!data.profile && <p>{t("editionLayout.run.noProfile")}</p>}
              {data.profile && nothing && <p>{t("editions.send.nothingReady")}</p>}
              {data.profile && blocked && <p>{t("editionLayout.run.blocked")}</p>}
              {warnings.length > 0 && (
                <ul className="pg-layout__list">
                  {warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
              <div>
                <Button
                  variant="primary"
                  disabled={starting || !data.profile || blocked || nothing}
                  aria-busy={starting}
                  onClick={() => void start()}
                >
                  <Icon name="layout-template" size={16} />
                  {starting
                    ? t("editionLayout.run.starting")
                    : last
                      ? t("editionLayout.run.goAgain", { count: pages })
                      : t("editionLayout.run.go", { count: pages })}
                </Button>
              </div>
              <p className="pg-layout__note">{t("editionLayout.run.timeNote")}</p>
            </Stack>
          </Panel>
        )
      )}
      {last ? (
        <Panel title={t("editionLayout.run.last")}>
          <Stack gap="3">
            <div className="pg-layout__status">
              <RunStateBadge state={last.state} t={t} />
              <span>
                {last.state === "done"
                  ? t("editionLayout.run.took", { time: duration(endedAfter(last), t) })
                  : t("editionLayout.run.stoppedAfter", { time: duration(endedAfter(last), t) })}
              </span>
            </div>
            {last.createdBy && (
              <p className="pg-layout__note">
                {t("editionLayout.run.by", {
                  name: last.createdBy.name,
                  time: formatDateTime(last.createdAt, language),
                })}
              </p>
            )}
            {last.error && (
              <InlineMessage variant="error" heading={t("editionLayout.state.failed")} iconLabel={t("message.error")}>
                <DeskWords text={last.error} />
              </InlineMessage>
            )}
            {last.message && !sameWords(last.message, last.error) && (
              <p>
                <DeskWords text={last.message} />
              </p>
            )}
            {last.state === "done" && (
              <div>
                <Button variant="secondary" onClick={onPages}>
                  {t("editionLayout.run.seePages")}
                </Button>
              </div>
            )}
          </Stack>
        </Panel>
      ) : (
        !active && <p className="pg-layout__note">{t("editionLayout.run.none")}</p>
      )}
      {cancelling === "asking" && (
        <Dialog
          open
          onClose={() => setCancelling("idle")}
          title={t("editionLayout.run.cancelTitle")}
          closeLabel={t("shell.closeDialog")}
        >
          <Stack gap="4">
            <p>{t("editionLayout.run.cancelMessage")}</p>
            <Cluster gap="3">
              <Button variant="danger" onClick={() => void cancel()}>
                {t("editionLayout.run.cancel")}
              </Button>
              <Button variant="secondary" onClick={() => setCancelling("idle")}>
                {t("editionLayout.run.keepGoing")}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
    </Stack>
  );
}

// ----------------------------------------------------------------------------------------------------------- Pages

/** A page's small preview: fetched by a fresh link, held as an object URL while it is shown. */
function Thumb({
  where,
  runId,
  page,
}: {
  readonly where: Where;
  readonly runId: string;
  readonly page: LayoutPageDto;
}) {
  const layout = useLayout();
  const { t } = useI18n();
  const [url, setUrl] = useState<string | null>(null);
  const { orgId, pubId } = where;
  useEffect(() => {
    if (!page.preview) return;
    const stop = new AbortController();
    let made: string | null = null;
    void layout
      .loadFile({ orgId, pubId, runId, name: pageFile(page.page, "thumb.png"), signal: stop.signal })
      .then((result) => {
        if (stop.signal.aborted || !result.ok) return;
        made = URL.createObjectURL(result.value);
        setUrl(made);
      });
    return () => {
      stop.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [layout, orgId, pubId, runId, page.page, page.preview]);
  return (
    <div className="pg-layout__thumb">
      {url ? (
        <img src={url} alt={t("editionLayout.page.preview", { page: page.page })} />
      ) : (
        <span className="pg-layout__note">{t("editionLayout.page.noPreview")}</span>
      )}
    </div>
  );
}

function PagesTab({
  where,
  run,
  access,
  pages,
  onApproval,
}: {
  readonly where: Where;
  readonly run: LayoutRunDto | null;
  readonly access: LayoutAccess;
  /** each page's approval (the release view), when known */
  readonly pages: readonly ReleasePageDto[];
  readonly onApproval: () => void;
}) {
  const layout = useLayout();
  const { t, language } = useI18n();
  const [getting, setGetting] = useState<string | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  if (!run) {
    return (
      <Panel>
        <EmptyState icon="layout-template" heading={t("editionLayout.board.none")}>
          {t("editionLayout.board.noneBody")}
        </EmptyState>
      </Panel>
    );
  }
  const download = async (name: string) => {
    setGetting(name);
    setProblem(null);
    const link = await layout.fileLink({ ...where, runId: run.id, name });
    setGetting(null);
    if (!link.ok) return setProblem(link.error);
    follow(link.value.url, name);
  };
  const approvals = new Map(pages.filter((p) => p.runId === run.id).map((p) => [p.page, p]));
  const files = [
    ...(access.proof && run.files.editionPdf
      ? [["edition.pdf", t("editionLayout.download.edition"), t("editionLayout.download.editionSub")] as const]
      : []),
    ...(access.press && run.files.pressZip
      ? [["press-files.zip", t("editionLayout.download.press"), t("editionLayout.download.pressSub")] as const]
      : []),
  ];
  return (
    <Stack gap="5">
      <p className="pg-layout__note">
        {t("editionLayout.board.of", { time: formatDateTime(run.finishedAt ?? run.createdAt, language) })}
      </p>
      <p className="pg-layout__proof">
        <Icon name="info" size={16} />
        <span>{t("editionLayout.proofNote")}</span>
      </p>
      {files.length > 0 && (
        <Panel title={t("editionLayout.downloads")}>
          <ul className="pg-layout__downloads">
            {files.map(([name, label, about]) => (
              <li key={name}>
                <Button
                  variant="secondary"
                  disabled={getting !== null}
                  aria-busy={getting === name}
                  onClick={() => void download(name)}
                >
                  <Icon name="download" size={16} />
                  {label}
                </Button>
                <span className="pg-layout__note">{about}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <div aria-live="polite">
        {getting && <p className="pg-layout__note">{t("editionLayout.download.getting")}</p>}
      </div>
      {problem && <ProblemMessage problem={problem} />}
      <ul className="pg-layout__board" aria-label={t("editionLayout.board.pages")}>
        {run.pages.map((page) => (
          <li key={page.page}>
            <Panel
              title={t("editionLayout.page.title", { page: page.page, role: roleText(page.role, t) })}
              headingLevel={3}
            >
              <Stack gap="3">
                <Thumb where={where} runId={run.id} page={page} />
                {page.state === "done" ? (
                  <div className="pg-layout__status">
                    <CheckBadge check={page.check} t={t} />
                    {access.edit && (
                      <Link
                        to={paths.pubPageEditor(where.orgId, where.pubId, where.editionId, run.id, page.page)}
                        aria-label={t("pageEditor.editPage", { page: page.page })}
                      >
                        {t("pageEditor.edit")}
                      </Link>
                    )}
                  </div>
                ) : (
                  <p>
                    {t("editionLayout.page.failed")} {page.message && <DeskWords text={page.message} />}
                  </p>
                )}
                {page.state === "done" && approvals.has(page.page) && (
                  <PageApproval where={where} page={approvals.get(page.page)!} access={access} onChanged={onApproval} />
                )}
                {page.state === "done" &&
                  (page.stories.length === 0 ? (
                    <p className="pg-layout__note">{t("editionLayout.page.noStories")}</p>
                  ) : (
                    <div>
                      <h4 className="pg-layout__subhead">{t("editionLayout.page.stories")}</h4>
                      <ul className="pg-layout__list">
                        {page.stories.map((story) => (
                          <li key={story.deskKey}>
                            <StoryName orgId={where.orgId} pubId={where.pubId} story={story} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                {page.warnings.length > 0 && (
                  <div>
                    <h4 className="pg-layout__subhead">{t("editionLayout.page.warnings")}</h4>
                    <ul className="pg-layout__list">
                      {page.warnings.map((warning, index) => (
                        <li key={index}>
                          <DeskWords text={warning} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {access.proof && page.pdf && (
                  <div>
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={getting !== null}
                      onClick={() => void download(pageFile(page.page, "pdf"))}
                    >
                      <Icon name="download" size={16} />
                      {t("editionLayout.page.pdf", { page: page.page })}
                    </Button>
                  </div>
                )}
              </Stack>
            </Panel>
          </li>
        ))}
      </ul>
      <Panel title={t("editionLayout.notPlaced.heading", { count: run.notPlaced.length })}>
        {run.notPlaced.length === 0 ? (
          <p>{t("editionLayout.notPlaced.none")}</p>
        ) : (
          <ul className="pg-layout__list">
            {run.notPlaced.map((story) => (
              <li key={story.deskKey}>
                <StoryName orgId={where.orgId} pubId={where.pubId} story={story} />
                <span className="pg-layout__note">
                  <DeskWords text={story.reason} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </Stack>
  );
}
