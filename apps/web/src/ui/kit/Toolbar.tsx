import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { isRtl } from "./focusable.ts";

const CONTROLS = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])";

export interface ToolbarProps {
  /** The toolbar's name. */
  label: string;
  children: ReactNode;
  className?: string;
}

/**
 * A command bar (`role="toolbar"`): one stop in the Tab order; ← → move between its controls (mirrored right-to-left),
 * Home and End go to the ends. Focus comes back to the control used last.
 */
export function Toolbar({ label, children, className }: ToolbarProps) {
  const bar = useRef<HTMLDivElement>(null);

  const controls = () => Array.from(bar.current?.querySelectorAll<HTMLElement>(CONTROLS) ?? []).filter((element) => !element.hidden);

  /** One control keeps tabindex 0; the others -1. */
  const rove = (current: HTMLElement | undefined) => {
    for (const control of controls()) {
      control.tabIndex = control === current ? 0 : -1;
    }
  };

  useEffect(() => {
    const list = controls();
    rove(list.find((control) => control === document.activeElement) ?? list.find((control) => control.getAttribute("tabindex") === "0") ?? list[0]);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = controls();
    const at = list.indexOf(document.activeElement as HTMLElement);
    // a text field keeps its own arrow keys
    if (at < 0 || /^(INPUT|TEXTAREA)$/.test((event.target as HTMLElement).tagName)) return;
    const step = bar.current && isRtl(bar.current) ? -1 : 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = at + step;
    else if (event.key === "ArrowLeft") next = at - step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = list[(next + list.length) % list.length];
    rove(target);
    target?.focus();
  };

  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    if (controls().includes(event.target as HTMLElement)) rove(event.target as HTMLElement);
  };

  return (
    <div
      ref={bar}
      role="toolbar"
      aria-label={label}
      className={["pg-toolbar", className].filter(Boolean).join(" ")}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      {children}
    </div>
  );
}
