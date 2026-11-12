// The ads cut-off (src/modules/ads/cutoff.ts, src/db/ad-cutoff.ts; packages/contracts/src/ads.ts "The cut-off") on a
// migrated clone: the settings routes and their permissions; the cut-off moment in the publication's timezone; and the
// missing-artwork alert: not before the cut-off, not after the date ended, once (two passes, or two at once), with
// nothing recorded while every ad is good (a later bad one told once), nobody to tell recorded with told 0, a
// wrong-size picture counted as missing, who is told, and a cut-off in the hour the clocks skip.
// Every person, organisation, advertiser and booking is fictional.
import type { AdSettings } from "@pageinator/contracts";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cutoffOf } from "../../src/db/ad-cutoff.ts";
import { alertDue } from "../../src/modules/ads/cutoff.ts";
import { type Transport, openMailer } from "../../src/modules/notifications/mailer.ts";
import { freshDatabase } from "./helpers.ts";
import { type IdentityApp, ORIGIN, type Sent, identityApp } from "./identity-app.ts";
import { type Org, type Person, newsroom } from "./newsroom.ts";

const db = await freshDatabase();
let it_: IdentityApp;
let su: Client;
const n = newsroom(
  () => it_,
  () => su,
);

let a: Org;
let ownerId: string;
let pub2: string;
const people: Record<string, Person> = {};
const P = (who: string) => people[who] as Person;
const sent: Sent[] = [];
const transport: Transport = { sendMail: async (message) => void sent.push(message), close: () => undefined };
const mailer = openMailer({ from: "desk@example.test" }, transport, () => undefined);
const silent = { warn: () => undefined } as never;
const pass = (now: string) =>
  alertDue(it_.database, silent, { identity: it_.database.identity, mailer, origin: ORIGIN }, new Date(now));

beforeAll(async () => {
  it_ = await identityApp(db);
  su = await db.connect("postgres");
  a = await n.organisation();
  ownerId = await n.userId(a.owner);
  pub2 = await n.addPublication(a, "Example Times (fictional)");
  const on = (pub: string, role: string) => [{ publicationId: pub, roles: [role], grants: [] }];
  for (const [who, pub, role] of [
    ["ads", a.pubId, "advertising"],
    ["chief", a.pubId, "chief_editor"],
    ["editor", a.pubId, "editor"],
    ["reporter", a.pubId, "reporter"],
    ["editor2", pub2, "editor"],
  ] as const) {
    people[who] = await n.member(a, on(pub, role), "member", who);
  }
}, 120_000);
afterAll(async () => {
  await mailer.close();
  await it_.close();
  await db.drop();
});

let counter = 0;
async function advertiser(name: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into app.advertiser (org_id, publication_id, name, created_by) values ($1, $2, $3, $4) returning id`,
    [a.orgId, a.pubId, name, ownerId],
  );
  return rows[0]?.id ?? "";
}
async function picture(widthPx: number, heightPx: number, status = "ready"): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into app.asset (org_id, publication_id, desk_key, sha256, bytes, mime, width_px, height_px, status,
       uploaded_by, problem)
     values ($1, $2, $3, $4, 1024, 'image/jpeg', $5, $6, $7, $8, $9) returning id`,
    [
      a.orgId,
      a.pubId,
      `p-${String(++counter).padStart(10, "0")}`,
      String(counter % 10).repeat(64),
      widthPx,
      heightPx,
      status,
      ownerId,
      status === "ready" ? null : "m.fictional",
    ],
  );
  return rows[0]?.id ?? "";
}
/** A booking of 100 × 80 mm on these dates. */
async function booking(by: string, dates: string[], asset: string | null = null, campaign = ""): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    `insert into app.ad_booking (org_id, publication_id, advertiser_id, campaign, w_mm, h_mm, colour, dates,
       artwork_asset_id, artwork_set_at, created_by)
     values ($1, $2, $3, $4, 100, 80, 'colour', $5::date[], $6, case when $6::uuid is null then null else now() end, $7)
     returning id`,
    [a.orgId, a.pubId, by, campaign, dates, asset, ownerId],
  );
  return rows[0]?.id ?? "";
}

async function alertOf(date: string, pub = a.pubId) {
  const { rows } = await su.query<{ bookings: string[]; told: number }>(
    "select bookings, told from app.ad_cutoff_alert where publication_id = $1 and edition_date = $2",
    [pub, date],
  );
  return rows;
}
/** Who holds an ad_artwork_missing notification of this date, by name. */
async function toldOf(date: string): Promise<string[]> {
  const { rows } = await su.query<{ user_id: string; data: { missing: number; publicationId: string } }>(
    "select user_id, data from app.notification where kind = 'ad_artwork_missing' and data->>'date' = $1",
    [date],
  );
  const names = Object.fromEntries([...Object.entries(people).map(([w, p]) => [p.id, w]), [ownerId, "owner"]]);
  return rows.map((row) => names[row.user_id] ?? row.user_id).sort();
}
const mailsOf = (date: string) => sent.filter((mail) => mail.subject.includes(date));

describe("the alert", () => {
  it("fires at the cut-off (not before), once, to Advertising, Editors, Chief Editors and the Owner", async () => {
    const by = await advertiser("Example Jewellers");
    await booking(by, ["2027-03-10"], null, "Gudi Padwa sale");
    // 18:00 IST on 9 March is 12:30 UTC
    await pass("2027-03-09T12:29:00Z");
    expect(await alertOf("2027-03-10")).toEqual([]);
    expect(await pass("2027-03-09T12:31:00Z")).toBeGreaterThanOrEqual(1);
    await pass("2027-03-09T13:00:00Z");
    await mailer.idle();
    const [alert] = await alertOf("2027-03-10");
    expect(alert?.bookings).toHaveLength(1);
    expect(alert?.told).toBe(4);
    expect(await toldOf("2027-03-10")).toEqual(["ads", "chief", "editor", "owner"]);
    const mails = mailsOf("2027-03-10");
    expect(mails.map((mail) => mail.to).sort()).toEqual(
      [P("ads").email, P("chief").email, P("editor").email, a.owner].sort(),
    );
    expect(mails[0]?.text).toContain("Example Jewellers (Gudi Padwa sale), 100 × 80 mm: no artwork yet");
    expect(mails[0]?.text).toContain(`/org/${a.orgId}/pub/${a.pubId}/ads?date=2027-03-10`);
    const { rows } = await su.query(
      `select actor_kind, publication_id, data from app.audit_event
       where action = 'ad_cutoff.alert' and data->>'date' = '2027-03-10'`,
    );
    // only an alert that names bookings is audited (not the other publication's empty date)
    expect(rows).toEqual([
      { actor_kind: "system", publication_id: a.pubId, data: expect.objectContaining({ told: 4 }) as unknown },
    ]);
  });

  it("fires once when two passes run at once", async () => {
    const by = await advertiser("Example Sweets");
    await booking(by, ["2027-04-10"]);
    await Promise.all([pass("2027-04-09T13:00:00Z"), pass("2027-04-09T13:00:00Z")]);
    await mailer.idle();
    expect(await alertOf("2027-04-10")).toHaveLength(1);
    expect(await toldOf("2027-04-10")).toEqual(["ads", "chief", "editor", "owner"]);
    expect(mailsOf("2027-04-10")).toHaveLength(4);
  });

  it("does not fire once the date has ended", async () => {
    const by = await advertiser("Example Motors");
    await booking(by, ["2027-05-01"]);
    await pass("2027-05-01T18:31:00Z"); // 00:01 IST on 2 May
    expect(await alertOf("2027-05-01")).toEqual([]);
    expect(await toldOf("2027-05-01")).toEqual([]);
  });

  it("records nothing while every ad is good: an ad made bad, or booked later without artwork, is told once", async () => {
    const by = await advertiser("Example Textiles");
    const good = await picture(1000, 800); // 100 × 80 mm at 254 ppi
    await booking(by, ["2027-06-10"], good);
    expect(await pass("2027-06-09T13:00:00Z")).toBe(0);
    expect(await alertOf("2027-06-10")).toEqual([]);
    // booked after the cut-off without artwork: the next pass tells, once
    const late = await booking(by, ["2027-06-10"], null, "Late artwork");
    expect(await pass("2027-06-09T14:00:00Z")).toBe(1);
    expect(await pass("2027-06-09T14:01:00Z")).toBe(0);
    await mailer.idle();
    expect(await alertOf("2027-06-10")).toEqual([{ bookings: [late], told: 4 }]);
    expect(await toldOf("2027-06-10")).toEqual(["ads", "chief", "editor", "owner"]);
    expect(mailsOf("2027-06-10")).toHaveLength(4);
    // a picture deleted later on a date not yet told is missing too
    const kept = await picture(1000, 800);
    await booking(by, ["2027-06-20"], kept);
    expect(await pass("2027-06-19T13:00:00Z")).toBe(0);
    await su.query("update app.asset set deleted_at = now() where id = $1", [kept]);
    expect(await pass("2027-06-19T13:01:00Z")).toBe(1);
    expect((await alertOf("2027-06-20"))[0]?.bookings).toHaveLength(1);

    const square = await booking(by, ["2027-07-10"], await picture(1000, 1000));
    const rejected = await booking(by, ["2027-07-10"], await picture(1000, 800, "rejected"));
    await booking(by, ["2027-07-10"], await picture(1000, 800));
    await pass("2027-07-09T13:00:00Z");
    await mailer.idle();
    expect((await alertOf("2027-07-10"))[0]?.bookings.sort()).toEqual([square, rejected].sort());
    const text = mailsOf("2027-07-10")[0]?.text ?? "";
    expect(text).toContain("does not fit the size or is not sharp enough");
    expect(text).toContain("its picture cannot be used");
    const { rows } = await su.query("select data from app.notification where data->>'date' = '2027-07-10' limit 1");
    expect(rows[0]?.data).toEqual({ publicationId: a.pubId, date: "2027-07-10", missing: 2 });
  });

  it("lists the notification with its date and count for the reader", async () => {
    const res = await n.call("GET", `/api/v1/orgs/${a.orgId}/notifications`, P("ads").cookie);
    expect(res.statusCode, res.body).toBe(200);
    const item = (res.json() as { items: { kind: string; ads: unknown; actor: unknown }[] }).items.find(
      (i) => i.kind === "ad_artwork_missing",
    );
    expect(item).toMatchObject({ ads: { date: "2027-07-10", missing: 2 }, actor: null });
  });
});

describe("an alert nobody can be told", () => {
  it("is recorded and audited with told 0", async () => {
    const c = await n.organisation();
    const owner = await n.userId(c.owner);
    await su.query("update app.person set status = 'removed', removed_at = now() where org_id = $1", [c.orgId]);
    const { rows } = await su.query<{ id: string }>(
      `insert into app.advertiser (org_id, publication_id, name, created_by) values ($1, $2, 'Example Bakers', $3)
       returning id`,
      [c.orgId, c.pubId, owner],
    );
    await su.query(
      `insert into app.ad_booking (org_id, publication_id, advertiser_id, w_mm, h_mm, colour, dates, created_by)
       values ($1, $2, $3, 100, 80, 'colour', '{2027-08-10}', $4)`,
      [c.orgId, c.pubId, rows[0]?.id, owner],
    );
    await pass("2027-08-09T13:00:00Z");
    expect(await alertOf("2027-08-10", c.pubId)).toEqual([{ bookings: [expect.any(String)], told: 0 }]);
    const audit = await su.query("select data from app.audit_event where action = 'ad_cutoff.alert' and org_id = $1", [
      c.orgId,
    ]);
    expect(audit.rows.map((row) => row.data)).toEqual([expect.objectContaining({ date: "2027-08-10", told: 0 })]);
  });
});

describe("the cut-off moment", () => {
  const at = (date: string) =>
    it_.database.withTenant({ orgId: a.orgId, userId: ownerId, pubIds: [a.pubId, pub2], requestId: "test" }, (tx) =>
      cutoffOf(tx, a.pubId, date),
    );

  it("is 18:00 the day before by default, in the publication's timezone, with daylight saving", async () => {
    expect((await at("2027-03-10")).at).toBe("2027-03-09T12:30:00.000Z");
    expect((await at("2027-03-10")).alertedAt).not.toBeNull();
    await su.query(
      `insert into app.ad_settings (org_id, publication_id, cutoff_time, days_before) values ($1, $2, '06:30', 2)`,
      [a.orgId, a.pubId],
    );
    await su.query("update app.publication set timezone = 'Europe/London' where id = $1", [a.pubId]);
    try {
      // London moves to summer time at 01:00 UTC on 28 March 2027
      expect((await at("2027-03-29")).at).toBe("2027-03-27T06:30:00.000Z");
      expect((await at("2027-03-30")).at).toBe("2027-03-28T05:30:00.000Z");
      expect((await at("2027-03-30")).alertedAt).toBeNull();
      // a time the clocks skip (01:30 on 28 March does not exist in London) is read in winter time: 01:30 UTC
      await su.query("update app.ad_settings set cutoff_time = '01:30', days_before = 0 where publication_id = $1", [
        a.pubId,
      ]);
      expect((await at("2027-03-28")).at).toBe("2027-03-28T01:30:00.000Z");
    } finally {
      await su.query("update app.publication set timezone = 'Asia/Kolkata' where id = $1", [a.pubId]);
      await su.query("delete from app.ad_settings where publication_id = $1", [a.pubId]);
    }
  });
});

describe("the settings routes", () => {
  const url = () => `/api/v1/orgs/${a.orgId}/pubs/${a.pubId}/ads/settings`;

  it("read with ads.view (the defaults first); a Reporter may not", async () => {
    const res = await n.call("GET", url(), P("editor").cookie);
    expect([res.statusCode, res.json()]).toEqual([200, { cutoffTime: "18:00", daysBefore: 1 }]);
    expect((await n.call("GET", url(), P("reporter").cookie)).statusCode).toBe(403);
  });

  it("are set by Advertising (ads.manage) or a Chief Editor (settings.edit), not an Editor; audited", async () => {
    const to: AdSettings = { cutoffTime: "17:30", daysBefore: 2 };
    expect((await n.change("PUT", url(), P("editor").cookie, to)).statusCode).toBe(403);
    expect((await n.change("PUT", url(), P("reporter").cookie, to)).statusCode).toBe(403);
    const res = await n.change("PUT", url(), P("ads").cookie, to);
    expect([res.statusCode, res.json()]).toEqual([200, to]);
    const back = await n.change("PUT", url(), P("chief").cookie, { cutoffTime: "18:00", daysBefore: 1 });
    expect(back.statusCode, back.body).toBe(200);
    const { rows } = await su.query(
      "select data from app.audit_event where action = 'ad_settings.set' and publication_id = $1 order by at",
      [a.pubId],
    );
    expect(rows.map((row) => row.data)).toEqual([
      { from: { cutoffTime: "18:00", daysBefore: 1 }, to },
      { from: to, to: { cutoffTime: "18:00", daysBefore: 1 } },
    ]);
  });

  it("refuse a time or a day count out of range", async () => {
    for (const body of [
      { cutoffTime: "24:00", daysBefore: 1 },
      { cutoffTime: "6:00", daysBefore: 1 },
      { cutoffTime: "18:00", daysBefore: 8 },
      { cutoffTime: "18:00" },
    ]) {
      expect((await n.change("PUT", url(), P("ads").cookie, body)).statusCode).toBe(400);
    }
  });
});
