// Request limits by person (src/http/rate-limit.ts; docs/product/10-l2-newsroom-plan.md §4.6) and the API's
// Cache-Control, on a migrated clone with small budgets: two people behind one address do not share a budget, a
// signed-out caller at that address has its own, a made-up session cookie counts against the address, and every
// /api/v1 and /api/auth answer says no-store. Every person is fictional.
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshDatabase } from "./helpers.ts";
import { FROM_APP, type IdentityApp, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);
let a: Org;
let one: Person;
let two: Person;

const PER_PERSON = 8;
const PER_ADDRESS = 3;
const NEWSROOM = "203.0.113.7"; // one shared address (TEST-NET-3)

beforeAll(async () => {
  it_ = await identityApp(db, {
    PGN_RATE_LIMIT_PER_PERSON_PER_MINUTE: String(PER_PERSON),
    PGN_RATE_LIMIT_PER_MINUTE: String(PER_ADDRESS),
    PGN_RATE_LIMIT_SIGNED_IN_PER_ADDRESS_PER_MINUTE: "100",
  });
  su = await db.connect("postgres");
  a = await n.organisation();
  const on = [{ publicationId: a.pubId, roles: ["reporter"], grants: [] }];
  one = await n.member(a, on, "member", "one");
  two = await n.member(a, on, "member", "two");
}, 120_000);
afterAll(async () => {
  await it_.close();
  await db.drop();
});

const me = (cookie: string, remoteAddress = NEWSROOM) =>
  it_.app.inject({ method: "GET", url: "/api/v1/me", headers: cookie ? { cookie } : {}, remoteAddress });

describe("request limits", () => {
  it("give each signed-in person their own budget, whatever address they share", async () => {
    const first = await me(one.cookie);
    expect(first.statusCode).toBe(200);
    const left = Number(first.headers["x-ratelimit-remaining"]);
    expect(left).toBeLessThan(PER_PERSON); // counted against the person (the accept counted too)
    for (let i = 0; i < left; i += 1) expect((await me(one.cookie)).statusCode).toBe(200);
    const over = await me(one.cookie);
    expect([over.statusCode, over.json().error.code]).toEqual([429, "slow_down"]);
    // the second person behind the same address is not affected, nor is the first one elsewhere a new budget
    expect((await me(two.cookie)).statusCode).toBe(200);
    expect((await me(one.cookie, "198.51.100.9")).statusCode).toBe(429);
  });

  it("keep a per-address budget for signed-out requests, and count a made-up session cookie there", async () => {
    const address = "203.0.113.8";
    const fake = "__Secure-pgn.session_token=made-up.cookie";
    const answers = [
      (await me("", address)).statusCode,
      (await me(fake, address)).statusCode,
      (await it_.app.inject({ method: "GET", url: "/api/v1/nowhere", remoteAddress: address })).statusCode,
      (await me("", address)).statusCode,
    ];
    expect(answers).toEqual([401, 401, 404, 429]);
    // a signed-in person at that address still has their own budget
    expect((await me(two.cookie, address)).statusCode).toBe(200);
  });
});

describe("the session check (get-session)", () => {
  it("is never refused for page loads behind one address, while a made-up cookie still counts there", async () => {
    const address = "203.0.113.10";
    const session = (cookie: string) =>
      it_.app.inject({ method: "GET", url: "/api/auth/get-session", headers: { cookie }, remoteAddress: address });
    // far more than the signed-out budget (PER_ADDRESS); the per-address ceiling (100 here) still holds
    for (let i = 0; i < 30; i += 1) expect((await session(i % 2 ? one.cookie : two.cookie)).statusCode).toBe(200);
    // and Better Auth keeps no count of it at all
    const counted = await su.query(`select key from identity."rateLimit" where key like $1`, [`${address}|%`]);
    expect(counted.rows).toEqual([]);
    const fake = "__Secure-pgn.session_token=made-up.cookie";
    const made = [];
    for (let i = 0; i < PER_ADDRESS + 1; i += 1) made.push((await session(fake)).statusCode);
    expect(made.at(-1)).toBe(429);
  });
});

describe("a made-up session cookie", () => {
  it("does not lift the signed-out limit for requests refused before the session is read", async () => {
    const address = "203.0.113.9";
    const fake = "__Secure-pgn.session_token=made-up.c2lnbmF0dXJlLW9mLW5vYm9keS1hdC1hbGwtMDEyMzQ1Njc4OT0%3D";
    const refused = async () =>
      (
        await it_.app.inject({
          method: "PATCH", // a route that exists, refused by the origin guard before the session is read
          url: "/api/v1/me",
          headers: { cookie: fake, "content-type": "application/json" }, // no X-Pageinator: refused at once
          payload: {},
          remoteAddress: address,
        })
      ).statusCode;
    const answers = [];
    for (let i = 0; i < PER_ADDRESS + 2; i += 1) answers.push(await refused());
    expect(answers).toEqual([...new Array(PER_ADDRESS).fill(403), 429, 429]);
  });
});

describe("Cache-Control", () => {
  it("is no-store on every /api/v1 and /api/auth answer, refusals and 404s included", async () => {
    const answers = [
      await me(two.cookie, "198.51.100.20"),
      await me("", "198.51.100.21"),
      await it_.app.inject({ method: "GET", url: "/api/v1/nowhere", remoteAddress: "198.51.100.22" }),
      await it_.app.inject({
        method: "GET",
        url: "/api/auth/get-session",
        headers: { cookie: two.cookie },
        remoteAddress: "198.51.100.23",
      }),
      await it_.app.inject({
        method: "POST",
        url: "/api/auth/sign-in/email",
        headers: FROM_APP,
        payload: { email: "nobody@example.test", password: "wrong password, fictional" },
        remoteAddress: "198.51.100.24",
      }),
    ];
    expect(answers.map((res) => [res.statusCode, res.headers["cache-control"]])).toEqual([
      [200, "no-store"],
      [401, "no-store"],
      [404, "no-store"],
      [200, "no-store"],
      [401, "no-store"],
    ]);
  });
});
