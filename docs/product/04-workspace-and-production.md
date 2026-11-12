# Pageinator product specification — The workspace shell (all signed-in screens except the editor)

Part of the product specification ([index](README.md)). Examples are fictional.

## 6. The workspace shell (all signed-in screens except the editor)

### 6.1 Sidebar (left)

The sidebar is 240 px, collapsible to 56 px (Ctrl+\\).

| Region | Items |
|---|---|
| Top | Publication switcher: logo + name + ▾. The menu lists publications, then "All publications…" and "Add publication" (Owner/Admin) |
| Today | **Overview** |
| Production | **Editions** · **Stories** · **Media** · **Advertisements** · **Templates & styles** |
| Newsroom (later: G6) | News feed · Sources |
| Archive | **Archive** · E-paper (later: G4) |
| Publication | **Brand & masthead** · **Print profiles** · **Fonts** · **Team** · **Publication settings** · **Audit log** (Chief Editor: view only) |
| Administration (Owner/Admin) | **Organization** · **Billing** · **Storage** · **Audit log** |
| Bottom | Help & shortcuts · Collapse |

Items a role cannot use are **not shown** (§12). The current item is marked with `aria-current`.

### 6.2 Top bar

| Control | Icon | Does |
|---|---|---|
| Breadcrumbs | — | Organization › Publication › Edition › Section |
| Edition quick switch | ui.calendar | "Thu 12 Nov ▾": jump to another date's edition |
| Deadline clock | ui.clock | "Press deadline 23:30 · 2 h 14 m". Turns amber below 60 min and red below 15 min. Click opens the edition |
| Search / command | ui.search | "Search or run a command… Ctrl+K". Finds stories, pages, photos, ads, people, settings, and runs actions ("Generate page 3", "Export edition") |
| Notifications | ui.bell + count | Opens the drawer (§11) |
| Help | nav.help | Menu: Keyboard shortcuts (?) · Help centre · What's new · Report a problem · WhatsApp support |
| Language | ui.lang | EN / मराठी |
| Account | avatar | Menu: name and role · Account settings · Switch organization · Theme · Sign out |

### 6.3 Common screen patterns
- **Page header:** h1 + subtitle, primary action on the right, secondary actions in a ⋯ menu.
- **Library screens** (Stories, Media, Ads, Archive):
  - filter bar (search, chips, "More filters");
  - saved views;
  - table or grid toggle;
  - bulk-action bar when rows are selected;
  - a right-side preview drawer.
- **Empty states:** every list says what goes there and offers its one action ("No stories yet for 12 Nov. **New story** · Import files").


## 7. Production screens

### 7.1 Overview `…/overview` (home after sign-in)

| Region | Contents | Actions |
|---|---|---|
| Today card (large) | Edition name and date, status chip, deadline countdown, progress: page thumbnails (n of N approved), stories placed/selected, ads placed/booked, preflight state | **Open today's edition** (primary) · **Create edition** (if none) |
| Needs attention | Ordered list: "2 ads have no artwork (cut-off 18:00)", "Page 3: 7 lines over", "Preflight out of date", "Photo on P2 is 96 ppi", "Story waiting for your approval". Each item names the person responsible | Each item links to the exact place |
| My work | Items assigned to me (stories to edit, pages to design, approvals) | Open |
| Recent editions | Last 7 editions (thumbnail, date, status, printed ✓) | Open · Archive |
| Activity | Who did what, recently (filterable) | — |
| Storage and plan (Owner/Admin) | Used / quota, archive retention | Manage |

### 7.2 Editions `…/editions`
- **List:** a calendar strip (month view) plus a table.
  - Columns: Date · Zone · Pages · Status · Deadline · Preflight · Printed · Owner.
  - Filters: month, zone, status.
- **Primary action: Create edition** opens the dialog:

| Field | Default | Rule |
|---|---|---|
| Date | Next publishing day | One edition per date and zone; a duplicate offers "Open existing" |
| Zone (edition) | Main | From publication zones |
| Pages | Weekday default (e.g. 4) | Multiples allowed by press (2/4) |
| Template set | "Daily standard" | From templates |
| Language | Publication primary | — |
| Print profile | Default | — |
| Copy plan from | "Same weekday last week" / None | Copies flatplan (sections, ad positions, colour map) |

Buttons: **Create edition** · Cancel. On success the page plan opens.

### 7.3 Edition workspace

The edition workspace has these tabs: **Plan · Content · Generate · Pages · Preflight · Export · History**.

**Edition header** (on every tab):
- name ("Thursday 12 November 2026 · City · 4 pages");
- status chip, deadline clock;
- presence avatars;
- **Open editor** (primary);
- ⋯ menu: Edition settings · Duplicate edition · Delete draft (only before export; typed confirmation).

#### 7.3.1 Plan (flatplan) `…/plan`
- **Canvas:** page tiles at portrait proportion, paired as printed spreads (1 | 2–3 | 4…). Each tile shows:
  - page number;
  - section name;
  - **C** (colour) or **M** (mono) badge;
  - template name;
  - ad dummies drawn to scale with advertiser name and size ("Example Jewellers · 4 col × 120 mm · colour");
  - "News space 62%" (the newshole's share of the type area);
  - assigned designer avatar;
  - page status corner tab.

**Toolbar**

| Control | Icon | Does | Who |
|---|---|---|---|
| Pages − / + | `minus` / `plus` | Change page count (press multiples) | Editor+, Chief |
| Colour map | cmd.ink | Choose which pages print in colour (constrained by the print profile's colour capability) | Editor, Prepress |
| Add section break | — | Section from a page onward | Editor |
| Auto-place ads | ui.generate | Place unplaced bookings by their rules ("page 3 or later, bottom") | Advertising, Editor |
| Copy plan from… | ui.copy | From another edition | Editor |
| Print plan | `printer` | A4 PDF of the plan for the desk wall | All |
| Lock plan | ui.lock | Freezes ads and page count (needed before Generate) | Chief, Editor |

**Interactions**
- Drag tiles to reorder (front and back pages are pinned).
- Drag an ad from the "Unplaced ads" tray onto a page. It snaps to legal positions (named positions: full, half, quarter, strip, ear, masthead strip) or to columns × mm.
- A conflict shows a red outline with a reason.

**Right panel** (selected page):
- section;
- template;
- colour/mono;
- designer (assign);
- page deadline;
- "Must-run stories on this page" (pin stories);
- ads list with their booking rules;
- notes to the designer.

#### 7.3.2 Content `…/content` (the content desk)

The content desk has four sub-tabs: **Stories · Photos · Ads · Readiness**.

**Stories table**

| Column | Content |
|---|---|
| ☐ | Select |
| Priority | 1–5 (1 = lead); drag to rank |
| Headline / slug | Headline (or slug) and a status chip |
| Section | Section tag |
| Words | Count, plus "≈ 2 col × 118 mm" estimated by the **real engine** at house style |
| Photos | Count; ⚠ if a caption or credit is missing |
| Rights | Own · Licensed (PTI) · Official · Discovery only (not placeable) |
| Reporter | Byline person |
| Page | Placed on P3 / Not placed / Pinned to P1 |
| Status | Draft · Filed · Editing · Ready · Placed · Held · Spiked |
| Editing now | Avatar if someone has it open |
| Updated | Relative time |

- **Toolbar:** **New story** (primary) · Import · Paste from WhatsApp (keeps paragraphs, strips forwarding headers) · filters (Section, Status, Priority, Has photo, Language, Reporter, Rights) · search.
- **Import formats by milestone:**
  - Word (.docx) and plain text: M15a.
  - ZIP batches: after G3.
  - Legacy-font (Shree-Lipi and others) detection with conversion preview: after the P0-12 decision on building, buying or licensing a converter.
- **Bulk actions:** Set section · Set priority · Mark ready · Add to edition / Remove · Assign to… · Hold · Spike.
- **Row click** opens the **story drawer**: headline variants, deck, byline, dateline, first paragraphs, photos, notes, length meter, and **Open in story editor**.
- **Photos sub-tab:** a grid. Each thumbnail shows a megapixel badge ("good up to 4 columns at 150 ppi"), caption and credit status, the linked story, and colour space (RGB is converted for print automatically, with a note). Actions: Upload (dropzone, or camera on phone) · Link to story · Edit caption/credit · Set focal point · Replace · Delete.
- **Ads sub-tab:** today's bookings: advertiser · size · colour · position rule · page · artwork status · preflight result. Actions: Upload artwork · View report · Place on page · Mark "no artwork — run house ad".
- **Readiness sub-tab:** a checklist, blocking first:
  - ads without artwork;
  - stories without sections;
  - photos without credit;
  - fewer ready stories than space (an estimate from the engine: "need ≈ 14 more column-heights of text");
  - pages without a template.
  - CTA: **Go to Generate**.

#### 7.3.3 Generate `…/generate` (auto-layout)

**When it ships:** the Generate tab and **every auto-layout entry point** (editor split button, Alt+G, Page-menu items, right-click items) are **hidden until M18**, when inside-page generation is allowed after G3. Whole edition and front pages come after G6.
- The Python gen1 is not run inside the product (it is not one of the allowed sidecars). M18 ports it to TypeScript and drives it with product data instead of a model read from a printed PDF.

**Before**
- **Scope:** page thumbnails with checkboxes (default: all pages not locked or approved).
- **Content summary:** "38 stories ready · 41 photos · 9/9 ads placed · 4 pages".
- **Style choice:** **Balanced** (default) · **News-heavy** (more stories, smaller photos) · **Visual** (bigger photos) · **Lead-led** (big lead, fewer stories).
- **Options:**
  - Keep locked items (always on, shown);
  - Allow "continued on page N" (on/off);
  - Fill headlines to full width (on; the owner's rule);
  - Copyfit range (96–104%);
  - Lead story position (house side: right).
- Primary button: **Auto-layout 4 pages**.

**During**
- Step list with live status:
  1. Reading stories
  2. Reserving ads
  3. Measuring every story at every width
  4. Choosing page structures
  5. Setting type
  6. Checking fit and collisions
  7. Building pages
- Page tiles fill in as they finish.
- **Cancel** leaves current pages untouched.

**After**
- Per page card: thumbnail, "Fits · 0 lines over · 0 collisions · 6 stories · 5 photos", and alternatives **A · B · C** as small thumbnails with their differences named ("B: lead on the left", "C: lead 4 columns").
- Actions per page: **Use A/B/C** · Open in editor · Try another.
- Summary: placed 38/38 stories · overset 0 · photos missing 0 · warnings 2 (listed).
- Primary: **Accept and open editor**.
- **Nothing is applied until accepted.** Accepting creates one new revision, so it can be undone.

#### 7.3.4 Pages `…/pages`
A thumbnail board of all pages, large. Each shows status, who's editing, overset and preflight badges. Click opens the editor at that page. Bulk actions: Request review · Approve (Chief).

#### 7.3.5 Preflight `…/preflight` (§9.1) · Export `…/export` (§9.2) · History `…/history` (§9.3)

### 7.4 Stories library `…/stories`
- **Contents:** all stories across editions, same table as the content desk, plus columns: Edition · Language · Origin (Reporter / Wire / Import / Newsroom).
- **Saved views:** "My drafts", "Filed today", "Waiting for desk", "Held".
- **Actions:** New story · Import · Add to edition….

### 7.5 Story editor `…/stories/:storyId` (full screen; also opens as a docked panel inside the page editor)

| Region | Controls |
|---|---|
| Top bar | Back · story status chip · **Mark ready** (primary for reporters) / **Send back** (desk) · autosave state · presence · ⋯ (Duplicate, Translate copy, Version history, Delete) |
| Left (metadata) | Section · Priority · Slug · Language (मराठी/English/हिंदी) · Tags · Location (place picker) · Rights (Own / Licensed + source / Official / Discovery only) · Embargo until · Assigned to · Notes to desk |
| Centre (text) | **Kicker** · **Headline** (+ "Variants" list: add, choose active, AI suggestions) · **Deck** · **Byline** · **Dateline** · **Body** (paragraphs, crossheads, quotes, bullet lists, fact box) · **Photos** (attach, order, captions, credits) |
| Text toolbar | Paragraph type (Body · Crosshead · Quote · Bullet · Fact box) · Bold · Italic · Insert ▾ (। ॥ ₹ — – “ ” ‘ ’ ऽ ZWJ ZWNJ non-breaking space) · Language of selection · Find (Ctrl+F) · Spelling · Word count · Undo/Redo |
| Right (fit) | **How it fits:** choose width (1–8 columns) → "≈ 118 mm deep at 2 columns · 12/13 pt", measured live by the real engine. Target length (set by the page) → meter "Over by 34 words". **AI suggestions** (later: G5): Shorten to fit · Suggest headlines (only fitting ones shown, with line count) · Write deck · Translate. Always a diff: Accept / Reject |
| Bottom | Comments thread · Revision timeline |

### 7.6 Media `…/media`
- **Layout:** a grid or table of photos, graphics and logos.
- **Primary action:** **Upload** (dropzone and Browse…; camera on a phone).
- **Filters:** date, story, photographer, resolution ("too small for 3 columns"), missing caption or credit, rights.
- **Detail drawer:**
  - large preview;
  - focal point picker (click the face or subject);
  - caption, credit, photographer, date, place, rights;
  - technical facts: pixels, colour space, ICC, file size;
  - "Prints sharp up to 4 columns wide";
  - where used (pages);
  - Replace (keeps links) · Download original · Delete (blocked while placed).
- **The original is never altered.** Crops live in the layout.

### 7.7 Advertisements `…/ads` (the ads desk)

**Bookings tab**
- Table columns: Advertiser · Campaign · Run dates · Zones · Size (named, or columns × mm) · Colour · Position rule · Fixed? · Artwork · Status.
- **New booking** opens a form with those fields plus contract reference and notes.

**Artwork upload**
- Accepts PDF (preferred), TIFF, JPEG.
- **Checked on arrival:**
  - exact size ±0.5 mm;
  - fonts embedded;
  - colour (RGB is converted with a note);
  - ink total;
  - image resolution;
  - transparency.
- **Result card:**
  - green "Ready";
  - amber "Usable, with notes";
  - red "Problem: 2 mm too narrow", with an action: **Email/WhatsApp the advertiser** (pre-written message in Marathi or English).
- The original is kept.

**Calendar tab:** bookings by date and page.

**Missing artwork:** by the cut-off (profile setting, e.g. 18:00), Advertising and Editor are notified, and the plan shows a red ad dummy.

### 7.8 Templates & styles `…/templates`, `…/styles` (Page Designer, Chief Editor)

| Tab | Contents | Actions |
|---|---|---|
| Page templates | Cards: Front · Inside news · Back · Editorial · Sports · Classifieds. Each has a grid, regions (masthead/folio bar, rails, newshole, foot) and slots | New · Duplicate · **Edit in editor** (template mode) · Set default per section/weekday |
| Paragraph styles | Body, Body (no indent), Headline 1–8 col, Deck, Kicker, Byline, Dateline (run-in), Caption, Crosshead, Pull quote, Brief headline, Jump line, Folio, Fact box | Edit (dialog §8.8) · New · Duplicate · Delete (if unused) |
| Character styles | Bold, Italic, Dateline bold, Small caps (Latin), Highlight | Same |
| Object styles | Story separator rule (0.5 pt black), Reverse panel (red), Label tab, Tint panel, Photo frame, Ruled box | Same |
| Swatches | CMYK colours with names (House red 0/100/100/0, Rich black 60/40/40/100, 20% grey…) | Add (C, M, Y, K fields + tint), with an ink-total warning |
| Grids | 8 × 36.5 mm; 6 × 50.06 mm variants | Edit |
| House rules | Learned from past editions (headline size by width, spacing table, rule weights); editable and versioned | "Re-learn from more editions" |

**Versioning:** every change creates a new *profile version*. Editions in progress keep the version they started with until the user chooses **Update this edition to the new styles** (with a preview of reflow).
