import React, { useId } from "react";

export interface FieldProps {
  /** Visible label text for the associated control. */
  label: string;
  /** Optional description shown below the label. Associated via aria-describedby. */
  description?: string;
  /**
   * Validation error messages. When present, the control receives
   * aria-invalid="true" and each message is associated via aria-describedby.
   */
  errors?: string[];
  /**
   * Whether the field is required.
   * Conveys required state both semantically (required attr) and visibly.
   */
  required?: boolean;
  className?: string;
  /** Single native control child. Field injects id, aria-describedby, aria-invalid, required. */
  children: React.ReactElement;
}

/**
 * Associates one visible label, optional description, and zero or more
 * error messages with one native control using stable generated IDs.
 * Placeholder text on the child control must never be the accessible name.
 */
export function Field({
  label,
  description,
  errors = [],
  required = false,
  className,
  children,
}: FieldProps) {
  const uid = useId();
  const controlId = `${uid}-ctrl`;
  const descId = description ? `${uid}-desc` : undefined;
  const errorIds = errors.map((_, i) => `${uid}-err-${i}`);

  const describedByParts = [descId, ...errorIds].filter(Boolean);
  const describedBy = describedByParts.length > 0 ? describedByParts.join(" ") : undefined;
  const hasError = errors.length > 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enhanced = React.cloneElement(children as React.ReactElement<any>, {
    id: controlId,
    ...(describedBy !== undefined && { "aria-describedby": describedBy }),
    ...(hasError && { "aria-invalid": true }),
    ...(required && { required: true }),
  });

  return (
    <div className={["pg-field", className].filter(Boolean).join(" ")}>
      <label htmlFor={controlId} className="pg-field__label">
        {label}
        {required && (
          <span className="pg-field__required" aria-hidden="true">
            {" "}
            (required)
          </span>
        )}
      </label>

      {description && (
        <p id={descId} className="pg-field__description">
          {description}
        </p>
      )}

      {enhanced}

      {hasError && (
        <div aria-live="assertive" aria-atomic="true" className="pg-field__errors">
          {errors.map((err, i) => (
            <p key={errorIds[i]} id={errorIds[i]} className="pg-field__error">
              {err}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
