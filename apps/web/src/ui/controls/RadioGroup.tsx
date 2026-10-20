import { useId } from "react";

export interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** Legend text for the group — must be visible. */
  legend: string;
  /** Available options. */
  options: RadioOption[];
  /** Currently selected value. */
  value?: string;
  /** Called when selection changes. */
  onChange?: (value: string) => void;
  /** Name for the radio group (for native browser grouping). */
  name?: string;
  /** Whether the entire group is disabled. */
  disabled?: boolean;
  className?: string;
}

/**
 * Radio button group using fieldset, legend, and native radio inputs.
 * Browser-native arrow-key and Space keyboard behavior is preserved.
 * No custom key handler overrides native radio navigation.
 */
export function RadioGroup({
  legend,
  options,
  value,
  onChange,
  name: nameProp,
  disabled = false,
  className,
}: RadioGroupProps) {
  const uid = useId();
  const name = nameProp ?? `${uid}-radio`;

  return (
    <fieldset
      className={["pg-radio-group", className].filter(Boolean).join(" ")}
      disabled={disabled}
    >
      <legend className="pg-radio-group__legend">{legend}</legend>
      <div className="pg-radio-group__options">
        {options.map((option) => {
          const inputId = `${uid}-radio-${option.value}`;
          const isDisabled = disabled || option.disabled === true;

          return (
            <label key={option.value} className="pg-radio-option" htmlFor={inputId}>
              <input
                id={inputId}
                type="radio"
                name={name}
                value={option.value}
                checked={value === option.value}
                disabled={isDisabled}
                onChange={() => onChange?.(option.value)}
                className="pg-radio-option__input"
              />
              <span className="pg-radio-option__label">{option.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
