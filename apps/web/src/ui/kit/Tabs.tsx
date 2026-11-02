import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { isRtl } from "./focusable.ts";

export interface TabItem {
  id: string;
  label: ReactNode;
  panel: ReactNode;
}

export interface TabsProps {
  /** The tab list's name. */
  label: string;
  tabs: readonly TabItem[];
  /** Controlled selection; leave out to let Tabs keep it. */
  selectedId?: string;
  defaultSelectedId?: string;
  onSelect?: (id: string) => void;
}

/**
 * WAI-ARIA tabs with automatic activation: one tab in the Tab order (roving tabindex); ← → move and select (mirrored
 * right-to-left), Home and End go to the ends. Only the selected panel is shown.
 */
export function Tabs({ label, tabs, selectedId, defaultSelectedId, onSelect }: TabsProps) {
  const [own, setOwn] = useState(defaultSelectedId ?? tabs[0]?.id);
  const selected = selectedId ?? own;
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  const choose = (next: string) => {
    setOwn(next);
    onSelect?.(next);
    list.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(next)}"]`)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((tab) => tab.id === selected);
    const step = list.current && isRtl(list.current) ? -1 : 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = at + step;
    else if (event.key === "ArrowLeft") next = at - step;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    choose(tabs[(next + tabs.length) % tabs.length]!.id);
  };

  return (
    <div className="pg-tabs">
      <div ref={list} role="tablist" aria-label={label} className="pg-tabs__list" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const active = tab.id === selected;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${id}-tab-${tab.id}`}
              data-tab={tab.id}
              aria-selected={active}
              aria-controls={`${id}-panel-${tab.id}`}
              tabIndex={active ? 0 : -1}
              className="pg-tabs__tab"
              onClick={() => choose(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${id}-panel-${tab.id}`}
          aria-labelledby={`${id}-tab-${tab.id}`}
          tabIndex={0}
          hidden={tab.id !== selected}
          className="pg-tabs__panel"
        >
          {tab.id === selected && tab.panel}
        </div>
      ))}
    </div>
  );
}
