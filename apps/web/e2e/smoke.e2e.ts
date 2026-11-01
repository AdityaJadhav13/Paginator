// The L2.1 phone smoke (docs/product/10-l2-newsroom-plan.md §7.3; PR 26), on the stack of e2e/stack.ts, in two phones:
// the Owner (390 × 844) and a Reporter (360 × 800). The Owner confirms the address and chooses a password from the
// emails, turns on two-step sign-in, and signs in again with a code; invites the Reporter, who makes an account from
// the email; makes the edition on the Editions screen. The Reporter files a story with a photo (a real upload; the engine's queue converts it), and the Owner's
// list shows it without a reload; the Owner picks it up, comments and sends it back, which the Reporter sees live; the
// Reporter sends it again; the Owner puts it in the edition from the editor, marks it ready, and "Send to the Desk"
// on the Editions screen downloads a ZIP the Desk's own code opens and
// imports (apps/api/test/support/desk_roundtrip.py). Every person, story and picture is fictional; the photo is drawn
// by the browser.
import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, type Page, expect, test } from "@playwright/test";
import { EDITION_DATE, FAILED_MARK, MAILPIT, OWNER, REPO, REPORTER, WEB } from "./stack.ts";

// a failed run keeps the stack's logs (the teardown looks for this mark)
test.afterEach(({}, testInfo) => {
  const logs = process.env["PGN_E2E_LOGS"];
  if (logs && testInfo.status !== testInfo.expectedStatus) writeFileSync(join(logs, FAILED_MARK), testInfo.title);
});

const PASSWORD = "a fictional smoke password";
/** Prints a ZIP's names and its bundle.json (Python's own zipfile; the web app has no ZIP reader). */
const READ_ZIP =
  "import json, sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); " +
  "print(json.dumps({'names': z.namelist(), 'doc': json.loads(z.read('bundle.json'))}))";
type BundleDoc = {
  format: string;
  source: unknown;
  edition: unknown;
  stories: Record<string, unknown>[];
};
const DESK_PY = process.env["PAGEINATOR_DESK_PY"] ?? join(REPO, "experiments/phase0/pdfx1/.venv/bin/python");

/** The newest email to `to` whose subject matches, once it has arrived; its first link to the web app. */
async function emailLink(to: string, subject: RegExp): Promise<string> {
  let link = "";
  await expect(async () => {
    const found = (await (await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}`)).json()) as {
      messages: { ID: string; Subject: string }[];
    };
    const message = found.messages.find((m) => subject.test(m.Subject));
    expect(message, `an email to ${to} matching ${subject}`).toBeDefined();
    const full = (await (await fetch(`${MAILPIT}/message/${message?.ID}`)).json()) as { Text: string };
    link = new RegExp(`${WEB.replaceAll(".", "\\.")}/\\S+`).exec(full.Text)?.[0] ?? "";
    expect(link).not.toBe("");
  }).toPass({ timeout: 20_000 });
  return link;
}

/** RFC 6238 (SHA-1, 30 s, 6 digits): what an authenticator app shows for the base32 key. */
function totp(key: string, at = Date.now()): string {
  const bits = [...key.replace(/[\s=]/g, "").toUpperCase()]
    .map((c) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const secret = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", secret).update(counter).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A code from the next 30-second step, so it was never used before (a code works once). */
async function freshCode(key: string, used: Set<string>): Promise<string> {
  for (;;) {
    const code = totp(key);
    if (!used.has(code) && Date.now() % 30_000 < 25_000) {
      used.add(code);
      return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/** Errors the pages threw or logged, and server errors (5xx) they were answered, which fail the smoke at its end. */
const thrown: string[] = [];
/** Console errors that are expected. The browser logs every 4xx answer as "Failed to load resource"; the app asks
 * questions whose honest answer is 4xx (am I signed in?), and the smoke checks what the screens then say. */
const BENIGN = [/^Failed to load resource: the server responded with a status of 4\d\d/];

async function phone(browser: Browser, width: number, height: number): Promise<Page> {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on("pageerror", (error) => thrown.push(`${width}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !BENIGN.some((benign) => benign.test(message.text())))
      thrown.push(`${width}: console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) thrown.push(`${width}: ${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return page;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

/** A JPEG drawn by the browser (no picture file is committed). */
async function drawnPhoto(page: Page): Promise<Buffer> {
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const g = canvas.getContext("2d");
    if (!g) throw new Error("no canvas");
    g.fillStyle = "#2a6f97";
    g.fillRect(0, 0, 640, 480);
    g.fillStyle = "#f4a261";
    g.fillRect(120, 90, 400, 300);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("no JPEG");
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  return Buffer.from(bytes);
}

test("L2.1: two-step sign-in, a story with a photo, live updates, send back, ready, Send to the Desk", async ({
  browser,
}) => {
  const orgId = process.env["PGN_E2E_ORG"] ?? "";
  const pubId = process.env["PGN_E2E_PUB"] ?? "";
  const stories = `/org/${orgId}/pub/${pubId}/stories`;
  const desk = await phone(browser, 390, 844);
  const reporter = await phone(browser, 360, 800);

  // ── The Owner: confirm the address, choose a password, turn on two-step sign-in ──
  await desk.goto(await emailLink(OWNER.email, /confirm|पत्ता|address/i));
  await expect(desk.getByText("Your email address is confirmed")).toBeVisible();
  await desk.goto(await emailLink(OWNER.email, /password|पासवर्ड/i));
  await desk.getByLabel("New password", { exact: true }).fill(PASSWORD);
  await desk.getByLabel("Type the new password again", { exact: true }).fill(PASSWORD);
  await desk.getByRole("button", { name: "Set password" }).click();
  await expect(desk.getByText("Your new password is set")).toBeVisible();

  await signIn(desk, OWNER.email);
  await desk.goto("/account/security");
  await desk.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await desk.getByLabel("Your password", { exact: true }).fill(PASSWORD);
  await desk.getByRole("button", { name: "Continue" }).click();
  const keyLine = await desk.getByText(/type this key into the app/).textContent();
  const key = /: ([A-Z2-7 =]+)$/i.exec(keyLine?.trim() ?? "")?.[1] ?? "";
  expect(key).not.toBe("");
  const used = new Set<string>();
  await desk.getByLabel("Code from the app", { exact: true }).fill(await freshCode(key, used));
  await desk.getByRole("button", { name: "Turn on" }).click();
  await expect(desk.getByText("Your backup codes")).toBeVisible();

  // ── Sign out, and in again with the password and a code ──
  // For a few seconds after two-step is turned on, the session's own requests can answer 401 (11-fix-before-launch
  // L2-345), and a page opened then shows the sign-in form: wait until the session answers steadily
  await expect(async () => {
    for (let i = 0; i < 3; i++) expect((await desk.request.get(`/api/v1/orgs/${orgId}/members`)).status()).toBe(200);
  }).toPass({ timeout: 20_000 });
  await desk.goto("/login"); // signed in, it says so, with "Sign out"
  await expect(desk.getByText("You are signed in")).toBeVisible();
  await desk.getByRole("button", { name: "Sign out" }).click();
  await expect(desk).toHaveURL(/\/login|\/$/);
  await signIn(desk, OWNER.email);
  await expect(desk).toHaveURL(/\/mfa/);
  await desk.getByLabel("Code from the app", { exact: true }).fill(await freshCode(key, used));
  await desk.getByRole("button", { name: "Verify" }).click();
  await expect(desk).not.toHaveURL(/\/mfa|\/login/);

  // ── The Owner invites the Reporter ──
  await desk.goto(`/org/${orgId}/team`);
  await desk.getByRole("button", { name: "Invite someone" }).click();
  const dialog = desk.getByRole("dialog");
  await dialog.getByLabel("Email address", { exact: true }).fill(REPORTER.email);
  await dialog.getByLabel("Reporter", { exact: true }).check();
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(desk.getByText(`Invitation sent to ${REPORTER.email}.`)).toBeVisible();

  // ── The Reporter makes an account from the email ──
  await reporter.goto(await emailLink(REPORTER.email, /invit|आमंत्रण/i));
  await reporter.getByRole("button", { name: "Create an account" }).click();
  await reporter.getByLabel(/^Your name \(required\)/).fill(REPORTER.name);
  await reporter.getByLabel(/^Email address \(required\)/).fill(REPORTER.email);
  await reporter.getByLabel(/^Choose a password \(required\)/).fill(PASSWORD);
  await reporter.getByLabel(/^Type the password again \(required\)/).fill(PASSWORD);
  await reporter.getByRole("button", { name: "Create account" }).click();
  await expect(reporter.getByText(/We sent a link to/)).toBeVisible();
  await reporter.goto(await emailLink(REPORTER.email, /confirm|पत्ता|address/i));
  await expect(reporter.getByText("Your email address is confirmed")).toBeVisible();
  await reporter.getByRole("link", { name: "Continue" }).or(reporter.getByRole("button", { name: "Continue" })).click();
  await reporter.getByRole("button", { name: "Join Example Press Smoke" }).click();
  await expect(reporter.getByText("You have joined Example Press Smoke")).toBeVisible();

  // ── The Owner makes the edition (Editions → Create edition) ──
  await desk.goto(`/org/${orgId}/pub/${pubId}/editions`);
  await desk.getByLabel(/^Date/).fill(EDITION_DATE);
  await desk.getByLabel("Pages", { exact: true }).selectOption("8");
  await desk.getByRole("button", { name: "Create edition" }).click();
  await expect(desk.getByText(/The edition of .* is created\./)).toBeVisible();

  // ── The Owner's list is open while the Reporter writes ──
  await desk.goto(stories);
  await expect(desk.getByRole("heading", { level: 1 })).toBeVisible();

  // ── The Reporter files a story with a photo ──
  const headline = "Kalpanik Nagar's new footbridge opens";
  await reporter.goto(stories);
  await reporter.getByRole("link", { name: "New story" }).or(reporter.getByRole("button", { name: "New story" })).click();
  await reporter.getByLabel("Headline", { exact: true }).fill(headline);
  await reporter.getByLabel("Body text", { exact: true }).fill("The footbridge over the canal opened on Monday.\n\nIt took two years to build.");
  await expect(reporter.getByText("Saved", { exact: true })).toBeVisible();
  const photo = await drawnPhoto(reporter);
  await reporter.locator('input[type="file"]').last().setInputFiles({ name: "bridge.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(reporter.getByText("The photo is attached.")).toBeVisible({ timeout: 60_000 });
  // the engine's queue converts it (the real Python runner): the story's photo becomes ready, and the editor, which
  // said "Preparing the photo for print…", hears it live
  const api = `/api/v1/orgs/${orgId}/pubs/${pubId}`;
  const storyId = /stories\/([0-9a-f-]{36})/.exec(reporter.url())?.[1] ?? "";
  await expect(async () => {
    const story = (await (await reporter.request.get(`${api}/stories/${storyId}`)).json()) as {
      photo: { status: string } | null;
    };
    expect(story.photo?.status).toBe("ready");
  }).toPass({ timeout: 120_000 });
  await expect(reporter.getByText("Preparing the photo for print…")).toBeHidden();
  await expect(reporter.getByText("640 × 480 pixels", { exact: false })).toBeVisible();
  await reporter.getByRole("button", { name: "Send to the desk" }).click();
  await expect(reporter.getByText("The story is now: Filed.")).toBeVisible();

  // ── Live: the Owner's list says it has changed, without a reload, and shows the story ──
  await expect(desk.getByText("This list has changed since you opened it.")).toBeVisible({ timeout: 30_000 });
  await desk.getByRole("button", { name: "Show the changes" }).click();
  await expect(desk.getByText(headline)).toBeVisible();
  await desk.getByText(headline).click();
  await desk.getByRole("button", { name: "Pick up" }).click();
  await expect(desk.getByText("The story is now: Editing.")).toBeVisible();
  await desk.getByLabel("Write a comment", { exact: true }).fill("Please add who opened it.");
  await desk.getByRole("button", { name: "Post the comment" }).click();
  await expect(desk.getByText("Your comment is posted.")).toBeVisible();
  await desk.getByRole("button", { name: "Send back to the reporter" }).click();
  await desk.getByLabel("Why it goes back", { exact: true }).fill("Name who opened the bridge.");
  await desk.getByRole("dialog").getByRole("button", { name: "Send back to the reporter" }).click();
  await expect(desk.getByText("The story is now: Draft.")).toBeVisible();

  // ── Live: the Reporter, still on the story, sees the comment and the send-back ──
  await expect(reporter.getByText("Please add who opened it.")).toBeVisible({ timeout: 30_000 });
  await expect(reporter.getByText("Draft", { exact: true }).first()).toBeVisible();
  await reporter
    .getByLabel("Body text", { exact: true })
    .fill("The footbridge over the canal was opened on Monday by the ward officer.\n\nIt took two years to build.");
  await expect(reporter.getByText("Saved", { exact: true })).toBeVisible();
  await reporter.getByRole("button", { name: "Send to the desk" }).click();
  await expect(reporter.getByText("The story is now: Filed.")).toBeVisible();

  // ── The Owner puts it in the edition (the editor's Edition field) and marks it ready ──
  await desk.reload();
  await desk.getByRole("button", { name: "Pick up" }).click();
  await expect(desk.getByText("The story is now: Editing.")).toBeVisible();
  const edition = desk.getByLabel("Edition", { exact: true });
  const editionOption = await edition.locator("option", { hasText: "2026" }).getAttribute("value");
  await edition.selectOption(editionOption ?? "");
  await expect(desk.getByText("Saved", { exact: true })).toBeVisible();
  await desk.getByRole("button", { name: "Mark ready" }).click();
  await expect(desk.getByText("The story is now: Ready.")).toBeVisible();

  // ── Send to the Desk, from the Editions screen: the browser downloads the ZIP ──
  await desk.goto(`/org/${orgId}/pub/${pubId}/editions`);
  await expect(desk.getByText("Stories: 1 · Ready: 1 · Spiked: 0")).toBeVisible();
  const downloading = desk.waitForEvent("download");
  await desk.getByRole("button", { name: "Send to the Desk" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  await expect(desk.getByText("Stories downloaded: 1. Open the file in the Desk.")).toBeVisible();
  const zip = readFileSync((await download.path()) ?? "");

  // ── The ZIP against the Desk's own code ──
  expect(existsSync(DESK_PY), `the Desk's Python (PAGEINATOR_DESK_PY): ${DESK_PY}`).toBe(true);
  const folder = mkdtempSync(join(tmpdir(), "pgn-e2e-bundle-"));
  try {
    const file = join(folder, "bundle.zip");
    writeFileSync(file, zip);
    const desk_ = (...args: string[]) => {
      const run = spawnSync(DESK_PY, ["-B", join(REPO, "apps/api/test/support/desk_roundtrip.py"), ...args], {
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      });
      expect(run.status, run.stderr).toBe(0);
      return JSON.parse(run.stdout) as unknown;
    };
    expect(desk_("open", REPO, file)).toEqual({ ok: true, stories: 1 });
    // what is in it (CONTRACT.md §6): bundle.json and the one photo original, named by its SHA-256
    const sha256 = createHash("sha256").update(photo).digest("hex");
    const listed = spawnSync(DESK_PY, ["-I", "-c", READ_ZIP, file], { encoding: "utf8" });
    expect(listed.status, listed.stderr).toBe(0);
    const { names, doc } = JSON.parse(listed.stdout) as { names: string[]; doc: BundleDoc };
    expect(names.sort()).toEqual(["bundle.json", `photos/${sha256}.jpg`]);
    expect(doc.format).toBe("pageinator.story-bundle/1");
    expect(doc.source).toEqual({ organisation_id: orgId, publication_id: pubId });
    expect(doc.edition).toEqual({ date: EDITION_DATE, pages: 8 });
    expect(doc.stories).toHaveLength(1);
    const [sent] = doc.stories;
    expect(Object.keys(sent ?? {}).sort()).toEqual(
      ["body", "body_format", "byline", "deck", "headline", "id", "kicker", "language", "page", "photo", "priority",
        "revision", "section"].sort(),
    );
    expect(sent).toMatchObject({
      id: storyId,
      headline,
      body: "The footbridge over the canal was opened on Monday by the ward officer.\n\nIt took two years to build.",
      body_format: "desk-text/1",
      photo: { file: `photos/${sha256}.jpg`, sha256 },
    });
    const home = join(folder, "home");
    const imported = JSON.stringify(desk_("import", REPO, home, EDITION_DATE, "8", file));
    expect(imported).toContain(headline);
    expect(imported).toContain("ward officer");
    expect(imported).toContain('"width_px":640,"height_px":480');
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
  expect(thrown).toEqual([]);
});
