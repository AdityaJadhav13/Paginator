/**
 * Editions, /org/:orgId/pub/:pubId/editions (plan §1 L2.1 "minimal editions", §10 PR 21 and PR 24): the publication's
 * editions, newest first, each with its pages, its stories counted (all, Ready, spiked) and a link to its stories.
 * "Create edition" (date, 4/8/16 pages, back-page ads, volume, issue, price) for a full edition.create, with one
 * Idempotency-Key per edition asked for, the same on a retry after no answer. "Send to the Desk" for a full
 * desk.export: the edition's Ready stories as a story bundle, saved as a file; spiked stories are never sent.
 *
 * Master and detail (02 §3.5): a table of the editions on the start side, the chosen one's detail beside it (under it on
 * a phone), "Send to the Desk" its primary action; "Create edition" is the page's, and opens a side sheet. A live change
 * to an edition or a story of this publication (or a `resync`) fetches the list again in place: the rows are the
 * editions themselves, and only their counts move.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { EDITION_PAGES } from "@pageinator/contracts";
import {
  Badge,
  Button,
  Checkbox,
  Drawer,
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
import { randomUuid } from "../../api/client.ts";
import { formatDate } from "../../i18n/dates.ts";
import { useI18n, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, EditionInputDto, PubEditionDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { mayCreateEdition, mayExport } from "../stories/access.ts";
import { layoutAccess } from "../layout/access.ts";
import { useEditions } from "./editions-context.tsx";
import "./editions.css";

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

/** The request sent without a known answer: a retry of the same edition sends the same key (kept while the sheet is shut). */
type Sent = MutableRefObject<{ readonly body: string; readonly key: string } | null>;

export function EditionsScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  // the Overview's "Create today's edition" opens the sheet (?create=1)
  const [search] = useSearchParams();
  const [creating, setCreating] = useState(() => search.get("create") === "1");
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  const create = open && mayCreateEdition(org, pubId);
  return (
    <Stack gap="5">
      <PageHeader
        title={t("nav.editions")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
        {...(create
          ? {
              actions: (
                <Button variant="primary" onClick={() => setCreating(true)}>
                  <Icon name="plus" size={16} />
                  {t("editions.create.submit")}
                </Button>
              ),
            }
          : {})}
      />
      <OfflineNotice />
      {open && (
        <EditionsContent
          orgId={orgId}
          pubId={pubId}
          publicationName={publication?.name ?? ""}
          create={create}
          send={mayExport(org, pubId)}
          layout={layoutAccess(org, pubId).view}
          creating={creating}
          onCreating={setCreating}
        />
      )}
    </Stack>
  );
}

/** The edition's state for the desk, as a badge: never colour alone, the word says it. */
function ReadyBadge({ counts, t }: { readonly counts: PubEditionDto["counts"]; readonly t: Translate }) {
  if (!counts) return null;
  if (counts.ready > 0)
    return (
      <Badge tone="success" icon="circle-check">
        {t("editions.status.ready", { count: counts.ready })}
      </Badge>
    );
  return (
    <Badge tone="neutral" icon="clock">
      {counts.stories === 0 ? t("editions.status.empty") : t("editions.status.notReady")}
    </Badge>
  );
}

function EditionsContent({
  orgId,
  pubId,
  publicationName,
  create,
  send,
  layout,
  creating,
  onCreating,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly publicationName: string;
  readonly create: boolean;
  readonly send: boolean;
  readonly layout: boolean;
  readonly creating: boolean;
  readonly onCreating: (open: boolean) => void;
}) {
  const editions = useEditions();
  const { t, language } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [chosen, setChosen] = useState<string | null>(null);
  const [made, setMade] = useState<string | null>(null);
  const sent: Sent = useRef(null);

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

  const items = load.status === "ready" ? load.items : [];
  // the chosen edition, or the newest while none is chosen (or the chosen one is gone)
  const selected = items.find((edition) => edition.id === chosen) ?? items[0];
  const anyCounts = items.some((edition) => edition.counts);

  return (
    <Stack gap="5">
      {create && (
        <Drawer
          open={creating}
          onClose={() => onCreating(false)}
          title={t("editions.create.heading")}
          closeLabel={t("shell.closeDialog")}
        >
          <CreateEdition
            orgId={orgId}
            pubId={pubId}
            sent={sent}
            onMade={(edition) => {
              setMade(formatDate(edition.date, language));
              setChosen(edition.id);
              onCreating(false);
              void fetchList(true);
            }}
          />
        </Drawer>
      )}
      <div aria-live="polite">
        {made && <p className="pg-editions__made">{t("editions.create.done", { date: made })}</p>}
      </div>
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
      {load.status === "ready" && items.length === 0 && (
        <Panel>
          <EmptyState icon="newspaper" heading={t("editions.none")}>
            {create ? t("editions.none.create") : t("editions.none.wait")}
          </EmptyState>
        </Panel>
      )}
      {selected && (
        <div className="pg-editions">
          <Panel flush className="pg-editions__master">
            <Table caption={t("editions.list", { publication: publicationName })}>
              <thead>
                <tr>
                  <TableHeader>{t("editions.create.date")}</TableHeader>
                  <TableHeader numeric>{t("glossary.pages")}</TableHeader>
                  {anyCounts && <TableHeader>{t("editions.col.status")}</TableHeader>}
                  {anyCounts && <TableHeader numeric>{t("glossary.stories")}</TableHeader>}
                </tr>
              </thead>
              <tbody>
                {items.map((edition) => {
                  const on = edition.id === selected.id;
                  return (
                    <tr
                      key={edition.id}
                      className={on ? "pg-table__row--selected" : undefined}
                      onClick={() => setChosen(edition.id)}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="pg-editions__select"
                          aria-pressed={on}
                          onClick={() => setChosen(edition.id)}
                        >
                          {formatDate(edition.date, language)}
                        </button>
                      </TableCell>
                      <TableCell numeric>{edition.pages}</TableCell>
                      {anyCounts && (
                        <TableCell>
                          <ReadyBadge counts={edition.counts} t={t} />
                        </TableCell>
                      )}
                      {anyCounts && <TableCell numeric>{edition.counts?.stories}</TableCell>}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Panel>
          <EditionDetail key={selected.id} orgId={orgId} pubId={pubId} edition={selected} send={send} layout={layout} />
        </div>
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

function EditionDetail({
  orgId,
  pubId,
  edition,
  send,
  layout,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly edition: PubEditionDto;
  readonly send: boolean;
  readonly layout: boolean;
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
  const sendable = send && counts && counts.ready > 0;
  return (
    <Panel
      title={date}
      className="pg-editions__detail"
      {...(sendable
        ? {
            actions: (
              <Button variant="primary" disabled={busy} aria-busy={busy} onClick={() => void sendToDesk()}>
                <Icon name="send" size={16} />
                {t("editions.send")}
              </Button>
            ),
          }
        : {})}
    >
      <Stack gap="4">
        <div className="pg-editions__summary">
          <ReadyBadge counts={counts} t={t} />
          <p className="pg-editions__meta">{details.join(" · ")}</p>
        </div>
        {counts && (
          <p className="pg-editions__counts">
            {t("editions.counts", { stories: counts.stories, ready: counts.ready, spiked: counts.spiked })}
          </p>
        )}
        {send && counts && (
          <Stack gap="2">
            {counts.ready === 0 && <p>{t("editions.send.nothingReady")}</p>}
            {counts.spiked > 0 && (
              <p className="pg-editions__meta">{t("editions.send.spiked", { count: counts.spiked })}</p>
            )}
            <div aria-live="polite">
              {busy && <p>{t("editions.sending")}</p>}
              {sending.state === "sent" && sending.counts === countsNow && (
                <p>
                  {sending.stories > 0 ? t("editions.send.done", { count: sending.stories }) : t("editions.send.empty")}
                </p>
              )}
            </div>
            {sending.state === "failed" && (
              <Stack gap="2">
                <ProblemMessage problem={sending.problem} />
                {sending.problem.kind === "answer" &&
                  sending.problem.code === "bundle_refused" &&
                  sending.problem.details && (
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
        <p>
          <Link
            className="pg-editions__link"
            to={`${paths.pubStories(orgId, pubId)}?edition=${encodeURIComponent(edition.id)}`}
          >
            <Icon name="file-text" size={16} />
            {t("editions.stories", { date })}
          </Link>
        </p>
        {layout && (
          <p>
            <Link className="pg-editions__link" to={paths.pubEditionLayout(orgId, pubId, edition.id)}>
              <Icon name="layout-template" size={16} />
              {t("editionLayout.open")}
            </Link>
          </p>
        )}
      </Stack>
    </Panel>
  );
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

function CreateEdition({
  orgId,
  pubId,
  sent,
  onMade,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly sent: Sent;
  readonly onMade: (edition: PubEditionDto) => void;
}) {
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
  const [dateError, setDateError] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
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
    onMade(result.value);
  };
  const existing =
    problem?.kind === "answer" && problem.code === "edition_exists" && problem.current
      ? (problem.current as PubEditionDto)
      : null;

  return (
    <Stack gap="4">
      <form className="pg-editions__form" onSubmit={(event) => void submit(event)} onFocus={freshenDate} noValidate>
        <Field
          label={t("editions.create.date")}
          required
          requiredLabel={t("form.required")}
          {...(dateError ? { errors: [t("editions.create.dateRequired")] } : {})}
        >
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
          <Select
            value={String(pages)}
            onChange={(event) => setPages(Number(event.target.value) as EditionInputDto["pages"])}
          >
            {EDITION_PAGES.map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          label={t("editions.backPageAds")}
          checked={backPageAds}
          onChange={(event) => setBackPageAds(event.target.checked)}
        />
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
      {existing ? (
        <InlineMessage
          variant="error"
          heading={t("editions.create.exists", { date: formatDate(existing.date, language) })}
          live
          iconLabel={t("message.error")}
        >
          <Link to={`${paths.pubStories(orgId, pubId)}?edition=${encodeURIComponent(existing.id)}`}>
            {t("editions.stories", { date: formatDate(existing.date, language) })}
          </Link>
        </InlineMessage>
      ) : (
        problem && <ProblemMessage problem={problem} />
      )}
    </Stack>
  );
}
