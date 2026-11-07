/** "What Pageinator will not be": the deliberate limits, shared by `/` and `/features`. */
import { StandingHead } from "./StandingHead.tsx";
import { usePublicText } from "./usePublicText.ts";

const LIMITS = ["ai", "design", "press", "claims"] as const;

export function LimitsGrid() {
  const { t } = usePublicText();
  return (
    <section className="pg-public__band pg-public__band--subtle">
      <div className="pg-public__measure">
        <StandingHead label={t("limits-standing")} title={t("limits-title")} level={2} />
        <div className="pg-public__grid">
          {LIMITS.map((key) => (
            <div key={key} className="pg-public__span-6 pg-public__limit">
              <h3 className="pg-public__item-title">{t(`limit-${key}-name`)}</h3>
              <p className="pg-public__body">{t(`limit-${key}-body`)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
