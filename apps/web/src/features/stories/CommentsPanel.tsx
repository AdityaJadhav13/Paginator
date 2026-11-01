/**
 * A story's comments, in the story editor (plan §10 PR 23; §5.2): threads one level deep, oldest first, the resolved
 * ones folded away below the open ones. Write a comment, reply to a thread, change one's own comment, resolve or reopen
 * a thread: each offered only as the comment's own `can` (and the story's `can.comment`) allow, as the API decides.
 *
 * - A new comment or reply carries an Idempotency-Key kept with its exact text: a retry after a lost answer is the
 *   same request, so it is posted once.
 * - A live `comment` update on this story (or a `resync`) fetches the comments again; what is being typed in a box
 *   here stays as it is. While a box here is being typed in, or an input method is composing, the fetch waits until
 *   the box is left, so nothing on the panel moves under the person's typing. A fetch that fails keeps what is shown,
 *   saying nothing alarming.
 * - The browser asks before the page is closed while a comment is half written.
 * - An address ending in #comment-<id> (from a notification) shows that comment and moves focus to it.
 */
import { useCallback, useEffect, useRef, useState, type FocusEvent, type FormEvent } from "react";
import { useLocation } from "react-router";
import { Button, Cluster, Field, ProgressIndicator, Stack, TextArea } from "../../ui/index.ts";
import { randomUuid } from "../../api/client.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, CommentDto, CommentPatchDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useComments, useLiveEvents } from "../live/live-context.tsx";
import "../live/live.css";

/** The API's limit for a comment, after cleaning. */
export const COMMENT_LIMIT = 10_000;

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem; readonly live: boolean }
  | { readonly status: "ready"; readonly items: readonly CommentDto[] };

/** What a box holds, and the action it waits on. */
type Box = { readonly text: string; readonly pending: boolean; readonly problem: ApiProblem | null; readonly error: string | null };
const EMPTY_BOX: Box = { text: "", pending: false, problem: null, error: null };

/** No answer came, or the server failed: the comment may have been made. */
const unknownOutcome = (problem: ApiProblem) =>
  problem.kind !== "answer" || (problem.status >= 500 && problem.code !== "slow_down");

export function CommentsPanel({
  orgId,
  pubId,
  storyId,
  mayComment,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly storyId: string;
  /** The story's `can.comment`. */
  readonly mayComment: boolean;
}) {
  const comments = useComments();
  const { t, language } = useI18n();
  const location = useLocation();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  /** The boxes: "new", "reply:<thread>", "edit:<comment>". */
  const [boxes, setBoxes] = useState<Readonly<Record<string, Box>>>({});
  const [replying, setReplying] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [acting, setActing] = useState<{ id: string; problem: ApiProblem | null } | null>(null);
  const [said, setSaid] = useState("");
  const [showResolved, setShowResolved] = useState(false);
  /** An Idempotency-Key per text to post, kept until the API has it. */
  const keys = useRef(new Map<string, string>());
  const asking = useRef(0);
  /** A fetch of the list is on its way (its answer may predate a comment this screen has just shown). */
  const fetching = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const heading = useRef<HTMLHeadingElement>(null);
  const section = useRef<HTMLElement>(null);
  /** A live fetch waits for the box being typed in to be left, or the input method to end composing. */
  const held = useRef(false);
  const composing = useRef(false);
  const shownHash = useRef<string | null>(null);

  const fetchAll = useCallback(
    async (mode: "first" | "retry" | "quiet") => {
      const asked = ++asking.current;
      fetching.current = true;
      if (mode !== "quiet") setLoad({ status: "loading" });
      const result = await comments.list({ orgId, pubId, storyId });
      if (asked !== asking.current) return;
      fetching.current = false;
      if (!result.ok) {
        // a live update that cannot be fetched keeps what is shown, unless the story is no longer the person's to see
        const refused = result.error.kind === "answer" && (result.error.status === 403 || result.error.status === 404);
        if (mode !== "quiet" || refused || loadRef.current.status !== "ready") {
          setLoad({ status: "failed", problem: result.error, live: mode === "retry" });
        }
        return;
      }
      setLoad({ status: "ready", items: result.value });
    },
    [comments, orgId, pubId, storyId],
  );
  useEffect(() => {
    void fetchAll("first");
  }, [fetchAll]);
  /** Whether this element is one of the panel's boxes. */
  const isBox = (element: Element | null) => element instanceof HTMLTextAreaElement && Boolean(section.current?.contains(element));
  useLiveEvents((event) => {
    if (event.type !== "resync" && !(event.type === "comment" && event.storyId === storyId)) return;
    if (composing.current || isBox(document.activeElement)) held.current = true;
    else void fetchAll("quiet");
  });
  /** The box was left (not for another of the panel's), the composing ended, or a box was sent: a waiting fetch runs. */
  const release = (next: Element | null = null) => {
    if (!held.current || composing.current || isBox(next)) return;
    held.current = false;
    void fetchAll("quiet");
  };

  // a comment named in the address: shown, and focused once
  useEffect(() => {
    if (load.status !== "ready" || !location.hash.startsWith("#comment-") || shownHash.current === location.hash) return;
    const id = location.hash.slice("#comment-".length);
    const target = load.items.find((item) => item.id === id);
    if (!target) return;
    shownHash.current = location.hash;
    const thread = target.parentId ? load.items.find((item) => item.id === target.parentId) : target;
    if (thread?.resolved) setShowResolved(true);
    requestAnimationFrame(() => {
      const element = document.getElementById(`comment-${id}`);
      element?.scrollIntoView?.({ block: "center" });
      element?.focus();
    });
  }, [load, location.hash]);

  // a comment half written: the browser asks before the page is closed
  const writing = Object.values(boxes).some((box) => box.text.trim() !== "");
  useEffect(() => {
    if (!writing) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [writing]);

  const box = (name: string): Box => boxes[name] ?? EMPTY_BOX;
  const setBox = (name: string, change: Partial<Box>) =>
    setBoxes((current) => ({ ...current, [name]: { ...(current[name] ?? EMPTY_BOX), ...change } }));

  /** The text as the API will count it, or why it cannot be sent. */
  const checked = (text: string): string | null => {
    const trimmed = text.trim();
    if (trimmed === "") return t("comments.empty");
    const length = [...trimmed.normalize("NFC")].length;
    if (length > COMMENT_LIMIT) return t("comments.tooLong", { count: length });
    return null;
  };

  const replace = (comment: CommentDto) => {
    // a fetch on its way may have been answered before this comment: asked again, its answer is not shown
    if (fetching.current) void fetchAll("quiet");
    setLoad((current) =>
      current.status !== "ready"
        ? current
        : {
            status: "ready",
            items: current.items.some((item) => item.id === comment.id)
              ? current.items.map((item) => (item.id === comment.id ? comment : item))
              : [...current.items, comment],
          },
    );
  };

  const post = async (name: string, parentId?: string) => {
    const current = box(name);
    if (current.pending) return;
    const error = checked(current.text);
    if (error) return setBox(name, { error, problem: null });
    // the text as counted (checked): trimmed, NFC
    const body = current.text.trim().normalize("NFC");
    const intent = `${parentId ?? ""}\n${body}`;
    const idempotencyKey = keys.current.get(intent) ?? randomUuid();
    keys.current.set(intent, idempotencyKey);
    setBox(name, { pending: true, problem: null, error: null });
    const result = await comments.create({ orgId, pubId, storyId, body, ...(parentId ? { parentId } : {}), idempotencyKey });
    if (!result.ok) {
      // a refusal is an answer: nothing was made, and the next try is a new request
      if (!unknownOutcome(result.error)) keys.current.delete(intent);
      return setBox(name, { pending: false, problem: result.error });
    }
    keys.current.delete(intent);
    replace(result.value);
    setBoxes((all) => {
      const { [name]: _sent, ...rest } = all;
      return rest;
    });
    if (parentId) setReplying(null);
    setSaid(parentId ? t("comments.replied") : t("comments.posted"));
    release();
  };

  const saveEdit = async (comment: CommentDto) => {
    const name = `edit:${comment.id}`;
    const current = box(name);
    if (current.pending) return;
    const error = checked(current.text);
    if (error) return setBox(name, { error, problem: null });
    setBox(name, { pending: true, problem: null, error: null });
    const result = await comments.update({ orgId, pubId, commentId: comment.id, patch: { body: current.text.trim().normalize("NFC") } });
    if (!result.ok) return setBox(name, { pending: false, problem: result.error });
    replace(result.value);
    setBoxes((all) => {
      const { [name]: _saved, ...rest } = all;
      return rest;
    });
    setEditing(null);
    setSaid(t("comments.changed"));
    release();
  };

  const resolve = async (comment: CommentDto, resolved: boolean) => {
    if (acting) return;
    setActing({ id: comment.id, problem: null });
    const patch: CommentPatchDto = { resolved };
    const result = await comments.update({ orgId, pubId, commentId: comment.id, patch });
    if (!result.ok) return setActing({ id: comment.id, problem: result.error });
    setActing(null);
    replace(result.value);
    // the thread moves to the other list: focus goes to the comments' heading, and the change is said
    heading.current?.focus();
    setSaid(resolved ? t("comments.resolvedSaid") : t("comments.reopenedSaid"));
  };

  const submit = (run: () => Promise<void>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run();
  };

  const items = load.status === "ready" ? load.items : [];
  const threads = items.filter((item) => item.parentId === null);
  const repliesOf = (id: string) => items.filter((item) => item.parentId === id);
  const open = threads.filter((thread) => !thread.resolved);
  const resolved = threads.filter((thread) => thread.resolved);

  const editor = (comment: CommentDto) => {
    const name = `edit:${comment.id}`;
    const current = box(name);
    return (
      <form noValidate onSubmit={submit(() => saveEdit(comment))} aria-busy={current.pending}>
        <Stack gap="3">
          <Field label={t("comments.editLabel")} errors={current.error ? [current.error] : []}>
            <TextArea rows={3} value={current.text} onChange={(event) => setBox(name, { text: event.target.value, error: null })} />
          </Field>
          {current.problem && <ProblemMessage problem={current.problem} />}
          <Cluster gap="3">
            <Button type="submit" size="sm" disabled={current.pending}>
              {current.pending ? t("comments.saving") : t("comments.save")}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={current.pending}
              onClick={() => {
                setEditing(null);
                setBoxes((all) => {
                  const { [name]: _dropped, ...rest } = all;
                  return rest;
                });
              }}
            >
              {t("security.cancel")}
            </Button>
          </Cluster>
        </Stack>
      </form>
    );
  };

  const one = (comment: CommentDto) => (
    <article
      id={`comment-${comment.id}`}
      tabIndex={-1}
      aria-labelledby={`comment-${comment.id}-by`}
      className={comment.resolved ? "pg-comment pg-comment--resolved" : "pg-comment"}
    >
      <p className="pg-type-body-small pg-comment__meta">
        <strong id={`comment-${comment.id}-by`}>{comment.author.name}</strong>{" "}
        <time dateTime={comment.createdAt}>{formatDateTime(comment.createdAt, language)}</time>
        {comment.edited && <> {t("comments.edited")}</>}
      </p>
      {editing === comment.id ? editor(comment) : <p className="pg-comment__body">{comment.body}</p>}
      {comment.resolved && (
        <p className="pg-type-body-small">
          {t("comments.resolvedBy", { name: comment.resolved.by.name, date: formatDateTime(comment.resolved.at, language) })}
        </p>
      )}
      {acting?.id === comment.id && acting.problem && <ProblemMessage problem={acting.problem} />}
      {editing !== comment.id && (comment.can.edit || comment.can.resolve) && (
        <Cluster gap="3">
          {comment.can.edit && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setEditing(comment.id);
                setBox(`edit:${comment.id}`, { text: comment.body, error: null, problem: null });
              }}
            >
              {t("comments.edit")}
            </Button>
          )}
          {comment.can.resolve && (
            <Button
              variant="secondary"
              size="sm"
              disabled={acting !== null}
              aria-busy={acting?.id === comment.id && !acting.problem}
              onClick={() => void resolve(comment, !comment.resolved)}
            >
              {comment.resolved ? t("comments.reopen") : t("comments.resolve")}
            </Button>
          )}
        </Cluster>
      )}
    </article>
  );

  const thread = (first: CommentDto) => {
    const replies = repliesOf(first.id);
    const name = `reply:${first.id}`;
    const current = box(name);
    return (
      <li key={first.id}>
        <Stack gap="2">
          {one(first)}
          {replies.length > 0 && (
            <ol className="pg-comment__replies" aria-label={t("comments.repliesTo", { name: first.author.name })}>
              {replies.map((reply) => (
                <li key={reply.id}>{one(reply)}</li>
              ))}
            </ol>
          )}
          {mayComment && replying !== first.id && (
            <div>
              <Button variant="quiet" size="sm" onClick={() => setReplying(first.id)}>
                {t("comments.reply", { name: first.author.name })}
              </Button>
            </div>
          )}
          {mayComment && replying === first.id && (
            <form noValidate onSubmit={submit(() => post(name, first.id))} aria-busy={current.pending}>
              <Stack gap="3">
                <Field label={t("comments.replyLabel", { name: first.author.name })} errors={current.error ? [current.error] : []}>
                  <TextArea
                    rows={2}
                    autoFocus
                    value={current.text}
                    onChange={(event) => setBox(name, { text: event.target.value, error: null })}
                  />
                </Field>
                {current.problem && <ProblemMessage problem={current.problem} />}
                <Cluster gap="3">
                  <Button type="submit" size="sm" disabled={current.pending}>
                    {current.pending ? t("comments.posting") : t("comments.sendReply")}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={current.pending} onClick={() => setReplying(null)}>
                    {t("security.cancel")}
                  </Button>
                </Cluster>
              </Stack>
            </form>
          )}
        </Stack>
      </li>
    );
  };

  const fresh = box("new");
  return (
    <section
      ref={section}
      aria-labelledby="pg-comments-heading"
      onBlur={(event: FocusEvent<HTMLElement>) => release(event.relatedTarget as Element | null)}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
        release(document.activeElement);
      }}
    >
      <Stack gap="4">
        <h2 id="pg-comments-heading" ref={heading} tabIndex={-1} className="pg-type-section-title">
          {load.status === "ready" ? t("comments.headingCount", { count: items.length }) : t("comments.heading")}
        </h2>
        <div aria-live="polite" className="pg-type-body-small">
          {said}
        </div>
        {load.status === "loading" && <ProgressIndicator role="status" label={t("comments.loading")} />}
        {load.status === "failed" && (
          <Stack gap="3">
            <ProblemMessage problem={load.problem} live={load.live} />
            <div>
              <Button variant="secondary" onClick={() => void fetchAll("retry")}>
                {t("form.retry")}
              </Button>
            </div>
          </Stack>
        )}
        {load.status === "ready" && open.length === 0 && <p>{resolved.length > 0 ? t("comments.allResolved") : t("comments.none")}</p>}
        {open.length > 0 && <ol className="pg-comments">{open.map(thread)}</ol>}
        {resolved.length > 0 && (
          <details
            className="pg-comments__resolved"
            open={showResolved}
            onToggle={(event) => setShowResolved((event.currentTarget as HTMLDetailsElement).open)}
          >
            <summary>{t("comments.resolvedThreads", { count: resolved.length })}</summary>
            <ol className="pg-comments">{resolved.map(thread)}</ol>
          </details>
        )}
        {load.status === "ready" &&
          (mayComment ? (
            <form noValidate onSubmit={submit(() => post("new"))} aria-busy={fresh.pending}>
              <Stack gap="3">
                <Field label={t("comments.write")} description={t("comments.writeHint")} errors={fresh.error ? [fresh.error] : []}>
                  <TextArea rows={3} value={fresh.text} onChange={(event) => setBox("new", { text: event.target.value, error: null })} />
                </Field>
                {fresh.problem && <ProblemMessage problem={fresh.problem} />}
                <div>
                  <Button type="submit" disabled={fresh.pending} aria-busy={fresh.pending}>
                    {fresh.pending ? t("comments.posting") : t("comments.post")}
                  </Button>
                </div>
              </Stack>
            </form>
          ) : (
            <p>{t("comments.readOnly")}</p>
          ))}
      </Stack>
    </section>
  );
}
