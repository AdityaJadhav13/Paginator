/** English strings for the Desk's messages (m.*) the web did not carry yet, from tools/desk/engine/messages.json
 * (spread into en.ts; the Marathi is the Desk's draft, tools/desk/static/strings.js). */
export const ENGINE_WORDS_EN = {
  "m.run.editionChanged": "Set aside: the edition's date or pages changed after this layout. Lay it out again.",
  "m.edit.engineFailed": "something went wrong in the engine",
  "m.save.filesNotFinished": "The page was saved, but its files could not be finished.",
} as const;
