import { useRef, useEffect, useId, type ReactNode } from "react";

export interface DialogProps {
  /** Whether the dialog is currently open. */
  open: boolean;
  /** Called when the dialog requests closure (Escape or close button). */
  onClose: () => void;
  /** Visible heading that supplies the dialog's accessible name. */
  title: string;
  /**
   * Optional description text associated with the dialog.
   * Associated via aria-describedby when present.
   */
  description?: string;
  /**
   * Whether Escape closes the dialog.
   * Set to false for destructive or in-progress confirmations that require
   * an explicit action rather than accidental dismissal.
   */
  dismissible?: boolean;
  children?: ReactNode;
  className?: string;
}

/**
 * Modal dialog using the native <dialog> element.
 * Opening moves focus to the dialog heading.
 * Tab and Shift+Tab are contained within an open modal by native browser behavior.
 * Closing restores focus to the invoker when it still exists.
 * Background content is not interactive while the modal dialog is open.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  dismissible = true,
  children,
  className,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = description ? `${titleId}-desc` : undefined;
  // True for the brief window between this component calling
  // dialog.close() itself and the resulting native "close" event
  // handler running, so that self-initiated closes are not treated as
  // an out-of-band native close (see handleClose below).
  const selfInitiatedCloseRef = useRef(false);

  // Open / close the native dialog and manage focus
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      openerRef.current = document.activeElement as HTMLElement | null;
      if (!dialog.open) {
        dialog.showModal();
      }
      // Move focus to the heading as the first appropriate element
      headingRef.current?.focus();
    } else {
      if (dialog.open) {
        selfInitiatedCloseRef.current = true;
        dialog.close();
      }
      // Restore focus to invoker
      const opener = openerRef.current;
      openerRef.current = null;
      if (opener && opener !== document.body) {
        opener.focus();
      }
    }
  }, [open]);

  // Handle native cancel/close events.
  //
  // Some browsers group rapid repeated Escape presses through their
  // close-watcher and will natively close a <dialog> — including one
  // marked non-dismissible here — bypassing `cancel`'s preventDefault
  // on the second press. When that happens the native element and
  // this component's `open` prop fall out of sync: the effect above
  // never re-runs (its dependency did not change), so the opener can
  // no longer reopen the dialog. The `close` listener below detects
  // any native close this component did not itself initiate and calls
  // `onClose` to resynchronize state, whatever caused it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleCancel = (e: Event) => {
      e.preventDefault(); // prevent native close; we manage state
      if (dismissible) {
        onClose();
      }
    };

    const handleClose = () => {
      if (selfInitiatedCloseRef.current) {
        // Already handled by the effect above; avoid a duplicate onClose.
        selfInitiatedCloseRef.current = false;
        return;
      }
      onClose();
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);
    return () => {
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
    };
  }, [dismissible, onClose]);

  // Close the native dialog on unmount so it never leaves a dangling
  // open modal (and its backdrop/background inertness) behind.
  useEffect(() => {
    return () => {
      const dialog = dialogRef.current;
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descId}
      className={["pg-dialog", className].filter(Boolean).join(" ")}
    >
      <div className="pg-dialog__header">
        {/* tabIndex={-1} allows programmatic focus on the heading */}
        <h2
          ref={headingRef}
          id={titleId}
          className="pg-dialog__title"
          tabIndex={-1}
        >
          {title}
        </h2>
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            className="pg-dialog__close"
            aria-label="Close dialog"
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {description && (
        <p id={descId} className="pg-dialog__description">
          {description}
        </p>
      )}

      <div className="pg-dialog__content">{children}</div>
    </dialog>
  );
}
