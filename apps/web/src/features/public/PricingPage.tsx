/**
 * `/pricing` (03 §4.2): "Pilot pricing by conversation", and what a pilot would include, until plans and prices are
 * decided (OP09). No price, currency, figure, tier or purchase control appears here.
 */
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { Section } from "./Section.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { ClosingBand } from "./ClosingBand.tsx";
import { usePublicText } from "./usePublicText.ts";

const PILOT = ["pricing-pilot-measure", "pricing-pilot-desk", "pricing-pilot-fonts", "pricing-pilot-newsroom"] as const;

export function PricingPage() {
  const { t } = usePublicText();
  return (
    <div className="pg-public">
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__page-title">
            {t("pricing-title")}
          </h1>
          <p className="pg-public__lead">{t("pricing-lead")}</p>
          <p className="pg-public__body">{t("pricing-later")}</p>
          <div className="pg-public__actions">
            <PrimaryCta intent="pilot" />
          </div>
        </div>
      </section>

      <Section label={t("pricing-pilot-standing")} title={t("pricing-pilot-title")}>
        <ul className="pg-public__list">
          {PILOT.map((id) => (
            <li key={id} className="pg-public__list-item">
              <p className="pg-public__body">{t(id)}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section label={t("pricing-excluded-standing")} title={t("pricing-excluded-title")} tone="subtle">
        <p className="pg-public__body">{t("pricing-excluded-body")}</p>
      </Section>

      <ClosingBand secondary="stages" />
    </div>
  );
}
