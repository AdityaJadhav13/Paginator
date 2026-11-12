/**
 * The publication's sections, on its settings screen (GET …/sections): the sections in use in the paper's order, with
 * how many stories each holds, then the archived ones. Whoever may change the settings (settings.edit: the Chief
 * Editor, the Owner, an Admin) adds one, renames it, moves it up or down, archives it or brings it back. A section is
 * never deleted: archiving keeps it on its stories and plans (packages/contracts/src/sections.ts).
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Button, Cluster, Field, Panel, ProgressIndicator, Stack, TextInput } from "../../ui/index.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, SectionDto, SectionListDto } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useLayout } from "./layout-context.tsx";

type Change = { readonly name?: string; readonly position?: number; readonly archived?: boolean };

export function SectionsPanel({
  orgId,
  pubId,
  edit,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly edit: boolean;
}) {
  const layout = useLayout();
  const { t } = useI18n();
  const [list, setList] = useState<readonly SectionDto[] | null>(null);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ readonly id: string; readonly name: string } | null>(null);

  const fetchList = useCallback(async () => {
    const result = await layout.listSections({ orgId, pubId });
    if (result.ok) setList(result.value.items);
    else setProblem(result.error);
  }, [layout, orgId, pubId]);
  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const act = async (call: () => Promise<{ ok: true; value: SectionListDto } | { ok: false; error: ApiProblem }>) => {
    setBusy(true);
    setProblem(null);
    const result = await call();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.error);
      return false;
    }
    setList(result.value.items);
    return true;
  };
  const change = (id: string, patch: Change) => act(() => layout.changeSection({ orgId, pubId, id, change: patch }));
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (name.trim() && (await act(() => layout.addSection({ orgId, pubId, name: name.trim() })))) setName("");
  };

  if (!list) {
    return (
      <Panel title={t("sections.title")}>
        {problem ? <ProblemMessage problem={problem} /> : <ProgressIndicator role="status" label={t("sections.loading")} />}
      </Panel>
    );
  }
  const inUse = list.filter((section) => !section.archived);
  const archived = list.filter((section) => section.archived);
  return (
    <Panel title={t("sections.title")}>
      <Stack gap="4">
        <p>{t("sections.lede")}</p>
        {problem && <ProblemMessage problem={problem} />}
        {inUse.length === 0 ? (
          <p>{t("sections.none")}</p>
        ) : (
          <ol className="pg-sections">
            {inUse.map((section, i) => (
              <li key={section.id} className="pg-sections__item">
                {renaming?.id === section.id ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      const next = renaming.name.trim();
                      if (next) void change(section.id, { name: next }).then((ok) => ok && setRenaming(null));
                    }}
                  >
                    <Cluster gap="2">
                      <Field label={t("sections.newName", { name: section.name })}>
                        <TextInput
                          value={renaming.name}
                          maxLength={200}
                          onChange={(event) => setRenaming({ id: section.id, name: event.target.value })}
                        />
                      </Field>
                      <Button type="submit" size="sm" disabled={busy || !renaming.name.trim()}>
                        {t("sections.save")}
                      </Button>
                      <Button variant="quiet" size="sm" onClick={() => setRenaming(null)}>
                        {t("sections.cancel")}
                      </Button>
                    </Cluster>
                  </form>
                ) : (
                  <Cluster gap="2">
                    <span className="pg-sections__name">{section.name}</span>
                    <span className="pg-sections__count">{t("sections.stories", { count: section.stories })}</span>
                    {edit && (
                      <>
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={busy || i === 0}
                          aria-label={t("sections.up", { name: section.name })}
                          onClick={() => void change(section.id, { position: i - 1 })}
                        >
                          {t("sections.upShort")}
                        </Button>
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={busy || i === inUse.length - 1}
                          aria-label={t("sections.down", { name: section.name })}
                          onClick={() => void change(section.id, { position: i + 1 })}
                        >
                          {t("sections.downShort")}
                        </Button>
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={busy}
                          aria-label={t("sections.rename", { name: section.name })}
                          onClick={() => setRenaming({ id: section.id, name: section.name })}
                        >
                          {t("sections.renameShort")}
                        </Button>
                        <Button
                          variant="quiet"
                          size="sm"
                          disabled={busy}
                          aria-label={t("sections.archive", { name: section.name })}
                          onClick={() => void change(section.id, { archived: true })}
                        >
                          {t("sections.archiveShort")}
                        </Button>
                      </>
                    )}
                  </Cluster>
                )}
              </li>
            ))}
          </ol>
        )}
        {archived.length > 0 && (
          <Stack gap="2">
            <h3 className="pg-sections__heading">{t("sections.archived")}</h3>
            <ul className="pg-sections">
              {archived.map((section) => (
                <li key={section.id} className="pg-sections__item">
                  <Cluster gap="2">
                    <span className="pg-sections__name">{section.name}</span>
                    <span className="pg-sections__count">{t("sections.stories", { count: section.stories })}</span>
                    {edit && (
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={busy}
                        aria-label={t("sections.restore", { name: section.name })}
                        onClick={() => void change(section.id, { archived: false })}
                      >
                        {t("sections.restoreShort")}
                      </Button>
                    )}
                  </Cluster>
                </li>
              ))}
            </ul>
          </Stack>
        )}
        {edit && (
          <form onSubmit={(event) => void add(event)}>
            <Cluster gap="2">
              <Field label={t("sections.add")}>
                <TextInput value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Button type="submit" disabled={busy || !name.trim()}>
                {t("sections.addButton")}
              </Button>
            </Cluster>
          </form>
        )}
      </Stack>
    </Panel>
  );
}
