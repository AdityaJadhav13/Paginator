/**
 * The public pages' words in the reader's language: the language switch (src/i18n) chooses English or Marathi, and
 * every component reads its records through this hook, never through a record's `en` or `mr` directly.
 */
import { useI18n } from "../../i18n/index.ts";
import { languageOf, text, type PublicLanguage } from "./content.ts";

export interface PublicText {
  readonly language: PublicLanguage;
  /** A record's text in the page's language. */
  t(id: string): string;
  /** The `lang` of a record's text on this page (a specimen is Marathi on both). */
  langOf(id: string): PublicLanguage;
  /** A number in the page's digits: Devanagari on the Marathi page. */
  digits(value: number): string;
}

export function usePublicText(): PublicText {
  const { language } = useI18n();
  return {
    language,
    t: (id) => text(id, language),
    langOf: (id) => languageOf(id, language),
    digits: (value) =>
      language === "mr"
        ? String(value).replace(/[0-9]/g, (digit) => String.fromCharCode(0x0966 + Number(digit)))
        : String(value),
  };
}
