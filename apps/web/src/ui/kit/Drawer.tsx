import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { Icon } from "../icons/Icon.tsx";
import { focusableIn } from "./focusable.ts";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  /** The visible heading; it names the dialog. */
  title: string;
  /** The close button's name, in the page's language. */
  closeLabel: string;
  /**
   * Modal (the default): the rest of the page is inert and Tab stays inside. Non-modal: the page stays usable beside
   * it (a preview next to a list).
   */
  modal?: boolean;
  /** Its width: a narrow sheet (360 px) or a wide one (560 px). */
  size?: "narrow" | "wide";
  children: ReactNode;
  /** A footer row: the sheet's actions. */
  footer?: ReactNode;
}

/** A side sheet at the inline end (02 §3.5): dialog semantics, Esc closes, focus moves in and returns on close. */
export function Drawer({ open, ...rest }: DrawerProps) {
  return open ? <DrawerSheet {...rest} /> : null;
}

function DrawerSheet({ onClose, title, closeLabel, modal = true, size = "narrow", children, footer }: Omit<DrawerProps, "open">) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });


  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const opener = document.activeElement as HTMLElement | null;
    if (modal) element.showModal();
    else if (typeof element.show === "function") element.show();
    else element.setAttribute("open", "");
    heading.current?.focus();
    // a native close (the browser's own Esc handling) is a close request too
    const cancel = (event: Event) => {
      event.preventDefault();
      onCloseRef.current();
    };
    element.addEventListener("cancel", cancel);
    return () => {
      element.removeEventListener("cancel", cancel);
      if (element.open) element.close();
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
    };
  }, [modal]);

  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !modal || !dialog.current) return;
    const list = focusableIn(dialog.current);
    if (list.length === 0) return;
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === heading.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-modal={modal || undefined}
      className={`pg-drawer pg-drawer--${size}${modal ? "" : " pg-drawer--inline"}`}
      onKeyDown={onKeyDown}
    >
      <div className="pg-drawer__header">
        <h2 id={titleId} ref={heading} tabIndex={-1} className="pg-drawer__title">
          {title}
        </h2>
        <button type="button" className="pg-icon-button pg-drawer__close" aria-label={closeLabel} onClick={onClose}>
          <Icon name="x" size={20} />
        </button>
      </div>
      <div className="pg-drawer__body">{children}</div>
      {footer && <div className="pg-drawer__footer">{footer}</div>}
    </dialog>
  );
}
