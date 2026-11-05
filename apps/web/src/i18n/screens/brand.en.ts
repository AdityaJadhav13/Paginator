/** The brand screen's English strings (spread into en.ts; keys start with "brand."). Error codes the screen adds go here
 * too, as "error.<code>". */
export const BRAND_EN = {
  "brand.loading": "Loading the brand…",
  "brand.masthead.heading": "Masthead and folio",
  "brand.masthead.explain":
    "The masthead and the folio are part of the front template page. Every front page prints that page's own masthead; the layout engine changes only the folio's date, page number, volume, issue number and price.",
  "brand.masthead.from": "As page 1 of the edition of {date} printed it (laid out {time}).",
  "brand.masthead.alt": "The top of page 1 of the edition of {date}, with its masthead",
  "brand.masthead.none":
    "No front page has been laid out yet, so there is no masthead to show. Lay out an edition and it appears here.",
  "brand.masthead.noPreview": "The preview of that page could not be loaded.",
  "brand.masthead.templates": "Change the front template on the Templates screen",
  "brand.settings.heading": "Name and edition defaults",
  "brand.name.label": "Display name",
  "brand.name.hint": "Shown across Pageinator. It is not printed: the printed masthead is the template's own.",
  "brand.name.required": "Type a name.",
  "brand.defaults.explain":
    "“Create edition” fills these in, and whoever makes the edition can still change them. Each edition keeps its own volume, issue number and price; the front page's folio prints them after the words {words}, in the template's own digits, where the front template has those words.",
  "brand.defaults.volume": "Volume",
  "brand.defaults.price": "Price",
  "brand.defaults.nextIssue": "Next issue number",
  "brand.defaults.nextIssue.hint":
    "Goes up by one when an edition is made with it; an edition made with a higher number moves it past that number. Leave it empty to type each issue number yourself.",
  "brand.defaults.nextIssue.invalid": "Type a whole number from 1 to 999999, or leave it empty.",
  "brand.notSet": "Not set",
  "brand.save": "Save",
  "brand.saving": "Saving…",
  "brand.saved": "Saved.",
  "brand.prefilled": "Volume, issue number and price are filled in from the Brand screen.",
} as const;
