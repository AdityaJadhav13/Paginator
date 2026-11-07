// Sign-in (src/modules/identity; docs/product/10-l2-newsroom-plan.md §4.1–4.6) on a migrated clone, through the API's
// own routes: the identity schema Better Auth expects, closed sign-up, verification before any session, the cookie,
// generic answers, the per-address and per-email limits, password reset and change, the session limits, the sign-in
// events and the new-browser email, and request.actor.
import { getMigrations } from "better-auth/db/migration";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authOptions, SIGN_INS_PER_ADDRESS, VERIFICATION_EMAILS_PER_EMAIL } from "../../src/modules/identity/auth.ts";
import { signedIn } from "../../src/modules/identity/plugin.ts";
import { LOCK_AFTER, WINDOW_MS, emailKey } from "../../src/modules/identity/sign-in-guard.ts";
import { openMailer } from "../../src/modules/notifications/mailer.ts";
import { FROM_APP, type IdentityApp, ORIGIN, SECRET, identityApp, lastLink } from "./identity-app.ts";
import { freshDatabase } from "./helpers.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
afterAll(async () => {
  await it_.close();
  await db.drop();
});
beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  it_.app.get("/api/v1/test/whoami", { config: { access: "signed_in" }, preHandler: signedIn }, async (request) => ({
    userId: request.actor?.userId,
  }));
});

const PASSWORD = "काल्पनिकनगर correct horse";
let counter = 0;
/** A new person's address; each test gets its own. */
const someone = () => `reporter.${++counter}.${Date.now()}@example.test`;

async function account(email: string, password = PASSWORD): Promise<string> {
  const made = await it_.server.api.signUpEmail({ body: { name: "Reporter (fictional)", email, password } });
  const verify = lastLink(it_.sent, email);
  const res = await it_.app.inject({ method: "GET", url: verify });
  expect(res.statusCode, `verifying ${email}`).toBeLessThan(400);
  return made.user.id;
}

function signIn(
  email: string,
  password = PASSWORD,
  extra: Record<string, unknown> = {},
  remoteAddress = "198.51.100.7",
) {
  return it_.app.inject({
    method: "POST",
    url: "/api/auth/sign-in/email",
    headers: FROM_APP,
    payload: { email, password, ...extra },
    remoteAddress,
  });
}

const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies
    .filter((c) => c.name === "__Secure-pgn.session_token")
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");

/** Every cookie an answer set, as a request's Cookie header. */
const allCookies = (res: { cookies: { name: string; value: string }[] }) =>
  res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

/** The session token inside a session cookie (its value is "<token>.<signature>"). */
const tokenOf = (cookie: string) => decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0] ?? "";

/** A person's sign-in events, oldest first. */
async function kinds(userId: string): Promise<string[]> {
  const { rows } = await su.query<{ kind: string }>(
    "select kind from identity.auth_event where user_id = $1 order by at, id",
    [userId],
  );
  return rows.map((row) => row.kind);
}

async function age(cookie: string, interval: string) {
  await su.query(
    `update identity.session set "createdAt" = "createdAt" - $2::interval, "updatedAt" = "updatedAt" - $2::interval,
       "expiresAt" = "expiresAt" - $2::interval where token = $1`,
    [tokenOf(cookie), interval],
  );
}

describe("the identity schema", () => {
  it("is what Better Auth 1.7.8 expects for our configuration: nothing left to create or add", async () => {
    const mailer = openMailer(it_.config.mail, { sendMail: async () => undefined, close: () => undefined }, () => {});
    const quiet = { warn: () => undefined, error: () => undefined };
    const { toBeCreated, toBeAdded } = await getMigrations(
      authOptions({ config: it_.config, database: it_.database, mailer, log: quiet }),
    );
    expect({ toBeCreated, toBeAdded }).toEqual({ toBeCreated: [], toBeAdded: [] });
  });
});

describe("sign-up", () => {
  it("is closed over HTTP: the same answer as any sign-up, but no account and no email", async () => {
    const email = someone();
    const res = await it_.app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: FROM_APP,
      payload: { name: "Stranger (fictional)", email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ token: null });
    expect(it_.sent.filter((m) => m.to === email)).toEqual([]);
    const { rows } = await it_.database.auth.query('select count(*)::int as n from identity."user" where email = $1', [
      email,
    ]);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it(`sends one email at most ${VERIFICATION_EMAILS_PER_EMAIL} confirmation links an hour, from any addresses, with the same answer`, async () => {
    const email = someone();
    await it_.server.api.signUpEmail({ body: { name: "Reporter (fictional)", email, password: PASSWORD } });
    const links = () => it_.sent.filter((m) => m.to === email).length;
    const before = links();
    for (let i = 0; i < VERIFICATION_EMAILS_PER_EMAIL + 2; i += 1) {
      const res = await it_.app.inject({
        method: "POST",
        url: "/api/auth/send-verification-email",
        headers: FROM_APP,
        payload: { email },
        remoteAddress: `198.51.100.${60 + i}`,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: true });
    }
    expect(links() - before).toBe(VERIFICATION_EMAILS_PER_EMAIL);
  });

  it("from the server sends a verification link to the public origin; no sign-in before it is opened", async () => {
    const email = someone();
    await it_.server.api.signUpEmail({ body: { name: "Reporter (fictional)", email, password: PASSWORD } });
    const mail = it_.sent.filter((m) => m.to === email).at(-1);
    expect(mail?.subject).toContain("Confirm your email address");
    expect(mail?.text).toContain(`${ORIGIN}/api/auth/verify-email?token=`);
    const res = await signIn(email);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(cookieOf(res)).toBe("");
  });

  it("verifying signs in with a __Secure- cookie: HttpOnly, Secure, SameSite=Lax", async () => {
    const email = someone();
    await it_.server.api.signUpEmail({ body: { name: "Reporter (fictional)", email, password: PASSWORD } });
    const res = await it_.app.inject({ method: "GET", url: lastLink(it_.sent, email) });
    expect(res.statusCode).toBe(302);
    const cookie = res.cookies.find((c) => c.name === "__Secure-pgn.session_token");
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  });
});

describe("sign-in", () => {
  it("with the right password gives a session; unticked 'Keep me signed in' makes it a browser-session cookie", async () => {
    const email = someone();
    await account(email);
    const kept = await signIn(email);
    expect(kept.statusCode).toBe(200);
    expect(kept.cookies.find((c) => c.name === "__Secure-pgn.session_token")?.maxAge).toBe(12 * 3600);
    const notKept = await signIn(email, PASSWORD, { rememberMe: false }, "198.51.100.8");
    expect(notKept.cookies.find((c) => c.name === "__Secure-pgn.session_token")?.maxAge).toBeUndefined();
    const session = await it_.app.inject({ url: "/api/auth/get-session", headers: { cookie: cookieOf(kept) } });
    expect(session.json()).toMatchObject({ user: { email } });
  });

  it("answers a wrong password exactly as an unknown email", async () => {
    const email = someone();
    await account(email);
    const wrong = await signIn(email, "not the password at all", {}, "198.51.100.9");
    const unknown = await signIn(someone(), PASSWORD, {}, "198.51.100.10");
    expect([wrong.statusCode, wrong.json()]).toEqual([unknown.statusCode, unknown.json()]);
    expect(wrong.statusCode).toBe(401);
  });

  it.each(["a known", "an unknown"])(
    "locks %s email for 15 minutes after 5 wrong passwords, from any address",
    async (which) => {
      const email = someone();
      if (which === "a known") await account(email);
      const net = which === "a known" ? "203.0.113" : "192.0.2";
      for (let i = 1; i <= 5; i += 1) {
        expect((await signIn(email, "not the password at all", {}, `${net}.${i}`)).statusCode).toBe(401);
      }
      // the right password, from yet another address: still locked, and told how long the lock can still run
      const locked = await signIn(email, PASSWORD, {}, `${net}.99`);
      expect(locked.statusCode).toBe(429);
      expect(locked.headers["retry-after"]).toBe("900");
    },
  );

  // over a hundred sign-ins, each hashing a password: seconds alone, a minute on a busy machine
  it(
    `limits one address to ${SIGN_INS_PER_ADDRESS} sign-ins in 5 minutes (a newsroom behind one NAT); forged forwarding headers do not help`,
    { timeout: 60_000 },
    async () => {
      const address = "192.0.2.50";
      for (let i = 0; i < SIGN_INS_PER_ADDRESS; i += 1) {
        expect((await signIn(someone(), PASSWORD, {}, address)).statusCode).not.toBe(429);
      }
      const sixth = await it_.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { ...FROM_APP, "x-forwarded-for": "203.0.113.200", "x-pgn-client-ip": "203.0.113.201" },
        payload: { email: someone(), password: PASSWORD },
        remoteAddress: address,
      });
      expect(sixth.statusCode).toBe(429);
      const retry = Number(sixth.headers["x-retry-after"]);
      expect(retry).toBeGreaterThan(0);
      expect(retry).toBeLessThanOrEqual(300);
    },
  );
});

describe("password reset and change", () => {
  it("answers an unknown email as a known one, and emails only the known one", async () => {
    const email = someone();
    await account(email);
    const ask = (to: string, remoteAddress: string) =>
      it_.app.inject({
        method: "POST",
        url: "/api/auth/request-password-reset",
        headers: FROM_APP,
        payload: { email: to, redirectTo: "/reset" },
        remoteAddress,
      });
    const stranger = someone();
    const known = await ask(email, "198.51.100.20");
    const unknown = await ask(stranger, "198.51.100.21");
    expect([known.statusCode, known.json()]).toEqual([unknown.statusCode, unknown.json()]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(it_.sent.filter((m) => m.to === stranger)).toEqual([]);
    expect(lastLink(it_.sent, email)).toMatch(/^\/api\/auth\/reset-password\/[^/?]+\?callbackURL=%2Freset$/);
  });

  it("sets the new password, ends every session, and the link works once", async () => {
    const email = someone();
    await account(email);
    const before = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.30"));
    await it_.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      headers: FROM_APP,
      payload: { email, redirectTo: "/reset" },
      remoteAddress: "198.51.100.31",
    });
    const opened = await it_.app.inject({ method: "GET", url: lastLink(it_.sent, email) });
    expect(opened.statusCode).toBe(302);
    const token = new URL(String(opened.headers.location), ORIGIN).searchParams.get("token") ?? "";
    expect(token).not.toBe("");
    const reset = (newPassword: string) =>
      it_.app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        headers: FROM_APP,
        payload: { newPassword, token },
        remoteAddress: "198.51.100.32",
      });
    expect((await reset("काल्पनिकनगर a brand new password")).statusCode).toBe(200);
    expect((await reset("काल्पनिकनगर yet another password")).statusCode).toBe(400);
    const old = await it_.app.inject({ url: "/api/auth/get-session", headers: { cookie: before } });
    expect(old.json()).toBeNull();
    expect((await signIn(email, PASSWORD, {}, "198.51.100.33")).statusCode).toBe(401);
    expect((await signIn(email, "काल्पनिकनगर a brand new password", {}, "198.51.100.34")).statusCode).toBe(200);
    const su = await db.connect("postgres");
    const { rows } = await su.query(
      `select count(*)::int as n from identity.auth_event where kind = 'password_reset'
       and user_id = (select id from identity."user" where email = $1)`,
      [email],
    );
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("keeps reset tokens hashed: the token in the link is nowhere in the database", async () => {
    const email = someone();
    await account(email);
    await it_.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      headers: FROM_APP,
      payload: { email, redirectTo: "/reset" },
      remoteAddress: "198.51.100.35",
    });
    const token = lastLink(it_.sent, email).match(/reset-password\/([^/?]+)/)?.[1] ?? "";
    expect(token.length).toBeGreaterThan(10);
    const su = await db.connect("postgres");
    const { rows } = await su.query(
      "select count(*)::int as n from identity.verification where identifier like '%' || $1 || '%' or value like '%' || $1 || '%'",
      [token],
    );
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("changing the password ends the other sessions, even when the client asks to keep them", async () => {
    const email = someone();
    await account(email);
    const other = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.40"));
    const mine = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.41"));
    const changed = await it_.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { ...FROM_APP, cookie: mine },
      payload: { currentPassword: PASSWORD, newPassword: "काल्पनिकनगर changed password", revokeOtherSessions: false },
      remoteAddress: "198.51.100.42",
    });
    expect(changed.statusCode).toBe(200);
    const otherSession = await it_.app.inject({ url: "/api/auth/get-session", headers: { cookie: other } });
    expect(otherSession.json()).toBeNull();
  });
});

describe("sessions and request.actor", () => {
  it("an /api/v1 route behind signedIn: 401 signed_out without a session, the person with one", async () => {
    const out = await it_.app.inject({ url: "/api/v1/test/whoami" });
    expect(out.statusCode).toBe(401);
    expect(out.json()).toMatchObject({ error: { code: "signed_out" } });
    const email = someone();
    const userId = await account(email);
    const cookie = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.50"));
    const me = await it_.app.inject({ url: "/api/v1/test/whoami", headers: { cookie } });
    expect(me.json()).toEqual({ userId });
  });

  it("ends a session idle for 12 hours, and one 30 days old however busy (recorded as expired)", async () => {
    const email = someone();
    await account(email);
    const idle = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.60"));
    const old = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.61"));
    const su = await db.connect("postgres");
    const token = (cookie: string) => decodeURIComponent(cookie.split("=")[1] ?? "").split(".")[0];
    await su.query("update identity.session set \"expiresAt\" = now() - interval '1 minute' where token = $1", [
      token(idle),
    ]);
    await su.query("update identity.session set \"createdAt\" = now() - interval '30 days 1 minute' where token = $1", [
      token(old),
    ]);
    expect((await it_.app.inject({ url: "/api/v1/test/whoami", headers: { cookie: idle } })).statusCode).toBe(401);
    expect((await it_.app.inject({ url: "/api/v1/test/whoami", headers: { cookie: old } })).statusCode).toBe(401);
    const { rows } = await su.query("select count(*)::int as n from identity.session where token = $1", [token(old)]);
    expect(rows).toEqual([{ n: 0 }]);
    const events = await su.query(
      "select kind from identity.auth_event where kind = 'session_expired' and user_id = (select id from identity.\"user\" where email = $1)",
      [email],
    );
    expect(events.rows).toEqual([{ kind: "session_expired" }]);
  });
});

describe("the session limits, however the request is made", () => {
  it("ends a 30-day-old session on /api/auth/* and /api/v1 when the cookie name is followed by a space", async () => {
    const email = someone();
    await account(email);
    const viaAuth = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.90"));
    const viaV1 = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.91"));
    for (const cookie of [viaAuth, viaV1]) {
      await su.query(`update identity.session set "createdAt" = now() - interval '31 days' where token = $1`, [
        tokenOf(cookie),
      ]);
    }
    const spaced = (cookie: string) => cookie.replace("__Secure-pgn.session_token=", "__Secure-pgn.session_token =");
    const session = await it_.app.inject({ url: "/api/auth/get-session", headers: { cookie: spaced(viaAuth) } });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toBeNull();
    const revoke = await it_.app.inject({
      method: "POST",
      url: "/api/auth/revoke-other-sessions",
      headers: { ...FROM_APP, cookie: spaced(viaAuth) },
      payload: {},
    });
    expect(revoke.statusCode).toBe(401);
    const v1 = await it_.app.inject({ url: "/api/v1/test/whoami", headers: { cookie: spaced(viaV1) } });
    expect(v1.statusCode).toBe(401);
    const { rows } = await su.query("select count(*)::int as n from identity.session where token = any($1)", [
      [tokenOf(viaAuth), tokenOf(viaV1)],
    ]);
    expect(rows).toEqual([{ n: 0 }]);
  });

  it("records an ended 30-day session once, as session_expired, with the request's real address", async () => {
    const email = someone();
    const userId = await account(email);
    const cookie = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.92"));
    await su.query(`update identity.session set "createdAt" = now() - interval '31 days' where token = $1`, [
      tokenOf(cookie),
    ]);
    const v1 = await it_.app.inject({
      url: "/api/v1/test/whoami",
      headers: { cookie, "x-pgn-client-ip": "203.0.113.66", "x-forwarded-for": "203.0.113.67" },
      remoteAddress: "198.51.100.93",
    });
    expect(v1.statusCode).toBe(401);
    expect(await kinds(userId)).toEqual(["email_verified", "sign_in", "sign_in", "session_expired"]);
    const { rows } = await su.query(
      "select host(ip) as ip from identity.auth_event where user_id = $1 and kind = 'session_expired'",
      [userId],
    );
    expect(rows).toEqual([{ ip: "198.51.100.93" }]);
  });

  it("gives a session not kept 12 hours on the server, not 24, and ends it after 12 hours however used", async () => {
    const email = someone();
    await account(email);
    const kept = await signIn(email, PASSWORD, {}, "198.51.100.94");
    const notKept = await signIn(email, PASSWORD, { rememberMe: false }, "198.51.100.95");
    const hours = async (cookie: string) =>
      Number(
        (
          await su.query<{ hours: string }>(
            `select extract(epoch from ("expiresAt" - "createdAt")) / 3600 as hours from identity.session where token = $1`,
            [tokenOf(cookie)],
          )
        ).rows[0]?.hours,
      );
    expect(await hours(cookieOf(notKept))).toBeCloseTo(12, 2);
    expect(await hours(cookieOf(kept))).toBeCloseTo(12, 2);
    const both = allCookies(notKept);
    expect(both).toContain("dont_remember");
    expect((await it_.app.inject({ url: "/api/v1/test/whoami", headers: { cookie: both } })).statusCode).toBe(200);
    await age(cookieOf(notKept), "12 hours 1 minute");
    expect((await it_.app.inject({ url: "/api/v1/test/whoami", headers: { cookie: both } })).statusCode).toBe(401);
  });
});

describe("the per-email lock, under attempts sent together", () => {
  it(`lets ${LOCK_AFTER} of 25 simultaneous guesses from 5 addresses be checked, and locks for 15 minutes`, async () => {
    const email = someone();
    const userId = await account(email);
    const guesses = [];
    for (let address = 1; address <= 5; address += 1) {
      for (let i = 0; i < 5; i += 1) {
        guesses.push(signIn(email, `wrong password number ${address}-${i}`, {}, `203.0.113.${address + 10}`));
      }
    }
    const statuses: Record<number, number> = {};
    for (const answer of await Promise.all(guesses))
      statuses[answer.statusCode] = (statuses[answer.statusCode] ?? 0) + 1;
    expect(statuses).toEqual({ 401: LOCK_AFTER, 429: 25 - LOCK_AFTER });
    expect((await kinds(userId)).filter((kind) => kind !== "email_verified" && kind !== "sign_in")).toEqual([
      ...Array.from({ length: LOCK_AFTER }, () => "sign_in_failed"),
      "sign_in_locked",
    ]);
    const key = emailKey(SECRET, email);
    const { rows } = await su.query<{ seconds: number }>(
      "select extract(epoch from locked_until - now())::float8 as seconds from identity.sign_in_failure where email_key = $1",
      [key],
    );
    expect(rows[0]?.seconds).toBeGreaterThan(WINDOW_MS / 1000 - 60);
    expect(rows[0]?.seconds).toBeLessThanOrEqual(WINDOW_MS / 1000);
    expect((await signIn(email, PASSWORD, {}, "203.0.113.30")).statusCode).toBe(429);
    // 15 minutes on, the right password works again
    await su.query(
      `update identity.sign_in_failure set locked_until = now() - interval '1 second',
         window_started_at = window_started_at - interval '15 minutes' where email_key = $1`,
      [key],
    );
    expect((await signIn(email, PASSWORD, {}, "203.0.113.31")).statusCode).toBe(200);
  });

  it("does not count an attempt that was not a wrong password", async () => {
    const email = someone();
    await it_.server.api.signUpEmail({ body: { name: "Unverified (fictional)", email, password: PASSWORD } });
    for (let i = 0; i < LOCK_AFTER + 1; i += 1) {
      expect((await signIn(email, PASSWORD, {}, `203.0.113.${40 + i}`)).statusCode).toBe(403); // not verified yet
    }
    const { rows } = await su.query("select failures, checking from identity.sign_in_failure where email_key = $1", [
      emailKey(SECRET, email),
    ]);
    expect(rows).toEqual([{ failures: 0, checking: 0 }]);
  });
});

describe("rate limits", () => {
  it("keep no token: an opened reset link is counted under /reset-password/:param", async () => {
    const email = someone();
    await account(email);
    await it_.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      headers: FROM_APP,
      payload: { email, redirectTo: "/reset" },
      remoteAddress: "198.51.100.96",
    });
    const link = lastLink(it_.sent, email);
    const token = link.match(/reset-password\/([^/?]+)/)?.[1] ?? "";
    expect(token.length).toBeGreaterThan(10);
    expect((await it_.app.inject({ url: link, remoteAddress: "198.51.100.96" })).statusCode).toBe(302);
    const leaked = await su.query(
      `select count(*)::int as n from identity."rateLimit" where key like '%' || $1 || '%'`,
      [token],
    );
    expect(leaked.rows).toEqual([{ n: 0 }]);
    const counted = await su.query(
      `select key from identity."rateLimit" where key like '198.51.100.96|%' order by key`,
    );
    expect(counted.rows).toEqual([
      { key: "198.51.100.96|/request-password-reset" },
      { key: "198.51.100.96|/reset-password/:param" },
    ]);
  });
});

describe("sign-in events", () => {
  it("records each sign-in with its address and browser; nobody may change or delete one", async () => {
    const email = someone();
    const userId = await account(email);
    await it_.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { ...FROM_APP, "user-agent": "Fictional Browser/1.0" },
      payload: { email, password: PASSWORD },
      remoteAddress: "198.51.100.70",
    });
    const su = await db.connect("postgres");
    const { rows } = await su.query(
      "select kind, host(ip) as ip, user_agent from identity.auth_event where user_id = $1 and ip is not null",
      [userId],
    );
    expect(rows).toContainEqual({ kind: "sign_in", ip: "198.51.100.70", user_agent: "Fictional Browser/1.0" });
    await expect(su.query("delete from identity.auth_event where user_id = $1", [userId])).rejects.toThrow(
      "identity.auth_event is append-only: DELETE is not allowed",
    );
  });

  it("records verifying, wrong passwords and signing out, each once, with the address", async () => {
    const email = someone();
    const userId = await account(email);
    await signIn(email, "not the password at all", {}, "198.51.100.71");
    const cookie = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.72"));
    await it_.app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { ...FROM_APP, cookie },
      payload: {},
      remoteAddress: "198.51.100.73",
    });
    expect(await kinds(userId)).toEqual(["email_verified", "sign_in", "sign_in_failed", "sign_in", "sign_out"]);
    const { rows } = await su.query(
      "select kind, host(ip) as ip from identity.auth_event where user_id = $1 and kind in ('sign_in_failed', 'sign_out') order by at",
      [userId],
    );
    expect(rows).toEqual([
      { kind: "sign_in_failed", ip: "198.51.100.71" },
      { kind: "sign_out", ip: "198.51.100.73" },
    ]);
  });

  it("records nothing for a forged verification link, and one email_verified for a link opened twice", async () => {
    const before = await su.query("select count(*)::int as n from identity.auth_event where kind = 'email_verified'");
    for (let i = 0; i < 3; i += 1) {
      const forged = await it_.app.inject({
        url: `/api/auth/verify-email?token=forged.${i}.token&callbackURL=%2F`,
        remoteAddress: "203.0.113.99",
      });
      expect(forged.statusCode).toBe(302);
    }
    const after = await su.query("select count(*)::int as n from identity.auth_event where kind = 'email_verified'");
    expect(after.rows).toEqual(before.rows);
    const email = someone();
    const made = await it_.server.api.signUpEmail({
      body: { name: "Reporter (fictional)", email, password: PASSWORD },
    });
    const link = lastLink(it_.sent, email);
    expect((await it_.app.inject({ url: link, remoteAddress: "198.51.100.74" })).statusCode).toBe(302);
    const again = await it_.app.inject({ url: link, remoteAddress: "198.51.100.75" });
    expect(again.statusCode).toBe(302);
    expect(cookieOf(again)).toBe("");
    expect(await kinds(made.user.id)).toEqual(["email_verified", "sign_in"]);
  });

  it("records a revocation only for the caller's own sessions, once per session ended", async () => {
    const victim = someone();
    const victimId = await account(victim);
    const victimCookie = cookieOf(await signIn(victim, PASSWORD, {}, "198.51.100.76"));
    const attacker = someone();
    const attackerId = await account(attacker);
    const attackerCookie = cookieOf(await signIn(attacker, PASSWORD, {}, "198.51.100.77"));
    const other = cookieOf(await signIn(attacker, PASSWORD, {}, "198.51.100.78"));
    const revoke = await it_.app.inject({
      method: "POST",
      url: "/api/auth/revoke-session",
      headers: { ...FROM_APP, cookie: attackerCookie },
      payload: { token: tokenOf(victimCookie) },
      remoteAddress: "198.51.100.77",
    });
    expect(revoke.statusCode).toBe(200);
    const victimSession = await it_.app.inject({ url: "/api/auth/get-session", headers: { cookie: victimCookie } });
    expect(victimSession.json()).toMatchObject({ user: { email: victim } });
    expect(await kinds(victimId)).toEqual(["email_verified", "sign_in", "sign_in"]);
    expect(await kinds(attackerId)).toEqual(["email_verified", "sign_in", "sign_in", "sign_in"]);
    const others = await it_.app.inject({
      method: "POST",
      url: "/api/auth/revoke-other-sessions",
      headers: { ...FROM_APP, cookie: attackerCookie },
      payload: {},
      remoteAddress: "198.51.100.79",
    });
    expect(others.statusCode).toBe(200);
    const { rows } = await su.query(
      "select session_id, host(ip) as ip from identity.auth_event where user_id = $1 and kind = 'session_revoked'",
      [attackerId],
    );
    const ended = await su.query<{ id: string }>(
      `select id from identity.session where "userId" = $1 and token <> $2`,
      [attackerId, tokenOf(attackerCookie)],
    );
    expect(ended.rows).toEqual([]); // the verifying session and the other one are gone
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.ip === "198.51.100.79")).toBe(true);
    expect(await kinds(attackerId)).toEqual([
      "email_verified",
      "sign_in",
      "sign_in",
      "sign_in",
      "session_revoked",
      "session_revoked",
    ]);
    void other;
  });

  it("records a password change as password_changed alone, not as a sign-in", async () => {
    const email = someone();
    const userId = await account(email);
    const cookie = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.80"));
    const changed = await it_.app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { ...FROM_APP, cookie },
      payload: { currentPassword: PASSWORD, newPassword: "काल्पनिकनगर a changed password" },
      remoteAddress: "198.51.100.80",
    });
    expect(changed.statusCode).toBe(200);
    expect(await kinds(userId)).toEqual(["email_verified", "sign_in", "sign_in", "password_changed"]);
  });

  it("emails a person when a browser they have not used signs in, but not for the first or a known one", async () => {
    const email = someone();
    await account(email); // the first sign-in (on verifying): no email
    const mails = () => it_.sent.filter((m) => m.to === email && m.subject.includes("New sign-in")).length;
    const as = (browser: string, address: string) =>
      it_.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: { ...FROM_APP, "user-agent": browser },
        payload: { email, password: PASSWORD },
        remoteAddress: address,
      });
    expect(mails()).toBe(0);
    await as("Fictional Phone/2.0", "198.51.100.80");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mails()).toBe(1);
    await as("Fictional Phone/2.0", "198.51.100.81");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(mails()).toBe(1);
  });
});

describe("Better Auth's endpoints we do not offer", () => {
  it.each([
    ["POST", "/api/auth/update-user"],
    ["POST", "/api/auth/change-email"],
    ["POST", "/api/auth/delete-user"],
    ["POST", "/api/auth/sign-in/social"],
    ["GET", "/api/auth/list-accounts"],
  ] as const)("%s %s answers 404", async (method, url) => {
    const res = await it_.app.inject({ method, url, headers: FROM_APP, ...(method === "POST" ? { payload: {} } : {}) });
    expect(res.statusCode).toBe(404);
  });

  it("/verify-password answers 404 to a signed-in person, right password or wrong", async () => {
    const email = someone();
    await account(email);
    const cookie = cookieOf(await signIn(email, PASSWORD, {}, "198.51.100.97"));
    for (const password of [PASSWORD, "not the password at all"]) {
      const res = await it_.app.inject({
        method: "POST",
        url: "/api/auth/verify-password",
        headers: { ...FROM_APP, cookie },
        payload: { password },
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it.each([
    ["GET", "/api/auth/callback/google?code=x&state=y"],
    ["POST", "/api/auth/callback/google"],
    ["GET", "/api/auth/callback/google/"],
    ["GET", "/api/auth//callback/google"],
    ["GET", "/api/auth/%63allback/google"],
    ["GET", "/api/auth/callback"],
  ] as const)("social sign-in's callback, %s %s, answers our 404", async (method, url) => {
    const res = await it_.app.inject({ method, url, headers: FROM_APP, ...(method === "POST" ? { payload: {} } : {}) });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
