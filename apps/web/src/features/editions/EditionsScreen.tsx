/**
 * Editions, /org/:orgId/pub/:pubId/editions (plan §1 L2.1 "minimal editions", §10 PR 21 and PR 24): the publication's
 * editions, newest first, each with its pages, its stories counted (all, Ready, spiked) and a link to its stories.
 * "Create edition" (date, 4/8/16 pages, back-page ads, volume, issue, price) for a full edition.create, with one
 * Idempotency-Key per edition asked for, the same on a retry after no answer. "Send to the Desk" for a full
 * desk.export: the edition's Ready stories as a story bundle, saved as a file; spiked stories are never sent.
 *
 * A list, not a table, so a phone needs no sideways scroll. A live change to an edition or a story of this publication
 * (or a `resync`) fetches the list again in place: the rows are the editions themselves, and only their counts move.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { EDITION_PAGES } from "@pageinator/contracts";
import { Button, Checkbox, Field, InlineMessage, ProgressIndicator, Select, Stack, TextInput } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, EditionInputDto, PubEditionDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { mayCreateEdition, mayExport } from "../stories/access.ts";
import { useEditions } from "./editions-context.tsx";
import "../stories/stories.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly items: readonly PubEditionDto[] };

/** No answer came, or the server failed: the edition may have been made, so a retry keeps the key. */
const unknownOutcome = (problem: ApiProblem) =>
  problem.kind !== "answer" || (problem.status >= 500 && problem.code !== "slow_down");

/** Saves a file the browser holds, as a download. */
function saveFile(file: Blob, filename: string): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // some browsers read the URL after click() returns; 40 s is FileSaver.js's wait
  setTimeout(() => URL.revokeObjectURL(url), 40_000);
}

export function EditionsScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org = state.status === "ready" ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId) : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  return (
    <Stack gap="5">
      <h1 id={ROUTE_HEADING_ID} className="pg-type-page-title" tabIndex={-1}>
        {t("nav.editions")}
      </h1>
      <OfflineNotice />
      {!org || (org.twoStep.required && !org.twoStep.satisfied) ? null : (
        <EditionsContent
          orgId={orgId}
          pubId={pubId}
          publicationName={publication?.name ?? ""}
          create={mayCreateEdition(org, pubId)}
          send={mayExport(org, pubId)}
        />
      )}
    </Stack>
  );
}

function EditionsContent({
  orgId,
  pubId,
  publicationName,
  create,
  send,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly publicationName: string;
  readonly create: boolean;
  readonly send: boolean;
}) {
  const editions = useEditions();
  const { t } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "loading" });

  const fetchList = useCallback(
    async (live: boolean) => {
      const result = await editions.list({ orgId, pubId });
      setLoad(result.ok ? { status: "ready", items: result.value } : { status: "failed", problem: result.error, live });
    },
    [editions, orgId, pubId],
  );
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchList(false);
  }, [fetchList]);
  useLiveEvents((event) => {
    const here = (event.type === "edition" || event.type === "story") && event.publicationId === pubId;
    if (here || event.type === "resync") void fetchList(true);
  });

  return (
    <Stack gap="5">
      {create && <CreateEdition orgId={orgId} pubId={pubId} onMade={() => void fetchList(true)} />}
      {load.status === "loading" && <ProgressIndicator role="status" label={t("editions.loading")} />}
      {load.status === "failed" && (
        <Stack gap="3">
          <ProblemMessage problem={load.problem} live={load.live} />
          {/* a refusal (403: a Reporter typing the address) is not changed by trying again */}
          {!(load.problem.kind === "answer" && load.problem.status === 403) && (
            <div>
              <Button variant="secondary" onClick={() => void fetchList(true)}>
                {t("form.retry")}
              </Button>
            </div>
          )}
        </Stack>
      )}
      {load.status === "ready" && load.items.length === 0 && <p>{t("editions.none")}</p>}
      {load.status === "ready" && load.items.length > 0 && (
        <ul className="pg-stories__list" aria-label={t("editions.list", { publication: publicationName })}>
          {load.items.map((edition) => (
            <EditionItem key={edition.id} orgId={orgId} pubId={pubId} edition={edition} send={send} />
          ))}
        </ul>
      )}
    </Stack>
  );
}

type Sending =
  | { readonly state: "idle" }
  | { readonly state: "sending" }
  /** `counts`: the edition's counts when it was sent; the line goes once they change (it would no longer be true). */
  | { readonly state: "sent"; readonly stories: number; readonly counts: string }
  | { readonly state: "failed"; readonly problem: ApiProblem };

function EditionItem({
  orgId,
  pubId,
  edition,
  send,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly edition: PubEditionDto;
  readonly send: boolean;
}) {
  const editions = useEditions();
  const { t, language } = useI18n();
  const [sending, setSending] = useState<Sending>({ state: "idle" });
  const date = formatDate(edition.date, language);
  const { counts } = edition;
  const countsNow = counts ? `${counts.stories}/${counts.ready}/${counts.spiked}` : "";
  const details = [
    t("editions.pages", { count: edition.pages }),
    ...(edition.backPageAds ? [t("editions.backPageAds")] : []),
    ...(edition.volume ? [t("editions.volume", { volume: edition.volume })] : []),
    ...(edition.issue ? [t("editions.issue", { issue: edition.issue })] : []),
    ...(edition.price ? [t("editions.price", { price: edition.price })] : []),
  ];
  const sendToDesk = async () => {
    setSending({ state: "sending" });
    const result = await editions.deskBundle({ orgId, pubId, editionId: edition.id });
    if (!result.ok) return setSending({ state: "failed", problem: result.error });
    saveFile(result.value.file, result.value.filename);
    setSending({ state: "sent", stories: result.value.stories, counts: countsNow });
  };
  const busy = sending.state === "sending";
  return (
    <li className="pg-stories__card">
      <Stack gap="2">
        <h2 className="pg-type-section-title">{date}</h2>
        <p className="pg-type-body-small pg-stories__meta">{details.join(" · ")}</p>
        {counts && (
          <p className="pg-type-body-small">{t("editions.counts", { stories: counts.stories, ready: counts.ready, spiked: counts.spiked })}</p>
        )}
        <p>
          <Link to={`${paths.pubStories(orgId, pubId)}?edition=${encodeURIComponent(edition.id)}`}>{t("editions.stories", { date })}</Link>
        </p>
        {send && counts && (
          <Stack gap="2">
            {counts.ready === 0 ? (
              <p>{t("editions.send.nothingReady")}</p>
            ) : (
              <div>
                <Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => void sendToDesk()}>
                  {t("editions.send")}
                </Button>
              </div>
            )}
            {counts.spiked > 0 && <p className="pg-type-body-small">{t("editions.send.spiked", { count: counts.spiked })}</p>}
            <div aria-live="polite">
              {busy && <p>{t("editions.sending")}</p>}
              {sending.state === "sent" && sending.counts === countsNow && <p>{sending.stories > 0 ? t("editions.send.done", { count: sending.stories }) : t("editions.send.empty")}</p>}
            </div>
            {sending.state === "failed" && (
              <Stack gap="2">
                <ProblemMessage problem={sending.problem} />
                {sending.problem.kind === "answer" && sending.problem.code === "bundle_refused" && sending.problem.details && (
                  <ul lang="en">
                    {sending.problem.details.map((detail) => (
                      <li key={detail.field}>{detail.message}</li>
                    ))}
                  </ul>
                )}
              </Stack>
            )}
          </Stack>
        )}
      </Stack>
    </li>
  );
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function CreateEdition({ orgId, pubId, onMade }: { readonly orgId: string; readonly pubId: string; readonly onMade: () => void }) {
  const editions = useEditions();
  const { t, language } = useI18n();
  const [date, setDate] = useState(today);
  /** The person chose the date; until then the default is today's when the form is used (past midnight IST too). */
  const dateChosen = useRef(false);
  const freshenDate = () => {
    if (!dateChosen.current) setDate(today());
  };
  const [pages, setPages] = useState<EditionInputDto["pages"]>(8);
  const [backPageAds, setBackPageAds] = useState(true);
  const [volume, setVolume] = useState("");
  const [issue, setIssue] = useState("");
  const [price, setPrice] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const [dateError, setDateError] = useState(false);
  /** The request sent without a known answer: a retry of the same edition sends the same key. */
  const sent = useRef<{ readonly body: string; readonly key: string } | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setMade(null);
    setProblem(null);
    const day = dateChosen.current ? date : today();
    if (day !== date) setDate(day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setDateError(true);
    setDateError(false);
    const input: EditionInputDto = {
      date: day,
      pages,
      backPageAds,
      ...(volume.trim() ? { volume: volume.trim() } : {}),
      ...(issue.trim() ? { issue: issue.trim() } : {}),
      ...(price.trim() ? { price: price.trim() } : {}),
    };
    const body = JSON.stringify(input);
    const key = sent.current?.body === body ? sent.current.key : randomUuid();
    sent.current = { body, key };
    setPending(true);
    const result = await editions.create({ orgId, pubId, input, idempotencyKey: key });
    setPending(false);
    if (!result.ok) {
      if (!unknownOutcome(result.error)) sent.current = null;
      return setProblem(result.error);
    }
    sent.current = null;
    setMade(formatDate(result.value.date, language));
    onMade();
  };
  const existing =
    problem?.kind === "answer" && problem.code === "edition_exists" && problem.current
      ? (problem.current as PubEditionDto)
      : null;

  return (
    <section aria-labelledby="pg-editions-create">
      <Stack gap="3">
        <h2 id="pg-editions-create" className="pg-type-section-title">
          {t("editions.create.heading")}
        </h2>
        <form className="pg-stories__filters" onSubmit={(event) => void submit(event)} onFocus={freshenDate} noValidate>
          <Field label={t("editions.create.date")} required requiredLabel={t("form.required")} {...(dateError ? { errors: [t("editions.create.dateRequired")] } : {})}>
            <TextInput
              type="date"
              value={date}
              onChange={(event) => {
                dateChosen.current = true;
                setDate(event.target.value);
              }}
            />
          </Field>
          <Field label={t("glossary.pages")}>
            <Select value={String(pages)} onChange={(event) => setPages(Number(event.target.value) as EditionInputDto["pages"])}>
              {EDITION_PAGES.map((count) => (
                <option key={count} value={count}>
                  {count}
                </option>
              ))}
            </Select>
          </Field>
          <Checkbox label={t("editions.backPageAds")} checked={backPageAds} onChange={(event) => setBackPageAds(event.target.checked)} />
          <Field label={t("editions.create.volume")}>
            <TextInput value={volume} maxLength={200} onChange={(event) => setVolume(event.target.value)} />
          </Field>
          <Field label={t("editions.create.issue")}>
            <TextInput value={issue} maxLength={200} onChange={(event) => setIssue(event.target.value)} />
          </Field>
          <Field label={t("editions.create.price")}>
            <TextInput value={price} maxLength={200} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>
            {pending ? t("editions.create.creating") : t("editions.create.submit")}
          </Button>
        </form>
        <div aria-live="polite">{made && <p>{t("editions.create.done", { date: made })}</p>}</div>
        {existing ? (
          <InlineMessage variant="error" heading={t("editions.create.exists", { date: formatDate(existing.date, language) })} live iconLabel={t("message.error")}>
            <Link to={`${paths.pubStories(orgId, pubId)}?edition=${encodeURIComponent(existing.id)}`}>
              {t("editions.stories", { date: formatDate(existing.date, language) })}
            </Link>
          </InlineMessage>
        ) : (
          problem && <ProblemMessage problem={problem} />
        )}
      </Stack>
    </section>
  );
}
