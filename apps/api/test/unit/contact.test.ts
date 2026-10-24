// The website's contact form (src/modules/contact/routes.ts): POST /api/v1/contact. Checked here with a mail transport
// that catches the messages, so no mail server is needed: the answers, the checks, the trap field and the fill time,
// the limits, the email's headers and text, and the log, which must never carry what a person wrote.
import { describe, expect, it } from "vitest";
import { type AppDeps, buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { contactEmail } from "../../src/modules/contact/routes.ts";
import type { OutgoingMail, Transport } from "../../src/modules/notifications/mailer.ts";
import { FROM_APP, ORIGIN, PASSWORDS } from "./helpers.ts";

const TEAM = "team@example.test";
const PATH = "/api/v1/contact";

/** A message a person might send, with fictional details. */
const GOOD = {
  name: "Asha Kalpit (fictional)",
  newspaper: "Kalpitpur Samachar (fictional)",
  city: "Kalpitpur",
  phone: "+91 98765 43210",
  email: "asha.kalpit@example.test",
  message: "We print 8 pages a day.\nCould we see a demo?",
  intent: "demo",
  language: "mr",
  website: "",
  filledInMs: 45_000,
} as const;

type Setup = { to?: string | null; fail?: Error; limits?: AppDeps["contactLimits"]; dropPause?: () => number };

async function setup({ to = TEAM, fail, limits, dropPause = () => 0 }: Setup = {}) {
  const sent: OutgoingMail[] = [];
  const lines: string[] = [];
  const mailServer = { fail };
  const transport: Transport = {
    sendMail: async (message) => {
      if (mailServer.fail) throw mailServer.fail;
      sent.push(message);
    },
    close: () => undefined,
  };
  const config = loadConfig({
    PGN_LOG_LEVEL: "info",
    PGN_ALLOWED_ORIGINS: ORIGIN,
    ...PASSWORDS,
    ...(to === null ? {} : { PGN_CONTACT_TO: to }),
  });
  const app = await buildApp({
    config,
    checks: {},
    mailTransport: transport,
    logStream: { write: (line) => void lines.push(line) },
    ...(limits ? { contactLimits: limits } : {}),
    contactDropPause: dropPause,
  });
  const post = (body: unknown, options: { address?: string; headers?: Record<string, string> } = {}) =>
    app.inject({
      method: "POST",
      url: PATH,
      headers: { ...FROM_APP, "content-type": "application/json", ...options.headers },
      payload: JSON.stringify(body),
      ...(options.address ? { remoteAddress: options.address } : {}),
    });
  return { app, sent, lines, post, mailServer };
}

describe("a message", () => {
  it("is emailed, as plain text, to the address of the settings, and answered 200", async () => {
    const { app, sent, post } = await setup();
    const answer = await post(GOOD);
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ received: true });
    expect(answer.headers["cache-control"]).toBe("no-store");
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail?.to).toBe(TEAM);
    expect(mail?.from).toBe("Pageinator <no-reply@example.test>");
    expect(mail?.subject).toBe("Pageinator website: Book a demo");
    expect(mail?.replyTo).toBe(GOOD.email);
    expect(mail?.html).toBeUndefined();
    for (const value of [GOOD.name, GOOD.newspaper, GOOD.city, GOOD.phone, GOOD.email, GOOD.message]) {
      expect(mail?.text).toContain(value);
    }
    expect(mail?.text).toContain("Wrote in: Marathi");
    await app.close();
  });

  it("needs only a name and a phone number or an email address; Reply-To only with an email address", async () => {
    const { app, sent, post } = await setup();
    const answer = await post({
      name: "R. Kalpit",
      phone: "020 1234 5678",
      intent: "press",
      language: "en",
      filledInMs: 9000,
    });
    expect(answer.statusCode).toBe(200);
    expect(sent[0]?.replyTo).toBeUndefined();
    expect(sent[0]?.subject).toBe("Pageinator website: A press (printing) partner");
    expect(sent[0]?.text).toContain("Email: (not given)");
    expect(sent[0]?.text).toContain("(no message)");
    await app.close();
  });
});

describe("the checks", () => {
  it.each([
    ["no name", { ...GOOD, name: "   " }, "body.name"],
    ["neither a phone number nor an email address", { ...GOOD, phone: "", email: "" }, "body.email"],
    [
      "an email address that is not one plain address",
      { ...GOOD, email: "a@example.test, b@evil.example.test" },
      "body.email",
    ],
    ["a phone number with letters", { ...GOOD, phone: "call me maybe" }, "body.phone"],
    ["an unknown intent", { ...GOOD, intent: "buy" }, "body.intent"],
    ["an unknown language", { ...GOOD, language: "fr" }, "body.language"],
    ["a name too long", { ...GOOD, name: "न".repeat(101) }, "body.name"],
    ["a newspaper too long", { ...GOOD, newspaper: "x".repeat(121) }, "body.newspaper"],
    ["a city too long", { ...GOOD, city: "x".repeat(81) }, "body.city"],
    ["a message too long", { ...GOOD, message: "x".repeat(4001) }, "body.message"],
    ["no fill time", { ...GOOD, filledInMs: undefined }, "body.filledInMs"],
    ["an unknown field", { ...GOOD, bcc: "b@evil.example.test" }, "body"],
  ])("refuses %s with 400 invalid_request, naming the field, and sends nothing", async (_case, body, field) => {
    const { app, sent, post } = await setup();
    const answer = await post(body);
    expect(answer.statusCode).toBe(400);
    const { error } = answer.json() as { error: { code: string; details?: { field: string }[] } };
    expect(error.code).toBe("invalid_request");
    expect(error.details?.map((problem) => problem.field)).toContain(field);
    expect(sent).toEqual([]);
    await app.close();
  });

  it("refuses a request from another site, or without X-Pageinator, with 403 bad_origin", async () => {
    const { app, sent, post } = await setup();
    expect((await post(GOOD, { headers: { origin: "https://evil.example.test" } })).statusCode).toBe(403);
    const bare = await app.inject({
      method: "POST",
      url: PATH,
      headers: { origin: ORIGIN, "content-type": "application/json" },
      payload: JSON.stringify(GOOD),
    });
    expect(bare.statusCode).toBe(403);
    expect((bare.json() as { error: { code: string } }).error.code).toBe("bad_origin");
    expect(sent).toEqual([]);
    await app.close();
  });
});

describe("header injection", () => {
  it.each([
    ["name", "Asha\r\nBcc: victim@evil.example.test"],
    ["newspaper", "Samachar\nSubject: hi"],
    ["city", "Pune\rTo: victim@evil.example.test"],
    ["email", "asha@example.test\r\nBcc: victim@evil.example.test"],
    ["phone", "+91 98\r\n76"],
    ["name", "Asha\u2028Bcc: victim@evil.example.test"],
  ])("refuses a line break in %s", async (field, value) => {
    const { app, sent, post } = await setup();
    const answer = await post({ ...GOOD, [field]: value });
    expect(answer.statusCode).toBe(400);
    expect(sent).toEqual([]);
    await app.close();
  });

  it("keeps a message's own line breaks in the text, and never puts what was typed in a header", async () => {
    const { app, sent, post } = await setup();
    const message = "Line one\r\nBcc: victim@evil.example.test\nSubject: injected";
    expect((await post({ ...GOOD, message })).statusCode).toBe(200);
    const [mail] = sent;
    expect(mail?.text).toContain("Bcc: victim@evil.example.test");
    expect(mail?.subject).toBe("Pageinator website: Book a demo");
    expect(mail?.to).toBe(TEAM);
    expect(Object.keys(mail ?? {}).sort()).toEqual(["from", "replyTo", "subject", "text", "to"]);
    await app.close();
  });

  it("refuses other control characters and bidirectional overrides in the message", async () => {
    const { app, post } = await setup();
    for (const message of ["bell\u0007", "nul\u0000", "rtl\u202e", "isolate\u2066"]) {
      expect((await post({ ...GOOD, message })).statusCode, JSON.stringify(message)).toBe(400);
    }
    await app.close();
  });

  it("builds the email from fixed text: the subject comes from the intent only", () => {
    const mail = contactEmail({ ...GOOD, intent: "other", language: "en", website: "", filledInMs: 9000 }, TEAM);
    expect(mail.subject).toBe("Pageinator website: Something else");
    expect(mail.subject).not.toContain(GOOD.name);
  });
});

describe("spam", () => {
  it("drops a message whose trap field is filled, with the same answer as a sent one", async () => {
    const { app, sent, lines, post } = await setup();
    const answer = await post({ ...GOOD, website: "https://spam.example.test" });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ received: true });
    expect(sent).toEqual([]);
    expect(lines.join("")).toContain('"reason":"trap"');
    await app.close();
  });

  it("drops a message sent faster than a person can fill the form", async () => {
    const { app, sent, lines, post } = await setup();
    const answer = await post({ ...GOOD, filledInMs: 800 });
    expect(answer.statusCode).toBe(200);
    expect(sent).toEqual([]);
    expect(lines.join("")).toContain('"reason":"too-fast"');
    await app.close();
  });
});

describe("the limits", () => {
  it("allows 5 messages an hour from one address, then answers 429 contact_limit with Retry-After", async () => {
    const { app, sent, post } = await setup();
    for (let i = 0; i < 5; i++) expect((await post(GOOD, { address: "198.51.100.7" })).statusCode).toBe(200);
    const refused = await post(GOOD, { address: "198.51.100.7" });
    expect(refused.statusCode).toBe(429);
    const { error } = refused.json() as { error: { code: string; message: string } };
    expect(error.code).toBe("contact_limit");
    expect(error.message).not.toMatch(/minute/);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThan(0);
    // another address is not affected
    expect((await post(GOOD, { address: "198.51.100.8" })).statusCode).toBe(200);
    expect(sent).toHaveLength(6);
    await app.close();
  });

  it("counts a message refused for a field against nothing but the API's per-minute budget", async () => {
    const { app, post } = await setup();
    for (let i = 0; i < 8; i++)
      expect((await post({ ...GOOD, name: "" }, { address: "198.51.100.9" })).statusCode).toBe(400);
    expect((await post(GOOD, { address: "198.51.100.9" })).statusCode).toBe(200);
    await app.close();
  });

  it("counts dropped messages too, so a program cannot keep trying", async () => {
    const { app, post } = await setup();
    for (let i = 0; i < 5; i++) await post({ ...GOOD, website: "x" }, { address: "198.51.100.10" });
    expect((await post(GOOD, { address: "198.51.100.10" })).statusCode).toBe(429);
    await app.close();
  });

  it("allows 20 a day from one address", async () => {
    const { app, post } = await setup({ limits: { perHour: 100, perDay: 20, perDayAll: 1000 } });
    for (let i = 0; i < 20; i++) expect((await post(GOOD, { address: "198.51.100.11" })).statusCode).toBe(200);
    expect((await post(GOOD, { address: "198.51.100.11" })).statusCode).toBe(429);
    await app.close();
  });

  it("caps the messages sent in a day from every address together (200 by default)", async () => {
    const { app, sent, post } = await setup();
    for (let i = 0; i < 200; i++) {
      const address = `10.${Math.floor(i / 250)}.${i % 250}.1`;
      expect((await post(GOOD, { address })).statusCode).toBe(200);
    }
    const refused = await post(GOOD, { address: "203.0.113.200" });
    expect(refused.statusCode).toBe(429);
    expect(sent).toHaveLength(200);
    await app.close();
  });
});

describe("not connected", () => {
  it("answers 503 contact_unavailable without PGN_CONTACT_TO, whatever was sent", async () => {
    const { app, sent, post } = await setup({ to: null });
    for (const body of [GOOD, { nonsense: true }]) {
      const answer = await post(body);
      expect(answer.statusCode).toBe(503);
      expect((answer.json() as { error: { code: string } }).error.code).toBe("contact_unavailable");
    }
    expect(sent).toEqual([]);
    await app.close();
  });

  it("answers 503 contact_send_failed when the mail server does not take the message", async () => {
    const failure = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:51025 for asha.kalpit@example.test"), {
      code: "ESOCKET",
    });
    const { app, lines, post } = await setup({ fail: failure });
    const answer = await post(GOOD);
    expect(answer.statusCode).toBe(503);
    expect((answer.json() as { error: { code: string } }).error.code).toBe("contact_send_failed");
    const log = lines.join("");
    expect(log).toContain('"kind":"contact"');
    expect(log).toContain('"code":"ESOCKET"');
    expect(log).not.toContain("asha.kalpit@example.test");
    await app.close();
  });

  it("refuses a PGN_CONTACT_TO that is not one plain address", () => {
    expect(() => loadConfig({ ...PASSWORDS, PGN_CONTACT_TO: "Team <team@example.test>" })).toThrow(/PGN_CONTACT_TO/);
    expect(() => loadConfig({ ...PASSWORDS, PGN_CONTACT_TO: "a@example.test,b@example.test" })).toThrow(
      /PGN_CONTACT_TO/,
    );
  });
});

describe("the log", () => {
  it("never carries a name, an address, a number, the newspaper, the city or the message", async () => {
    const { app, lines, post } = await setup();
    await post(GOOD);
    await post({ ...GOOD, name: "" }); // refused
    await post({ ...GOOD, website: "trap" }); // dropped
    const log = lines.join("");
    expect(log).toContain("contact: sent");
    expect(log).toContain('"intent":"demo"');
    for (const personal of [
      "Asha",
      "Kalpit",
      "98765",
      "asha.kalpit",
      "Samachar",
      "Could we see a demo",
      "8 pages a day",
    ]) {
      expect(log, personal).not.toContain(personal);
    }
    await app.close();
  });
});

describe("whether the form is connected", () => {
  it("GET answers {connected: true} with PGN_CONTACT_TO set, no-store, and nothing more", async () => {
    const { app } = await setup();
    const answer = await app.inject({ method: "GET", url: PATH });
    expect(answer.statusCode).toBe(200);
    expect(answer.json()).toEqual({ connected: true });
    expect(answer.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("GET answers {connected: false} without it", async () => {
    const { app } = await setup({ to: null });
    expect((await app.inject({ method: "GET", url: PATH })).json()).toEqual({ connected: false });
    await app.close();
  });

  it("GET counts against the signed-out per-minute budget like every request", async () => {
    const { app } = await setup();
    let last = 0;
    for (let i = 0; i < 61; i++)
      last = (await app.inject({ method: "GET", url: PATH, remoteAddress: "198.51.100.40" })).statusCode;
    expect(last).toBe(429);
    await app.close();
  });
});

describe("what costs a budget", () => {
  it("does not count a message the mail server did not take", async () => {
    const { app, sent, post, mailServer } = await setup();
    mailServer.fail = Object.assign(new Error("down"), { code: "ESOCKET" });
    for (let i = 0; i < 7; i++) expect((await post(GOOD, { address: "198.51.100.30" })).statusCode).toBe(503);
    mailServer.fail = undefined;
    expect((await post(GOOD, { address: "198.51.100.30" })).statusCode).toBe(200);
    expect(sent).toHaveLength(1);
    await app.close();
  });

  it("applies the day's total before the trap and the fill time, so a program learns nothing new there", async () => {
    const { app, post } = await setup({ limits: { perHour: 100, perDay: 100, perDayAll: 2 } });
    expect((await post(GOOD, { address: "198.51.100.31" })).statusCode).toBe(200);
    expect((await post(GOOD, { address: "198.51.100.32" })).statusCode).toBe(200);
    const trapped = await post({ ...GOOD, website: "x" }, { address: "198.51.100.33" });
    expect(trapped.statusCode).toBe(429);
    expect((trapped.json() as { error: { code: string } }).error.code).toBe("contact_limit");
    await app.close();
  });

  it("pauses before answering a dropped message, as a real send takes time", async () => {
    let asked = 0;
    const { app, post } = await setup({
      dropPause: () => {
        asked += 1;
        return 120;
      },
    });
    const started = Date.now();
    expect((await post({ ...GOOD, website: "x" })).statusCode).toBe(200);
    expect(asked).toBe(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    await app.close();
  });
});

describe("input limits", () => {
  it("refuses a body over 16 KiB with 413 request_too_large", async () => {
    const { app, sent, post } = await setup();
    const answer = await post({ ...GOOD, message: "x".repeat(17_000) });
    expect(answer.statusCode).toBe(413);
    expect(sent).toEqual([]);
    await app.close();
  });

  it.each([
    ["a C1 control character", "Asha\u0085Kalpit"],
    ["an Arabic letter mark", "Asha\u061cKalpit"],
    ["a left-to-right mark", "Asha\u200eKalpit"],
    ["a right-to-left mark", "Asha\u200fKalpit"],
    ["a byte-order mark inside the text (one at either end is trimmed away)", "Asha\ufeffKalpit"],
  ])("refuses %s in a one-line field", async (_case, name) => {
    const { app, post } = await setup();
    expect((await post({ ...GOOD, name })).statusCode).toBe(400);
    await app.close();
  });
});
