/**
 * Renders a workflow stage's availability label (§13.2).
 *
 * This is deliberately NOT UI001's `StatusIndicator`. `PresentationState`
 * is a document/proof lifecycle vocabulary and UI001 §5 forbids reusing it
 * as a lifecycle for anything else; roadmap availability is not a document
 * state. It is also deliberately typographic rather than a coloured badge —
 * a status light would read as a live signal about something that is not
 * running.
 *
 * The label text itself is a governed content record (§19.1); this component
 * receives the already-resolved string and never composes one.
 */

export interface CapabilityNoteProps {
  /** The resolved availability label, from `stageView().availabilityLabel`. */
  readonly label: string;
  readonly className?: string;
}

export function CapabilityNote({ label, className }: CapabilityNoteProps) {
  return (
    <p className={["pg-capability", className].filter(Boolean).join(" ")}>
      {label}
    </p>
  );
}
