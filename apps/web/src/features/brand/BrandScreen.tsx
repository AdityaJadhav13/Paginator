/**
 * Brand & masthead, /org/:orgId/pub/:pubId/brand (doc 07 §12 row "Brand"; packages/contracts/src/brand.ts). Only what is
 * real in this engine: the masthead and folio are the front template page's own, so the masthead is shown read-only, as
 * page 1 of the newest done layout run printed it (its preview, cropped to the top), with a link to the Templates
 * screen. The publication's display name and the edition defaults "Create edition" fills in (volume, price, next
 * issue number) are changed here by brand.edit; anyone on the publication sees them. A rename reloads the session's
 * access, so the chrome shows the new name.
 */
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";
import {
  Button,
  Field,
  PageHeader,
  Panel,
  ProgressIndicator,
  Stack,
  TextInput,
} from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { formatDate, formatDateTime } from "../../i18n/dates.ts";
import { useI18n } from "../../i18n/index.ts";
import type { ApiProblem, BrandDto } from "../../services/index.ts";
import { OfflineNotice } from "../auth/connection.tsx";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import { useEditions } from "../editions/editions-context.tsx";
import { useLayout } from "../layout/layout-context.tsx";
import { pageFile } from "../layout/layout-words.tsx";
import { may } from "../people/navigation.ts";
import "./brand.css";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "failed"; readonly problem: ApiProblem }
  | { readonly status: "ready"; readonly brand: BrandDto };

export function BrandScreen() {
  const { orgId = "", pubId = "" } = useParams<{ orgId: string; pubId: string }>();
  const { state } = useSession();
  const { t } = useI18n();
  const org =
    state.status === "ready"
      ? state.workspace?.organizations.find((candidate) => candidate.org.id === orgId)
      : undefined;
  const publication = org?.publications.find((candidate) => candidate.id === pubId);
  // the API refuses every screen of the organisation (403 two_step_required) until this session has two-step
  const open = !!org && !(org.twoStep.required && !org.twoStep.satisfied);
  return (
    <Stack gap="5">
      <PageHeader
        title={t("nav.brand")}
        headingId={ROUTE_HEADING_ID}
        {...(publication ? { subtitle: publication.name } : {})}
      />
      <OfflineNotice />
      {open && (
        <BrandContent
          orgId={orgId}
          pubId={pubId}
          edit={may(org, "brand.edit", pubId)}
          templates={may(org, "templates.view", pubId)}
        />
      )}
    </Stack>
  );
}

function BrandContent({
  orgId,
  pubId,
  edit,
  templates,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly edit: boolean;
  readonly templates: boolean;
}) {
  const editions = useEditions();
  const { t } = useI18n();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const fetchBrand = useCallback(async () => {
    const result = await editions.brand({ orgId, pubId });
    setLoad(result.ok ? { status: "ready", brand: result.value } : { status: "failed", problem: result.error });
  }, [editions, orgId, pubId]);
  useEffect(() => {
    setLoad({ status: "loading" });
    void fetchBrand();
  }, [fetchBrand]);

  if (load.status === "loading") return <ProgressIndicator role="status" label={t("brand.loading")} />;
  if (load.status === "failed") {
    return (
      <Stack gap="3">
        <ProblemMessage problem={load.problem} />
        {!(load.problem.kind === "answer" && load.problem.status === 403) && (
          <div>
            <Button variant="secondary" onClick={() => void fetchBrand()}>
              {t("form.retry")}
            </Button>
          </div>
        )}
      </Stack>
    );
  }
  return (
    <div className="pg-brand">
      <Masthead orgId={orgId} pubId={pubId} brand={load.brand} templates={templates} />
      <BrandForm
        orgId={orgId}
        pubId={pubId}
        brand={load.brand}
        edit={edit}
        onSaved={(brand) => setLoad({ status: "ready", brand })}
      />
    </div>
  );
}

/** Page 1 of the newest done run, cropped to its top: the masthead as the paper last printed it. */
function Masthead({
  orgId,
  pubId,
  brand,
  templates,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly brand: BrandDto;
  readonly templates: boolean;
}) {
  const layout = useLayout();
  const { t, language } = useI18n();
  const source = brand.masthead;
  const [picture, setPicture] = useState<{ readonly url: string } | "failed" | null>(null);
  useEffect(() => {
    if (!source) return;
    const stop = new AbortController();
    let made: string | null = null;
    setPicture(null);
    void layout
      .loadFile({ orgId, pubId, runId: source.runId, name: pageFile(1, "png"), signal: stop.signal })
      .then((result) => {
        if (stop.signal.aborted) return;
        if (!result.ok) return setPicture("failed");
        made = URL.createObjectURL(result.value);
        setPicture({ url: made });
      });
    return () => {
      stop.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [layout, orgId, pubId, source]);
  const date = source ? formatDate(source.editionDate, language) : "";
  return (
    <Panel title={t("brand.masthead.heading")} className="pg-brand__masthead">
      <Stack gap="3">
        <p>{t("brand.masthead.explain")}</p>
        {!source && <p>{t("brand.masthead.none")}</p>}
        {source && (
          <>
            <p className="pg-brand__meta">
              {t("brand.masthead.from", { date, time: formatDateTime(source.finishedAt, language) })}
            </p>
            <div className="pg-brand__crop">
              {picture === null && <ProgressIndicator role="status" label={t("brand.loading")} />}
              {picture === "failed" && <p>{t("brand.masthead.noPreview")}</p>}
              {picture !== null && picture !== "failed" && (
                <img src={picture.url} alt={t("brand.masthead.alt", { date })} />
              )}
            </div>
          </>
        )}
        {templates && (
          <p>
            <Link to={paths.pubTemplates(orgId, pubId)}>{t("brand.masthead.templates")}</Link>
          </p>
        )}
      </Stack>
    </Panel>
  );
}

const ISSUE = /^\d{1,6}$/;
/** The words the engine's folio looks for (tools/desk/engine/deskfolio.py): the template's own, in Marathi. */
const FOLIO_WORDS = "वर्ष, अंक, किंमत";

function BrandForm({
  orgId,
  pubId,
  brand,
  edit,
  onSaved,
}: {
  readonly orgId: string;
  readonly pubId: string;
  readonly brand: BrandDto;
  readonly edit: boolean;
  readonly onSaved: (brand: BrandDto) => void;
}) {
  const editions = useEditions();
  const { refresh } = useSession();
  const { t } = useI18n();
  const [name, setName] = useState(brand.name);
  const [volume, setVolume] = useState(brand.defaults.volume);
  const [price, setPrice] = useState(brand.defaults.price);
  const [nextIssue, setNextIssue] = useState(brand.defaults.nextIssue === null ? "" : String(brand.defaults.nextIssue));
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);
  const [errors, setErrors] = useState<{ name: boolean; issue: boolean }>({ name: false, issue: false });
  const [saved, setSaved] = useState(false);

  if (!edit) {
    const shown = (value: string) => value || t("brand.notSet");
    return (
      <Panel title={t("brand.settings.heading")} className="pg-brand__form">
        <Stack gap="3">
          <p>{t("brand.defaults.explain", { words: FOLIO_WORDS })}</p>
          <dl className="pg-brand__facts">
            <dt>{t("brand.name.label")}</dt>
            <dd>{brand.name}</dd>
            <dt>{t("brand.defaults.volume")}</dt>
            <dd>{shown(brand.defaults.volume)}</dd>
            <dt>{t("brand.defaults.price")}</dt>
            <dd>{shown(brand.defaults.price)}</dd>
            <dt>{t("brand.defaults.nextIssue")}</dt>
            <dd>{brand.defaults.nextIssue === null ? t("brand.notSet") : brand.defaults.nextIssue}</dd>
          </dl>
        </Stack>
      </Panel>
    );
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setSaved(false);
    setProblem(null);
    const issue = nextIssue.trim();
    const wrong = { name: name.trim() === "", issue: issue !== "" && (!ISSUE.test(issue) || Number(issue) < 1) };
    setErrors(wrong);
    if (wrong.name || wrong.issue) return;
    setPending(true);
    const result = await editions.setBrand({
      orgId,
      pubId,
      input: { name, defaults: { volume, price, nextIssue: issue === "" ? null : Number(issue) } },
    });
    setPending(false);
    if (!result.ok) return setProblem(result.error);
    const renamed = result.value.name !== brand.name;
    setName(result.value.name);
    setVolume(result.value.defaults.volume);
    setPrice(result.value.defaults.price);
    setNextIssue(result.value.defaults.nextIssue === null ? "" : String(result.value.defaults.nextIssue));
    setSaved(true);
    onSaved(result.value);
    // the sidebar and headers read the name from the session's access
    if (renamed) void refresh();
  };

  return (
    <Panel title={t("brand.settings.heading")} className="pg-brand__form">
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Stack gap="4">
          <Field
            label={t("brand.name.label")}
            description={t("brand.name.hint")}
            required
            requiredLabel={t("form.required")}
            {...(errors.name ? { errors: [t("brand.name.required")] } : {})}
          >
            <TextInput value={name} maxLength={200} onChange={(event) => setName(event.target.value)} />
          </Field>
          <p>{t("brand.defaults.explain", { words: FOLIO_WORDS })}</p>
          <Field label={t("brand.defaults.volume")}>
            <TextInput value={volume} maxLength={40} onChange={(event) => setVolume(event.target.value)} />
          </Field>
          <Field label={t("brand.defaults.price")}>
            <TextInput value={price} maxLength={40} onChange={(event) => setPrice(event.target.value)} />
          </Field>
          <Field
            label={t("brand.defaults.nextIssue")}
            description={t("brand.defaults.nextIssue.hint")}
            {...(errors.issue ? { errors: [t("brand.defaults.nextIssue.invalid")] } : {})}
          >
            <TextInput
              value={nextIssue}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setNextIssue(event.target.value)}
            />
          </Field>
          <div>
            <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>
              {pending ? t("brand.saving") : t("brand.save")}
            </Button>
          </div>
          <div aria-live="polite">{saved && <p>{t("brand.saved")}</p>}</div>
          {problem && <ProblemMessage problem={problem} />}
        </Stack>
      </form>
    </Panel>
  );
}
