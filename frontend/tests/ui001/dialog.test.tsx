/**
 * Task 6 — Dialog, InlineMessage, and ProgressIndicator tests.
 * Verifies accessible name, focus management, Escape behavior,
 * background inertness, and message semantics.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "../../src/test/render.tsx";
import userEvent from "@testing-library/user-event";
import { Dialog } from "../../src/ui/controls/Dialog.tsx";
import { InlineMessage } from "../../src/ui/controls/InlineMessage.tsx";
import { ProgressIndicator } from "../../src/ui/controls/ProgressIndicator.tsx";
import { Button } from "../../src/ui/controls/Button.tsx";

// ── Dialog ───────────────────────────────────────────────────────────
//
// The HTMLDialogElement.showModal/close polyfill needed by jsdom 30 is
// installed once, globally, in src/test/setup.ts.

describe("Dialog", () => {
  it("renders with a visible heading", () => {
    render(
      <Dialog open onClose={() => void 0} title="Edit edition">
        <p>Dialog body</p>
      </Dialog>
    );
    expect(screen.getByRole("heading", { name: "Edit edition" })).toBeInTheDocument();
  });

  it("dialog heading is the accessible name", () => {
    render(
      <Dialog open onClose={() => void 0} title="Review proof">
        <p>Content</p>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Review proof");
  });

  it("associates optional description via aria-describedby", () => {
    render(
      <Dialog
        open
        onClose={() => void 0}
        title="Review proof"
        description="Please verify all fields before confirming."
      >
        <p>Content</p>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    const descEl = screen.getByText("Please verify all fields before confirming.");
    expect(dialog.getAttribute("aria-describedby")).toContain(descEl.id);
  });

  it("close button is present for dismissible dialog", () => {
    render(
      <Dialog open onClose={() => void 0} title="Dismissible" dismissible>
        <p>Content</p>
      </Dialog>
    );
    expect(screen.getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
  });

  it("close button is absent for non-dismissible dialog", () => {
    render(
      <Dialog open onClose={() => void 0} title="Non-dismissible" dismissible={false}>
        <p>Content</p>
      </Dialog>
    );
    expect(screen.queryByRole("button", { name: "Close dialog" })).not.toBeInTheDocument();
  });

  it("calls onClose when close button is clicked", async () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Dismissible" dismissible>
        <p>Content</p>
      </Dialog>
    );
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape calls onClose for dismissible dialog", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Dismissible" dismissible>
        <p>Content</p>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Escape does not call onClose for non-dismissible dialog", () => {
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Non-dismissible" dismissible={false}>
        <p>Content</p>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("uses aria-labelledby pointing to the heading", () => {
    render(
      <Dialog open onClose={() => void 0} title="Review">
        <p>Content</p>
      </Dialog>
    );
    const dialog = screen.getByRole("dialog");
    const heading = screen.getByRole("heading", { name: "Review" });
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
  });

  it("restores focus to invoker on close", async () => {
    const onClose = vi.fn();

    function Wrapper() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Open dialog</Button>
          <Dialog open={open} onClose={() => { setOpen(false); onClose(); }} title="Test">
            <p>Content</p>
          </Dialog>
        </>
      );
    }

    render(<Wrapper />);
    const btn = screen.getByRole("button", { name: "Open dialog" });
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(btn);
    });
  });

  // ── H-04 regression: a native close the component did not itself
  // initiate must resynchronize state, so the dialog can be reopened. ──
  //
  // Some browsers group rapid repeated Escape presses through their
  // close-watcher and will natively close a <dialog> — including a
  // non-dismissible one — bypassing "cancel"'s preventDefault on the
  // second press (confirmed in Chromium; jsdom does not implement the
  // close-watcher grouping behavior itself, so this test instead
  // dispatches the same "close" event the browser would dispatch, and
  // checks the component reacts to it the same way it must in a real
  // browser: by calling onClose to keep state in sync).
  describe("H-04: out-of-band native close", () => {
    it("a close this component did not itself request calls onClose", () => {
      const onClose = vi.fn();
      render(
        <Dialog open onClose={onClose} title="Non-dismissible" dismissible={false}>
          <p>Content</p>
        </Dialog>
      );
      const dialog = screen.getByRole("dialog") as HTMLDialogElement;
      // Simulate the browser closing the dialog natively (e.g. a second,
      // ungrouped Escape) without this component having called close()
      // itself — a real "cancel" is not required first for this case.
      // Calling .close() directly (rather than only dispatching a bare
      // "close" event) matches real <dialog> semantics: the user agent
      // flips `.open` to false and then fires "close" — a synthetic
      // event alone would not change `.open` in any environment.
      dialog.close();
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("self-initiated close (via the close button) does not double-call onClose", async () => {
      const onClose = vi.fn();
      render(
        <Dialog open onClose={onClose} title="Dismissible" dismissible>
          <p>Content</p>
        </Dialog>
      );
      await userEvent.click(screen.getByRole("button", { name: "Close dialog" }));
      // The click calls onClose once; the resulting dialog.close() call
      // (once `open` becomes false) dispatches its own native "close"
      // event, which must not call onClose a second time.
      expect(onClose).toHaveBeenCalledOnce();
    });

    it("after an out-of-band close, the opener can reopen the dialog", async () => {
      function Wrapper() {
        const [open, setOpen] = React.useState(true);
        return (
          <>
            <Button onClick={() => setOpen(true)}>Open dialog</Button>
            <Dialog open={open} onClose={() => setOpen(false)} title="Test" dismissible={false}>
              <p>Content</p>
            </Dialog>
          </>
        );
      }

      render(<Wrapper />);
      const dialog = screen.getByRole("dialog") as HTMLDialogElement;
      expect(dialog).toHaveProperty("open", true);

      // Out-of-band native close (this component did not call close()).
      dialog.close();
      expect(dialog).toHaveProperty("open", false);

      // The opener must be able to reopen it — this is exactly what was
      // broken before the fix: the effect never re-ran because React's
      // `open` prop had not changed from the component's perspective.
      await userEvent.click(screen.getByRole("button", { name: "Open dialog" }));
      expect(dialog).toHaveProperty("open", true);
    });
  });
});

// ── InlineMessage ─────────────────────────────────────────────────────

describe("InlineMessage", () => {
  it("renders info variant with heading", () => {
    render(<InlineMessage variant="info" heading="Information">Details</InlineMessage>);
    expect(screen.getByText("Information")).toBeInTheDocument();
    expect(screen.getByText("Details")).toBeInTheDocument();
  });

  it("renders success variant", () => {
    const { container } = render(
      <InlineMessage variant="success" heading="Saved">Content</InlineMessage>
    );
    expect(container.firstChild).toHaveClass("pg-inline-message--success");
  });

  it("renders warning variant", () => {
    const { container } = render(
      <InlineMessage variant="warning" heading="Warning">Content</InlineMessage>
    );
    expect(container.firstChild).toHaveClass("pg-inline-message--warning");
  });

  it("renders error variant", () => {
    const { container } = render(
      <InlineMessage variant="error" heading="Error">Content</InlineMessage>
    );
    expect(container.firstChild).toHaveClass("pg-inline-message--error");
  });

  it("has role=alert when live=true (user-triggered error)", () => {
    render(
      <InlineMessage variant="error" heading="Submission failed" live>
        Please fix errors above.
      </InlineMessage>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("does not have role=alert when live=false (static content)", () => {
    render(
      <InlineMessage variant="info" heading="Guidance">
        Use this form to submit.
      </InlineMessage>
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("includes a non-colour icon with accessible label", () => {
    const { container } = render(
      <InlineMessage variant="error" heading="Error">Content</InlineMessage>
    );
    const icon = container.querySelector(".pg-inline-message__icon");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute("aria-label", "Error");
  });
});

// ── ProgressIndicator ────────────────────────────────────────────────

describe("ProgressIndicator", () => {
  it("renders a visible label for known progress", () => {
    render(<ProgressIndicator label="Resolving layout — 50% complete" value={50} />);
    expect(screen.getByText("Resolving layout — 50% complete")).toBeInTheDocument();
  });

  it("renders a native progress element for known progress", () => {
    const { container } = render(
      <ProgressIndicator label="Exporting" value={75} max={100} />
    );
    const progress = container.querySelector("progress");
    expect(progress).toBeInTheDocument();
    expect(progress).toHaveAttribute("value", "75");
    expect(progress).toHaveAttribute("max", "100");
  });

  it("renders indeterminate progress with text label", () => {
    render(<ProgressIndicator label="Processing — please wait" />);
    expect(screen.getByText("Processing — please wait")).toBeInTheDocument();
  });

  it("indeterminate progress has no native progress element", () => {
    const { container } = render(
      <ProgressIndicator label="Working" />
    );
    expect(container.querySelector("progress")).not.toBeInTheDocument();
  });

  it("indeterminate spinner is aria-hidden (decorative)", () => {
    const { container } = render(
      <ProgressIndicator label="Working" />
    );
    const spinner = container.querySelector(".pg-progress__spinner");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });

  it("state is conveyed via text, not animation alone", () => {
    render(<ProgressIndicator label="Recomposing layout for demo-rev-019" />);
    expect(
      screen.getByText("Recomposing layout for demo-rev-019")
    ).toBeInTheDocument();
  });
});

// Import React for the focus restoration test
import React from "react";
