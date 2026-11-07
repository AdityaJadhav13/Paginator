/**
 * Publication settings, /org/:orgId/pub/:pubId/publication-settings (doc 07 §13 "Publication settings";
 * @pageinator/contracts settings.ts): the publication's name, languages, primary language and timezone, read with
 * settings.view (Chief Editor, Editor, Prepress, Owner, Admin) and changed with settings.edit (Chief Editor, Owner,
 * Admin); and its sections (SectionsPanel). Only fields the product reads are here: the languages bound a story's
 * language, and the timezone is the one ad cut-offs and layout runs are timed in. A rename reloads the session's access.
 */
import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router";
import { Button, PageHeader, Panel, ProgressIndicator, Stack } from "../../ui/index.ts";
import { NoAccess } from "../../app/NoAccess.tsx";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, PublicationSettingsDto, SettingsService } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { SectionsPanel } from "../layout/SectionsPanel.tsx";
import { may } from "../people/navigation.ts";
import { PublicationForm } from "./PublicationForm.tsx";
import "./settings.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly value: PublicationSettingsDto };

export function PublicationSettingsScreen({ settings }: { readonly settings: SettingsService }) {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  const view = open && may(org, "settings.view", pubId);
  return (
    <Stack gap="5">
      <PageHeader
        title={t("nav.publicationSettings")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
      />
      <OfflineNotice />
      {view ? (
        <Content orgId={orgId} pubId={pubId} edit={may(org, "settings.edit", pubId)} settings={settings} />
      ) : (
        open && <NoAccess />
      )}
    </Stack>
  );
}

function Content({
  orgId,
  pubId,
  edit,
  settings,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly edit: boolean;
  readonly settings: SettingsService;
}) {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const fetchSettings = useCallback(async () => {
    const result = await settings.getPublication({ orgId, pubId });
    setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error });
  }, [orgId, pubId, settings]);
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchSettings();
  }, [fetchSettings]);

  if (load.status === "loading") return <ProgressIndicator role="status" label={t("settings.loading")} />;
  if (load.status === "failed") {
    return (
      <Stack gap="3">
        <ProblemMessage problem={load.problem} />
        <div>
          <Button variant="secondary" onClick={() => void fetchSettings()}>
            {t("form.retry")}
          </Button>
        </div>
      </Stack>
    );
  }
  const now = load.value;
  return (
    <div className="pg-settings">
      <Panel title={t("settings.pub.heading")}>
        <PublicationForm
          key={now.id}
          initial={now}
          edit={edit}
          submitLabel={t("settings.save")}
          pendingLabel={t("settings.saving")}
          doneLabel={() => t("settings.saved")}
          onSubmit={async (values) => {
            const result = await settings.setPublication({
              orgId,
              pubId,
              // only the fields the API takes: the form's values also carry the publication's id (a strict body)
              change: {
                name: values.name,
                languages: [...values.languages],
                primaryLanguage: values.primaryLanguage,
                timezone: values.timezone,
              },
            });
            if (!result.ok) return result;
            if (result.value.name !== now.name) void refresh(); // the chrome reads the name from the session's access
            setLoad({ status: "ready", value: result.value });
            return { ok: true, value: { name: result.value.name, reset: result.value } };
          }}
        />
      </Panel>
      <SectionsPanel orgId={orgId} pubId={pubId} edit={edit} />
    </div>
  );
}
