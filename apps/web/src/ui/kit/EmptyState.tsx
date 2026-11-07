import type { ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon.tsx";

export interface EmptyStateProps {
  icon?: IconName;
  heading: string;
  /** Heading level in the page's outline. */
  headingLevel?: 2 | 3;
  /** One sentence: what this place is for, or why it is empty. */
  children?: ReactNode;
  /** The one action that fills it. */
  action?: ReactNode;
}

/** A first-use or nothing-found place (02 §3.5): icon, heading, a sentence, one action. */
export function EmptyState({ icon, heading, headingLevel = 2, children, action }: EmptyStateProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <div className="pg-empty-state">
      {icon && (
        <span className="pg-empty-state__icon">
          <Icon name={icon} size={24} />
        </span>
      )}
      <Heading className="pg-empty-state__heading">{heading}</Heading>
      {children && <p className="pg-empty-state__text">{children}</p>}
      {action && <div className="pg-empty-state__action">{action}</div>}
    </div>
  );
}
