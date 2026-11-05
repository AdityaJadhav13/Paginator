/**
 * Newsroom, /org/:orgId/pub/:pubId/newsroom (04 §6.1; plan 10 §5.4): the desk's board for an edition. The stories the
 * person sees (the API's scope: a Reporter's own), in a column per state, each counted; Spiked only when asked. Filters
 * (edition, section, given to) live in the address; the edition defaults to the next one (today's, else the first after
 * it, else the newest). A card opens the story editor, and its Move menu offers only the moves the story's own `can`
 * allows (the API's rules), each sent through the transitions endpoint; a send-back asks for its comment. Flags are
 * facts of the story's photo only (no photo, no caption, refused): no length target exists to flag "over length".
 * A live change of a story (or a `resync`) fetches the board again. Desktop: columns side by side; phone: stacked.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  Badge,
  Checkbox,
  Field,
  InlineMessage,
  MenuButton,
  MenuItem,
  PageHeader,
  ProgressIndicator,
  Select,
  Stack,
} from "../../ui/index.ts";
import { randomUuid } from "../../api/client.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { formatDate } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type {
  ApiProblem,
  PubEditionDto,
  StoryListItemDto,
  StoryStatusDto,
  TransitionTargetDto,
} from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useEditions } from "../editions/editions-context.tsx";
import { useLayout } from "../layout/layout-context.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { mayViewEditions, storyScope } from "../stories/access.ts";
import { moveKey, statusKey } from "../stories/StatusChip.tsx";
import { SendBackDialog } from "../stories/StoryEditor.tsx";
import { useStories } from "../stories/stories-context.tsx";
import "./newsroom.css";

const COLUMNS: readonly StoryStatusDto[] = ["draft", "filed", "editing", "ready", "placed", "held"];
const PAGE = 100;
// shortcut: the board reads at most 10 pages (1,000 stories) per view; a server-side board query if papers outgrow it
const MAX_PAGES = 10;

/** The edition the board opens on: today's, else the first after today, else the newest; "any" with none. */
export function defaultEdition(editions: readonly PubEditionDto[], today: string): string {
  const coming = editions.filter((edition) => edition.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const newest = [...editions].sort((a, b) => b.date.localeCompare(a.date))[0];
  return coming[0]?.id ?? newest?.id ?? "any";
}

export type Flag = "noPhoto" | "noCaption" | "photoRefused";

/** The photo's facts the desk acts on (no length target exists, so nothing about length). */
export function flagsOf(item: StoryListItemDto): Flag[] {
  if (!item.photo) return item.isBrief ? [] : ["noPhoto"]; // a brief is a story without a photo by definition
  const flags: Flag[] = [];
  if (item.photo.caption.trim() === "") flags.push("noCaption");
  if (item.photo.status === "rejected" || item.photo.status === "failed") flags.push("photoRefused");
  return flags;
}

const FLAG_LOOK = {
  noPhoto: ["neutral", "image", "newsroom.flag.noPhoto"],
  noCaption: ["warning", "triangle-alert", "newsroom.flag.noCaption"],
  photoRefused: ["danger", "circle-x", "newsroom.flag.photoRefused"],
} as const;

const localToday = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, the person's own day

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly edition: string; readonly problem: ApiProblem }
  | {
      readonly status: "ready";
      readonly edition: string;
      readonly items: readonly StoryListItemDto[];
      readonly more: boolean;
    };

export function NewsroomScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  const scope = org ? storyScope(org, pubId) : "none";
  const header = <PageHeader title={t("nav.newsroom")} headingId={ROUTE_HEADING_ID} />;
  if (!org || state.status !== "ready" || (org.twoStep.required && !org.twoStep.satisfied)) {
    return (
      <Stack gap="5">
        {header}
        <OfflineNotice />
      </Stack>
    );
  }
  if (scope === "none") {
    return (
      <Stack gap="5">
        {header}
        <OfflineNotice />
        <InlineMessage variant="info" heading={t("newsroom.noAccess.heading")} iconLabel={t("message.info")}>
          {t("newsroom.noAccess.body")}
        </InlineMessage>
      </Stack>
    );
  }
  return (
    <Board
      orgId={orgId}
      pubId={pubId}
      userId={state.session.user.id}
      own={scope === "own"}
      viewEditions={mayViewEditions(org, pubId)}
    />
  );
}

function Board({
  orgId,
  pubId,
  userId,
  own,
  viewEditions,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly userId: string;
  readonly own: boolean;
  readonly viewEditions: boolean;
}) {
  const stories = useStories();
  const editionService = useEditions();
  const layout = useLayout();
  const { t, language } = useI18n();
  const [params, setParams] = useSearchParams();

  /** Bumped by a live change: the board (or the editions) are fetched again. */
  const [storiesAsked, setStoriesAsked] = useState(0);
  const [editionsAsked, setEditionsAsked] = useState(0);
  useLiveEvents((event) => {
    const all = event.type === "resync";
    if (all || (event.type === "story" && event.publicationId === pubId)) setStoriesAsked((n) => n + 1);
    if (all || (event.type === "edition" && event.publicationId === pubId)) setEditionsAsked((n) => n + 1);
  });

  /** The publication's editions (edition.view); [] for anyone else, or when refused; null while fetched. */
  const [editions, setEditions] = useState<readonly PubEditionDto[] | null>(viewEditions ? null : []);
  useEffect(() => {
    if (!viewEditions) return;
    let current = true;
    void editionService.list({ orgId, pubId }).then((result) => {
      if (current) setEditions(result.ok ? result.value : []);
    });
    return () => {
      current = false;
    };
  }, [editionService, orgId, pubId, viewEditions, editionsAsked]);

  /** Section names (publication.view; fetched again with the board, a story may name a new one); none when refused. */
  const [sections, setSections] = useState<ReadonlyMap<string, string>>(new Map());
  useEffect(() => {
    let current = true;
    void layout.listSections({ orgId, pubId }).then((result) => {
      if (current && result.ok) setSections(new Map(result.value.items.map((one) => [one.id, one.name])));
    });
    return () => {
      current = false;
    };
  }, [layout, orgId, pubId, storiesAsked]);

  const edition = params.get("edition") ?? (editions ? defaultEdition(editions, localToday()) : null);
  const section = params.get("section") ?? "";
  const assignee = params.get("assignee") ?? "";
  const spiked = params.get("spiked") === "1";

  const [load, setLoad] = useState<Load>({ status: "loading" });
  useEffect(() => {
    if (edition === null) return;
    let current = true;
    void (async () => {
      const items: StoryListItemDto[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const filter = { limit: PAGE, ...(edition !== "any" ? { edition } : {}), ...(cursor ? { cursor } : {}) };
        const result = await stories.list({ orgId, pubId, filter });
        if (!current) return;
        if (!result.ok) return setLoad({ status: "failed", edition, problem: result.error });
        items.push(...result.value.items);
        cursor = result.value.nextCursor ?? undefined;
        if (!cursor) break;
      }
      setLoad({ status: "ready", edition, items, more: cursor !== undefined });
    })();
    return () => {
      current = false;
    };
  }, [stories, orgId, pubId, edition, storiesAsked]);

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const items = load.status === "ready" && load.edition === edition ? load.items : null;
  const failed = load.status === "failed" && load.edition === edition ? load.problem : null;
  const assignees = useMemo(() => {
    const named = new Map<string, string>();
    for (const item of items ?? []) {
      if (item.assignee && item.assignee.id !== userId) named.set(item.assignee.id, item.assignee.name);
    }
    return [...named].sort((a, b) => a[1].localeCompare(b[1]));
  }, [items, userId]);
  const givenTo = assignee === "me" ? userId : assignee;
  const shown = (items ?? []).filter(
    (item) =>
      (section === "" || (section === "none" ? item.sectionId === null : item.sectionId === section)) &&
      (assignee === "" || (assignee === "none" ? item.assignee === null : item.assignee?.id === givenTo)),
  );
  const columns: readonly StoryStatusDto[] = spiked ? [...COLUMNS, "spiked"] : COLUMNS;

  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendingBack, setSendingBack] = useState<StoryListItemDto | null>(null);
  const [moving, setMoving] = useState(false);
  /** The card to focus once the board shows it in its new column. */
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfter.current;
    if (!id || !items) return;
    focusAfter.current = null;
    (document.getElementById(`newsroom-card-${id}`) ?? document.getElementById(ROUTE_HEADING_ID))?.focus();
  }, [items]);

  const move = useCallback(
    async (item: StoryListItemDto, to: TransitionTargetDto, comment?: string): Promise<boolean> => {
      setProblem(null);
      setNotice(null);
      setMoving(true);
      const result = await stories.transition({
        orgId,
        pubId,
        storyId: item.id,
        to,
        baseRevision: item.revision,
        ...(comment ? { comment } : {}),
        idempotencyKey: randomUuid(),
      });
      setMoving(false);
      setStoriesAsked((n) => n + 1); // the board as it is now, moved or not (a 409: someone moved it first)
      if (!result.ok) {
        setProblem(result.error);
        return false;
      }
      focusAfter.current = item.id;
      setNotice(t("newsroom.moved", { headline: item.headline, status: t(statusKey(result.value.status)) }));
      return true;
    },
    [orgId, pubId, stories, t],
  );

  const editionOptions = [...(editions ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  // an edition named in the address that the list lacks (a Reporter has no list): its date from the stories in it
  const unlisted =
    edition !== null && edition !== "any" && edition !== "none" && !editionOptions.some((one) => one.id === edition)
      ? edition
      : null;
  const unlistedDate = unlisted ? (items ?? []).find((item) => item.edition?.id === unlisted)?.edition?.date : undefined;

  return (
    <Stack gap="5" className="pg-newsroom">
      <PageHeader
        title={t("nav.newsroom")}
        headingId={ROUTE_HEADING_ID}
        subtitle={own ? t("newsroom.ownOnly") : t("newsroom.subtitle")}
      />
      <OfflineNotice />
      <section aria-label={t("newsroom.filters")} className="pg-newsroom__filters">
        <Field label={t("newsroom.filter.edition")}>
          <Select
            value={edition ?? ""}
            disabled={edition === null}
            onChange={(event) => setFilter("edition", event.target.value)}
          >
            <option value="any">{t("newsroom.filter.anyEdition")}</option>
            <option value="none">{t("newsroom.filter.noEdition")}</option>
            {unlisted && (
              <option value={unlisted}>{unlistedDate ? formatDate(unlistedDate, language) : unlisted}</option>
            )}
            {editionOptions.map((one) => (
              <option key={one.id} value={one.id}>
                {formatDate(one.date, language)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("newsroom.filter.section")}>
          <Select value={section} onChange={(event) => setFilter("section", event.target.value || null)}>
            <option value="">{t("newsroom.filter.anySection")}</option>
            <option value="none">{t("newsroom.filter.noSection")}</option>
            {[...sections].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        {!own && (
          <Field label={t("newsroom.filter.assignee")}>
            <Select value={assignee} onChange={(event) => setFilter("assignee", event.target.value || null)}>
              <option value="">{t("newsroom.filter.anyone")}</option>
              <option value="me">{t("newsroom.filter.me")}</option>
              <option value="none">{t("newsroom.filter.nobody")}</option>
              {assignees.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Checkbox
          label={t("newsroom.filter.spiked")}
          checked={spiked}
          onChange={(event) => setFilter("spiked", event.target.checked ? "1" : null)}
        />
      </section>

      <div aria-live="polite">
        {notice && <InlineMessage variant="success" heading={notice} iconLabel={t("message.success")} />}
      </div>
      {problem && <ProblemMessage problem={problem} />}
      {failed && <ProblemMessage problem={failed} />}
      {!items && !failed && <ProgressIndicator role="status" label={t("newsroom.loading")} />}
      {items && load.status === "ready" && load.more && (
        <InlineMessage
          variant="info"
          heading={t("newsroom.tooMany", { count: items.length })}
          iconLabel={t("message.info")}
        />
      )}
      {items && (
        <div className="pg-newsroom__board" role="group" aria-label={t("newsroom.board")}>
          {columns.map((status) => {
            const cards = shown.filter((item) => item.status === status);
            const headingId = `newsroom-column-${status}`;
            return (
              <section key={status} className="pg-newsroom__column" aria-labelledby={headingId}>
                <h2 id={headingId} className="pg-newsroom__column-title">
                  {t("newsroom.column", { status: t(statusKey(status)), count: cards.length })}
                </h2>
                {cards.length === 0 ? (
                  <p className="pg-newsroom__empty">{t("newsroom.emptyColumn")}</p>
                ) : (
                  <ul className="pg-newsroom__cards">
                    {cards.map((item) => (
                      <Card
                        key={item.id}
                        item={item}
                        orgId={orgId}
                        pubId={pubId}
                        section={item.sectionId ? sections.get(item.sectionId) : undefined}
                        moving={moving}
                        onMove={(to) => (to === "draft" ? setSendingBack(item) : void move(item, to))}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      <SendBackDialog
        open={sendingBack !== null}
        onClose={() => setSendingBack(null)}
        onSend={async (comment) => {
          if (!sendingBack) return false;
          const sent = await move(sendingBack, "draft", comment);
          if (sent) setSendingBack(null);
          return sent;
        }}
      />
    </Stack>
  );
}

function Card({
  item,
  orgId,
  pubId,
  section,
  moving,
  onMove,
}: {
  readonly item: StoryListItemDto;
  readonly orgId: string;
  readonly pubId: string;
  readonly section: string | undefined;
  readonly moving: boolean;
  readonly onMove: (to: TransitionTargetDto) => void;
}) {
  const { t, language } = useI18n();
  const flags = flagsOf(item);
  return (
    <li className="pg-newsroom__card">
      <Link
        id={`newsroom-card-${item.id}`}
        className="pg-newsroom__headline"
        to={paths.pubStory(orgId, pubId, item.id)}
        lang={item.language || undefined}
      >
        {item.headline}
      </Link>
      <p className="pg-type-body-small pg-newsroom__meta">
        {[
          section,
          t("stories.by", { name: item.reporter.name }),
          item.assignee ? t("stories.givenTo", { name: item.assignee.name }) : t("stories.unassigned"),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="pg-type-body-small pg-newsroom__meta">
        {t("stories.words", { count: item.words })}
        {item.isBrief && <> · {t("stories.brief")}</>}
        {item.edition && <> · {formatDate(item.edition.date, language)}</>}
      </p>
      {(flags.length > 0 || item.can.transitions.length > 0) && (
        <div className="pg-newsroom__card-foot">
          <span className="pg-newsroom__flags">
            {flags.map((flag) => (
              <Badge key={flag} tone={FLAG_LOOK[flag][0]} icon={FLAG_LOOK[flag][1]}>
                {t(FLAG_LOOK[flag][2])}
              </Badge>
            ))}
          </span>
          {item.can.transitions.length > 0 && (
            <MenuButton label={t("newsroom.move", { headline: item.headline })} icon="ellipsis" iconOnly align="end">
              {item.can.transitions.map((to) => (
                <MenuItem key={to} disabled={moving} danger={to === "spiked"} onSelect={() => onMove(to)}>
                  {t(moveKey(to))}
                </MenuItem>
              ))}
            </MenuButton>
          )}
        </div>
      )}
    </li>
  );
}
