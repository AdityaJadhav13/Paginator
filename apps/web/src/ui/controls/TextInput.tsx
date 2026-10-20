import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Input type — text-like types only. Defaults to "text". */
  type?: "text" | "email" | "password" | "search" | "tel" | "url" | "number";
}

/**
 * Single-line text input.
 * Exposes native value/input/change behavior.
 * Placeholder text is never the accessible name — always use a visible label via Field.
 */
export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ type = "text", className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={["pg-input", className].filter(Boolean).join(" ")}
        {...rest}
      />
    );
  }
);
