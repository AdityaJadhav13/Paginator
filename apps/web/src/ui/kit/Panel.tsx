import { useId, type ReactNode } from "react";

export interface PanelProps {
  /** The panel's heading; it names the region. */
  title?: ReactNode;
  headingLevel?: 2 | 3;
  /** At the end of the header: a few small actions. */
  actions?: ReactNode;
  /** Without padding, for a table or a list that runs to the panel's edges. */
  flush?: boolean;
  children: ReactNode;
  className?: string;
}

/** A white surface with an optional header (title + actions) and a body: the app's card. */
export function Panel({ title, headingLevel = 2, actions, flush = false, children, className }: PanelProps) {
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <section
      className={["pg-panel", className].filter(Boolean).join(" ")}
      aria-labelledby={title ? headingId : undefined}
    >
      {(title || actions) && (
        <div className="pg-panel__header">
          {title && (
            <Heading id={headingId} className="pg-panel__title">
              {title}
            </Heading>
          )}
          {actions && <div className="pg-panel__actions">{actions}</div>}
        </div>
      )}
      <div className={flush ? "pg-panel__body pg-panel__body--flush" : "pg-panel__body"}>{children}</div>
    </section>
  );
}
