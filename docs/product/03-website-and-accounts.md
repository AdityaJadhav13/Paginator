# Pageinator product specification — Public website

Part of the product specification ([index](README.md)). Examples are fictional.

## 4. Public website

The website **EXISTS** with 5 pages, light theme, serif editorial identity and claims governance.
- **The existing pages stay as they are** until a capability ships (doc 15 §14).
- Each claim below is added **only when it is true and sourced** in `content.ts`. Its source is shown with it: a gate record, a report section, or a measured number.
- Proposed claims that are not yet true ("laid out in minutes", "legacy fonts", "WhatsApp delivery", an editor screenshot) wait for the milestone that makes them true.

### 4.1 Header and footer (all public pages)

**Header**

| Control | Icon | Label | Does | Notes |
|---|---|---|---|---|
| Logo wordmark | — | "Pageinator" | Goes to `/` | Text wordmark until a logo exists |
| Nav links | — | Features · How it works · Marathi · Pricing · Security | Navigate | Collapses under ☰ on phones |
| Language | ui.lang | English / मराठी | Switches site language | Choice is remembered |
| Sign in | — | Sign in | `/login` | When signed out |
| Primary CTA | — | Book a demo | `/contact?intent=demo` | Becomes "Open workspace" when signed in |

**Footer:** product links, Legal (Privacy, Terms, Grievance officer, as required by DPDP), Status, Contact, "Made in India · Data stored in India" (once hosting is decided), and the copyright line.

### 4.2 Pages

| Page | Sections (in order) | Primary action |
|---|---|---|
| `/` Home | Hero ("Newspaper production for Marathi and English papers"); sourced proof facts as they become true (today: "28 of 28 held-out test pages laid out automatically and passed every automatic check" — EXP-GEN-1; "A test page was accepted and printed by a real press" — G2 record); the 7-stage workflow strip; editor screenshot (after M12); Marathi typography showcase (before/after); "Built for Indian newspapers" (Devanagari digits now; legacy fonts and WhatsApp delivery once built); security summary; closing CTA | Book a demo |
| `/features` | One block per stage: Plan · Content · Generate · Edit · Check · Print · Archive. Each block has "what it does" and "what's live today" | Book a demo |
| `/how-it-works` ★ | A night at a newspaper with Pageinator, step by step, with screenshots | Book a demo |
| `/marathi` ★ | Marathi typography: conjuncts, headline line-breaking rules, digits, legacy-font conversion. Written in Marathi with an English summary | Book a demo |
| `/pricing` | Plans once decided (OP09). Until then: "Pilot pricing by conversation" plus what each plan will include | Talk to us |
| `/security` | Tenancy, India data region, backups, archive immutability, AI data policy, current limits | — |
| `/contact` | Form: name, newspaper, city, phone/WhatsApp, email, message, intent (demo, pilot, press partner). Real submit (email to the team + CRM later), with confirmation copy | Send |
| `/about` ★ | Who builds it, the mission | — |
| `/legal/*` ★ | Privacy notice (DPDP), Terms, Grievance officer contact | — |


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
