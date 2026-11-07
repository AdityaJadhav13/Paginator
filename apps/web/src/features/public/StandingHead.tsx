/**
 * The site's recurring editorial motif (§9.2): a small uppercase standing
 * head, a hairline rule, then the serif heading.
 *
 * The heading is rendered here rather than by each caller so the label,
 * rule and heading can never drift apart, and so heading level is an
 * explicit prop instead of a styling decision.
 */

export interface StandingHeadProps {
  /** The small uppercase label above the rule. */
  readonly label: string;
  /** The serif heading below the rule. */
  readonly title: string;
  /** Heading level. Public surfaces use 2 for sections and 3 for items. */
  readonly level: 2 | 3;
  /** Optional id for the rendered heading. */
  readonly id?: string;
  readonly className?: string;
}

export function StandingHead({ label, title, level, id, className }: StandingHeadProps) {
  const headingClass =
    level === 2 ? "pg-public__section-title" : "pg-public__item-title";

  return (
    <div className={["pg-standing-head", className].filter(Boolean).join(" ")}>
      <p className="pg-standing-head__label">{label}</p>
      <div className="pg-standing-head__rule" aria-hidden="true" />
      {level === 2 ? (
        <h2 id={id} className={headingClass}>
          {title}
        </h2>
      ) : (
        <h3 id={id} className={headingClass}>
          {title}
        </h3>
      )}
    </div>
  );
}
