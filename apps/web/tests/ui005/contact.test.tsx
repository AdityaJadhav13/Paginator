/**
 * The contact form (03 §4.2 /contact): it sends through the contact service (POST /api/v1/contact in the app), checks
 * its fields as the API does, in English and Marathi, presets the intent from the link, keeps the trap field empty and
 * hidden, and says plainly what happened.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import userEvent from "@testing-library/user-event";
import { fireEvent, screen, within } from "../../src/test/render.tsx";
import { text, type PublicLanguage } from "../../src/features/public/content.ts";
import { renderPublic } from "./renderPublic.tsx";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(path = "/contact", language: PublicLanguage = "en") {
  const view = renderPublic(path, "signed-out", language);
  await screen.findByRole("heading", { level: 1, name: text("contact-title", language) });
  await screen.findByRole("button", { name: text("contact-submit", language) });
  const main = within(view.container).getByRole("main");
  return { ...view, main, user: userEvent.setup() };
}

const nameField = (main: HTMLElement, language: PublicLanguage = "en") =>
  within(main).getByLabelText(new RegExp(`^${text("contact-label-name", language)}`));

describe("Sending", () => {
  it("sends every field, the intent, the language, an empty trap and the time taken, then confirms", async () => {
    const { main, user, environment } = await open();
    await user.type(nameField(main), "Asha Kalpit");
    await user.type(within(main).getByLabelText("Newspaper or organisation"), "Kalpitpur Samachar");
    await user.type(within(main).getByLabelText("City"), "Kalpitpur");
    await user.type(within(main).getByLabelText("Phone or WhatsApp"), "+91 98765 43210");
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.type(within(main).getByLabelText(/^Message/), "We print 8 pages.");
    await user.click(within(main).getByRole("radio", { name: "A pilot for my paper" }));
    await user.click(within(main).getByRole("button", { name: "Send" }));

    const confirmation = await screen.findByRole("alert");
    expect(confirmation).toHaveTextContent("Thank you. Your message was sent.");
    expect(confirmation).toHaveTextContent("It has gone by email to the Pageinator team.");
    expect(document.activeElement).toBe(confirmation.parentElement);
    const [sent] = environment.contactController.sent;
    expect(sent).toMatchObject({
      name: "Asha Kalpit",
      newspaper: "Kalpitpur Samachar",
      city: "Kalpitpur",
      phone: "+91 98765 43210",
      email: "asha@example.test",
      message: "We print 8 pages.",
      intent: "pilot",
      language: "en",
      website: "",
    });
    expect(sent?.filledInMs).toBeGreaterThanOrEqual(0);
    expect(environment.contactController.sent).toHaveLength(1);
  });

  it("offers to write another message, with an empty form", async () => {
    const { main, user } = await open();
    await user.type(nameField(main), "Asha");
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    await user.click(await within(main).findByRole("button", { name: "Write another message" }));
    expect(nameField(main)).toHaveValue("");
  });

  it("sends a phone number typed in Devanagari digits in ASCII digits, and says Marathi", async () => {
    const { main, user, environment } = await open("/contact", "mr");
    await user.type(nameField(main, "mr"), "आशा");
    await user.type(within(main).getByLabelText("फोन किंवा WhatsApp"), "९८७६५ ४३२१०");
    await user.click(within(main).getByRole("button", { name: "पाठवा" }));
    expect(await screen.findByText("धन्यवाद. तुमचा संदेश पाठवला गेला.")).toBeInTheDocument();
    expect(environment.contactController.sent[0]).toMatchObject({ phone: "98765 43210", language: "mr" });
  });

  it("shows Sending… while the message is on its way, and sends it once", async () => {
    const { main, user, environment } = await open();
    environment.contactController.hold();
    await user.type(nameField(main), "Asha");
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    const sending = await within(main).findByRole("button", { name: "Sending…" });
    await user.click(sending);
    environment.contactController.release();
    await screen.findByText("Thank you. Your message was sent.");
    expect(environment.contactController.sent).toHaveLength(1);
  });
});

describe("The intent", () => {
  it.each([
    ["/contact?intent=demo", "A demo"],
    ["/contact?intent=pilot", "A pilot for my paper"],
    ["/contact?intent=press", "We are a press (printing partner)"],
    ["/contact?intent=other", "Something else"],
    ["/contact?intent=nonsense", "A demo"],
    ["/contact", "A demo"],
  ])("%s preselects %s", async (path, label) => {
    const { main } = await open(path);
    expect(within(main).getByRole("radio", { name: label })).toBeChecked();
  });
});

describe("Checking the fields", () => {
  it("names the missing name and the missing phone or email, moves focus to the first, and sends nothing", async () => {
    const { main, user, environment } = await open();
    await user.click(within(main).getByRole("button", { name: "Send" }));
    expect(await within(main).findByText("Enter your name.")).toBeInTheDocument();
    expect(within(main).getByText("Give a phone number or an email address.")).toBeInTheDocument();
    expect(nameField(main)).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(nameField(main));
    expect(environment.contactController.sent).toEqual([]);
  });

  it("clears a problem as it is fixed", async () => {
    const { main, user } = await open();
    await user.click(within(main).getByRole("button", { name: "Send" }));
    await user.type(nameField(main), "Asha");
    expect(within(main).queryByText("Enter your name.")).toBeNull();
    expect(nameField(main)).not.toHaveAttribute("aria-invalid");
  });

  it("says when a phone number or an email address is not one", async () => {
    const { main, user } = await open();
    await user.type(nameField(main), "Asha");
    await user.type(within(main).getByLabelText("Phone or WhatsApp"), "call me");
    await user.type(within(main).getByLabelText("Email"), "asha at example");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    expect(await within(main).findByText("Write the phone number with digits, spaces and + ( ) - only.")).toBeInTheDocument();
    expect(within(main).getByText("Check the email address.")).toBeInTheDocument();
  });

  it("says the problems in Marathi on the Marathi page", async () => {
    const { main, user } = await open("/contact", "mr");
    await user.click(within(main).getByRole("button", { name: "पाठवा" }));
    expect(await within(main).findByText("तुमचे नाव लिहा.")).toBeInTheDocument();
    expect(within(main).getByText("फोन नंबर किंवा ईमेल पत्ता द्या.")).toBeInTheDocument();
  });

  it("limits every field's length as the API does", async () => {
    const { main } = await open();
    expect(nameField(main)).toHaveAttribute("maxlength", "100");
    expect(within(main).getByLabelText("Newspaper or organisation")).toHaveAttribute("maxlength", "120");
    expect(within(main).getByLabelText("City")).toHaveAttribute("maxlength", "80");
    expect(within(main).getByLabelText("Phone or WhatsApp")).toHaveAttribute("maxlength", "30");
    expect(within(main).getByLabelText("Email")).toHaveAttribute("maxlength", "254");
    expect(within(main).getByLabelText(/^Message/)).toHaveAttribute("maxlength", "4000");
  });
});

describe("When it cannot be sent", () => {
  it.each([
    ["unavailable", "The contact form is not connected yet", "Please try again later; what you wrote is still here."],
    ["busy", "Too many messages", "Too many messages have been sent. Please try again later."],
    ["failed", "Your message was not sent", "Check your connection and try again."],
    ["sendFailed", "Your message could not be sent just now", "Please try again later. What you wrote is still here."],
    ["refused", "This page could not send your message", "Copy what you wrote, reload the page and try again."],
  ] as const)("says so plainly (%s), keeps what was typed and moves focus to the message", async (kind, heading, body) => {
    const { main, user, environment } = await open();
    environment.contactController.setOutcome({ kind });
    await user.type(nameField(main), "Asha");
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    const message = await screen.findByRole("alert");
    expect(message).toHaveTextContent(heading);
    expect(message).toHaveTextContent(body);
    expect(document.activeElement).toBe(message.parentElement);
    expect(nameField(main)).toHaveValue("Asha");
  });

  it("says no connection is to blame when the server refuses the page (bad_origin), and the time is not the person's", async () => {
    const { main, user, environment } = await open();
    environment.contactController.setOutcome({ kind: "refused" });
    await user.type(nameField(main), "Asha");
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    const message = await screen.findByRole("alert");
    expect(message).not.toHaveTextContent(/connection/i);
  });

  it("gives a general message, not 'some fields', when only a field the person cannot see was refused", async () => {
    const { main, user, environment } = await open();
    environment.contactController.setOutcome({ kind: "invalid", fields: ["intent", "filledInMs"] });
    await user.type(nameField(main), "Asha");
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This page could not send your message");
    expect(screen.queryByText("Some fields need attention")).toBeNull();
  });

  it("says a field is too long, in its own words", async () => {
    const { main, user } = await open();
    fireEvent.change(nameField(main), { target: { value: "x".repeat(101) } });
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    expect(await within(main).findByText("This is too long.")).toBeInTheDocument();
  });

  it("marks the fields the API refused", async () => {
    const { main, user, environment } = await open();
    environment.contactController.setOutcome({ kind: "invalid", fields: ["email"] });
    await user.type(nameField(main), "Asha");
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Some fields need attention")).toBeInTheDocument();
    expect(within(main).getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(within(main).getByLabelText("Email"));
  });
});

describe("Privacy and the trap", () => {
  it("says where the message goes and what is kept, before the Send button", async () => {
    const { main } = await open();
    const line = within(main).getByText(/Your message is emailed to the Pageinator team and stays in their mailbox\./);
    expect(line).toHaveTextContent("This website keeps no copy of it.");
    expect(line).toHaveTextContent("your connection's address in the server's log");
    expect(line).not.toHaveTextContent(/only to reply/);
    const button = within(main).getByRole("button", { name: "Send" });
    expect(line.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the trap field from people and from assistive technology, out of the Tab order", async () => {
    const { main } = await open();
    const trap = main.querySelector<HTMLInputElement>('input[name="website"]');
    expect(trap).not.toBeNull();
    expect(trap?.closest("[hidden]")).not.toBeNull();
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap).toHaveAttribute("autocomplete", "off");
    expect(within(main).queryByRole("textbox", { name: "Leave this empty" })).toBeNull();
  });

  it("has no action, method or target, and no mail or phone link", async () => {
    const { main } = await open();
    const form = main.querySelector("form");
    expect(form).not.toHaveAttribute("action");
    expect(form).not.toHaveAttribute("method");
    expect(form).not.toHaveAttribute("target");
    expect(main.querySelector("a[href^='mailto:'], a[href^='tel:'], input[type='file']")).toBeNull();
  });

  it("reaches the network only through the contact service (no fetch of its own)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { main, user, environment } = await open();
    await user.type(nameField(main), "Asha");
    await user.type(within(main).getByLabelText("Email"), "asha@example.test");
    await user.click(within(main).getByRole("button", { name: "Send" }));
    await screen.findByText("Thank you. Your message was sent.");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(environment.contactController.sent).toHaveLength(1);
  });
});

describe("Keyboard", () => {
  it("can be filled and sent with the keyboard alone", async () => {
    const { main, user, environment } = await open();
    nameField(main).focus();
    await user.keyboard("Asha");
    await user.tab(); // newspaper
    await user.tab(); // city
    await user.tab(); // phone
    await user.tab(); // email
    await user.keyboard("asha@example.test");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("Thank you. Your message was sent.")).toBeInTheDocument();
    expect(environment.contactController.sent[0]?.email).toBe("asha@example.test");
  });
});

describe("Whether the form is connected", () => {
  it("shows the form, and says where messages go, only when the API says it is connected", async () => {
    const { main } = await open();
    expect(main).toHaveTextContent("Messages sent here go by email to the people who build Pageinator.");
    expect(main.querySelector("form")).not.toBeNull();
  });

  for (const language of ["en", "mr"] as const) {
    it(`says up front that it is not connected, with no form and no heading over one, in ${language}`, async () => {
      const view = renderPublic("/contact", "signed-out", language);
      view.environment.contactController.setConnection("notConnected");
      await screen.findByRole("heading", { level: 1, name: text("contact-title", language) });
      const main = within(view.container).getByRole("main");
      expect(await within(main).findByText(text("contact-unavailable-heading", language))).toBeInTheDocument();
      expect(main).toHaveTextContent(text("contact-off-body", language));
      expect(main.querySelector("form, input, textarea, button")).toBeNull();
      expect(main.querySelector("h2")).toBeNull();
      expect(main).not.toHaveTextContent(text("contact-form-title", language));
      expect(main).not.toHaveTextContent(text("contact-connected", language));
      expect(main.querySelector("a[href^='mailto:']")).toBeNull();
    });
  }

  it("says the form could not be reached when the API does not answer, with no form", async () => {
    const view = renderPublic("/contact", "signed-out");
    view.environment.contactController.setConnection("unknown");
    await screen.findByRole("heading", { level: 1, name: "Contact" });
    const main = within(view.container).getByRole("main");
    expect(await within(main).findByText("The contact form could not be reached")).toBeInTheDocument();
    expect(main.querySelector("form")).toBeNull();
  });

  it("shows neither the form nor a verdict while it asks", async () => {
    const view = renderPublic("/contact", "signed-out");
    const main = within(view.container).getByRole("main");
    expect(main).toHaveTextContent("Checking whether the form is connected…");
    expect(main.querySelector("form")).toBeNull();
    await screen.findByRole("button", { name: "Send" });
  });

  it("the security page says the form sends only when it is connected", async () => {
    const connected = renderPublic("/security", "signed-out");
    expect(await screen.findByText(text("security-contact", "en"))).toBeInTheDocument();
    connected.unmount();
    const off = renderPublic("/security", "signed-out");
    off.environment.contactController.setConnection("notConnected");
    expect(await screen.findByText(text("security-contact-off", "en"))).toBeInTheDocument();
    expect(within(off.container).getByRole("main")).not.toHaveTextContent(text("security-contact", "en"));
  });
});
