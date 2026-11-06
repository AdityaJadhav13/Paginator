/**
 * Import a Word file (docs/product/10-l2-newsroom-plan.md §L2.2): the .docx is checked here first (its name and at
 * most 10 MB), uploaded as the photos are (presign with purpose docx, then the presigned POST), then imported
 * (POST …/imports/docx, 202). The engine reads it with the Desk's own code; the drawer hears the end live (`import`)
 * and, in case that is missed, asks GET …/imports/:id every 3 s while it waits. Then: the stories made (links), how
 * many were skipped, and the Desk's notes in plain words; or why the file was refused, and another may be picked.
 *
 * A retry after a lost answer sends the same import (the same upload and Idempotency-Key), so nothing is made twice.
 */
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { DOCX_TYPE, MAX_DOCX_BYTES } from "@pageinator/contracts";
import { Button, Drawer, Field, Icon, InlineMessage, Select, Stack } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate } from "../../i18n/dates.ts";
import { useI18n, type PlainKey } from "../../i18n/index.ts";
import type { ApiProblem, DocxImportDto } from "../../services/index.ts";
import { DetailWords, ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useLiveEvents } from "../live/live-context.tsx";
import { fileName } from "../media/upload.tsx";
import { useStories } from "./stories-context.tsx";
import { useMedia } from "./media-context.tsx";

export const POLL_MS = 3000;

type Phase =
  | { readonly step: "pick" }
  | { readonly step: "upload" }
  | { readonly step: "read"; readonly importId: string }
  | { readonly step: "done"; readonly result: DocxImportDto };

type Failure = { readonly problem: ApiProblem } | { readonly error: NonNullable<DocxImportDto["error"]> };

/** The web's own words for the Desk's refusals; another docx.* code shows the Desk's English. */
const ERROR_WORDS: Readonly<Record<string, PlainKey>> = {
  "docx.not_word": "wordImport.wrongType",
  "docx.damaged": "wordImport.error.damaged",
  "docx.too_large": "wordImport.error.tooLarge",
  "docx.over_size": "wordImport.error.tooLarge",
  "docx.protected": "wordImport.error.protected",
  "docx.no_story": "wordImport.error.no_story",
  "import.not_allowed": "wordImport.error.not_allowed",
};

/** A GET that will never succeed: polling stops, and the drawer says why. */
const PERMANENT = new Set([401, 403, 404]);

type CountNote =
  | "wordImport.note.too_many_stories"
  | "wordImport.note.empty_headings"
  | "wordImport.note.tables"
  | "wordImport.note.text_boxes"
  | "wordImport.note.pictures"
  | "wordImport.note.skipped";
const NOTE_WORDS: Readonly<Record<string, CountNote>> = {
  "docx.too_many_stories": "wordImport.note.too_many_stories",
  "docx.empty_headings": "wordImport.note.empty_headings",
  "docx.tables": "wordImport.note.tables",
  "docx.text_boxes": "wordImport.note.text_boxes",
  "docx.pictures": "wordImport.note.pictures",
  "import.skipped": "wordImport.note.skipped",
};

/** Why the file is not sent at all, or null. */
function refuseDocx(file: File): PlainKey | null {
  if (/\.doc$/i.test(file.name)) return "wordImport.oldDoc";
  if (!/\.docx$/i.test(file.name)) return "wordImport.wrongType";
  if (file.size > MAX_DOCX_BYTES) return "wordImport.tooLarge";
  return null;
}

export function ImportWordDrawer({
  orgId,
  pubId,
  open,
  editions,
  onClose,
  onAdded,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly open: boolean;
  /** Editions the stories may go in (id → date); empty when the person may not place stories. */
  readonly editions: ReadonlyMap<string, string>;
  readonly onClose: () => void;
  readonly onAdded: () => void;
}) {
  const stories = useStories();
  const media = useMedia();
  const { t, language } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [edition, setEdition] = useState("");
  const [fieldError, setFieldError] = useState<PlainKey | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: "pick" });
  /** The file's upload once it arrived, and the import's key: a retry sends the same import. */
  const sent = useRef<{ readonly uploadId: string; readonly key: string; readonly edition: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ids = useId();
  // the latest onAdded, so a parent's new function each render does not restart the polling
  const added = useRef(onAdded);
  useEffect(() => {
    added.current = onAdded;
  }, [onAdded]);

  const reset = () => {
    setFile(null);
    setFieldError(null);
    setFailure(null);
    setPhase({ step: "pick" });
    sent.current = null;
  };

  const choose = (chosen: File | null) => {
    setFile(chosen);
    setFailure(null);
    sent.current = null;
    setFieldError(chosen ? refuseDocx(chosen) : null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (phase.step !== "pick") return;
    const refusal = file ? refuseDocx(file) : "wordImport.missing";
    if (refusal || !file) {
      setFieldError(refusal);
      return input.current?.focus();
    }
    setFailure(null);
    setPhase({ step: "upload" });
    const failed = (problem: ApiProblem) => {
      setFailure({ problem });
      setPhase({ step: "pick" });
    };
    if (!sent.current || sent.current.edition !== edition) {
      const presigned = await media.presign({
        orgId,
        pubId,
        purpose: "docx",
        filename: fileName(file.name),
        contentType: DOCX_TYPE,
        bytes: file.size,
        idempotencyKey: randomUuid(),
      });
      if (!presigned.ok) return failed(presigned.error);
      const arrived = await media.send({ upload: presigned.value, file });
      if (!arrived.ok) return failed(arrived.error);
      sent.current = { uploadId: presigned.value.uploadId, key: randomUuid(), edition };
    }
    const { uploadId, key } = sent.current;
    const accepted = await stories.importDocx({ orgId, pubId, uploadId, ...(edition ? { editionId: edition } : {}), idempotencyKey: key });
    if (!accepted.ok) {
      // a refusal is an answer: that upload is done with; a lost answer is retried as it was
      if (accepted.error.kind === "answer" && accepted.error.status < 500) sent.current = null;
      return failed(accepted.error);
    }
    setPhase({ step: "read", importId: accepted.value.importId });
  };

  const reading = phase.step === "read" ? phase.importId : null;
  /** The import still waited for: an answer that comes after its end (or a reset) is not used. */
  const waiting = useRef<string | null>(null);
  useEffect(() => {
    waiting.current = reading;
  }, [reading]);
  const check = useCallback(async () => {
    if (!reading) return;
    const answer = await stories.getImport({ orgId, pubId, importId: reading });
    if (waiting.current !== reading) return;
    if (!answer.ok) {
      // a lost answer is asked again at the next poll; a refusal is final
      if (answer.error.kind !== "answer" || !PERMANENT.has(answer.error.status)) return;
      waiting.current = null;
      sent.current = null;
      setFailure({ problem: answer.error });
      return setPhase({ step: "pick" });
    }
    if (answer.value.state === "queued" || answer.value.state === "running") return;
    waiting.current = null;
    sent.current = null;
    if (answer.value.state === "done") {
      setPhase({ step: "done", result: answer.value });
      return added.current();
    }
    // the file was refused: another may be picked
    setFailure({ error: answer.value.error ?? { code: "worker.unknown", message: "" } });
    setFile(null);
    if (input.current) input.current.value = "";
    setPhase({ step: "pick" });
  }, [orgId, pubId, reading, stories]);

  useLiveEvents((event) => {
    if (event.type === "import" && event.importId === reading) void check();
  });
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [check, reading]);

  const steps = [
    ["upload", t("wordImport.step.upload")],
    ["read", t("wordImport.step.read")],
    ["done", t("wordImport.step.done")],
  ] as const;
  const current = phase.step === "done" ? steps.length : steps.findIndex(([step]) => step === phase.step);
  const status =
    phase.step === "done"
      ? t("wordImport.done", { created: phase.result.created.length, skipped: phase.result.skipped })
      : phase.step === "pick"
        ? ""
        : `${steps[current]?.[1] ?? ""}…`;
  const busy = phase.step !== "pick" && phase.step !== "done";

  return (
    <Drawer open={open} onClose={onClose} title={t("wordImport.title")} closeLabel={t("shell.closeDialog")}>
      <Stack gap="4">
        {failure && <FailureMessage failure={failure} />}
        {phase.step !== "pick" && (
          <ol className="pg-word-import__steps" aria-label={t("wordImport.steps")}>
            {steps.map(([step, label], index) => {
              const done = index < current;
              const now = index === current;
              return (
                <li key={step} className={done ? "is-done" : now ? "is-now" : undefined} aria-current={now ? "step" : undefined}>
                  <Icon name={done ? "circle-check" : now ? "loader-circle" : "clock"} size={16} />
                  <span>{label}</span>
                  {(done || now) && (
                    <span className="pg-visually-hidden">({t(done ? "wordImport.stepDone" : "wordImport.stepNow")})</span>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        {/* the live region stays mounted (so its first words are heard), out of the layout while empty */}
        <p role="status" className={status ? "pg-word-import__status" : "pg-visually-hidden"}>
          {status}
        </p>
        {phase.step === "done" ? (
          <ImportResult orgId={orgId} pubId={pubId} result={phase.result} onAgain={reset} />
        ) : (
          <form noValidate onSubmit={submit} aria-busy={busy}>
            <Stack gap="4">
              {/* Field's markup, with the kit's button for the file input (visually hidden, still focusable and
                  labelled): a second label for it, styled as a button, opens the browser's picker */}
              <div className="pg-field pg-word-import__file">
                <label htmlFor={`${ids}-file`} className="pg-field__label">
                  {t("wordImport.file")}
                </label>
                <p id={`${ids}-hint`} className="pg-field__description">
                  {t("wordImport.hint")}
                </p>
                <div className="pg-word-import__pick">
                  <input
                    ref={input}
                    id={`${ids}-file`}
                    className="pg-visually-hidden"
                    type="file"
                    accept={`.docx,${DOCX_TYPE}`}
                    disabled={phase.step !== "pick"}
                    aria-describedby={fieldError ? `${ids}-hint ${ids}-error` : `${ids}-hint`}
                    {...(fieldError ? { "aria-invalid": true } : {})}
                    onChange={(event) => choose(event.target.files?.[0] ?? null)}
                  />
                  <label
                    htmlFor={`${ids}-file`}
                    className="pg-button pg-button--secondary pg-button--md"
                    {...(phase.step !== "pick" ? { "aria-disabled": true } : {})}
                  >
                    <Icon name="file-text" size={16} />
                    {t("wordImport.choose")}
                  </label>
                  <bdi className="pg-word-import__name">{file ? file.name : t("wordImport.noFile")}</bdi>
                </div>
                {fieldError && (
                  <div aria-live="assertive" aria-atomic={true} className="pg-field__errors">
                    <p id={`${ids}-error`} className="pg-field__error">
                      {t(fieldError)}
                    </p>
                  </div>
                )}
              </div>
              {editions.size > 0 && (
                <Field label={t("paste.edition")}>
                  <Select value={edition} disabled={phase.step !== "pick"} onChange={(event) => setEdition(event.target.value)}>
                    <option value="">{t("paste.noEdition")}</option>
                    {[...editions].map(([id, date]) => (
                      <option key={id} value={id}>
                        {formatDate(date, language)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <div>
                <Button type="submit" disabled={phase.step !== "pick"}>
                  {t("wordImport.submit")}
                </Button>
              </div>
            </Stack>
          </form>
        )}
      </Stack>
    </Drawer>
  );
}

function FailureMessage({ failure }: { readonly failure: Failure }) {
  const { t } = useI18n();
  if ("problem" in failure) {
    const { problem } = failure;
    if (problem.kind !== "answer" || problem.code !== "docx_refused") return <ProblemMessage problem={problem} />;
    // the API's reason in the reader's language; without one, the web's own words for "not a Word file"
    const why = problem.details?.[0];
    return (
      <InlineMessage variant="error" heading={t("wordImport.failed")} live iconLabel={t("message.error")}>
        {why ? <DetailWords detail={why} /> : t("wordImport.wrongType")}
      </InlineMessage>
    );
  }
  const { code, message } = failure.error;
  const words = ERROR_WORDS[code] ?? (code.startsWith("docx.") ? undefined : "wordImport.error.engine");
  return (
    <InlineMessage variant="error" heading={t("wordImport.failed")} live iconLabel={t("message.error")}>
      {words ? t(words) : <span lang="en">{message}</span>}
    </InlineMessage>
  );
}

function ImportResult({
  orgId,
  pubId,
  result,
  onAgain,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly result: DocxImportDto;
  readonly onAgain: () => void;
}) {
  const { t } = useI18n();
  const note = (code: string, count: number | null, text: string) => {
    if (code === "docx.formatting") return t("wordImport.note.formatting");
    const key = NOTE_WORDS[code];
    return key && count !== null ? t(key, { count }) : <span lang="en">{text}</span>;
  };
  return (
    <Stack gap="4">
      {result.created.length > 0 && (
        <ul className="pg-word-import__list">
          {result.created.map((story) => (
            <li key={story.storyId}>
              <Icon name="file-text" size={16} />
              <Link to={paths.pubStory(orgId, pubId, story.storyId)}>{story.headline}</Link>
            </li>
          ))}
        </ul>
      )}
      {result.notes.length > 0 && (
        <>
          <p className="pg-word-import__heading">{t("wordImport.notes")}</p>
          <ul className="pg-word-import__list pg-word-import__notes">
            {result.notes.map((item, index) => (
              <li key={`${item.code}-${index}`}>
                <Icon name="info" size={16} />
                <span>{note(item.code, item.count, item.text)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div>
        <Button variant="secondary" onClick={onAgain}>
          {t("wordImport.again")}
        </Button>
      </div>
    </Stack>
  );
}
