/**
 * The seven stages as an editorial contents list: ordinal and name, what the stage does, and its state today. `/`
 * shows it on an ink band; `/features` shows each stage in full instead (FeaturesPage).
 */
import { CapabilityNote } from "./CapabilityNote.tsx";
import { stageIds, WORKFLOW_STAGES } from "./workflow.ts";
import { usePublicText } from "./usePublicText.ts";

export function WorkflowSequence() {
  const { t, digits } = usePublicText();
  return (
    <ol className="pg-public__sequence">
      {WORKFLOW_STAGES.map((stage) => {
        const ids = stageIds(stage);
        return (
          <li key={stage.key} className="pg-public__sequence-item">
            <p className="pg-public__sequence-name">
              <span className="pg-public__sequence-ordinal" aria-hidden="true">
                {digits(stage.number)}
              </span>
              {t(ids.name)}
            </p>
            <p className="pg-public__body">{t(ids.description)}</p>
            <CapabilityNote states={stage.states} />
          </li>
        );
      })}
    </ol>
  );
}
