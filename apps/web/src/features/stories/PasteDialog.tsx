/**
 * Paste several stories at once (plan §10 PR 21; the Desk's paste): the text goes to the API's paste endpoint, which
 * splits and cleans it as the Desk does, with an Idempotency-Key. The answer is shown: the stories added, and those
 * skipped with the API's reason (in English: the Desk's own words).
 *
 * A paste whose answer was lost may have been made: until a retry gets the answer, the text is held as it was sent
 * (read only) and the retry sends the same key and the same text, so nothing is pasted twice. Closing the dialog keeps
 * the text; only an answer, or "Paste more" after one, clears it.
 */
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button, Cluster, Dialog, Field, Select, Stack, TextArea } from "../../ui/index.ts";
import { paths } from "../../app/routes.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDate } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, PasteResultDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useStories } from "./stories-context.tsx";

export function PasteDialog({
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
  /** Editions known to the list (id → date); there is no editions endpoint yet. */
  readonly editions: ReadonlyMap<string, string>;
  readonly onClose: () => void;
  readonly onAdded: () => void;
}) {
  const stories = useStories();
  const { t, language } = useI18n();
  const [text, setText] = useState("");
  const [edition, setEdition] = useState("");
  const [missing, setMissing] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [result, setResult] = useState<PasteResultDto | null>(null);
  const [pending, setPending] = useState(false);
  /** The paste sent without a known answer: its key and exact body, retried as they are. */
  const [sent, setSent] = useState<{ readonly key: string; readonly text: string; readonly edition: string } | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const reset = () => {
    setText("");
    setEdition("");
    setMissing(false);
    setProblem(null);
    setResult(null);
    setSent(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setProblem(null);
    if (!sent && text.trim() === "") {
      setMissing(true);
      return field.current?.focus();
    }
    setMissing(false);
    const request = sent ?? { key: randomUuid(), text, edition };
    setSent(request);
    setPending(true);
    const answer = await stories.paste({
      orgId,
      pubId,
      text: request.text,
      ...(request.edition ? { editionId: request.edition } : {}),
      idempotencyKey: request.key,
    });
    setPending(false);
    if (!answer.ok) {
      // a refusal is an answer: nothing was pasted, and the text may be changed and sent anew
      const unknown = answer.error.kind !== "answer" || answer.error.status >= 500;
      if (!unknown) setSent(null);
      return setProblem(answer.error);
    }
    setSent(null);
    setResult(answer.value);
    onAdded();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("paste.title")}
      closeLabel={t("shell.closeDialog")}
      dismissible={!pending}
    >
      {result ? (
        <Stack gap="4">
          <div role="status">
            <p>
              <strong>{t("paste.created", { count: result.created.length })}</strong>
            </p>
          </div>
          {result.created.length > 0 && (
            <ul>
              {result.created.map((story) => (
                <li key={story.id}>
                  <Link to={paths.pubStory(orgId, pubId, story.id)} lang={story.language || undefined}>
                    {story.headline}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <>
              <p>
                <strong>{t("paste.skipped", { count: result.skipped.length })}</strong>
              </p>
              <ul>
                {result.skipped.map((skipped, index) => (
                  <li key={`${skipped.headline}-${index}`}>
                    {skipped.headline && <strong>{skipped.headline} </strong>}
                    <span lang="en">{skipped.reason}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div>
            <Button variant="secondary" onClick={reset}>
              {t("paste.again")}
            </Button>
          </div>
        </Stack>
      ) : (
        <form noValidate onSubmit={submit} aria-busy={pending}>
          <Stack gap="4">
            {problem && <ProblemMessage problem={problem} />}
            {sent && !pending && <p>{t("paste.unknown")}</p>}
            <Field label={t("paste.text")} description={t("paste.hint")} errors={missing ? [t("paste.missing")] : []}>
              <TextArea
                ref={field}
                rows={12}
                value={text}
                readOnly={sent !== null}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            {editions.size > 0 && (
              <Field label={t("paste.edition")}>
                <Select value={edition} disabled={sent !== null} onChange={(event) => setEdition(event.target.value)}>
                  <option value="">{t("paste.noEdition")}</option>
                  {[...editions].map(([id, date]) => (
                    <option key={id} value={id}>
                      {formatDate(date, language)}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Cluster gap="3">
              <Button type="submit">{pending ? t("paste.sending") : sent ? t("paste.retry") : t("paste.submit")}</Button>
            </Cluster>
          </Stack>
        </form>
      )}
    </Dialog>
  );
}
