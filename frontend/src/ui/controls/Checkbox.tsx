import { useId } from "react";
import type { InputHTMLAttributes } from "react";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id"> {
  /** Visible label text for the checkbox. */
  label: string;
  /** Optional extra ID if needed for external aria-describedby. */
  id?: string;
}

/**
 * Native checkbox with visible label.
 * Space toggles the checkbox when enabled — provided by native browser behavior.
 * No custom keyboard handler duplicates toggling.
 */
export function Checkbox({ label, id: idProp, className, disabled, ...rest }: CheckboxProps) {
  const generatedId = useId();
  const id = idProp ?? `${generatedId}-checkbox`;

  return (
    <label
      className={["pg-checkbox", disabled ? "pg-checkbox--disabled" : null, className]
        .filter(Boolean)
        .join(" ")}
    >
      <input
        id={id}
        type="checkbox"
        className="pg-checkbox__input"
        disabled={disabled}
        {...rest}
      />
      <span className="pg-checkbox__label">{label}</span>
    </label>
  );
}
