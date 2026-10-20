/**
 * The closing call-to-action band every public surface ends with (§12
 * region 7, §15 block 5, §16.2 block 7, §17.2 block 7, §18).
 *
 * Shared rather than repeated so the primary CTA appears in exactly two
 * positions per surface — the opening region and this band — with one
 * label and one destination (§20.1).
 */
import { Link } from "react-router";
import { paths } from "../../app/routes.ts";
import { t } from "./content.ts";
import { StandingHead } from "./StandingHead.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";

export function ClosingBand() {
  return (
    <section className="pg-public__band pg-public__band--ink">
      <div className="pg-public__measure">
        <StandingHead label={t("closing-standing")} title={t("closing-title")} level={2} />
        <p className="pg-public__lead">{t("closing-body")}</p>
        <p className="pg-public__note">{t("qualification-standing")}</p>
        <div className="pg-public__actions">
          <PrimaryCta />
          <Link to={paths.contact()}>{t("cta-secondary-contact")}</Link>
        </div>
      </div>
    </section>
  );
}
