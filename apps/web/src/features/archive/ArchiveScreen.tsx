/**
 * The archive, /org/:orgId/pub/:pubId/archive (doc 06 §10.1; @pageinator/contracts archive.ts): the publication's
 * released editions, newest first, grouped by year and month (GET …/archive, archive.view). Each release shows its
 * front page's thumbnail when its run has one and the person may see pages (pages.view; nothing is shown otherwise),
 * its kind, files, approval time and "Kept until" (the archive's Object Lock retention). Filters (year, month, kind) and
 * a search by headline, reporter or section over the stories the released run placed. A release opens its own view.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import {
  Badge,
  Button,
  Cluster,
  EmptyState,
  Field,
  PageHeader,
  Panel,
  ProgressIndicator,
  Select,
  Stack,
  TextInput,
} from "../../ui/index.ts";
import { ROUTE_HEADING_ID, paths } from "../../app/routes.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type Language } from "../../i18n/index.ts";
import type { ApiProblem } from "../../services/index.ts";
import type { ArchiveEntryDto, ArchiveListDto } from "../../services/release-service.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { layoutAccess } from "../layout/access.ts";
import { useLayout } from "../layout/layout-context.tsx";
import { pageFile } from "../layout/layout-words.tsx";
import { useRelease } from "../release/release-context.tsx";
import "./archive.css";

type Kind = "release" | "correction";
type Filter = { readonly year?: number; readonly month?: number; readonly kind?: Kind; readonly q?: string };
type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly value: ArchiveListDto };

const monthName = (month: number, language: Language) =>
  new Intl.DateTimeFormat(language === "mr" ? "mr-IN-u-nu-latn" : "en-IN", { month: "long", timeZone: "UTC" }).format(
    Date.UTC(2000, month - 1, 1),
  );

export function ArchiveScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const access = layoutAccess(org, pubId);
  return (
    <Stack gap="5">
      <PageHeader
        title={t("glossary.archive")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
      />
      <OfflineNotice />
      {access.archive && <ArchiveContent orgId={orgId} pubId={pubId} thumbs={access.view} />}
    </Stack>
  );
}

function ArchiveContent({
  orgId,
  pubId,
  thumbs,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly thumbs: boolean;
}) {
  const release = useRelease();
  const { t, language } = useI18n();
  const [filter, setFilter] = useState<Filter>({});
  const [text, setText] = useState("");
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // the years offered: those seen in any answer, and this year
  const [years, setYears] = useState<readonly number[]>([new Date().getFullYear()]);
  const ask = useRef(0);

  const fetchList = useCallback(async () => {
    const mine = ++ask.current;
    setLoad({ status: "loading" });
    const result = await release.archive({ orgId, pubId, ...filter });
    if (mine !== ask.current) return;
    if (!result.ok) return setLoad({ status: "failed", problem: result.error });
    setLoad({ status: "ready", value: result.value });
    const seen = result.value.items.map((item) => Number(item.editionDate.slice(0, 4)));
    setYears((now) => [...new Set([...now, ...seen])].sort((a, b) => b - a));
  }, [release, orgId, pubId, filter]);
  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const pick = (change: Partial<Record<keyof Filter, unknown>>) => {
    const next: Record<string, unknown> = { ...filter, ...change };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    setFilter(next as Filter);
  };
  const search = (event: FormEvent) => {
    event.preventDefault();
    pick({ q: text.trim() || undefined });
  };
  const filtered = Object.keys(filter).length > 0;

  return (
    <Stack gap="5">
      <p>{t("archive.lede")}</p>
      <Panel title={t("archive.filters")}>
        <form onSubmit={search} aria-label={t("archive.filters")}>
          <Cluster gap="3">
            <Field label={t("archive.year")}>
              <Select
                value={filter.year ?? ""}
                onChange={(event) => pick({ year: event.target.value ? Number(event.target.value) : undefined })}
              >
                <option value="">{t("archive.any")}</option>
                {years.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("archive.month")}>
              <Select
                value={filter.month ?? ""}
                onChange={(event) => pick({ month: event.target.value ? Number(event.target.value) : undefined })}
              >
                <option value="">{t("archive.any")}</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={month}>
                    {monthName(month, language)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("archive.kind")}>
              <Select value={filter.kind ?? ""} onChange={(event) => pick({ kind: event.target.value || undefined })}>
                <option value="">{t("archive.any")}</option>
                <option value="release">{t("archive.kind.release")}</option>
                <option value="correction">{t("archive.kind.correction")}</option>
              </Select>
            </Field>
            <Field label={t("archive.search")}>
              <TextInput type="search" value={text} maxLength={200} onChange={(event) => setText(event.target.value)} />
            </Field>
            <Button type="submit" variant="secondary">
              {t("archive.searchButton")}
            </Button>
            {filtered && (
              <Button
                variant="quiet"
                onClick={() => {
                  setText("");
                  setFilter({});
                }}
              >
                {t("archive.clear")}
              </Button>
            )}
          </Cluster>
        </form>
      </Panel>
      <div aria-live="polite">
        {load.status === "loading" && <ProgressIndicator role="status" label={t("archive.loading")} />}
        {load.status === "failed" && (
          <Stack gap="3">
            <ProblemMessage problem={load.problem} />
            {!(load.problem.kind === "answer" && load.problem.status === 403) && (
              <div>
                <Button variant="secondary" onClick={() => void fetchList()}>
                  {t("form.retry")}
                </Button>
              </div>
            )}
          </Stack>
        )}
        {load.status === "ready" && load.value.items.length === 0 && (
          <Panel>
            {filtered ? (
              <p>{t("archive.noMatch")}</p>
            ) : (
              <EmptyState icon="archive" heading={t("archive.none")}>
                {t("archive.noneBody")}
              </EmptyState>
            )}
          </Panel>
        )}
      </div>
      {load.status === "ready" && load.value.items.length > 0 && (
        <Stack gap="5">
          {load.value.truncated && (
            <p className="pg-layout__note">{t("archive.truncated", { count: load.value.items.length })}</p>
          )}
          {groups(load.value.items).map(([year, months]) => (
            <section key={year} aria-labelledby={`archive-year-${year}`}>
              <h2 id={`archive-year-${year}`}>{year}</h2>
              <Stack gap="4">
                {months.map(([month, items]) => (
                  <Panel key={month} title={`${monthName(month, language)} ${year}`} headingLevel={3}>
                    <ul className="pg-archive__list">
                      {items.map((item) => (
                        <li key={item.releaseId}>
                          <Entry orgId={orgId} pubId={pubId} item={item} thumbs={thumbs} />
                        </li>
                      ))}
                    </ul>
                  </Panel>
                ))}
              </Stack>
            </section>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

type Month = [number, ArchiveEntryDto[]];
type Year = [number, Month[]];

/** The entries (newest first) grouped by year, then month, keeping their order. */
export function groups(items: readonly ArchiveEntryDto[]): Year[] {
  const out: Year[] = [];
  for (const item of items) {
    const year = Number(item.editionDate.slice(0, 4));
    const month = Number(item.editionDate.slice(5, 7));
    let y = out.at(-1);
    if (y?.[0] !== year) out.push((y = [year, []]));
    let m = y[1].at(-1);
    if (m?.[0] !== month) y[1].push((m = [month, []]));
    m[1].push(item);
  }
  return out;
}

function Entry({
  orgId,
  pubId,
  item,
  thumbs,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly item: ArchiveEntryDto;
  readonly thumbs: boolean;
}) {
  const { t, language } = useI18n();
  const date = formatDate(item.editionDate, language);
  return (
    <div className="pg-archive__entry">
      <div>
        {thumbs && item.frontThumb && (
          <Thumb orgId={orgId} pubId={pubId} runId={item.runId} alt={t("archive.thumb", { date })} />
        )}
      </div>
      <Stack gap="2">
        <Cluster gap="2">
          <Link to={paths.pubArchiveRelease(orgId, pubId, item.releaseId)}>{t("archive.edition", { date })}</Link>
          <Badge tone={item.kind === "correction" ? "warning" : "neutral"}>
            {item.kind === "correction"
              ? t("archive.correction", { number: item.number })
              : t("archive.release", { number: item.number })}
          </Badge>
        </Cluster>
        <p className="pg-layout__note">
          {t("archive.approved", { time: formatDateTime(item.approvedAt, language) })} ·{" "}
          {t("archive.files", { count: item.files })} ·{" "}
          {t("archive.kept", { date: formatDate(item.retainUntil, language) })}
        </p>
        {item.matches.length > 0 && (
          <div>
            <p className="pg-layout__note">{t("archive.matches")}</p>
            <ul className="pg-layout__list">
              {item.matches.map((hit) => {
                const by = [hit.reporter, hit.section].filter(Boolean).join(", ");
                return (
                  <li key={hit.storyId}>{by ? t("archive.matchBy", { headline: hit.headline, by }) : hit.headline}</li>
                );
              })}
            </ul>
          </div>
        )}
      </Stack>
    </div>
  );
}

/** The release's front page, fetched by a fresh link and held as an object URL while shown; nothing when it fails. */
function Thumb({
  orgId,
  pubId,
  runId,
  alt,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly runId: string;
  readonly alt: string;
}) {
  const layout = useLayout();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const stop = new AbortController();
    let made: string | null = null;
    void layout.loadFile({ orgId, pubId, runId, name: pageFile(1, "thumb.png"), signal: stop.signal }).then((result) => {
      if (stop.signal.aborted || !result.ok) return;
      made = URL.createObjectURL(result.value);
      setUrl(made);
    });
    return () => {
      stop.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [layout, orgId, pubId, runId]);
  return url ? (
    <div className="pg-archive__thumb">
      <img src={url} alt={alt} />
    </div>
  ) : null;
}
