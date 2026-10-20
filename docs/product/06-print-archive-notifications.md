# Pageinator product specification — Checking, printing and releasing

Part of the product specification ([index](README.md)). Examples are fictional.

## 9. Checking, printing and releasing

### 9.1 Preflight `…/preflight`

Preflight is the edition tab; the editor's Preflight panel shows the same results for one page.

**Header line:**
```
4/4 pages · Fonts ✓ · Images ⚠ 2 · Colour ✓ · Layout ✗ 1 · Ads ✓ · Print ✓ · Blocking: 1
Checked revision 184 at 22:14 — 2 edits since. [Re-check]   →  READY FOR PRINT only when Blocking = 0 and the check is current
```

**Controls**
- **Primary action:** **Re-check** while the check is out of date or failing. Once it is current with no blocking issues, **Go to export**.
- Filter (page, category, severity).
- **Download report** (PDF or CSV).
- Show: errors only / all.

**Each issue row**
- Page thumbnail mini, rule name, message, object.
- **Show**: opens the editor with the object selected and zoomed.
- **Fix**: when automatic (e.g. "Make it fit", "Convert to CMYK — happens at export (no action needed)").
- **Override**: warnings only. Opens a dialog requiring a reason; the override is written to the audit log.

**Errors can never be overridden.**

**The rules** (user wording; ID; severity; what we check):

| Category | ID | Rule (as the user reads it) | Severity |
|---|---|---|---|
| Text | TXT001 | Text doesn't fit (overset) | Error |
| Text | TXT002 | Story selected for this page but not placed | Warning |
| Text | TXT003 | Text smaller than 6 pt | Warning |
| Text | TXT004 | Single line stranded at a column top or bottom | Warning |
| Text | TXT005 | More than 3 hyphenated lines in a row (English) | Warning |
| Text | TXT007 | A character the font doesn't have | Error |
| Text | TXT008 | Placeholder text left on the page | Error |
| Text | TXT009 | Lines of text touch each other's ink (outline check; proven in EXP-GEN-1) | Error for headlines and decks; Warning for body |
| Text | TXT010 | Text lost or duplicated against the stories (character accounting; proven in EXP-GEN-1) | Error |
| Fonts | FNT001 | Font not embedded | Error |
| Fonts | FNT002 | Font licence forbids embedding | Error |
| Colour | COL001 | RGB element (images are converted at export; vectors must be CMYK) | Error for vectors / Info for photos |
| Colour | COL002 | Ink above the press limit (220%) | Error |
| Colour | COL003 | Colour on a black-and-white page | Error |
| Colour | COL004 | Unexpected spot colour | Error |
| Colour | COL005 | Black text not overprinting | Warning (auto-fixed at export) |
| Images | IMG001 | Photo resolution below 150 ppi (warning) or 100 ppi (error) at its printed size | Warning / Error |
| Images | IMG002 | Photo file missing | Error |
| Images | IMG003 | Photo without credit | Warning (house setting can make it an Error) |
| Layout | GEO001 | Object crosses the page edge | Error |
| Layout | GEO002 | Modules overlap | Error |
| Layout | GEO003 | Empty frame left on the page | Warning |
| Layout | GEO004 | Page count differs from the plan or press | Error |
| Layout | GEO005 | Object hidden on screen (it will still print) | Warning |
| Ads | ADS001 | Booked ad not placed | Error |
| Ads | ADS002 | Ad placed at the wrong size | Error |
| Ads | ADS003 | Ad artwork missing | Error |
| Continuations | JMP001 | "Continued" line points to the wrong page | Error |
| Continuations | JMP002 | Story jumps more than once | Warning |
| Continuations | JMP003 | Story jumps backwards | Warning |
| Editorial | EDT001 | Page not approved (when the profile requires it) | Error |
| Editorial | EDT002 | Masthead date ≠ edition date | Error |
| Editorial | EDT003 | AI suggestion left undecided | Error |
| Editorial | EDT004 | Same headline twice in the edition | Warning |
| Editorial | EDT005 | Same photo twice in the edition | Warning |
| Rights | RGT001 | "Discovery-only" text placed (no right to publish) | Error |
| Print file | PDF001 | Exported file fails the PDF/X check (independent checker) | Error |

### 9.2 Export and press `…/export`

**Layout**
- Left: output presets.
- Centre: options and a file list.
- Right: delivery and receipts.

The editor's **Export…** (Ctrl+E) opens the same screen as a dialog, scoped to **This page** or **Whole edition** (a toggle at the top).

**Presets** (only built presets are shown)

| Preset | What you get | Options | Who | Ships |
|---|---|---|---|---|
| **Press master** (default) | One PDF/X file per page in the press profile's variant (X-1a:2003 for the pilot): CMYK, fonts embedded, black overprint, the press colour profile. Named from the profile template, e.g. `SAHYADRI_20261112_CITY_P01.pdf` | Pages: All / Range / **Changed since last delivery** · Marks: None (pilot) / Crop marks · Slug line: off · Output profile and limits shown read-only (link: "Edit print profile") | Prepress, Chief Editor, Owner/Admin | **[G3-min] M15a** |
| Press master, one file | The same pages as one PDF/X file | Same as above | Same | M15a |
| **Proof PDF** | One RGB PDF with a "PROOF — rev 184" watermark, for WhatsApp/email review | Pages · Comments shown / hidden · Quality: Screen (small) / Print (A3 laser) · Slug line: on | Everyone with edition access | **[G3-min] M15a** |
| Page images | One PNG or JPG per page | Format PNG/JPG · Resolution 72 / 150 / 300 ppi · Pages | Everyone | M15a |
| Story export | This edition's stories for the website, with photos | Format: JSON (schema `pageinator.story/1`: id, section, headline, deck, byline, dateline, body paragraphs, photos with caption and credit, language, rights) / HTML / Markdown · Include photos (resized JPG) | Editor+ | after G3 |
| **Edition package** | ZIP: press PDFs, proof, editable document, resolved pages, stories, photos, ads, profile, fonts manifest, preflight report, receipts, checksums | — | Owner/Admin, Prepress | after G4 (M19) |
| E-paper bundle | Page images, tiles and article regions | — | Editor+ | after G4 (M19) |
| PDF/X-4 variant | Shown only if the press profile asks for X-4 | — | — | when a press requires it |

**Gate before a press master is allowed** (otherwise the button is shown disabled with the reason):
- preflight passed **on this exact revision**;
- pages approved (if required);
- no undecided suggestions.

**Export flow**
1. Click **Export 4 pages**.
2. The job runs on the server against the exact revision. Per-page progress shows; the job continues if the window is closed.
3. Result: a file list with name, size, pages and **SHA-256** · Download all (ZIP) · individual Download · **Open in viewer** (renders the PDF).

**Send to press** (only built methods are shown)

| Method | Flow | Ships |
|---|---|---|
| **Download & send yourself** (default) | Download, send via your usual route; then **Mark as sent** (records time and file hashes) | **[G3-min] M15a** |
| **Share link** (WhatsApp/email) | Creates an expiring press link (`/press/:token`, 72 h, can be revoked) and a ready message in Marathi/English with a **Copy** button and **Open WhatsApp**. The press portal records when files are downloaded | M17 |
| Email | To the press contact from the profile, with the link | M17 |
| SFTP / hot folder | Uploads, verifies size and checksum, retries, then records a receipt | M17, only if the press has one |

**Receipts** (each delivery): time · files · hashes · method · who · **press confirmed** (the press clicks "Received OK" in the portal, or a staff member marks it).

**Late correction:** export only the changed pages as `_v2` and send them with "Replaces P3".

### 9.3 History and release `…/history`
- **Timeline:** created → plan locked → generated → revisions (filterable) → preflight runs → approvals → exports → deliveries → press confirmed → archived.
- **Release stepper:** Preparing → Checked → Approved → **Released** (files sealed in the archive) → Sent to press → Printed.
  - Internally this is the 8-state release machine:
    REQUESTED → SNAPSHOT_PINNED → RESOLVED → PDF_CREATED → VALIDATED → APPROVED → ARCHIVE_COMMITTED → RELEASED.
  - Delivery and printing are recorded afterwards, as observations.
  - **At G3 (M15a)** the whole path runs with a **minimal archive**: the press PDFs plus a manifest of SHA-256 hashes and revision ids, written before RELEASED. The full edition package comes after G4.
- **Approve release** (holders of `release.approve`, §2.3): shows the exact revision, preflight result, PDF digests and approver.
- **Corrections after printing:** "Correct and republish" creates a new revision, released as *Corrected*. The original stays intact and is marked "superseded by".

### 9.4 Press portal `/press/:token` (no sign-in)
- **Header:** the newspaper's name, the edition and the date.
- **File list:** each with a download, size and SHA-256 checksum.
- **Actions:**
  - **Download all**;
  - **Received OK** (records confirmation);
  - **Report a problem** (text + optional photo; notifies Prepress).
- Bilingual. Expires after the token's window; revocable.


## 10. Archive, e-paper, newsroom

### 10.1 Archive `…/archive`

The archive is staged:
- the minimal archive of released PDFs and their manifest arrives at G3 (M15a);
- the archive browser and full edition package come after G4 (M19, per the roadmap);
- paid retention tiers and full-text search come at G7.
- **Browse:** Year → Month → Day tree, plus a calendar grid with front-page thumbnails. Filters: zone, section.
- **Search:** date range · headline · reporter · section · page · keyword. Search runs over the **edited text**, not the PDF, so Marathi works. Later: full text and "every story about Pune Metro since June".
- **Edition view:** page thumbnails → page viewer (zoom) · story list.
- **Edition actions**:

| Action | What happens | Who |
|---|---|---|
| Download press PDFs | The exact bytes sent to press (checksums shown) | Archive viewers |
| Download proof | Proof PDF | Archive viewers |
| Open read-only | The editor in read-only mode | Archive viewers |
| Duplicate as new edition | New draft; re-composed with today's engine and styles, with a "what changed" list | Editor+ |
| Reprint | Re-sends the archived files with a new receipt; no re-generation | Reprint permission |
| Correct and republish | See §9.3 | Chief Editor |
| Legal hold | Prevents expiry or deletion | Owner/Admin |

- **Retention line:** "Kept until 12 Nov 2027 under your plan."

### 10.2 E-paper (later: G4; earlier only if the pilot makes it a purchase condition, per baseline doc 20 §D)
- **Publish screen:** choose a release → **Publish e-paper**. It builds page images and **article regions** from the layout (exact rectangles of each story module), and gives a public URL.
- **Reader (public, phone-first):**
  - date picker;
  - page strip;
  - pinch zoom;
  - tap a story to open a clean article view (headline, text, photos);
  - share an article as a link or as an image clip with the masthead;
  - section jump;
  - search;
  - Marathi/English UI.
- **Settings:** free / sign-in required / paid (later); show ads yes/no; home-page banner.

### 10.3 Newsroom feed and sources (later: G6)
- **Feed tabs:** For you · Local · Maharashtra · India · World · Politics · Business · Sports · Technology.
- **Cards:** event headline, place, age, source count, official sources, evidence level (HIGH/MEDIUM/LOW, with reasons).
- **Card actions:**
  - View sources;
  - **Add to edition** (placeable rights only);
  - **Create story from lead** (discovery-only);
  - Assign reporter;
  - Mute topic.
- **Sources screen:** connected sources (PTI/IANS by contract, PIB, government RSS, reporter email-in) with their rights class, status, last item and errors. **Add source.**


## 11. Notifications

**Delivery:** the bell drawer, toasts for events you caused, email, and (later) WhatsApp. Each user picks channels per event in Account.

| Event | To | Default channel |
|---|---|---|
| Story filed to the desk | Editors, Sub-editors | In app |
| Story sent back with a comment | Reporter | In app, email |
| You were @mentioned | Person | In app, email |
| Page ready for review | Chief Editor, Editor | In app |
| Page approved / changes requested | Page designer | In app |
| Auto-layout finished | Requester | Toast |
| Preflight failed on a page | Designer, Prepress | In app |
| Ad artwork missing at cut-off | Advertising, Editor | In app, email |
| Ad artwork failed its check | Advertising | In app |
| Deadline in 60 / 15 minutes | Everyone on the edition | In app |
| Export ready | Requester | Toast |
| Delivery failed / press confirmed | Prepress, Chief Editor | In app, email |
| Someone took over your page | Person | In app |
| New sign-in to your account | Person | Email |
| Archive expiry in 30 days | Owner/Admin | Email |
| Invitation accepted | Inviter | In app |
| Plan limit at 80% / 100% | Owner, billing delegate | Email |

The drawer has tabs (All · Mentions · Approvals · System) and offers mark as read, open, and notification settings.
