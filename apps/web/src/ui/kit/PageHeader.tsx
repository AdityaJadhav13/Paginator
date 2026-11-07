import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  /** The route's heading id (ROUTE_HEADING_ID): the heading then takes focus after navigation. */
  headingId?: string;
  subtitle?: ReactNode;
  /** A breadcrumb trail above the title. */
  breadcrumbs?: ReactNode;
  /** Top right: the screen's one primary action (02 §3.1), and at most a few secondary ones. */
  actions?: ReactNode;
}

/** A screen's head: breadcrumbs, the h1, a subtitle, and the actions at the end of the title row. */
export function PageHeader({ title, headingId, subtitle, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div className="pg-page-header">
      {breadcrumbs}
      <div className="pg-page-header__row">
        <div className="pg-page-header__titles">
          <h1 id={headingId} tabIndex={headingId ? -1 : undefined} className="pg-page-header__title">
            {title}
          </h1>
          {subtitle && <p className="pg-page-header__subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="pg-page-header__actions">{actions}</div>}
      </div>
    </div>
  );
}
