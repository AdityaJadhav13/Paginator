/** Marathi strings for the Desk's messages (m.*) the web did not carry yet (spread into mr.ts): the Desk's draft
 * (tools/desk/static/strings.js), for the native reviewer (review.ts, D-5). */
import type { ENGINE_WORDS_EN } from "./engineWords.en.ts";

export const ENGINE_WORDS_MR: Readonly<Record<keyof typeof ENGINE_WORDS_EN, string>> = {
  "m.run.editionChanged": "बाजूला ठेवली: या मांडणीनंतर अंकाची तारीख किंवा पाने बदलली. पुन्हा मांडणी करा.",
  "m.edit.engineFailed": "इंजिनमध्ये काहीतरी चुकले",
  "m.save.filesNotFinished": "पान जतन झाले, पण त्याच्या फायली पूर्ण होऊ शकल्या नाहीत.",
};
