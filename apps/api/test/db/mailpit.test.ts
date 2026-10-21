// One real email through SMTP to the development Mailpit (docs/product/10-l2-newsroom-plan.md §7.1), read back through
// its API: the mailer's SMTP settings work end to end. It needs `pnpm dev:up` (the mail service), like the database.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verificationEmail } from "../../src/modules/identity/emails.ts";
import { openMailer, smtpTransport } from "../../src/modules/notifications/mailer.ts";

const MAILPIT_API = "http://127.0.0.1:58025/api/v1";
const ORIGIN = "https://app.example.test";

describe("email through Mailpit", () => {
  it("arrives, from our sender, with the link, in Marathi and English", async () => {
    const settings = {
      host: "127.0.0.1",
      port: 51025,
      tls: "none" as const,
      from: "Pageinator <no-reply@example.test>",
    };
    const failures: string[] = [];
    const mailer = openMailer(settings, smtpTransport(settings), (kind, error) =>
      failures.push(`${kind}: ${error.message}`),
    );
    const to = `reporter.${randomBytes(4).toString("hex")}@example.test`;
    const url = `${ORIGIN}/api/auth/verify-email?token=fictional-token&callbackURL=%2F`;
    mailer.send({ ...verificationEmail({ name: "Reporter A (fictional)", url, origin: ORIGIN }), to });
    await mailer.close();
    expect(failures, "is Mailpit up? (pnpm dev:up)").toEqual([]);
    const found = (await (await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()) as {
      messages: { ID: string; From: { Address: string }; Subject: string }[];
    };
    expect(found.messages).toHaveLength(1);
    const [message] = found.messages;
    expect(message?.From.Address).toBe("no-reply@example.test");
    expect(message?.Subject).toBe("Pageinator: तुमचा ईमेल पत्ता निश्चित करा · Confirm your email address");
    const full = (await (await fetch(`${MAILPIT_API}/message/${message?.ID}`)).json()) as {
      Text: string;
      HTML: string;
    };
    expect(full.Text).toContain(url);
    expect(full.HTML).toContain('<div lang="mr">');
    await fetch(`${MAILPIT_API}/messages`, { method: "DELETE", body: JSON.stringify({ IDs: [message?.ID] }) });
  });
});
