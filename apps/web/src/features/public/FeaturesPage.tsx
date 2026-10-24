/**
 * `/features` (03 §4.2): one block per stage (Plan · Content · Generate · Edit · Check · Print · Archive), each with
 * what it does and what is live today; then the newsroom app, which is being prepared for a pilot; then the limits.
 */
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { StandingHead } from "./StandingHead.tsx";
import { Section } from "./Section.tsx";
import { CapabilityNote } from "./CapabilityNote.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { ClosingBand } from "./ClosingBand.tsx";
import { LimitsGrid } from "./LimitsGrid.tsx";
import { stageIds, WORKFLOW_STAGES, type WorkflowStage } from "./workflow.ts";
import { usePublicText } from "./usePublicText.ts";

const NEWSROOM = [
  "newsroom-accounts",
  "newsroom-filing",
  "newsroom-server",
  "newsroom-desk",
  "newsroom-languages",
] as const;

function Stage({ stage }: { readonly stage: WorkflowStage }) {
  const { t, digits } = usePublicText();
  const ids = stageIds(stage);
  return (
    <article className="pg-public__stage">
      <h3 className="pg-public__item-title">
        <span className="pg-public__sequence-ordinal" aria-hidden="true">
          {digits(stage.number)}
        </span>{" "}
        {t(ids.name)}
      </h3>
      <p className="pg-public__body">{t(ids.description)}</p>
      <div className="pg-public__constraint">
        <p className="pg-public__constraint-label">{t("workflow-today-label")}</p>
        <p className="pg-public__body">{t(ids.today)}</p>
      </div>
      <CapabilityNote states={stage.states} />
    </article>
  );
}

export function FeaturesPage() {
  const { t } = usePublicText();
  return (
    <div className="pg-public">
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__page-title">
            {t("features-title")}
          </h1>
          <p className="pg-public__lead">{t("features-lead")}</p>
          <div className="pg-public__actions">
            <PrimaryCta />
          </div>
        </div>
      </section>

      <section className="pg-public__band">
        <div className="pg-public__measure">
          <StandingHead label={t("features-stages-standing")} title={t("home-workflow-title")} level={2} />
          <p className="pg-public__lead">{t("home-workflow-lead")}</p>
          <div className="pg-public__grid">
            {WORKFLOW_STAGES.map((stage) => (
              <div key={stage.key} className="pg-public__span-4">
                <Stage stage={stage} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <Section label={t("newsroom-standing")} title={t("newsroom-title")} tone="subtle">
        <p className="pg-public__lead">{t("newsroom-lead")}</p>
        <ul className="pg-public__list">
          {NEWSROOM.map((id) => (
            <li key={id} className="pg-public__list-item">
              <p className="pg-public__body">{t(id)}</p>
            </li>
          ))}
        </ul>
      </Section>

      <LimitsGrid />

      <ClosingBand secondary="security" />
    </div>
  );
}
