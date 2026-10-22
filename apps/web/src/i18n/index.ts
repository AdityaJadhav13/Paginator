/** The English/Marathi catalogue and the interface language. */
export {
  CATALOGUE_KEYS,
  CATALOGUES,
  LANGUAGES,
  LANGUAGE_NAMES,
  formatMessage,
  isCatalogueKey,
  placeholdersOf,
  translator,
  type CatalogueKey,
  type Language,
  type MessageParams,
  type PlainKey,
  type Translate,
} from "./catalogue.ts";
export {
  I18nProvider,
  LANGUAGE_STORAGE_KEY,
  LanguageScope,
  initialLanguage,
  storedLanguage,
  useI18n,
  type I18nValue,
} from "./I18nProvider.tsx";
export { LanguageSwitch } from "./LanguageSwitch.tsx";
export { REVIEW, REVIEW_NOTES, REVIEWED, type MarathiReview, type ReviewItem } from "./review.ts";
