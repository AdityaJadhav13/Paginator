// Organisations, permissions, invitations and two-step sign-in (src/modules/access, src/modules/people;
// docs/product/10-l2-newsroom-plan.md §4.2–4.4, §4.8, §5.2) on a migrated clone, through the API's own routes. Every
// person and organisation is fictional.
import { createHmac } from "node:crypto";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ORGANIZATION_PATHS } from "../../src/modules/identity/auth.ts";
import { bootstrapOrg } from "../../src/modules/people/bootstrap.ts";
import { freshDatabase } from "./helpers.ts";
import { FROM_APP, type IdentityApp, ORIGIN, identityApp, lastLink } from "./identity-app.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
});
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const PASSWORD = "काल्पनिकनगर correct horse";
let counter = 0;
const someone = (who = "person") => `${who}.${++counter}.${Date.now()}@example.test`;
let addresses = 0;
/** A new client address for each sign-in, so the per-address limits never get in the way. */
const address = () => `198.18.${Math.floor(++addresses / 250)}.${(addresses % 250) + 1}`;

const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

async function account(email: string, name = "Fictional Person"): Promise<string> {
  const made = await it_.server.api.signUpEmail({ body: { name, email, password: PASSWORD } });
  const res = await it_.app.inject({ url: lastLink(it_.sent, email), remoteAddress: address() });
  expect(res.statusCode).toBeLessThan(400);
  return made.user.id;
}

async function signIn(email: string, password = PASSWORD, extra: Record<string, unknown> = {}, cookie = "") {
  return it_.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: { ...FROM_APP, ...(cookie ? { cookie } : {}) },
    payload: { email, password, ...extra },
    remoteAddress: address(),
  });
}

async function session(email: string): Promise<string> {
  const res = await signIn(email);
  expect(res.statusCode, `signing in ${email}`).toBe(200);
  return cookieOf(res);
}

function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, cookie: string, payload?: unknown) {
  const { "content-type": json, ...headers } = FROM_APP;
  const body = payload !== undefined || method === "POST" || method === "PATCH";
  return it_.app.inject({
    method,
    url,
    headers: { ...headers, ...(body ? { "content-type": json } : {}), ...(cookie ? { cookie } : {}) },
    ...(payload !== undefined
      ? { payload: payload as Record<string, unknown> }
      : method === "POST"
        ? { payload: {} }
        : {}),
    remoteAddress: address(),
  });
}

type Org = { orgId: string; pubId: string; owner: string; ownerCookie: string };

/** An organisation with one publication and its Owner signed in; its two-step rule off unless asked. */
async function organisation(twoStep = false): Promise<Org> {
  const owner = someone("owner");
  await account(owner, "Owner (fictional)");
  const n = ++counter;
  const made = await bootstrapOrg(it_.server, it_.database, {
    owner: { name: "Owner (fictional)", email: owner },
    organization: { name: `Kalpaniknagar Media ${n} (fictional)`, slug: `kalpaniknagar-${n}-${Date.now()}` },
    publication: {
      name: "काल्पनिकनगर वार्ता",
      slug: "kalpaniknagar-varta",
      languages: ["mr"],
      primaryLanguage: "mr",
      digitStyle: "devanagari",
    },
  });
  if (!twoStep) await su.query("update app.org_settings set mfa_required_roles = '{}' where org_id = $1", [made.orgId]);
  return { orgId: made.orgId, pubId: made.publicationId, owner, ownerCookie: await session(owner) };
}

async function addPublication(org: Org, name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into app.publication (org_id, name, slug, languages, primary_language, digit_style)
     values ($1, $2, $3, '{en}', 'en', 'latin') returning id`,
    [org.orgId, name, `pub-${++counter}`],
  );
  return rows[0]?.id ?? "";
}

async function invite(org: Org, email: string, publications: unknown[], orgRole = "member") {
  return call("POST", `/api/v1/orgs/${org.orgId}/invitations`, org.ownerCookie, { email, orgRole, publications });
}

function signUp(email: string, invitation?: string) {
  return it_.app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { ...FROM_APP, ...(invitation ? { "x-pageinator-invitation": invitation } : {}) },
    payload: { name: "Invitee (fictional)", email, password: PASSWORD },
    remoteAddress: address(),
  });
}

async function userId(email: string): Promise<string | null> {
  const { rows } = await su.query<{ id: string }>('select id from identity."user" where email = $1', [email]);
  return rows[0]?.id ?? null;
}

/** Invited, signed up over HTTP, verified (which signs in): the invitee's cookie. */
async function invitee(org: Org, publications: unknown[], orgRole = "member") {
  const email = someone("invitee");
  const created = await invite(org, email, publications, orgRole);
  expect(created.statusCode).toBe(201);
  const id: string = created.json().id;
  expect((await signUp(email, id)).statusCode).toBe(200);
  const verified = await it_.app.inject({ url: lastLink(it_.sent, email), remoteAddress: address() });
  expect(verified.statusCode).toBe(302);
  return { email, id, cookie: cookieOf(verified) };
}

async function member(org: Org, publications: unknown[], orgRole = "member") {
  const person = await invitee(org, publications, orgRole);
  const accepted = await call("POST", `/api/v1/invitations/${person.id}/accept`, person.cookie);
  expect(accepted.statusCode).toBe(200);
  return person;
}

async function memberships(userIdValue: string, orgId: string) {
  const { rows } = await su.query('select role from identity.member where "userId" = $1 and "organizationId" = $2', [
    userIdValue,
    orgId,
  ]);
  return rows;
}

// RFC 6238 (SHA-1, 30 s, 6 digits), on the base32 secret of the otpauth URI: the tests' own code, not Better Auth's.
function base32(text: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of text.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret: string, at = Date.now()): string {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", base32(secret)).update(counterBytes).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const value = (mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
}

/** Turns two-step on for a signed-in person; returns the TOTP secret, the backup codes and the new cookie. */
async function enableTwoStep(cookie: string) {
  const enabled = await call("POST", "/api/auth/two-factor/enable", cookie, { password: PASSWORD });
  expect(enabled.statusCode).toBe(200);
  const { totpURI, backupCodes } = enabled.json() as { totpURI: string; backupCodes: string[] };
  const secret = new URL(totpURI).searchParams.get("secret") ?? "";
  const verified = await call("POST", "/api/auth/two-factor/verify-totp", cookie, { code: totp(secret) });
  expect(verified.statusCode).toBe(200);
  return { secret, backupCodes, cookie: cookieOf(verified) || cookie };
}

describe("the first Owner (scripts/bootstrap-org.ts)", () => {
  it("makes the account, the organisation, its settings, the publication and the Owner, audited", async () => {
    const email = someone("owner");
    const made = await bootstrapOrg(it_.server, it_.database, {
      owner: { name: "Owner (fictional)", email },
      organization: { name: "Bootstrapped Media (fictional)", slug: `bootstrapped-${Date.now()}` },
      publication: {
        name: "Example Daily",
        slug: "example-daily",
        languages: ["en"],
        primaryLanguage: "en",
        digitStyle: "latin",
      },
    });
    expect(await memberships(made.ownerId, made.orgId)).toEqual([{ role: "owner" }]);
    const mails = it_.sent.filter((m) => m.to === email).map((m) => m.subject);
    expect(mails).toEqual([
      expect.stringContaining("Confirm your email address"),
      expect.stringContaining("Reset your password"),
    ]);
    // the Owner chooses a password through the reset link, confirms the address, and signs in
    const opened = await it_.app.inject({ url: lastLink(it_.sent, email), remoteAddress: address() });
    const token = new URL(String(opened.headers.location), ORIGIN).searchParams.get("token") ?? "";
    expect(new URL(String(opened.headers.location), ORIGIN).pathname).toBe("/reset-password");
    const reset = await call("POST", "/api/auth/reset-password", "", { newPassword: PASSWORD, token });
    expect(reset.statusCode).toBe(200);
    expect((await signIn(email)).statusCode).toBe(403); // not confirmed yet
    const verifyLink = it_.sent
      .find((m) => m.to === email && m.subject.includes("Confirm"))
      ?.text.match(/https:\S+/)?.[0];
    await it_.app.inject({
      url: new URL(verifyLink ?? "", ORIGIN).pathname + new URL(verifyLink ?? "", ORIGIN).search,
    });
    const cookie = await session(email);
    const me = await call("GET", "/api/v1/me", cookie);
    expect(me.json().memberships).toEqual([
      {
        org: { id: made.orgId, name: "Bootstrapped Media (fictional)" },
        orgRole: "owner",
        twoStep: { required: true, satisfied: false },
        publications: [{ id: made.publicationId, name: "Example Daily", roles: [], grants: [] }],
      },
    ]);
    const audit = await su.query("select action, actor_kind from app.audit_event where org_id = $1", [made.orgId]);
    expect(audit.rows).toEqual([{ action: "org.bootstrap", actor_kind: "system" }]);
  });

  it("refuses an organisation slug that exists", async () => {
    const org = await organisation();
    const { rows } = await su.query<{ slug: string }>("select slug from identity.organization where id = $1", [
      org.orgId,
    ]);
    await expect(
      bootstrapOrg(it_.server, it_.database, {
        owner: { name: "Owner (fictional)", email: org.owner },
        organization: { name: "Again (fictional)", slug: rows[0]?.slug ?? "" },
        publication: { name: "X", slug: "x", languages: ["en"], primaryLanguage: "en", digitStyle: "latin" },
      }),
    ).rejects.toThrow("exists already");
  });
});

describe("/me", () => {
  it("shows the person, their organisations, and their roles and grants on each publication", async () => {
    const org = await organisation();
    const second = await addPublication(org, "Kalpaniknagar Express");
    const person = await member(org, [
      { publicationId: org.pubId, roles: ["reporter"], grants: [] },
      { publicationId: second, roles: ["editor", "sub_editor"], grants: ["page_approve"] },
    ]);
    const me = await call("GET", "/api/v1/me", person.cookie);
    expect(me.statusCode).toBe(200);
    const body = me.json();
    expect(body.user).toMatchObject({
      email: person.email,
      emailVerified: true,
      twoFactorEnabled: false,
      locale: "en",
      uiDigits: "latin",
    });
    expect(body.memberships).toHaveLength(1);
    expect(body.memberships[0].orgRole).toBe("member");
    expect(body.memberships[0].publications).toEqual(
      expect.arrayContaining([
        { id: org.pubId, name: "काल्पनिकनगर वार्ता", roles: ["reporter"], grants: [] },
        { id: second, name: "Kalpaniknagar Express", roles: ["editor", "sub_editor"], grants: ["page_approve"] },
      ]),
    );
    expect(body.memberships[0].publications).toHaveLength(2);
  });

  it("changes the name, language and digits; refuses anything else; the directory follows the name", async () => {
    const org = await organisation();
    const changed = await call("PATCH", "/api/v1/me", org.ownerCookie, {
      name: "Renamed Owner (fictional)",
      locale: "mr",
      uiDigits: "devanagari",
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().user).toMatchObject({
      name: "Renamed Owner (fictional)",
      locale: "mr",
      uiDigits: "devanagari",
    });
    expect((await call("GET", "/api/v1/me", org.ownerCookie)).json().user.locale).toBe("mr");
    const { rows } = await su.query("select display_name from app.person where org_id = $1", [org.orgId]);
    expect(rows).toEqual([{ display_name: "Renamed Owner (fictional)" }]);
    expect((await call("PATCH", "/api/v1/me", org.ownerCookie, { locale: "fr" })).statusCode).toBe(400);
    expect((await call("PATCH", "/api/v1/me", org.ownerCookie, { email: "x@example.test" })).statusCode).toBe(400);
    expect((await call("PATCH", "/api/v1/me", org.ownerCookie, {})).statusCode).toBe(400);
  });

  it("answers 401 signed_out without a session", async () => {
    const res = await call("GET", "/api/v1/me", "");
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("signed_out");
  });
});

describe("authorize()", () => {
  it("answers 404 to a non-member, and for a malformed or unknown organisation", async () => {
    const org = await organisation();
    const other = await organisation();
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, other.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", "/api/v1/orgs/not-a-uuid/members", org.ownerCookie)).statusCode).toBe(404);
    expect((await call("GET", `/api/v1/orgs/${other.pubId}/members`, org.ownerCookie)).statusCode).toBe(404);
  });

  it("answers 403 not_allowed to a role without the permission, and records the refusal", async () => {
    const org = await organisation();
    const reporter = await member(org, [{ publicationId: org.pubId, roles: ["reporter"], grants: [] }]);
    const refused = await call("GET", `/api/v1/orgs/${org.orgId}/members`, reporter.cookie);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("not_allowed");
    const invited = await call("POST", `/api/v1/orgs/${org.orgId}/invitations`, reporter.cookie, {
      email: someone(),
      orgRole: "member",
      publications: [],
    });
    expect(invited.statusCode).toBe(403);
    const { rows } = await su.query(
      "select action, data->>'permission' as permission from app.audit_event where org_id = $1 and action = 'access.denied' order by at",
      [org.orgId],
    );
    expect(rows).toEqual([
      { action: "access.denied", permission: "members.view" },
      { action: "access.denied", permission: "members.manage" },
    ]);
  });

  it("lets a Chief Editor see the team but not manage it", async () => {
    const org = await organisation();
    const chief = await member(org, [{ publicationId: org.pubId, roles: ["chief_editor"], grants: [] }]);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, chief.cookie)).statusCode).toBe(200);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/invitations`, chief.cookie)).statusCode).toBe(403);
  });

  it("refuses to register an /api/v1 route that declares no access, or two", async () => {
    const other = await identityApp(db);
    try {
      expect(() => other.app.get("/api/v1/test/undeclared", async () => ({}))).toThrow("must declare one access");
      expect(() =>
        other.app.get(
          "/api/v1/test/both",
          { config: { access: "public", permission: "members.view" } },
          async () => ({}),
        ),
      ).toThrow("must declare one access");
    } finally {
      await other.close();
    }
  });
});

describe("invitations", () => {
  it("are created by an Owner or Admin, with grants kept in our table, and emailed with every role named", async () => {
    const org = await organisation();
    const email = someone("invitee");
    const created = await invite(org, email, [
      { publicationId: org.pubId, roles: ["reporter", "photo_editor"], grants: [] },
    ]);
    expect(created.statusCode).toBe(201);
    const invitation = created.json();
    expect(invitation).toMatchObject({ email, orgRole: "member", state: "pending" });
    const mail = it_.sent.filter((m) => m.to === email).at(-1);
    expect(mail?.text).toContain(`${ORIGIN}/invite/${invitation.id}`);
    expect(mail?.text).toContain("as Member, Reporter, Photo Editor");
    const { rows } = await su.query(
      "select roles, grants, applied_at from app.invitation_grant where invitation_id = $1",
      [invitation.id],
    );
    expect(rows).toEqual([{ roles: ["reporter", "photo_editor"], grants: [], applied_at: null }]);
    const listed = await call("GET", `/api/v1/orgs/${org.orgId}/invitations`, org.ownerCookie);
    expect(listed.json().items.map((i: { id: string }) => i.id)).toContain(invitation.id);
  });

  it("refuses an Owner invitation, a publication of another organisation, and a publication named twice", async () => {
    const org = await organisation();
    const other = await organisation();
    expect((await invite(org, someone(), [], "owner")).statusCode).toBe(400);
    expect(
      (await invite(org, someone(), [{ publicationId: other.pubId, roles: ["editor"], grants: [] }])).statusCode,
    ).toBe(400);
    const twice = [
      { publicationId: org.pubId, roles: ["editor"], grants: [] },
      { publicationId: org.pubId, roles: ["reporter"], grants: [] },
    ];
    expect((await invite(org, someone(), twice)).statusCode).toBe(400);
  });

  it("shows anyone with the link only the organisation, inviter, roles, expiry and state; 20 lookups an hour", async () => {
    const org = await organisation();
    const created = (
      await invite(org, someone("invitee"), [{ publicationId: org.pubId, roles: ["editor"], grants: [] }])
    ).json();
    const from = "203.0.113.150";
    const look = (id: string) => it_.app.inject({ url: `/api/v1/invitations/${id}`, remoteAddress: from });
    const shown = await look(created.id);
    expect(shown.statusCode).toBe(200);
    expect(Object.keys(shown.json()).sort()).toEqual(["expiresAt", "inviter", "organization", "roles", "state"]);
    expect(shown.json()).toMatchObject({
      inviter: { name: "Owner (fictional)" },
      roles: ["member", "editor"],
      state: "pending",
    });
    expect(shown.body).not.toContain("@example.test");
    expect((await look("01900000-0000-7000-8000-00000000dead")).statusCode).toBe(404);
    expect((await look("not-a-uuid")).statusCode).toBe(404);
    for (let i = 4; i <= 20; i += 1) await look(created.id);
    const limited = await look(created.id);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("slow_down");
  });

  it("open sign-up only with the id of a pending invitation for exactly that email", async () => {
    const org = await organisation();
    const email = someone("invitee");
    const otherEmail = someone("invitee");
    const created = (await invite(org, email, [])).json();
    const other = (await invite(org, otherEmail, [])).json();
    const noHeader = await signUp(email);
    const wrongId = await signUp(email, other.id);
    const malformed = await signUp(email, "not-a-uuid");
    for (const res of [noHeader, wrongId, malformed]) expect([res.statusCode, res.json().token]).toEqual([200, null]);
    expect(await userId(email)).toBeNull();
    const stranger = someone("stranger");
    await signUp(stranger, created.id);
    expect(await userId(stranger)).toBeNull();
    expect((await signUp(email, created.id)).statusCode).toBe(200);
    expect(await userId(email)).not.toBeNull();
    expect(it_.sent.filter((m) => m.to === email).at(-1)?.subject).toContain("Confirm your email address");
  });

  it("cannot be accepted with an unverified session made by the server (CVE-2026-53514)", async () => {
    const org = await organisation();
    const email = someone("invitee");
    const created = (await invite(org, email, [{ publicationId: org.pubId, roles: ["editor"], grants: [] }])).json();
    const made = await it_.server.api.signUpEmail({
      body: { name: "Unverified (fictional)", email, password: PASSWORD },
    });
    const context = await it_.server.$context;
    const unverified = await context.internalAdapter.createSession(made.user.id);
    const mac = createHmac("sha256", context.secret).update(unverified.token).digest("base64");
    const cookie = `__Secure-pgn.session_token=${encodeURIComponent(`${unverified.token}.${mac}`)}`;
    expect((await call("GET", "/api/v1/me", cookie)).json().user.emailVerified).toBe(false);
    const accepted = await call("POST", `/api/v1/invitations/${created.id}/accept`, cookie);
    expect(accepted.statusCode).toBe(403);
    expect(await memberships(made.user.id, org.orgId)).toEqual([]);
  });

  it("applies the grants from our table, never from the client, and makes the person a member", async () => {
    const org = await organisation();
    const person = await invitee(org, [{ publicationId: org.pubId, roles: ["reporter"], grants: [] }]);
    const accepted = await it_.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${person.id}/accept`,
      headers: { ...FROM_APP, cookie: person.cookie },
      payload: {
        publications: [{ publicationId: org.pubId, roles: ["chief_editor"], grants: ["release_approve"] }],
        orgRole: "admin",
      },
      remoteAddress: address(),
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toEqual({ orgId: org.orgId, publications: [org.pubId] });
    const id = await userId(person.email);
    expect(await memberships(id ?? "", org.orgId)).toEqual([{ role: "member" }]);
    const { rows } = await su.query("select roles, grants from app.publication_grant where user_id = $1", [id]);
    expect(rows).toEqual([{ roles: ["reporter"], grants: [] }]);
    const directory = await su.query("select status, email from app.person where user_id = $1", [id]);
    expect(directory.rows).toEqual([{ status: "active", email: person.email }]);
    expect((await call("POST", `/api/v1/invitations/${person.id}/accept`, person.cookie)).statusCode).toBe(404);
  });

  it("cannot be accepted by another verified person, or once expired, cancelled or guessed", async () => {
    const org = await organisation();
    const person = await invitee(org, []);
    const otherPerson = someone("other");
    await account(otherPerson);
    const otherCookie = await session(otherPerson);
    expect((await call("POST", `/api/v1/invitations/${person.id}/accept`, otherCookie)).statusCode).toBe(404);
    expect(await memberships((await userId(otherPerson)) ?? "", org.orgId)).toEqual([]);

    await su.query(`update identity.invitation set "expiresAt" = now() - interval '1 minute' where id = $1`, [
      person.id,
    ]);
    expect((await call("POST", `/api/v1/invitations/${person.id}/accept`, person.cookie)).statusCode).toBe(404);
    expect((await it_.app.inject({ url: `/api/v1/invitations/${person.id}` })).json().state).toBe("expired");

    const second = await invitee(org, []);
    expect(
      (await call("DELETE", `/api/v1/orgs/${org.orgId}/invitations/${second.id}`, org.ownerCookie)).statusCode,
    ).toBe(204);
    expect((await call("POST", `/api/v1/invitations/${second.id}/accept`, second.cookie)).statusCode).toBe(404);
    expect((await it_.app.inject({ url: `/api/v1/invitations/${second.id}` })).json().state).toBe("canceled");

    expect(
      (await call("POST", "/api/v1/invitations/01900000-0000-7000-8000-00000000beef/accept", second.cookie)).statusCode,
    ).toBe(404);
    expect(await memberships((await userId(second.email)) ?? "", org.orgId)).toEqual([]);
  });

  it("accepted twice at the same moment makes one membership", async () => {
    const org = await organisation();
    const person = await invitee(org, [{ publicationId: org.pubId, roles: ["viewer"], grants: [] }]);
    const answers = await Promise.all(
      [1, 2, 3].map(() => call("POST", `/api/v1/invitations/${person.id}/accept`, person.cookie)),
    );
    expect(answers.map((a) => a.statusCode).sort()).toEqual([200, 404, 404]);
    expect(await memberships((await userId(person.email)) ?? "", org.orgId)).toEqual([{ role: "member" }]);
  });

  it("can be sent again, with its full time, and the same link", async () => {
    const org = await organisation();
    const email = someone("invitee");
    const created = (await invite(org, email, [])).json();
    await su.query(`update identity.invitation set "expiresAt" = now() + interval '1 hour' where id = $1`, [
      created.id,
    ]);
    const resent = await call("POST", `/api/v1/orgs/${org.orgId}/invitations/${created.id}/resend`, org.ownerCookie);
    expect(resent.statusCode).toBe(200);
    expect(resent.json().id).toBe(created.id);
    expect(new Date(resent.json().expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 3600_000);
    expect(it_.sent.filter((m) => m.to === email)).toHaveLength(2);
  });
});

describe("repairs on /me", () => {
  it("applies grants an accept left pending", async () => {
    const org = await organisation();
    const person = await member(org, [{ publicationId: org.pubId, roles: ["editor"], grants: ["page_approve"] }]);
    const id = await userId(person.email);
    await su.query("delete from app.publication_grant where user_id = $1", [id]);
    await su.query("update app.invitation_grant set applied_at = null where invitation_id = $1", [person.id]);
    const me = await call("GET", "/api/v1/me", person.cookie);
    expect(me.json().memberships[0].publications).toEqual([
      { id: org.pubId, name: "काल्पनिकनगर वार्ता", roles: ["editor"], grants: ["page_approve"] },
    ]);
    const { rows } = await su.query(
      "select action from app.audit_event where org_id = $1 and action like 'invitation.%' order by at",
      [org.orgId],
    );
    expect(rows.map((r) => r.action)).toEqual(["invitation.create", "invitation.accept", "invitation.grants_repaired"]);
  });

  it("makes the membership of an invitation left accepted with none", async () => {
    const org = await organisation();
    const person = await invitee(org, [{ publicationId: org.pubId, roles: ["sub_editor"], grants: [] }]);
    // what Better Auth leaves when making the membership fails and its own undo fails too
    await su.query("update identity.invitation set status = 'accepted' where id = $1", [person.id]);
    const id = (await userId(person.email)) ?? "";
    expect(await memberships(id, org.orgId)).toEqual([]);
    const me = await call("GET", "/api/v1/me", person.cookie);
    expect(me.json().memberships).toEqual([
      expect.objectContaining({
        orgRole: "member",
        publications: [{ id: org.pubId, name: "काल्पनिकनगर वार्ता", roles: ["sub_editor"], grants: [] }],
      }),
    ]);
    expect(await memberships(id, org.orgId)).toEqual([{ role: "member" }]);
    await call("GET", "/api/v1/me", person.cookie); // a second look changes nothing
    expect(await memberships(id, org.orgId)).toEqual([{ role: "member" }]);
  });

  it("never brings back a member who was removed", async () => {
    const org = await organisation();
    const person = await member(org, [{ publicationId: org.pubId, roles: ["reporter"], grants: [] }]);
    const id = (await userId(person.email)) ?? "";
    expect((await call("DELETE", `/api/v1/orgs/${org.orgId}/members/${id}`, org.ownerCookie)).statusCode).toBe(204);
    const me = await call("GET", "/api/v1/me", person.cookie);
    expect(me.json().memberships).toEqual([]);
    expect(await memberships(id, org.orgId)).toEqual([]);
  });
});

describe("the Team endpoints", () => {
  it("list members, change a role and grants, and remove a member (their directory row stays, removed)", async () => {
    const org = await organisation();
    const person = await member(org, [{ publicationId: org.pubId, roles: ["reporter"], grants: [] }]);
    const id = (await userId(person.email)) ?? "";
    const list = await call("GET", `/api/v1/orgs/${org.orgId}/members`, org.ownerCookie);
    expect(
      list
        .json()
        .items.map((m: { email: string; orgRole: string }) => [m.email, m.orgRole])
        .sort(),
    ).toEqual(
      [
        [org.owner, "owner"],
        [person.email, "member"],
      ].sort(),
    );
    const changed = await call("PATCH", `/api/v1/orgs/${org.orgId}/members/${id}`, org.ownerCookie, {
      orgRole: "admin",
      publications: [{ publicationId: org.pubId, roles: ["editor"], grants: ["release_approve"] }],
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toMatchObject({
      orgRole: "admin",
      publications: [{ publicationId: org.pubId, roles: ["editor"], grants: ["release_approve"] }],
    });
    const other = await organisation();
    const foreign = await call("PATCH", `/api/v1/orgs/${org.orgId}/members/${id}`, org.ownerCookie, {
      publications: [{ publicationId: other.pubId, roles: ["editor"], grants: [] }],
    });
    expect(foreign.statusCode).toBe(400);
    const ownerId = (await userId(org.owner)) ?? "";
    expect(
      (await call("PATCH", `/api/v1/orgs/${org.orgId}/members/${ownerId}`, org.ownerCookie, { orgRole: "member" }))
        .statusCode,
    ).toBe(403);
    expect((await call("DELETE", `/api/v1/orgs/${org.orgId}/members/${ownerId}`, org.ownerCookie)).statusCode).toBe(
      403,
    );
    expect((await call("DELETE", `/api/v1/orgs/${org.orgId}/members/${id}`, org.ownerCookie)).statusCode).toBe(204);
    expect(await memberships(id, org.orgId)).toEqual([]);
    const { rows } = await su.query("select status from app.person where user_id = $1 and org_id = $2", [
      id,
      org.orgId,
    ]);
    expect(rows).toEqual([{ status: "removed" }]);
    const grants = await su.query("select count(*)::int as n from app.publication_grant where user_id = $1", [id]);
    expect(grants.rows).toEqual([{ n: 0 }]);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, person.cookie)).statusCode).toBe(404);
  });
});

/** Every route of better-auth 1.7.8's organization plugin, the team and role routes included (they are mounted only
 * when those features are on). */
const ORGANIZATION_ROUTES = [
  "accept-invitation",
  "add-team-member",
  "cancel-invitation",
  "check-slug",
  "create",
  "create-role",
  "create-team",
  "delete",
  "delete-role",
  "get-active-member",
  "get-active-member-role",
  "get-full-organization",
  "get-invitation",
  "get-organization",
  "get-role",
  "has-permission",
  "invite-member",
  "leave",
  "list",
  "list-invitations",
  "list-members",
  "list-roles",
  "list-team-members",
  "list-teams",
  "list-user-invitations",
  "list-user-teams",
  "reject-invitation",
  "remove-member",
  "remove-team",
  "remove-team-member",
  "set-active",
  "set-active-team",
  "update",
  "update-member-role",
  "update-role",
  "update-team",
].map((name) => `/organization/${name}`);

describe("Better Auth's organization routes", () => {
  it(`all ${ORGANIZATION_ROUTES.length} answer 404, even to the Owner`, async () => {
    const org = await organisation();
    expect(ORGANIZATION_ROUTES).toEqual(expect.arrayContaining([...ORGANIZATION_PATHS]));
    for (const path of ORGANIZATION_ROUTES) {
      for (const method of ["GET", "POST"] as const) {
        const res = await call(
          method,
          `/api/auth${path}`,
          org.ownerCookie,
          method === "POST" ? { organizationId: org.orgId } : undefined,
        );
        expect(res.statusCode, `${method} ${path}`).toBe(404);
      }
    }
  });
});

describe("two-step sign-in", () => {
  it("is required of an Owner by default: 403 two_step_required until it is on, /me says so", async () => {
    const org = await organisation(true);
    const refused = await call("GET", `/api/v1/orgs/${org.orgId}/members`, org.ownerCookie);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("two_step_required");
    expect((await call("GET", "/api/v1/me", org.ownerCookie)).json().memberships[0].twoStep).toEqual({
      required: true,
      satisfied: false,
    });
    const { cookie } = await enableTwoStep(org.ownerCookie);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, cookie)).statusCode).toBe(200);
    expect((await call("GET", "/api/v1/me", cookie)).json().memberships[0].twoStep).toEqual({
      required: true,
      satisfied: true,
    });
  });

  it("asks for a code after the password; only the finished sign-in is recorded; the secret is stored encrypted", async () => {
    const email = someone();
    const id = await account(email);
    const { secret } = await enableTwoStep(await session(email));
    const before = await su.query(
      "select count(*)::int as n from identity.auth_event where user_id = $1 and kind = 'sign_in'",
      [id],
    );
    const first = await signIn(email);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ twoFactorRedirect: true });
    expect(first.cookies.find((c) => c.name === "__Secure-pgn.session_token" && c.value !== "")).toBeUndefined();
    const middle = await su.query(
      "select count(*)::int as n from identity.auth_event where user_id = $1 and kind = 'sign_in'",
      [id],
    );
    expect(middle.rows).toEqual(before.rows);
    const done = await call("POST", "/api/auth/two-factor/verify-totp", cookieOf(first), {
      code: totp(secret, Date.now() + 30_000),
    });
    expect(done.statusCode).toBe(200);
    const after = await su.query(
      "select count(*)::int as n from identity.auth_event where user_id = $1 and kind = 'sign_in'",
      [id],
    );
    expect(after.rows).toEqual([{ n: (before.rows[0]?.n ?? 0) + 1 }]);
    const stored = await su.query<{ secret: string; backupCodes: string }>(
      'select secret, "backupCodes" from identity."twoFactor" where "userId" = $1',
      [id],
    );
    const raw = base32(secret).toString("utf8");
    expect(stored.rows[0]?.secret).not.toContain(raw);
    expect(stored.rows[0]?.secret).not.toContain(secret);
  });

  it("locks after 5 wrong codes, even for the right one; a backup code works once", async () => {
    const email = someone();
    await account(email);
    const { secret, backupCodes } = await enableTwoStep(await session(email));
    for (let i = 0; i < 5; i += 1) {
      const pending = cookieOf(await signIn(email));
      expect((await call("POST", "/api/auth/two-factor/verify-totp", pending, { code: "000000" })).statusCode).toBe(
        401,
      );
    }
    const pending = cookieOf(await signIn(email));
    expect(
      (await call("POST", "/api/auth/two-factor/verify-totp", pending, { code: totp(secret, Date.now() + 30_000) }))
        .statusCode,
    ).toBe(429);

    const other = someone();
    await account(other);
    const second = await enableTwoStep(await session(other));
    const code = second.backupCodes[0] ?? "";
    const once = await call("POST", "/api/auth/two-factor/verify-backup-code", cookieOf(await signIn(other)), { code });
    expect(once.statusCode).toBe(200);
    const twice = await call("POST", "/api/auth/two-factor/verify-backup-code", cookieOf(await signIn(other)), {
      code,
    });
    expect(twice.statusCode).toBe(401);
    void backupCodes;
  });

  it("trusts a device for 30 days when asked: its next sign-in needs no code", async () => {
    const email = someone();
    await account(email);
    const { secret } = await enableTwoStep(await session(email));
    const pending = await signIn(email);
    const trusted = await call("POST", "/api/auth/two-factor/verify-totp", cookieOf(pending), {
      code: totp(secret, Date.now() + 30_000),
      trustDevice: true,
    });
    expect(trusted.statusCode).toBe(200);
    const trust = trusted.cookies.find((c) => c.name.includes("trust_device"));
    expect(trust?.maxAge).toBe(30 * 24 * 3600);
    const next = await signIn(email, PASSWORD, {}, `${trust?.name}=${trust?.value}`);
    expect(next.statusCode).toBe(200);
    expect(next.json().twoFactorRedirect).toBeUndefined();
    expect(next.cookies.find((c) => c.name === "__Secure-pgn.session_token" && c.value !== "")).toBeDefined();
  });
});

describe("removal holds (review F1)", () => {
  it("refuses a sign-up name the directory cannot keep: empty, or over 200 characters", async () => {
    const org = await organisation();
    for (const name of ["A".repeat(201), "   "]) {
      const email = someone("invitee");
      const created = (await invite(org, email, [])).json();
      const res = await it_.app.inject({
        method: "POST",
        url: "/api/auth/sign-up/email",
        headers: { ...FROM_APP, "x-pageinator-invitation": created.id },
        payload: { name, email, password: PASSWORD },
        remoteAddress: address(),
      });
      expect([res.statusCode, res.json().token]).toEqual([200, null]);
      expect(await userId(email)).toBeNull();
    }
  });

  it("undoes an accept whose directory row cannot be written: no member without it, and it can be tried again", async () => {
    const org = await organisation();
    const person = await invitee(org, [{ publicationId: org.pubId, roles: ["editor"], grants: [] }], "admin");
    await su.query(`create function app.test_refuse_person() returns trigger language plpgsql as $$
      begin if new.email = '${person.email}' then raise exception 'planted failure'; end if; return new; end $$`);
    await su.query(
      "create trigger test_refuse before insert or update on app.person for each row execute function app.test_refuse_person()",
    );
    try {
      expect((await call("POST", `/api/v1/invitations/${person.id}/accept`, person.cookie)).statusCode).toBe(500);
      expect(await memberships((await userId(person.email)) ?? "", org.orgId)).toEqual([]);
      const { rows } = await su.query("select status from identity.invitation where id = $1", [person.id]);
      expect(rows).toEqual([{ status: "pending" }]);
      expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, person.cookie)).statusCode).toBe(404);
    } finally {
      await su.query("drop trigger test_refuse on app.person; drop function app.test_refuse_person()");
    }
    expect((await call("POST", `/api/v1/invitations/${person.id}/accept`, person.cookie)).statusCode).toBe(200);
    expect(await memberships((await userId(person.email)) ?? "", org.orgId)).toEqual([{ role: "admin" }]);
  });

  it("removes an Admin whose directory row was never written for good: a tombstone, and /me repairs nothing", async () => {
    const org = await organisation();
    const person = await member(org, [], "admin");
    const id = (await userId(person.email)) ?? "";
    await su.query("delete from app.person where user_id = $1", [id]); // as an accept that died half-way left it
    expect((await call("DELETE", `/api/v1/orgs/${org.orgId}/members/${id}`, org.ownerCookie)).statusCode).toBe(204);
    const tombstone = await su.query("select status from app.person where user_id = $1 and org_id = $2", [
      id,
      org.orgId,
    ]);
    expect(tombstone.rows).toEqual([{ status: "removed" }]);
    const invitation = await su.query("select status from identity.invitation where id = $1", [person.id]);
    expect(invitation.rows).toEqual([{ status: "canceled" }]);
    for (let i = 0; i < 2; i += 1)
      expect((await call("GET", "/api/v1/me", person.cookie)).json().memberships).toEqual([]);
    expect(await memberships(id, org.orgId)).toEqual([]);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/invitations`, person.cookie)).statusCode).toBe(404);
  });
});

describe("two-step is a session's, not a person's (review F2)", () => {
  it("ends the person's other sessions when two-step is turned on, and refuses a session not made with it", async () => {
    const org = await organisation(true);
    const otherDevice = await session(org.owner); // the password only, before two-step
    const { cookie } = await enableTwoStep(org.ownerCookie);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, cookie)).statusCode).toBe(200);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, otherDevice)).statusCode).toBe(401);
    // a session of an enrolled person without the session's own two-step mark is refused
    await su.query(`update identity.session set "twoStepAt" = null where "userId" = $1`, [await userId(org.owner)]);
    const refused = await call("GET", `/api/v1/orgs/${org.orgId}/members`, cookie);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error.code).toBe("two_step_required");
    expect((await call("GET", "/api/v1/me", cookie)).json().memberships[0].twoStep).toEqual({
      required: true,
      satisfied: false,
    });
  });

  it("refuses a member promoted to Admin until two-step, and their other sessions after they turn it on", async () => {
    const org = await organisation(true);
    const { cookie: ownerCookie } = await enableTwoStep(org.ownerCookie);
    org.ownerCookie = ownerCookie;
    const person = await member(org, [{ publicationId: org.pubId, roles: ["reporter"], grants: [] }]);
    const second = await session(person.email);
    const id = (await userId(person.email)) ?? "";
    expect(
      (await call("PATCH", `/api/v1/orgs/${org.orgId}/members/${id}`, ownerCookie, { orgRole: "admin" })).statusCode,
    ).toBe(200);
    for (const cookie of [person.cookie, second]) {
      expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, cookie)).json().error.code).toBe(
        "two_step_required",
      );
    }
    const { cookie } = await enableTwoStep(person.cookie);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, cookie)).statusCode).toBe(200);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, second)).statusCode).toBe(401);
  });

  it("keeps a trusted device's sign-in and a password change counted as two-step", async () => {
    const org = await organisation(true);
    const { secret } = await enableTwoStep(org.ownerCookie);
    const pending = await signIn(org.owner);
    const trusted = await call("POST", "/api/auth/two-factor/verify-totp", cookieOf(pending), {
      code: totp(secret, Date.now() + 30_000),
      trustDevice: true,
    });
    const trust = trusted.cookies.find((c) => c.name.includes("trust_device"));
    const next = await signIn(org.owner, PASSWORD, {}, `${trust?.name}=${trust?.value}`);
    const viaTrust = cookieOf(next);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, viaTrust)).statusCode).toBe(200);
    const changed = await call("POST", "/api/auth/change-password", viaTrust, {
      currentPassword: PASSWORD,
      newPassword: "काल्पनिकनगर a changed password",
    });
    expect(changed.statusCode).toBe(200);
    expect((await call("GET", `/api/v1/orgs/${org.orgId}/members`, cookieOf(changed))).statusCode).toBe(200);
  });
});

describe("TOTP codes are used once (review F6)", () => {
  it("refuses a code that already finished a sign-in, within its window", async () => {
    const email = someone();
    await account(email);
    const { secret } = await enableTwoStep(await session(email));
    const code = totp(secret, Date.now() + 30_000);
    const first = await call("POST", "/api/auth/two-factor/verify-totp", cookieOf(await signIn(email)), { code });
    expect(first.statusCode).toBe(200);
    const again = await call("POST", "/api/auth/two-factor/verify-totp", cookieOf(await signIn(email)), { code });
    expect(again.statusCode).toBe(401);
    const next = await call("POST", "/api/auth/two-factor/verify-totp", cookieOf(await signIn(email)), {
      code: totp(secret, Date.now() - 30_000),
    });
    expect(next.statusCode).toBe(200);
  });
});

describe("resending an expired invitation (review F3)", () => {
  it("makes a new invitation with the same grants, emails its link, and cancels the old one", async () => {
    const org = await organisation();
    const email = someone("invitee");
    const created = (
      await invite(org, email, [{ publicationId: org.pubId, roles: ["editor"], grants: ["page_approve"] }])
    ).json();
    await su.query(`update identity.invitation set "expiresAt" = now() - interval '1 day' where id = $1`, [created.id]);
    const resent = await call("POST", `/api/v1/orgs/${org.orgId}/invitations/${created.id}/resend`, org.ownerCookie);
    expect(resent.statusCode).toBe(200);
    const fresh = resent.json();
    expect(fresh.id).not.toBe(created.id);
    expect(fresh).toMatchObject({
      state: "pending",
      publications: [{ publicationId: org.pubId, roles: ["editor"], grants: ["page_approve"] }],
    });
    expect(lastLink(it_.sent, email)).toBe(`/invite/${fresh.id}`);
    const old = await su.query("select status from identity.invitation where id = $1", [created.id]);
    expect(old.rows).toEqual([{ status: "canceled" }]);
    const audit = await su.query(
      "select target_id from app.audit_event where action = 'invitation.resend' and org_id = $1",
      [org.orgId],
    );
    expect(audit.rows).toEqual([{ target_id: fresh.id }]);
  });
});

describe("the route table (review F4)", () => {
  it("decides by the route, not the spelling of the URL: an encoded /api/v1 path is checked too", async () => {
    const org = await organisation();
    const reporter = await member(org, [{ publicationId: org.pubId, roles: ["reporter"], grants: [] }]);
    const encoded = await call("GET", `/api/%761/orgs/${org.orgId}/members`, reporter.cookie);
    expect(encoded.statusCode).toBe(403);
    expect(encoded.json().error.code).toBe("not_allowed");
    expect((await call("GET", "/api/%761/me", "")).statusCode).toBe(401);
  });

  it("has exactly one access declaration for every /api/v1 route the router holds, after ready()", async () => {
    await it_.app.ready();
    // the router's own table, a tree whose lines each add a segment to their parent's path
    const paths: string[] = [];
    const routed: string[] = [];
    for (const line of it_.app.printRoutes({ commonPrefix: false }).split("\n")) {
      const found = /^([│├└─\s]*?)(\S+) \(([A-Z, ]+)\)$/u.exec(line);
      if (!found) continue;
      const depth = [...(found[1] ?? "")].length / 4 - 1;
      paths[depth] = (depth > 0 ? (paths[depth - 1] ?? "") : "") + (found[2] ?? "");
      paths.length = depth + 1;
      const url = paths[depth] ?? "";
      if (url.startsWith("/api/v1/"))
        for (const method of (found[3] ?? "").split(", ")) routed.push(`${method} ${url}`);
    }
    expect(routed).toEqual(
      expect.arrayContaining([
        "GET /api/v1/me",
        "POST /api/v1/invitations/:id/accept",
        "DELETE /api/v1/orgs/:o/members/:userId",
      ]),
    );
    const declared = new Map(it_.app.apiRoutes.map((route) => [`${route.method} ${route.url}`, route]));
    for (const route of routed) {
      const entry = declared.get(route);
      expect(entry, route).toBeDefined();
      expect(
        [entry?.access, entry?.permission].filter((value) => value !== undefined),
        route,
      ).toHaveLength(1);
    }
  });
});

describe("approval grants (review F5)", () => {
  it("go only with the Editor role: refused on a Viewer at invite and at grant time", async () => {
    const org = await organisation();
    const onViewer = [{ publicationId: org.pubId, roles: ["viewer"], grants: ["page_approve"] }];
    expect((await invite(org, someone(), onViewer)).statusCode).toBe(400);
    const person = await member(org, [{ publicationId: org.pubId, roles: ["viewer"], grants: [] }]);
    const id = (await userId(person.email)) ?? "";
    const patched = await call("PATCH", `/api/v1/orgs/${org.orgId}/members/${id}`, org.ownerCookie, {
      publications: [{ publicationId: org.pubId, roles: ["viewer"], grants: ["release_approve"] }],
    });
    expect(patched.statusCode).toBe(400);
  });
});
