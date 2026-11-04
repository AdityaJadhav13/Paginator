/**
 * The Desk's own words (DeskText: its English text, and its code and parameters when it is one of the Desk's messages):
 * a code the catalogue carries is said in the reader's language (the one-form of a plural entry when n is 1), anything
 * else in the Desk's English, marked as English. A code whose parameters do not fill its sentence falls back to the
 * English text too: a sentence is never shown with a hole in it.
 */
import { formatMessage, isCatalogueKey, CATALOGUES, useI18n, type Language } from "../../i18n/index.ts";
import type { DeskTextDto } from "../../services/index.ts";

export function deskWords(text: DeskTextDto, language: Language): { readonly text: string; readonly english: boolean } {
  const { code, params } = text;
  if (code && isCatalogueKey(code)) {
    const one = `${code}.one`;
    const key = params?.["n"] === 1 && isCatalogueKey(one) ? one : code;
    try {
      return { text: formatMessage(CATALOGUES[language][key], params ?? {}), english: language === "en" };
    } catch {
      // a parameter the sentence needs is missing: the Desk's own English, whole
    }
  }
  return { text: text.text, english: true };
}

/** One DeskText, in a span (lang="en" when it is the Desk's English in a Marathi page). */
export function DeskWords({ text }: { readonly text: DeskTextDto }) {
  const { language } = useI18n();
  const words = deskWords(text, language);
  return <span {...(words.english && language !== "en" ? { lang: "en" } : {})}>{words.text}</span>;
}
