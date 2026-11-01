// Email (src/modules/notifications/mailer.ts, src/modules/identity/emails.ts): the recipient check, sending in the
// background, failures reported without the message, and the sign-in emails' text.
import addressparser from "nodemailer/lib/addressparser";
import { describe, expect, it } from "vitest";
import { newSignInEmail, resetEmail, verificationEmail } from "../../src/modules/identity/emails.ts";
import { type Transport, PLAIN_ADDRESS, RecipientError, openMailer } from "../../src/modules/notifications/mailer.ts";

const ORIGIN = "https://app.example.test";

function capture(fail?: Error) {
  const sent: Parameters<Transport["sendMail"]>[0][] = [];
  const transport: Transport = {
    sendMail: async (message) => {
      if (fail) throw fail;
      sent.push(message);
    },
    close: () => undefined,
  };
  return { sent, transport };
}

describe("recipients", () => {
  it.each(["reporter.a@example.test", "desk+night@kalpaniknagar.example.test", "a.b_c%d-e@x-y.example.test"])(
    "accepts the plain address %s",
    (address) => expect(PLAIN_ADDRESS.test(address)).toBe(true),
  );

  // the shapes of nodemailer's addressparser advisories (GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w, GHSA-85x2-q946-cp5h)
  it.each([
    '"a>b"@example.test',
    "a(nested (comment) end)@example.test",
    "group: a@example.test; b@evil.example.test",
    "Reporter <a@example.test>",
    "a@example.test, b@evil.example.test",
    "a@example.test\r\nBcc: b@evil.example.test",
    "a@localhost",
    "a@[192.0.2.1]",
    "",
  ])("refuses %j", (address) => expect(PLAIN_ADDRESS.test(address)).toBe(false));

  // The parser itself is fixed too (>= 10.1.4, L2-248): on 10.1.1 these gave "b@evil.example.test)", ["",
  // "b@evil.example.test"] and "\"b" (checked 2026-11-02).
  it.each([
    ["a@example.test (x (y) b@evil.example.test)", "a@example.test"], // a nested comment ends early
    ['g: "x;b@evil.example.test" <a@example.test>;', "a@example.test"], // ";" inside a quoted string
    ['<"b>c"@example.test>', '"b>c"@example.test'], // ">" inside a quoted local part
  ])("nodemailer's address parser reads %j as the one address %j", (header, address) => {
    expect(addressparser(header, { flatten: true }).map((entry) => entry.address)).toEqual([address]);
  });
});

describe("the mailer", () => {
  it("sends in the background from the configured sender", async () => {
    const { sent, transport } = capture();
    const mailer = openMailer({ from: "Pageinator <no-reply@example.test>" }, transport, () => undefined);
    const mail = { kind: "verify-email" as const, to: "reporter.a@example.test", subject: "s", text: "t", html: "h" };
    expect(mailer.send(mail)).toBeUndefined();
    await mailer.idle();
    expect(sent).toEqual([
      { from: "Pageinator <no-reply@example.test>", to: "reporter.a@example.test", subject: "s", text: "t", html: "h" },
    ]);
  });

  it("refuses a recipient that is not one plain address, sending nothing", async () => {
    const { sent, transport } = capture();
    const mailer = openMailer({ from: "no-reply@example.test" }, transport, () => undefined);
    const mail = {
      kind: "reset-password" as const,
      to: "a@example.test, b@evil.example.test",
      subject: "s",
      text: "t",
      html: "h",
    };
    expect(() => mailer.send(mail)).toThrow(RecipientError);
    await mailer.idle();
    expect(sent).toEqual([]);
  });

  it("reports a failure with the kind of message only, never its text (its links carry tokens)", async () => {
    const { transport } = capture(
      Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:51025"), { code: "ESOCKET" }),
    );
    const failures: [string, string][] = [];
    const mailer = openMailer({ from: "no-reply@example.test" }, transport, (kind, error) => {
      failures.push([kind, error.message]);
    });
    mailer.send({ kind: "reset-password", to: "reporter.a@example.test", subject: "s", text: "TOKEN", html: "TOKEN" });
    await mailer.idle();
    expect(failures).toEqual([["reset-password", "connect ECONNREFUSED 127.0.0.1:51025"]]);
  });
});

describe("the sign-in emails", () => {
  it("say it in Marathi, then English, with the link in both, as text and HTML", () => {
    const url = `${ORIGIN}/api/auth/verify-email?token=t0k3n&callbackURL=%2F`;
    const mail = verificationEmail({ name: "Reporter A (fictional)", url, origin: ORIGIN });
    expect(mail.kind).toBe("verify-email");
    expect(mail.subject).toBe("Pageinator: तुमचा ईमेल पत्ता निश्चित करा · Confirm your email address");
    expect(mail.text.indexOf("नमस्कार Reporter A (fictional),")).toBeLessThan(mail.text.indexOf("Hello Reporter A"));
    expect(mail.text.split(url)).toHaveLength(3);
    expect(mail.html).toContain(`<a href="${url.replace(/&/g, "&amp;")}">`);
    expect(mail.html).toContain('<div lang="mr">');
  });

  it("escape a name in the HTML, and strip control and direction characters", () => {
    const mail = resetEmail({
      name: "<b>Eve</b>‮evil\r\nBcc",
      url: `${ORIGIN}/api/auth/reset-password/t`,
      origin: ORIGIN,
    });
    expect(mail.html).toContain("&lt;b&gt;Eve&lt;/b&gt; evil Bcc");
    expect(mail.html).not.toContain("<b>");
    expect(mail.text).toContain("Hello <b>Eve</b> evil Bcc,");
  });

  it("refuse a link that does not lead to the public origin", () => {
    expect(() => verificationEmail({ name: "x", url: "https://evil.example.test/verify", origin: ORIGIN })).toThrow(
      "An email link must lead to the public origin.",
    );
    expect(() => resetEmail({ name: "x", url: `${ORIGIN}.evil.example.test/r`, origin: ORIGIN })).toThrow();
  });

  it("give a new sign-in's time in India and the browser it came from", () => {
    const mail = newSignInEmail({
      name: "Reporter A (fictional)",
      at: new Date("2026-10-21T15:30:00Z"),
      device: "Mozilla/5.0 (Linux; Android 15) Fictional/1.0",
    });
    expect(mail.text).toContain("Someone signed in to your Pageinator account at 2026-10-21 21:00 IST");
    expect(mail.text).toContain("(Mozilla/5.0 (Linux; Android 15) Fictional/1.0)");
    expect(newSignInEmail({ name: "x", at: new Date(0), device: "" }).text).toContain("(an unknown browser)");
  });
});

describe("delivering and checking a message", () => {
  it("deliver settles once the mail server took it, and passes Reply-To; no html means plain text only", async () => {
    const { sent, transport } = capture();
    const mailer = openMailer({ from: "no-reply@example.test" }, transport, () => undefined);
    await mailer.deliver({
      kind: "contact",
      to: "team@example.test",
      subject: "s",
      text: "t",
      replyTo: "a@example.test",
    });
    expect(sent).toEqual([
      { from: "no-reply@example.test", to: "team@example.test", subject: "s", text: "t", replyTo: "a@example.test" },
    ]);
  });

  it("deliver rejects when the mail server refuses, and reports the kind only", async () => {
    const { transport } = capture(
      Object.assign(new Error("552 mailbox full for team@example.test"), { responseCode: 552 }),
    );
    const failures: string[] = [];
    const mailer = openMailer({ from: "no-reply@example.test" }, transport, (kind) => failures.push(kind));
    await expect(
      mailer.deliver({ kind: "contact", to: "team@example.test", subject: "s", text: "t" }),
    ).rejects.toThrow();
    await mailer.idle();
    expect(failures).toEqual(["contact"]);
  });

  it.each([
    ["a reply-to that is not one plain address", { replyTo: "a@example.test, b@evil.example.test" }],
    ["a reply-to with a line break", { replyTo: "a@example.test\r\nBcc: b@evil.example.test" }],
    ["a subject with a line break", { subject: "Hello\r\nBcc: b@evil.example.test" }],
    ["a subject with a line separator", { subject: "Hello Bcc: b@evil.example.test" }],
  ])("refuses %s, sending nothing", async (_case, change) => {
    const { sent, transport } = capture();
    const mailer = openMailer({ from: "no-reply@example.test" }, transport, () => undefined);
    const mail = { kind: "contact" as const, to: "team@example.test", subject: "s", text: "t", ...change };
    expect(() => mailer.send(mail)).toThrow(RecipientError);
    await expect(mailer.deliver(mail)).rejects.toThrow(RecipientError);
    expect(sent).toEqual([]);
  });
});
