/** The app frame's own Marathi strings (spread into mr.ts): a first draft for the native reviewer (review.ts, D-5). */
import type { SITE_EN } from "./site.en.ts";

export const SITE_MR: Readonly<Record<keyof typeof SITE_EN, string>> = {
  "site.noAccess.heading": "हे पान पाहण्याची परवानगी तुम्हाला नाही",
  "site.noAccess.body": "इथल्या तुमच्या भूमिकेत या पानाचा समावेश नाही. ते हवे असल्यास मालक किंवा प्रशासकांना विचारा.",
  "site.noAccess.home": "संस्थेच्या मुख्य पानावर परत जा",
};
