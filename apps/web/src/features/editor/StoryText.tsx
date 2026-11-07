/**
 * The selected story's text (plan L2.4 "the story text panel"): each of its articles' headline and body in plain text
 * boxes (no contenteditable, so every Marathi input method works), saved through the stories' own API as a new
 * revision against the story's version (`baseRevision`), then the page is set with it ("Update text"). Only the fields
 * typed in are sent: a 409 story_changed keeps what was typed, shows the story as it is now in the fields not typed in,
 * and moves the base on to it, so the next save never undoes someone else's change to another field. What was typed and
 * not saved is kept (`drafts`, by story) when another story is selected and this one again.
 */
import { useEffect, useState } from "react";
import { Button, Field, InlineMessage, Stack, TextArea, TextInput } from "../../ui/index.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, StoryDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useStories } from "../stories/stories-context.tsx";

/** The fields typed in and not saved yet. */
export interface Draft {
  readonly headline?: string;
  readonly body?: string;
}

export interface ArticleRef {
  readonly article: string;
  readonly storyId: string | null;
  readonly headline: string;
}

export function StoryText({
  orgId,
  pubId,
  articles,
  disabled,
  drafts,
  onSaved,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly articles: readonly ArticleRef[];
  readonly disabled: boolean;
  readonly drafts: Map<string, Draft>;
  /** the text was saved: set the page with it */
  readonly onSaved: () => void;
}) {
  const { t } = useI18n();
  return (
    <Stack gap="4">
      <p className="pg-layout__note">{t("pageEditor.textHelp")}</p>
      {articles.map((a) =>
        a.storyId ? (
          <ArticleText
            key={a.article}
            orgId={orgId}
            pubId={pubId}
            storyId={a.storyId}
            disabled={disabled}
            drafts={drafts}
            onSaved={onSaved}
          />
        ) : (
          <div key={a.article}>
            <p className="pg-editor__head">{a.headline}</p>
            <p className="pg-layout__note">{t("pageEditor.textNoMap")}</p>
          </div>
        ),
      )}
    </Stack>
  );
}

function ArticleText({
  orgId,
  pubId,
  storyId,
  disabled,
  drafts,
  onSaved,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly storyId: string;
  readonly disabled: boolean;
  readonly drafts: Map<string, Draft>;
  readonly onSaved: () => void;
}) {
  const stories = useStories();
  const { t } = useI18n();
  const [story, setStory] = useState<StoryDto | null>(null);
  const [draft, setDraftState] = useState<Draft>(() => drafts.get(storyId) ?? {});
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [said, setSaid] = useState<"saved" | "changed" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    void stories.get({ orgId, pubId, storyId }).then((r) => {
      if (!alive) return;
      if (!r.ok) return setProblem(r.error);
      setStory(r.value);
    });
    return () => {
      alive = false;
    };
  }, [stories, orgId, pubId, storyId]);

  if (problem && !story) return <ProblemMessage problem={problem} />;
  if (!story) return <p className="pg-layout__note">{t("pageEditor.textLoading")}</p>;
  const readOnly = !story.can.edit;
  const headline = draft.headline ?? story.headline;
  const body = draft.body ?? story.body;
  const changed = headline !== story.headline || body !== story.body;
  const setDraft = (next: Draft) => {
    drafts.set(storyId, next);
    setDraftState(next);
  };

  const save = async () => {
    setSaving(true);
    setProblem(null);
    setSaid(null);
    const sent = drafts.get(storyId) ?? draft;
    const r = await stories.update({ orgId, pubId, storyId, patch: { baseRevision: story.revision, ...sent } });
    setSaving(false);
    if (r.ok) {
      setStory(r.value);
      if (drafts.get(storyId) === sent) setDraft({}); // what was typed meanwhile stays
      setSaid("saved");
      onSaved();
      return;
    }
    const current = r.error.kind === "answer" && r.error.code === "story_changed" ? r.error.current : undefined;
    if (current) {
      setStory(current as StoryDto); // the typed fields stay, the others show the story now; the base moves on
      setSaid("changed");
    } else setProblem(r.error);
  };

  return (
    <Stack gap="3">
      <Field label={t("pageEditor.headline")}>
        <TextInput
          lang={story.language}
          value={headline}
          readOnly={readOnly}
          onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
        />
      </Field>
      <Field label={t("pageEditor.body")}>
        <TextArea
          lang={story.language}
          rows={10}
          value={body}
          readOnly={readOnly}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
        />
      </Field>
      {readOnly ? (
        <p className="pg-layout__note">{t("pageEditor.textReadOnly")}</p>
      ) : (
        <div>
          <Button variant="secondary" disabled={disabled || saving || !changed} onClick={() => void save()}>
            {t("pageEditor.textSave")}
          </Button>
        </div>
      )}
      <div aria-live="polite">
        {said === "saved" && <p className="pg-layout__note">{t("pageEditor.textSaved")}</p>}
        {said === "changed" && (
          <InlineMessage variant="warning" heading={t("pageEditor.textChanged")} iconLabel={t("message.warning")} />
        )}
      </div>
      {problem && <ProblemMessage problem={problem} />}
    </Stack>
  );
}
