import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * Multi-line text input.
 * Exposes native value/input/change behavior.
 * Placeholder text is never the accessible name — always use a visible label via Field.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={["pg-textarea", className].filter(Boolean).join(" ")}
        {...rest}
      />
    );
  }
);
