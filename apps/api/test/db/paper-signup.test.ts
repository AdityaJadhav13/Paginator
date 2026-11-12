// A new paper signs up (src/modules/signup; migration 2026_12_07_0002) on a migrated clone, through the API's own routes
// and the operator's review (src/modules/signup/review.ts, as scripts/review-paper.ts runs it). Every paper, person and
// address is fictional.
import { createHash } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Transport, openMailer } from "../../src/modules/notifications/mailer.ts";
import { bootstrapOrg } from "../../src/modules/people/bootstrap.ts";
import { ReviewError, reviewer } from "../../src/modules/signup/review.ts";
import { freshDatabase } from "./helpers.ts";
import { FROM_APP, type IdentityApp, ORIGIN, identityApp, lastLink } from "./identity-app.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
let review: ReturnType<typeof reviewer>;
beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  const transport: Transport = { sendMail: async (message) => void it_.sent.push(message), close: () => undefined };
  const mailer = openMailer(it_.config.mail, transport, () => undefined);
  review = reviewer({ auth: it_.server, database: it_.database, mailer, origin: ORIGIN });
});
afterAll(async () => {
  await it_.close();
  await db.drop();
});

let counter = 0;
const someone = () => `owner.${++counter}.${Date.now()}@example.test`;
let addresses = 0;
const address = () => `198.19.${Math.floor(++addresses / 250)}.${(addresses % 250) + 1}`;
const PASSWORD = "काल्पनिकनगर correct horse";

const form = (email: string, extra: Record<string, unknown> = {}) => ({
  paperName: "Kalpitpur Samachar (fictional)",
  ownerName: "Asha Kalpit (fictional)",
  email,
  language: "mr",
  website: "",
  filledInMs: 20_000,
  ...extra,
});

function apply(body: unknown, remoteAddress = address()) {
  return it_.app.inject({
    method: "POST",
    url: "/api/v1/signup/paper",
    headers: FROM_APP,
    payload: body as object,
    remoteAddress,
  });
}
function confirm(token: string) {
  return it_.app.inject({
    method: "POST",
    url: "/api/v1/signup/paper/confirm",
    headers: FROM_APP,
    payload: { token },
    remoteAddress: address(),
  });
}
const mailsTo = (email: string) => it_.sent.filter((m) => m.to === email);
const tokenOf = (email: string) => new URL(lastLink(it_.sent, email), ORIGIN).searchParams.get("confirm") ?? "";
const rowOf = async (email: string) =>
  (await su.query("select * from identity.paper_application where email = $1 order by created_at", [email])).rows;

/** Applied and confirmed: the application's id. */
async function waiting(email: string, extra: Record<string, unknown> = {}): Promise<string> {
  expect((await apply(form(email, extra))).statusCode).toBe(200);
  await expect.poll(() => mailsTo(email).length).toBe(1);
  expect((await confirm(tokenOf(email))).json()).toEqual({ state: "waiting" });
  return (await rowOf(email))[0].id;
}

describe("POST /api/v1/signup/paper", () => {
  it("keeps the application and emails a link that confirms it; only the token's hash is kept", async () => {
    const email = someone();
    const res = await apply(form(email));
    expect([res.statusCode, res.json()]).toEqual([200, { received: true }]);
    await expect.poll(() => mailsTo(email).length).toBe(1);
    expect(mailsTo(email)[0]?.subject).toContain("Confirm your email address");
    expect(lastLink(it_.sent, email)).toMatch(/^\/signup\?confirm=[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(email);
    const [row] = await rowOf(email);
    expect(row).toMatchObject({ state: "unconfirmed", paper_name: "Kalpitpur Samachar (fictional)", language: "mr" });
    expect(row.token_hash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("answers the same for an address with an application open, and sends nothing more", async () => {
    const email = someone();
    const first = await apply(form(email));
    await expect.poll(() => mailsTo(email).length).toBe(1);
    const again = await apply(form(email.toUpperCase(), { paperName: "Another (fictional)" }));
    expect([again.statusCode, again.json()]).toEqual([first.statusCode, first.json()]);
    await waitALittle();
    expect(mailsTo(email)).toHaveLength(1);
    expect(await rowOf(email)).toHaveLength(1);
    // still the same once it waits for approval
    await confirm(tokenOf(email));
    expect((await apply(form(email))).json()).toEqual({ received: true });
    await waitALittle();
    expect(mailsTo(email)).toHaveLength(1);
  });

  it("drops the trap field and a form filled in too fast, with the same answer, keeping nothing", async () => {
    for (const extra of [{ website: "https://spam.example.test" }, { filledInMs: 500 }]) {
      const email = someone();
      const res = await apply(form(email, extra));
      expect([res.statusCode, res.json()]).toEqual([200, { received: true }]);
      await waitALittle();
      expect(mailsTo(email)).toHaveLength(0);
      expect(await rowOf(email)).toHaveLength(0);
    }
  });

  it("refuses an address that is not one plain email, and a missing field", async () => {
    for (const bad of [
      form("a@b.example, c@d.example.test"),
      form("Name <x@example.test>"),
      form(someone(), { paperName: " " }),
    ]) {
      const res = await apply(bad);
      expect([res.statusCode, res.json().error.code]).toEqual([400, "invalid_request"]);
    }
  });

  it("limits each address to three an hour, then 429 signup_limit", async () => {
    const from = "198.51.100.77";
    for (let n = 0; n < 3; n++) expect((await apply(form(someone()), from)).statusCode).toBe(200);
    const res = await apply(form(someone()), from);
    expect([res.statusCode, res.json().error.code]).toEqual([429, "signup_limit"]);
    expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("needs the app's own pages (Origin and X-Pageinator)", async () => {
    const res = await it_.app.inject({
      method: "POST",
      url: "/api/v1/signup/paper",
      headers: { "content-type": "application/json" },
      payload: form(someone()),
      remoteAddress: address(),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /api/v1/signup/paper/confirm", () => {
  it("works once; an unknown token is 404", async () => {
    const email = someone();
    await apply(form(email));
    await expect.poll(() => mailsTo(email).length).toBe(1);
    const token = tokenOf(email);
    expect((await confirm(token)).statusCode).toBe(200);
    expect((await rowOf(email))[0]).toMatchObject({ state: "waiting", token_hash: null });
    expect([(await confirm(token)).statusCode, (await confirm("A".repeat(43))).statusCode]).toEqual([404, 404]);
    expect((await confirm("short")).statusCode).toBe(400);
  });

  it("refuses an expired link; applying again sends a new one", async () => {
    const email = someone();
    await apply(form(email));
    await expect.poll(() => mailsTo(email).length).toBe(1);
    const old = tokenOf(email);
    await su.query(
      "update identity.paper_application set token_expires_at = now() - interval '1 second' where email = $1",
      [email],
    );
    expect((await confirm(old)).statusCode).toBe(404);
    await apply(form(email));
    await expect.poll(() => mailsTo(email).length).toBe(2);
    const fresh = tokenOf(email);
    expect(fresh).not.toBe(old);
    expect((await confirm(old)).statusCode).toBe(404);
    expect((await confirm(fresh)).statusCode).toBe(200);
    expect(await rowOf(email)).toHaveLength(1);
  });
});

describe("the operator's review (scripts/review-paper.ts)", () => {
  it("lists the waiting applications only", async () => {
    const email = someone();
    const id = await waiting(email);
    const unconfirmed = someone();
    await apply(form(unconfirmed));
    const listed = (await review.list()).map((a) => a.email);
    expect(listed).toContain(email);
    expect(listed).not.toContain(unconfirmed);
    expect((await review.list(true)).map((a) => a.email)).toContain(unconfirmed);
    expect((await review.list()).find((a) => a.id === id)?.state).toBe("waiting");
  });

  it("approves through bootstrapOrg: the organisation, its Owner and publication, audited; who and when kept", async () => {
    const email = someone();
    const id = await waiting(email, { paperName: "Kalpitpur Times (fictional)", language: "en" });
    const made = await review.approve(id, "Operator (fictional)");
    expect(made.application).toMatchObject({ state: "approved", decidedBy: "Operator (fictional)", orgId: made.orgId });
    expect(made.application.decidedAt).toBeInstanceOf(Date);
    const org = await su.query("select name, slug from identity.organization where id = $1", [made.orgId]);
    expect(org.rows).toEqual([{ name: "Kalpitpur Times (fictional)", slug: "kalpitpur-times-fictional" }]);
    const pub = await su.query(
      "select name, languages, primary_language, digit_style from app.publication where id = $1",
      [made.publicationId],
    );
    expect(pub.rows).toEqual([
      { name: "Kalpitpur Times (fictional)", languages: ["en"], primary_language: "en", digit_style: "latin" },
    ]);
    const audit = await su.query("select action, actor_kind from app.audit_event where org_id = $1", [made.orgId]);
    expect(audit.rows).toEqual([{ action: "org.bootstrap", actor_kind: "system" }]);
    // bootstrap's one welcome (choosing the password confirms the address), and ours with the sign-in link that
    // leads to /onboarding
    await expect.poll(() => mailsTo(email).length).toBe(3);
    const subjects = mailsTo(email).map((m) => m.subject);
    expect(subjects.slice(1)).toEqual([
      expect.stringContaining("Welcome, choose your password"),
      expect.stringContaining("Your paper is ready"),
    ]);
    expect(lastLink(it_.sent, email)).toBe("/login?returnTo=%2Fonboarding");
    // a second decision is refused, and the slug is taken
    await expect(review.approve(id, "Operator (fictional)")).rejects.toThrow("approved, not waiting");

    // the Owner chooses a password, confirms the address, signs in, and reads the paper's details for /onboarding
    const resetMail = mailsTo(email).find((m) => m.subject.includes("Welcome"));
    const resetLink = new URL(resetMail?.text.match(/https:\S+/)?.[0] ?? "", ORIGIN);
    const opened = await it_.app.inject({ url: resetLink.pathname + resetLink.search, remoteAddress: address() });
    const token = new URL(String(opened.headers.location), ORIGIN).searchParams.get("token") ?? "";
    const reset = await it_.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      headers: FROM_APP,
      payload: { newPassword: PASSWORD, token },
      remoteAddress: address(),
    });
    expect(reset.statusCode).toBe(200);
    await su.query("update app.org_settings set mfa_required_roles = '{}' where org_id = $1", [made.orgId]);
    const signedIn = await it_.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: FROM_APP,
      payload: { email, password: PASSWORD },
      remoteAddress: address(),
    });
    expect(signedIn.statusCode).toBe(200);
    const cookie = signedIn.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const headers = { origin: FROM_APP.origin, "x-pageinator": FROM_APP["x-pageinator"] };
    const paper = await it_.app.inject({
      url: `/api/v1/orgs/${made.orgId}/pubs/${made.publicationId}/paper`,
      headers: { ...headers, cookie },
      remoteAddress: address(),
    });
    expect([paper.statusCode, paper.json()]).toEqual([
      200,
      { name: "Kalpitpur Times (fictional)", languages: ["en"], primaryLanguage: "en" },
    ]);
    // nobody signed out reads it
    const anonymous = await it_.app.inject({
      url: `/api/v1/orgs/${made.orgId}/pubs/${made.publicationId}/paper`,
      headers,
      remoteAddress: address(),
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("needs a slug for a name in Devanagari", async () => {
    const id = await waiting(someone(), { paperName: "काल्पनिक वार्ता" });
    await expect(review.approve(id, "Operator (fictional)")).rejects.toThrow("--slug");
    const made = await review.approve(id, "Operator (fictional)", `kalpanik-varta-${Date.now()}`);
    const pub = await su.query("select languages, digit_style from app.publication where id = $1", [
      made.publicationId,
    ]);
    expect(pub.rows).toEqual([{ languages: ["mr"], digit_style: "devanagari" }]);
  });

  it("an approval cut short after the bootstrap is finished by the next one, with the same organisation", async () => {
    const email = someone();
    const id = await waiting(email);
    const slug = `cut-short-${Date.now()}`;
    const made = await bootstrapOrg(
      it_.server,
      it_.mailer,
      it_.database,
      {
        owner: { name: "Asha Kalpit (fictional)", email },
        organization: { name: "Kalpitpur Samachar (fictional)", slug },
        publication: {
          name: "Kalpitpur Samachar (fictional)",
          slug,
          languages: ["mr"],
          primaryLanguage: "mr",
          digitStyle: "devanagari",
        },
      },
      `review-paper:${id}`,
    );
    const again = await review.approve(id, "Operator (fictional)", slug);
    expect(again.application).toMatchObject({ state: "approved", orgId: made.orgId });
  });

  it("refuses an application that is not waiting, and an id that is not one", async () => {
    const email = someone();
    await apply(form(email));
    await expect.poll(() => mailsTo(email).length).toBe(1);
    const [row] = await rowOf(email);
    await expect(review.approve(row.id, "Operator (fictional)")).rejects.toThrow(ReviewError);
    await expect(review.refuse("not-an-id", "Operator (fictional)", null)).rejects.toThrow("not an application id");
  });

  it("refuses with a plain email and keeps who, when and why", async () => {
    const email = someone();
    const id = await waiting(email);
    const refused = await review.refuse(id, "Operator (fictional)", "We take daily papers only for now.");
    expect(refused).toMatchObject({
      state: "refused",
      decidedBy: "Operator (fictional)",
      reason: "We take daily papers only for now.",
    });
    expect(refused.decidedAt).toBeInstanceOf(Date);
    await expect.poll(() => mailsTo(email).length).toBe(2);
    const mail = mailsTo(email).at(-1);
    expect(mail?.subject).toContain("Your request");
    expect(mail?.text).toContain("We take daily papers only for now.");
    await expect(review.refuse(id, "Operator (fictional)", null)).rejects.toThrow("refused, not waiting");
  });
});

describe("tenancy", () => {
  it("no organisation's connection may read or write applications", async () => {
    const app = await db.connect("app");
    await expect(app.query("select count(*) from identity.paper_application")).rejects.toThrow(/permission denied/);
    const engine = await db.connect("engine");
    await expect(engine.query("select count(*) from identity.paper_application")).rejects.toThrow(/permission denied/);
  });
});

const waitALittle = () => new Promise((resolve) => setTimeout(resolve, 50));
