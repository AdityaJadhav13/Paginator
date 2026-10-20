/**
 * The §7.3 "what actually works today" list.
 *
 * Shared by `/` (region 2) and `/features` (block 4) so the two statements
 * of current capability are the same three records and cannot drift.
 */
import { t } from "./content.ts";

const ITEMS = [
  "today-item-sign-in",
  "today-item-navigation",
  "today-item-placeholders",
] as const;

export function TodayList() {
  return (
    <ul className="pg-public__list">
      {ITEMS.map((id) => (
        <li key={id} className="pg-public__list-item">
          <p className="pg-public__body">{t(id)}</p>
        </li>
      ))}
    </ul>
  );
}
