// The notification emails (src/modules/notifications/emails.ts): both languages, the reader's first; names and text
// escaped and made safe; links to the web app on the public origin only. All names are fictional.
import { describe, expect, it } from "vitest";
import { invitationAcceptedEmail, sentBackEmail } from "../../src/modules/notifications/emails.ts";

const ORIGIN = "https://app.example.test";
const ORG = "01900000-0000-7000-8000-000000000001";
const PUB = "01900000-0000-7000-8000-000000000002";

describe("sentBackEmail", () => {
  const input = {
    name: "Reporter (fictional)",
    by: "Sub-editor <b>(fictional)</b>",
    headline: "Rain‮ in Kalpaniknagar",
    comment: "Add the date.",
    origin: ORIGIN,
    orgId: ORG,
    publicationId: PUB,
  };

  it("is in the reader's language first, then the other", () => {
    const mr = sentBackEmail({ ...input, language: "mr" });
    const en = sentBackEmail({ ...input, language: "en" });
    expect(mr.text.indexOf("परत पाठवली")).toBeLessThan(mr.text.indexOf("sent your story"));
    expect(en.text.indexOf("sent your story")).toBeLessThan(en.text.indexOf("परत पाठवली"));
    expect(mr.kind).toBe("story-sent-back");
  });

  it("escapes names in the HTML, drops reordering controls, and links to the publication's stories", () => {
    const mail = sentBackEmail({ ...input, language: "en" });
    expect(mail.html).toContain("Sub-editor &lt;b&gt;(fictional)&lt;/b&gt;");
    expect(mail.text).not.toContain("‮");
    expect(mail.text).toContain(`${ORIGIN}/org/${ORG}/pub/${PUB}/stories`);
    expect(() => sentBackEmail({ ...input, language: "en", orgId: "../evil" })).toThrow("plain path");
  });
});

describe("invitationAcceptedEmail", () => {
  it("names who joined and links to the team, in both languages", () => {
    const mail = invitationAcceptedEmail({
      language: "en",
      name: "Owner (fictional)",
      joined: "Viewer (fictional)",
      organization: "Kalpaniknagar Media (fictional)",
      origin: ORIGIN,
      orgId: ORG,
    });
    expect(mail.subject).toContain("Invitation accepted");
    expect(mail.text).toContain(
      "Viewer (fictional) accepted your invitation and joined Kalpaniknagar Media (fictional).",
    );
    expect(mail.text).toContain("आमंत्रण स्वीकारले");
    expect(mail.text).toContain(`${ORIGIN}/org/${ORG}/team`);
  });
});
