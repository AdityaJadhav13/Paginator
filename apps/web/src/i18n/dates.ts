/** Dates as the pilot reads them: India's time zone, the interface language, Latin digits (02 §3.3). */
import type { Language } from "./catalogue.ts";

function locale(language: Language): string {
  return language === "mr" ? "mr-IN-u-nu-latn" : "en-IN";
}

/** "28 October 2026" */
export function formatDate(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(locale(language), { dateStyle: "long", timeZone: "Asia/Kolkata" }).format(new Date(iso));
}

/** "22 Oct 2026, 9:30 am" */
export function formatDateTime(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(locale(language), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(iso));
}
