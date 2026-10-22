/**
 * A `<nav>` that collapses behind a disclosure control at phone width
 * (UI002 §10.1/§10.3), reused by `PublicShell` and `WorkspaceShell` so
 * the pattern — and its `aria-expanded` state — exists in exactly one
 * place. The toggle button itself is hidden at desktop width by CSS
 * (`.pg-shell__nav-toggle`); the open/closed state is real React
 * state, not CSS-only, so `aria-expanded` always reflects reality.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { IconButton } from "../ui/index.ts";

export interface CollapsibleNavProps {
  ariaLabel: string;
  /** The toggle's names, in the page's language; English by default. */
  showLabel?: string;
  hideLabel?: string;
  children: ReactNode;
}

export function CollapsibleNav({ ariaLabel, showLabel, hideLabel, children }: CollapsibleNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        label={open ? (hideLabel ?? `Hide ${ariaLabel} navigation`) : (showLabel ?? `Show ${ariaLabel} navigation`)}
        className="pg-shell__nav-toggle"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ☰
      </IconButton>
      <nav aria-label={ariaLabel} className={`pg-shell__nav${open ? " pg-shell__nav--open" : ""}`}>
        {children}
      </nav>
    </>
  );
}
