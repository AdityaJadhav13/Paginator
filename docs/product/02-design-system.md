# Pageinator product specification — Design system

Part of the product specification ([index](README.md)). Examples are fictional.

## 3. Design system

`packages/ui`: today's `apps/web/src/ui` (`frontend/src/ui` before M0), extended.

### 3.1 Principles
1. **Tells you what to do next.** Every screen answers this (OPC §58). Each screen has one primary action, top right.
2. **Facts, not scores.** "0 lines overset · 2 photos below 150 ppi", never a made-up "layout score 87%".
3. **Desktop density for professionals.** App screens have 40 px controls; the editor has 28–32 px controls with compact panels.
4. **Every state named.** Loading, empty, error, denied, offline, stale, saving. Never colour alone: icon + word + colour.
5. **Marathi-first typography.**
   - Devanagari UI text is never below 13 px; Latin is never below 12 px.
   - Line heights are generous: Devanagari ascenders and descenders need about 1.6×.

### 3.2 Themes
- **App:** the light theme, using the existing tokens.
- **Editor:** a dark chrome by default (like InDesign CS6). Light chrome is optional.
- Theme setting: System / Light / Dark, in Account.

**New editor tokens** (added to `tokens.css`, contrast-tested like the existing 24 pairs):

| Token | Dark | Light | Use |
|---|---|---|---|
| `--pg-ed-chrome` | #1E2228 | #F1F3F5 | Toolbars, menus |
| `--pg-ed-panel` | #252A31 | #FFFFFF | Docked panels |
| `--pg-ed-panel-border` | #3A414B | #D4D9DF | Panel dividers |
| `--pg-ed-text` | #E7EAEE | #17202A | Panel text |
| `--pg-ed-text-muted` | #9AA4B2 | #5B6573 | Labels |
| `--pg-ed-accent` | #4C8DFF | #1D4ED8 | Active tool, focus |
| `--pg-ed-pasteboard` | #3A3F47 | #D9DDE2 | Area around the page |
| `--pg-ed-page` | #FFFFFF | #FFFFFF | Paper |

**Canvas overlay colours** (same in both themes; each also has a pattern or shape cue):

| Token | Colour | Drawn as |
|---|---|---|
| `--pg-cv-margin` | #D946EF | Margin (type area) guide, 1 px |
| `--pg-cv-column` | #8B5CF6 | Column and gutter guides, 1 px |
| `--pg-cv-baseline` | #38BDF8 @ 35% | Baseline grid, 0.5 px |
| `--pg-cv-guide` | #06B6D4 | Ruler guides, 1 px |
| `--pg-cv-smart` | #F43F5E | Smart guides and distance labels |
| `--pg-cv-select` | #2563EB | Selection box and handles |
| `--pg-cv-thread` | #2563EB | Text-thread links, dashed |
| `--pg-cv-overset` | #DC2626 | Red "+" box at a frame's foot |
| `--pg-cv-locked` | #F59E0B | Lock badge |
| `--pg-cv-newshole` | #10B981 | Newshole outline, dashed (toggle) |
| `--pg-cv-fold` | #F97316 | Broadsheet fold line, long dash (toggle) |
| `--pg-cv-ad` | #94A3B8 | Ad dummy: 45° hatch plus a label |
| `--pg-cv-master` | #A78BFA | Template/master items: dotted outline |
| `--pg-cv-error` | #DC2626 | Preflight error pin |
| `--pg-cv-warning` | #D97706 | Preflight warning pin |
| `--pg-cv-presence` | per user | Another user's selection or cursor |

### 3.3 Typography of the interface
- **Families:**
  - `--pg-font-sans`: system-ui stack, then `"Nirmala UI"` (Windows), `"Kohinoor Devanagari"` (macOS), then a self-hosted, subset **Noto Sans Devanagari** (OFL) as the final fallback. This is the one exception to "OS fonts only", needed because Linux and many Android devices lack a good Devanagari UI face.
  - Mono (IDs, hashes): unchanged.
- **App type scale:** the existing 100–800 sizes.
- **Editor panels:**
  - labels 12 px (Latin) / 13 px (Devanagari);
  - values 13/14 px;
  - panel titles 13 px semibold;
  - menus 13 px;
  - status bar 12 px for Latin, 13 px for Devanagari.
- **Numbers:** in the UI, Latin digits by default. Page content uses the publication's **digit style** (Devanagari digits ०–९ for the pilot) in folios and dates.

### 3.4 Layout grid
- **App screens:** a left sidebar (240 px, or 56 px collapsed), a 56 px top bar, and content within a 1,440 px measure on a 12-column grid with 24 px gutters.
- **Breakpoints (new tokens):** phone < 768; tablet 768–1279; desktop ≥ 1280; wide ≥ 1600.
- **Editor:**
  - a 28 px menu bar plus a 40 px top bar;
  - a 48 px tool rail;
  - left dock 240 px (resizable 200–360) and right dock 300 px (resizable 260–440), both collapsible to icon strips;
  - a 24 px status bar. The canvas takes the rest.
- **Minimum editor viewport:** 1280 × 600. That fits a 1366 × 768 laptop, or 1080p at 150% scaling, in a browser tab. Below 1280 × 600 the docks collapse to icon strips; below 1024 wide the editor offers review mode.

### 3.5 Components to add to the kit
The kit **EXISTS** today: Button, IconButton, Field, TextInput, TextArea, Select, Checkbox, RadioGroup, Dialog, InlineMessage, StatusIndicator, ProgressIndicator and the layout primitives.

New components:

| Component | Used for | Accessibility pattern |
|---|---|---|
| Tabs | Edition tabs, inspector tabs | WAI-ARIA tabs, roving tabindex |
| Menu / MenuBar / ContextMenu | Editor menus, row actions, right-click | ARIA menu/menubar; shortcuts shown right-aligned |
| Popover | Colour pickers, comment threads | Focus trap, Esc closes |
| Tooltip | Icon buttons: name + shortcut ("Text frame (T)") | Shows after 500 ms; on focus too |
| Toast | "Exported 4 pages", "Saved version" | `role=status`; errors `role=alert`; 5 s, pause on hover |
| Combobox | Font, style, user pickers | ARIA combobox with listbox |
| NumberField (unit-aware) | x/y/w/h in mm, size in pt, columns | Accepts "120mm", "12pt", "3col", "=+5" (arithmetic); ↑↓ steps; Shift×10 |
| SegmentedControl | Align, view modes, units | Radio group |
| Switch | On/off settings | `role=switch` |
| Slider | Zoom, tint % | `role=slider` with a value text |
| Table (sortable, selectable) | Stories, media, ads, team, audit | Grid semantics, sticky header, column visibility |
| Badge / Chip | Status, counts, rights class | Text + icon |
| Avatar / AvatarStack | Presence, assignees | Name in title |
| Drawer (side sheet) | Story preview, notifications | Dialog semantics, non-modal option |
| FileDrop | Photo, ad and font uploads | Keyboard "Browse…" fallback; progress per file |
| DatePicker | Edition date, run dates | Devanagari/Latin digits per locale; week starts Monday |
| ColorSwatch / SwatchPicker | CMYK swatches, tints | Shows CMYK numbers, not just colour |
| Thumbnail / ThumbnailGrid | Pages, photos | Labelled "Page 3 — City — In layout" |
| TreeList | Layers, archive year → month → day | ARIA tree |
| Splitter | Resizable docks | Keyboard resizable |
| Kbd | Shortcut display | — |
| CommandPalette | Ctrl+K anywhere | Combobox over actions and pages |
| Skeleton | Loading placeholders | `aria-busy` |
| EmptyState | First-use screens | Heading, sentence, one action |
| Stepper | Onboarding, release progress | `aria-current="step"` |
| DiffView | AI suggestions, version compare | Insertions and deletions marked with text, not colour only |
| Meter | Fit meter ("Over by 7 lines") | `role=meter` |

### 3.6 Icon catalogue (`packages/icons`)
- Every icon is 24 px on a 2 px-stroke grid, rendered at 16/20/24 px, with `aria-hidden`. The label always comes from the button.
- Lucide names are checked when the icons are copied at a pinned version. Custom icons are drawn in Lucide's style.

**App navigation and general**

| ID | Lucide | Where |
|---|---|---|
| nav.overview | `house` | Sidebar: Overview |
| nav.editions | `newspaper` | Editions |
| nav.stories | `file-text` | Stories |
| nav.media | `images` | Media |
| nav.ads | `megaphone` | Advertisements |
| nav.templates | `layout-template` | Templates and styles |
| nav.feed | `rss` | News feed |
| nav.sources | `radio-tower` | Sources |
| nav.archive | `archive` | Archive |
| nav.epaper | `book-open` | E-paper |
| nav.brand | `palette` | Brand and masthead |
| nav.print | `printer` | Print profiles |
| nav.fonts | `type` | Fonts |
| nav.team | `users` | Team |
| nav.org | `building-2` | Organization |
| nav.billing | `credit-card` | Billing |
| nav.storage | `hard-drive` | Storage |
| nav.audit | `scroll-text` | Audit log |
| nav.help | `life-buoy` | Help |
| ui.search | `search` | Search, command palette |
| ui.bell | `bell` | Notifications |
| ui.user | `circle-user-round` | Account menu |
| ui.lang | `languages` | Language toggle |
| ui.collapse | `panel-left-close` | Collapse sidebar |
| ui.expand | `panel-left-open` | Expand sidebar |
| ui.add | `plus` | Create |
| ui.remove | `minus` | Fewer (page count −) |
| ui.menu | `menu` | Collapsed navigation (☰) |
| ui.settings | `settings` | Settings |
| ui.grip | `grip-vertical` | Drag handle (reorder rows, tiles) |
| ui.camera | `camera` | Take photo (phone) |
| ui.place | `map-pin` | Location / dateline place |
| ui.google / ui.microsoft | Official brand marks, used per Google's and Microsoft's sign-in guidelines | Sign in with Google / Microsoft |
| ui.close | `x` | Close |
| ui.more | `ellipsis` | Row/overflow menu |
| ui.back | `arrow-left` | Back |
| ui.next | `chevron-right` | Next |
| ui.prev | `chevron-left` | Previous |
| ui.down | `chevron-down` | Dropdown |
| ui.check | `check` | Done |
| ui.edit | `pencil` | Edit |
| ui.delete | `trash-2` | Delete |
| ui.copy | `copy` | Copy |
| ui.download | `download` | Download |
| ui.upload | `upload` | Upload |
| ui.external | `external-link` | Open elsewhere |
| ui.filter | `list-filter` | Filter |
| ui.sort | `arrow-up-down` | Sort |
| ui.calendar | `calendar-days` | Date |
| ui.clock | `clock` | Deadline |
| ui.refresh | `refresh-cw` | Re-run |
| ui.info | `info` | Information |
| ui.ok | `circle-check` | Pass |
| ui.warn | `triangle-alert` | Warning |
| ui.error | `circle-x` | Error |
| ui.loading | `loader-circle` | Spinner |
| ui.offline | `wifi-off` | Offline |
| ui.cloud-ok | `cloud-check` | Saved |
| ui.cloud-sync | `cloud-upload` | Saving |
| ui.lock | `lock` | Locked |
| ui.unlock | `lock-open` | Unlocked |
| ui.eye | `eye` | Show |
| ui.eye-off | `eye-off` | Hide |
| ui.link | `link-2` | Link |
| ui.share | `share-2` | Share |
| ui.mail | `mail` | Email |
| ui.whatsapp | custom (chat bubble) | WhatsApp share |
| ui.phone | `smartphone` | Phone |
| ui.keyboard | `keyboard` | Shortcuts |
| ui.command | `command` | Command palette |
| ui.sun | `sun` | Light theme |
| ui.moon | `moon` | Dark theme |
| ui.history | `history` | Version history |
| ui.comment | `message-square` | Comments |
| ui.comment-add | `message-square-plus` | New comment |
| ui.ai | `sparkles` | AI suggestion (always labelled "Suggestion") |
| ui.generate | `wand-sparkles` | Auto-layout |
| ui.approve | `badge-check` | Approve |
| ui.request-changes | `corner-up-left` | Request changes (send back) |
| ui.send | `send` | Send to press |
| ui.receipt | `receipt` | Delivery receipt |
| ui.shield-ok | `shield-check` | Preflight passed |
| ui.shield-alert | `shield-alert` | Preflight issues |

**Editor tools**

| ID | Lucide / custom | Tool (shortcut) |
|---|---|---|
| tool.select | `mouse-pointer-2` | Select (V) |
| tool.direct | `square-dashed-mouse-pointer` | Direct select / content (A) |
| tool.module | custom "module" (frame with headline bar and 3 column strokes) | Story module (K) |
| tool.text | `type` | Text frame (T) |
| tool.image | `image-plus` | Image frame (F) |
| tool.rect | `square` | Box / panel (M) |
| tool.line | `slash` | Rule (\) |
| tool.thread | `link-2` | Thread text frames (L) |
| tool.comment | `message-square-plus` | Comment pin (N) |
| tool.eyedropper | `pipette` | Pick style (I) |
| tool.hand | `hand` | Hand (H, Space) |
| tool.zoom | `zoom-in` | Zoom (Z) |
| tool.region | custom (dashed rectangle with corner tag) | Region (R): template mode only |
| tool.slot | custom (module outline with a "+") | Story slot (S): template mode only |

**Editor commands**

| ID | Lucide / custom | Command |
|---|---|---|
| cmd.undo | `undo-2` | Undo |
| cmd.redo | `redo-2` | Redo |
| cmd.zoom-in | `zoom-in` | Zoom in |
| cmd.zoom-out | `zoom-out` | Zoom out |
| cmd.fit-page | `scan` | Fit page |
| cmd.fit-width | `move-horizontal` | Fit width |
| cmd.actual | custom "1:1" | Actual size |
| cmd.group | `group` | Make package |
| cmd.ungroup | `ungroup` | Break package |
| cmd.front | `bring-to-front` | Bring to front |
| cmd.back | `send-to-back` | Send to back |
| cmd.align-l | `align-start-vertical` | Align lefts |
| cmd.align-c | `align-center-vertical` | Align centres |
| cmd.align-r | `align-end-vertical` | Align rights |
| cmd.align-t | `align-start-horizontal` | Align tops |
| cmd.align-m | `align-center-horizontal` | Align middles |
| cmd.align-b | `align-end-horizontal` | Align bottoms |
| cmd.dist-h | `align-horizontal-space-around` | Distribute horizontally |
| cmd.dist-v | `align-vertical-space-around` | Distribute vertically |
| cmd.fit-content | custom | Fit content proportionally |
| cmd.fill-frame | custom | Fill frame proportionally |
| cmd.fit-frame | custom | Fit frame to content |
| cmd.center-content | custom | Centre content |
| cmd.rotate-cw | `rotate-cw` | Rotate 90° clockwise |
| cmd.rotate-ccw | `rotate-ccw` | Rotate 90° anticlockwise |
| cmd.crop | `crop` | Crop |
| cmd.focal | `crosshair` | Set focal point |
| cmd.replace-image | `image-up` | Replace image |
| cmd.make-fit | custom "fit" (text block with inward arrows) | Make it fit |
| cmd.try-another | `shuffle` | Try another layout |
| cmd.alternatives | `square-split-horizontal` | Compare alternatives |
| cmd.jump | custom "continued" (arrow to "P") | Continue on another page |
| cmd.place | `file-input` | Place story/photo |
| cmd.story-editor | `notebook-pen` | Story editor |
| cmd.text-wrap | custom | Text wrap |
| cmd.columns | `columns-3` | Columns |
| cmd.baseline | custom | Baseline grid |
| cmd.guides | custom | Guides |
| cmd.rulers | `ruler` | Rulers |
| cmd.snap | `magnet` | Snap |
| cmd.smart-guides | custom | Smart guides |
| cmd.preview | `eye` | Preview mode |
| cmd.proof | custom (newsprint) | Newsprint proof view |
| cmd.ink | `droplets` | Ink-coverage view |
| cmd.layers | `layers` | Layers |
| cmd.pages | `files` | Pages panel |
| cmd.styles | `pilcrow` | Styles |
| cmd.swatches | `swatch-book` | Swatches |
| cmd.inspector | `sliders-horizontal` | Properties |
| cmd.preflight | `shield-check` / `shield-alert` | Preflight |
| cmd.export | `download` | Export |
| cmd.page-plan | `layout-grid` | Page plan |
| cmd.fold | custom | Fold line |
| cmd.newshole | custom | Newshole |
| cmd.ad | custom (hatched rectangle) | Ad dummy |
| cmd.masthead | custom | Masthead |
| cmd.special-char | `omega` | Insert special character |
| cmd.find | `text-search` | Find / change |
| cmd.spell | `spell-check` | Spelling |
| cmd.language | `languages` | Text language |
| cmd.hyphenation | custom | Hyphenation |
| cmd.bold | `bold` | Bold |
| cmd.italic | `italic` | Italic |
| cmd.align-text | `align-left` / `align-center` / `align-right` / `align-justify` | Text alignment |

### 3.7 States and status vocabulary (domain, user-facing)

| Thing | States (in order) | Shown as |
|---|---|---|
| Edition | Planning → In production → Checking → Ready for print → Sent to press → Printed → Archived (+ Corrected) | Chip with icon; the Overview shows the current one big |
| Page | Planned → In layout → Ready for review → Changes requested → Approved → Sent | Coloured corner tab on thumbnails, plus words |
| Story | Draft → Filed → Editing → Ready → Placed (P3) → Published; Held; Spiked | Chip |
| Photo | Uploaded → Needs caption/credit → Ready → Placed | Chip + missing-field icons |
| Ad | Booked → Artwork missing → Artwork received → Checked ✓ / Problem → Placed → Published | Chip |
| Preflight | Not run → Running → Passed → Passed with warnings → Failed → Out of date (the edition changed after the check) | Shield icon + words |
| Save (editor) | Saving… → All changes saved (rev 184) → Offline: changes kept on this computer → Sync problem: retrying → Conflict: choose | Status bar + icon |
| Text fit | Fits · Over by N lines · Short by N lines · Not measured yet | Meter on story module and inspector |
| Release | Preparing → Checked → Approved → Sent to press → Archived | Stepper on the History tab. Internally this is the 8-state machine REQUESTED … RELEASED |

The existing UI001 `PresentationState` has 8 states: simulated, pending, saved-intention, recomposing, confirmed-proof, stale, failed, approved-candidate. "Simulated" is used only in the low-fidelity prototype. It stays as the per-edit indicator vocabulary in the editor:
- pending = "Saving…";
- recomposing = "Updating page…";
- stale = "Page changed — re-check".

### 3.8 Accessibility and input
- Keep everything UI001–UI005 established:
  - skip link;
  - one h1;
  - focus moves on navigation;
  - polite and assertive live regions;
  - forced colours and reduced motion;
  - 320 px reflow on non-editor screens;
  - axe with zero serious violations.
- **Canvas.** The page is mirrored as an accessible outline in the Layers panel: "Story: नदीकाठच्या गावात पूर — 1 column × 52 mm — fits". Every canvas action is reachable from the keyboard (Tab cycles objects; arrows nudge; Enter enters a package or text).
- **Indic input.** Text entry is always a real editable field (ProseMirror), never raw canvas key handling.
  - **IME matrix**, built from what the newsroom actually uses (observed in P0-02): Windows Marathi InScript, Marathi Phonetic, Google Input Tools, **typewriter/Remington-style, ISM and Shree-Lipi layouts**; macOS Devanagari QWERTY; Android Gboard Marathi.
  - **Caret and deletion:** caret movement and forward Delete work by grapheme cluster. **Backspace keeps the native behaviour:** it deletes one code point, such as a matra or virama, which is what Marathi typists expect.
  - The ZWJ/ZWNJ characters, nukta, ।, ॥ and ₹ are available in the Insert-character menu.
- **Shortcut matching.**
  - Shortcuts match the physical key (`KeyboardEvent.code`), not the typed character, so they work while a Marathi layout is active.
  - Key events during IME composition (`isComposing`, or keyCode 229) are never treated as shortcuts.
- **Leaving the canvas.**
  - The canvas is one tab stop; inside it, Tab and Shift+Tab move between objects.
  - **Esc** with nothing selected moves focus out to the next region. Skip links jump to the tool rail, the panels and the status bar.
  - The editor never uses browser full-screen, which would take Esc for itself; the installed app window is used instead.

### 3.9 Marathi glossary (catalogue seeds; a native editor approves)

| English | मराठी | English | मराठी |
|---|---|---|---|
| Overview | आढावा | Edition (issue) | अंक |
| Edition (zone) | आवृत्ती | Today's edition | आजचा अंक |
| Page / Pages | पान / पाने | Page plan | पान आराखडा |
| Story / Stories | बातमी / बातम्या | Content desk | मजकूर डेस्क |
| Headline | मथळा | Deck | उपमथळा |
| Kicker | वरचे शीर्षक | Byline | वार्ताहर नाव |
| Dateline | स्थळ ओळ | Body text | मुख्य मजकूर |
| Crosshead | उपशीर्षक | Caption | छायाचित्र ओळ |
| Photo | छायाचित्र | Photo credit | छायाचित्र सौजन्य |
| Advertisement | जाहिरात | Advertiser | जाहिरातदार |
| Template | साचा | Style | शैली |
| Column | स्तंभ | Margin | समास |
| Generate (auto-layout) | स्वयं-मांडणी | Try another layout | दुसरी मांडणी पाहा |
| Make it fit | मजकूर बसवा | Over by N lines | N ओळी जास्त |
| Fits | बसते | Continued on page N | पान N वर पुढे |
| Preflight | छपाईपूर्व तपासणी | Ready for print | छपाईसाठी तयार |
| Export | निर्यात | Send to press | छापखान्याकडे पाठवा |
| Press | छापखाना | Deadline | अंतिम वेळ |
| Approve | मंजूर करा | Request changes | बदल सुचवा |
| Comment | टिप्पणी | Version history | सुधारणा इतिहास |
| Undo / Redo | पूर्ववत / पुन्हा करा | Delete | हटवा |
| Duplicate | प्रत करा | Lock / Unlock | कुलूप लावा / काढा |
| Zoom in / out | मोठे करा / लहान करा | Fit page | संपूर्ण पान |
| Saved | जतन झाले | Offline | ऑफलाइन |
| Archive | संग्रह | Search | शोधा |
| Team | टीम | Owner | मालक |
| Chief editor | मुख्य संपादक | Editor | संपादक |
| Sub-editor | उपसंपादक | Reporter | वार्ताहर |
| Page designer | पान मांडणीकार | Photo editor | छायाचित्र संपादक |
| Prepress | छपाईपूर्व विभाग | Viewer | वाचक |
| Settings | सेटिंग्ज | Help | मदत |
| Sign in / out | प्रवेश / बाहेर पडा | Notifications | सूचना |
