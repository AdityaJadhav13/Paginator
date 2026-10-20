/**
 * `/security` — posture and current limits (§17).
 *
 * R39 requires security claims to be truthful and provisional, and Phase 15
 * forbids invented certifications. There is no server, no database, no
 * identity provider and no audited control, so this page separates three
 * things that marketing usually blurs: what is true today, what is intended,
 * and what is explicitly not true. The limits block carries the same visual
 * weight as the design-intent block, never fine print.
 *
 * No shield, lock, badge or compliance mark appears here by design.
 */
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { t } from "./content.ts";
import { Section } from "./Section.tsx";
import { PrimaryCta } from "./PrimaryCta.tsx";
import { ClosingBand } from "./ClosingBand.tsx";

const TRUE_TODAY = [
  "security-true-1",
  "security-true-2",
  "security-true-3",
  "security-true-4",
] as const;

const DESIGN_INTENT = [
  "security-intent-1",
  "security-intent-2",
  "security-intent-3",
  "security-intent-4",
] as const;

/**
 * Every entry begins with "No " — these records exist to deny a claim, which
 * is why the §19.4 forbidden-term scan exempts the `security-limit-` prefix
 * and asserts that shape instead.
 */
const NOT_TRUE_TODAY = [
  "security-limit-assessment",
  "security-limit-testing",
  "security-limit-encryption",
  "security-limit-availability",
  "security-limit-processing",
] as const;

export function SecurityPage() {
  return (
    <div className="pg-public">
      {/* Page title and lead */}
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__page-title">
            {t("security-title")}
          </h1>
          <div className="pg-public__grid">
            <div className="pg-public__span-7">
              <p className="pg-public__lead">{t("security-lead-1")}</p>
              <p className="pg-public__lead">{t("security-lead-2")}</p>
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

      {/* What is true today */}
      <Section
        label={t("security-true-standing")}
        title={t("security-true-title")}
      >
        <ul className="pg-public__list">
          {TRUE_TODAY.map((id) => (
            <li key={id} className="pg-public__list-item">
              <p className="pg-public__body">{t(id)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* Design intent — explicitly not implemented controls */}
      <Section
        label={t("security-intent-standing")}
        title={t("security-intent-title")}
        tone="subtle"
      >
        <p className="pg-public__lead">{t("security-intent-lead")}</p>
        <ul className="pg-public__list">
          {DESIGN_INTENT.map((id) => (
            <li key={id} className="pg-public__list-item">
              <p className="pg-public__body">{t(id)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* What is not true today — same weight as design intent, by design */}
      <Section
        label={t("security-limits-standing")}
        title={t("security-limits-title")}
        tone="ink"
      >
        <ul className="pg-public__list">
          {NOT_TRUE_TODAY.map((id) => (
            <li key={id} className="pg-public__list-item">
              <p className="pg-public__body">{t(id)}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* The one property this build actually demonstrates */}
      <Section
        label={t("security-nonleak-standing")}
        title={t("security-nonleak-title")}
      >
        <p className="pg-public__body">{t("security-nonleak-body-1")}</p>
        <p className="pg-public__body">{t("security-nonleak-body-2")}</p>
      </Section>

      {/* Where a security note would go */}
      <Section
        label={t("security-report-standing")}
        title={t("security-report-title")}
        tone="subtle"
      >
        <p className="pg-public__body">{t("security-report-body")}</p>
      </Section>

      <ClosingBand />
    </div>
  );
}
