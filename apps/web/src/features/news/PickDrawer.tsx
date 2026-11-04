/**
 * Pick a topic (docs/product/13-news-finder.md §4–7): the topic's reports with their links, then the story's language,
 * length and "Find a photo" (on by itself only for a big story: not every story needs a picture). Picking sends one
 * request (an Idempotency-Key kept for its retries, 202); the engine drafts it later, and the drawer asks GET
 * …/news/drafts/:d every 2 s until it is done or failed. Done: a link to the Draft story (in Stories, given to the
 * person who picked), the sentences the copy check still found too close to a source, "Made with Claude — check before
 * use", and, when photos were looked for, 3–5 to choose from, each labelled Safe to print or Needs permission (code
 * decides the label, never Claude); a Needs-permission one is chosen only with "We have the right to print this"
 * ticked. Failed: the engine's reason in plain words, and the topic may be picked again.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Badge, Button, Checkbox, Drawer, Icon, InlineMessage, RadioGroup, Stack } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { useI18n, type PlainKey } from "../../i18n/index.ts";
import type { ApiProblem, DraftLengthDto, NewsDraftDto, NewsLanguageDto, NewsTopicDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useNews } from "./news-context.tsx";

export const POLL_MS = 2000;

/** A GET that will never succeed: polling stops, and the drawer says why. */
const PERMANENT = new Set([401, 403, 404]);

/** The engine's failure codes (ai.off, …, news.no_text; the dot as "_") in the web's own words; any other (worker.…)
 * is the general one. */
const ERROR_WORDS: Readonly<Record<string, PlainKey>> = {
  ai_off: "news.error.ai_off",
  ai_cap: "news.error.ai_cap",
  ai_refused: "news.error.ai_refused",
  ai_max_tokens: "news.error.ai_max_tokens",
  ai_error: "news.error.ai_error",
  news_no_text: "news.error.no_text",
};

type Phase =
  | { readonly step: "pick" }
  | { readonly step: "wait"; readonly draftId: string }
  | { readonly step: "done"; readonly draft: NewsDraftDto };

type Failure = { readonly problem: ApiProblem } | { readonly code: string };

export function PickDrawer({
  orgId,
  pubId,
  topic: listed,
  onClose,
}: {
  readonly orgId: string;
  readonly pubId: string;
  /** The topic as the list has it (no items); null while the drawer is closed. */
  readonly topic: NewsTopicDto | null;
  readonly onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Drawer open={!!listed} onClose={onClose} title={t("news.pick.title")} closeLabel={t("shell.closeDialog")} size="wide">
      {listed && <PickContent key={listed.id} orgId={orgId} pubId={pubId} listed={listed} />}
    </Drawer>
  );
}

function PickContent({ orgId, pubId, listed }: { readonly orgId: string; readonly pubId: string; readonly listed: NewsTopicDto }) {
  const news = useNews();
  const { t, language: uiLanguage } = useI18n();
  const [topic, setTopic] = useState(listed);
  const [language, setLanguage] = useState<NewsLanguageDto>(listed.languages.includes("mr") ? "mr" : "en");
  const [length, setLength] = useState<DraftLengthDto>("standard");
  const [findPhoto, setFindPhoto] = useState(listed.big);
  const [phase, setPhase] = useState<Phase>({ step: "pick" });
  const [failure, setFailure] = useState<Failure | null>(null);
  const [sending, setSending] = useState(false);
  /** The pick's key, kept for a retry after a lost answer: the same pick is never drafted twice. */
  const sent = useRef<{ readonly key: string; readonly body: string } | null>(null);

  useEffect(() => {
    let current = true;
    void news.getTopic({ orgId, pubId, topicId: listed.id }).then((result) => {
      if (current && result.ok) setTopic(result.value);
    });
    return () => {
      current = false;
    };
  }, [listed.id, news, orgId, pubId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase.step !== "pick" || sending) return;
    const pick = { language, length, findPhoto };
    const body = JSON.stringify(pick);
    if (!sent.current || sent.current.body !== body) sent.current = { key: randomUuid(), body };
    setFailure(null);
    setSending(true);
    const accepted = await news.pick({ orgId, pubId, topicId: topic.id, pick, idempotencyKey: sent.current.key });
    setSending(false);
    if (!accepted.ok) {
      // a refusal is an answer: the next pick is a new one; a lost answer is retried as it was
      if (accepted.error.kind === "answer" && accepted.error.status < 500) sent.current = null;
      return setFailure({ problem: accepted.error });
    }
    sent.current = null;
    setPhase({ step: "wait", draftId: accepted.value.draftId });
  };

  const waitingFor = phase.step === "wait" ? phase.draftId : null;
  const waiting = useRef<string | null>(null);
  useEffect(() => {
    waiting.current = waitingFor;
  }, [waitingFor]);
  const check = useCallback(async () => {
    if (!waitingFor) return;
    const answer = await news.getDraft({ orgId, pubId, draftId: waitingFor });
    if (waiting.current !== waitingFor) return;
    if (!answer.ok) {
      // a lost answer is asked again at the next poll; a refusal is final
      if (answer.error.kind !== "answer" || !PERMANENT.has(answer.error.status)) return;
      waiting.current = null;
      setFailure({ problem: answer.error });
      return setPhase({ step: "pick" });
    }
    if (answer.value.state === "queued") return;
    waiting.current = null;
    if (answer.value.state === "done") return setPhase({ step: "done", draft: answer.value });
    setFailure({ code: answer.value.error?.code ?? "worker.unknown" });
    setPhase({ step: "pick" });
  }, [news, orgId, pubId, waitingFor]);
  useEffect(() => {
    if (!waitingFor) return;
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [check, waitingFor]);

  const [title, titleLang] = uiLanguage === "mr" ? [topic.titleMr, "mr"] : [topic.titleEn, "en"];
  const status = phase.step === "wait" ? t("news.pick.working") : phase.step === "done" ? t("news.pick.done") : "";
  const ids = useId();

  return (
    <Stack gap="5">
      <Stack gap="2">
        <h3 className="pg-type-section-title" lang={titleLang}>
          {title}
        </h3>
        {topic.big && (
          <div>
            <Badge tone="accent" icon="newspaper">
              {t("news.big")}
            </Badge>
          </div>
        )}
      </Stack>
      {topic.items.length > 0 && (
        <section aria-labelledby={`${ids}-reports`}>
          <Stack gap="2">
            <h3 id={`${ids}-reports`} className="pg-type-section-title">
              {t("news.pick.reports")}
            </h3>
            <ul className="pg-news__reports">
              {topic.items.map((item) => (
                <li key={item.id}>
                  <a href={item.link} target="_blank" rel="noopener noreferrer" lang={item.language}>
                    {item.title}
                  </a>
                  <span className="pg-news__report-site">
                    <bdi>{item.sourceName}</bdi>
                  </span>
                </li>
              ))}
            </ul>
          </Stack>
        </section>
      )}
      {failure && <FailureMessage failure={failure} />}
      {/* the live region stays mounted (so its first words are heard), out of the layout while empty */}
      <p role="status" className={status ? "pg-news__status" : "pg-visually-hidden"}>
        {phase.step === "wait" && <Icon name="loader-circle" size={16} />}
        {status}
      </p>
      {phase.step === "done" ? (
        <DraftResult orgId={orgId} pubId={pubId} draft={phase.draft} onChanged={(draft) => setPhase({ step: "done", draft })} />
      ) : (
        <form noValidate onSubmit={submit} aria-busy={phase.step === "wait" || sending}>
          <Stack gap="4">
            <RadioGroup
              className="pg-news__filter"
              legend={t("news.pick.language")}
              value={language}
              disabled={phase.step !== "pick"}
              onChange={(value) => setLanguage(value as NewsLanguageDto)}
              options={[
                { value: "mr", label: t("news.language.mr") },
                { value: "en", label: t("news.language.en") },
              ]}
            />
            <RadioGroup
              className="pg-news__filter"
              legend={t("news.pick.length")}
              value={length}
              disabled={phase.step !== "pick"}
              onChange={(value) => setLength(value as DraftLengthDto)}
              options={[
                { value: "short", label: t("news.length.short") },
                { value: "standard", label: t("news.length.standard") },
                { value: "long", label: t("news.length.long") },
              ]}
            />
            <Stack gap="1">
              <Checkbox
                label={t("news.pick.photo")}
                checked={findPhoto}
                disabled={phase.step !== "pick"}
                aria-describedby={`${ids}-photo`}
                onChange={(event) => setFindPhoto(event.target.checked)}
              />
              <p id={`${ids}-photo`} className="pg-field__description">
                {t("news.pick.photoHint")}
              </p>
            </Stack>
            <div>
              <Button type="submit" disabled={phase.step !== "pick" || sending}>
                {t("news.pick.submit")}
              </Button>
            </div>
          </Stack>
        </form>
      )}
    </Stack>
  );
}

function FailureMessage({ failure }: { readonly failure: Failure }) {
  const { t } = useI18n();
  if ("problem" in failure) return <ProblemMessage problem={failure.problem} />;
  return (
    <InlineMessage variant="error" heading={t("news.failed")} live iconLabel={t("message.error")}>
      {t(ERROR_WORDS[failure.code.replace(".", "_")] ?? "news.error.worker")}
    </InlineMessage>
  );
}

function DraftResult({
  orgId,
  pubId,
  draft,
  onChanged,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly draft: NewsDraftDto;
  readonly onChanged: (draft: NewsDraftDto) => void;
}) {
  const { t } = useI18n();
  const ids = useId();
  return (
    <Stack gap="4">
      <InlineMessage variant="warning" heading={t("news.madeWithClaude")} iconLabel={t("message.warning")}>
        {t("news.madeWithClaude.body")}
      </InlineMessage>
      {draft.storyId && (
        <p>
          <Link to={paths.pubStory(orgId, pubId, draft.storyId)}>{t("news.pick.openStory")}</Link>
        </p>
      )}
      {draft.flagged.length > 0 && (
        <section aria-labelledby={`${ids}-flagged`}>
          <Stack gap="2">
            <h3 id={`${ids}-flagged`} className="pg-type-section-title">
              {t("news.flagged")}
            </h3>
            <ul className="pg-news__flagged">
              {draft.flagged.map((sentence, index) => (
                <li key={index} lang={draft.language}>
                  {sentence}
                </li>
              ))}
            </ul>
          </Stack>
        </section>
      )}
      {draft.findPhoto && <PhotoChoice orgId={orgId} pubId={pubId} draft={draft} onChosen={(assetId) => onChanged({ ...draft, chosenAssetId: assetId })} />}
    </Stack>
  );
}

function PhotoChoice({
  orgId,
  pubId,
  draft,
  onChosen,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly draft: NewsDraftDto;
  readonly onChosen: (assetId: string) => void;
}) {
  const news = useNews();
  const { t } = useI18n();
  const ids = useId();
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [untickedAt, setUntickedAt] = useState<number | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [choosing, setChoosing] = useState(false);

  if (draft.chosenAssetId) return <p role="status">{t("news.photo.chosen")}</p>;

  const choose = async (index: number, needsPermission: boolean) => {
    const rightsConfirmed = ticked.has(index);
    if (needsPermission && !rightsConfirmed) return setUntickedAt(index);
    setUntickedAt(null);
    setProblem(null);
    setChoosing(true);
    const result = await news.choosePhoto({ orgId, pubId, draftId: draft.id, index, rightsConfirmed });
    setChoosing(false);
    if (!result.ok) return setProblem(result.error);
    onChosen(result.value.assetId);
  };

  return (
    <section aria-labelledby={`${ids}-photos`}>
      <Stack gap="3">
        <h3 id={`${ids}-photos`} className="pg-type-section-title">
          {t("news.photos")}
        </h3>
        {draft.photos.length === 0 && <p>{t("news.photos.none")}</p>}
        {problem && <ProblemMessage problem={problem} />}
        <ul className="pg-news__photos">
          {draft.photos.map((photo, index) => {
            const needs = photo.label === "needs_permission";
            const errorId = `${ids}-rights-${index}`;
            const titleId = `${ids}-photo-title-${index}`; // tells the photos' like-named controls apart
            return (
              <li key={photo.url} className="pg-news__photo">
                <img src={photo.thumbUrl} alt={photo.title} referrerPolicy="no-referrer" loading="lazy" />
                <Stack gap="2">
                  <div>
                    <Badge tone={needs ? "warning" : "success"} icon={needs ? "triangle-alert" : "circle-check"}>
                      {t(needs ? "news.label.needs_permission" : "news.label.safe")}
                    </Badge>
                  </div>
                  <p id={titleId} className="pg-news__photo-title">
                    <bdi>{photo.title}</bdi>
                  </p>
                  <p>{t("news.photo.licence", { licence: photo.licence })}</p>
                  <p>{t("news.photo.credit", { credit: photo.credit })}</p>
                  <p>{t("library.pixels", { width: photo.widthPx, height: photo.heightPx })}</p>
                  <a href={photo.pageUrl} target="_blank" rel="noopener noreferrer">
                    {t("news.photo.page")}
                    <Icon name="external-link" size={16} />
                  </a>
                  {needs && (
                    <>
                      <Checkbox
                        label={t("news.rights")}
                        checked={ticked.has(index)}
                        required
                        aria-describedby={untickedAt === index ? `${titleId} ${errorId}` : titleId}
                        {...(untickedAt === index ? { "aria-invalid": true } : {})}
                        onChange={(event) => {
                          const next = new Set(ticked);
                          if (event.target.checked) next.add(index);
                          else next.delete(index);
                          setTicked(next);
                          if (event.target.checked && untickedAt === index) setUntickedAt(null);
                        }}
                      />
                      {untickedAt === index && (
                        <p id={errorId} className="pg-field__error" role="alert">
                          {t("news.rights.first")}
                        </p>
                      )}
                    </>
                  )}
                  <div>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={choosing}
                      aria-describedby={titleId}
                      onClick={() => void choose(index, needs)}
                    >
                      {t("news.photo.choose")}
                    </Button>
                  </div>
                </Stack>
              </li>
            );
          })}
        </ul>
      </Stack>
    </section>
  );
}
