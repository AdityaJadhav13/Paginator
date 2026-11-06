/** The G2 evidence's English strings (spread into en.ts; keys start with "evidence."): the press test page on the Print
 * profiles screen. Error codes it adds go here too, as "error.<code>". */
export const EVIDENCE_EN = {
  "evidence.pressTest.title": "Press test page",
  "evidence.pressTest.lede":
    "A PDF/X-1a test page of 347 × 540 mm to send to the press: a fictional photo and a fictional ad, rules, tints and registration marks. The engine makes it and the independent PDF/X-1a check tests it; the first time can take a few minutes.",
  "evidence.pressTest.download": "Download press test page",
  "evidence.pressTest.making": "Making the press test page…",
  "evidence.pressTest.sha": "Downloaded. Its SHA-256:",
  "evidence.pressTest.note":
    "The photo and ad on it are fictional. The press must accept this page before pages with photos or ads go to press: give them its SHA-256, and record it on the Release tab once they accept it.",
  "error.press_test_unavailable": "The press test page cannot be made just now. Try again in a few minutes.",
  "error.press_test_refused":
    "The press test page was not given: it failed its check, or it does not match this paper's page size or colour profile.",
} as const;
