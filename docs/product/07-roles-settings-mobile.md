# Pageinator product specification — Who sees what (roles × screens and key actions)

Part of the product specification ([index](README.md)). Examples are fictional.

## 12. Who sees what (roles × screens and key actions)

Key: ● full · ◐ partial (noted) · ○ view only · — hidden.

| | Owner | Admin | Chief Ed | Editor | Sub-ed | Reporter | Designer | Photo Ed | Advertising | Prepress | Viewer |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Overview | ● | ● | ● | ● | ● | ◐ own | ● | ● | ◐ ads | ● | ○ |
| Editions: create, Plan tab | ● | ● | ● | ● | ○ | — | ○ | ○ | ◐ ad positions only | ◐ colour map only | ○ |
| Delete draft edition | ● | ● | ● | — | — | — | — | — | — | — | — |
| Content desk · Stories library | ● | ● | ● | ● | ● | ◐ own stories | ○ | ◐ photos | ◐ ads tab | ○ | ○ |
| Story text edit | ● | ● | ● | ● | ● | ◐ own, before Ready | ◐ box text only | — | — | — | — |
| Media library | ● | ● | ● | ● | ● | ◐ upload own | ○ | ● | — | ○ | ○ |
| Ads desk | ● | ● | ○ | ○ | — | — | ○ | — | ● | ○ | — |
| Pages tab · History tab | ● | ● | ● | ● | ● | ○ | ● | ● | ○ | ● | ○ |
| Generate (after M18) | ● | ● | ● | ● | — | — | ● | — | — | — | — |
| Editor: layout | ● | ● | ● | ● | ◐ text only | — | ● | ◐ images only | ◐ ads only | ◐ all but text and ads | ○ |
| Comments (read / write) | ● | ● | ● | ● | ● | ◐ own stories | ● | ● | ● | ● | ○ read |
| Approve page (`page.approve`) | ● | ● | ● | ◐ "Can approve pages" grant | — | — | — | — | — | — | — |
| Unlock approved page (`page.unlock`) | ● | ● | ● | — | — | — | — | — | — | — | — |
| Preflight: run | ● | ● | ● | ● | ● | — | ● | — | — | ● | — |
| Preflight: override a warning | ● | ● | ● | — | — | — | — | — | — | ● | — |
| Export press master / send to press | ● | ● | ● | — | — | — | — | — | — | ● | — |
| Proof PDF, page images | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Approve release (`release.approve`) | ● | ● | ● | ◐ "Can approve release" grant | — | — | — | — | — | — | — |
| Correct and republish | ● | ● | ● | — | — | — | — | — | — | — | — |
| Archive view / download | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| Archive reprint (`archive.reprint`) | ● | ● | ● | — | — | — | — | — | — | ● | — |
| Legal hold / delete | ● | ● | — | — | — | — | — | — | — | — | — |
| E-paper publish (after G4) | ● | ● | ● | ● | — | — | — | — | — | — | — |
| Templates and styles | ● | ● | ● | ○ | — | — | ● | — | — | ○ | — |
| Publication settings | ● | ● | ● | ○ | — | — | — | — | — | ○ | — |
| Print profiles | ● | ● | ○ | — | — | — | — | — | — | ● | — |
| Fonts | ● | ● | ○ | — | — | — | ● | — | — | ● | — |
| Brand | ● | ● | ● | — | — | — | ● | — | — | — | — |
| Team | ● | ● | ○ | — | — | — | — | — | — | — | — |
| Organization, storage | ● | ● | — | — | — | — | — | — | — | — | — |
| Audit log | ● | ● | ○ (sidebar "Audit log" under Publication) | — | — | — | — | — | — | — | — |
| Billing | ● | ◐ "Billing delegate" grant | — | — | — | — | — | — | — | — | — |

**Enforcement:** on the server, every endpoint declares its permission; the UI only hides what the server would refuse.


## 13. Settings screens

**Save model** (all settings screens and Account):
- Forms have an explicit **Save** (primary) and **Cancel** at the bottom, and a sticky bar "Unsaved changes" when edited.
- Leaving with unsaved changes asks "Discard changes?".
- Simple switches (theme, notifications) save at once, with a "Saved" toast.
- Versioned settings (styles, templates, print profiles) say **Save as new version**.

| Screen | Controls |
|---|---|
| **Publication settings** `…/settings` | Name, languages, **digit style** (Devanagari ०–९ / Latin 0–9), timezone (Asia/Kolkata), sections (name, colour tag, default pages; drag to order), zones, page count by weekday, press deadline by weekday, edition naming, date format on pages ("गुरुवार, १२ नोव्हेंबर २०२६"), approval required before export (switch) |
| **Brand & masthead** `…/brand` | Masthead artwork (upload PDF/SVG/PNG; checked against its printed size: "1200 px → 198 ppi at 154 mm ✓"; preview on the front page), small logo for inside pages, colours (CMYK swatches), folio template (date, page number, edition, price variables), tagline |
| **Print profiles** `…/print-profiles` | List plus editor: press name and contact; trim size; bleed; slug; PDF standard (X-1a:2001 / X-1a:2003 / X-4); output intent (WAN-IFRA newspaper 26v5, or upload an ICC file, checked); ink limit %; minimum resolution warn/block; black policy (100% K text overprints; rich-black threshold); black-and-white pages are grey only; spot colours; colour capability by page position; file naming template; delivery method; **Download press test page**; version history (each change is a new version; editions pin a version) |
| **Fonts** `…/fonts` | Families, styles, format, **licence status**, embedding permission, preview mode (how the browser may show it: full / outlines / server pictures / stand-in). Upload (licence confirmation required). Substitutions map ("House Serif Body → Noto Serif Devanagari 87.5" while licences are pending) |
| **Team** `…/team` | Members table (name, email/phone, roles, publications, last active, status). **Invite** (primary): email or phone, role(s), publications, optional grants (**"Can approve pages"**, **"Can approve release"**, **"Billing delegate"**). Edit member (same fields). Pending invitations (resend, revoke). Role descriptions. Remove member (their work stays) |
| **Organization** `/org/:orgId/settings` | Tabs: **General** (legal name, GST number, address, data region: India) · **Publications** (list; **Add publication**; archive) · **Security** (require two-step for roles, session length, allowed sign-in methods) · **AI** (on/off for the organization, data policy) · **Danger zone** (transfer ownership; delete organization: typed confirmation and a 30-day grace period) |
| **Billing** (pilot: invoiced manually; self-serve after G6) | Plan, usage (pages exported, storage GB, AI credits, seats), invoices (GST), payment method (Razorpay: UPI, cards, net banking, e-mandate), change plan |
| **Storage** | Used vs plan (working files, archive, photos, ads), the largest items, retention explained |
| **Audit log** | Who · what · when · object · IP/device · result; filters; export CSV. Append-only |
| **Help centre** `/help` | Searchable articles (English/मराठी), editor tour, shortcuts, "How to send files to your press", contact (WhatsApp, phone, email), status page |

### 13.1 Phone and tablet (ships with the backend in M15a; reporter filing after G3)

**Phone** (< 768 px; bottom tab bar: Today · Pages · Stories · Alerts · More)

| Screen | Contents | Controls |
|---|---|---|
| Today | Edition card (date, status, deadline countdown), "needs attention" list | **Open pages** (primary) · edition switcher |
| Pages | Swipe through rendered pages (server-rendered images); pinch zoom; tap a story outline to read its text | Prev/next · page picker · **Comment** (drops a pin) · **Approve** / **Request changes** (holders of `page.approve`) |
| Story (read) | Headline, text, photos, status, fit | Comment · open on desktop (link) |
| Alerts | Notifications drawer (§11) | Mark read · open |
| Archive (More) | Calendar of editions → page images | Download PDFs |
| Reporter filing (after G3) | New story form: headline, place, text, photos from camera or gallery; drafts kept on the phone offline, sent when online | **Send to desk** (primary) · Save draft |

**Tablet** (768–1279 px): the phone screens, plus text edits in the story panel and the full Overview. Layout tools are hidden.
