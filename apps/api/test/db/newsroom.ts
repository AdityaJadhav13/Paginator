// A fictional newsroom for the API's database tests: organisations made by bootstrap-org, and people invited into them
// with roles, through the API's own routes (as test/db/people.test.ts does). Every name is fictional and every address
// is at example.test.
import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { expect } from "vitest";
import { bootstrapOrg } from "../../src/modules/people/bootstrap.ts";
import { FROM_APP, type IdentityApp, lastLink } from "./identity-app.ts";

export const PASSWORD = "काल्पनिकनगर correct horse";

export type Org = { orgId: string; pubId: string; owner: string; ownerCookie: string };
export type Person = { email: string; id: string; cookie: string };
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** An answer of the app's inject(). */
export type Reply = Awaited<ReturnType<IdentityApp["app"]["inject"]>>;

export type Newsroom = {
  someone(who?: string): string;
  address(): string;
  cookieOf(res: { cookies: { name: string; value: string }[] }): string;
  signIn(email: string): Promise<string>;
  call(
    method: Method,
    url: string,
    cookie: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ): Promise<Reply>;
  change(method: Method, url: string, cookie: string, payload: unknown, key?: string): Promise<Reply>;
  userId(email: string): Promise<string>;
  organisation(): Promise<Org>;
  addPublication(org: Org, name: string): Promise<string>;
  member(org: Org, publications: unknown[], orgRole?: string, who?: string): Promise<Person>;
};

export function newsroom(it_: () => IdentityApp, su: () => Client): Newsroom {
  let counter = 0;
  let addresses = 0;
  const someone = (who = "person") => `${who}.${++counter}.${Date.now()}@example.test`;
  /** A new client address for each request, so the per-address limits never get in the way. */
  const address = () => `198.18.${Math.floor(++addresses / 250) % 250}.${(addresses % 250) + 1}`;
  const cookieOf = (res: { cookies: { name: string; value: string }[] }) =>
    res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  async function signIn(email: string): Promise<string> {
    const res = await it_().app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: FROM_APP,
      payload: { email, password: PASSWORD },
      remoteAddress: address(),
    });
    expect(res.statusCode, `signing in ${email}`).toBe(200);
    return cookieOf(res);
  }

  function call(
    method: Method,
    url: string,
    cookie: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<Reply> {
    const { "content-type": json, ...rest } = FROM_APP;
    const body = payload !== undefined || method === "POST" || method === "PUT" || method === "PATCH";
    return it_().app.inject({
      method,
      url,
      headers: { ...rest, ...(body ? { "content-type": json } : {}), ...(cookie ? { cookie } : {}), ...headers },
      ...(payload !== undefined
        ? { payload: payload as Record<string, unknown> }
        : method === "POST"
          ? { payload: {} }
          : {}),
      remoteAddress: address(),
    });
  }

  /** A create or a transition, with a new Idempotency-Key unless one is given. */
  const change = (method: Method, url: string, cookie: string, payload: unknown, key: string = randomUUID()) =>
    call(method, url, cookie, payload, { "idempotency-key": key });

  async function userId(email: string): Promise<string> {
    const { rows } = await su().query<{ id: string }>('select id from identity."user" where email = $1', [email]);
    return rows[0]?.id ?? "";
  }

  /** An organisation with one publication (Marathi and English) and its Owner signed in; no two-step rule. */
  async function organisation(): Promise<Org> {
    const owner = someone("owner");
    await it_().server.api.signUpEmail({ body: { name: "Owner (fictional)", email: owner, password: PASSWORD } });
    await it_().app.inject({ url: lastLink(it_().sent, owner), remoteAddress: address() });
    const n = ++counter;
    const made = await bootstrapOrg(it_().server, it_().database, {
      owner: { name: "Owner (fictional)", email: owner },
      organization: { name: `Kalpaniknagar Media ${n} (fictional)`, slug: `kalpaniknagar-${n}-${Date.now()}` },
      publication: {
        name: "काल्पनिकनगर वार्ता",
        slug: "kalpaniknagar-varta",
        languages: ["mr", "en"],
        primaryLanguage: "mr",
        digitStyle: "devanagari",
      },
    });
    await su().query("update app.org_settings set mfa_required_roles = '{}' where org_id = $1", [made.orgId]);
    return { orgId: made.orgId, pubId: made.publicationId, owner, ownerCookie: await signIn(owner) };
  }

  async function addPublication(org: Org, name: string): Promise<string> {
    const { rows } = await su().query<{ id: string }>(
      `insert into app.publication (org_id, name, slug, languages, primary_language, digit_style)
       values ($1, $2, $3, '{en}', 'en', 'latin') returning id`,
      [org.orgId, name, `pub-${++counter}`],
    );
    return rows[0]?.id ?? "";
  }

  /** Invited with these grants, signed up, verified and accepted: a signed-in member. */
  async function member(org: Org, publications: unknown[], orgRole = "member", who = "member"): Promise<Person> {
    const email = someone(who);
    const created = await call("POST", `/api/v1/orgs/${org.orgId}/invitations`, org.ownerCookie, {
      email,
      orgRole,
      publications,
    });
    expect(created.statusCode).toBe(201);
    const id: string = created.json().id;
    const signUp = await it_().app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { ...FROM_APP, "x-pageinator-invitation": id },
      payload: { name: `${who} (fictional)`, email, password: PASSWORD },
      remoteAddress: address(),
    });
    expect(signUp.statusCode).toBe(200);
    const verified = await it_().app.inject({ url: lastLink(it_().sent, email), remoteAddress: address() });
    const cookie = cookieOf(verified);
    expect((await call("POST", `/api/v1/invitations/${id}/accept`, cookie)).statusCode).toBe(200);
    return { email, id: await userId(email), cookie };
  }

  return { someone, address, cookieOf, signIn, call, change, userId, organisation, addPublication, member };
}
