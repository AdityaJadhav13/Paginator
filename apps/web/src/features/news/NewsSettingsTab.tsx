/**
 * The Sources screen's Settings (settings.edit: the Chief Editor, Owner, Admin): the publication's feeds (name, address,
 * language, collected or not, when last collected and its last problem) added, changed and deleted; "Collect now"; the
 * house style Claude drafts in (kept in the database, never in the repository); how often to collect; and the AI spend
 * this month and today against the daily limit.
 */
import { useEffect, useState, type FormEvent } from "react";
import {
  Button,
  Checkbox,
  Cluster,
  Dialog,
  Drawer,
  Field,
  Icon,
  IconButton,
  Panel,
  RadioGroup,
  Stack,
  Table,
  TableCell,
  TableHeader,
  TextArea,
  TextInput,
} from "../../ui/index.ts";
import { formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, NewsLanguageDto, NewsSettingsDto, NewsSourceDto, NewsSourceInputDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useNews } from "./news-context.tsx";

const rupees = (amount: number) => amount.toFixed(2);

export function NewsSettingsTab({
  orgId,
  pubId,
  settings,
  onSaved,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly settings: NewsSettingsDto;
  readonly onSaved: (settings: NewsSettingsDto) => void;
}) {
  const news = useNews();
  const { t, language } = useI18n();
  const [houseStyle, setHouseStyle] = useState(settings.houseStyle);
  const [every, setEvery] = useState(String(settings.collectEveryHours));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [collecting, setCollecting] = useState<"idle" | "busy" | "started">("idle");

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setProblem(null);
    const result = await news.updateSettings({ orgId, pubId, patch: { houseStyle, collectEveryHours: Number(every) } });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    setSaved(true);
    onSaved(result.value);
  };

  const collect = async () => {
    setCollecting("busy");
    setProblem(null);
    const result = await news.collect({ orgId, pubId });
    setCollecting(result.ok ? "started" : "idle");
    if (!result.ok) setProblem(result.error);
  };

  return (
    <Stack gap="5">
      {problem && <ProblemMessage problem={problem} />}
      <SourcesTable orgId={orgId} pubId={pubId} />
      <Cluster gap="3">
        <Button variant="secondary" disabled={collecting === "busy"} onClick={() => void collect()}>
          <Icon name="refresh-cw" size={16} />
          {t("news.collectNow")}
        </Button>
        {settings.lastCollectedAt && (
          <span className="pg-news__note">{t("news.lastCollected", { time: formatDateTime(settings.lastCollectedAt, language) })}</span>
        )}
      </Cluster>
      <div aria-live="polite">{collecting === "started" && <p>{t("news.collectStarted")}</p>}</div>

      <Panel title={t("news.spend")}>
        <Stack gap="1">
          <p>{t("news.spend.month", { amount: rupees(settings.ai.spentMonthInr) })}</p>
          <p>{t("news.spend.today", { spent: rupees(settings.ai.spentTodayInr), cap: rupees(settings.ai.capDayInr) })}</p>
        </Stack>
      </Panel>

      <form onSubmit={save} className="pg-news__settings">
        <Stack gap="4">
          <Field label={t("news.houseStyle")} description={t("news.houseStyle.hint")}>
            <TextArea rows={8} maxLength={20_000} value={houseStyle} onChange={(event) => (setSaved(false), setHouseStyle(event.target.value))} />
          </Field>
          <Field label={t("news.every")}>
            <TextInput
              type="number"
              min={1}
              max={24}
              inputMode="numeric"
              value={every}
              onChange={(event) => (setSaved(false), setEvery(event.target.value))}
            />
          </Field>
          <div>
            <Button type="submit" disabled={saving} aria-busy={saving}>
              {saving ? t("library.saving") : t("news.saveSettings")}
            </Button>
          </div>
        </Stack>
      </form>
      <div aria-live="polite">{saved && <p>{t("library.saved")}</p>}</div>
    </Stack>
  );
}

type Editing = { readonly source: NewsSourceDto | null };

function SourcesTable({ orgId, pubId }: { readonly orgId: string; readonly pubId: string }) {
  const news = useNews();
  const { t, language } = useI18n();
  const [sources, setSources] = useState<readonly NewsSourceDto[]>([]);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<NewsSourceDto | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let current = true;
    void news.listSources({ orgId, pubId }).then((result) => {
      if (!current) return;
      if (result.ok) setSources(result.value);
      else setProblem(result.error);
    });
    return () => {
      current = false;
    };
  }, [news, orgId, pubId, version]);

  const remove = async (source: NewsSourceDto) => {
    setDeleting(null);
    const result = await news.removeSource({ orgId, pubId, sourceId: source.id });
    if (!result.ok) return setProblem(result.error);
    setVersion((count) => count + 1);
  };

  return (
    <Panel
      title={t("news.feeds")}
      flush
      actions={
        <Button variant="secondary" size="sm" onClick={() => setEditing({ source: null })}>
          <Icon name="plus" size={16} />
          {t("news.source.add")}
        </Button>
      }
    >
      {problem && <ProblemMessage problem={problem} />}
      <Table caption={t("news.feeds")}>
        <thead>
          <tr>
            <TableHeader>{t("news.col.name")}</TableHeader>
            <TableHeader>{t("news.col.url")}</TableHeader>
            <TableHeader>{t("news.filter")}</TableHeader>
            <TableHeader>{t("news.col.on")}</TableHeader>
            <TableHeader>{t("news.col.lastFetch")}</TableHeader>
            <TableHeader>{t("news.col.lastError")}</TableHeader>
            <TableHeader>{t("news.col.actions")}</TableHeader>
          </tr>
        </thead>
        <tbody>
          {sources.map((source) => (
            <tr key={source.id}>
              <TableCell>
                <bdi>{source.name}</bdi>
              </TableCell>
              <TableCell className="pg-news__url">
                <bdi>{source.url}</bdi>
              </TableCell>
              <TableCell>{t(source.language === "mr" ? "news.language.mr" : "news.language.en")}</TableCell>
              <TableCell>{t(source.enabled ? "news.on" : "news.off")}</TableCell>
              <TableCell>{source.lastFetchAt ? formatDateTime(source.lastFetchAt, language) : t("news.never")}</TableCell>
              <TableCell>{source.lastError ? <span lang="en">{source.lastError}</span> : t("news.noProblem")}</TableCell>
              <TableCell>
                <Cluster gap="1">
                  <IconButton label={t("news.source.edit", { name: source.name })} onClick={() => setEditing({ source })}>
                    <Icon name="pencil" size={16} />
                  </IconButton>
                  <IconButton label={t("news.source.delete", { name: source.name })} onClick={() => setDeleting(source)}>
                    <Icon name="trash-2" size={16} />
                  </IconButton>
                </Cluster>
              </TableCell>
            </tr>
          ))}
        </tbody>
      </Table>
      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.source ? t("news.source.editTitle") : t("news.source.add")}
        closeLabel={t("shell.closeDialog")}
      >
        {editing && (
          <SourceForm
            orgId={orgId}
            pubId={pubId}
            source={editing.source}
            onSaved={() => {
              setEditing(null);
              setVersion((count) => count + 1);
            }}
          />
        )}
      </Drawer>
      {deleting && (
        <Dialog open onClose={() => setDeleting(null)} title={t("news.source.deleteTitle")} closeLabel={t("shell.closeDialog")}>
          <Stack gap="4">
            <p>{t("news.source.deleteBody")}</p>
            <Cluster gap="3">
              <Button variant="danger" onClick={() => void remove(deleting)}>
                {t("library.delete.confirm")}
              </Button>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                {t("security.cancel")}
              </Button>
            </Cluster>
          </Stack>
        </Dialog>
      )}
    </Panel>
  );
}

function SourceForm({
  orgId,
  pubId,
  source,
  onSaved,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly source: NewsSourceDto | null;
  readonly onSaved: () => void;
}) {
  const news = useNews();
  const { t } = useI18n();
  const [typed, setTyped] = useState<NewsSourceInputDto>(
    source
      ? { name: source.name, url: source.url, language: source.language, enabled: source.enabled }
      : { name: "", url: "", language: "mr", enabled: true },
  );
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [saving, setSaving] = useState(false);
  const fieldErrors = (field: string) =>
    problem?.kind === "answer" ? (problem.details ?? []).filter((detail) => detail.field.endsWith(field)).map((detail) => detail.message) : [];

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setProblem(null);
    const input = { ...typed, name: typed.name.trim(), url: typed.url.trim() };
    const result = source
      ? await news.updateSource({ orgId, pubId, sourceId: source.id, patch: input })
      : await news.createSource({ orgId, pubId, source: input });
    setSaving(false);
    if (!result.ok) return setProblem(result.error);
    onSaved();
  };

  return (
    <form noValidate onSubmit={submit}>
      <Stack gap="4">
        {problem && <ProblemMessage problem={problem} />}
        <Field label={t("news.col.name")} errors={fieldErrors("name")}>
          <TextInput value={typed.name} required onChange={(event) => setTyped({ ...typed, name: event.target.value })} />
        </Field>
        <Field label={t("news.col.url")} description={t("news.source.urlHint")} errors={fieldErrors("url")}>
          <TextInput type="url" dir="ltr" value={typed.url} required onChange={(event) => setTyped({ ...typed, url: event.target.value })} />
        </Field>
        <RadioGroup
          className="pg-news__filter"
          legend={t("news.filter")}
          value={typed.language}
          onChange={(value) => setTyped({ ...typed, language: value as NewsLanguageDto })}
          options={[
            { value: "mr", label: t("news.language.mr") },
            { value: "en", label: t("news.language.en") },
          ]}
        />
        <Checkbox label={t("news.source.enabled")} checked={typed.enabled} onChange={(event) => setTyped({ ...typed, enabled: event.target.checked })} />
        <div>
          <Button type="submit" disabled={saving}>
            {t("news.source.save")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
