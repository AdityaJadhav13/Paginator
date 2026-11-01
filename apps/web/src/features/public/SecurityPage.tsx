/**
 * `/security` (03 §4.2): what is true today, what is planned, and what is not true yet, kept apart. The limits carry
 * the same weight as the rest, never fine print. No shield, lock, badge or compliance mark appears here.
 */
import { Link } from "react-router";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { Section } from "./Section.tsx";
import { PrimaryCta, contactPath } from "./PrimaryCta.tsx";
import { ClosingBand } from "./ClosingBand.tsx";
import { usePublicText } from "./usePublicText.ts";
import { useContactConnection } from "../contact/contact-context.tsx";

const TRUE_TODAY = [
  "security-separate",
  "security-audit",
  "security-two-step",
  "security-passwords",
  "security-cookies",
  "security-origin",
] as const;

const PLANNED = ["security-india", "security-backups", "security-legal"] as const;

/** Every entry begins with "No ": these records exist to deny a claim (kind "denial" in content.ts). */
const NOT_TRUE_TODAY = [
  "security-limit-hosting",
  "security-limit-assessment",
  "security-limit-testing",
  "security-limit-encryption",
  "security-limit-availability",
  "security-limit-processing",
] as const;

function List({ ids }: { readonly ids: readonly (string | null)[] }) {
  const { t } = usePublicText();
  return (
    <ul className="pg-public__list">
      {ids.flatMap((id) =>
        id === null
          ? []
          : [
              <li key={id} className="pg-public__list-item">
                <p className="pg-public__body">{t(id)}</p>
              </li>,
            ],
      )}
    </ul>
  );
}

export function SecurityPage() {
  const { t } = usePublicText();
  // the contact form's statement follows what the API says: it sends only when connected
  const connection = useContactConnection();
  const contactStatement =
    connection === "checking" ? null : connection === "connected" ? "security-contact" : "security-contact-off";
  return (
    <div className="pg-public">
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__page-title">
            {t("security-title")}
          </h1>
          <p className="pg-public__lead">{t("security-lead")}</p>
          <div className="pg-public__actions">
            <PrimaryCta />
          </div>
        </div>
      </section>

      <Section label={t("security-true-standing")} title={t("security-true-title")}>
        <List ids={[...TRUE_TODAY, contactStatement]} />
      </Section>

      <Section label={t("security-plan-standing")} title={t("security-plan-title")} tone="subtle">
        <List ids={PLANNED} />
      </Section>

      <Section label={t("security-limits-standing")} title={t("security-limits-title")} tone="ink">
        <List ids={NOT_TRUE_TODAY} />
      </Section>

      <Section label={t("security-nonleak-standing")} title={t("security-nonleak-title")}>
        <p className="pg-public__body">{t("security-nonleak-body")}</p>
      </Section>

      {/* the way to report is the contact form: only while it sends, never a link to a form that cannot */}
      {connection === "connected" && (
        <Section label={t("security-report-standing")} title={t("security-report-title")} tone="subtle">
          <p className="pg-public__body">{t("security-report-body")}</p>
          <p className="pg-public__actions">
            <Link to={contactPath("other")}>{t("cta-report")}</Link>
          </p>
        </Section>
      )}

      <ClosingBand secondary="pricing" />
    </div>
  );
}
