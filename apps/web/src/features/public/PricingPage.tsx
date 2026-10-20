/**
 * `/pricing` — an illustrative packaging hypothesis (§16).
 *
 * R02 records that packaging, buyer and price are unvalidated and OP09 is
 * open, so this page presents a shape, not an offer. Every tier renders the
 * literal "Not priced"; no currency, numeral, limit or purchase control
 * appears anywhere, and the open-decision block sits above the tiers rather
 * than below them.
 */
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { Surface } from "../../ui/index.ts";
import { t } from "./content.ts";
import { StandingHead } from "./StandingHead.tsx";
import { Section } from "./Section.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { ClosingBand } from "./ClosingBand.tsx";

interface Tier {
  readonly key: string;
  readonly name: string;
  readonly intent: string;
  readonly scope: readonly string[];
}

/**
 * Three tiers of identical visual weight. Nothing here may be marked
 * recommended, popular, or elevated — choosing is not possible.
 */
const TIERS: readonly Tier[] = [
  {
    key: "single",
    name: "pricing-tier-single-name",
    intent: "pricing-tier-single-intent",
    scope: [
      "pricing-tier-single-scope-1",
      "pricing-tier-single-scope-2",
      "pricing-tier-single-scope-3",
    ],
  },
  {
    key: "group",
    name: "pricing-tier-group-name",
    intent: "pricing-tier-group-intent",
    scope: [
      "pricing-tier-group-scope-1",
      "pricing-tier-group-scope-2",
      "pricing-tier-group-scope-3",
    ],
  },
  {
    key: "network",
    name: "pricing-tier-network-name",
    intent: "pricing-tier-network-intent",
    scope: [
      "pricing-tier-network-scope-1",
      "pricing-tier-network-scope-2",
      "pricing-tier-network-scope-3",
    ],
  },
];

export function PricingPage() {
  return (
    <div className="pg-public">
      {/* Page title and lead */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__page-title">
            {t("pricing-title")}
          </h1>
          <div className="pg-public__grid">
            <div className="pg-public__span-7">
              <p className="pg-public__lead">{t("pricing-lead-1")}</p>
              <p className="pg-public__lead">{t("pricing-lead-2")}</p>
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

      {/* The open-decision block — above the tiers, not below */}
      <Section
        label={t("pricing-open-standing")}
        title={t("pricing-open-title")}
        tone="subtle"
      >
        <Surface as="div">
          <p className="pg-public__body">{t("pricing-open-1")}</p>
          <p className="pg-public__body">{t("pricing-open-2")}</p>
          <p className="pg-public__body">{t("pricing-open-3")}</p>
        </Surface>
      </Section>

      {/* The three illustrative tiers */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <StandingHead
            label={t("pricing-tiers-standing")}
            title={t("pricing-tiers-title")}
            level={2}
          />
          <ul className="pg-public__tiers">
            {TIERS.map((tier) => (
              <li key={tier.key} className="pg-public__tier">
                <h3 className="pg-public__item-title">{t(tier.name)}</h3>
                <p className="pg-public__note">{t("pricing-tier-caption")}</p>
                <p className="pg-public__tier-price">{t("pricing-tier-price")}</p>
                <p className="pg-public__body">{t(tier.intent)}</p>
                <p className="pg-public__constraint-label">{t("pricing-scope-heading")}</p>
                <ul className="pg-public__tier-scope">
                  {tier.scope.map((id) => (
                    <li key={id}>{t(id)}</li>
                  ))}
                </ul>
                {/*
                 * No per-tier action control at all.
                 *
                 * §16.2 item 5 and §20.1/AC-19 conflict here: the first asks
                 * each tier to carry the primary CTA, the second requires the
                 * primary CTA to appear in exactly two places per surface and
                 * "nowhere else". Rendering no tier action satisfies §16.2's
                 * operative requirement — that no tier has a distinct
                 * Choose/Select/Upgrade/Get-started control — more strongly
                 * than repeating the CTA would, and keeps §20.1 intact. The
                 * page's two CTAs are in the opening region and closing band.
                 */}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* What is not being offered */}
      <Section
        label={t("pricing-excluded-standing")}
        title={t("pricing-excluded-title")}
        tone="subtle"
      >
        <p className="pg-public__body">{t("pricing-excluded-body")}</p>
      </Section>

      <ClosingBand />
    </div>
  );
}
