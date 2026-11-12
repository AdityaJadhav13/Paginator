/**
 * /onboarding: a new paper's Owner lands here after their first sign-in (the approval email's link is
 * /login?returnTo=/onboarding). Step 1 shows the first publication that the approval made: its name (changed on the
 * Brand & masthead screen) and its languages (shown only: no route changes them yet). Step 2 leads to setting up the
 * paper's design, on the Templates screen.
 *
 * The paper is the active organisation when its person owns it, otherwise the first organisation they own; its
 * publication is the active one there, otherwise its first. Someone who owns no paper is told so.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { InlineMessage, Panel, Stack, Button } from "../../ui/index.ts";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { LANGUAGE_NAMES, useI18n, type Language } from "../../i18n/index.ts";
import type { ApiProblem, PaperDetailsDto, PaperSignupService } from "../../services/index.ts";
import { ProblemMessage } from "../auth/ProblemMessage.tsx";
import { useSession } from "../auth/SessionProvider.tsx";
import "./paper-onboarding.css";
import { TwoStepNeeded } from "../people/TwoStepNeeded.tsx";

const languageName = (code: string) =>
  Object.hasOwn(LANGUAGE_NAMES, code) ? LANGUAGE_NAMES[code as Language] : code;

type Loaded = { readonly paper: PaperDetailsDto } | { readonly problem: ApiProblem } | null;

export function PaperOnboardingScreen({ service }: { readonly service: PaperSignupService }) {
  const { t } = useI18n();
  const { state } = useSession();
  const workspace = state.status === "ready" ? state.workspace : null;
  const owned = workspace?.organizations.filter((org) => org.orgRole === "owner") ?? [];
  const org = owned.find((candidate) => candidate.org.id === workspace?.activeOrganizationId) ?? owned[0];
  const pub = org?.publications.find((p) => p.id === workspace?.activePublicationId) ?? org?.publications[0];
  const orgId = org?.org.id ?? "";
  const pubId = pub?.id ?? "";
  const blocked = org !== undefined && org.twoStep.required && !org.twoStep.satisfied;
  const [loaded, setLoaded] = useState<Loaded>(null);

  const load = useCallback(async () => {
    setLoaded(null);
    const result = await service.paper(orgId, pubId);
    setLoaded(result.ok ? { paper: result.value } : { problem: result.error });
  }, [service, orgId, pubId]);

  useEffect(() => {
    if (orgId && pubId && !blocked) void load();
  }, [load, orgId, pubId, blocked]);

  const heading = (
    <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-type-page-title">
      {t("paperOnboarding.title")}
    </h1>
  );

  let body;
  if (state.status === "loading") body = <p role="status">{t("paperOnboarding.loading")}</p>;
  else if (state.status !== "ready") {
    body = (
      <p>
        {t("paperOnboarding.signedOut")}{" "}
        <Link to={`${paths.login()}?returnTo=${encodeURIComponent(paths.onboarding())}`}>{t("glossary.signIn")}</Link>
      </p>
    );
  } else if (!org || !pub) {
    body = (
      <InlineMessage variant="info" heading={t("paperOnboarding.noPaper.heading")} iconLabel={t("message.info")}>
        {t("paperOnboarding.noPaper.body")}
      </InlineMessage>
    );
  } else if (blocked) {
    body = <TwoStepNeeded org={org} />;
  } else if (loaded === null) {
    body = <p role="status">{t("paperOnboarding.loading")}</p>;
  } else if ("problem" in loaded) {
    body = (
      <Stack gap="3">
        <ProblemMessage problem={loaded.problem} />
        <div>
          <Button variant="secondary" onClick={() => void load()}>
            {t("paperOnboarding.retry")}
          </Button>
        </div>
      </Stack>
    );
  } else {
    const { paper } = loaded;
    body = (
      <Stack gap="5">
        <p>{t("paperOnboarding.lede")}</p>
        <Panel title={t("paperOnboarding.step1")}>
          <Stack gap="3">
            <dl className="pg-paper-onboarding__details">
              <dt>{t("paperOnboarding.name")}</dt>
              <dd>{paper.name}</dd>
              <dt>{t("paperOnboarding.languages")}</dt>
              <dd>{paper.languages.map(languageName).join(", ")}</dd>
              <dt>{t("paperOnboarding.primary")}</dt>
              <dd>{languageName(paper.primaryLanguage)}</dd>
            </dl>
            <p>
              <Link to={paths.pubBrand(orgId, pubId)}>{t("paperOnboarding.changeName")}</Link>
            </p>
            <p className="pg-type-body-small">
              {t("paperOnboarding.languagesNote")} <Link to={paths.contact()}>{t("public.nav.contact")}</Link>
            </p>
          </Stack>
        </Panel>
        <Panel title={t("paperOnboarding.step2")}>
          <Stack gap="3">
            <p>{t("paperOnboarding.step2Body")}</p>
            <div>
              <Link className="pg-button pg-button--primary pg-button--md" to={paths.pubTemplates(orgId, pubId)}>
                {t("paperOnboarding.design")}
              </Link>
            </div>
          </Stack>
        </Panel>
        <p>
          <Link to={paths.orgHome(orgId)}>{t("paperOnboarding.later")}</Link>
        </p>
      </Stack>
    );
  }

  return (
    <div className="pg-paper-onboarding">
      <Stack gap="5">
        {heading}
        {body}
      </Stack>
    </div>
  );
}
