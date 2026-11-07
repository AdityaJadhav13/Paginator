/**
 * The closing band every public page but /contact ends with (03 §4.2 "closing CTA"): the primary call to action again,
 * so it appears twice on a page, at the top and here, with one label and one destination.
 */
import { Link } from "react-router";
import { paths } from "../../app/routes.ts";
import { StandingHead } from "./StandingHead.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { usePublicText } from "./usePublicText.ts";

export function ClosingBand({ secondary = "security" }: { readonly secondary?: "security" | "pricing" | "stages" }) {
  const { t } = usePublicText();
  const link = {
    security: { to: paths.security(), id: "cta-security" },
    pricing: { to: paths.pricing(), id: "cta-pricing" },
    stages: { to: paths.features(), id: "cta-stages" },
  }[secondary];
  return (
    <section className="pg-public__band pg-public__band--ink pg-public__closing">
      <div className="pg-public__measure">
        <div className="pg-public__split">
          <StandingHead label={t("closing-standing")} title={t("closing-title")} level={2} />
          <div className="pg-public__split-body">
            <p className="pg-public__lead">{t("closing-body")}</p>
            <p className="pg-public__note">{t("closing-note")}</p>
            <div className="pg-public__actions">
              <PrimaryCta />
              <Link to={link.to}>{t(link.id)}</Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
