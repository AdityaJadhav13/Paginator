/**
 * Contact non-sending behavior and accessibility (UI005 §28 rows
 * "Contact — no submission" and "Contact — behavior"; AC-38 – AC-43).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { screen, within } from "../../src/test/render.tsx";
import { renderPublic } from "./renderPublic.tsx";

const HEADING = "Contact";

async function contactMain() {
  const { container } = renderPublic("/contact");
  await screen.findByRole("heading", { level: 1, name: HEADING });
  return within(container).getByRole("main");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("The contact form cannot send (AC-38 – AC-40)", () => {
  it("declares no action, method or target", async () => {
    const main = await contactMain();
    const form = main.querySelector("form");

    expect(form).not.toBeNull();
    expect(form).not.toHaveAttribute("action");
    expect(form).not.toHaveAttribute("method");
    expect(form).not.toHaveAttribute("target");
  });

  it("performs no network or storage side effect on submit", async () => {
    const fetchSpy = vi.fn();
    const sendBeaconSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubGlobal("navigator", { ...window.navigator, sendBeacon: sendBeaconSpy });
    const xhrOpenSpy = vi.spyOn(XMLHttpRequest.prototype, "open");
    const xhrSendSpy = vi.spyOn(XMLHttpRequest.prototype, "send");
    const submitSpy = vi.spyOn(HTMLFormElement.prototype, "submit");
    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    const websocketSpy = vi.fn();
    vi.stubGlobal("WebSocket", websocketSpy);

    const cookiesBefore = document.cookie;
    const urlBefore = window.location.pathname;

    const main = await contactMain();
    const user = userEvent.setup();

    await user.type(
      within(main).getByLabelText(/^Message/),
      "A note that will not go anywhere."
    );
    await user.click(within(main).getByRole("button", { name: "Preview the acknowledgement" }));

    expect(await screen.findByText("Nothing was sent")).toBeInTheDocument();

    for (const spy of [
      fetchSpy,
      sendBeaconSpy,
      xhrOpenSpy,
      xhrSendSpy,
      submitSpy,
      localSpy,
      websocketSpy,
    ]) {
      expect(spy).not.toHaveBeenCalled();
    }
    expect(document.cookie).toBe(cookiesBefore);
    expect(window.location.pathname).toBe(urlBefore);
  });

  it("renders no mailto link, address or upload control (AC-43)", async () => {
    const main = await contactMain();

    expect(main.querySelector("a[href^='mailto:']")).toBeNull();
    expect(main.querySelector("a[href^='tel:']")).toBeNull();
    expect(main.querySelector("input[type='file']")).toBeNull();
    expect(main.querySelector("input[type='email']")).toBeNull();
    expect(main.querySelector("input[type='password']")).toBeNull();
    expect(main.querySelector("input[type='checkbox']")).toBeNull();

    const text = main.textContent ?? "";
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    expect(text).not.toMatch(/we'?ll (get back|respond|reply)/i);
  });
});

describe("Acknowledgement behavior (AC-41, AC-42)", () => {
  it("acknowledges, clears the fields and moves focus", async () => {
    const main = await contactMain();
    const user = userEvent.setup();

    const name = within(main).getByLabelText("Name");
    const message = within(main).getByLabelText(/^Message/);

    await user.type(name, "A Reader");
    await user.type(message, "Something to acknowledge.");
    await user.click(within(main).getByRole("button", { name: "Preview the acknowledgement" }));

    const acknowledgement = await screen.findByRole("alert");
    expect(acknowledgement).toHaveTextContent("Nothing was sent");
    expect(acknowledgement).toHaveTextContent(
      "Your text was not transmitted and was not stored."
    );

    expect(name).toHaveValue("");
    expect(message).toHaveValue("");
    expect(document.activeElement).toBe(acknowledgement.parentElement);
  });

  it("shows the required-field error and no acknowledgement on an empty message", async () => {
    const main = await contactMain();
    const user = userEvent.setup();

    await user.click(within(main).getByRole("button", { name: "Preview the acknowledgement" }));

    expect(
      await screen.findByText("Enter a message to see the acknowledgement.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Nothing was sent")).toBeNull();
    expect(within(main).getByLabelText(/^Message/)).toHaveAttribute("aria-invalid", "true");
  });

  it("is operable by keyboard alone", async () => {
    const main = await contactMain();
    const user = userEvent.setup();

    within(main).getByLabelText(/^Message/).focus();
    await user.keyboard("Typed without a mouse.");
    await user.tab();
    expect(document.activeElement).toHaveAccessibleName("Preview the acknowledgement");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("Nothing was sent")).toBeInTheDocument();
  });
});

describe("Standing qualification (§18.2)", () => {
  it("states that the form does not send, above the first field", async () => {
    const main = await contactMain();

    expect(main).toHaveTextContent("This form does not send anything.");
    const qualification = within(main).getByText(/This form does not send anything\./);
    const form = main.querySelector("form")!;

    expect(
      qualification.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});
