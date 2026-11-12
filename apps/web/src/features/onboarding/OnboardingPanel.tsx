/**
 * Onboard a new paper (L4; packages/contracts onboard.ts), on the Templates and engine profile screens for whoever may
 * change the settings (settings.edit): the paper's past edition PDFs uploaded (purpose onboard_pdf, each straight to the
 * store with its progress), with its permission, then read by the engine.onboard job (no AI: tools/onboard). Its step
 * is heard live (`onboarding`, `resync`) and fetched every POLL_MS while it works. Ready: what we read, in plain words,
 * and "Use this design" (a new engine profile, set up by the engine; Templates then shows the pages to choose). Then a
 * test layout: an edition of sample stories, opened on its layout page. Rejected or failed: each file's check and the
 * set's reason in the reader's language. Prominent while the publication has no ready profile, quieter otherwise.
 */
import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  MAX_ONBOARD_FILES,
  MAX_ONBOARD_PDF_BYTES,
  MIN_ONBOARD_FILES,
  ONBOARD_PDF_TYPE,
  type FileCheckCode,
} from "@pageinator/contracts";
import {
  Badge,
  Button,
  Checkbox,
  Cluster,
  Field,
  InlineMessage,
  Panel,
  ProgressIndicator,
  Stack,
  Table,
  TableCell,
  TableHeader,
  VisuallyHidden,
} from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate } from "../../i18n/dates.ts";
import { useI18n, type CatalogueKey, type PlainKey, type Translate } from "../../i18n/index.ts";
import type { ApiProblem, OnboardingDto, OnboardingViewDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { fileName } from "../media/upload.tsx";
import { useMedia } from "../stories/media-context.tsx";
import { useLayout } from "../layout/layout-context.tsx";
import { POLL_MS } from "../layout/EditionLayoutScreen.tsx";
import "./onboarding.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly value: OnboardingViewDto };

const ACTIVE: readonly OnboardingDto["state"][] = ["queued", "working"];

const STEP: Readonly<
  Record<NonNullable<OnboardingDto["progress"]>["step"], Extract<CatalogueKey, `onboarding.step.${string}`>>
> = {
  checking: "onboarding.step.checking",
  reading: "onboarding.step.reading",
  measuring: "onboarding.step.measuring",
  learning: "onboarding.step.learning",
  pictures: "onboarding.step.pictures",
  packing: "onboarding.step.packing",
};

const CHECK: Readonly<Record<Exclude<FileCheckCode, "onboard.frames_excluded">, PlainKey>> = {
  "onboard.not_pdf": "onboarding.check.not_pdf",
  "onboard.scanned": "onboarding.check.scanned",
  "onboard.fonts_missing": "onboarding.check.fonts_missing",
  "onboard.no_unicode": "onboarding.check.no_unicode",
  "onboard.untested_program": "onboarding.check.untested_program",
  "onboard.page_size_mix": "onboarding.check.page_size_mix",
  "onboard.duplicate": "onboarding.check.duplicate",
  "onboard.no_date": "onboarding.check.no_date",
  "onboard.legacy_font": "onboarding.check.legacy_font",
};

const REJECT: Readonly<Record<string, PlainKey>> = {
  "onboard.too_few_editions": "onboarding.reject.too_few_editions",
  "onboard.no_grid": "onboarding.reject.no_grid",
  "onboard.too_many_excluded": "onboarding.reject.too_many_excluded",
  "onboard.failed": "onboarding.reject.failed",
  "onboard.script_unconfirmed": "onboarding.reject.script_unconfirmed",
};

const ROLE_NAME: Readonly<Record<string, PlainKey>> = {
  front: "templates.roleName.front",
  inside_imprint: "templates.roleName.inside_imprint",
  inside: "templates.roleName.inside",
  back: "templates.roleName.back",
};
const ROLE_LABEL: Readonly<Record<string, PlainKey>> = {
  front: "templates.role.front",
  inside_imprint: "templates.role.inside_imprint",
  inside: "templates.role.inside",
  back: "templates.role.back",
};

/** A file check's note in the reader's language. */
export function checkNote(note: { readonly code: FileCheckCode; readonly count: number | null }, t: Translate): string {
  return note.code === "onboard.frames_excluded"
    ? t("onboarding.check.frames_excluded", { count: note.count ?? 0 })
    : t(CHECK[note.code]);
}

/** Why the set made no design, in the reader's language: an onboard.… code, else (worker.… or unknown) plain words. */
/** The file a start refused (the API names it as body.uploadIds.<i>, in the order sent): its name, or null. */
export function refusedFile(problem: ApiProblem, chosen: readonly { readonly file: File }[]): string | null {
  if (problem.kind !== "answer" || problem.code !== "invalid_request") return null;
  const at = problem.details?.map((d) => /^body\.uploadIds\.(\d+)$/.exec(d.field)?.[1]).find((i) => i !== undefined);
  return at === undefined ? null : (chosen[Number(at)]?.file.name ?? null);
}

export function rejectText(problem: NonNullable<OnboardingDto["problem"]>, t: Translate): string {
  if (problem.code === "onboard.no_template") {
    const role = String(problem.params?.["role"] ?? "");
    return t("onboarding.reject.no_template", { role: role in ROLE_NAME ? t(ROLE_NAME[role]!) : role });
  }
  const key = REJECT[problem.code];
  return key ? t(key) : t("onboarding.reject.worker");
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function OnboardingPanel({
  orgId,
  pubId,
  prominent,
  generate,
  templatesLink,
  onUsed,
}: {
  readonly orgId: string;
  readonly pubId: string;
  /** the publication has no ready profile: the step is the screen's main thing */
  readonly prominent: boolean;
  /** layout.generate: "Make a test layout" */
  readonly generate: boolean;
  /** a link to the Templates screen once the design is used (not on the Templates screen itself) */
  readonly templatesLink: boolean;
  readonly onUsed: () => void;
}) {
  const layout = useLayout();
  const { t } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [choosing, setChoosing] = useState(false);
  const ask = useRef(0);

  const fetchView = useCallback(async () => {
    const mine = ++ask.current;
    const result = await layout.getOnboarding({ orgId, pubId });
    if (mine !== ask.current) return;
    setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error });
  }, [layout, orgId, pubId]);
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchView();
  }, [fetchView]);
  useLiveEvents((event) => {
    if ((event.type === "onboarding" && event.publicationId === pubId) || event.type === "resync") void fetchView();
  });
  const current = load.status === "ready" ? load.value.current : null;
  const active = !!current && ACTIVE.includes(current.state);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => void fetchView(), POLL_MS);
    return () => clearInterval(timer);
  }, [fetchView, active]);

  const title = prominent ? t("onboarding.heading") : t("onboarding.headingAgain");
  if (load.status === "loading") return <ProgressIndicator role="status" label={t("onboarding.loading")} />;
  if (load.status === "failed")
    return (
      <Panel title={title}>
        <Stack gap="3">
          <ProblemMessage problem={load.problem} live={false} />
          <div>
            <Button variant="secondary" onClick={() => void fetchView()}>
              {t("form.retry")}
            </Button>
          </div>
        </Stack>
      </Panel>
    );

  const show = (value: OnboardingDto) => {
    ask.current += 1; // an older fetch still on its way must not undo this
    setChoosing(false);
    setLoad((was) =>
      was.status === "ready" ? { status: "ready", value: { ...was.value, current: value } } : was,
    );
  };
  const form = <UploadEditions orgId={orgId} pubId={pubId} onStarted={show} />;
  let body;
  if (current && active) body = <Working onboarding={current} orgId={orgId} pubId={pubId} onChanged={show} />;
  else if (choosing) body = form;
  else if (current?.state === "ready")
    body = (
      <Ready
        onboarding={current}
        orgId={orgId}
        pubId={pubId}
        onUsed={() => {
          void fetchView();
          onUsed();
        }}
      />
    );
  else if (current?.state === "rejected" || current?.state === "failed")
    body = <Refused onboarding={current} onAgain={() => setChoosing(true)} />;
  else if (current?.state === "used")
    body = (
      <Used orgId={orgId} pubId={pubId} generate={generate} templatesLink={templatesLink} onAgain={() => setChoosing(true)} />
    );
  else if (prominent) body = form;
  else
    body = (
      <Stack gap="3">
        <p>{t("onboarding.againLede")}</p>
        <div>
          <Button variant="secondary" onClick={() => setChoosing(true)}>
            {t("onboarding.begin")}
          </Button>
        </div>
      </Stack>
    );

  return (
    <Panel title={title} className={prominent ? "pg-onboard pg-onboard--prominent" : "pg-onboard"}>
      <Stack gap="4">
        {prominent && <p>{t("onboarding.lede")}</p>}
        {current?.state === "cancelled" && <p className="pg-layout__note">{t("onboarding.cancelled")}</p>}
        {body}
      </Stack>
    </Panel>
  );
}

// ------------------------------------------------------------------------------------------------ upload

interface Chosen {
  readonly key: string;
  readonly file: File;
}
const REFUSAL = { notPdf: "onboarding.notPdf", tooLarge: "onboarding.tooLarge", tooMany: "onboarding.tooMany" } as const;
type Refusal = { readonly why: keyof typeof REFUSAL; readonly name: string };
type Sending =
  | { readonly step: "idle" }
  | { readonly step: "uploading"; readonly key: string; readonly fraction: number }
  | { readonly step: "starting" }
  | { readonly step: "stopped" }
  | { readonly step: "failed"; readonly problem: ApiProblem };

const isPdf = (file: File) => file.type === ONBOARD_PDF_TYPE || /\.pdf$/i.test(file.name);

function UploadEditions({
  orgId,
  pubId,
  onStarted,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly onStarted: (value: OnboardingDto) => void;
}) {
  const media = useMedia();
  const layout = useLayout();
  const { t } = useI18n();
  const [chosen, setChosen] = useState<readonly Chosen[]>([]);
  const [refused, setRefused] = useState<readonly Refusal[]>([]);
  const [permission, setPermission] = useState(false);
  const [missing, setMissing] = useState<{ few: boolean; permission: boolean }>({ few: false, permission: false });
  const [sending, setSending] = useState<Sending>({ step: "idle" });
  const stop = useRef<AbortController | null>(null);
  /** each file that arrived in the store, by its key: a retry never sends it again */
  const arrived = useRef(new Map<string, string>());
  /** the uploads last sent to start and their Idempotency-Key: a retry of the same set sends the same key */
  const sent = useRef<{ readonly what: string; readonly key: string } | null>(null);
  useEffect(() => () => stop.current?.abort(), []);
  const busy = sending.step === "uploading" || sending.step === "starting";

  const add = (files: Iterable<File>) => {
    const next = [...chosen];
    const no: Refusal[] = [];
    for (const file of files) {
      if (!isPdf(file)) no.push({ why: "notPdf", name: file.name });
      else if (file.size > MAX_ONBOARD_PDF_BYTES) no.push({ why: "tooLarge", name: file.name });
      else if (next.length >= MAX_ONBOARD_FILES) {
        no.push({ why: "tooMany", name: file.name });
        break;
      } else if (!next.some((one) => one.file.name === file.name && one.file.size === file.size))
        next.push({ key: randomUuid(), file });
    }
    setChosen(next);
    setRefused(no);
    if (next.length >= MIN_ONBOARD_FILES) setMissing((was) => ({ ...was, few: false }));
  };
  const remove = (key: string) => {
    arrived.current.delete(key);
    setChosen((was) => was.filter((one) => one.key !== key));
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!busy) add(event.dataTransfer.files);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const lack = { few: chosen.length < MIN_ONBOARD_FILES, permission: !permission };
    setMissing(lack);
    if (lack.few || lack.permission) return;
    const controller = new AbortController();
    stop.current = controller;
    const where = { orgId, pubId };
    for (const { key, file } of chosen) {
      if (arrived.current.has(key)) continue;
      setSending({ step: "uploading", key, fraction: 0 });
      // the file's own key: asked again after a stop, the API answers the same policy while it lasts
      const presigned = await media.presign({
        ...where,
        filename: fileName(file.name),
        contentType: ONBOARD_PDF_TYPE,
        bytes: file.size,
        idempotencyKey: key,
        purpose: "onboard_pdf",
      });
      if (controller.signal.aborted) return setSending({ step: "stopped" });
      if (!presigned.ok) return setSending({ step: "failed", problem: presigned.error });
      const done = await media.send({
        upload: presigned.value,
        file,
        signal: controller.signal,
        onProgress: (fraction) => {
          if (!controller.signal.aborted) setSending({ step: "uploading", key, fraction });
        },
      });
      if (controller.signal.aborted || (!done.ok && done.error.kind === "answer" && done.error.code === "upload_cancelled"))
        return setSending({ step: "stopped" });
      if (!done.ok) return setSending({ step: "failed", problem: done.error });
      arrived.current.set(key, presigned.value.uploadId);
    }
    const uploadIds = chosen.map((one) => arrived.current.get(one.key)!);
    const what = JSON.stringify(uploadIds);
    const key = sent.current?.what === what ? sent.current.key : randomUuid();
    sent.current = { what, key };
    setSending({ step: "starting" });
    const started = await layout.startOnboarding({ ...where, uploadIds, idempotencyKey: key });
    if (!started.ok) return setSending({ step: "failed", problem: started.error });
    sent.current = null;
    onStarted(started.value);
  };

  const startRefused = sending.step === "failed" ? refusedFile(sending.problem, chosen) : null;

  const status = (one: Chosen) => {
    if (sending.step === "uploading" && sending.key === one.key)
      return (
        <ProgressIndicator
          label={t("onboarding.uploading", { name: one.file.name, percent: Math.round(sending.fraction * 100) })}
          value={Math.round(sending.fraction * 100)}
          max={100}
        />
      );
    return (
      <span className="pg-layout__note">
        {arrived.current.has(one.key) ? t("onboarding.uploaded") : t("onboarding.waiting")}
      </span>
    );
  };

  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Stack gap="4">
        <p className="pg-layout__note">{t("onboarding.recommend")}</p>
        {/* the file input inside is the keyboard's way: dropping is only a shortcut for a mouse */}
        <div className="pg-onboard__drop" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
          <p aria-hidden="true">{t("onboarding.drop")}</p>
          <Field label={t("onboarding.files")} {...(missing.few ? { errors: [t("onboarding.tooFew")] } : {})}>
            <input
              type="file"
              multiple
              accept=".pdf,application/pdf"
              disabled={busy}
              onChange={(event) => {
                add(event.target.files ?? []);
                event.target.value = "";
              }}
            />
          </Field>
        </div>
        {refused.length > 0 && (
          <InlineMessage variant="error" heading={t(REFUSAL[refused[0]!.why], { name: refused[0]!.name })} live iconLabel={t("message.error")}>
            {refused.length > 1 && (
              <ul>
                {refused.slice(1).map((one) => (
                  <li key={one.name}>{t(REFUSAL[one.why], { name: one.name })}</li>
                ))}
              </ul>
            )}
          </InlineMessage>
        )}
        {chosen.length > 0 && (
          <Stack gap="2">
            <h3 className="pg-layout__subhead">{t("onboarding.chosen", { count: chosen.length })}</h3>
            <ul className="pg-onboard__files">
              {chosen.map((one) => (
                <li key={one.key}>
                  <span className="pg-onboard__name">{one.file.name}</span>
                  <span className="pg-layout__note">{t("profile.megabytes", { size: (one.file.size / 1024 ** 2).toFixed(1) })}</span>
                  {status(one)}
                  <Button variant="secondary" size="sm" disabled={busy} onClick={() => remove(one.key)}>
                    {t("onboarding.remove")} <VisuallyHidden>{one.file.name}</VisuallyHidden>
                  </Button>
                </li>
              ))}
            </ul>
          </Stack>
        )}
        <Checkbox
          label={t("onboarding.permission")}
          checked={permission}
          disabled={busy}
          onChange={(event) => {
            setPermission(event.target.checked);
            if (event.target.checked) setMissing((was) => ({ ...was, permission: false }));
          }}
        />
        {missing.permission && (
          <InlineMessage variant="error" heading={t("onboarding.permissionNeeded")} live iconLabel={t("message.error")} />
        )}
        <Cluster gap="3">
          <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>
            {t("onboarding.submit")}
          </Button>
          {sending.step === "uploading" && (
            <Button variant="secondary" onClick={() => stop.current?.abort()}>
              {t("onboarding.cancelUpload")}
            </Button>
          )}
        </Cluster>
        <div aria-live="polite">
          {sending.step === "starting" && <ProgressIndicator label={t("onboarding.starting")} />}
          {sending.step === "stopped" && <p>{t("onboarding.stopped")}</p>}
        </div>
        {sending.step === "failed" && startRefused !== null && (
          <InlineMessage variant="error" heading={t("onboarding.fileRefused")} iconLabel={t("message.error")}>
            {t("onboarding.fileRefusedBody", { name: startRefused })}
          </InlineMessage>
        )}
        {sending.step === "failed" && startRefused === null && <ProblemMessage problem={sending.problem} />}
      </Stack>
    </form>
  );
}

// ------------------------------------------------------------------------------------------------ the job

function Working({
  onboarding,
  orgId,
  pubId,
  onChanged,
}: {
  readonly onboarding: OnboardingDto;
  readonly orgId: string;
  readonly pubId: string;
  readonly onChanged: (value: OnboardingDto) => void;
}) {
  const layout = useLayout();
  const { t } = useI18n();
  const [cancelling, setCancelling] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const { progress } = onboarding;
  const cancel = async () => {
    setCancelling(true);
    setProblem(null);
    const done = await layout.cancelOnboarding({ orgId, pubId, id: onboarding.id });
    setCancelling(false);
    if (done.ok) onChanged(done.value);
    else setProblem(done.error);
  };
  return (
    <Stack gap="3">
      <div aria-live="polite">
        {progress ? (
          <ProgressIndicator
            label={t(STEP[progress.step], { done: progress.done, total: progress.total })}
            {...(progress.total > 0 ? { value: progress.done, max: progress.total } : {})}
          />
        ) : (
          <ProgressIndicator label={t("onboarding.queued")} />
        )}
      </div>
      <p className="pg-layout__note">{t("onboarding.working")}</p>
      <div>
        <Button variant="secondary" disabled={cancelling} aria-busy={cancelling} onClick={() => void cancel()}>
          {t("onboarding.cancel")}
        </Button>
      </div>
      {problem && <ProblemMessage problem={problem} />}
    </Stack>
  );
}

function Ready({
  onboarding,
  orgId,
  pubId,
  onUsed,
}: {
  readonly onboarding: OnboardingDto;
  readonly orgId: string;
  readonly pubId: string;
  readonly onUsed: () => void;
}) {
  const layout = useLayout();
  const { t } = useI18n();
  const [using, setUsing] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  /** kept for a retry: the same key asks for the same profile */
  const key = useRef(randomUuid());
  const report = onboarding.report;
  const adopt = async () => {
    setUsing(true);
    setProblem(null);
    const made = await layout.adoptOnboarding({ orgId, pubId, id: onboarding.id, idempotencyKey: key.current });
    setUsing(false);
    if (made.ok) onUsed();
    else setProblem(made.error);
  };
  return (
    <Stack gap="4">
      <InlineMessage variant="success" heading={t("onboarding.ready")} iconLabel={t("message.success")}>
        {t("onboarding.readyBody")}
      </InlineMessage>
      {report && (
        <dl className="pg-layout__facts">
          <div>
            <dt>{t("onboarding.read.editions")}</dt>
            <dd>
              {t("onboarding.read.editionsValue", {
                editions: report.editions,
                pages: report.pages,
                calibration: report.calibration_editions,
              })}
            </dd>
          </div>
          <div>
            <dt>{t("onboarding.read.size")}</dt>
            <dd>{t("onboarding.read.sizeValue", { width: round1(report.page_w_mm), height: round1(report.page_h_mm) })}</dd>
          </div>
          <div>
            <dt>{t("onboarding.read.grid")}</dt>
            <dd>
              {t("profile.gridValue", {
                columns: report.grid.columns,
                width: round1(report.grid.column_width_mm),
                gutter: round1(report.grid.gutter_mm),
              })}
              {report.grids_seen > 1 && <> {t("onboarding.read.gridsSeen", { count: report.grids_seen })}</>}
            </dd>
          </div>
          <div>
            <dt>{t("onboarding.read.script")}</dt>
            <dd>{report.script === "deva" ? t("onboarding.read.deva") : t("onboarding.read.latn")}</dd>
          </div>
          <div>
            <dt>{t("onboarding.read.excluded")}</dt>
            <dd>{t("onboarding.read.excludedValue", { percent: round1(report.excluded_share * 100) })}</dd>
          </div>
          <div>
            <dt>{t("onboarding.read.roles")}</dt>
            <dd>
              {Object.entries(report.roles)
                .map(([role, count]) => `${role in ROLE_LABEL ? t(ROLE_LABEL[role]!) : role}: ${count}`)
                .join(" · ")}
            </dd>
          </div>
        </dl>
      )}
      <FileChecks files={onboarding.files} />
      <div>
        <Button variant="primary" disabled={using} aria-busy={using} onClick={() => void adopt()}>
          {using ? t("onboarding.usingNow") : t("onboarding.use")}
        </Button>
      </div>
      {problem && <ProblemMessage problem={problem} />}
    </Stack>
  );
}

function Refused({ onboarding, onAgain }: { readonly onboarding: OnboardingDto; readonly onAgain: () => void }) {
  const { t } = useI18n();
  return (
    <Stack gap="4">
      <InlineMessage
        variant="error"
        heading={onboarding.state === "failed" ? t("onboarding.failed") : t("onboarding.rejected")}
        iconLabel={t("message.error")}
      >
        {onboarding.problem ? rejectText(onboarding.problem, t) : t("onboarding.reject.worker")}
      </InlineMessage>
      {onboarding.files.some((file) => file.check) && <FileChecks files={onboarding.files} />}
      <div>
        <Button variant="secondary" onClick={onAgain}>
          {t("onboarding.tryAgain")}
        </Button>
      </div>
    </Stack>
  );
}

function Used({
  orgId,
  pubId,
  generate,
  templatesLink,
  onAgain,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly generate: boolean;
  readonly templatesLink: boolean;
  readonly onAgain: () => void;
}) {
  const layout = useLayout();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const key = useRef(randomUuid());
  const test = async () => {
    setMaking(true);
    setProblem(null);
    const made = await layout.makeTestEdition({ orgId, pubId, idempotencyKey: key.current });
    setMaking(false);
    if (made.ok) void navigate(paths.pubEditionLayout(orgId, pubId, made.value.editionId));
    else setProblem(made.error);
  };
  return (
    <Stack gap="3">
      <InlineMessage variant="info" heading={t("onboarding.used")} iconLabel={t("message.info")}>
        {t("onboarding.usedBody")}
      </InlineMessage>
      {templatesLink && (
        <p>
          <Link to={paths.pubTemplates(orgId, pubId)}>{t("onboarding.templatesLink")}</Link>
        </p>
      )}
      {generate && (
        <Stack gap="2">
          <p className="pg-layout__note">{t("onboarding.testBody")}</p>
          <div aria-live="polite">
            <Button variant="primary" disabled={making} aria-busy={making} onClick={() => void test()}>
              {making ? t("onboarding.testMaking") : t("onboarding.test")}
            </Button>
          </div>
          {problem && <ProblemMessage problem={problem} />}
        </Stack>
      )}
      <div>
        <Button variant="secondary" onClick={onAgain}>
          {t("onboarding.begin")}
        </Button>
      </div>
    </Stack>
  );
}

const STATUS: Readonly<Record<"ok" | "warning" | "refused", readonly [PlainKey, "success" | "warning" | "danger"]>> = {
  ok: ["onboarding.status.ok", "success"],
  warning: ["onboarding.status.warning", "warning"],
  refused: ["onboarding.status.refused", "danger"],
};

function FileChecks({ files }: { readonly files: OnboardingDto["files"] }) {
  const { t, language } = useI18n();
  return (
    <Table caption={t("onboarding.table")}>
      <thead>
        <tr>
          <TableHeader>{t("onboarding.col.file")}</TableHeader>
          <TableHeader>{t("onboarding.col.date")}</TableHeader>
          <TableHeader numeric>{t("onboarding.col.pages")}</TableHeader>
          <TableHeader>{t("onboarding.col.check")}</TableHeader>
        </tr>
      </thead>
      <tbody>
        {files.map((file) => (
          <tr key={file.n}>
            <TableCell>{file.name}</TableCell>
            <TableCell>
              {file.check?.date ? formatDate(file.check.date, language) : t("onboarding.noDate")}
            </TableCell>
            <TableCell numeric>{file.check ? file.check.pages : "—"}</TableCell>
            <TableCell>
              {file.check && (
                <Stack gap="1">
                  <div>
                    <Badge tone={STATUS[file.check.status][1]}>{t(STATUS[file.check.status][0])}</Badge>
                  </div>
                  {file.check.notes.map((note) => (
                    <span key={note.code}>{checkNote(note, t)}</span>
                  ))}
                </Stack>
              )}
            </TableCell>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
