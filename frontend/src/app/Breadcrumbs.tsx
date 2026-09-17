/**
 * Breadcrumb trail (UI002 §7.5). Purely presentational: the caller
 * (`WorkspaceShell`) composes `items` from the resolved organization/
 * publication/edition names (dynamic fixture data `Breadcrumbs` itself
 * must never depend on) plus the current section's static label, so
 * this component stays demo-independent without needing to re-derive
 * fixture names itself.
 */
import { Link } from "react-router";

export interface BreadcrumbItem {
  label: string;
  to: string;
}

export interface BreadcrumbsProps {
  items: BreadcrumbItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  if (items.length < 2) {
    // A single crumb (or none) is not a trail worth announcing.
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="pg-breadcrumbs">
      <ol className="pg-breadcrumbs__list">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.to}-${index}`} className="pg-breadcrumbs__item">
              {isLast ? (
                <span aria-current="page">{item.label}</span>
              ) : (
                <Link to={item.to}>{item.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
