import { forwardRef } from "react";
import type { SelectHTMLAttributes, ReactNode } from "react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  children: ReactNode;
}

/**
 * Native single-select.
 * Custom combobox behavior is deferred until a feature requires it.
 * Always pair with a visible label via Field.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        className={["pg-select", className].filter(Boolean).join(" ")}
        {...rest}
      >
        {children}
      </select>
    );
  }
);
