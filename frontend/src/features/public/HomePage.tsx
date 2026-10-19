/**
 * `/` — the landing surface (§12).
 *
 * Seven regions in a fixed DOM order. The homepage carries a condensed form
 * of each other surface; full treatments live on their own routes. Region 2
 * exists specifically so a reader cannot get past the opening believing the
 * product runs.
 */
import { Link } from "react-router";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { t } from "./content.ts";
import { workflowStageViews } from "./workflow.ts";
import { StandingHead } from "./StandingHead.tsx";
import { Section } from "./Section.tsx";
import { CapabilityNote } from "./CapabilityNote.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { PageGeometryFigure } from "./PageGeometryFigure.tsx";
import { ClosingBand } from "./ClosingBand.tsx";
import { TodayList } from "./TodayList.tsx";

const LIMITS = [
  { name: "limit-dashboard-name", body: "limit-dashboard-body" },
  { name: "limit-indesign-name", body: "limit-indesign-body" },
  { name: "limit-press-name", body: "limit-press-body" },
] as const;

export function HomePage() {
  const stages = workflowStageViews();

  return (
    <div className="pg-public">
      {/* Region 1 — hero */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <div className="pg-public__hero">
            <h1
              id={ROUTE_HEADING_ID}
              tabIndex={-1}
              className="pg-public__hero-title"
            >
              {t("home-hero-title")}
            </h1>
            <div className="pg-public__grid">
              <div className="pg-public__span-7">
                <p className="pg-public__lead">{t("home-hero-lead-1")}</p>
                <p className="pg-public__lead">{t("home-hero-lead-2")}</p>
                <div className="pg-public__actions">
                  <PrimaryCta />
                  <Link to={paths.features()}>{t("cta-secondary-workflow")}</Link>
                </div>
              </div>
              <div className="pg-public__span-5 pg-public__hero-aside">
                <p className="pg-public__note">{t("qualification-standing")}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Region 2 — what actually works today */}
      <Section label={t("today-standing")} title={t("today-title")} tone="subtle">
        <p className="pg-public__lead">{t("today-lead")}</p>
        <TodayList />
        <p className="pg-public__body">{t("today-closing")}</p>
      </Section>

      {/* Region 3 — the workflow, as an editorial index */}
      <section className="pg-public__band pg-public__band--ink">
        <div className="pg-public__measure">
          <StandingHead
            label={t("home-workflow-standing")}
            title={t("home-workflow-title")}
            level={2}
          />
          <p className="pg-public__lead">{t("home-workflow-lead")}</p>
          <ol className="pg-public__sequence">
            {stages.map((stage) => (
              <li key={stage.key} className="pg-public__sequence-item">
                <p className="pg-public__sequence-name">
                  <span className="pg-public__sequence-ordinal" aria-hidden="true">
                    {stage.number}
                  </span>
                  {stage.name}
                </p>
                <p className="pg-public__body">{stage.description}</p>
                <CapabilityNote label={stage.availabilityLabel} />
              </li>
            ))}
          </ol>
          <p className="pg-public__actions">
            <Link to={paths.features()}>{t("cta-secondary-workflow-full")}</Link>
          </p>
        </div>
      </section>

      {/* Region 4 — why newspaper structure is the problem */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <StandingHead
            label={t("home-structure-standing")}
            title={t("home-structure-title")}
            level={2}
          />
          <div className="pg-public__grid">
            <div className="pg-public__span-5">
              <PageGeometryFigure />
            </div>
            <div className="pg-public__span-7">
              <p className="pg-public__body">{t("home-structure-body-1")}</p>
              <p className="pg-public__body">{t("home-structure-body-2")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Region 5 — deliberate limits */}
      <section className="pg-public__band pg-public__band--subtle">
        <div className="pg-public__measure">
          <StandingHead label={t("limits-standing")} title={t("limits-title")} level={2} />
          <div className="pg-public__grid">
            {LIMITS.map((limit) => (
              <div key={limit.name} className="pg-public__span-4">
                <h3 className="pg-public__item-title">{t(limit.name)}</h3>
                <p className="pg-public__body">{t(limit.body)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Region 6 — the two open questions */}
      <Section
        label={t("home-provisional-standing")}
        title={t("home-provisional-title")}
      >
        <div className="pg-public__block">
          <h3 className="pg-public__item-title">
            {t("home-provisional-pricing-title")}
          </h3>
          <p className="pg-public__body">{t("home-provisional-pricing-body")}</p>
          <p className="pg-public__actions">
            <Link to={paths.pricing()}>{t("cta-secondary-pricing")}</Link>
          </p>
        </div>
        <div className="pg-public__block">
          <h3 className="pg-public__item-title">
            {t("home-provisional-security-title")}
          </h3>
          <p className="pg-public__body">{t("home-provisional-security-body")}</p>
          <p className="pg-public__actions">
            <Link to={paths.security()}>{t("cta-secondary-security")}</Link>
          </p>
        </div>
      </Section>

      {/* Region 7 — closing call to action */}
      <ClosingBand />
    </div>
  );
}
