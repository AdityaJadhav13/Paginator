/**
 * Sources, /org/:orgId/pub/:pubId/sources (docs/product/13-news-finder.md, L2.7): the news finder. "Trending" lists
 * the topics the engine grouped from the publication's feeds in the last days (each with its sources, how many reports,
 * a "Big story" badge and when it last moved), filtered by language; a topic opens the Pick drawer (PickDrawer), where
 * Claude drafts a story from it. "Settings" (for whoever may change them, settings.edit) holds the feeds, the house
 * style and how often to collect, and shows the AI spend. The screen is the desk's (story.assign); when the AI part is
 * off, collection still works and the screen says so.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { Badge, Cluster, EmptyState, InlineMessage, PageHeader, RadioGroup, Stack, Tabs } from "../../ui/index.ts";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, NewsLanguageDto, NewsSettingsDto, NewsTopicDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useNews } from "./news-context.tsx";
import { NewsSettingsTab } from "./NewsSettingsTab.tsx";
import { PickDrawer } from "./PickDrawer.tsx";
import "./news.css";

export function SourcesScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const news = useNews();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  const [settings, setSettings] = useState<NewsSettingsDto | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void news.getSettings({ orgId, pubId }).then((result) => {
      if (!current) return;
      if (result.ok) setSettings(result.value);
      else setProblem(result.error);
    });
    return () => {
      current = false;
    };
  }, [news, open, orgId, pubId]);

  const aiState = settings?.ai.state ?? null;
  const trending = <Trending orgId={orgId} pubId={pubId} />;

  return (
    <Stack gap="5" className="pg-news">
      <PageHeader title={t("nav.sources")} headingId={ROUTE_HEADING_ID} {...(publication ? { subtitle: publication.name } : {})} />
      <OfflineNotice />
      {problem && <ProblemMessage problem={problem} live={false} />}
      {aiState === "off" && (
        <InlineMessage variant="info" heading={t("news.aiOff.heading")} iconLabel={t("message.info")}>
          {t("news.aiOff.body")}
        </InlineMessage>
      )}
      {aiState === "cap" && (
        <InlineMessage variant="warning" heading={t("news.aiCap.heading")} iconLabel={t("message.warning")}>
          {t("news.aiCap.body")}
        </InlineMessage>
      )}
      {open &&
        settings &&
        (settings.mayManage ? (
          <Tabs
            label={t("news.tabs")}
            tabs={[
              { id: "trending", label: t("news.tab.trending"), panel: trending },
              {
                id: "settings",
                label: t("news.tab.settings"),
                panel: <NewsSettingsTab orgId={orgId} pubId={pubId} settings={settings} onSaved={setSettings} />,
              },
            ]}
          />
        ) : (
          trending
        ))}
    </Stack>
  );
}

type Filter = "" | NewsLanguageDto;

function Trending({ orgId, pubId }: { readonly orgId: string; readonly pubId: string }) {
  const news = useNews();
  const { t, language } = useI18n();
  const [filter, setFilter] = useState<Filter>("");
  const [topics, setTopics] = useState<readonly NewsTopicDto[] | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [chosen, setChosen] = useState<NewsTopicDto | null>(null);

  const load = useCallback(
    (shown: Filter, current: () => boolean) =>
      void news.listTopics({ orgId, pubId, ...(shown ? { language: shown } : {}) }).then((result) => {
        if (!current()) return;
        setProblem(result.ok ? null : result.error);
        if (result.ok) setTopics(result.value);
      }),
    [news, orgId, pubId],
  );
  useEffect(() => {
    let current = true;
    load(filter, () => current);
    return () => {
      current = false;
    };
  }, [filter, load]);

  return (
    <Stack gap="4">
      <RadioGroup
        className="pg-news__filter"
        legend={t("news.filter")}
        value={filter}
        onChange={(value) => setFilter(value as Filter)}
        options={[
          { value: "", label: t("news.filter.all") },
          { value: "mr", label: t("news.language.mr") },
          { value: "en", label: t("news.language.en") },
        ]}
      />
      {problem && <ProblemMessage problem={problem} live={false} />}
      {topics && topics.length === 0 && (
        <EmptyState icon="rss" heading={t("news.empty.heading")}>
          {t("news.empty.body")}
        </EmptyState>
      )}
      {topics && topics.length > 0 && (
        <ul className="pg-news__topics" aria-label={t("news.topics")}>
          {topics.map((topic) => {
            const [title, titleLang, other, otherLang] =
              language === "mr" ? [topic.titleMr, "mr", topic.titleEn, "en"] : [topic.titleEn, "en", topic.titleMr, "mr"];
            return (
              <li key={topic.id} className="pg-news__topic">
                <button type="button" className="pg-news__topic-title" lang={titleLang} onClick={() => setChosen(topic)}>
                  {title}
                </button>
                {other && other !== title && (
                  <p className="pg-news__topic-other" lang={otherLang}>
                    {other}
                  </p>
                )}
                <Cluster gap="2">
                  {topic.big && (
                    <Badge tone="accent" icon="newspaper">
                      {t("news.big")}
                    </Badge>
                  )}
                  {topic.sources.map((source) => (
                    <Badge key={source.id}>
                      <bdi>{source.name}</bdi>
                    </Badge>
                  ))}
                </Cluster>
                <p className="pg-news__topic-meta">
                  <span>{t("news.sourceCount", { count: topic.sources.length })}</span>
                  <span>{t("news.itemCount", { count: topic.itemCount })}</span>
                  <span>{t("news.latest", { time: formatDateTime(topic.latestAt, language) })}</span>
                </p>
              </li>
            );
          })}
        </ul>
      )}
      <PickDrawer orgId={orgId} pubId={pubId} topic={chosen} onClose={() => setChosen(null)} />
    </Stack>
  );
}
