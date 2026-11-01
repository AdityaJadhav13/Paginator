# Pageinator product specification — Public website

Part of the product specification ([index](README.md)). Examples are fictional.

## 4. Public website

The website **EXISTS** with 5 pages (`/`, `/features`, `/pricing`, `/security`, `/contact`), in English and Marathi,
light theme, serif editorial identity and claims governance (built 2026-10-24, `apps/web/src/features/public`).
- **Claims rule.** Each claim below is added **only when it is true and sourced** in `content.ts`. A record is a `fact`, a
  `plan`, a `denial`, `copy` or the Marathi `specimen`; every fact and plan names its evidence (`evidence.ts`: a file
  in this repository and the exact words there), and `tests/ui005/claims.test.ts` reads every file back. A number in a
  fact must appear in its evidence, and the Marathi must say the same numbers. The claim vocabulary (press-ready,
  certified, AI-powered, seamless…) is refused everywhere except in a denial ("No certification…"). The page shows a
  fact's source with it (the proof facts' "Source" line).
- **Never claimed:** press-ready, PDF/X-valid or certified (ADR-022 needs a commercial preflight or a press proof
  first); a customer, logo, testimonial, price or invented number; the pilot newspaper's name ("a Marathi daily" at
  most); "Data stored in India" (hosting in India is said only as planned).
- Proposed claims that are not yet true ("laid out in minutes", "legacy fonts", "WhatsApp delivery", an editor
  screenshot) wait for the milestone that makes them true.
- **Languages.** Every public page is in English and Marathi: the header's English / मराठी switch chooses, the browser
  remembers it (`pageinator.language`), and the shell carries the page's `lang`. Devanagari is never under 13 CSS px.
  The Marathi is a first draft on the `REVIEW` list (`src/i18n/review.ts`) for the native editor (D-5).

### 4.1 Header and footer (all public pages)

**Header** (as built)

| Control | Label | Does | Notes |
|---|---|---|---|
| Logo wordmark | "Pageinator" | Goes to `/` | Text wordmark until a logo exists |
| Nav links | Features · Pricing · Security · Contact | Navigate | Collapses under ☰ on phones. "How it works" and "Marathi" come with their pages (doc 11, L2-232) |
| Language | English / मराठी | Switches the site's language | Remembered by the browser |
| Sign in | Sign in | `/login` | When signed out |
| Primary CTA | Book a demo | `/contact?intent=demo` | Only once the contact form is connected (see below). When signed in: the person's name, "Open workspace" and Sign out |

**Footer** (as built): the page links and Sign in; the notice; "Hosting in India is planned; no paper's data is hosted
yet."; the copyright line. **Not yet:** Legal (Privacy, Terms, Grievance officer, as required by DPDP), Status, and
"Made in India · Data stored in India" (once hosting is decided): no link to a page that does not exist (doc 11,
L2-230, L2-237).

### 4.2 Pages

| Page | Sections (in order) | Primary action |
|---|---|---|
| `/` Home | Hero ("Newspaper production, built first for Marathi papers": no English paper has been laid out yet; "a whole edition, with page designs and measures taken from the paper's own printed pages"; the page-structure diagram); proof facts, each with its source (a whole 4-, 8- or 16-page edition laid out automatically, Desk / doc 09 L1; "28 of 28 held-out test pages laid out automatically, and all 28 passed every automatic check", EXP-GEN-1, with "No editor has judged the layouts yet"; "A real newspaper press accepted and printed a test page made by Pageinator", EXP-PDF-1 / G2, with "It was a text-only page"; every page's print file checked by our own independent checker, doc 09 / ADR-022); the 7-stage workflow strip with each stage's state; "Built for Marathi newspapers" (conjuncts, Devanagari digits, headline rules, no AI on layout; a fictional Marathi story set by the browser in the system's Devanagari font); "What Pageinator will not be"; security and privacy summary; closing band | Book a demo |
| `/features` | One block per stage: Plan · Content · Generate · Edit · Check · Print · Archive, each with "what it does", "Today" (what's live) and its state; the newsroom app, "being prepared for a pilot"; the limits; closing band | Book a demo |
| `/how-it-works` ★ | A night at a newspaper with Pageinator, step by step, with screenshots | Book a demo |
| `/marathi` ★ | Marathi typography: conjuncts, headline line-breaking rules, digits, legacy-font conversion. Written in Marathi with an English summary | Book a demo |
| `/pricing` | Plans once decided (OP09). Until then: "Pilot pricing by conversation": "Pageinator is not for sale yet. Pricing for a pilot is agreed in conversation"; plans after the pilot; what a pilot would include; what is not on offer. No price, figure or tier | Talk to us about a pilot (`/contact?intent=pilot`) |
| `/security` | What is true today (tenancy walls, the audit log, two-step sign-in, hashed passwords, cookies, the Origin guard, the contact form keeps nothing); planned (hosting in India, backups and monitoring, an unalterable archive, the legal pages); not true today (denials); another paper's records stay invisible; how to report a problem (only while the contact form is connected) | Book a demo |
| `/contact` | The page asks `GET /api/v1/contact` first. Connected: "Messages sent here go by email to the people who build Pageinator", and the form: what you want (a demo, a pilot, a press partner, something else; preset by `?intent=`), name, newspaper, city, phone/WhatsApp, email, message, and the privacy line (emailed to the team and kept in their mailbox; the website keeps no copy; the server's log notes the connection's address). Not connected: "The contact form is not connected yet", and no form and no "Tell us about your paper" heading. `/security` says the form sends only when it is connected | Send |
| `/about` ★ | Who builds it, the mission | — |
| `/legal/*` ★ | Privacy notice (DPDP), Terms, Grievance officer contact | — |

**No call to action to a form that cannot send.** The site asks `GET /api/v1/contact` once per page load (the first
page that needs it asks; an unanswered question is asked again by the next one). Every "Book a demo" and "Talk to us
about a pilot" (header, hero, closing band, `/pricing`) appears only once the answer is "connected": while it is asked,
when the form is not connected, or when the API does not answer, there is none, and nothing takes its place.
"Open your workspace", for a signed-in person, does not depend on it.

**Workflow states today** (`workflow.ts`): Plan, Generate, Edit, Check and Print are "Working in the Desk"; Content is
"Working in the Desk" (typed, pasted, Word import) and "Built for the pilot" (filing from a phone in the newsroom app);
Archive is "Planned".

**The contact endpoints** (`apps/api/src/modules/contact/routes.ts`, contract `@pageinator/contracts`
`ContactRequest` and `ContactStatus`), public, no sign-in:
- `GET /api/v1/contact` answers `{connected}`: true only when `PGN_CONTACT_TO` is set; nothing else; no-store; counted
  in the signed-out per-address budget.
- `POST /api/v1/contact`, behind the Origin and `X-Pageinator` guard, body at most 16 KiB: fields checked with length
  limits and no control, bidirectional or byte-order characters; per address 5 an hour and 20 a day, and 200 a day in
  all (429 `contact_limit`), each read first and counted only once a message is sent or dropped (a message the mail
  server did not take costs nothing); then a trap field and a minimum fill time (dropped after a pause like a send's,
  with the same 200 answer; the web waits out the minimum itself); one plain-text email to `PGN_CONTACT_TO` from
  `PGN_MAIL_FROM`, Reply-To the sender's address when it is one, nothing typed in any other header; no storage; 503
  `contact_unavailable` while the address is unset, 503 `contact_send_failed` when the mail server refuses. The contact
  log lines name only the intent and the language; the request's own log line carries the client's address, as for
  every request.

## 5. Sign-in, accounts, onboarding

### 5.1 Auth screens

The auth screens are a centred card, 400 px wide, with the logo and a language toggle on top.

| Screen | Controls | Behaviour |
|---|---|---|
| **Sign in** `/login` | Email field · Password field (with show/hide eye) · "Keep me signed in" checkbox · **Sign in** (primary) · "Forgot password?" link · divider "or" · **Continue with Google** · **Continue with Microsoft** · "New newspaper? Request access" link | Errors: "Email or password is wrong" (generic, no account enumeration). After 5 failures: wait + CAPTCHA. Success goes to the last organization's Overview, or Choose organization |
| **Request access** `/signup` | Name, email, phone (WhatsApp), newspaper name, city, languages, page count, **Request access** | Pilot phase is invite-only: creates a lead, not an account. "We'll call you within a day." (Self-serve sign-up after G6) |
| **Verify email** `/verify` | 6-digit code field · Resend (after 60 s) · Change email | Required before joining any organization |
| **Forgot password** | Email · Send link | Always answers "If that email has an account, a link is on its way" |
| **Reset password** ★ | New password (strength meter, minimum 12 characters) · Confirm · **Set password** | Signs out all other sessions |
| **Accept invitation** ★ `/invite/:token` | Shows "Ravi Kulkarni invited you to The Sahyadri Daily as Page Designer" · Sign in or Create account · **Join** | Expired token: "Ask for a new invitation" |
| **Two-step verification** ★ `/mfa` | 6-digit TOTP field · "Use a recovery code" · Trust this device for 30 days | Required for Owner, Admin and Prepress if the org enables it |
| **Choose organization** ★ | List of organizations (logo, name, your role) · Search | Shown only when there is more than one |
| **Session expired** (dialog) | "You were signed out for security." · **Sign in again** (keeps unsaved editor work in the local outbox) | — |

### 5.2 Account `/account`

| Tab | Contents |
|---|---|
| Profile | Name, photo, phone, email (change with verification) |
| Language and region | Interface language (English / मराठी), date format, digits in the UI (Latin / Devanagari) |
| Appearance | Theme (System / Light / Dark), editor chrome (Dark / Light), reduce motion, UI density (Comfortable / Compact) |
| Security | Change password; two-step verification (set up with a QR code, show recovery codes); signed-in devices (device, browser, city, last active, **Sign out**) |
| Notifications | Matrix of events × channels (In app / Email / WhatsApp, later) — §11 |
| Keyboard | Shortcut list; layout hint for Marathi typing (InScript or Phonetic); later: customise |

### 5.3 Publication onboarding wizard `/onboarding`

The wizard has 8 steps and can be resumed. A draft workspace exists after step 1. Layout: stepper on the left, form centre, live preview right (a page preview built from the profile as you type).

**When it ships:** the wizard is the **self-serve** path (later: G6). For the pilot, the Pageinator team enters the same settings through the Publication settings screens (§13), using the house profile already measured.

**Step 2 timing:** "Learn from your past editions" productises the Python page-model and house-profile analysis (about 5.8k lines). It ships later, as a decision at G6: either a third Python sidecar, or a port.

| # | Step | Fields | Smart help |
|---|---|---|---|
| 1 | **Newspaper** | Newspaper name; company / legal name; city, district, state; frequency (Daily / Weekly / Bi-weekly / Other); primary language; other languages | — |
| 2 | **Learn from your past editions** (optional, recommended) | Upload 3–10 past edition PDFs (dropzone). Shows progress: "Reading pages… found 8 columns · 36.5 mm · body 12/13 pt · headline sizes by width…" | Productises `page_model` + `house_profile`. Results pre-fill steps 3–5. Files stay private to the org |
| 3 | **Page and grid** | Page size: presets (Pilot broadsheet 347 × 540, Indian broadsheet 381 × 578, Tabloid 289 × 380, Berliner 315 × 470, Custom); margins (top, bottom, inside, outside); columns (count, gutter); alternative grids (e.g. 6-column); baseline (body leading) | Live page preview with the grid |
| 4 | **Type** | Body, headline, deck, caption, byline and crosshead styles: font, size, leading, alignment, horizontal scale. Headline size by column span (table, or the formula "14 + 5 × columns") | Pre-filled from step 2 |
| 5 | **Fonts** | Upload house fonts (TTF/OTF) with a licence confirmation ("We have the right to use this font for print production and embedding"); otherwise "Use free stand-in fonts (Noto)". Shows each font's embedding permission (fsType) | Blocks fonts whose licence forbids PDF embedding |
| 6 | **Brand and masthead** | Masthead artwork (PDF/SVG/PNG ≥ 300 ppi); small logo for inside pages; colours (CMYK); folio style (date format, page-number style "पान ४") | Warns if artwork is below 300 ppi at its printed size |
| 7 | **Printing** | Press name and contact; PDF standard (PDF/X-1a:2003 recommended, X-1a:2001, X-4); colour profile (WAN-IFRA newspaper 26v5, or upload); ink limit (default 220%); minimum photo resolution (150 ppi warn, 100 block); colour pages per edition (e.g. pages 1 and 4); file naming; how files go to the press (Download, WhatsApp/email link, SFTP) | **Download a press test page** button: generates the EXP-PDF-1 style test page so the press can confirm before day one |
| 8 | **Sections, editions and deadlines** | Sections (name, colour tag, default pages); zones (e.g. City, Pune); page count by weekday; press deadline by weekday; first edition date | Then **Create my first edition** |

**Wizard controls:** Back · Save and continue later · Next (primary) · Skip (on optional steps). Validation is inline, per field.
