import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { Icon } from "../icons/Icon.tsx";

export interface TableProps {
  /** The table's name. Visually hidden unless `showCaption`. */
  caption: string;
  showCaption?: boolean;
  /** `<thead>` and `<tbody>` rows. A selected row takes `className="pg-table__row--selected"`. */
  children: ReactNode;
  className?: string;
}

/** A semantic data table: dense rows, a header that stays in view while the rows scroll, row hover. */
export function Table({ caption, showCaption = false, children, className }: TableProps) {
  return (
    <div className="pg-table-wrap">
      <table className={["pg-table", className].filter(Boolean).join(" ")}>
        <caption className={showCaption ? "pg-table__caption" : "pg-visually-hidden"}>{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export type SortDirection = "ascending" | "descending";

export interface TableHeaderProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
  /** Numbers sit at the end of the cell. */
  numeric?: boolean;
  /**
   * A sortable column: its direction when the table is sorted by it, or null when it is not. The header becomes a
   * button and the cell carries `aria-sort`.
   */
  sort?: SortDirection | null;
  /** Called when the column's sort button is pressed. */
  onSort?: () => void;
}

/** A column header (`<th scope="col">`), optionally sortable. */
export function TableHeader({ children, numeric = false, sort, onSort, className, ...rest }: TableHeaderProps) {
  const sortable = sort !== undefined && onSort;
  return (
    <th
      scope="col"
      aria-sort={sortable ? (sort ?? "none") : undefined}
      className={["pg-table__th", numeric && "pg-table__cell--numeric", className].filter(Boolean).join(" ")}
      {...rest}
    >
      {sortable ? (
        <button type="button" className="pg-table__sort" onClick={onSort}>
          {children}
          <Icon
            name={sort === "ascending" ? "arrow-up" : sort === "descending" ? "arrow-down" : "arrow-up-down"}
            size={16}
            className={sort ? undefined : "pg-table__sort-idle"}
          />
        </button>
      ) : (
        children
      )}
    </th>
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  numeric?: boolean;
}

/** A data cell; `numeric` aligns it to the end. */
export function TableCell({ numeric = false, className, ...rest }: TableCellProps) {
  return <td className={[numeric && "pg-table__cell--numeric", className].filter(Boolean).join(" ") || undefined} {...rest} />;
}
