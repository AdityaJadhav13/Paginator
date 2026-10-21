// @pageinator/desk-text — the Desk's own story-text format ("desk-text/1": paragraphs separated by empty lines, "## "
// subheadings), ported from Python so the hosted product counts and cleans text exactly as the Desk and its engine do
// (docs/product/10-l2-newsroom-plan.md §2.1). Parity: test/vectors (generated from the Desk's functions).
export { BRIEF_WORDS, type Block, blocks, bodyWords, isBrief } from "./body.ts";
export { BODY_LIMIT, DeskTextError, LINE_LIMIT, TEXT_FIELDS, cleanText } from "./clean.ts";
export { type Pasted, type PastedArticle, type SkippedArticle, parseBulk, pasteArticles } from "./paste.ts";

/** The name of the body format stored with each story revision. */
export const BODY_FORMAT = "desk-text/1";
