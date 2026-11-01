/**
 * A workflow stage's state today (Working in the Desk · Built for the pilot · Planned), as small type, one line per
 * state. Deliberately typographic rather than a coloured badge: a status light would read as a live signal.
 */
import { stateLabelId, type StageState } from "./workflow.ts";
import { usePublicText } from "./usePublicText.ts";

export function CapabilityNote({ states }: { readonly states: readonly StageState[] }) {
  const { t } = usePublicText();
  return (
    <ul className="pg-capability-list">
      {states.map((state) => (
        <li key={state} className={`pg-capability pg-capability--${state}`}>
          {t(stateLabelId(state))}
        </li>
      ))}
    </ul>
  );
}
