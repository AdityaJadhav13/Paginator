# Pageinator product specification — The page editor (the heart of the product)

Part of the product specification ([index](README.md)). Examples are fictional.

## 8. The page editor (the heart of the product)

**Route:** `…/editions/:editionId/editor/page/:pageId`. It is full-screen in its own shell, with no sidebar.

**Users:**
- Page Designer: full layout, plus short box text (labels and tabs; not story text).
- Editor and Chief Editor: layout and text.
- Sub-editor: text only.
- Photo Editor: images only.
- Prepress: layout and all print views, but not story text and not moving ads.
- Advertising: ads only.
- Viewer: read-only.

**Ships:** after G1 (signed sheet **and** L3 measured) plus the engine and renderer memos.
- **[G3-min]** marks what is built in M10–M12 and M15a/b for the 4-page printed edition.
- **(later: …)** marks items tied to a later gate or milestone.
- **Unlabelled items ship after G3 (M17).**

### 8.1 Screen layout (desktop ≥ 1280 × 720)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Menu bar: File Edit Object Type Page View Window Help        [presence][ ⋯ ] │ 28 px
├──────────────────────────────────────────────────────────────────────────────┤
│ ← Edition │ P3 City ▾ ‹ › │ ↶ ↷ │ − 47% + │ ▣ guides │ (✦ Auto-layout: M18) │ 🛡 0 │ 💬 3 │ Ready for review ▾ │ [Export] │ 40 px
├────┬───────────────┬─────────────────────────────────────────┬───────────────┤
│Tool│ Left dock     │ Rulers                                  │ Right dock    │
│rail│ [Pages]       │  ┌───────── pasteboard ─────────────┐   │ [Properties]  │
│48px│ [Stories]     │  │   ┌───── page 347×540 ──────┐    │   │ [Styles]      │
│    │ [Layers]      │  │   │  masthead / folio        │    │   │ [Comments]    │
│ V  │ 240 px        │  │   │  ┌─module─┐ ┌─module──┐  │    │   │ [History]     │
│ A  │ (200–360)     │  │   │  │headline│ │ ...     │  │    │   │ [Preflight]   │
│ K  │               │  │   │  └────────┘ └─────────┘  │    │   │ 300 px        │
│ T  │               │  │   └──────────────────────────┘    │   │ (260–440)     │
│ …  │               │  └──────────────────────────────────┘   │               │
├────┴───────────────┴─────────────────────────────────────────┴───────────────┤
│ P3/4 · x 182.4 mm col 5 · Story 3 col×142 mm · Overset 1 · Preflight 0/2 · Saved rev 184 · ● online · 47% │ 24 px
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Ctrl+\\** hides or shows all panels (InDesign uses Tab, but here Tab moves between objects for keyboard users).
- Docks are resizable and collapsible, and their tabs can be dragged between left and right.
- **Window ▸ Workspace ▸ Reset** restores the layout. The layout is remembered per user.

### 8.2 Menu bar

Shortcuts are listed for Windows; the Mac equivalents are in §8.12.
- **Canvas keys** apply when the page has focus.
- **Text keys** apply when the cursor is in the story panel or story editor.
- Items a role cannot use are hidden.

**File**

| Item | Shortcut | Does |
|---|---|---|
| New edition… | — | Create-edition dialog |
| Go to page… | Shift+G | Page picker |
| Place… [G3-min] | Ctrl+D | Place dialog (§8.8) → loaded cursor |
| Import stories… [G3-min: Word/text] | — | Word (.docx) and text in M15a; ZIP after G3; legacy fonts after the P0-12 decision |
| Save version | Ctrl+S | Named checkpoint. Autosave is always on; Ctrl+S only marks a restore point ("Saved version 'before late news'") |
| Version history… | — | History dialog with compare and restore |
| Page setup… | — | Page size (from the print profile), margins, columns, section, template, colour/mono |
| Export… [G3-min] | Ctrl+E | Export dialog (§9.2), scoped to this page or the whole edition |
| Print proof… [G3-min] | Ctrl+P | Proof PDF to the browser print dialog |
| Send to press… [G3-min: manual] | — | Manual download and a "Mark as sent" receipt at G3; links and SFTP later (M17) |
| Close editor | — | Back to the edition |

**Edit**

| Item | Shortcut (canvas · text) | Does |
|---|---|---|
| Undo / Redo [G3-min] | Ctrl+Z / Ctrl+Shift+Z · Ctrl+Z / Ctrl+Y or Ctrl+Shift+Z | Per-user stack |
| Cut / Copy / Paste [G3-min] | Ctrl+X / C / V | Objects and packages on the canvas; text in the story panel |
| Paste in place · Paste without formatting | Ctrl+Shift+V (canvas) · Ctrl+Shift+V (text) | Canvas: same position, any page. Text: plain text |
| Duplicate | Alt+drag (canvas) | Also in the menu; offsets by 5 mm |
| Delete [G3-min] | Delete / Backspace | Deleting a package returns its story to the desk (unplaced), not the bin |
| Select all · Deselect | Ctrl+A · Esc | On this page |
| Find / Change… | Ctrl+F | Scope: story / page / edition |
| Check spelling… | — (red underlines in text; right-click for suggestions) | Marathi and English dictionaries, plus a publication dictionary |
| Edit in story editor [G3-min] | Ctrl+Y (canvas) | Opens the story panel at the selection |
| Command palette | Ctrl+K | All actions |
| Keyboard shortcuts | Ctrl+/ (also ? when not typing) | Shortcut sheet |
| Preferences… | Ctrl+, | §8.8 |

**Object** (canvas)

| Item | Shortcut | Does |
|---|---|---|
| Move… | — | Numeric move or copy (X/Y fields are also in Properties) |
| Rotate 90° CW / CCW | — | Images and boxes only (v1: 90° steps) |
| Arrange ▸ Bring to front / forward / backward / to back | Ctrl+Shift+] / Ctrl+] / Ctrl+[ / Ctrl+Shift+[ | Z-order |
| Align ▸ left / centre / right / top / middle / bottom | — (buttons in Properties) | To selection, margins, page or key object |
| Distribute ▸ horizontal / vertical spacing | — | Equal gaps |
| Make package / Break package | Ctrl+G / Ctrl+Shift+G | Group frames into a story module |
| Lock / unlock [G3-min] · Unlock all on page | Shift+L · — | Locked = the generator and others can't move it |
| Hide / Show all on page | — | Screen only; preflight warns about hidden objects (GEO005) |
| Fitting ▸ Fit frame to content · Fit content proportionally · Fill frame proportionally (respects the focal point) · Centre content · Reset crop | — (buttons in Properties) | — |
| Text frame options… | Ctrl+B | Columns, insets, first baseline, vertical justify |
| Text wrap… | — | Wrap around this object |
| Thread ▸ Link to next frame / Unlink [G3-min] | — | Also the Thread tool (L) |
| Story ▸ Make it fit [G3-min] | Shift+F | Copyfit within house limits (§8.11.6) |
| Story ▸ Narrower / Wider by one column [G3-min] | [ / ] | Recomposes the module at the new width |
| Story ▸ Headline lines ▸ Auto/1/2/3 [G3-min] | — | — |
| Story ▸ Continue on page… | — | Jump with continuation lines (needs jump lines in the page engine; after G3) |
| Story ▸ Swap with… | — | Exchange positions of two modules |
| Story ▸ Remove from page [G3-min] | — | Story goes back to the desk |
| Comment on selection | Shift+N | Comment pinned to the object |

**Type** (applies to the text selection in the story panel, or to whole frames)

| Item | Shortcut (text keys) | Does |
|---|---|---|
| Paragraph styles / Character styles panel | Alt+5 (canvas) | Opens the Styles panel |
| Size larger / smaller | Ctrl+Shift+. / Ctrl+Shift+, | ±0.5 pt override (shown as "+" on the style) |
| Leading / Tracking | — (Properties fields) | Overrides; house styles normally decide these |
| Alignment | — (toolbar buttons) | Usually set by paragraph styles |
| Bold / Italic | Ctrl+B / Ctrl+I | Applies the character style "Bold" or "Italic" |
| Language ▸ मराठी / English / हिंदी | — | Drives shaping and spelling; hyphenation for English |
| Hyphenation (English only) | — | On/off per paragraph |
| Insert special character ▸ | — | । ॥ ऽ ₹ — – “ ” ‘ ’ … non-breaking space, ZWJ, ZWNJ, bullet |
| Insert break ▸ Line / Column / Frame | Shift+Enter / — / — | — |
| Headline ▸ Lines / Shape (Fill · Balanced · First-fit) / Fill to width / Size step ± [G3-min] | — | Headline composer controls |
| Fill with placeholder text ▸ मराठी / English | — | Template work |
| Show hidden characters | Ctrl+Shift+8 | ¶ · → markers in the story panel |

**Page** (canvas)

| Item | Shortcut | Does |
|---|---|---|
| Previous / Next page [G3-min] | Page Up / Page Down | — |
| First / Last page | Home / End | — |
| Page properties… [G3-min] | — | Section, template, colour/mono, designer, notes |
| Apply template… / Reset to template | — | Keeps placed stories and re-fits them |
| Margins and columns… / Create guides… / Clear guides | — | — |
| Auto-layout this page · Try another · Auto-layout selected area · Compare alternatives (later: M18) | (assigned in M18) | Hidden until inside-page generation ships |
| Request review / Approve page / Request changes / Unlock page [G3-min] | — | Rights per §2.3 |

**View** (canvas)

| Item | Shortcut | Does |
|---|---|---|
| Zoom in / out [G3-min] | Ctrl+= / Ctrl+- (also + / -) | Steps 10 · 25 · 33 · 50 · 66 · 75 · 100 · 150 · 200 · 300 · 400 · 600 · 800% |
| Fit page · Fit width [G3-min] | Shift+1 · Shift+3 | Installed app also: Ctrl+0 · Ctrl+Alt+0 |
| Actual size · zoom to selection | Shift+0 · Shift+2 | Actual size uses the calibrated screen size (§8.8 Preferences). Installed app also: Ctrl+1 |
| Screen mode ▸ Normal / Preview | W toggles | Preview hides guides, frame edges and pins |
| Screen mode ▸ Newsprint proof | Shift+W | Paper tone and the newsprint profile soft-proof |
| Screen mode ▸ Ink coverage · Overprint preview | — | Heat map above the profile's ink limit · shows black overprint |
| Show ▸ Rulers · Guides · Baseline grid · Frame edges · Threads | Shift+R · Ctrl+; · Ctrl+' · Ctrl+H · Shift+T | — |
| Show ▸ Fold line / Newshole / Ad labels / Template items / Comments / Preflight markers / Other people's selections | — | — |
| Snap to guides · Smart guides · Lock guides | Ctrl+Shift+; · Ctrl+U · — | — |
| Units ▸ mm · cm · inch · pt · columns | — | Rulers and fields |
| Pages ▸ Single page / Spread / All pages strip | — | — |
| Display quality ▸ Fast / Typical / High | — | Photo raster resolution on screen |

**Window** (canvas keys):
- Pages (Alt+1), Stories & assets (Alt+2), Layers (Alt+3), Properties (Alt+4), Styles (Alt+5), Swatches (Alt+6), Comments (Alt+7), History (Alt+8), Preflight (Alt+9).
- Suggestions (later: M20).
- Workspace ▸ Reset / Save as….
- Hide panels (Ctrl+\\).

**Help:** Keyboard shortcuts (Ctrl+/) · Editor tour · Help centre · What's new · Report a problem… (attaches the page revision, logs and a screenshot, with consent) · About (app, engine, HarfBuzz, font mode, profile version).

### 8.3 Top bar

Order is left to right.

| Control | Icon | Label | Does |
|---|---|---|---|
| Back | ui.back | Edition | To the edition's Pages tab |
| Page picker | — | "P3 · City ▾" | Dropdown of thumbnails, with status and presence |
| Prev / Next page | ui.prev / ui.next | — | Page Up / Page Down |
| Undo / Redo [G3-min] | cmd.undo / cmd.redo | — | Tooltip names the step ("Undo: Move 'Water scheme…'") |
| Zoom | cmd.zoom-out · % combobox · cmd.zoom-in | 47% | Type a value, or pick a preset / Fit page / Fit width |
| Guides toggle | cmd.guides | — | Ctrl+; |
| Preview toggle | cmd.preview | — | W |
| Auto-layout (split button) (later: M18) | ui.generate | Auto-layout ▾ | Hidden until M18. Main: this page. Menu: Selected area · Try another · Compare alternatives · Whole edition (later: G6) |
| Preflight badge [G3-min] | ui.shield-ok / ui.shield-alert | "0" or "3 errors" | Opens the Preflight panel; red if any blocking issue |
| Comments | ui.comment | count | Opens the Comments panel |
| Page status | — | "In layout ▾" | Ready for review / Approve / Request changes (by role) |
| Presence | AvatarStack | — | Who is on this edition; click to follow their view (read-only) |
| **Export** (primary) [G3-min] | ui.download | Export | Export dialog |
| More | ui.more | — | Save version · Version history · Page setup · Preferences · Shortcuts · Exit |

### 8.4 Tool rail

Single-key shortcuts work only when no text field has focus.

| Tool | Key | Click | Drag | Modifiers |
|---|---|---|---|---|
| **Select** [G3-min] | V | Selects the top **package** (story module) under the pointer; Shift adds/removes; clicking empty space deselects | On object: move (snaps). On empty space: marquee. On a handle: resize | Alt+drag = duplicate. Shift = constrain to horizontal/vertical or keep proportions. Ctrl held = no snapping. Double-click package = enter it; double-click text = edit text; Esc = up one level |
| **Direct select / content** [G3-min] | A | Selects a single frame inside a package, or the **image inside** a frame | Image content: pan the crop. Corner handles: scale the image (Shift = proportional). Frame edges: resize that frame only | Double-click image = focal-point mode (click the subject; Esc to finish) |
| **Story module** | K | Click on a column: empty module 2 columns wide with the house height | Draw a module snapped to columns; on release, "Choose a story…" opens, or drop a story onto it | Alt = free width (not snapped) |
| **Text frame** [G3-min] | T | In an existing frame: caret (story panel opens). On empty space: a frame 1 column wide | Draw a frame snapped to columns | Typing into a new frame creates a new "box story" (labels, tabs, short boxes). Designers may write box text but not story text |
| **Image frame** [G3-min] | F | On empty space: Place-photo dialog | Draw a frame (snaps to columns and baselines) | Shift = keep the photo's aspect ratio |
| **Box / panel** | M | — | Draw a box (object style "Ruled box") | Shift = square |
| **Rule** | \ | — | Draw a rule (0.5 pt black by default) | Constrained to horizontal/vertical by default; Alt = free angle |
| **Thread** [G3-min] | L | Click a frame's out-port (or the red "+") then click another frame: the text flows on. Click a thread line: unlink | — | Across pages: the target page is opened automatically |
| **Comment** | N | Drops a numbered pin with a thread (@mention people) | — | — |
| **Pick style (eyedropper)** | I | Click text or an object to pick its style; then click others to apply | — | Alt+click = pick again |
| **Hand** [G3-min] | H (hold Space) | — | Pan | — |
| **Zoom** [G3-min] | Z (hold Z = temporary) | Zoom in at the point | Marquee zoom | Alt+click = zoom out |
| **Region** (template mode) | R | — | Draw a template region: newshole, rail, folio bar or foot | Properties: kind, name, allowed content |
| **Story slot** (template mode) | S | — | Draw a story slot | Properties: minimum/maximum columns, photo yes/no, headline size range, priority rank |

### 8.5 The canvas

**Page and pasteboard**
- The page is drawn at its true proportions from the print profile (pilot: **347 × 540 mm, no bleed**). It is white, with a soft shadow, on the pasteboard.
- The pasteboard extends 60 mm left and right and 30 mm above and below. Objects can be parked there; they don't print. An object that crosses the page edge is a preflight error (GEO001).
- If the profile has a bleed, a red bleed line is drawn; if it has a slug, so is the slug area.

**Rulers** (top and left, 20 px)
- Units are mm by default. The origin is the page's top-left trim corner, and can be dragged to reset (double-click resets).
- The top ruler highlights the **8 grid columns**, numbered 1–8 at their centres.
- Drag from a ruler to create a guide. Right-click a ruler to change its units.

**Guides and overlays** (each toggleable; colours as in §3.2)

| Guide | Drawn | Pilot value |
|---|---|---|
| Margins (type area) | Always | x 12.82–334.15 mm; top 12.52 mm, bottom 12.68 mm (measured ink margins) |
| Columns and gutters | Always | 8 × 36.5 mm, gutter 4.19 mm. Alternative 6-column grid on request |
| Baseline grid | When shown | Body leading 13 pt (4.586 mm) from the first baseline |
| Fold line | When shown | 270 mm (half the page height) |
| Newshole | When shown | Type area minus masthead/folio, ads and furniture, dashed |
| Ruler guides | When shown | User-created |
| Smart guides | During drags | Pink lines with distances in mm |

**Zoom**
- Range 10–800%. Ctrl+wheel and trackpad pinch zoom at the pointer; the wheel scrolls; Shift+wheel scrolls horizontally.
- During a gesture the screen scales cached tiles; when the gesture stops, the page is re-rendered sharp within 300 ms.

**Selection appearance**
- Hover shows a thin blue outline.
- A selected package gets a 1.5 px blue outline around the whole module, 8 square handles (7 × 7 px, 2 px extra hit area), and a label tab above it: "City… · 3 col × 142 mm · Fits ✓".
- A frame selected inside a package shows the package as dashed and the frame as solid.
- A multiple selection shows one outer box with handles plus thin outlines on each item.

**Snapping**
- Threshold: 6 screen pixels.
- Priority: column edges and gutters → margins → other modules' edges → baselines (vertical) → ruler guides → page centre → fold.
- Module width always snaps to 1–8 grid columns unless Alt is held.
- Ctrl held while dragging switches snapping off.

**Live fit feedback** [G3-min]
- While a story module is dragged or resized, the label shows the engine's answer within 100 ms: "3 col × 128 mm · over 6 lines" → "3 col × 142 mm · fits".
- On release, the module recomposes: the headline refits (house size for the span, line count, fill to width), the body flows, and the photo re-crops around its focal point.

**Overlaps**
- Two modules may overlap only temporarily. The overlap is shaded red with "Overlaps 'Riverside flood' by 12 mm".
- Preflight GEO002 blocks export while it lasts.
- (Later) **Make room** pushes the modules below down to the next legal positions.

**Overset**
- A red **+** sits at the foot of a story's last frame, and the module label reads "Over by 7 lines".
- Clicking **+** opens: Make it fit · Make module deeper (+N mm) · Continue on page… · Shorten (AI suggestion, later: G5) · Show the text that doesn't fit.

**Threads (View ▸ Threads)**
- Blue dashed connectors run from each frame's out-port to the next frame's in-port.
- Off-page threads show "→ P4" / "P1 →" tags.

**Ads**
- Locked hatched boxes labelled "AD · Example Jewellers · 4 × 120 · Colour". When artwork has arrived it is drawn (toggle: View ▸ Ad labels / artwork).
- Only Advertising, Editor and Chief Editor can move an ad, with a confirmation: "This changes the booked position."

**Template items** (masthead, folio, date, page number, standing modules)
- Drawn normally; dotted on hover.
- Not selectable unless Ctrl+Shift+click (override), with a warning.
- Variables fill automatically: `{date}` in the publication's date and digit style ("गुरुवार, १२ नोव्हेंबर २०२६"), `{page}` ("पान ३"), `{edition}`, `{price}`.

**Presence**
- Other people's selections are outlined in their colour with a name tag.
- If someone else is laying out this page, a banner reads: "Priya is editing this page · View only · **Ask to take over**".

**Preflight pins:** red or amber pins at the problem; hover shows the message; click opens the panel item.

**Comments:** numbered pins; click opens the thread popover with Reply · Resolve · @mention.

**Screen modes**
- **Normal.**
- **Preview** (W): only what prints.
- **Newsprint proof:** paper tone plus the profile's soft-proof, so photos look as dull as they will in print.
- **Ink coverage:** a heat map above the ink limit.
- **Overprint preview.**
- (Later) **Separations:** C, M, Y and K plates, each switchable.

**Multi-page views**
- Single page (default).
- **Spread:** two pages as printed side by side; useful for a centre spread.
- **All pages strip:** a small horizontal overview; click to jump.

### 8.6 Left dock

| Panel | Contents | Actions |
|---|---|---|
| **Pages** (Alt+1) [G3-min] | Thumbnails as spreads. Each shows page status, overset and preflight badges, and presence avatars | Click = go. Right-click: Page properties · Apply template · Request review · Approve · Auto-layout (later: M18). Page order is read-only here (change it in Plan) |
| **Stories & assets** (Alt+2) [G3-min] | Tabs **Stories · Photos · Ads**. The default filter is "Not placed". Each story shows section, priority, words and "≈ 2 col × 118 mm" | **Drag onto the page** = place as a module (§8.11.1). Drag a photo onto a module or image frame. **Ads at G3 (minimal):** the booked ad's artwork (PDF or JPG) is rasterised to CMYK and placed as an image in the booked rectangle; vector ad intake comes in M17. Search |
| **Layers** (Alt+3) | Tree: Page → Template items (locked) · Ads (locked) · Editorial → packages (story name) → frames (Headline, Deck, Byline, Body 1…n, Photo, Caption) · Comments | Eye (hide on screen), lock, select. Drag = change stacking order |

### 8.7 Right dock

The right dock has these tabs: **Properties** · Styles · Swatches · Comments · History · Preflight · (later) Suggestions.

**Properties.** Content depends on what is selected.

| Selection | Sections and controls |
|---|---|
| Nothing (the page) | **Page:** number, section, template, colour/mono, status with **Request review** / **Approve**, designer, deadline, notes. **Page facts:** "News space used 96% · white gaps 2 · stories 6 · photos 5". Buttons (later: M18): Auto-layout page · Try another |
| **Story module** [G3-min] | **Story:** headline preview (click = edit), status, priority, **fit meter** (Fits / Over by N / Short by N) · **Make it fit** · **Width** segmented 1–8 col · **Headline:** lines (Auto/1/2/3), shape (Fill/Balanced/First-fit), size (pt; house default shown), fill to width (switch) · Deck (switch) · Byline (switch) · **Photo:** span (k of m columns), position (Top/Left/Right), crop, focal point · Continue on page… (after G3) · Remove from page. **Layout:** X, Y (mm) · W (columns, with mm) · H (mm) · text columns (derived from the house table, override) · lock |
| **Text frame** [G3-min] | **Frame:** X, Y, W, H · columns, gutter · insets T/B/L/R · first baseline (Ascent/Cap height/Leading/Fixed) · vertical alignment (Top/Centre/Bottom/Justify) · auto-height. **Text** (selection in the story panel): paragraph style ▾ · character style ▾ · overrides (size, leading, tracking (Latin), horizontal scale, alignment, language, English hyphenation) · **Clear overrides**. **Thread:** ◀ previous · next ▶ |
| **Image frame** [G3-min] | **Frame:** X, Y, W, H, stroke. **Image:** thumbnail, name, **effective resolution badge** ("212 ppi ✓" / "96 ppi — too low for print ✗"), colour note ("RGB — converted to newsprint CMYK when exported"), fitting buttons (fit content, fill frame, fit frame, centre), crop (scale %, offset x/y), **Focal point**, caption (edit), credit, **Replace…**, Open original |
| Box / panel | Object style ▾ · fill swatch + tint % · stroke weight (pt), swatch, style (solid/dashed/dotted/double) · corner radius (mm) · text inset |
| Rule | Weight (0.25 · 0.5 · 1 · 2 pt + custom) · swatch · style · length (mm) · horizontal/vertical |
| Ad | Booking card (advertiser, size, colour, run dates, position rule) · artwork status with **View report** · Show artwork/dummy · Replace artwork (Advertising) · Move (with booking confirmation) |
| Several objects | **Align** (6) · **Distribute** (2) · Align to (Selection / Margins / Page / Key object) · shared properties · Make package |

**Other tabs**
- **Styles:** paragraph, character and object styles as lists. Click applies; "+" marks an override; right-click: Edit · Duplicate · Redefine from selection · Select all using.
- **Swatches:** CMYK swatches with C/M/Y/K values and a tint slider. Total ink is shown, with a warning above the profile limit.
- **Comments:** threads (open / resolved / mine), each with a jump-to-pin link.
- **History** [G3-min]: revisions ("rev 184 · Priya · 22:41 · Moved 'शहर पाणीपुरवठा योजना…' to column 5"). Click previews; **Restore as new revision**; **Compare** with the current one.
- **Preflight** [G3-min]: issues for this page, then the edition; each has Show · Fix (when automatic) · Override (warnings only, reason required).
- **Suggestions** (later: G5): AI proposals waiting for a decision, shown as a diff with Accept / Reject.

### 8.8 Dialogs (fields)

| Dialog | Fields and buttons |
|---|---|
| **Place** (Ctrl+D) | Tabs: Story (unplaced stories, search) · Photo (media library) · File (upload Word, text, image or ad PDF). "Place as": module / into the selected frame. **Place** → loaded cursor (shows a thumbnail; click a column to drop) |
| **Page setup** (File menu) | Page size (read-only; from the print profile) · margins · columns and gutter · section · template · colour/mono · OK |
| **Margins and columns** | Top / bottom / inside / outside, column count, gutter, live preview |
| **Create guides** | Rows and columns, gutters, fit to margins or page, remove existing |
| **Text frame options** (Ctrl+B) | Columns, gutter, fixed column width, insets, vertical justification, first baseline offset, ignore text wrap |
| **Text wrap** (Object menu) | None / around the box / jump object / jump to next column; offsets T/B/L/R; wrap side |
| **Move** (Object menu) | Horizontal, vertical, distance, angle · Copy · OK |
| **Find / Change** (Ctrl+F) | Find · Change to · scope (story/page/edition) · case · whole word · treat nukta variants as equal · Find next / Change / Change all |
| **Spelling** (Edit menu; also right-click a red-underlined word) | Word, suggestions, Ignore / Ignore all / Change / Add to publication dictionary; language |
| **Paragraph style** | **General:** name, based on, next style. **Font:** family, weight, size, leading, tracking (Latin), horizontal scale, width axis. **Indents & spacing:** first-line indent, left/right, before/after, alignment. **Justification:** word spacing min/desired/max (house policy C3: floor 0.66, stretch 1.0), letter spacing (Latin), last-line alignment, **word breaking** (Marathi: never; English: hyphenate). **Hyphenation (English):** minimum word 6, before 2, after 2, at most 3 in a row, penalty. **Keep options:** keep with next N lines, keep together, start in next column. **Rules above/below:** weight, colour, offset. **Colour:** swatch, tint. **Language.** Preview pane in Marathi sample text |
| **Character style** | Weight/style, size, colour, tracking, baseline shift, language |
| **Object style** | Fill, stroke, corners, text-frame options, wrap |
| **Swatch** | Name, C/M/Y/K (0–100), tint, ink total, spot (only if the profile allows) |
| **Version history** | Revision list (author, time, summary), preview, **Compare** (side by side, changed objects highlighted), **Restore as new revision** |
| **Compare alternatives** | A / B / C side by side, differences named; **Use this** |
| **Continue on page** | Target page (later pages first, same section first) · jump-line wording ("पान ४ वर पुढे" / "पान १ वरून पुढे") · OK. Creates the continuation module on the target page and adds both jump lines |
| **Approve page** | Summary ("Preflight: 0 errors on this page · last edit 22:41 by Priya") · optional comment · **Approve** |
| **Request changes** | Comment (required) · **Send back** |
| **Take over page** | "Priya is editing page 3 (active 20 s ago). Take over? Her unsaved changes are kept as a separate draft." · Take over · Cancel |
| **Conflict** | "Priya also changed this module." Keep hers / Keep yours / Keep both (yours goes to the pasteboard) |
| **Preferences** (Ctrl+,) | **General:** language, theme, chrome. **Units & steps:** ruler units, nudge 0.5 mm (Shift ×10), type step 0.5 pt, leading step 0.5 pt. **Guides & pasteboard:** colours, fold line. **Display:** quality, show ad artwork, photos. **Snapping:** threshold. **Typing:** Marathi keyboard hint, smart quotes per language, "--" → dash. **Autosave & offline:** local copy, outbox status. **Screen calibration:** hold a ruler or credit card to the screen and drag to match, so 100% = real size. **Shortcuts** |

### 8.9 Right-click menus

| On | Items |
|---|---|
| Story module | Edit story (Ctrl+Y) · Make it fit · Change width ▸ · Headline lines ▸ · Continue on page… (after G3) · Swap with… · Remove from page · Lock · Break package · Arrange ▸ · Copy · Duplicate · Delete · Comment · Show in stories · Story history · Try another arrangement (later: M18) |
| Text frame | Edit text · Text frame options · Thread ▸ Link / Unlink · Fit frame to content · Text wrap · Arrange ▸ · Lock · Delete · Comment |
| Image frame | Place / Replace photo · Fitting ▸ · Focal point · Edit caption · Image info · Open original · Rotate ▸ · Arrange ▸ · Lock · Delete · Comment |
| Box / rule | Object style ▸ · Arrange ▸ · Lock · Duplicate · Delete |
| Ad | Booking · Artwork report · Replace artwork · Move… · Comment |
| Empty page | Paste · Paste in place · Place story here… · Page properties · Guide here · Comment · Auto-layout this area (later: M18) |
| Page thumbnail | Go to page · Page properties · Request review · Approve · Auto-layout (later: M18) |

### 8.10 Status bar (left → right)

| Item | Example | Click |
|---|---|---|
| Page | "P3 / 4 · City" | Page picker |
| Cursor | "x 182.4 mm · col 5 · y 230.1 mm" | — |
| Selection | "Story module · 3 col × 142 mm" | — |
| Overset | "Over: 1 story (7 lines)" | Zooms to it |
| Preflight | "0 errors · 2 warnings" | Preflight panel |
| Save state | "Saved · rev 184" / "Saving…" / "Offline — 12 changes kept on this computer" / "Sync problem — retrying" | Sync details |
| Connection | ● online / ○ offline | — |
| Zoom | "47%" combobox | — |
| Engine | "Engine compose/1.0 · stand-in fonts" | About dialog |

### 8.11 How the main interactions work

1. **Placing a story** [G3-min]
   - Drag a story from the Stories panel (or Ctrl+D then click).
   - While hovering, a ghost module shows the engine's suggested width and depth ("2 col × 118 mm").
   - It snaps to columns. On release the module is built from house rules:
     - headline size for the span (≈ 14 + 5 × columns pt);
     - text columns per the house table (e.g. a 4-column span gets 3 text columns of 50.06 mm);
     - byline and deck if present;
     - the attached photo across the text columns.
   - It is composed immediately and its fit meter appears.
2. **Resizing and moving** [G3-min]
   - Width snaps to 1–8 columns; height snaps to the baseline grid.
   - The fit is previewed live; release recomposes.
   - Neighbours are not moved automatically in v1. Overlaps are flagged.
3. **Editing text** [G3-min]
   - Double-click text: the **story panel** opens docked (bottom or right) with the caret at the clicked character (mapped through glyph clusters).
   - Typing recomposes the canvas within 200 ms (the engine runs in a browser worker), and the fit meter updates live.
   - Direct typing on the canvas comes later.
   - IME composition is never interrupted by a canvas refresh.
4. **Images** [G3-min]
   - Drop a photo onto a module or frame. A crops; the focal point keeps faces in frame when the module resizes.
   - The resolution badge updates live: below 150 ppi it warns; below the profile's block limit it is an error.
5. **Threads [G3-min] and continuations (after G3)**
   - The Thread tool links frames.
   - **Continue on page…** creates a continuation module on the target page and inserts both jump lines in the house style; the page numbers update themselves if pages move. Jump lines need page-engine support that M8 does not include, so this comes after G3.
6. **Make it fit** (copyfit; house limits; every step reported). It tries, in order, until the text fits:
   1. word spacing within policy;
   2. body size 99 → 96% (house horizontal-scale range);
   3. headline one size step down;
   4. one line more or fewer of depth (when the page has room).

   It reports what changed ("Body set at 98% · headline −1 step") and is a single undo step. If nothing fits: "Cut 34 words, or make it 18 mm deeper."
7. **Locks and approvals** [G3-min]
   - Lock (Shift+L) freezes an object for everyone and for the generator.
   - **Approve page** (holders of `page.approve`, §2.3) locks the page. Only holders of `page.unlock` (Owner, Admin, Chief Editor) can unlock it, which sets the page back to "Changes requested".
8. **Undo and history**
   - Undo is per person and per session. An auto-layout is one step.
   - The History panel restores any older revision **as a new revision**; nothing is ever overwritten.
9. **Autosave and offline** [G3-min]
   - Every change is written to this computer at once (IndexedDB) and to the server within about 1 s.
   - Offline keeps working, with a banner ("Offline — 12 changes kept on this computer"); the outbox sends on reconnect.
   - Conflicts are resolved per object (dialog §8.8).
10. **Several people at once**
    - One designer per page (soft lock with take-over); one person per story text (lease).
    - Everyone else sees live updates and can comment.
11. **Template mode** (Page Designer)
    - **Edit template** opens the template in the same editor, plus a **Region** tool (newshole, rails, folio bar) and a **Slot** tool (story slot with minimum/maximum columns and photo yes/no).
    - Master items carry variables.
    - Saving creates a new profile version.

### 8.12 Keyboard shortcuts (complete)

**Rules behind the table**
1. **Two key maps, chosen by focus.**
   - **Canvas keys** are InDesign-like where the browser allows, plus browser-proven Figma conventions (Shift+0/1/2, Shift+R).
   - **Text keys** (story panel and story editor) follow word-processor habits: Ctrl+B bold, Ctrl+I italic, Ctrl+Y redo. Reporters and ProseMirror expect these.
2. **Keys never used**, because browsers or operating systems keep them:
   - Ctrl+N/T/W, Ctrl+Tab, Ctrl+Page Up/Down, Ctrl+1–9 (tab switching), F5, F6, F7, F11, F12;
   - Ctrl+Shift+I/J/C (developer tools), Ctrl+Shift+M (Firefox), Ctrl+R (reload), Ctrl+L (address bar);
   - Alt+F/E (browser menus), Alt+←/→ (Back/Forward), Ctrl+Space (input-source switch);
   - on a Mac: ⌘H (hide app), ⌘⇧3/4/5 (screenshots), ⌥⌘I/C (Web Inspector), ⌥⌘W (Safari closes tabs), ⌘⌥M (minimise all).
3. **While typing**, there are no Ctrl+Alt (= AltGr) combinations, which Marathi InScript uses for characters. There are also no Alt/⌥+arrows: ⌥ is the Devanagari-QWERTY character layer and the word-jump modifier.
4. **Matching:** shortcuts match the physical key (`KeyboardEvent.code`), and are never triggered during IME composition.
5. **Testing:** the table is verified in M9 (in the renderer harness) on Chrome, Edge, Firefox and Safari, on Windows and macOS. Any key a browser does not hand over gets an alternative before M10. The installed app window additionally frees Ctrl+0/1/2/4/5.

**Canvas keys**

| Group | Action | Windows | Mac |
|---|---|---|---|
| Tools | Select · Direct · Module · Text · Image · Box · Rule · Thread · Comment · Pick style · Hand · Zoom · (template) Region · Slot | V · A · K · T · F · M · \ · L · N · I · H · Z · R · S | same |
| Tools | Temporary hand · temporary zoom (hold; Alt to zoom out) | Space · hold Z | Space · hold Z |
| Edit | Undo · Redo | Ctrl+Z · Ctrl+Shift+Z | ⌘Z · ⌘⇧Z |
| Edit | Cut · Copy · Paste · Paste in place | Ctrl+X · Ctrl+C · Ctrl+V · Ctrl+Shift+V | ⌘X · ⌘C · ⌘V · ⌘⇧V |
| Edit | Duplicate · Delete · Select all · Deselect | Alt+drag · Del · Ctrl+A · Esc | ⌥drag · ⌫ · ⌘A · Esc |
| Edit | Find · Story editor · Command palette · Shortcuts · Preferences | Ctrl+F · Ctrl+Y · Ctrl+K · Ctrl+/ · Ctrl+, | ⌘F · ⌘Y · ⌘K · ⌘/ · ⌘, |
| File | Place · Save version · Export · Print proof · Go to page | Ctrl+D · Ctrl+S · Ctrl+E · Ctrl+P · Shift+G | ⌘D · ⌘S · ⌘E · ⌘P · ⇧G |
| Object | Make / break package · Lock toggle | Ctrl+G / Ctrl+Shift+G · Shift+L | ⌘G / ⌘⇧G · ⇧L |
| Object | Front · forward · backward · back | Ctrl+Shift+] · Ctrl+] · Ctrl+[ · Ctrl+Shift+[ | ⌘⇧] · ⌘] · ⌘[ · ⌘⇧[ |
| Object | Text frame options · Comment on selection | Ctrl+B · Shift+N | ⌘B · ⇧N |
| Object | Nudge · big nudge | Arrows (0.5 mm) · Shift+Arrows (5 mm) | same |
| Story | Make it fit · one column narrower / wider | Shift+F · [ / ] | ⇧F · [ / ] |
| Page | Prev / next page · first / last page | Page Up / Page Down · Home / End | Fn+↑ / Fn+↓ · Fn+← / Fn+→ |
| View | Zoom in / out · fit page · fit width · 100% · zoom to selection | Ctrl+= / Ctrl+- (also + / -) · Shift+1 · Shift+3 · Shift+0 · Shift+2 | ⌘= / ⌘- · ⇧1 · ⇧3 · ⇧0 · ⇧2 |
| View | Preview · newsprint proof | W · Shift+W | W · ⇧W |
| View | Rulers · guides · baseline grid · frame edges · threads · smart guides · snap to guides | Shift+R · Ctrl+; · Ctrl+' · Ctrl+H · Shift+T · Ctrl+U · Ctrl+Shift+; | ⇧R · ⌘; · ⌘' · **⌃⌘H** · ⇧T · ⌘U · ⌘⇧; |
| Window | Pages · Stories · Layers · Properties · Styles · Swatches · Comments · History · Preflight · Hide panels | Alt+1 … Alt+9 · Ctrl+\\ | ⌥1 … ⌥9 · ⌘\\ |
| Navigation | Next / previous object · enter package or text · up one level / leave canvas | Tab / Shift+Tab · Enter · Esc | same |

**Text keys** (story panel and story editor)

| Action | Windows | Mac |
|---|---|---|
| Undo · Redo | Ctrl+Z · Ctrl+Y or Ctrl+Shift+Z | ⌘Z · ⌘⇧Z |
| Cut · Copy · Paste · Paste plain · Select all | Ctrl+X · Ctrl+C · Ctrl+V · Ctrl+Shift+V · Ctrl+A | ⌘X · ⌘C · ⌘V · ⌘⇧V · ⌘A |
| Bold · Italic (character styles) | Ctrl+B · Ctrl+I | ⌘B · ⌘I |
| Size larger / smaller (override) | Ctrl+Shift+. / Ctrl+Shift+, | ⌘⇧. / ⌘⇧, |
| Find / change | Ctrl+F | ⌘F |
| Show hidden characters | Ctrl+Shift+8 | ⌘⇧8 |
| Line break · back to the canvas | Shift+Enter · Esc | ⇧Return · Esc |

**Installed app only:** Ctrl+0 fit page · Ctrl+1 actual size · Ctrl+2 / Ctrl+4 / Ctrl+5 zoom 200% / 400% / 50%. In a browser tab these keys switch tabs, so use the Shift+digit keys or the zoom box.

**Auto-layout keys** are assigned in M18, when the feature ships.
