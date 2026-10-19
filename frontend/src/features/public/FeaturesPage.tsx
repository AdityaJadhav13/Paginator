/**
 * `/features` — the full workflow treatment the homepage condenses (§15).
 *
 * Stage 1 is given greater weight than the six that follow; the six are not
 * six identical cards. "What this is not" deliberately sits before the
 * closing call to action, so the last substantive thing a reader sees is a
 * limit rather than a pitch.
 */
import { Link } from "react-router";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { t } from "./content.ts";
import { workflowStageViews, type WorkflowStageView } from "./workflow.ts";
import { StandingHead } from "./StandingHead.tsx";
import { Section } from "./Section.tsx";
import { CapabilityNote } from "./CapabilityNote.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { ClosingBand } from "./ClosingBand.tsx";
import { TodayList } from "./TodayList.tsx";

const NON_GOALS = [
  { name: "limit-dashboard-name", body: "limit-dashboard-body" },
  { name: "limit-republication-name", body: "limit-republication-body" },
  { name: "limit-oracle-name", body: "limit-oracle-body" },
  { name: "limit-indesign-name", body: "limit-indesign-body" },
  { name: "limit-crm-name", body: "limit-crm-body" },
  { name: "limit-press-name", body: "limit-press-body" },
] as const;

function Stage({ stage, lead }: { readonly stage: WorkflowStageView; readonly lead: boolean }) {
  return (
    <article
      className={["pg-public__stage", lead ? "pg-public__stage--lead" : null]
        .filter(Boolean)
        .join(" ")}
    >
      <h3 className="pg-public__item-title">
        <span className="pg-public__sequence-ordinal" aria-hidden="true">
          {stage.number}
        </span>{" "}
        {stage.name}
      </h3>
      <p className="pg-public__body">{stage.description}</p>
      <div className="pg-public__constraint">
        <p className="pg-public__constraint-label">{t("features-constraint-label")}</p>
        <p className="pg-public__body">{stage.constraint}</p>
      </div>
      <CapabilityNote label={stage.availabilityLabel} />
      <p className="pg-public__note">{stage.ownerCaption}</p>
    </article>
  );
}

export function FeaturesPage() {
  const [first, ...rest] = workflowStageViews();

  return (
    <div className="pg-public">
      {/* Page title and lead */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__page-title">
            {t("features-title")}
          </h1>
          <div className="pg-public__grid">
            <div className="pg-public__span-7">
              <p className="pg-public__lead">{t("features-lead-1")}</p>
              <p className="pg-public__lead">{t("features-lead-2")}</p>
              <div className="pg-public__actions">
                <PrimaryCta />
              </div>
            </div>
            <div className="pg-public__span-5 pg-public__hero-aside">
              <p className="pg-public__note">{t("qualification-standing")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* The seven stages in full */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <StandingHead
            label={t("features-stages-standing")}
            title={t("home-workflow-title")}
            level={2}
          />
          {first && (
            <div className="pg-public__grid">
              <div className="pg-public__span-8">
                <Stage stage={first} lead />
              </div>
            </div>
          )}
          <div className="pg-public__grid">
            {rest.map((stage) => (
              <div key={stage.key} className="pg-public__span-4">
                <Stage stage={stage} lead={false} />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What this is not — before the closing CTA, on purpose */}
      <section className="pg-public__band pg-public__band--subtle">
        <div className="pg-public__measure">
          <StandingHead label={t("limits-standing")} title={t("limits-title")} level={2} />
          <div className="pg-public__grid">
            {NON_GOALS.map((goal) => (
              <div key={goal.name} className="pg-public__span-4">
                <h3 className="pg-public__item-title">{t(goal.name)}</h3>
                <p className="pg-public__body">{t(goal.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* What actually works today — the same three records the homepage uses */}
      <Section label={t("today-standing")} title={t("today-title")}>
        <p className="pg-public__lead">{t("today-lead")}</p>
        <TodayList />
        <p className="pg-public__body">{t("today-closing")}</p>
        <p className="pg-public__actions">
          <Link to={paths.security()}>{t("cta-secondary-security")}</Link>
        </p>
      </Section>

      <ClosingBand />
    </div>
  );
}
