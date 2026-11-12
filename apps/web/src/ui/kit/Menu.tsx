import { createContext, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Icon, type IconName } from "../icons/Icon.tsx";

interface MenuContextValue {
  close: (refocus: boolean) => void;
}
const MenuContext = createContext<MenuContextValue | null>(null);

export interface MenuButtonProps {
  /** The button's text, and the menu's name. */
  label: string;
  /** Show only the icon; the label stays the accessible name. */
  iconOnly?: boolean;
  icon?: IconName;
  /** Content of the button in place of the label (an avatar); `label` stays its accessible name. */
  trigger?: ReactNode;
  /** The menu opens at this end of the button. */
  align?: "start" | "end";
  /** Menu items (MenuItem), with MenuSeparator between groups. */
  children: ReactNode;
  className?: string;
}

/**
 * The WAI-ARIA menu button: Enter, Space or ↓ opens it on the first item, ↑ on the last; ↑ ↓ Home End move; Esc closes
 * and returns focus to the button; Tab closes; a click outside closes.
 */
export function MenuButton({ label, iconOnly = false, icon, trigger, align = "start", children, className }: MenuButtonProps) {
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  const items = () =>
    Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);

  useEffect(() => {
    if (!open) return;
    const list = items();
    (open === "last" ? list[list.length - 1] : list[0])?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(event.key === "ArrowDown" ? "first" : "last");
    }
  };

  const onMenuKey = (event: KeyboardEvent<HTMLUListElement>) => {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      list[(index + list.length) % list.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(list.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") close(false);
  };

  return (
    <div ref={root} className={["pg-menu", className].filter(Boolean).join(" ")}>
      <button
        ref={button}
        type="button"
        id={`${id}-button`}
        className={iconOnly || trigger ? "pg-menu__trigger pg-menu__trigger--icon" : "pg-menu__trigger"}
        aria-haspopup="menu"
        aria-expanded={Boolean(open)}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={iconOnly || trigger ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={() => setOpen((value) => (value ? false : "first"))}
        onKeyDown={onButtonKey}
      >
        {trigger ?? (
          <>
            {icon && <Icon name={icon} size={20} />}
            {!iconOnly && <span>{label}</span>}
            {!iconOnly && <Icon name="chevron-down" size={16} />}
          </>
        )}
      </button>
      {open && (
        <MenuContext.Provider value={{ close }}>
          <ul
            ref={menu}
            id={`${id}-menu`}
            role="menu"
            aria-labelledby={`${id}-button`}
            className={`pg-menu__list pg-menu__list--${align}`}
            onKeyDown={onMenuKey}
          >
            {children}
          </ul>
        </MenuContext.Provider>
      )}
    </div>
  );
}

export interface MenuItemProps {
  onSelect: () => void;
  icon?: IconName;
  disabled?: boolean;
  /** A destructive item, drawn in the danger colour (its words still say what it does). */
  danger?: boolean;
  children: ReactNode;
}

/** One action of a menu: it runs, then the menu closes and focus returns to the button. */
export function MenuItem({ onSelect, icon, disabled = false, danger = false, children }: MenuItemProps) {
  const menu = useContext(MenuContext);
  return (
    <li role="none">
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        aria-disabled={disabled || undefined}
        className={danger ? "pg-menu__item pg-menu__item--danger" : "pg-menu__item"}
        onClick={() => {
          if (disabled) return;
          menu?.close(true);
          onSelect();
        }}
      >
        {icon && <Icon name={icon} size={16} />}
        <span>{children}</span>
      </button>
    </li>
  );
}

export function MenuSeparator() {
  return <li role="separator" className="pg-menu__separator" />;
}
