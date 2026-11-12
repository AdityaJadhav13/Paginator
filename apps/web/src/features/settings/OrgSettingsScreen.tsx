/**
 * Organization settings, /org/:orgId/settings (doc 07 §13 "Organization"; @pageinator/contracts settings.ts), for Owner
 * and Admin (org.settings). Only what works end to end: the organisation's name; its publications, each with a link
 * to its settings, and "Add publication" (name, languages, primary language, timezone). Billing is invoiced during
 * the pilot, so it is a plain line with the contact page. A rename or a new publication reloads the session's access,
 * so the chrome shows the new name and the new publication.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import { Button, Field, PageHeader, Panel, ProgressIndicator, Stack, TextInput } from "../../ui/index.ts";
import { NoAccess } from "../../app/NoAccess.tsx";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, OrgSettingsDto, SettingsService } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { may } from "../people/navigation.ts";
import { PublicationForm } from "./PublicationForm.tsx";
import "./settings.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly value: OrgSettingsDto };

export function OrgSettingsScreen({ settings }: { readonly settings: SettingsService }) {
  const { orgId = "" } = useParams<{ orgId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  // the API refuses every screen of the organisation (403 two_step_required) until this session has two-step
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  const allowed = open && may(org, "org.settings");
  return (
    <Stack gap="5">
      <PageHeader title={t("nav.orgSettings")} headingId={ROUTE_HEADING_ID} {...(org ? { subtitle: org.org.name } : {})} />
      <OfflineNotice />
      {allowed ? <OrgSettingsContent orgId={orgId} settings={settings} /> : open && <NoAccess />}
    </Stack>
  );
}

function OrgSettingsContent({ orgId, settings }: { readonly orgId: string; readonly settings: SettingsService }) {
  const { t } = useI18n();
  const { refresh } = useSession();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const fetchSettings = useCallback(async () => {
    const result = await settings.getOrg({ orgId });
    setLoad(result.ok ? { status: "ready", value: result.value } : { status: "failed", problem: result.error });
  }, [orgId, settings]);
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
  const value = load.value;
  const changed = (next: OrgSettingsDto) => {
    setLoad({ status: "ready", value: next });
    // the sidebar, the publication switcher and the headers read names from the session's access
    void refresh();
  };
  return (
    <div className="pg-settings">
      <Panel title={t("settings.general.heading")}>
        <OrgNameForm orgId={orgId} settings={settings} name={value.name} onSaved={changed} />
      </Panel>
      <Panel title={t("settings.publications.heading")}>
        <Stack gap="4">
          <ul className="pg-settings__list">
            {value.publications.map((pub) => (
              <li key={pub.id}>
                <Link to={paths.pubSettings(orgId, pub.id)}>
                  <bdi>{pub.name}</bdi>
                </Link>{" "}
                <span className="pg-type-body-small">
                  {t("settings.publications.facts", { languages: pub.languages.join(", "), timezone: pub.timezone })}
                </span>
              </li>
            ))}
          </ul>
          <h3 className="pg-type-section-title">{t("settings.add.heading")}</h3>
          <PublicationForm
            initial={{ name: "", languages: ["mr"], primaryLanguage: "mr", timezone: "Asia/Kolkata" }}
            edit
            submitLabel={t("settings.add.submit")}
            pendingLabel={t("settings.add.pending")}
            doneLabel={(name) => t("settings.add.done", { name })}
            onSubmit={async (values) => {
              const result = await settings.addPublication({ orgId, publication: { ...values, languages: [...values.languages] } });
              if (!result.ok) return result;
              changed(result.value);
              return {
                ok: true,
                value: {
                  name: values.name.trim(),
                  reset: { name: "", languages: ["mr"], primaryLanguage: "mr", timezone: "Asia/Kolkata" },
                },
              };
            }}
          />
        </Stack>
      </Panel>
      <Panel title={t("settings.billing.heading")}>
        <p>
          {t("settings.billing.text")} <Link to={paths.contact()}>{t("settings.billing.contact")}</Link>
        </p>
      </Panel>
    </div>
  );
}

function OrgNameForm({
  orgId,
  settings,
  name: saved,
  onSaved,
}: {
  readonly orgId: string;
  readonly settings: SettingsService;
  readonly name: string;
  readonly onSaved: (value: OrgSettingsDto) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(saved);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [missing, setMissing] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setDone(false);
    setProblem(null);
    setMissing(name.trim() === "");
    if (name.trim() === "") return;
    setPending(true);
    const result = await settings.renameOrg({ orgId, name });
    setPending(false);
    if (!result.ok) return setProblem(result.error);
    setName(result.value.name);
    setDone(true);
    onSaved(result.value);
  };
  return (
    <form onSubmit={(event) => void submit(event)} noValidate>
      <Stack gap="4">
        <Field
          label={t("settings.org.name")}
          required
          requiredLabel={t("form.required")}
          {...(missing ? { errors: [t("settings.name.required")] } : {})}
        >
          <TextInput value={name} maxLength={200} onChange={(event) => (setName(event.target.value), setDone(false))} />
        </Field>
        <div>
          <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>
            {pending ? t("settings.saving") : t("settings.save")}
          </Button>
        </div>
        <div aria-live="polite">{done && <p>{t("settings.saved")}</p>}</div>
        {problem && <ProblemMessage problem={problem} />}
      </Stack>
    </form>
  );
}
