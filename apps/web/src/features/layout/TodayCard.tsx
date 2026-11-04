/**
 * The Overview's "Today" card (plan §1 L2.3), in each publication's card of the organisation's home: today's edition
 * (by India's date): its pages, its Ready stories against what the paper needs, the latest run's state and how many
 * pages passed the independent PDF/X-1a check, and a link to it; or "No edition for today", with a way to create it
 * for whoever may (a full edition.create). A live change to the publication's editions or layout fetches it again.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { paths } from "../../app/routes.ts";
import { formatDate } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { EditionLayoutDto, OrgAccessDto, PubEditionDto } from "../../services/index.ts";
import { Icon } from "../../ui/index.ts";
import { useEditions } from "../editions/editions-context.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { mayCreateEdition, mayViewEditions } from "../stories/access.ts";
import { layoutAccess } from "./access.ts";
import { useLayout } from "./layout-context.tsx";
import { runStateText } from "./layout-words.tsx";
import "./layout.css";

/** Today in India (YYYY-MM-DD), the date an edition is made for. */
export const todayInIndia = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

type Today = { readonly edition: PubEditionDto | null; readonly layout: EditionLayoutDto | null } | null;

export function TodayCard({ org, pubId }: { readonly org: OrgAccessDto; readonly pubId: string }) {
  const editions = useEditions();
  const layout = useLayout();
  const { t, language } = useI18n();
  const orgId = org.org.id;
  const view = mayViewEditions(org, pubId);
  const pagesView = layoutAccess(org, pubId).view;
  const [today, setToday] = useState<Today>(null);

  const fetchToday = useCallback(async () => {
    const list = await editions.list({ orgId, pubId });
    if (!list.ok) return setToday(null);
    const edition = list.value.find((candidate) => candidate.date === todayInIndia()) ?? null;
    const answer = edition && pagesView ? await layout.getLayout({ orgId, pubId, editionId: edition.id }) : null;
    setToday({ edition, layout: answer?.ok ? answer.value : null });
  }, [editions, layout, orgId, pubId, pagesView]);
  useEffect(() => {
    if (view) void fetchToday();
  }, [fetchToday, view]);
  useLiveEvents((event) => {
    const here = (event.type === "edition" || event.type === "layout") && event.publicationId === pubId;
    if (view && (here || event.type === "resync")) void fetchToday();
  });

  if (!view || !today) return null;
  const { edition } = today;
  if (!edition) {
    return (
      <section className="pg-today" aria-label={t("glossary.todaysEdition")}>
        <h4 className="pg-today__heading">{t("glossary.todaysEdition")}</h4>
        <p>{t("today.none")}</p>
        {mayCreateEdition(org, pubId) && (
          <p>
            <Link to={`${paths.pubEditions(orgId, pubId)}?create=1`}>
              <Icon name="plus" size={16} />
              {t("today.create")}
            </Link>
          </p>
        )}
      </section>
    );
  }
  const data = today.layout;
  const run = data ? (data.active ?? data.last) : null;
  const board = data?.board;
  // briefs are stories too (the Readiness tab lists them as a share of the stories): counted once
  const ready = data?.readiness ? data.readiness.have.stories : (edition.counts?.ready ?? null);
  const need = data?.readiness ? data.readiness.needs.stories : null;
  return (
    <section className="pg-today" aria-label={t("glossary.todaysEdition")}>
      <h4 className="pg-today__heading">
        {t("glossary.todaysEdition")} · {formatDate(edition.date, language)}
      </h4>
      <p>{t("editions.pages", { count: edition.pages })}</p>
      {ready !== null && (
        <p>{need !== null ? t("today.stories", { ready, need }) : t("today.storiesReady", { ready })}</p>
      )}
      {data && <p>{run ? t("today.run", { state: runStateText(run.state, t) }) : t("today.noRun")}</p>}
      {board && !data?.active && (
        <p>
          {t("today.checked", {
            passed: board.pages.filter((page) => page.check?.passed).length,
            total: board.pages.length,
          })}
        </p>
      )}
      {pagesView && (
        <p>
          <Link to={paths.pubEditionLayout(orgId, pubId, edition.id)}>
            <Icon name="layout-template" size={16} />
            {t("today.open")}
          </Link>
        </p>
      )}
    </section>
  );
}
