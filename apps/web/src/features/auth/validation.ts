/**
 * The checks a form makes before it sends anything. They return catalogue keys, never text. The API checks again:
 * passwords are 12 to 128 characters (docs/product/10-l2-newsroom-plan.md §4.1).
 */
import type { Translate } from "../../i18n/index.ts";

export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;

export type ValidationKey =
  | "validation.emailMissing"
  | "validation.emailInvalid"
  | "validation.passwordMissing"
  | "validation.passwordShort"
  | "validation.passwordLong"
  | "validation.passwordsDiffer"
  | "validation.nameMissing";

/** Something@something.something with no spaces: the server decides the rest. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailProblem(value: string): ValidationKey | undefined {
  const email = value.trim();
  if (email === "") return "validation.emailMissing";
  return LOOKS_LIKE_EMAIL.test(email) ? undefined : "validation.emailInvalid";
}

/** For a password being chosen: its length, as the API counts it. */
export function newPasswordProblem(value: string): ValidationKey | undefined {
  if (value === "") return "validation.passwordMissing";
  if (value.length < MIN_PASSWORD) return "validation.passwordShort";
  if (value.length > MAX_PASSWORD) return "validation.passwordLong";
  return undefined;
}

/** The API's own refusal of a password, as the field's message. */
export function passwordAnswerProblem(code: string): ValidationKey | undefined {
  if (code === "PASSWORD_TOO_SHORT") return "validation.passwordShort";
  if (code === "PASSWORD_TOO_LONG") return "validation.passwordLong";
  return undefined;
}

/** A field's error messages, for Field's `errors`. */
export function fieldErrors(t: Translate, key: ValidationKey | undefined): string[] {
  switch (key) {
    case undefined:
      return [];
    case "validation.passwordShort":
      return [t(key, { min: MIN_PASSWORD })];
    case "validation.passwordLong":
      return [t(key, { max: MAX_PASSWORD })];
    default:
      return [t(key)];
  }
}
