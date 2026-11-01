/**
 * The homepage's proof facts (03 §4.2): each a measured or recorded fact, a note on what it does not show, and the
 * record it comes from, shown with it in small type.
 */
import { usePublicText } from "./usePublicText.ts";

const FACTS = ["edition", "gen1", "press", "check"] as const;

export function ProofFacts() {
  const { t } = usePublicText();
  return (
    <ul className="pg-public__proofs">
      {FACTS.map((key) => (
        <li key={key} className="pg-public__proof">
          <p className="pg-public__proof-figure">{t(`proof-${key}-figure`)}</p>
          <p className="pg-public__proof-claim">{t(`proof-${key}`)}</p>
          <p className="pg-public__body">{t(`proof-${key}-note`)}</p>
          <p className="pg-public__proof-source">
            <span className="pg-public__proof-source-label">{t("proof-source-label")}</span>{" "}
            <span>{t(`proof-${key}-cite`)}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
