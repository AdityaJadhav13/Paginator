// The local demo's content (docs/DEVELOPMENT.md "The local demo"): fills the running demo (demo.ts) through the same
// HTTP API the web app uses, so every screen has something to show. Everything is fictional: the stories are the test
// edition's samples (apps/api/src/modules/onboarding/sample-stories.ts), the photos and the ads' artwork are drawn here
// with Pillow (the worker venv's), the advertisers and the press are made up. Without --dataset the engine profile is
// learnt from the fictional paper's past editions (tools/onboard/fixtures/make_paper.py; the demo needs
// PGN_ONBOARD_PYTHON for that); with it, that dataset bundle is uploaded (a private one stays outside the repo).
//   node e2e/seed-demo.ts [--dataset <engine dataset zip>] [--totp-key <the key a first run printed>]
// with the demo's own PGN_E2E_PORT_BASE and PGN_E2E_WORKER_PY. Run again after a failure, it reuses what is there; once
// two-step sign-in is on, it needs --totp-key.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, openAsBlob, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { SAMPLE_STORIES_EN, SAMPLE_STORIES_MR, sampleStoriesFor } from "../../api/src/modules/onboarding/sample-stories.ts";
import { MAILPIT, OWNER, REPO, totp, WEB } from "./stack.ts";

const { values: args } = parseArgs({ options: { dataset: { type: "string" }, "totp-key": { type: "string" } } });
const PYTHON = process.env["PGN_E2E_WORKER_PY"] ?? "";
const OWNER_PASSWORD = "Demo-Owner-2026";
const REPORTER = { name: "Demo Reporter", email: "reporter@example.com", password: "Demo-Reporter-2026" };
const SECTIONS = ["मुख्य बातम्या", "शहर", "जिल्हा", "क्रीडा", "संपादकीय"];
const PLACES = ["नीलगाव", "केसरवाडी", "सुंदरपूर", "कल्पनानगर", "शांतिपूर", "रानवाडी"];
const PRESS = { pressName: "Kalpanik Press", contact: "Press desk, 020-0000-0000 (fictional)", note: "Night shift, plates by 23:30" };
const ADVERTISERS = [
  { name: "Kesar Sweets", contactName: "Asha Kulkarni", phone: "020-0000-0101", email: "ads@kesar.example" },
  { name: "Sundarpur Motors", contactName: "Ravi Patil", phone: "020-0000-0202", email: "ads@motors.example" },
  { name: "Saptarang Sarees", contactName: "Meena Joshi", phone: "020-0000-0303", email: "ads@saptarang.example" },
];
const PAGES = 8;
type Story = { id: string; revision: number; status: string; headline: string };
type Sections = { items: { id: string; name: string }[] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const say = (line: string) => console.log(`· ${line}`);

/** One signed-in person: a cookie jar over fetch, sending what the web app's client sends. */
class Person {
  private readonly cookies = new Map<string, string>();
  async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const response = await fetch(WEB + path, {
      method,
      redirect: "manual",
      headers: {
        Accept: "application/json",
        Origin: WEB,
        "X-Pageinator": "1",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(method === "GET" ? {} : { "Idempotency-Key": randomUUID() }),
        ...(this.cookies.size ? { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(";")[0] ?? "";
      const name = pair.slice(0, pair.indexOf("="));
      const value = pair.slice(pair.indexOf("=") + 1);
      if (value === "" || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    return response;
  }
  /** The answer's JSON; throws on anything but 2xx, or one of `allow` (then undefined). */
  async api<T>(method: string, path: string, body?: unknown, allow: number[] = []): Promise<T> {
    const response = await this.call(method, path, body);
    const text = await response.text();
    if (allow.includes(response.status)) return undefined as T;
    if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 600)}`);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

async function until<T>(what: string, get: () => Promise<T | undefined>, ms = 900_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await get();
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(2_000);
  }
}

/** The newest email to `to` whose subject matches: its first link to the web app. */
function mailLink(to: string, subject: RegExp): Promise<string> {
  return until(`an email to ${to}`, async () => {
    const found = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()) as {
      messages: { ID: string; Subject: string }[];
    };
    const message = found.messages.find((m) => subject.test(m.Subject));
    if (!message) return undefined;
    const full = (await (await fetch(`${MAILPIT}/message/${message.ID}`)).json()) as { Text: string };
    return new RegExp(`${WEB.replaceAll(".", "\\.")}/\\S+`).exec(full.Text)?.[0];
  }, 30_000);
}

/** A TOTP code of a 30-second step not used before (a code works once). */
const usedCodes = new Set<string>();
async function freshCode(key: string): Promise<string> {
  for (;;) {
    const code = totp(key);
    if (!usedCodes.has(code) && Date.now() % 30_000 < 25_000) {
      usedCodes.add(code);
      return code;
    }
    await sleep(1_000);
  }
}

/** Draws JPEGs with Pillow: photos (a made-up landscape) and ads (the advertiser's name on a colour). */
function draw(specs: Record<string, unknown>[]): void {
  const program = `
import json, random, sys
from PIL import Image, ImageDraw, ImageFont
def font_for(d, text, w, size):
    while size > 10 and d.textlength(text, font=ImageFont.load_default(size=size)) > w:
        size -= 2
    return ImageFont.load_default(size=size)
for s in json.loads(sys.argv[1]):
    w, h, rnd = s["w"], s["h"], random.Random(s["seed"])
    img = Image.new("RGB", (w, h)); d = ImageDraw.Draw(img)
    if s["kind"] == "photo":
        top, low = [rnd.randint(60, 140), rnd.randint(120, 200), 240], [250, rnd.randint(170, 230), rnd.randint(120, 200)]
        for y in range(h):
            d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * y / h) for a, b in zip(top, low)))
        x, y, r = rnd.randint(w // 5, 4 * w // 5), rnd.randint(h // 8, h // 3), h // 12
        d.ellipse([x - r, y - r, x + r, y + r], fill=(255, 220, 120))
        for k in range(3):
            base = h * (0.5 + 0.13 * k)
            hills = [(0, h)] + [(x, base - rnd.randint(0, h // 6)) for x in range(0, w + 160, 160)] + [(w, h)]
            d.polygon(hills, fill=(40 + 25 * k, 100 + 35 * k, 50 + 10 * k))
        for _ in range(rnd.randint(5, 10)):
            x, bw, bh, by = rnd.randint(0, w), rnd.randint(w // 30, w // 12), rnd.randint(h // 14, h // 6), int(h * 0.9)
            d.rectangle([x, by - bh, x + bw, by], fill=(rnd.randint(160, 235), rnd.randint(90, 170), rnd.randint(60, 120)))
            d.polygon([(x - bw // 6, by - bh), (x + bw // 2, by - bh - bw // 2), (x + bw + bw // 6, by - bh)], fill=(120, 40, 30))
    else:
        d.rectangle([0, 0, w, h], fill=tuple(s["colour"]))
        m = max(6, min(w, h) // 25)
        d.rectangle([m, m, w - m, h - m], outline=(255, 255, 255), width=max(3, m // 2))
        d.text((w / 2, h * 0.42), s["text"], font=font_for(d, s["text"], w * 0.85, h // 3), fill="white", anchor="mm")
        d.text((w / 2, h * 0.75), s["sub"], font=font_for(d, s["sub"], w * 0.85, h // 8), fill="white", anchor="mm")
    img.save(s["file"], quality=90, dpi=(300, 300))
`;
  execFileSync(PYTHON, ["-I", "-c", program, JSON.stringify(specs)], { stdio: "inherit" });
}

/** Sends a file to the store as the browser does (presign, POST the form, the file last); the upload's id. */
async function upload(who: Person, pub: string, purpose: string, file: string, type: string): Promise<string> {
  const blob = await openAsBlob(file, { type });
  const name = file.split("/").pop() ?? "file";
  const up = await who.api<{ uploadId: string; url: string; fields: Record<string, string> }>("POST", `${pub}/uploads`, {
    purpose,
    filename: name,
    contentType: type,
    bytes: blob.size,
  });
  const form = new FormData();
  for (const [key, value] of Object.entries(up.fields)) form.append(key, value);
  form.append("file", blob, name);
  const sent = await fetch(up.url, { method: "POST", body: form });
  if (!sent.ok) throw new Error(`the store refused ${name}: ${sent.status} ${await sent.text()}`);
  return up.uploadId;
}

/** A picture into the media library, waited for until the engine's queue has made it ready; its asset id. */
async function picture(who: Person, pub: string, file: string, caption: string): Promise<string> {
  const id = await upload(who, pub, "library", file, "image/jpeg");
  const { asset } = await who.api<{ asset: { id: string } }>("POST", `${pub}/uploads/${id}/complete`, {});
  const item = await until(`picture ${file}`, async () => {
    const got = await who.api<{ status: string; revision: number }>("GET", `${pub}/assets/${asset.id}`);
    if (got.status === "rejected" || got.status === "failed") throw new Error(`${file} was ${got.status}`);
    return got.status === "ready" ? got : undefined;
  });
  await who.api("PATCH", `${pub}/assets/${asset.id}`, { baseRevision: item.revision, caption, credit: "Kalpanik Varta" });
  return asset.id;
}

// ── The Owner: a password from the welcome email, then two-step sign-in (required of Owners) ──
if (!PYTHON) throw new Error("Set PGN_E2E_WORKER_PY to the engine worker's Python, as for the demo.");
const owner = new Person();
const welcome = /reset-password\/([^?\s]+)/.exec(await mailLink(OWNER.email, /password|पासवर्ड/i))?.[1] ?? "";
await owner.api("POST", "/api/auth/reset-password", { newPassword: OWNER_PASSWORD, token: welcome }, [400]); // used once
const signedIn = await owner.api<{ twoFactorRedirect?: boolean }>("POST", "/api/auth/sign-in/email", {
  email: OWNER.email,
  password: OWNER_PASSWORD,
});
let key = args["totp-key"]?.replace(/\s/g, "") ?? "";
if (signedIn.twoFactorRedirect) {
  if (!key) throw new Error("Two-step sign-in is on: pass --totp-key with the key the first run printed.");
  await owner.api("POST", "/api/auth/two-factor/verify-totp", { code: await freshCode(key), trustDevice: false });
} else {
  const on = await owner.api<{ totpURI: string }>("POST", "/api/auth/two-factor/enable", { password: OWNER_PASSWORD });
  key = new URL(on.totpURI).searchParams.get("secret") ?? "";
  await owner.api("POST", "/api/auth/two-factor/verify-totp", { code: await freshCode(key) });
  say(`two-step sign-in is on for ${OWNER.email}; its key: ${key}`);
}
const me = await owner.api<{ memberships: { org: { id: string; name: string }; publications: { id: string }[] }[] }>(
  "GET",
  "/api/v1/me",
);
const membership = me.memberships[0];
const orgId = membership?.org.id ?? "";
const pubId = membership?.publications[0]?.id ?? "";
const org = `/api/v1/orgs/${orgId}`;
const pub = `${org}/pubs/${pubId}`;

// ── The publication: sections, brand defaults, the print profile ──
const { timezone } = await owner.api<{ timezone: string }>("GET", `${pub}/settings`);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
let sections = (await owner.api<Sections>("GET", `${pub}/sections`)).items;
for (const name of SECTIONS.filter((name) => !sections.some((s) => s.name === name)))
  sections = (await owner.api<Sections>("POST", `${pub}/sections`, { name })).items;
const sectionIds = SECTIONS.map((name) => sections.find((s) => s.name === name)?.id ?? null);
const editions = (await owner.api<{ items: { id: string; date: string }[] }>("GET", `${pub}/editions`)).items;
type Brand = { defaults: { nextIssue: number | null } };
const brand = await owner.api<Brand>("PUT", `${pub}/brand`, {
  defaults: { volume: "7", price: "₹5", ...(editions.length === 0 ? { nextIssue: 245 } : {}) },
});
const profiles = await owner.api<{ items: { pressName: string }[] }>("GET", `${pub}/print-profiles`);
if (!profiles.items.some((p) => p.pressName === PRESS.pressName)) await owner.api("POST", `${pub}/print-profiles`, PRESS);
say(`sections, brand (volume 7, ₹5, next issue ${brand.defaults.nextIssue}) and the print profile are set`);

// ── The Reporter: invited, an account made from the email, the address confirmed, joined ──
const members = (await owner.api<{ items: { email: string }[] }>("GET", `${org}/members`)).items;
const reporter = new Person();
if (!members.some((m) => m.email === REPORTER.email)) {
  const pending = (await owner.api<{ items: { id: string; email: string; state: string }[] }>("GET", `${org}/invitations`))
    .items.find((i) => i.email === REPORTER.email && i.state === "pending");
  if (!pending)
    await owner.api("POST", `${org}/invitations`, {
      email: REPORTER.email,
      orgRole: "member",
      publications: [{ publicationId: pubId, roles: ["reporter"], grants: [] }],
    });
  const invitation = /\/invite\/([0-9a-f-]{36})/.exec(await mailLink(REPORTER.email, /invit|आमंत्रण/i))?.[1] ?? "";
  const signUp = await reporter.call(
    "POST",
    "/api/auth/sign-up/email",
    { ...REPORTER, callbackURL: `/invite/${invitation}` },
    { "X-Pageinator-Invitation": invitation },
  );
  if (signUp.ok) {
    const confirm = new URL(await mailLink(REPORTER.email, /confirm|पत्ता|address/i));
    await reporter.call("GET", confirm.pathname + confirm.search); // the address confirmed
  }
}
await reporter.api("POST", "/api/auth/sign-in/email", { email: REPORTER.email, password: REPORTER.password });
const invitations = await reporter.api<{ items: { id: string }[] }>("GET", "/api/v1/me/invitations");
for (const invitation of invitations.items) await reporter.api("POST", `/api/v1/invitations/${invitation.id}/accept`, {});
say(`${REPORTER.email} is a Reporter of the publication`);

// ── The engine profile: the dataset given, or learnt from the fictional paper's past editions ──
type Profiles = { items: { id: string; state: string }[]; inUse: string | null };
const work = mkdtempSync(join(tmpdir(), "pgn-seed-"));
try {
  const known = await owner.api<Profiles>("GET", `${pub}/engine-profiles`);
  if (!known.inUse && !known.items.some((p) => p.state === "setting_up")) {
    if (args.dataset) {
      say("uploading the engine dataset");
      const uploadId = await upload(owner, pub, "engine_dataset", args.dataset, "application/zip");
      await owner.api("POST", `${pub}/engine-profiles`, { uploadId });
    } else {
      say("learning the fictional paper's design from its past editions (make_paper.py, then onboarding)");
      const papers = join(work, "paper");
      execFileSync(PYTHON, [join(REPO, "tools/onboard/fixtures/make_paper.py"), "--paper", "mr", "--out", papers], {
        stdio: "ignore",
      });
      const pdfs = readdirSync(papers).filter((name) => name.endsWith(".pdf")).sort();
      const uploadIds: string[] = [];
      for (const name of pdfs) uploadIds.push(await upload(owner, pub, "onboard_pdf", join(papers, name), "application/pdf"));
      const started = await owner.api<{ id: string }>("POST", `${pub}/onboarding`, { uploadIds, permission: true });
      await until("the onboarding", async () => {
        const { current } = await owner.api<{ current: { state: string } | null }>("GET", `${pub}/onboarding`);
        if (current && ["rejected", "failed", "cancelled"].includes(current.state))
          throw new Error(`the onboarding ended ${current.state}: see the Engine profile screen`);
        return current?.state === "ready" ? true : undefined;
      });
      await owner.api("POST", `${pub}/onboarding/${started.id}/use`, {});
    }
  }
  await until("the engine profile", async () => {
    const now = await owner.api<Profiles>("GET", `${pub}/engine-profiles`);
    if (now.inUse) return true;
    if (now.items[0]?.state === "failed") throw new Error("the engine profile failed: see the Engine profile screen");
    return undefined;
  });
  say("the engine profile is ready");

  // ── Photos and the ads' artwork, drawn here ──
  const library = (await owner.api<{ items: { id: string; caption: string }[] }>("GET", `${pub}/media`)).items;
  const captions = PLACES.map((place) => `${place} परिसर (संगणकाने काढलेले चित्र)`);
  const missing = captions.filter((caption) => !library.some((item) => item.caption === caption));
  if (missing.length)
    draw(missing.map((_, i) => ({ kind: "photo", file: join(work, `photo-${i + 1}.jpg`), w: 2400, h: 1600, seed: i + 7 })));
  for (const [i, caption] of missing.entries()) await picture(owner, pub, join(work, `photo-${i + 1}.jpg`), caption);
  const photos = (await owner.api<{ items: { id: string; caption: string }[] }>("GET", `${pub}/media`)).items.filter((item) =>
    captions.includes(item.caption),
  );
  say(`${photos.length} photos are in the media library`);

  // ── Advertisers, and two bookings with artwork on the back page of both editions ──
  const advertisers = (await owner.api<{ items: { id: string; name: string }[] }>("GET", `${pub}/advertisers`)).items;
  for (const a of ADVERTISERS.filter((a) => !advertisers.some((b) => b.name === a.name)))
    advertisers.push(await owner.api<{ id: string; name: string }>("POST", `${pub}/advertisers`, a));
  const { slots } = await owner.api<{ slots: { slot: string; wMm: number; hMm: number }[] }>("GET", `${pub}/ads/sizes`);
  const bookings = (await owner.api<{ items: { advertiser: { name: string } }[] }>("GET", `${pub}/bookings`)).items;
  const colours = [[176, 38, 46], [24, 84, 140]];
  for (const [i, slot] of slots.slice(0, 2).entries()) {
    const advertiser = advertisers.find((a) => a.name === ADVERTISERS[i]?.name);
    if (!advertiser || bookings.some((b) => b.advertiser.name === advertiser.name)) continue;
    const file = join(work, `ad-${i + 1}.jpg`);
    const px = (mm: number) => Math.round((mm / 25.4) * 300);
    const sub = i === 0 ? "Diwali sweets · Station Road, Nilgaon" : "New scooters · easy EMI · Sundarpur";
    draw([{ kind: "ad", file, w: px(slot.wMm), h: px(slot.hMm), seed: i, colour: colours[i], text: advertiser.name, sub }]);
    const artwork = await picture(owner, pub, file, `${advertiser.name} advertisement`);
    const booking = await owner.api<{ id: string }>("POST", `${pub}/bookings`, {
      advertiserId: advertiser.id,
      campaign: i === 0 ? "Festival week" : "Scooter launch",
      wMm: slot.wMm,
      hMm: slot.hMm,
      colour: "colour",
      slot: slot.slot,
      dates: [today, tomorrow],
    });
    await owner.api("PUT", `${pub}/bookings/${booking.id}/artwork`, { assetId: artwork });
  }
  say(`${advertisers.length} advertisers, ${Math.min(slots.length, 2)} back-page bookings with artwork`);

  // ── The news finder's suggested sources (no AI key: the drafting part stays off) ──
  await owner.api("POST", `${pub}/news/sources/suggested`, {});

  // ── The press test page, downloaded and recorded as accepted (needed when an edition prints a photo or an ad) ──
  let pressTested = true;
  const test = await owner.call("GET", `${pub}/print-profiles/press-test`, undefined, { Accept: "application/pdf" });
  const sha = test.headers.get("X-Pageinator-Sha256");
  await test.arrayBuffer();
  if (test.ok && sha) await owner.api("PUT", `${pub}/press-test`, { pageSha256: sha, acceptedOn: today, note: "Fictional demo press" });
  else {
    pressTested = false; // the fictional paper's size is not the press test page's: today's edition goes without pictures
    say(`no press test (${test.status}): today's edition is made without photos and ads`);
  }

  // ── Two editions: today's (to release) and tomorrow's (laid out, not released) ──
  // the issue is the brand's next one, as "Create edition" fills it in (making it moves the next one on)
  const edition = async (date: string, withPictures: boolean) => {
    const { defaults } = await owner.api<Brand>("GET", `${pub}/brand`);
    const made = await owner.call("POST", `${pub}/editions`, {
      date,
      pages: PAGES,
      backPageAds: withPictures,
      volume: "7",
      issue: String(defaults.nextIssue ?? 1),
      price: "₹5",
    });
    const answer = (await made.json()) as { id?: string; error?: { current?: { id: string } } };
    const id = answer.id ?? answer.error?.current?.id;
    if (!id) throw new Error(`the edition of ${date}: ${made.status} ${JSON.stringify(answer)}`);
    return id;
  };
  const todayId = await edition(today, pressTested);
  const tomorrowId = await edition(tomorrow, true);

  // ── Stories: the edition's Ready ones (enough for every page), a photo on the leads ──
  const storiesOf = async (filter: string, who = owner) =>
    (await who.api<{ items: Story[] }>("GET", `${pub}/stories?limit=100&${filter}`)).items;
  const move = async (who: Person, story: Story, ...to: string[]) => {
    for (const step of to)
      story = await who.api<Story>("POST", `${pub}/stories/${story.id}/transitions`, { to: step, baseRevision: story.revision });
    return story;
  };
  const fill = async (editionId: string, round: number, withPictures: boolean) => {
    const layout = await owner.api<{ readiness: { needs: { stories: number; briefs: number; words: number } } | null }>(
      "GET",
      `${pub}/editions/${editionId}/layout`,
    );
    const have = new Set((await storiesOf(`edition=${editionId}`)).map((s) => s.headline));
    const wanted = sampleStoriesFor("mr", layout.readiness?.needs ?? null);
    for (const [i, sample] of wanted.entries()) {
      // a repeated sample (and every story of the second edition) gets a place as its dateline: no two alike
      const headline =
        round > 0 || i >= SAMPLE_STORIES_MR.length ? `${PLACES[(i + round) % PLACES.length]}: ${sample.headline}` : sample.headline;
      if (have.has(headline)) continue;
      let story = await owner.api<Story>("POST", `${pub}/stories`, {
        headline,
        kicker: sample.kicker,
        byline: sample.byline || "प्रतिनिधी",
        body: sample.body,
        language: "mr",
        sectionId: sectionIds[i % sectionIds.length],
        priority: sample.priority,
        editionId,
      });
      const photo = photos[(i + round * 3) % photos.length];
      if (withPictures && i < 3 && photo)
        story = await owner.api<Story>("PUT", `${pub}/stories/${story.id}/photo`, {
          baseRevision: story.revision,
          assetId: photo.id,
          caption: photo.caption,
          credit: "Kalpanik Varta",
        });
      await move(owner, story, "filed", "ready");
    }
    return wanted.length;
  };
  const counts = [await fill(todayId, 0, pressTested), await fill(tomorrowId, 1, true)];
  say(`stories: ${counts[0]} Ready for ${today}, ${counts[1]} for ${tomorrow}`);

  // ── The Newsroom board: stories in other states, by the Reporter and the desk, in English and Marathi ──
  // (a Draft is its author's own: the Reporter's draft is seen by the Reporter only)
  const seen = [storiesOf("edition=none"), storiesOf("edition=none", reporter), storiesOf(`edition=${tomorrowId}`)];
  const board = new Set((await Promise.all(seen)).flat().map((s) => s.headline));
  const extra: [Person, (typeof SAMPLE_STORIES_EN)[number], string, string[], boolean][] = [
    [reporter, SAMPLE_STORIES_EN[0]!, "en", ["filed"], true],
    [reporter, SAMPLE_STORIES_EN[3]!, "en", ["filed"], false],
    [reporter, SAMPLE_STORIES_MR[5]!, "mr", [], false],
    [owner, SAMPLE_STORIES_EN[1]!, "en", ["filed", "editing"], true],
    [owner, SAMPLE_STORIES_MR[7]!, "mr", ["filed", "editing"], false],
    [owner, SAMPLE_STORIES_EN[2]!, "en", [], false],
    [owner, SAMPLE_STORIES_EN[4]!, "en", ["filed", "ready"], false],
  ];
  for (const [who, sample, language, to, inTomorrow] of extra) {
    // a dateline the editions never use, so it is not taken for one of their stories
    const headline = language === "mr" ? `चंद्रवाडी: ${sample.headline}` : sample.headline;
    if (board.has(headline)) continue;
    const story = await move(who, await who.api<Story>("POST", `${pub}/stories`, { headline, body: sample.body, language }), ...to);
    // not Ready, so tomorrow's layout leaves them out (its Readiness lists them)
    if (inTomorrow) await owner.api("PATCH", `${pub}/stories/${story.id}`, { baseRevision: story.revision, editionId: tomorrowId });
  }

  // ── Lay both editions out with the real engine ──
  type Run = { id: string; state: string; error: { text: string } | null; notPlaced: unknown[] };
  type Layout = { active: Run | null; board: Run | null };
  const runs = await Promise.all(
    [todayId, tomorrowId].map(async (editionId) => {
      const now = await owner.api<Layout>("GET", `${pub}/editions/${editionId}/layout`);
      if (now.board && !now.active) return now.board;
      await owner.api("POST", `${pub}/editions/${editionId}/plan/place`, {});
      const started = now.active ?? (await owner.api<Run>("POST", `${pub}/editions/${editionId}/runs`));
      say(`laying out the edition ${editionId}`);
      return until(`the layout of ${editionId}`, async () => {
        const run = await owner.api<Run>("GET", `${pub}/runs/${started.id}`);
        if (run.state === "failed" || run.state === "cancelled") throw new Error(`the layout ${run.state}: ${run.error?.text}`);
        return run.state === "done" ? run : undefined;
      }, 3_600_000);
    }),
  );
  say(`laid out (stories not placed: ${runs.map((run) => run.notPlaced.length).join(", ")})`);

  // ── Today's edition: every page approved, released, marked as sent ──
  type ReleaseView = {
    pages: { runId: string; page: number; rev: number; pdfSha256: string | null; approval: unknown }[];
    candidate: { files: { page: number; sha256: string }[] } | null;
    releases: { id: string; deliveries: unknown[] }[];
    preflight: { passed: boolean; items: { check: string; state: string; pages: number[] }[] };
  };
  const view = () => owner.api<ReleaseView>("GET", `${pub}/editions/${todayId}/release`);
  let release = (await view()).releases[0];
  if (!release) {
    for (const page of (await view()).pages.filter((p) => !p.approval && p.pdfSha256))
      await owner.api("POST", `${pub}/runs/${page.runId}/pages/${page.page}/approve`, { rev: page.rev, pdfSha256: page.pdfSha256 });
    const ready = await view();
    const failed = ready.preflight.items.filter((item) => item.state === "failed");
    if (!ready.candidate || failed.length) throw new Error(`today's edition cannot be released: ${JSON.stringify(failed)}`);
    release = await owner.api<{ id: string; deliveries: unknown[] }>("POST", `${pub}/editions/${todayId}/releases`, {
      files: ready.candidate.files.map(({ page, sha256 }) => ({ page, sha256 })),
      note: "Demo release",
    });
  }
  if (release.deliveries.length === 0)
    await owner.api("POST", `${pub}/releases/${release.id}/deliveries`, { note: "Sent to Kalpanik Press" });
  say(`today's edition (${today}) is released and marked as sent`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

// ── Fresh backup codes (each works once), then both sign out ──
const { backupCodes } = await owner.api<{ backupCodes: string[] }>("POST", "/api/auth/two-factor/generate-backup-codes", {
  password: OWNER_PASSWORD,
});
await owner.api("POST", "/api/auth/sign-out", {});
await reporter.api("POST", "/api/auth/sign-out", {});
console.log(`
The demo is seeded: ${WEB} (Mailpit: ${MAILPIT.replace(/\/api\/v1$/, "")})
  Owner     ${OWNER.email} / ${OWNER_PASSWORD}
            two-step key (type it into an authenticator app): ${key.replace(/(.{4})/g, "$1 ").trim()}
            backup codes (each works once): ${backupCodes.slice(0, 3).join("  ")}
  Reporter  ${REPORTER.email} / ${REPORTER.password}`);
