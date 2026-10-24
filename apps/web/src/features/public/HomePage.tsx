/**
 * `/` — the landing page (03 §4.2), in this order:
 *   1. the hero, with one primary action (Book a demo) and the page-structure diagram;
 *   2. proof facts, each with its source;
 *   3. the seven-stage workflow, each stage with its state today;
 *   4. Built for Marathi newspapers, with a fictional Devanagari example;
 *   5. What Pageinator will not be;
 *   6. the security and privacy summary;
 *   7. the closing band (Book a demo again).
 */
import { Link } from "react-router";
import { paths, ROUTE_HEADING_ID } from "../../app/routes.ts";
import { StandingHead } from "./StandingHead.tsx";
import { Section } from "./Section.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { PageGeometryFigure } from "./PageGeometryFigure.tsx";
import { ClosingBand } from "./ClosingBand.tsx";
import { ProofFacts } from "./ProofFacts.tsx";
import { WorkflowSequence } from "./WorkflowSequence.tsx";
import { MarathiShowcase } from "./MarathiShowcase.tsx";
import { LimitsGrid } from "./LimitsGrid.tsx";
import { CapabilityNote } from "./CapabilityNote.tsx";
import { usePublicText } from "./usePublicText.ts";

const SECURITY_FACTS = ["security-separate", "security-audit", "security-two-step"] as const;

export function HomePage() {
  const { t } = usePublicText();

  return (
    <div className="pg-public">
      {/* 1 — hero */}
      <section className="pg-public__band pg-public__hero-band">
        <div className="pg-public__measure">
          <div className="pg-public__grid pg-public__hero">
            <div className="pg-public__span-7 pg-public__hero-text">
              <p className="pg-standing-head__label">{t("home-hero-standing")}</p>
              <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__hero-title">
                {t("home-hero-title")}
              </h1>
              <p className="pg-public__lead">{t("home-hero-lead")}</p>
              <div className="pg-public__actions">
                <PrimaryCta />
                <Link to={paths.features()}>{t("cta-stages")}</Link>
              </div>
              <p className="pg-public__hero-aside">{t("home-hero-aside")}</p>
            </div>
            <div className="pg-public__span-5 pg-public__hero-figure">
              <PageGeometryFigure />
            </div>
          </div>
        </div>
      </section>

      {/* 2 — proof facts */}
      <section className="pg-public__band pg-public__band--subtle">
        <div className="pg-public__measure">
          <StandingHead label={t("proof-standing")} title={t("proof-title")} level={2} />
          <p className="pg-public__lead">{t("proof-lead")}</p>
          <ProofFacts />
        </div>
      </section>

      {/* 3 — the workflow */}
      <section className="pg-public__band pg-public__band--ink">
        <div className="pg-public__measure">
          <StandingHead label={t("home-workflow-standing")} title={t("home-workflow-title")} level={2} />
          <p className="pg-public__lead">{t("home-workflow-lead")}</p>
          <WorkflowSequence />
          <p className="pg-public__actions">
            <Link to={paths.features()}>{t("cta-stages")}</Link>
          </p>
        </div>
      </section>

      {/* 4 — built for Marathi newspapers */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <StandingHead label={t("marathi-standing")} title={t("marathi-title")} level={2} />
          <div className="pg-public__grid">
            <div className="pg-public__span-5">
              <p className="pg-public__lead">{t("marathi-body-1")}</p>
              <p className="pg-public__body">{t("marathi-body-2")}</p>
            </div>
            <div className="pg-public__span-7">
              <MarathiShowcase />
            </div>
          </div>
        </div>
      </section>

      {/* 5 — deliberate limits */}
      <LimitsGrid />

      {/* 6 — security and privacy */}
      <Section label={t("home-security-standing")} title={t("home-security-title")}>
        <ul className="pg-public__list">
          {SECURITY_FACTS.map((id) => (
            <li key={id} className="pg-public__list-item">
              <p className="pg-public__body">{t(id)}</p>
            </li>
          ))}
          <li className="pg-public__list-item">
            <p className="pg-public__body">{t("security-india")}</p>
            <CapabilityNote states={["planned"]} />
          </li>
        </ul>
        <p className="pg-public__actions">
          <Link to={paths.security()}>{t("cta-security")}</Link>
        </p>
      </Section>

      {/* 7 — closing */}
      <ClosingBand secondary="pricing" />
    </div>
  );
}
