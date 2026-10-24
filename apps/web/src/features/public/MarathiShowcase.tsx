/**
 * "Built for Marathi newspapers" (03 §4.2): what the typesetter does for Marathi, and a fictional Marathi story set by
 * the browser, in the computer's own Devanagari font (nothing is downloaded, and no house font is used). The caption
 * says it shows the script, not Pageinator's output. The example is Marathi on the English page too (`lang="mr"`).
 */
import { usePublicText } from "./usePublicText.ts";

export function MarathiShowcase() {
  const { t, langOf } = usePublicText();
  return (
    <figure className="pg-public__specimen">
      <div className="pg-public__specimen-page">
        <p className="pg-public__specimen-label">{t("marathi-label-story")}</p>
        <article className="pg-public__specimen-story" lang={langOf("specimen-headline")}>
          <p className="pg-public__specimen-folio">{t("specimen-folio")}</p>
          <p className="pg-public__specimen-kicker">{t("specimen-kicker")}</p>
          <p className="pg-public__specimen-headline">{t("specimen-headline")}</p>
          <p className="pg-public__specimen-deck">{t("specimen-deck")}</p>
          <p className="pg-public__specimen-body">{t("specimen-body")}</p>
        </article>
        <dl className="pg-public__specimen-sets">
          <div>
            <dt className="pg-public__specimen-label">{t("marathi-label-conjuncts")}</dt>
            <dd className="pg-public__specimen-glyphs" lang={langOf("specimen-conjuncts")}>
              {t("specimen-conjuncts")}
            </dd>
          </div>
          <div>
            <dt className="pg-public__specimen-label">{t("marathi-label-digits")}</dt>
            <dd className="pg-public__specimen-glyphs" lang={langOf("specimen-digits")}>
              {t("specimen-digits")}
            </dd>
          </div>
        </dl>
      </div>
      <figcaption className="pg-public__note">
        {t("marathi-caption")}
      </figcaption>
    </figure>
  );
}
