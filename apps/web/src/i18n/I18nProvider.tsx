/**
 * The interface language (English or Marathi): chosen with the language switch, remembered by this browser, and
 * reflected in `<html lang>` so that assistive technology reads the page in the right language.
 *
 * Parts of the app that exist only in English (the public site's content, the placeholder workspace) sit inside an
 * English `LanguageScope`, whose element carries `lang="en"`; the choice still applies everywhere else.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LANGUAGES, translator, type Language, type Translate } from "./catalogue.ts";

/** The browser storage key that remembers the choice. */
export const LANGUAGE_STORAGE_KEY = "pageinator.language";

function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);
}

/** The remembered choice, if any. Storage can be unavailable (a private window, a blocked site): then there is none. */
export function storedLanguage(): Language | undefined {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function rememberLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // the choice then lasts until the page is closed
  }
}

/** Without a remembered choice: Marathi when the browser prefers it, otherwise English. */
export function initialLanguage(): Language {
  const stored = storedLanguage();
  if (stored) return stored;
  const preferred = typeof navigator === "undefined" ? [] : (navigator.languages ?? [navigator.language]);
  return preferred.some((tag) => /^mr(-|$)/i.test(tag)) ? "mr" : "en";
}

export interface I18nValue {
  readonly language: Language;
  /** Switches the interface language and remembers it in this browser. */
  setLanguage(language: Language): void;
  readonly t: Translate;
}

const ENGLISH: I18nValue = { language: "en", setLanguage: () => {}, t: translator("en") };

/** English until a provider says otherwise, so a component rendered on its own still has its text. */
const I18nContext = createContext<I18nValue>(ENGLISH);

export function I18nProvider({ children }: { readonly children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(initialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    rememberLanguage(next);
    setLanguageState(next);
  }, []);

  const value = useMemo<I18nValue>(() => ({ language, setLanguage, t: translator(language) }), [language, setLanguage]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Fixes the language for a part of the page that exists in one language only. The caller puts `lang={language}` on
 * that part's element.
 */
export function LanguageScope({ language, children }: { readonly language: Language; readonly children: ReactNode }) {
  const parent = useContext(I18nContext);
  const value = useMemo<I18nValue>(
    () => ({ language, setLanguage: parent.setLanguage, t: translator(language) }),
    [language, parent.setLanguage],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
