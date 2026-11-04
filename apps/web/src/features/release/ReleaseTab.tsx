/**
 * The edition's Release tab (docs/product/10-l2-newsroom-plan.md §1 L2.5; doc 06 §9.2-9.3), from GET
 * …/editions/:e/release (pages.view), fetched again on the edition's live `layout` hint, as the layout is:
 *   - the preflight list: only the checks the API runs, each passed, failed or a warning in words;
 *   - the pages: each one's independent PDF/X-1a check, its approval (page.approve, bound to the revision and SHA-256
 *     shown) or "Unlock" (page.unlock);
 *   - the G2 press test: pages with photos or ads have not been press-tested, and a release waits for the evidence
 *     (recorded by settings.edit);
 *   - the release: the candidate's files and "Approve release" (release.approve; a correction also release.correct),
 *     posting exactly the files shown;
 *   - the releases, newest first: their files by a 5-minute link (export.press), "Mark as sent", the press's
 *     confirmation, and the archive copy's check (archive.view). A release stays listed after a correction.
 * Nothing here says "press-ready" or "PDF/X-valid" (CONTRACT.md §5). Each control shows only for those the API allows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  Badge,
  Button,
  Cluster,
  Dialog,
  Field,
  InlineMessage,
  Panel,
  ProgressIndicator,
  Stack,
  Table,
  TableCell,
  TableHeader,
  TextArea,
  TextInput,
  type BadgeTone,
  type IconName,
} from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n, type PlainKey } from "../../i18n/index.ts";
import type {
  ApiProblem,
  ArchiveCheckDto,
  EditionReleaseDto,
  PreflightItemDto,
  ReleaseItemDto,
  ReleasePageDto,
  PubEditionDto,
} from "../../services/index.ts";
import { useEditions } from "../editions/editions-context.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import type { LayoutAccess } from "../layout/access.ts";
import { DeskWords } from "../layout/desk-text.tsx";
import { CheckBadge, follow, roleText } from "../layout/layout-words.tsx";
import { useRelease } from "./release-context.tsx";
import "./release.css";

interface Where {
  readonly orgId: string;
  readonly pubId: string;
  readonly editionId: string;
}

export type ReleaseLoad =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly value: EditionReleaseDto };

/** The edition's release view, fetched again on its live `layout` hint, a story or edition of the publication, or a
 * resync (as the layout is). */
export function useEditionRelease({ orgId, pubId, editionId }: Where): {
  readonly load: ReleaseLoad;
  readonly refresh: () => void;
} {
  const release = useRelease();
  const [load, setLoad] = useState<ReleaseLoad>({ status: "loading" });
  const ask = useRef(0);
  const fetchRelease = useCallback(
    async (live: boolean) => {
      const mine = ++ask.current;
      const result = await release.get({ orgId, pubId, editionId });
      if (mine !== ask.current) return; // a newer answer is on its way
      setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error, live });
    },
    [release, orgId, pubId, editionId],
  );
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchRelease(false);
  }, [fetchRelease]);
  useLiveEvents((event) => {
    const here =
      (event.type === "layout" && event.editionId === editionId) ||
      ((event.type === "story" || event.type === "edition") && event.publicationId === pubId);
    if (here || event.type === "resync") void fetchRelease(true);
  });
  return { load, refresh: useCallback(() => void fetchRelease(true), [fetchRelease]) };
}

const isStale = (problem: ApiProblem) => problem.kind === "answer" && problem.code === "approval_stale";
/** No answer came, or the server failed: the release may have been made, so a retry keeps the key. */
const unknownOutcome = (problem: ApiProblem) =>
  problem.kind !== "answer" || (problem.status >= 500 && problem.code !== "archive_failed");
/** Exact byte counts: Marathi groups digits the Indian way (Latin digits, as the app's dates); English in thousands. */
const bytes = (n: number, language: string) => new Intl.NumberFormat(language === "mr" ? "en-IN" : "en").format(n);

// ------------------------------------------------------------------------------------------------ a page's approval

/** A page's approval: who approved it and when, or "Approve" (bound to the revision and bytes shown) and "Unlock". */
export function PageApproval({
  where,
  page,
  access,
  onChanged,
}: {
  readonly where: { readonly orgId: string; readonly pubId: string };
  readonly page: ReleasePageDto;
  readonly access: LayoutAccess;
  readonly onChanged: () => void;
}) {
  const release = useRelease();
  const { t, language } = useI18n();
  const at = { orgId: where.orgId, pubId: where.pubId, runId: page.runId, page: page.page };
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const act = async (call: () => Promise<{ ok: true } | { ok: false; error: ApiProblem }>) => {
    setBusy(true);
    setProblem(null);
    setChanged(false);
    const result = await call();
    setBusy(false);
    if (!result.ok) {
      if (isStale(result.error)) setChanged(true);
      else setProblem(result.error);
    }
    onChanged();
  };
  const why = !page.pdfSha256
    ? t("editionRelease.page.noPdf")
    : page.needsSave
      ? t("editionRelease.page.needsSave")
      : !page.check
        ? t("editionRelease.page.notChecked")
        : null;
  const { approval } = page;
  return (
    <Stack gap="2">
      <div>
        {approval ? (
          <Badge tone="success" icon="badge-check">
            {t("editionRelease.page.approved", { name: approval.by.name, time: formatDateTime(approval.at, language) })}
          </Badge>
        ) : (
          <Badge tone="neutral" icon="clock">
            {t("editionRelease.page.notApproved")}
          </Badge>
        )}
      </div>
      {!approval && why && <p className="pg-layout__note">{why}</p>}
      {access.approve && !approval && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !!why}
            aria-label={t("editionRelease.page.approveN", { page: page.page })}
            onClick={() => void act(() => release.approvePage({ ...at, rev: page.rev, pdfSha256: page.pdfSha256! }))}
          >
            {t("editionRelease.page.approve")}
          </Button>
        </div>
      )}
      {access.unlock && approval && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            aria-label={t("editionRelease.page.unlockN", { page: page.page })}
            onClick={() => void act(() => release.unlockPage(at))}
          >
            {t("editionRelease.page.unlock")}
          </Button>
        </div>
      )}
      <div aria-live="polite">{changed && <p className="pg-layout__note">{t("editionRelease.page.changed")}</p>}</div>
      {problem && <ProblemMessage problem={problem} />}
    </Stack>
  );
}

// ------------------------------------------------------------------------------------------------ the tab

export function ReleaseTab({
  where,
  load,
  access,
  onRefresh,
  onTab,
  edition,
}: {
  readonly where: Where;
  readonly load: ReleaseLoad;
  /** the edition's folio (volume, issue number, price), set here by a full edition.edit */
  readonly edition?: PubEditionDto | undefined;
  readonly access: LayoutAccess;
  readonly onRefresh: () => void;
  readonly onTab: (tab: "pages" | "ads") => void;
}) {
  const { t } = useI18n();
  if (load.status === "loading") return <ProgressIndicator role="status" label={t("editionRelease.loading")} />;
  if (load.status === "failed") {
    return (
      <Stack gap="3">
        <ProblemMessage problem={load.problem} live={load.live} />
        <div>
          <Button variant="secondary" onClick={onRefresh}>
            {t("form.retry")}
          </Button>
        </div>
      </Stack>
    );
  }
  const data = load.value;
  return (
    <Stack gap="5" className="pg-release">
      <Preflight where={where} data={data} access={access} onTab={onTab} edition={edition} onChanged={onRefresh} />
      <PagesPanel where={where} data={data} access={access} onChanged={onRefresh} />
      {(data.needsPressTest || data.pressTest || access.settingsEdit) && (
        <PressTestPanel where={where} data={data} access={access} onChanged={onRefresh} />
      )}
      <Candidate where={where} data={data} access={access} onChanged={onRefresh} />
      <Releases where={where} data={data} access={access} onChanged={onRefresh} />
    </Stack>
  );
}

const CHECK: Readonly<Record<PreflightItemDto["check"], PlainKey>> = {
  laid_out: "editionRelease.check.laid_out",
  pdf_check: "editionRelease.check.pdf_check",
  saved: "editionRelease.check.saved",
  placement: "editionRelease.check.placement",
  folio: "editionRelease.check.folio",
  ad_artwork: "editionRelease.check.ad_artwork",
  approved: "editionRelease.check.approved",
  press_test: "editionRelease.check.press_test",
  not_placed: "editionRelease.check.not_placed",
};
const STATE: Readonly<Record<PreflightItemDto["state"], readonly [PlainKey, BadgeTone, IconName]>> = {
  passed: ["editionRelease.state.passed", "success", "circle-check"],
  failed: ["editionRelease.state.failed", "danger", "circle-x"],
  warning: ["editionRelease.state.warning", "warning", "triangle-alert"],
};

function Preflight({
  where,
  data,
  access,
  onTab,
  edition,
  onChanged,
}: {
  readonly where: Where;
  readonly data: EditionReleaseDto;
  readonly access: LayoutAccess;
  readonly onTab: (tab: "pages" | "ads") => void;
  readonly edition: PubEditionDto | undefined;
  readonly onChanged: () => void;
}) {
  const { t } = useI18n();
  const { orgId, pubId, editionId } = where;
  const { runId } = data;
  return (
    <Panel title={t("editionRelease.preflight.heading")}>
      <Stack gap="3">
        <p>{data.preflight.passed ? t("editionRelease.preflight.passed") : t("editionRelease.preflight.failed")}</p>
        <ul className="pg-release__checks">
          {data.preflight.items.map((item) => {
            const [stateKey, tone, icon] = STATE[item.state];
            return (
              <li key={item.check}>
                <div className="pg-layout__status">
                  <Badge tone={tone} icon={icon}>
                    {t(stateKey)}
                  </Badge>
                  <span>{t(CHECK[item.check])}</span>
                </div>
                {/* the folio is the edition's issue number, set here, not on a page */}
                {item.check === "folio" &&
                  (access.editionEdit && edition ? (
                    <Folio where={where} edition={edition} open={item.state === "failed"} onChanged={onChanged} />
                  ) : (
                    item.state === "failed" && <p className="pg-layout__note">{t("editionRelease.folio.ask")}</p>
                  ))}
                {item.printsOld && (
                  <p className="pg-layout__note">
                    {t(
                      item.check === "folio"
                        ? "editionRelease.check.printsOldFolio"
                        : "editionRelease.check.printsOldArtwork",
                    )}
                  </p>
                )}
                {/* a folio fixed on the edition needs no page; one page 1 prints from before does */}
                {item.pages.length > 0 && (item.check !== "folio" || item.printsOld) && (
                  <div className="pg-layout__status">
                    <span className="pg-layout__note">{t("editionRelease.check.pages")}</span>
                    {item.pages.map((page) =>
                      access.edit && runId ? (
                        <Link
                          key={page}
                          to={paths.pubPageEditor(orgId, pubId, editionId, runId, page)}
                          aria-label={t("pageEditor.editPage", { page })}
                        >
                          {page}
                        </Link>
                      ) : (
                        <span key={page}>{page}</span>
                      ),
                    )}
                    <Button variant="quiet" size="sm" onClick={() => onTab("pages")}>
                      {t("editionRelease.check.seePages")}
                    </Button>
                  </div>
                )}
                {item.slots.length > 0 && (
                  <div className="pg-layout__status">
                    <span className="pg-layout__note">
                      {t("editionRelease.check.slots", { slots: item.slots.join(", ") })}
                    </span>
                    <Button variant="quiet" size="sm" onClick={() => onTab("ads")}>
                      {t("editionRelease.check.seeAds")}
                    </Button>
                  </div>
                )}
                {item.stories.length > 0 && (
                  <ul className="pg-layout__list">
                    {item.stories.map((story) => (
                      <li key={story.deskKey}>
                        {story.storyId ? (
                          <Link to={paths.pubStory(orgId, pubId, story.storyId)}>
                            {story.headline || t("editionLayout.untitled")}
                          </Link>
                        ) : (
                          <span>{story.headline || t("editionLayout.untitled")}</span>
                        )}
                        {story.reason && (
                          <span className="pg-layout__note">
                            <DeskWords text={story.reason} />
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Stack>
    </Panel>
  );
}

/** The edition's volume, issue number and price (PATCH …/editions/:e, a full edition.edit); the checks run again. */
function Folio({
  where,
  edition,
  open,
  onChanged,
}: {
  readonly where: Where;
  readonly edition: PubEditionDto;
  readonly open: boolean;
  readonly onChanged: () => void;
}) {
  const editions = useEditions();
  const { t } = useI18n();
  const [volume, setVolume] = useState(edition.volume);
  const [issue, setIssue] = useState(edition.issue);
  const [price, setPrice] = useState(edition.price);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const save = async () => {
    setBusy(true);
    setSaved(false);
    setProblem(null);
    const result = await editions.update({
      orgId: where.orgId,
      pubId: where.pubId,
      editionId: where.editionId,
      patch: { volume: volume.trim(), issue: issue.trim(), price: price.trim() },
    });
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    setSaved(true);
    onChanged();
  };
  return (
    <details open={open}>
      <summary>{t("editionRelease.folio.heading")}</summary>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Stack gap="3">
          <Field label={t("editions.create.volume")}>
            <TextInput value={volume} maxLength={200} onChange={(event) => setVolume(event.target.value)} />
          </Field>
          <Field label={t("editions.create.issue")}>
            <TextInput value={issue} maxLength={200} onChange={(event) => setIssue(event.target.value)} />
          </Field>
          <Field label={t("editions.create.price")}>
            <TextInput value={price} maxLength={200} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          <div>
            <Button type="submit" variant="secondary" size="sm" disabled={busy} aria-busy={busy}>
              {t("editionRelease.folio.save")}
            </Button>
          </div>
          <div aria-live="polite">{saved && <p className="pg-layout__note">{t("editionRelease.folio.saved")}</p>}</div>
          {problem && <ProblemMessage problem={problem} />}
        </Stack>
      </form>
    </details>
  );
}

function PagesPanel({
  where,
  data,
  access,
  onChanged,
}: {
  readonly where: Where;
  readonly data: EditionReleaseDto;
  readonly access: LayoutAccess;
  readonly onChanged: () => void;
}) {
  const { t } = useI18n();
  if (data.pages.length === 0) {
    return (
      <Panel title={t("editionRelease.pages.heading")}>
        <p>{t("editionRelease.pages.none")}</p>
      </Panel>
    );
  }
  const role = (r: string) => (r === "front" || r === "inside" || r === "back" ? roleText(r, t) : r);
  return (
    <Panel title={t("editionRelease.pages.heading")} flush>
      <Table caption={t("editionRelease.pages.heading")}>
        <thead>
          <tr>
            <TableHeader>{t("editionRelease.pages.page")}</TableHeader>
            <TableHeader>{t("editionRelease.pages.check")}</TableHeader>
            <TableHeader>{t("editionRelease.pages.approval")}</TableHeader>
            <TableHeader>{t("editionRelease.pages.released")}</TableHeader>
          </tr>
        </thead>
        <tbody>
          {data.pages.map((page) => (
            <tr key={page.page}>
              <TableCell>{t("editionLayout.page.title", { page: page.page, role: role(page.role) })}</TableCell>
              <TableCell>
                <CheckBadge check={page.check} t={t} />
              </TableCell>
              <TableCell>
                <PageApproval where={where} page={page} access={access} onChanged={onChanged} />
              </TableCell>
              <TableCell>
                {page.released ? (
                  <>
                    <span>{page.released.name}</span>
                    {page.released.changed && (
                      <p className="pg-layout__note">{t("editionRelease.pages.changedSince")}</p>
                    )}
                  </>
                ) : (
                  <span className="pg-layout__note">{t("editionRelease.pages.notReleased")}</span>
                )}
              </TableCell>
            </tr>
          ))}
        </tbody>
      </Table>
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ the press test

const SHA256 = /^[0-9a-f]{64}$/;

function PressTestPanel({
  where,
  data,
  access,
  onChanged,
}: {
  readonly where: Where;
  readonly data: EditionReleaseDto;
  readonly access: LayoutAccess;
  readonly onChanged: () => void;
}) {
  const release = useRelease();
  const { t, language } = useI18n();
  const [sha, setSha] = useState("");
  const [on, setOn] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<{ sha?: string; on?: string }>({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [saved, setSaved] = useState(false);
  const test = data.pressTest;
  const submit = async () => {
    const pageSha256 = sha.trim().toLowerCase();
    const found = {
      ...(SHA256.test(pageSha256) ? {} : { sha: t("editionRelease.press.shaInvalid") }),
      ...(on ? {} : { on: t("editionRelease.press.dateMissing") }),
    };
    setErrors(found);
    setSaved(false);
    if (found.sha || found.on) return;
    setBusy(true);
    setProblem(null);
    const result = await release.setPressTest({
      orgId: where.orgId,
      pubId: where.pubId,
      pageSha256,
      acceptedOn: on,
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    setSha("");
    setOn("");
    setNote("");
    setSaved(true);
    onChanged();
  };
  return (
    <Panel title={t("editionRelease.press.heading")}>
      <Stack gap="3">
        {data.needsPressTest && !test && (
          <InlineMessage variant="warning" heading={t("editionRelease.press.needed")} iconLabel={t("message.warning")}>
            {t("editionRelease.press.neededBody")}
          </InlineMessage>
        )}
        {!data.needsPressTest && <p className="pg-layout__note">{t("editionRelease.press.notNeeded")}</p>}
        {test && (
          <p className="pg-layout__note">
            {t("editionRelease.press.recorded", {
              name: test.recordedBy.name,
              time: formatDateTime(test.recordedAt, language),
            })}
          </p>
        )}
        {test ? (
          <dl className="pg-release__facts">
            <dt>{t("editionRelease.press.sha")}</dt>
            <dd>
              <code className="pg-release__hash">{test.pageSha256}</code>
            </dd>
            <dt>{t("editionRelease.press.acceptedOn")}</dt>
            <dd>{formatDate(test.acceptedOn, language)}</dd>
            {test.note && (
              <>
                <dt>{t("editionRelease.press.note")}</dt>
                <dd>{test.note}</dd>
              </>
            )}
          </dl>
        ) : (
          <p>{t("editionRelease.press.none")}</p>
        )}
        {access.settingsEdit && (
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Stack gap="3">
              <h3 className="pg-layout__subhead">
                {test ? t("editionRelease.press.replace") : t("editionRelease.press.record")}
              </h3>
              <Field label={t("editionRelease.press.sha")} {...(errors.sha ? { errors: [errors.sha] } : {})}>
                <TextInput value={sha} spellCheck={false} onChange={(event) => setSha(event.target.value)} />
              </Field>
              <Field label={t("editionRelease.press.acceptedOn")} {...(errors.on ? { errors: [errors.on] } : {})}>
                <TextInput type="date" value={on} onChange={(event) => setOn(event.target.value)} />
              </Field>
              <Field label={t("editionRelease.noteOptional")}>
                <TextArea value={note} rows={2} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
              </Field>
              <div>
                <Button type="submit" variant="secondary" disabled={busy} aria-busy={busy}>
                  {t("editionRelease.press.save")}
                </Button>
              </div>
              <div aria-live="polite">
                {saved && <p className="pg-layout__note">{t("editionRelease.press.saved")}</p>}
              </div>
              {problem && <ProblemMessage problem={problem} />}
            </Stack>
          </form>
        )}
      </Stack>
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ the candidate

function Candidate({
  where,
  data,
  access,
  onChanged,
}: {
  readonly where: Where;
  readonly data: EditionReleaseDto;
  readonly access: LayoutAccess;
  readonly onChanged: () => void;
}) {
  const release = useRelease();
  const { t, language } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const key = useRef<string | null>(null);
  const { candidate } = data;
  // a retry keeps its key only for the same body: a new note or new files is a new request
  const body = `${note.trim()}|${candidate?.files.map((file) => `${file.page}:${file.sha256}`).join() ?? ""}`;
  useEffect(() => {
    key.current = null;
  }, [body]);
  if (!candidate) {
    return (
      <Panel title={t("editionRelease.candidate.heading")}>
        <Stack gap="3">
          <div aria-live="polite">{changed && <p>{t("editionRelease.candidate.changed")}</p>}</div>
          <p>
            {data.releases.length
              ? t("editionRelease.candidate.nothingChanged")
              : t("editionRelease.candidate.nothing")}
          </p>
        </Stack>
      </Panel>
    );
  }
  const correction = candidate.kind === "correction";
  const count = candidate.files.length;
  const one = count === 1;
  const refused = problem?.kind === "answer" && problem.code === "release_refused" ? (problem.details ?? []) : [];
  /** A refusal's reason in the reader's words: the failed check (and its pages), or nothing to release. */
  const reason = (field: string) => {
    if (field === "nothing_to_release") return t("editionRelease.candidate.nothingChanged");
    const check = field.replace(/^preflight\./, "") as PreflightItemDto["check"];
    if (!field.startsWith("preflight.") || !Object.hasOwn(CHECK, check)) return null;
    const pages = data.preflight.items.find((item) => item.check === check)?.pages ?? [];
    return pages.length
      ? t("editionRelease.candidate.refusedPages", { check: t(CHECK[check]), pages: pages.join(", ") })
      : t(CHECK[check]);
  };
  const may = access.release && (!correction || access.correct);
  const approve = async () => {
    setAsking(false);
    setBusy(true);
    setProblem(null);
    setChanged(false);
    key.current ??= randomUuid();
    const result = await release.create({
      ...where,
      files: candidate.files.map((file) => ({ page: file.page, sha256: file.sha256 })),
      ...(note.trim() ? { note: note.trim() } : {}),
      idempotencyKey: key.current,
    });
    setBusy(false);
    if (result.ok || !unknownOutcome(result.error)) key.current = null;
    if (result.ok) setNote("");
    else if (isStale(result.error)) setChanged(true);
    else setProblem(result.error);
    onChanged();
  };
  return (
    <Panel title={t("editionRelease.candidate.heading")}>
      <Stack gap="3">
        <p>
          {correction
            ? t(one ? "editionRelease.candidate.correction.one" : "editionRelease.candidate.correction", { count })
            : t(one ? "editionRelease.candidate.release.one" : "editionRelease.candidate.release", { count })}
        </p>
        <Table caption={t("editionRelease.candidate.files")}>
          <thead>
            <tr>
              <TableHeader>{t("editionRelease.file.name")}</TableHeader>
              <TableHeader numeric>{t("editionRelease.file.rev")}</TableHeader>
              <TableHeader>{t("editionRelease.file.sha")}</TableHeader>
              <TableHeader numeric>{t("editionRelease.file.bytes")}</TableHeader>
            </tr>
          </thead>
          <tbody>
            {candidate.files.map((file) => (
              <tr key={file.name}>
                <TableCell>
                  <span>{file.name}</span>
                  {file.replaces && (
                    <p className="pg-layout__note">{t("editionRelease.file.replaces", { name: file.replaces })}</p>
                  )}
                </TableCell>
                <TableCell numeric>{file.rev}</TableCell>
                <TableCell>
                  <code className="pg-release__hash">{file.sha256}</code>
                </TableCell>
                <TableCell numeric>{bytes(file.bytes, language)}</TableCell>
              </tr>
            ))}
          </tbody>
        </Table>
        <div aria-live="polite">{changed && <p>{t("editionRelease.candidate.changed")}</p>}</div>
        {problem &&
          (refused.length > 0 ? (
            // the reasons sit inside the alert, so a screen reader hears them with the heading
            <div role="alert">
              <ProblemMessage problem={problem} live={false} />
              <ul className="pg-layout__list" aria-label={t("editionRelease.candidate.refusedWhy")}>
                {refused.map((detail) => {
                  const words = reason(detail.field);
                  return (
                    <li key={`${detail.field}-${detail.message}`} {...(words ? {} : { lang: "en" })}>
                      {words ?? detail.message}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <ProblemMessage problem={problem} />
          ))}
        {access.release && correction && !access.correct && (
          <p className="pg-layout__note">{t("editionRelease.candidate.correctionWho")}</p>
        )}
        {may && (
          <Stack gap="3">
            <Field label={t("editionRelease.noteOptional")}>
              <TextArea value={note} rows={2} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
            </Field>
            {!data.preflight.passed && <p className="pg-layout__note">{t("editionRelease.candidate.waits")}</p>}
            <div>
              <Button
                variant="primary"
                disabled={busy || !data.preflight.passed}
                aria-busy={busy}
                onClick={() => setAsking(true)}
              >
                {busy
                  ? t("editionRelease.candidate.approving")
                  : correction
                    ? t("editionRelease.candidate.approveCorrection")
                    : t("editionRelease.candidate.approve")}
              </Button>
            </div>
          </Stack>
        )}
      </Stack>
      {asking && (
        // it cannot be undone: the files are archived under lock
        <Dialog
          open
          onClose={() => setAsking(false)}
          title={t(
            correction ? "editionRelease.candidate.confirmTitleCorrection" : "editionRelease.candidate.confirmTitle",
          )}
          closeLabel={t("shell.closeDialog")}
        >
          <Stack gap="4">
            <p>
              {correction
                ? t(
                    one
                      ? "editionRelease.candidate.confirmCorrection.one"
                      : "editionRelease.candidate.confirmCorrection",
                    { count },
                  )
                : t(one ? "editionRelease.candidate.confirmRelease.one" : "editionRelease.candidate.confirmRelease", {
                    count,
                  })}
            </p>
            <Cluster gap="3">
              <Button variant="primary" onClick={() => void approve()}>
                {correction ? t("editionRelease.candidate.approveCorrection") : t("editionRelease.candidate.approve")}
              </Button>
              <Button variant="secondary" onClick={() => setAsking(false)}>
                {t("editionRelease.confirm.cancel")}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ the releases

function Releases({
  where,
  data,
  access,
  onChanged,
}: {
  readonly where: Where;
  readonly data: EditionReleaseDto;
  readonly access: LayoutAccess;
  readonly onChanged: () => void;
}) {
  const { t } = useI18n();
  return (
    <Panel title={t("editionRelease.releases.heading")}>
      {data.releases.length === 0 ? (
        <p>{t("editionRelease.releases.none")}</p>
      ) : (
        <Stack gap="4">
          {access.press && <p className="pg-layout__note">{t("editionRelease.releases.how")}</p>}
          <ul className="pg-release__releases">
            {data.releases.map((item) => (
              <li key={item.id}>
                <ReleaseItem where={where} item={item} access={access} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        </Stack>
      )}
    </Panel>
  );
}

function ReleaseItem({
  where,
  item,
  access,
  onChanged,
}: {
  readonly where: Where;
  readonly item: ReleaseItemDto;
  readonly access: LayoutAccess;
  readonly onChanged: () => void;
}) {
  const release = useRelease();
  const { t, language } = useI18n();
  const [getting, setGetting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [check, setCheck] = useState<ArchiveCheckDto | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const at = { orgId: where.orgId, pubId: where.pubId, releaseId: item.id };
  const title =
    item.kind === "correction"
      ? t("editionRelease.item.correction", { number: item.number })
      : t("editionRelease.item.release", { number: item.number });

  const download = async (name: string) => {
    setGetting(name);
    setProblem(null);
    const link = await release.fileLink({ ...at, name });
    setGetting(null);
    if (!link.ok) return setProblem(link.error);
    follow(link.value.url, name);
  };
  const sent = async () => {
    setBusy(true);
    setProblem(null);
    const result = await release.markSent({ ...at, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    setNote("");
    onChanged();
  };
  const verify = async () => {
    setBusy(true);
    setProblem(null);
    setCheck(null);
    const result = await release.verify(at);
    setBusy(false);
    if (!result.ok) return setProblem(result.error);
    setCheck(result.value);
  };

  return (
    <Panel title={title} headingLevel={3}>
      <Stack gap="3">
        <p className="pg-layout__note">
          {t("editionRelease.item.approvedBy", {
            name: item.approvedBy.name,
            time: formatDateTime(item.approvedAt, language),
          })}
        </p>
        {item.note && <p>{item.note}</p>}
        <p className="pg-layout__note">
          {t("editionRelease.item.archive", {
            until: formatDate(item.archive.retainUntil, language),
            time: formatDateTime(item.archive.verifiedAt, language),
          })}
        </p>
        <Table caption={t("editionRelease.item.files", { title })}>
          <thead>
            <tr>
              <TableHeader>{t("editionRelease.file.name")}</TableHeader>
              <TableHeader>{t("editionRelease.file.sha")}</TableHeader>
              <TableHeader numeric>{t("editionRelease.file.bytes")}</TableHeader>
              {access.press && <TableHeader>{t("editionRelease.file.download")}</TableHeader>}
            </tr>
          </thead>
          <tbody>
            {item.files.map((file) => (
              <tr key={file.name}>
                <TableCell>
                  <span>{file.name}</span>
                  {file.replaces && (
                    <p className="pg-layout__note">{t("editionRelease.file.replaces", { name: file.replaces })}</p>
                  )}
                </TableCell>
                <TableCell>
                  <code className="pg-release__hash">{file.sha256}</code>
                </TableCell>
                <TableCell numeric>{bytes(file.bytes, language)}</TableCell>
                {access.press && (
                  <TableCell>
                    <Button
                      variant="quiet"
                      size="sm"
                      disabled={getting !== null}
                      aria-busy={getting === file.name}
                      aria-label={t("editionRelease.file.downloadName", { name: file.name })}
                      onClick={() => void download(file.name)}
                    >
                      {t("editionRelease.file.download")}
                    </Button>
                  </TableCell>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
        <div aria-live="polite">
          {getting && <p className="pg-layout__note">{t("editionLayout.download.getting")}</p>}
        </div>
        {problem && <ProblemMessage problem={problem} />}
        {(access.press || access.archive) && (
          <Cluster gap="3">
            {access.press && (
              <Field label={t("editionRelease.item.sentNote")}>
                <TextInput value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
              </Field>
            )}
            {access.press && (
              <Button variant="secondary" disabled={busy} onClick={() => void sent()}>
                {t("editionRelease.item.markSent")}
              </Button>
            )}
            {access.archive && (
              <Button variant="quiet" disabled={busy} onClick={() => void verify()}>
                {t("editionRelease.item.verify")}
              </Button>
            )}
          </Cluster>
        )}
        <div aria-live="polite">
          {check && (
            <Stack gap="2">
              <p>
                {check.ok
                  ? t("editionRelease.verify.ok", { time: formatDateTime(check.checkedAt, language) })
                  : t("editionRelease.verify.notOk", { time: formatDateTime(check.checkedAt, language) })}
              </p>
              <ul className="pg-layout__list">
                {check.files.map((file) => (
                  <li key={file.name}>
                    <Badge tone={file.ok ? "success" : "danger"} icon={file.ok ? "circle-check" : "circle-x"}>
                      {file.ok ? t("editionRelease.verify.fileOk") : t("editionRelease.verify.fileNotOk")}
                    </Badge>
                    <span>{file.name}</span>
                  </li>
                ))}
              </ul>
            </Stack>
          )}
        </div>
        {item.deliveries.length > 0 && (
          <div>
            <h4 className="pg-layout__subhead">{t("editionRelease.sent.heading")}</h4>
            <ul className="pg-release__receipts">
              {item.deliveries.map((delivery) => (
                <li key={delivery.id}>
                  <Stack gap="2">
                    <p>
                      {t("editionRelease.sent.by", {
                        name: delivery.sentBy.name,
                        time: formatDateTime(delivery.sentAt, language),
                      })}
                    </p>
                    {delivery.note && <p className="pg-layout__note">{delivery.note}</p>}
                    <ul className="pg-layout__list">
                      {delivery.files.map((file) => (
                        <li key={file.name}>
                          <span>{file.name}</span>
                          <code className="pg-release__hash">{file.sha256}</code>
                        </li>
                      ))}
                    </ul>
                    {delivery.confirmation ? (
                      <p>
                        {t("editionRelease.confirm.done", {
                          person: delivery.confirmation.pressPerson,
                          time: formatDateTime(delivery.confirmation.at, language),
                          name: delivery.confirmation.recordedBy.name,
                        })}
                        {delivery.confirmation.note && (
                          <span className="pg-layout__note"> {delivery.confirmation.note}</span>
                        )}
                      </p>
                    ) : (
                      <>
                        <p className="pg-layout__note">{t("editionRelease.confirm.waiting")}</p>
                        {access.press && (
                          <div>
                            <Button variant="secondary" size="sm" onClick={() => setConfirming(delivery.id)}>
                              {t("editionRelease.confirm.open")}
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </Stack>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Stack>
      {confirming && (
        <ConfirmDialog
          onClose={() => setConfirming(null)}
          onConfirm={async (input) => {
            const result = await release.confirm({ ...at, deliveryId: confirming, ...input });
            if (result.ok || (result.error.kind === "answer" && result.error.code === "already_confirmed")) onChanged();
            if (result.ok) setConfirming(null);
            return result.ok ? null : result.error;
          }}
        />
      )}
    </Panel>
  );
}

function ConfirmDialog({
  onClose,
  onConfirm,
}: {
  readonly onClose: () => void;
  readonly onConfirm: (input: {
    readonly pressPerson: string;
    readonly at?: string;
    readonly note?: string;
  }) => Promise<ApiProblem | null>;
}) {
  const { t } = useI18n();
  const [person, setPerson] = useState("");
  const [when, setWhen] = useState("");
  const [note, setNote] = useState("");
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const submit = async () => {
    setMissing(!person.trim());
    if (!person.trim()) return;
    setBusy(true);
    setProblem(null);
    const answer = await onConfirm({
      pressPerson: person.trim(),
      ...(when ? { at: new Date(when).toISOString() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    });
    setBusy(false);
    setProblem(answer);
  };
  return (
    <Dialog open onClose={onClose} title={t("editionRelease.confirm.title")} closeLabel={t("shell.closeDialog")}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Stack gap="4">
          <p>{t("editionRelease.confirm.lede")}</p>
          <Field
            label={t("editionRelease.confirm.person")}
            {...(missing ? { errors: [t("editionRelease.confirm.personMissing")] } : {})}
          >
            <TextInput value={person} maxLength={200} onChange={(event) => setPerson(event.target.value)} />
          </Field>
          <Field label={t("editionRelease.confirm.when")} description={t("editionRelease.confirm.whenHelp")}>
            <input
              className="pg-input"
              type="datetime-local"
              value={when}
              onChange={(event) => setWhen(event.target.value)}
            />
          </Field>
          <Field label={t("editionRelease.noteOptional")}>
            <TextArea value={note} rows={2} maxLength={2000} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {problem && <ProblemMessage problem={problem} />}
          <Cluster gap="3">
            <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
              {t("editionRelease.confirm.save")}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t("editionRelease.confirm.cancel")}
            </Button>
          </Cluster>
        </Stack>
      </form>
    </Dialog>
  );
}
