// How the app pool reads Postgres types that node-postgres would read wrongly. A date (an edition's day: a calendar
// date with no time zone) is read as its text, YYYY-MM-DD, instead of a Date at the server's local midnight. The pool
// pins DateStyle to ISO (APP_OPTIONS), and the parser refuses any other text rather than pass it on: a session that set
// another DateStyle would otherwise hand the API "21/10/2026".
import { types } from "pg";

const DATE = 1082;
const ISO_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function isoDate(value: string): string {
  if (!ISO_DATE.test(value)) throw new Error(`A date came back as "${value}", not YYYY-MM-DD: DateStyle must be ISO`);
  return value;
}

export const APP_TYPES = {
  getTypeParser: ((id: number, format?: "text" | "binary") =>
    id === DATE && format !== "binary" ? isoDate : types.getTypeParser(id, format)) as typeof types.getTypeParser,
};

/** Connection options for the app pool: the server writes dates as ISO, whatever the database's own setting. */
export const APP_OPTIONS = "-c DateStyle=ISO";
