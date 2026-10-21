/**
 * The two catalogues, their typed keys and `{name}` placeholders, and the one formatting rule: a message is a whole
 * sentence from the catalogue, with each placeholder replaced by a value. A sentence is never assembled from pieces,
 * because Marathi word order differs from English.
 */
import { EN, type CatalogueKey } from "./en.ts";
import { MR } from "./mr.ts";

export type { CatalogueKey } from "./en.ts";

/** The interface languages: English and Marathi. */
export const LANGUAGES = ["en", "mr"] as const;
export type Language = (typeof LANGUAGES)[number];

/** Each language's name in its own script, as the language switch shows it. */
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { en: "English", mr: "मराठी" };

export const CATALOGUES: Readonly<Record<Language, Readonly<Record<CatalogueKey, string>>>> = { en: EN, mr: MR };

export const CATALOGUE_KEYS = Object.keys(EN) as readonly CatalogueKey[];

export function isCatalogueKey(key: string): key is CatalogueKey {
  return Object.hasOwn(EN, key);
}

/** The placeholder names in an English message, as a type: "Join {organization}" gives "organization". */
type Placeholders<Text extends string> = Text extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Placeholders<Rest>
  : never;

export type MessageParams<Key extends CatalogueKey> = Placeholders<(typeof EN)[Key]>;

/** No second argument for a message without placeholders; otherwise a value for each one. */
export type TranslateArgs<Key extends CatalogueKey> = [MessageParams<Key>] extends [never]
  ? []
  : [params: Readonly<Record<MessageParams<Key>, string | number>>];

export type Translate = <Key extends CatalogueKey>(key: Key, ...args: TranslateArgs<Key>) => string;

const PLACEHOLDER = /\{(\w+)\}/g;

/** The placeholder names in a message, in order of appearance. */
export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((match) => match[1] ?? "");
}

/** Replaces each `{name}` with its value. A placeholder without a value is an error, never left in the text. */
export function formatMessage(text: string, params: Readonly<Record<string, string | number>> = {}): string {
  return text.replace(PLACEHOLDER, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing value for {${name}} in "${text}"`);
    return String(value);
  });
}

export function translator(language: Language): Translate {
  const catalogue = CATALOGUES[language];
  return (key, ...args) => formatMessage(catalogue[key], args[0] as Readonly<Record<string, string | number>>);
}
