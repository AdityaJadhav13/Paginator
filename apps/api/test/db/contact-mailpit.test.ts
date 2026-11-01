// The website's contact form end to end: a message posted to the API arrives in Mailpit through SMTP, as one plain-text
// email to PGN_CONTACT_TO, with Reply-To the sender's address and nothing the sender typed in any other header. It
// needs a Mailpit: the development one (`pnpm dev:up`), or another named by PGN_TEST_SMTP_PORT and
// PGN_TEST_MAILPIT_API.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";

const SMTP_PORT = process.env["PGN_TEST_SMTP_PORT"] ?? "51025";
const MAILPIT_API = process.env["PGN_TEST_MAILPIT_API"] ?? "http://127.0.0.1:58025/api/v1";
const ORIGIN = "https://app.example.test";

type Address = { Name: string; Address: string };
type Summary = { ID: string; From: Address; To: Address[]; ReplyTo: Address[]; Subject: string };

describe("the contact form through Mailpit", () => {
  it("arrives as one plain-text email to the team, with Reply-To the sender", async () => {
    const team = `team.${randomBytes(4).toString("hex")}@example.test`;
    const config = loadConfig({
      PGN_LOG_LEVEL: "silent",
      PGN_ALLOWED_ORIGINS: ORIGIN,
      PGN_APP_PASSWORD: "test-app",
      PGN_AUTH_PASSWORD: "test-auth",
      PGN_LISTEN_PASSWORD: "test-listen",
      PGN_AUTH_SECRET: "test-only-sign-in-secret-0123456789abcdef",
      PGN_SMTP_PORT: SMTP_PORT,
      PGN_CONTACT_TO: team,
    });
    const app = await buildApp({ config, checks: {} });
    const message = "आम्हाला डेमो पाहायचा आहे.\r\nBcc: victim@evil.example.test\nSubject: injected";
    const answer = await app.inject({
      method: "POST",
      url: "/api/v1/contact",
      headers: { origin: ORIGIN, "x-pageinator": "1", "content-type": "application/json" },
      payload: JSON.stringify({
        name: "आशा कल्पित (fictional)",
        newspaper: "कल्पितपूर समाचार (fictional)",
        city: "कल्पितपूर",
        phone: "+91 98765 43210",
        email: "asha.kalpit@example.test",
        message,
        intent: "pilot",
        language: "mr",
        website: "",
        filledInMs: 30_000,
      }),
    });
    await app.close();
    expect(answer.statusCode, answer.body).toBe(200);

    const found = (await (await fetch(`${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${team}"`)}`)).json()) as {
      messages: Summary[];
    };
    expect(found.messages, "is Mailpit up?").toHaveLength(1);
    const [mail] = found.messages;
    try {
      expect(mail?.From.Address).toBe("no-reply@example.test");
      expect(mail?.To.map((to) => to.Address)).toEqual([team]);
      expect(mail?.ReplyTo.map((to) => to.Address)).toEqual(["asha.kalpit@example.test"]);
      expect(mail?.Subject).toBe("Pageinator website: A pilot");
      const full = (await (await fetch(`${MAILPIT_API}/message/${mail?.ID}`)).json()) as {
        Text: string;
        HTML: string;
        Bcc: Address[];
        Cc: Address[];
      };
      expect(full.HTML).toBe("");
      expect(full.Bcc ?? []).toEqual([]);
      expect(full.Cc ?? []).toEqual([]);
      expect(full.Text).toContain("आशा कल्पित (fictional)");
      expect(full.Text).toContain("Wants: A pilot");
      expect(full.Text).toContain("Bcc: victim@evil.example.test"); // in the text, where it does nothing
      const headers = (await (await fetch(`${MAILPIT_API}/message/${mail?.ID}/headers`)).json()) as Record<
        string,
        string[]
      >;
      expect(headers["Bcc"]).toBeUndefined();
      expect(headers["Subject"]).toEqual(["Pageinator website: A pilot"]);
      expect(headers["Content-Type"]?.[0]).toMatch(/^text\/plain/);
    } finally {
      await fetch(`${MAILPIT_API}/messages`, { method: "DELETE", body: JSON.stringify({ IDs: [mail?.ID] }) });
    }
  });
});
