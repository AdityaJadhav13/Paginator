/**
 * `/legal/privacy`, `/legal/terms`, `/legal/grievance` (03 §4.2; doc 11 L2-230): the owner's own text, read from the
 * host at each visit (src/api/legal-text.ts). Nothing here writes legal text: until the owner's file is there (D-6),
 * the page says it is to be supplied by the owner.
 *
 *   - The page's language first; when only the other language's file exists, that text, with a one-line note.
 *   - The file is plain text: blocks separated by a blank line; a block starting with "## " is a subheading, any other
 *     a paragraph that keeps its line breaks. Shown as React text only: no HTML, no Markdown.
 */
import { useEffect, useState } from "react";
import { ROUTE_HEADING_ID } from "../../app/routes.ts";
import { readLegalText, type LegalDoc } from "../../api/legal-text.ts";
import { useI18n, type PlainKey } from "../../i18n/index.ts";

type View =
  | { readonly kind: "text"; readonly text: string; readonly lang: "en" | "mr"; readonly fallback: boolean }
  | { readonly kind: "pending" }
  | { readonly kind: "failed" };

const TITLE: Record<LegalDoc, PlainKey> = {
  privacy: "public.legal.privacy",
  terms: "public.legal.terms",
  grievance: "public.legal.grievance",
};

const PENDING: Record<LegalDoc, PlainKey> = {
  privacy: "public.legal.privacy.pending",
  terms: "public.legal.terms.pending",
  grievance: "public.legal.grievance.pending",
};

async function load(doc: LegalDoc, language: "en" | "mr"): Promise<View> {
  const other = language === "en" ? "mr" : "en";
  const own = await readLegalText(doc, language);
  if (typeof own === "object") return { kind: "text", text: own.text, lang: language, fallback: false };
  if (own === "failed") return { kind: "failed" };
  const fallback = await readLegalText(doc, other);
  if (typeof fallback === "object") return { kind: "text", text: fallback.text, lang: other, fallback: true };
  return { kind: fallback === "failed" ? "failed" : "pending" };
}

function blocksOf(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((block) => block.trim())
    .filter((block) => block !== "");
}

export function LegalPage({ doc }: { readonly doc: LegalDoc }) {
  const { language, t } = useI18n();
  const asked = `${doc}.${language}`;
  // the answer to one question (a document in a language); another question shows nothing until its own answer
  const [answer, setAnswer] = useState<{ readonly asked: string; readonly view: View } | null>(null);
  useEffect(() => {
    let current = true;
    void load(doc, language).then((view) => {
      if (current) setAnswer({ asked: `${doc}.${language}`, view });
    });
    return () => {
      current = false;
    };
  }, [doc, language]);
  const view = answer?.asked === asked ? answer.view : null;

  return (
    <div className="pg-public">
      <section className="pg-public__band">
        <div className="pg-public__measure">
          <h1 id={ROUTE_HEADING_ID} tabIndex={-1} className="pg-public__page-title">
            {t(TITLE[doc])}
          </h1>
          {view?.kind === "pending" && <p className="pg-public__lead">{t(PENDING[doc])}</p>}
          {view?.kind === "failed" && <p className="pg-public__body">{t("public.legal.failed")}</p>}
          {view?.kind === "text" && view.fallback && <p className="pg-public__note">{t("public.legal.otherLanguage")}</p>}
          {view?.kind === "text" && (
            <div className="pg-public__legal" lang={view.lang}>
              {blocksOf(view.text).map((block, index) =>
                block.startsWith("## ") ? (
                  <h2 key={index} className="pg-public__item-title">
                    {block.slice(3).trim()}
                  </h2>
                ) : (
                  <p key={index} className="pg-public__body">
                    {block}
                  </p>
                ),
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
