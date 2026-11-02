/**
 * Stories, /org/:orgId/pub/:pubId/stories (plan §10 PR 21; 03 content desk): the publication's stories as a table on a
 * desktop and a list on a phone, with their status, word count, reporter and who they are given to. Filters (status,
 * edition, given to me, reporter, search) live in the address, so a filtered list can be shared; pages come from the
 * API's cursor. "New story" and "Paste stories" for whoever may create one.
 *
 * A live change to a story of this publication (or a `resync`) says the list has changed, with a button that fetches
 * it again: rows never move under the person's finger, and the pages loaded so far stay until they ask.
 *
 * The edition filter (and the paste dialog's edition) offers the publication's editions to whoever may see them
 * (edition.view); for anyone else (a Reporter), the editions of the stories seen so far. Editions are made on the
 * Editions screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import {
  Avatar,
  Button,
  Checkbox,
  EmptyState,
  Field,
  Icon,
  InlineMessage,
  PageHeader,
  Panel,
  ProgressIndicator,
  Select,
  Stack,
  Table,
  TableCell,
  TableHeader,
  TextInput,
} from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useIsPhoneViewport } from "../../app/useViewport.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, StoryFilterDto, StoryListItemDto, StoryStatusDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { isDesk, mayCreate, mayViewEditions, storyScope } from "./access.ts";
import { usePublicationEditions } from "../editions/editions-context.tsx";
import { PasteDialog } from "./PasteDialog.tsx";
import { StatusChip, statusKey } from "./StatusChip.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { useStories } from "./stories-context.tsx";
import "./stories.css";

const STATUSES: readonly StoryStatusDto[] = ["draft", "filed", "editing", "ready", "held", "spiked", "placed"];

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly items: readonly StoryListItemDto[]; readonly nextCursor: string | null };

function filterFrom(params: URLSearchParams): StoryFilterDto {
  const status = params.get("status");
  return {
    ...(status && (STATUSES as readonly string[]).includes(status) ? { status: status as StoryStatusDto } : {}),
    ...(params.get("edition") ? { edition: params.get("edition") ?? "" } : {}),
    ...(params.get("assignee") === "me" ? { assignee: "me" as const } : {}),
    ...(params.get("reporter") ? { reporter: params.get("reporter") ?? "" } : {}),
    ...(params.get("q") ? { q: params.get("q") ?? "" } : {}),
  };
}

export function StoriesScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const scope = org ? storyScope(org, pubId) : "none";
  const header = <PageHeader title={t("glossary.stories")} headingId={ROUTE_HEADING_ID} />;
  return (
    <Stack gap="5">
      {!org || (org.twoStep.required && !org.twoStep.satisfied) ? (
        <>
          {header}
          <OfflineNotice />
        </>
      ) : scope === "none" ? (
        <>
          {header}
          <OfflineNotice />
          <InlineMessage variant="info" heading={t("stories.noAccess.heading")} iconLabel={t("message.info")}>
            {t("stories.noAccess.body")}
          </InlineMessage>
        </>
      ) : (
        <StoriesContent
          orgId={orgId}
          pubId={pubId}
          publicationName={publication?.name ?? ""}
          create={mayCreate(org, pubId)}
          own={scope === "own"}
          readOnly={scope === "all" && !isDesk(org, pubId) && !mayCreate(org, pubId)}
          desk={isDesk(org, pubId)}
          viewEditions={mayViewEditions(org, pubId)}
        />
      )}
    </Stack>
  );
}

function StoriesContent({
  orgId,
  pubId,
  publicationName,
  create,
  own,
  readOnly,
  desk,
  viewEditions,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly publicationName: string;
  readonly create: boolean;
  readonly own: boolean;
  readonly readOnly: boolean;
  /** Only the desk places a story in an edition, pasted ones too. */
  readonly desk: boolean;
  /** edition.view: the filter offers the publication's editions, not only those seen in the list. */
  readonly viewEditions: boolean;
}) {
  const stories = useStories();
  const { t, language } = useI18n();
  const phone = useIsPhoneViewport();
  const [params, setParams] = useSearchParams();
  const filter = useMemo(() => filterFrom(params), [params]);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [more, setMore] = useState<{ pending: boolean; problem: ApiProblem | null }>({ pending: false, problem: null });
  const [search, setSearch] = useState(filter.q ?? "");
  const [pasting, setPasting] = useState(false);
  /** A live update says the list has changed since it was fetched. */
  const [changed, setChanged] = useState(false);
  /** Live updates heard: one heard while the list was being fetched keeps the notice. */
  const heard = useRef(0);
  useLiveEvents((event) => {
    if (event.type !== "resync" && !(event.type === "story" && event.publicationId === pubId)) return;
    heard.current += 1;
    setChanged(true);
  });
  /** Editions and reporters seen in this list so far (no endpoint lists reporters; editions only for edition.view). */
  const [seenEditions, setEditions] = useState<ReadonlyMap<string, string>>(new Map());
  const listed = usePublicationEditions(orgId, pubId, viewEditions);
  const editions = useMemo(
    () => (listed ? new Map(listed.map((edition) => [edition.id, edition.date])) : seenEditions),
    [listed, seenEditions],
  );
  const [reporters, setReporters] = useState<ReadonlyMap<string, string>>(new Map());

  const remember = useCallback((items: readonly StoryListItemDto[]) => {
    setEditions((known) => {
      const next = new Map(known);
      for (const item of items) if (item.edition) next.set(item.edition.id, item.edition.date);
      return next.size === known.size ? known : next;
    });
    setReporters((known) => {
      const next = new Map(known);
      for (const item of items) next.set(item.reporter.id, item.reporter.name);
      return next.size === known.size ? known : next;
    });
  }, []);

  const fetchFirst = useCallback(
    async (live: boolean) => {
      const before = heard.current;
      const result = await stories.list({ orgId, pubId, filter });
      if (!result.ok) return setLoad({ status: "failed", problem: result.error, live });
      if (heard.current === before) setChanged(false);
      remember(result.value.items);
      setLoad({ status: "ready", items: result.value.items, nextCursor: result.value.nextCursor });
    },
    [filter, orgId, pubId, remember, stories],
  );
  useEffect(() => {
    setLoad({ status: "loading" });
    setMore({ pending: false, problem: null });
    void fetchFirst(false);
  }, [fetchFirst]);
  useEffect(() => setSearch(filter.q ?? ""), [filter.q]);

  const showMore = async () => {
    if (load.status !== "ready" || !load.nextCursor || more.pending) return;
    setMore({ pending: true, problem: null });
    const result = await stories.list({ orgId, pubId, filter: { ...filter, cursor: load.nextCursor } });
    if (!result.ok) return setMore({ pending: false, problem: result.error });
    remember(result.value.items);
    setMore({ pending: false, problem: null });
    setLoad({ status: "ready", items: [...load.items, ...result.value.items], nextCursor: result.value.nextCursor });
  };

  const setFilter = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const applySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFilter("q", search.trim() || null);
  };
  const filtered = Object.keys(filter).length > 0;
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  const editionName = (item: StoryListItemDto) => (item.edition ? formatDate(item.edition.date, language) : t("stories.noEdition"));
  const person = (name: string) => (
    <span className="pg-stories__person">
      <Avatar name={name} size="sm" decorative />
      <span>{name}</span>
    </span>
  );
  const newStory = (
    <Link className="pg-button pg-button--primary pg-button--md pg-stories__new" to={paths.pubStoryNew(orgId, pubId)}>
      <Icon name="plus" size={16} />
      {t("stories.new")}
    </Link>
  );

  return (
    <Stack gap="5" className="pg-stories">
      <PageHeader
        title={t("glossary.stories")}
        headingId={ROUTE_HEADING_ID}
        subtitle={own ? t("stories.ownOnly") : readOnly ? t("stories.readOnly") : publicationName || undefined}
        actions={
          create && (
            <>
              <Button variant="secondary" onClick={() => setPasting(true)}>
                <Icon name="copy" size={16} />
                {t("stories.paste")}
              </Button>
              {newStory}
            </>
          )
        }
      />
      <OfflineNotice />

      <Panel flush className="pg-stories__panel">
      <section aria-label={t("stories.filters")} className="pg-stories__filter-bar">
        <form className="pg-stories__filters" onSubmit={applySearch} role="search">
          <Field label={t("stories.filter.status")}>
            <Select value={filter.status ?? ""} onChange={(event) => setFilter("status", event.target.value || null)}>
              <option value="">{t("stories.filter.anyStatus")}</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {t(statusKey(status))}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("stories.filter.edition")}>
            <Select value={filter.edition ?? ""} onChange={(event) => setFilter("edition", event.target.value || null)}>
              <option value="">{t("stories.filter.anyEdition")}</option>
              {[...editions].sort((a, b) => b[1].localeCompare(a[1])).map(([id, date]) => (
                <option key={id} value={id}>
                  {formatDate(date, language)}
                </option>
              ))}
            </Select>
          </Field>
          {!own && (
            <Field label={t("stories.filter.reporter")}>
              <Select value={filter.reporter ?? ""} onChange={(event) => setFilter("reporter", event.target.value || null)}>
                <option value="">{t("stories.filter.anyReporter")}</option>
                {[...reporters].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Checkbox
            label={t("stories.filter.mine")}
            checked={filter.assignee === "me"}
            onChange={(event) => setFilter("assignee", event.target.checked ? "me" : null)}
          />
          <div className="pg-stories__search">
            <Field label={t("stories.filter.search")}>
              <TextInput type="search" name="q" value={search} onChange={(event) => setSearch(event.target.value)} />
            </Field>
            <Icon name="search" size={16} className="pg-stories__search-icon" />
          </div>
          <Button type="submit" variant="secondary">
            {t("stories.filter.apply")}
          </Button>
          {filtered && (
            <Button variant="quiet" onClick={clearFilters}>
              <Icon name="x" size={16} />
              {t("stories.filter.clear")}
            </Button>
          )}
        </form>
      </section>

      <div aria-live="polite" className={changed && load.status === "ready" ? "pg-stories__pad" : undefined}>
        {changed && load.status === "ready" && (
          <InlineMessage variant="info" heading={t("stories.live.changed")} iconLabel={t("message.info")}>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                await fetchFirst(true);
                document.getElementById(ROUTE_HEADING_ID)?.focus(); // the button is gone: focus goes to the page's heading
              }}
            >
              {t("stories.live.refresh")}
            </Button>
          </InlineMessage>
        )}
      </div>
      {load.status === "loading" && (
        <div className="pg-stories__pad">
          <ProgressIndicator role="status" label={t("stories.loading")} />
        </div>
      )}
      {load.status === "failed" && (
        <Stack gap="3" className="pg-stories__pad">
          <ProblemMessage problem={load.problem} live={load.live} />
          <div>
            <Button variant="secondary" onClick={() => void fetchFirst(true)}>
              {t("form.retry")}
            </Button>
          </div>
        </Stack>
      )}
      {load.status === "ready" && load.items.length === 0 && (
        <EmptyState
          icon={filtered ? "list-filter" : "file-text"}
          heading={filtered ? t("stories.empty.noMatchHeading") : t("stories.empty.heading")}
          action={
            filtered ? (
              <Button variant="secondary" onClick={clearFilters}>
                {t("stories.filter.clear")}
              </Button>
            ) : (
              create && newStory
            )
          }
        >
          {filtered ? t("stories.noMatch") : t("stories.none")}
        </EmptyState>
      )}
      {load.status === "ready" && load.items.length > 0 && phone && (
        <ul className="pg-stories__list" aria-label={t("stories.table", { publication: publicationName })}>
          {load.items.map((item) => (
            <li key={item.id} className="pg-stories__card">
              <p className="pg-type-body">
                <Link to={paths.pubStory(orgId, pubId, item.id)} lang={item.language || undefined}>
                  <strong>{item.headline}</strong>
                </Link>
              </p>
              <p className="pg-type-body-small pg-stories__card-line">
                <StatusChip status={item.status} /> {t("stories.words", { count: item.words })}
                {item.isBrief && <> · {t("stories.brief")}</>}
              </p>
              <p className="pg-type-body-small pg-stories__meta">
                {t("stories.by", { name: item.reporter.name })} ·{" "}
                {item.assignee ? t("stories.givenTo", { name: item.assignee.name }) : t("stories.unassigned")}
              </p>
              <p className="pg-type-body-small pg-stories__meta">
                {editionName(item)} · {formatDateTime(item.updatedAt, language)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {load.status === "ready" && load.items.length > 0 && !phone && (
        <Table caption={t("stories.table", { publication: publicationName })} className="pg-stories__table">
          <thead>
            <tr>
              <TableHeader>{t("stories.col.headline")}</TableHeader>
              <TableHeader>{t("stories.col.status")}</TableHeader>
              <TableHeader numeric>{t("stories.col.words")}</TableHeader>
              <TableHeader>{t("stories.col.reporter")}</TableHeader>
              <TableHeader>{t("stories.col.assignee")}</TableHeader>
              <TableHeader>{t("stories.col.edition")}</TableHeader>
              <TableHeader>{t("stories.col.updated")}</TableHeader>
            </tr>
          </thead>
          <tbody>
            {load.items.map((item) => (
              <tr key={item.id}>
                <th scope="row" className="pg-stories__headline">
                  <Link to={paths.pubStory(orgId, pubId, item.id)} lang={item.language || undefined}>
                    {item.headline}
                  </Link>
                </th>
                <TableCell>
                  <StatusChip status={item.status} />
                </TableCell>
                <TableCell numeric>
                  {item.isBrief && <span className="pg-stories__brief">{t("stories.brief")} · </span>}
                  {item.words}
                </TableCell>
                <TableCell>{person(item.reporter.name)}</TableCell>
                <TableCell>
                  {item.assignee ? person(item.assignee.name) : <span className="pg-stories__muted">{t("stories.unassigned")}</span>}
                </TableCell>
                <TableCell className={item.edition ? undefined : "pg-stories__muted"}>{editionName(item)}</TableCell>
                <TableCell className="pg-stories__nowrap">{formatDateTime(item.updatedAt, language)}</TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {load.status === "ready" && load.nextCursor && (
        <Stack gap="3" className="pg-stories__pad">
          {more.problem && <ProblemMessage problem={more.problem} />}
          <div>
            <Button variant="secondary" aria-busy={more.pending} onClick={() => void showMore()}>
              {more.pending ? t("stories.loadingMore") : t("stories.more")}
            </Button>
          </div>
        </Stack>
      )}
      </Panel>

      {create && (
        <PasteDialog
          orgId={orgId}
          pubId={pubId}
          open={pasting}
          editions={desk ? editions : new Map()}
          onClose={() => setPasting(false)}
          onAdded={() => void fetchFirst(true)}
        />
      )}
    </Stack>
  );
}
